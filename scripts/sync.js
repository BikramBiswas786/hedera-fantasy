// Keeps the chain in step with real fixtures. Run on a schedule (see .github/workflows/sync-matches.yml):
//   npx hardhat run scripts/sync.js --network hederaTestnet
// Each run:
//   1. imports Premier League fixtures (FPL API) and international T20/ODI matches (CricketData,
//      when CRICKETDATA_API_KEY is set) starting within LOOKAHEAD_DAYS that aren't on-chain yet
//   2. abandons matches whose fixture was postponed or produced no result (contests refund)
//   3. posts results for finished matches, with the raw stats published to HCS
//   4. settles contests once the dispute window has passed
// DRY_RUN=1 reads everything and logs what it would do, without sending transactions.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ROOT } = require("./lib");
const { contracts, createMatchFromMeta, postResultsFromStats, settleMatch, loadRef } = require("./ops");
const { createFplFeed } = require("./feeds/fpl");
const { createCricketFeed } = require("./feeds/cricketdata");

const DRY_RUN = process.env.DRY_RUN === "1";
const LOOKAHEAD = Number(process.env.LOOKAHEAD_DAYS || 3) * 86400;
const MIN_LEAD = 15 * 60; // don't import a match that starts within 15 minutes
const CACHE_FILE = path.join(ROOT, ".cache", "metadata.json");
// The cricket list costs requests from a 100/day quota, so only refresh it every few hours.
const CRICKET_LIST_EVERY_HOURS = Number(process.env.CRICKET_LIST_EVERY_HOURS || 6);

const STATUS = { Scheduled: 0, ResultsPosted: 1, Abandoned: 2 };

async function loadMetadataCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveMetadataCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

/** Every on-chain match with its metadata, keyed by the feed's fixture key. */
async function loadRegistry(league) {
  const cache = await loadMetadataCache();
  const count = Number(await league.matchCount());
  const matches = [];
  for (let id = 1; id <= count; id++) {
    const m = await league.getMatch(id);
    let meta = cache[m.metadataURI];
    if (!meta) {
      try {
        meta = JSON.parse(await loadRef(m.metadataURI));
        cache[m.metadataURI] = meta;
      } catch (e) {
        console.warn(`  match #${id}: cannot load metadata (${e.message})`);
        continue;
      }
    }
    matches.push({ id, m, meta, status: Number(m.status), startTime: Number(m.startTime) });
  }
  saveMetadataCache(cache);
  return { matches, keys: new Set(matches.filter((x) => x.meta.source?.key).map((x) => x.meta.source.key)) };
}

async function act(label, fn) {
  if (DRY_RUN) {
    console.log(`  [dry run] would ${label}`);
    return null;
  }
  console.log(`  ${label}`);
  return fn();
}

async function main() {
  const { league } = await contracts(hre);
  const now = (await hre.ethers.provider.getBlock("latest")).timestamp;
  const feeds = { fpl: createFplFeed() };
  const cricket = createCricketFeed({ apiKey: process.env.CRICKETDATA_API_KEY });
  if (cricket) feeds.cricketdata = cricket;
  else console.log("CRICKETDATA_API_KEY not set: skipping international cricket");

  console.log(`Sync at ${new Date(now * 1000).toISOString()}${DRY_RUN ? " (dry run)" : ""}`);
  const registry = await loadRegistry(league);
  console.log(`${registry.matches.length} matches on-chain`);

  // 1. Import upcoming fixtures
  const hour = new Date(now * 1000).getUTCHours();
  for (const feed of Object.values(feeds)) {
    if (feed.provider === "cricketdata" && hour % CRICKET_LIST_EVERY_HOURS !== 0 && !process.env.FORCE_CRICKET_LIST) continue;
    let upcoming = [];
    try {
      upcoming = await feed.upcoming(now + MIN_LEAD, now + LOOKAHEAD);
    } catch (e) {
      console.warn(`${feed.provider}: could not list fixtures (${e.message})`);
      continue;
    }
    console.log(`${feed.provider}: ${upcoming.length} fixtures in the next ${LOOKAHEAD / 86400} days`);
    for (const { meta, startTime } of upcoming) {
      if (registry.keys.has(meta.source.key)) continue;
      await act(`create ${meta.competition}: ${meta.name} (${meta.players.length} players) at ${meta.kickoff}`, async () => {
        const safeKey = meta.source.key.replace(/[^a-z0-9]+/gi, "-");
        const { matchId } = await createMatchFromMeta(hre, meta, startTime, `data/live/${safeKey}.match.json`);
        console.log(`    -> match #${matchId}`);
      });
    }
  }

  // 2 + 3. Abandon postponed fixtures and post results for finished ones
  for (const { id, meta, status, startTime } of registry.matches) {
    const feed = feeds[meta.source?.provider];
    if (!feed || status !== STATUS.Scheduled) continue;
    if (feed.provider === "fpl" || now >= startTime) {
      let result;
      try {
        result = feed.provider === "fpl" && now < startTime ? await checkPostponed(feed, meta) : await feed.result(meta, startTime, now);
      } catch (e) {
        console.warn(`  match #${id} ${meta.name}: result check failed (${e.message})`);
        continue;
      }
      if (result?.abandon) {
        await act(`abandon match #${id} ${meta.name} (postponed or no result; contests refund)`, async () => {
          await (await league.abandonMatch(id)).wait();
        });
      } else if (result?.stats) {
        await act(`post results for match #${id} ${meta.name}: ${result.stats.summary}`, async () => {
          const safeKey = meta.source.key.replace(/[^a-z0-9]+/gi, "-");
          const { statsRef } = await postResultsFromStats(hre, id, meta, result.stats, `data/live/${safeKey}.stats.json`);
          console.log(`    -> stats at ${statsRef}`);
        });
      }
    }
  }

  // 4. Settle (or refund) contests whose results are final, and refund abandoned matches
  const window = Number(await league.disputeWindow());
  for (const { id, meta } of registry.matches) {
    const m = await league.getMatch(id);
    const status = Number(m.status);
    const final = status === STATUS.ResultsPosted && now >= Number(m.resultsPostedAt) + window;
    if (!final && status !== STATUS.Abandoned) continue;
    const open = [];
    for (const contestId of await league.getContestsOfMatch(id)) {
      if (Number((await league.getContest(contestId)).status) === 0) open.push(contestId);
    }
    if (open.length === 0) continue;
    await act(`${status === STATUS.Abandoned ? "refund" : "settle"} ${open.length} contest(s) for match #${id} ${meta.name}`, async () => {
      if (status === STATUS.Abandoned) {
        for (const contestId of open) await (await league.cancelContest(contestId)).wait();
      } else {
        for (const r of await settleMatch(hre, id)) console.log(`    contest #${r.contestId}: ${r.action}`);
      }
    });
  }

  if (feeds.cricketdata) console.log(`CricketData requests used this run: ${feeds.cricketdata.requests()}`);
}

/** Before kickoff, an FPL fixture counts as postponed if it disappeared or its kickoff moved. */
async function checkPostponed(feed, meta) {
  const result = await feed.result(meta);
  return result?.abandon ? result : null;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

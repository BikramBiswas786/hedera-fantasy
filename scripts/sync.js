// Keeps the chain in step with real fixtures. Run on a schedule (see .github/workflows/sync-matches.yml):
//   npx hardhat run scripts/sync.js --network hederaTestnet
// Each run:
//   1. imports Premier League fixtures (FPL API) and international T20/ODI and major T20 league
//      matches (CricketData, when CRICKETDATA_API_KEY is set) starting within LOOKAHEAD_DAYS that
//      aren't on-chain yet, at most MAX_IMPORTS_PER_RUN per run
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

// Without an operator key there is nothing to sign with, so only report what would happen.
const DRY_RUN = process.env.DRY_RUN === "1" || (hre.network.name !== "localhost" && !process.env.HEDERA_PRIVATE_KEY);
const LOOKAHEAD = Number(process.env.LOOKAHEAD_DAYS || 7) * 86400;
// Each import is a few transactions; later runs pick up the rest.
const MAX_IMPORTS = Number(process.env.MAX_IMPORTS_PER_RUN || 12);
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

/** Scores a finished FPL fixture (an id, or "latest") with real stats and prints the top players, without touching the chain. */
async function previewFplFixture(fixtureId) {
  const { buildMeta } = require("./feeds/fpl");
  const { RULES, computeMatchPoints } = await import("../scoring/index.mjs");
  const get = async (p) => (await fetch(`https://fantasy.premierleague.com/api${p}`)).json();
  const [boot, fixtures] = await Promise.all([get("/bootstrap-static/"), get("/fixtures/")]);
  const finished = fixtures.filter((f) => f.finished).sort((a, b) => Date.parse(b.kickoff_time) - Date.parse(a.kickoff_time));
  const fixture = fixtureId === "latest" ? finished[0] : fixtures.find((f) => f.id === Number(fixtureId));
  if (!fixture?.finished) throw new Error(`fixture ${fixtureId} not found or not finished`);
  const meta = buildMeta(boot, fixture);
  const { stats } = await createFplFeed().result(meta);
  const { points, breakdowns } = computeMatchPoints(RULES[meta.rulesId], meta.players, stats);
  console.log(`Preview: ${meta.name}, ${stats.summary}, ${meta.players.length} players in squads`);
  const top = points.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p).slice(0, 12);
  for (const { p, i } of top) {
    const pl = meta.players[i];
    console.log(`  ${String(p).padStart(4)}  ${pl.name} (${meta.short[pl.side]} ${RULES[meta.rulesId].roles[pl.role]}, ${pl.credits / 10} cr)  ${JSON.stringify(breakdowns[i].breakdown)}`);
  }
}

async function main() {
  if (process.env.PREVIEW_FPL_FIXTURE) return previewFplFixture(process.env.PREVIEW_FPL_FIXTURE);
  const { league } = await contracts(hre);
  const now = (await hre.ethers.provider.getBlock("latest")).timestamp;
  const feeds = { fpl: createFplFeed() };
  const cricket = createCricketFeed({ apiKey: process.env.CRICKETDATA_API_KEY });
  if (cricket) feeds.cricketdata = cricket;
  else console.log("CRICKETDATA_API_KEY not set: skipping international cricket");

  console.log(`Sync at ${new Date(now * 1000).toISOString()}${DRY_RUN ? " (dry run)" : ""}`);
  if (DRY_RUN && process.env.DRY_RUN !== "1") console.log("HEDERA_PRIVATE_KEY is not set, so this is a dry run. Add it as a repo secret to go live.");
  const registry = await loadRegistry(league);
  console.log(`${registry.matches.length} matches on-chain`);

  // 1. Import upcoming fixtures, soonest first
  const hour = new Date(now * 1000).getUTCHours();
  const candidates = [];
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
    candidates.push(...upcoming.filter(({ meta }) => !registry.keys.has(meta.source.key)));
  }
  candidates.sort((a, b) => a.startTime - b.startTime);
  if (candidates.length > MAX_IMPORTS) console.log(`${candidates.length} new fixtures; importing the first ${MAX_IMPORTS} this run`);
  for (const { meta, startTime } of candidates.slice(0, MAX_IMPORTS)) {
    await act(`create ${meta.competition}: ${meta.name} (${meta.players.length} players) at ${meta.kickoff}`, async () => {
      const safeKey = meta.source.key.replace(/[^a-z0-9]+/gi, "-");
      const { matchId } = await createMatchFromMeta(hre, meta, startTime, `data/live/${safeKey}.match.json`);
      console.log(`    -> match #${matchId}`);
    });
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

// On GitHub Actions, also publish the run's log as a notice, which shows on the run page
// and is readable through the API (unlike raw job logs).
const lines = [];
if (process.env.GITHUB_ACTIONS) {
  for (const level of ["log", "warn"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      lines.push(args.join(" "));
      original(...args);
    };
  }
}
const escape = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

main()
  .catch((e) => {
    console.error(e);
    lines.push(`ERROR: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.env.GITHUB_ACTIONS) process.stdout.write(`::notice title=Sync log::${escape(lines.join("\n").slice(-60000))}\n`);
    // Don't let open network handles (HCS gRPC, keep-alive sockets) keep the job running
    setTimeout(() => process.exit(), 1000).unref();
  });

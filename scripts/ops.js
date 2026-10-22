// Operator actions shared by the CLI scripts and the local demo.
const fs = require("fs");
const path = require("path");
const { ROOT, SPORT, scoring, loadMatchData, hashJSON, rulesHash, readDeployments, writeDeployments } = require("./lib");

/**
 * Native-coin units. Contract amounts are in the EVM's native unit: tinybars on Hedera
 * (8 decimals), wei on local chains (18 decimals). Transaction `value` always goes in
 * 18-decimal units, so on Hedera it is the tinybar amount times 10^10.
 */
function units(hre) {
  const hedera = hre.network.name.startsWith("hedera");
  const decimals = hedera ? 8 : 18;
  return {
    symbol: hedera ? "HBAR" : "ETH",
    parse: (amount) => hre.ethers.parseUnits(String(amount), decimals),
    format: (amount) => hre.ethers.formatUnits(amount, decimals),
    txValue: (amount) => (hedera ? BigInt(amount) * 10n ** 10n : BigInt(amount)),
  };
}

// ---------------------------------------------------------------------------
// HCS publishing (only on Hedera networks with HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY set)
// ---------------------------------------------------------------------------

function hederaClient(hre) {
  const { HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY } = process.env;
  if (!hre.network.name.startsWith("hedera") || !HEDERA_ACCOUNT_ID || !HEDERA_PRIVATE_KEY) return null;
  const { Client, PrivateKey } = require("@hashgraph/sdk");
  const key = PrivateKey.fromStringECDSA(HEDERA_PRIVATE_KEY.replace(/^0x/, ""));
  return Client.forTestnet().setOperator(HEDERA_ACCOUNT_ID, key);
}

async function createTopic(client, memo) {
  const { TopicCreateTransaction } = require("@hashgraph/sdk");
  const tx = await new TopicCreateTransaction().setTopicMemo(memo).setSubmitKey(client.operatorPublicKey).execute(client);
  return (await tx.getReceipt(client)).topicId.toString();
}

/** Publish text to HCS and return its ref, or a local file ref when not on Hedera. */
async function publish(hre, text, localFile) {
  const client = hederaClient(hre);
  const topicId = readDeployments()[hre.network.name]?.hcsTopicId;
  if (!client || !topicId) return `file:${localFile}`;
  const { TopicMessageSubmitTransaction } = require("@hashgraph/sdk");
  try {
    const responses = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(text)
      .setMaxChunks(50)
      .executeAll(client);
    const receipt = await responses[0].getReceipt(client);
    return `hcs:${topicId}:${receipt.topicSequenceNumber.toString()}`;
  } finally {
    client.close(); // an open client keeps the process alive
  }
}

/** Load the text behind a ref ("hcs:..." or "file:..."). */
async function loadRef(ref) {
  if (ref.startsWith("file:")) return fs.readFileSync(path.join(ROOT, ref.slice(5)), "utf8");
  const { fetchHcsMessage } = await import("../scoring/hcs.mjs");
  return fetchHcsMessage(ref);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function contracts(hre) {
  const d = readDeployments()[hre.network.name];
  if (!d?.league) throw new Error(`no deployment for ${hre.network.name}; run deploy first`);
  return { league: await hre.ethers.getContractAt("FantasyLeague", d.league) };
}

async function deploy(hre, { disputeWindow }) {
  const [deployer] = await hre.ethers.getSigners();
  const league = await (await hre.ethers.getContractFactory("FantasyLeague")).deploy(deployer.address, disputeWindow);
  await league.waitForDeployment();

  const data = { chainId: Number((await hre.ethers.provider.getNetwork()).chainId), league: league.target, operator: deployer.address };
  const client = hederaClient(hre);
  if (client) {
    try {
      data.hcsTopicId = await createTopic(client, "Hedera Fantasy League - squads and match stats");
    } catch (e) {
      // HCS goes over gRPC to the consensus nodes, which some networks block
      console.warn(`Could not create HCS topic (${e.message}). Squads and stats will be bundled files instead.`);
    } finally {
      client.close();
    }
  }
  writeDeployments(hre.network.name, data, { replace: true });
  return data;
}

/**
 * Pools created for every match, modelled on Dream11's contest types. Amounts are in HBAR.
 * The mega contest is free to enter and its prize pool is funded by the operator (MEGA_POOL,
 * default 10 HBAR). Players can create their own pools in the app on top of these.
 */
const contestTemplates = () => [
  { name: "Mega contest", entryFee: 0, sponsoredPool: Number(process.env.MEGA_POOL || 10), maxEntries: 200, minEntries: 2, maxEntriesPerUser: 6, prize: "top10pct" },
  { name: "Grand pool", entryFee: 2, sponsoredPool: 0, maxEntries: 250, minEntries: 10, maxEntriesPerUser: 6, prize: "top25pct" },
  { name: "Head-to-head", entryFee: 2, sponsoredPool: 0, maxEntries: 2, minEntries: 2, maxEntriesPerUser: 1, prize: "winner" },
  { name: "5-team pool", entryFee: 3, sponsoredPool: 0, maxEntries: 5, minEntries: 3, maxEntriesPerUser: 1, prize: "top2" },
  { name: "10-team pool", entryFee: 2, sponsoredPool: 0, maxEntries: 10, minEntries: 4, maxEntriesPerUser: 2, prize: "top3" },
];

/** Create a match from a bundled data file in data/. */
async function createMatch(hre, dataId, startTime) {
  const { meta } = loadMatchData(dataId);
  return createMatchFromMeta(hre, meta, startTime, `data/${dataId}.match.json`);
}

/**
 * Create a match and its contests. `meta` holds sport, rulesId, name, teams, short and
 * players ({ name, side, role, credits }). It is published to HCS, or written to `localFile`
 * when not on Hedera.
 */
async function createMatchFromMeta(hre, meta, startTime, localFile) {
  const { league } = await contracts(hre);
  const { canonicalJSON } = await scoring();
  const u = units(hre);

  const canonical = canonicalJSON(meta);
  const target = path.join(ROOT, localFile);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(meta, null, 2) + "\n");
  }
  const metadataURI = await publish(hre, canonical, localFile);
  await (
    await league.createMatch(
      SPORT[meta.sport],
      meta.name,
      startTime,
      meta.players.map((p) => ({ side: p.side, role: p.role, credits: p.credits })),
      await rulesHash(meta.rulesId),
      metadataURI,
    )
  ).wait();
  const matchId = await league.matchCount();

  const { prizeBps } = await import("../scoring/prizes.mjs");
  const pools = contestTemplates().map(({ prize, ...t }) => ({
    matchId,
    ...t,
    entryFee: u.parse(t.entryFee),
    sponsoredPool: u.parse(t.sponsoredPool),
    platformFeeBps: 0,
    prizeBps: prizeBps(prize, t.maxEntries),
  }));
  const funding = pools.reduce((a, p) => a + p.sponsoredPool, 0n);
  await (await league.createContests(pools, { value: u.txValue(funding) })).wait();
  return { matchId, metadataURI };
}

/** Post results for a match created from a bundled data file. */
async function postResults(hre, matchId, dataId) {
  const { meta, stats } = loadMatchData(dataId);
  return postResultsFromStats(hre, matchId, meta, stats, `data/${dataId}.stats.json`);
}

/** Compute points from raw stats with the open scoring engine, publish the stats and post. */
async function postResultsFromStats(hre, matchId, meta, stats, localFile) {
  const { league } = await contracts(hre);
  const { RULES, computeMatchPoints, canonicalJSON } = await scoring();

  const m = await league.getMatch(matchId);
  if (m.rulesHash !== (await rulesHash(meta.rulesId))) throw new Error("rules hash mismatch: wrong data file for this match?");

  const canonical = canonicalJSON(stats);
  const { tenths } = computeMatchPoints(RULES[meta.rulesId], meta.players, stats);
  const target = path.join(ROOT, localFile);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(stats, null, 2) + "\n");
  }
  const statsRef = await publish(hre, canonical, localFile);
  await (await league.postResults(matchId, tenths, hashJSON(canonical), statsRef)).wait();
  return { statsRef, tenths };
}

async function rankEntries(league, contestId) {
  const entries = await league.getEntries(contestId);
  const scored = [];
  for (let i = 0; i < entries.length; i++) scored.push({ i, s: await league.scoreOfTeam(entries[i].teamId) });
  return scored.sort((a, b) => (b.s > a.s ? 1 : b.s < a.s ? -1 : a.i - b.i)).map((x) => x.i);
}

async function settleMatch(hre, matchId) {
  const { league } = await contracts(hre);
  const out = [];
  for (const contestId of await league.getContestsOfMatch(matchId)) {
    const c = await league.getContest(contestId);
    if (Number(c.status) !== 0) continue;
    const entries = await league.getEntries(contestId);
    if (entries.length < Number(c.minEntries)) {
      await (await league.cancelContest(contestId)).wait();
      out.push({ contestId, action: "cancelled (under-filled)" });
    } else {
      await (await league.settleContest(contestId, await rankEntries(league, contestId))).wait();
      out.push({ contestId, action: `settled (${entries.length} entries)` });
    }
  }
  return out;
}

module.exports = {
  units,
  contracts,
  deploy,
  createMatch,
  createMatchFromMeta,
  postResults,
  postResultsFromStats,
  settleMatch,
  rankEntries,
  loadRef,
  publish,
};

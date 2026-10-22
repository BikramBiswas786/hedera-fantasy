// Operator actions shared by the CLI scripts and the local demo.
const fs = require("fs");
const path = require("path");
const { ROOT, SPORT, scoring, loadMatchData, hashJSON, rulesHash, readDeployments, writeDeployments } = require("./lib");

const E = (hre, n) => hre.ethers.parseEther(String(n));

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
  const responses = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(text)
    .setMaxChunks(50)
    .executeAll(client);
  const receipt = await responses[0].getReceipt(client);
  return `hcs:${topicId}:${receipt.topicSequenceNumber.toString()}`;
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
  return {
    fan: await hre.ethers.getContractAt("FanToken", d.fan),
    league: await hre.ethers.getContractAt("FantasyLeague", d.league),
  };
}

async function deploy(hre, { disputeWindow }) {
  const [deployer] = await hre.ethers.getSigners();
  const fan = await (await hre.ethers.getContractFactory("FanToken")).deploy();
  await fan.waitForDeployment();
  const league = await (await hre.ethers.getContractFactory("FantasyLeague")).deploy(fan.target, deployer.address, disputeWindow);
  await league.waitForDeployment();

  const data = { chainId: Number((await hre.ethers.provider.getNetwork()).chainId), fan: fan.target, league: league.target };
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
  writeDeployments(hre.network.name, data);
  return data;
}

/** Contest templates created for every match, modelled on Dream11's common contest types. */
const CONTEST_TEMPLATES = [
  // Mega contest: free entry, sponsored prize pool
  { entryFee: 0, sponsoredPool: 10_000, maxEntries: 200, minEntries: 2, maxEntriesPerUser: 6, prizeBps: [4000, 2000, 1200, 800, 600, 500, 400, 300, 200] },
  // Head-to-head
  { entryFee: 50, sponsoredPool: 0, maxEntries: 2, minEntries: 2, maxEntriesPerUser: 1, prizeBps: [10000] },
  // Small league
  { entryFee: 25, sponsoredPool: 0, maxEntries: 10, minEntries: 3, maxEntriesPerUser: 2, prizeBps: [5000, 3000, 2000] },
];

async function createMatch(hre, dataId, startTime) {
  const { fan, league } = await contracts(hre);
  const [operator] = await hre.ethers.getSigners();
  const { meta } = loadMatchData(dataId);
  const { canonicalJSON } = await scoring();

  const metadataURI = await publish(hre, canonicalJSON(meta), `data/${dataId}.match.json`);
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

  const sponsored = CONTEST_TEMPLATES.reduce((a, t) => a + t.sponsoredPool, 0);
  await (await fan.mint(operator.address, E(hre, sponsored))).wait();
  await (await fan.approve(league.target, E(hre, sponsored))).wait();
  for (const t of CONTEST_TEMPLATES) {
    await (
      await league.createContest({
        matchId,
        ...t,
        entryFee: E(hre, t.entryFee),
        sponsoredPool: E(hre, t.sponsoredPool),
        platformFeeBps: 0,
      })
    ).wait();
  }
  return { matchId, metadataURI };
}

async function postResults(hre, matchId, dataId) {
  const { league } = await contracts(hre);
  const { meta, stats } = loadMatchData(dataId);
  const { RULES, computeMatchPoints, canonicalJSON } = await scoring();

  const m = await league.getMatch(matchId);
  if (m.rulesHash !== (await rulesHash(meta.rulesId))) throw new Error("rules hash mismatch: wrong data file for this match?");

  const canonical = canonicalJSON(stats);
  const { tenths } = computeMatchPoints(RULES[meta.rulesId], meta.players, stats);
  const statsRef = await publish(hre, canonical, `data/${dataId}.stats.json`);
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

module.exports = { contracts, deploy, createMatch, postResults, settleMatch, rankEntries, loadRef, publish };

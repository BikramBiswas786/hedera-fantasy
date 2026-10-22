// Unattended match finisher: waits for each demo match to start, posts its results,
// waits out the dispute window, then settles every contest. Safe to re-run.
// npx hardhat run scripts/finish-matches.js --network hederaTestnet
const hre = require("hardhat");
const { contracts, postResults, settleMatch } = require("./ops");

const DATA_BY_NAME = { "MUM vs SYD - T20 (demo)": "cricket-demo", "KOL vs MAD - League (demo)": "football-demo" };
const POLL_MS = Number(process.env.POLL_MS || 30_000);

const chainNow = async () => (await hre.ethers.provider.getBlock("latest")).timestamp;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(ts, label) {
  for (let now = await chainNow(); now < ts; now = await chainNow()) {
    console.log(`${label}: ${Math.ceil((ts - now) / 60)} min to go`);
    await sleep(POLL_MS);
  }
}

async function main() {
  const { league } = await contracts(hre);
  const count = Number(await league.matchCount());
  const window = Number(await league.disputeWindow());

  for (let id = 1; id <= count; id++) {
    const m = await league.getMatch(id);
    const dataId = DATA_BY_NAME[m.name];
    if (Number(m.status) !== 0 || !dataId) continue;
    await waitUntil(Number(m.startTime) + 5, `Match #${id} start`);
    const { statsRef } = await postResults(hre, id, dataId);
    console.log(`Match #${id}: results posted (${statsRef})`);
  }

  for (let id = 1; id <= count; id++) {
    const m = await league.getMatch(id);
    if (Number(m.status) !== 1) continue;
    await waitUntil(Number(m.resultsPostedAt) + window + 5, `Match #${id} dispute window`);
    for (const r of await settleMatch(hre, id)) console.log(`Match #${id} contest #${r.contestId}: ${r.action}`);
  }
  console.log("All matches finished. Winners can press Claim in the app.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

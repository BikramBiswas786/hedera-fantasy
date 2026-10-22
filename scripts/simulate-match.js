// Local network only: fast-forwards time past kickoff, posts results for every match and settles.
// npx hardhat run scripts/simulate-match.js --network localhost
const hre = require("hardhat");
const { contracts, postResults, settleMatch } = require("./ops");

const DATA_BY_NAME = { "MUM vs SYD - T20 (demo)": "cricket-demo", "KOL vs MAD - League (demo)": "football-demo" };

async function advanceTo(timestamp) {
  const now = (await hre.ethers.provider.getBlock("latest")).timestamp;
  if (timestamp > now) {
    await hre.network.provider.send("evm_increaseTime", [timestamp - now]);
    await hre.network.provider.send("evm_mine");
  }
}

async function main() {
  if (!["localhost", "hardhat"].includes(hre.network.name)) throw new Error("local networks only");
  const { league } = await contracts(hre);
  const count = Number(await league.matchCount());

  for (let id = 1; id <= count; id++) {
    const m = await league.getMatch(id);
    if (Number(m.status) !== 0 || !DATA_BY_NAME[m.name]) continue;
    await advanceTo(Number(m.startTime) + 1);
    await postResults(hre, id, DATA_BY_NAME[m.name]);
    console.log(`Match #${id}: results posted`);
  }

  await advanceTo((await hre.ethers.provider.getBlock("latest")).timestamp + Number(await league.disputeWindow()) + 1);
  for (let id = 1; id <= count; id++) {
    if (Number((await league.getMatch(id)).status) !== 1) continue;
    for (const r of await settleMatch(hre, id)) console.log(`Match #${id} contest #${r.contestId}: ${r.action}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

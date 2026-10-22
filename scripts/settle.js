// MATCH_ID=1 npx hardhat run scripts/settle.js --network hederaTestnet
// Anyone can run this once the dispute window has passed.
const hre = require("hardhat");
const { settleMatch } = require("./ops");

async function main() {
  for (const r of await settleMatch(hre, Number(process.env.MATCH_ID))) console.log(`Contest #${r.contestId}: ${r.action}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

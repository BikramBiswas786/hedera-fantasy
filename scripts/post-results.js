// MATCH=cricket-demo MATCH_ID=1 npx hardhat run scripts/post-results.js --network hederaTestnet
// Publishes the raw stats to HCS, computes points with the open scoring engine and posts them.
const hre = require("hardhat");
const { postResults } = require("./ops");

async function main() {
  const { statsRef, tenths } = await postResults(hre, Number(process.env.MATCH_ID), process.env.MATCH || "cricket-demo");
  console.log(`Results posted. Raw stats: ${statsRef}`);
  console.log(`Points: ${tenths.map((t) => t / 10).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

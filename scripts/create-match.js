// MATCH=cricket-demo START_IN_MINUTES=120 npx hardhat run scripts/create-match.js --network hederaTestnet
const hre = require("hardhat");
const { createMatch } = require("./ops");

async function main() {
  const dataId = process.env.MATCH || "cricket-demo";
  const block = await hre.ethers.provider.getBlock("latest");
  const startTime = block.timestamp + Number(process.env.START_IN_MINUTES || 120) * 60;
  const { matchId, metadataURI } = await createMatch(hre, dataId, startTime);
  console.log(`Match #${matchId} (${dataId}) starts at ${new Date(startTime * 1000).toISOString()}`);
  console.log(`Squad metadata: ${metadataURI}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

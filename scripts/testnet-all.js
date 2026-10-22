// One command for a fresh testnet setup: deploy, then create the cricket and football demo matches.
// npx hardhat run scripts/testnet-all.js --network hederaTestnet
const hre = require("hardhat");
const { deploy, createMatch } = require("./ops");
const { readDeployments } = require("./lib");

async function main() {
  const d = await deploy(hre, { disputeWindow: Number(process.env.DISPUTE_WINDOW || 1800) });
  console.log("Deployed:", d);
  const now = (await hre.ethers.provider.getBlock("latest")).timestamp;
  const startIn = Number(process.env.START_IN_MINUTES || 120) * 60;
  for (const id of ["cricket-demo", "football-demo"]) {
    const { matchId, metadataURI } = await createMatch(hre, id, now + startIn);
    console.log(`Match #${matchId} ${id}: squad at ${metadataURI}`);
  }
  const final = readDeployments()[hre.network.name];
  const scan = "https://hashscan.io/testnet";
  console.log(`\nFantasyLeague: ${scan}/contract/${final.league}`);
  console.log(`FanToken:      ${scan}/contract/${final.fan}`);
  if (final.hcsTopicId) console.log(`HCS topic:     ${scan}/topic/${final.hcsTopicId}`);
  console.log("\nNext: npm run app, choose Hedera Testnet, connect MetaMask.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

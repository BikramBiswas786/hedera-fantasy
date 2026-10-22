// npx hardhat run scripts/deploy.js --network hederaTestnet
const hre = require("hardhat");
const { deploy } = require("./ops");

async function main() {
  const disputeWindow = Number(process.env.DISPUTE_WINDOW || 1800);
  const d = await deploy(hre, { disputeWindow });
  console.log(`Deployed to ${hre.network.name}:`, d);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

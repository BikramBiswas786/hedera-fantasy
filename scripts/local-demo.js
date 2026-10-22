// Full local setup for trying the app without Hedera:
//   npx hardhat node                                   (terminal 1)
//   npx hardhat run scripts/local-demo.js --network localhost
// Deploys, creates a cricket and a football match, and gives a few dev accounts teams and entries.
const hre = require("hardhat");
const { autoPickTeam, readDeployments } = require("./lib");
const { deploy, createMatch, contracts } = require("./ops");

async function main() {
  await deploy(hre, { disputeWindow: 120 });
  const { fan, league } = await contracts(hre);
  const signers = (await hre.ethers.getSigners()).slice(1, 6);
  const now = (await hre.ethers.provider.getBlock("latest")).timestamp;

  for (const [dataId, sport] of [["cricket-demo", "cricket"], ["football-demo", "football"]]) {
    const { matchId } = await createMatch(hre, dataId, now + 3 * 3600);
    const players = (await league.getPlayers(matchId)).map((p) => ({ side: Number(p.side), role: Number(p.role), credits: Number(p.credits) }));
    const contestIds = await league.getContestsOfMatch(matchId);

    for (const [k, user] of signers.entries()) {
      if ((await fan.balanceOf(user.address)) === 0n) await (await fan.connect(user).claimFaucet()).wait();
      await (await fan.connect(user).approve(league.target, hre.ethers.MaxUint256)).wait();
      const t = autoPickTeam(players, sport, k * 3);
      await (await league.connect(user).createTeam(matchId, t.picks, t.captain, t.viceCaptain)).wait();
      const teamId = await league.teamCount();
      await (await league.connect(user).joinContest(contestIds[0], teamId)).wait(); // mega
      if (k < 3) await (await league.connect(user).joinContest(contestIds[2], teamId)).wait(); // small league
    }
    console.log(`Match #${matchId} ${dataId}: ${signers.length} teams joined`);
  }
  console.log("Deployment:", readDeployments()[hre.network.name]);
  console.log("\nStart the app: cd app && npm run dev");
  console.log("Then, to finish the matches: npx hardhat run scripts/simulate-match.js --network localhost");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

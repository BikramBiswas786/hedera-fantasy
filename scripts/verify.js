// Independent audit of a match. Anyone can run it; it only reads public data.
// MATCH_ID=1 npx hardhat run scripts/verify.js --network hederaTestnet
//
// Checks:
//  1. the scoring rules hash on-chain matches the open-source rules
//  2. the squad metadata (names, roles, credits) matches the on-chain squad
//  3. the raw stats published on HCS hash to the on-chain statsHash
//  4. recomputing every player's points from those stats gives the on-chain points
//  5. every settled contest's ranks and prizes match a fresh recomputation
const hre = require("hardhat");
const { scoring, hashJSON } = require("./lib");
const { contracts, loadRef } = require("./ops");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  const matchId = Number(process.env.MATCH_ID);
  const { league } = await contracts(hre);
  const { RULES, canonicalJSON, computeMatchPoints } = await scoring();

  const m = await league.getMatch(matchId);
  const squad = await league.getPlayers(matchId);
  console.log(`Match #${matchId}: ${m.name}\n`);

  const meta = JSON.parse(await loadRef(m.metadataURI));
  const rules = RULES[meta.rulesId];
  check(!!rules && hashJSON(canonicalJSON(rules)) === m.rulesHash, "scoring rules hash", meta.rulesId);
  const squadOk =
    meta.players.length === squad.length &&
    meta.players.every((p, i) => p.side === Number(squad[i].side) && p.role === Number(squad[i].role) && p.credits === Number(squad[i].credits));
  check(squadOk, "squad metadata matches on-chain squad", m.metadataURI);

  if (Number(m.status) !== 1) {
    console.log("\nNo results posted yet.");
    return;
  }

  const statsText = await loadRef(m.statsRef);
  const stats = JSON.parse(statsText);
  check(hashJSON(canonicalJSON(stats)) === m.statsHash, "raw stats hash", m.statsRef);

  const onChain = (await league.getPoints(matchId)).map(Number);
  const { tenths } = computeMatchPoints(rules, meta.players, stats);
  const wrong = tenths.map((t, i) => (t !== onChain[i] ? i : -1)).filter((i) => i >= 0);
  check(wrong.length === 0, "player points recomputed from raw stats", wrong.length ? `mismatch: ${wrong.map((i) => meta.players[i].name).join(", ")}` : `${tenths.length} players`);

  for (const contestId of await league.getContestsOfMatch(matchId)) {
    const c = await league.getContest(contestId);
    if (Number(c.status) !== 1) continue;
    const entries = await league.getEntries(contestId);
    const scores = await Promise.all(entries.map((e) => league.scoreOfTeam(e.teamId)));
    const events = await league.queryFilter(league.filters.EntryRanked(contestId));
    const ranksOk = events.every((ev) => {
      const { entryIndex, rank, score } = ev.args;
      const better = scores.filter((s) => s > scores[Number(entryIndex)]).length;
      return score === scores[Number(entryIndex)] && Number(rank) === better + 1;
    });
    check(events.length === entries.length && ranksOk, `contest #${contestId} ranking`, `${entries.length} entries`);
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

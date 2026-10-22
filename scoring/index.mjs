// Open-source fantasy points engine. The oracle, the CLI verifier and the web app all use
// this exact code, so anyone can recompute a match's points from the raw stats and compare
// them with what was posted on-chain.

export { RULES, CRICKET_T20_V1, CRICKET_ODI_V1, FOOTBALL_V1, FOOTBALL_EPL_V1 } from "./rules.mjs";

/** Deterministic JSON: object keys sorted, no whitespace. Hashed for rulesHash / statsHash. */
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function bandPoints(bands, value) {
  for (const b of bands) {
    if (b.below !== undefined && value < b.below) return b.points;
    if (b.above !== undefined && value > b.above) return b.points;
    if (b.atLeast !== undefined && value >= b.atLeast) return b.points;
    if (b.atMost !== undefined && value <= b.atMost) return b.points;
  }
  return 0;
}

function firstMatch(list, value, key) {
  const hit = list.find((m) => value >= m[key]);
  return hit ? hit.points : 0;
}

/** Points breakdown for one cricket player. `role` is the role name, e.g. "BOWL". */
export function cricketPlayerPoints(rules, role, s = {}) {
  const b = {};
  if (!s.played) return { total: 0, breakdown: b };
  b.playingXI = rules.playingXI;

  const runs = s.runs || 0;
  const balls = s.balls || 0;
  b.runs = runs * rules.batting.run;
  b.fours = (s.fours || 0) * rules.batting.fourBonus;
  b.sixes = (s.sixes || 0) * rules.batting.sixBonus;
  b.milestone = firstMatch(rules.batting.milestones, runs, "runs");
  if (s.out && runs === 0 && role !== "BOWL") b.duck = rules.batting.duck;
  if (balls >= rules.strikeRate.minBalls && role !== "BOWL") {
    b.strikeRate = bandPoints(rules.strikeRate.bands, (runs * 100) / balls);
  }

  const wickets = s.wickets || 0;
  b.wickets = wickets * rules.bowling.wicket;
  b.lbwBowled = (s.lbwBowled || 0) * rules.bowling.lbwBowledBonus;
  b.haul = firstMatch(rules.bowling.hauls, wickets, "wickets");
  b.dots = (s.dots || 0) * rules.bowling.dotBall;
  b.maidens = (s.maidens || 0) * rules.bowling.maiden;
  const ballsBowled = s.ballsBowled || 0;
  if (ballsBowled >= rules.economy.minBalls) {
    b.economy = bandPoints(rules.economy.bands, ((s.runsConceded || 0) * 6) / ballsBowled);
  }

  const catches = s.catches || 0;
  b.catches = catches * rules.fielding.catch;
  if (catches >= 3) b.threeCatchBonus = rules.fielding.threeCatchBonus;
  b.stumpings = (s.stumpings || 0) * rules.fielding.stumping;
  b.runOutDirect = (s.runOutDirect || 0) * rules.fielding.runOutDirect;
  b.runOutIndirect = (s.runOutIndirect || 0) * rules.fielding.runOutIndirect;

  return { total: sum(b), breakdown: prune(b) };
}

/** Points breakdown for one football player. `role` is the role name, e.g. "MID". */
export function footballPlayerPoints(rules, role, s = {}) {
  const b = {};
  if (!s.started && !s.subbedOn) return { total: 0, breakdown: b };
  b.appearance = s.started ? rules.starting11 : rules.substitute;
  b.goals = (s.goals || 0) * rules.goal[role];
  b.assists = (s.assists || 0) * rules.assist;
  // Rule sets only score the stats their data feed provides; a missing rule scores 0.
  b.shotsOnTarget = (s.shotsOnTarget || 0) * (rules.shotOnTarget ?? 0);
  b.chancesCreated = (s.chancesCreated || 0) * (rules.chanceCreated ?? 0);
  b.passes = Math.floor((s.passes || 0) / 5) * (rules.per5Passes ?? 0);
  b.tackles = (s.tackles || 0) * (rules.tackleWon ?? 0);
  b.interceptions = (s.interceptions || 0) * (rules.interceptionWon ?? 0);
  b.clearancesBlocksInterceptions = (s.cbi || 0) * (rules.cbi ?? 0);
  if (role === "GK") b.saves = (s.saves || 0) * rules.save;
  b.penaltySaved = (s.penaltiesSaved || 0) * rules.penaltySaved;
  b.penaltyMissed = (s.penaltiesMissed || 0) * rules.penaltyMissed;
  const conceded = s.goalsConceded || 0;
  if (rules.cleanSheet[role] && conceded === 0 && (s.minutes || 0) >= rules.cleanSheet.minMinutes) {
    b.cleanSheet = rules.cleanSheet[role];
  }
  if (rules.goalConceded[role]) b.goalsConceded = conceded * rules.goalConceded[role];
  b.yellowCards = (s.yellowCards || 0) * rules.yellowCard;
  b.redCards = (s.redCards || 0) * rules.redCard;
  b.ownGoals = (s.ownGoals || 0) * rules.ownGoal;
  return { total: sum(b), breakdown: prune(b) };
}

/**
 * Compute every player's points for a match.
 * @param rules   a rules object from rules.mjs
 * @param squad   [{ role: 0..3, ... }] in on-chain player order
 * @param stats   { players: { [playerIndex]: rawStats } }
 * @returns       { points: number[] (whole points), tenths: number[] (as posted on-chain), breakdowns }
 */
export function computeMatchPoints(rules, squad, stats) {
  const fn = rules.sport === "cricket" ? cricketPlayerPoints : footballPlayerPoints;
  const breakdowns = squad.map((p, i) => fn(rules, rules.roles[Number(p.role)], stats.players[i]));
  const points = breakdowns.map((r) => r.total);
  return { points, tenths: points.map((p) => Math.round(p * 10)), breakdowns };
}

/** Team score in points with captain 2x and vice-captain 1.5x, matching the contract. */
export function teamScore(points, picks, captain, viceCaptain) {
  return picks.reduce((acc, idx) => {
    const mult = idx === captain ? 2 : idx === viceCaptain ? 1.5 : 1;
    return acc + points[idx] * mult;
  }, 0);
}

function sum(obj) {
  return Object.values(obj).reduce((a, v) => a + v, 0);
}

function prune(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== 0));
}

// Fantasy scoring rules. Each match stores keccak256(canonicalJSON(rules)) on-chain as
// `rulesHash`, so the rules used to score a match can never be swapped afterwards.
// Values follow the Dream11-style T20 / football tables. Change them by publishing a new
// version (new id), never by editing an existing one.

export const CRICKET_T20_V1 = {
  id: "cricket-t20-v1",
  sport: "cricket",
  roles: ["WK", "BAT", "AR", "BOWL"],
  playingXI: 4,
  batting: {
    run: 1,
    fourBonus: 4,
    sixBonus: 6,
    // only the highest milestone reached is awarded
    milestones: [
      { runs: 100, points: 16 },
      { runs: 75, points: 12 },
      { runs: 50, points: 8 },
      { runs: 25, points: 4 },
    ],
    duck: -2, // not applied to bowlers
  },
  bowling: {
    wicket: 30, // excluding run-outs
    lbwBowledBonus: 8,
    dotBall: 1,
    maiden: 12,
    // only the highest haul bonus is awarded
    hauls: [
      { wickets: 5, points: 12 },
      { wickets: 4, points: 8 },
      { wickets: 3, points: 4 },
    ],
  },
  fielding: {
    catch: 8,
    threeCatchBonus: 4,
    stumping: 12,
    runOutDirect: 12,
    runOutIndirect: 6,
  },
  // economy rate in runs per over, minimum 2 overs bowled
  economy: {
    minBalls: 12,
    bands: [
      { below: 5, points: 6 },
      { below: 6, points: 4 },
      { below: 7.01, points: 2 },
      { above: 12, points: -6 },
      { above: 11, points: -4 },
      { atLeast: 10, points: -2 },
    ],
  },
  // strike rate, minimum 10 balls faced, not applied to bowlers
  strikeRate: {
    minBalls: 10,
    bands: [
      { above: 170, points: 6 },
      { above: 150, points: 4 },
      { atLeast: 130, points: 2 },
      { below: 50, points: -6 },
      { below: 60, points: -4 },
      { atMost: 70, points: -2 },
    ],
  },
};

export const FOOTBALL_V1 = {
  id: "football-v1",
  sport: "football",
  roles: ["GK", "DEF", "MID", "FWD"],
  starting11: 4,
  substitute: 2,
  goal: { GK: 60, DEF: 60, MID: 50, FWD: 40 },
  assist: 20,
  shotOnTarget: 6,
  chanceCreated: 3,
  per5Passes: 1,
  tackleWon: 4,
  interceptionWon: 4,
  save: 6, // GK only
  penaltySaved: 50,
  penaltyMissed: -20,
  cleanSheet: { GK: 20, DEF: 20, minMinutes: 55 },
  goalConceded: { GK: -2, DEF: -2 },
  yellowCard: -4,
  redCard: -10,
  ownGoal: -8,
};

export const RULES = {
  [CRICKET_T20_V1.id]: CRICKET_T20_V1,
  [FOOTBALL_V1.id]: FOOTBALL_V1,
};

import { teamScore } from "../../../scoring/index.mjs";

export const teamScoreOf = (points, team) => teamScore(points, team.picks, team.captain, team.viceCaptain);

/** Contract scores are in hundredths of a point. */
export const fmtScore = (hundredths) => Number(hundredths) / 100;

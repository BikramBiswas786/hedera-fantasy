import { ROLES } from "../chain.js";
import { teamScoreOf } from "./score.js";

/** Pitch-style team view, grouped by role, with points once results are posted. */
export default function TeamPreview({ data, team, title }) {
  const { players, sport, meta, points } = data;
  const roles = ROLES[sport];
  const rows = sport === "football" ? [3, 2, 1, 0] : [0, 1, 2, 3];
  const total = points ? teamScoreOf(points, team) : null;

  return (
    <div className={`pitch ${sport}`}>
      <div className="row between pitch-title">
        <span>{title || "Team preview"}</span>
        {total !== null && <strong>{total} pts</strong>}
      </div>
      {rows.map((r) => (
        <div key={r} className="pitch-row">
          <div className="pitch-label">{roles[r].label}</div>
          <div className="pitch-players">
            {team.picks
              .filter((i) => players[i].role === r)
              .map((i) => {
                const mult = i === team.captain ? 2 : i === team.viceCaptain ? 1.5 : 1;
                return (
                  <div key={i} className="pitch-player">
                    <span className={`crest c${players[i].side}`}>{meta.short[players[i].side]}</span>
                    {i === team.captain && <span className="badge">C</span>}
                    {i === team.viceCaptain && <span className="badge">VC</span>}
                    <span className="pname">{players[i].name.split(" ").slice(-1)[0]}</span>
                    <span className="ppts">{points ? `${points[i] * mult} pts` : `${players[i].credits / 10} cr`}</span>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

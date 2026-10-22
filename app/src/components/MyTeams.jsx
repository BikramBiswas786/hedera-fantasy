import { useState } from "react";
import { ROLES } from "../chain.js";
import TeamPreview from "./TeamPreview.jsx";
import { teamScoreOf } from "./score.js";

export default function MyTeams({ ctx, data, open, teams, edit, create }) {
  const [preview, setPreview] = useState(null);
  const { players, sport, points } = data;

  if (!ctx.account) return <div className="empty">Connect a wallet to see your teams.</div>;
  if (teams.length === 0) {
    return (
      <div className="empty">
        <p>You have no teams for this match.</p>
        {open && (
          <button className="btn primary" onClick={create}>
            Create team
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="grid">
        {teams.map((t) => {
          const joined = data.contests.filter((c) => c.entries.some((e) => Number(e.teamId) === t.id)).length;
          return (
            <div key={t.id} className="card team-card">
              <div className="row between">
                <strong>Team #{t.id}</strong>
                {points ? <strong>{teamScoreOf(points, t)} pts</strong> : <span className="muted small">{joined} contest(s)</span>}
              </div>
              <div className="row gap small">
                <span className="chip">C · {players[t.captain].name}</span>
                <span className="chip">VC · {players[t.viceCaptain].name}</span>
              </div>
              <div className="row gap small muted">
                {ROLES[sport].map((r, k) => (
                  <span key={r.key}>
                    {r.key} {t.picks.filter((i) => players[i].role === k).length}
                  </span>
                ))}
              </div>
              <div className="row gap">
                <button className="btn ghost" onClick={() => setPreview(t)}>
                  Preview
                </button>
                {open && (
                  <button className="btn ghost" onClick={() => edit(t)}>
                    Edit
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {open && teams.length < 20 && (
        <button className="btn primary" onClick={create}>
          + Create another team
        </button>
      )}
      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
            <TeamPreview data={data} team={preview} title={`Team #${preview.id}`} />
          </div>
        </div>
      )}
    </div>
  );
}

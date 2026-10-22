import { useState } from "react";
import { contestKind, maxPool, contestPool, sameAddr } from "../data.js";

const STATUS = ["Open", "Settled", "Cancelled"];

export default function Contests({ ctx, data, open, myTeams, createTeam, viewBoard }) {
  const [joining, setJoining] = useState(null);

  return (
    <div className="grid">
      {data.contests.map((c) => {
        const filled = c.entries.length;
        const spotsLeft = Number(c.maxEntries) - filled;
        const pool = Number(c.status) === 0 ? maxPool(c) : contestPool(c, filled);
        const winners = c.prizeBps.length;
        const mine = c.entries.filter((e) => sameAddr(e.user, ctx.account)).length;
        const guaranteed = Number(c.minEntries) <= 2;
        return (
          <div key={c.id} className="card contest">
            <div className="row between">
              <span className="muted">{contestKind(c)}</span>
              <span className="muted small">#{c.id} · {STATUS[Number(c.status)]}</span>
            </div>
            <div className="row between baseline">
              <div>
                <div className="muted small">Prize pool</div>
                <div className="pool">{ctx.coin.format(pool)}</div>
              </div>
              <div className="right">
                <div className="muted small">Entry</div>
                <div className="fee">{c.entryFee === 0n ? "FREE" : ctx.coin.format(c.entryFee)}</div>
              </div>
            </div>
            <div className="bar">
              <div style={{ width: `${(filled / Number(c.maxEntries)) * 100}%` }} />
            </div>
            <div className="row between small">
              <span className="accent">{spotsLeft > 0 ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left` : "Contest full"}</span>
              <span className="muted">{Number(c.maxEntries)} spots</span>
            </div>
            <div className="row between small muted footer-row">
              <span>🥇 {ctx.coin.format((pool * BigInt(c.prizeBps[0])) / 10000n)}</span>
              <span>🏆 {Math.round((winners / Number(c.maxEntries)) * 100)}% win</span>
              <span>{Number(c.maxEntriesPerUser) === 1 ? "Single entry" : `Up to ${Number(c.maxEntriesPerUser)} teams`}</span>
              <span title="Refunded automatically below this many entries">{guaranteed ? "✓ Guaranteed" : `Min ${Number(c.minEntries)}`}</span>
            </div>
            <details className="small">
              <summary>Prize breakdown</summary>
              <table className="mini">
                <tbody>
                  {c.prizeBps.map((bps, r) => (
                    <tr key={r}>
                      <td>Rank {r + 1}</td>
                      <td className="right">{ctx.coin.format((pool * BigInt(bps)) / 10000n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            <div className="row gap">
              {open && Number(c.status) === 0 && spotsLeft > 0 && mine < Number(c.maxEntriesPerUser) && (
                <button className="btn primary" onClick={() => setJoining(c)}>
                  Join{mine ? ` (${mine} joined)` : ""}
                </button>
              )}
              {open && mine > 0 && mine >= Number(c.maxEntriesPerUser) && <span className="chip">Joined</span>}
              <button className="btn ghost" onClick={() => viewBoard(c.id)}>
                Leaderboard
              </button>
            </div>
          </div>
        );
      })}
      {joining && (
        <JoinDialog ctx={ctx} data={data} contest={joining} myTeams={myTeams} createTeam={createTeam} close={() => setJoining(null)} />
      )}
    </div>
  );
}

function JoinDialog({ ctx, data, contest, myTeams, createTeam, close }) {
  const available = myTeams.filter((t) => !contest.entries.some((e) => Number(e.teamId) === t.id));
  const [teamId, setTeamId] = useState(available[0]?.id || null);
  const name = (i) => data.players[i].name;

  const join = async () => {
    const value = ctx.coin.txValue(contest.entryFee);
    const ok = await ctx.tx("Join contest", (w) => w.league.joinContest(contest.id, teamId, { value }));
    if (ok) close();
  };

  return (
    <div className="modal" onClick={close}>
      <div className="card dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Join {contestKind(contest)}</h3>
        {!ctx.account ? (
          <p>Connect a wallet first.</p>
        ) : available.length === 0 ? (
          <>
            <p>You have no team available for this contest.</p>
            <button className="btn primary" onClick={createTeam}>
              Create a team
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Entry: {contest.entryFee === 0n ? "free" : ctx.coin.format(contest.entryFee)}. Your team stays editable until the deadline.
            </p>
            {available.map((t) => (
              <label key={t.id} className="radio">
                <input type="radio" checked={teamId === t.id} onChange={() => setTeamId(t.id)} />
                Team #{t.id} · C: {name(t.captain)} · VC: {name(t.viceCaptain)}
              </label>
            ))}
            <div className="row gap">
              <button className="btn primary" onClick={join} disabled={!teamId}>
                Confirm
              </button>
              <button className="btn ghost" onClick={close}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

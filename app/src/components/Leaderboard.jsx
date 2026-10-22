import { useState } from "react";
import { shortAddr, computePrizes } from "../chain.js";
import { contestKind, contestPool, sameAddr } from "../data.js";
import TeamPreview from "./TeamPreview.jsx";
import { fmtScore } from "./score.js";

export default function Leaderboard({ ctx, data, contestId, setContestId }) {
  const [preview, setPreview] = useState(null);
  const c = data.contests.find((x) => x.id === contestId) || data.contests[0];
  if (!c) return <div className="empty">No contests for this match.</div>;

  const status = Number(c.status);
  const scores = c.scores;
  const prizes = scores && status !== 2 ? computePrizes(scores, c.prizeBps, contestPool(c, c.entries.length)) : null;
  const rows = c.entries.map((e, i) => ({ i, e, score: scores?.[i], ...(prizes?.[i] || {}) }));
  if (prizes) rows.sort((a, b) => a.rank - b.rank || a.i - b.i);

  return (
    <div>
      <div className="row gap wrap">
        {data.contests.map((x) => (
          <button key={x.id} className={x.id === c.id ? "tab active" : "tab"} onClick={() => setContestId(x.id)}>
            #{x.id} {contestKind(x)}
          </button>
        ))}
      </div>
      <p className="muted small">
        {status === 1
          ? "Settled on-chain. The contract recomputed every score and checked this ranking before paying out."
          : status === 2
            ? "Cancelled. All entry fees were refunded."
            : scores
              ? "Projected standings from the posted points. Winnings are paid when the contest is settled."
              : "Every entry and team is public on-chain. Points appear once results are posted."}
      </p>
      {rows.length === 0 ? (
        <div className="empty">No entries yet.</div>
      ) : (
        <table className="board">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Team</th>
              <th className="right">Points</th>
              <th className="right">{status === 1 ? "Won" : "Prize"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const team = data.teams[Number(r.e.teamId)];
              return (
                <tr key={r.i} className={sameAddr(r.e.user, ctx.account) ? "me" : ""} onClick={() => team && setPreview(team)}>
                  <td>{r.rank || "–"}</td>
                  <td>
                    {shortAddr(r.e.user)}
                    {sameAddr(r.e.user, ctx.account) && <span className="chip tiny">you</span>}
                  </td>
                  <td className="link">#{Number(r.e.teamId)}</td>
                  <td className="right">{r.score !== undefined ? fmtScore(r.score) : "–"}</td>
                  <td className="right">{r.prize ? ctx.coin.format(r.prize) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {status === 0 && data.points && Number(data.m.resultsPostedAt) + data.disputeWindow <= ctx.chainNow() && (
        <SettleButton ctx={ctx} contest={c} />
      )}
      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
            <TeamPreview data={data} team={preview} title={`Team #${preview.id} · ${shortAddr(preview.owner)}`} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Anyone can settle: the ranking is computed here and verified by the contract. */
function SettleButton({ ctx, contest }) {
  const under = contest.entries.length < Number(contest.minEntries);
  const run = () => {
    if (under) return ctx.tx("Cancel contest", (w) => w.league.cancelContest(contest.id));
    const ranking = contest.scores
      .map((s, i) => ({ s, i }))
      .sort((a, b) => (b.s > a.s ? 1 : b.s < a.s ? -1 : a.i - b.i))
      .map((x) => x.i);
    return ctx.tx("Settle contest", (w) => w.league.settleContest(contest.id, ranking));
  };
  return (
    <div className="card note">
      <span>Results are final. Anyone can trigger the payout.</span>
      <button className="btn primary" disabled={!ctx.account} onClick={run}>
        {under ? "Cancel & refund (under-filled)" : "Settle contest"}
      </button>
    </div>
  );
}

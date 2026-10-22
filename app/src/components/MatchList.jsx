import { useEffect, useState } from "react";
import { SPORTS, fmtFan } from "../chain.js";
import { loadMeta, matchPhase, countdown, maxPool } from "../data.js";
import { useTicker } from "./hooks.js";

export default function MatchList({ ctx, open }) {
  const [matches, setMatches] = useState(null);
  const [sport, setSport] = useState("all");
  const [error, setError] = useState(null);
  useTicker();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      const { league } = ctx.read;
      const [count, disputeWindow] = await Promise.all([league.matchCount(), league.disputeWindow()]);
      const ids = Array.from({ length: Number(count) }, (_, i) => Number(count) - i);
      const list = await Promise.all(
        ids.map(async (id) => {
          const [m, contestIds] = await Promise.all([league.getMatch(id), league.getContestsOfMatch(id)]);
          const meta = await loadMeta(m.metadataURI).catch(() => null);
          const contests = await Promise.all(contestIds.map((c) => league.getContest(c)));
          const prize = contests.reduce((a, c) => a + maxPool(c), 0n);
          return { id, m, meta, contests: contests.length, prize, disputeWindow: Number(disputeWindow) };
        }),
      );
      if (!cancelled) setMatches(list);
    })().catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [ctx.read, ctx.version]);

  if (error) return <div className="empty">Could not load matches: {String(error.message || error)}</div>;
  if (!matches) return <div className="empty">Loading matches…</div>;

  const now = ctx.chainNow();
  const shown = matches.filter((x) => sport === "all" || SPORTS[Number(x.m.sport)] === sport);
  const order = { live: 0, upcoming: 1, review: 2, completed: 3, abandoned: 4 };
  shown.sort((a, b) => order[matchPhase(a.m, now, a.disputeWindow).key] - order[matchPhase(b.m, now, b.disputeWindow).key]);

  return (
    <section>
      <div className="tabs">
        {["all", "cricket", "football"].map((s) => (
          <button key={s} className={sport === s ? "tab active" : "tab"} onClick={() => setSport(s)}>
            {s === "all" ? "All sports" : s === "cricket" ? "🏏 Cricket" : "⚽ Football"}
          </button>
        ))}
      </div>
      {shown.length === 0 && <div className="empty">No matches yet.</div>}
      <div className="grid">
        {shown.map(({ id, m, meta, contests, prize, disputeWindow }) => {
          const phase = matchPhase(m, now, disputeWindow);
          return (
            <button key={id} className="card match-card" onClick={() => open(id)}>
              <div className="row between">
                <span className="muted">{SPORTS[Number(m.sport)] === "cricket" ? "🏏 Cricket" : "⚽ Football"}</span>
                <span className={`phase ${phase.key}`}>{phase.label}</span>
              </div>
              <div className="versus">
                <span className="side">
                  <span className="crest c0">{meta?.short?.[0] || "H"}</span>
                  {meta?.teams?.[0] || "Home"}
                </span>
                <span className="vs">
                  {phase.key === "upcoming" ? countdown(Number(m.startTime) - now) : "vs"}
                </span>
                <span className="side right">
                  {meta?.teams?.[1] || "Away"}
                  <span className="crest c1">{meta?.short?.[1] || "A"}</span>
                </span>
              </div>
              <div className="row between muted small">
                <span>{m.name}</span>
                <span>
                  {contests} contests · {fmtFan(prize)} FAN
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

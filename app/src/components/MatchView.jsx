import { useState } from "react";
import { useMatchData, matchPhase, countdown, sameAddr } from "../data.js";
import { useTicker } from "./hooks.js";
import Contests from "./Contests.jsx";
import TeamBuilder from "./TeamBuilder.jsx";
import MyTeams from "./MyTeams.jsx";
import Leaderboard from "./Leaderboard.jsx";
import Transparency from "./Transparency.jsx";

export default function MatchView({ ctx, matchId, back }) {
  const { data, error } = useMatchData(ctx, matchId);
  const [tab, setTab] = useState("contests");
  const [editing, setEditing] = useState(null); // team being edited, or "new"
  const [contestId, setContestId] = useState(null);
  useTicker();

  if (error) return <div className="empty">Could not load match: {String(error.message || error)}</div>;
  if (!data) return <div className="empty">Loading match…</div>;

  const { m, meta } = data;
  const now = ctx.chainNow();
  const phase = matchPhase(m, now, data.disputeWindow);
  const open = phase.key === "upcoming";
  const myTeams = Object.values(data.teams).filter((t) => sameAddr(t.owner, ctx.account));

  const go = (t) => {
    setEditing(null);
    setTab(t);
  };

  const tabs = [
    ["contests", "Contests"],
    ["myteams", `My teams (${myTeams.length})`],
    ...(open ? [["create", "Create team"]] : []),
    ["leaderboard", "Leaderboard"],
    ["transparency", "🔍 Verify"],
  ];

  return (
    <section>
      <button className="link" onClick={back}>
        ← All matches
      </button>
      <div className="match-head">
        <div className="versus big">
          <span className="side">
            <span className="crest c0">{meta.short[0]}</span>
            {meta.teams[0]}
          </span>
          <span className="vs">vs</span>
          <span className="side right">
            {meta.teams[1]}
            <span className="crest c1">{meta.short[1]}</span>
          </span>
        </div>
        <div className="row center gap">
          {meta.competition && <span className="chip">{meta.competition}</span>}
          <span className={`phase ${phase.key}`}>{phase.label}</span>
          {open && <span className="muted">Deadline in {countdown(Number(m.startTime) - now)} · teams lock automatically on-chain</span>}
          {phase.key === "review" && (
            <span className="muted">
              Final in {countdown(Number(m.resultsPostedAt) + data.disputeWindow - now)} (dispute window)
            </span>
          )}
        </div>
      </div>

      <div className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k && !editing ? "tab active" : "tab"} onClick={() => go(k)}>
            {label}
          </button>
        ))}
      </div>

      {editing || tab === "create" ? (
        <TeamBuilder
          ctx={ctx}
          data={data}
          matchId={matchId}
          team={editing && editing !== "new" ? editing : null}
          done={() => go("myteams")}
        />
      ) : tab === "contests" ? (
        <Contests
          ctx={ctx}
          data={data}
          open={open}
          myTeams={myTeams}
          createTeam={() => go("create")}
          viewBoard={(id) => {
            setContestId(id);
            go("leaderboard");
          }}
        />
      ) : tab === "myteams" ? (
        <MyTeams ctx={ctx} data={data} open={open} teams={myTeams} edit={(t) => setEditing(t)} create={() => go("create")} />
      ) : tab === "leaderboard" ? (
        <Leaderboard ctx={ctx} data={data} contestId={contestId} setContestId={setContestId} />
      ) : (
        <Transparency ctx={ctx} data={data} matchId={matchId} />
      )}
    </section>
  );
}

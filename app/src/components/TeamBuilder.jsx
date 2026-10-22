import { useMemo, useState } from "react";
import { ROLES, MAX_CREDITS, MAX_PER_SIDE } from "../chain.js";
import TeamPreview from "./TeamPreview.jsx";

/** Same checks the contract runs in _validateTeam, so users see problems before sending a transaction. */
export function teamProblems(sport, players, picks) {
  const roles = ROLES[sport];
  const problems = [];
  const credits = picks.reduce((a, i) => a + players[i].credits, 0);
  if (credits > MAX_CREDITS) problems.push(`Over budget by ${(credits - MAX_CREDITS) / 10} credits`);
  for (const side of [0, 1]) {
    if (picks.filter((i) => players[i].side === side).length > MAX_PER_SIDE) problems.push(`Max ${MAX_PER_SIDE} players from one team`);
  }
  roles.forEach((r, k) => {
    const n = picks.filter((i) => players[i].role === k).length;
    if (n > r.max) problems.push(`Max ${r.max} ${r.label.toLowerCase()}`);
    if (picks.length === 11 && n < r.min) problems.push(`Pick at least ${r.min} ${r.label.toLowerCase()}`);
  });
  if (picks.length !== 11) problems.push(`Pick ${11 - picks.length} more player${picks.length === 10 ? "" : "s"}`);
  return problems;
}

export default function TeamBuilder({ ctx, data, matchId, team, done }) {
  const { players, sport, meta } = data;
  const roles = ROLES[sport];
  const [picks, setPicks] = useState(team ? team.picks : []);
  const [captain, setCaptain] = useState(team ? team.captain : null);
  const [vice, setVice] = useState(team ? team.viceCaptain : null);
  const [role, setRole] = useState(0);
  const [step, setStep] = useState("pick");
  const [hint, setHint] = useState(null);

  // "Selected by" percentages from every team saved on-chain for this match
  const selectedBy = useMemo(() => {
    const all = Object.values(data.teams);
    const counts = new Array(players.length).fill(0);
    all.forEach((t) => t.picks.forEach((i) => counts[i]++));
    return counts.map((c) => (all.length ? Math.round((c / all.length) * 100) : 0));
  }, [data.teams, players.length]);

  const credits = picks.reduce((a, i) => a + players[i].credits, 0);
  const perSide = [0, 1].map((s) => picks.filter((i) => players[i].side === s).length);
  const problems = teamProblems(sport, players, picks);

  const toggle = (i) => {
    if (picks.includes(i)) {
      setPicks(picks.filter((x) => x !== i));
      setHint(null);
      if (captain === i) setCaptain(null);
      if (vice === i) setVice(null);
      return;
    }
    if (picks.length >= 11) return setHint("You already have 11 players");
    const next = [...picks, i];
    const blocking = teamProblems(sport, players, next).filter((p) => !p.startsWith("Pick"));
    setHint(blocking[0] || null);
    if (blocking.length === 0) setPicks(next);
  };

  const save = async () => {
    const sorted = [...picks].sort((a, b) => a - b);
    const ok = team
      ? await ctx.tx("Save team", (w) => w.league.editTeam(team.id, sorted, captain, vice))
      : await ctx.tx("Create team", (w) => w.league.createTeam(matchId, sorted, captain, vice));
    if (ok) done();
  };

  const header = (
    <div className="builder-head card">
      <div className="row between">
        <div>
          <div className="muted small">Players</div>
          <strong>{picks.length}/11</strong>
        </div>
        <div className="center">
          <span className="crest c0 sm">{meta.short[0]}</span> {perSide[0]} : {perSide[1]}{" "}
          <span className="crest c1 sm">{meta.short[1]}</span>
        </div>
        <div className="right">
          <div className="muted small">Credits left</div>
          <strong className={credits > MAX_CREDITS ? "bad" : ""}>{(MAX_CREDITS - credits) / 10}</strong>
        </div>
      </div>
      <div className="slots">
        {Array.from({ length: 11 }, (_, k) => (
          <span key={k} className={k < picks.length ? "slot on" : "slot"} />
        ))}
      </div>
    </div>
  );

  if (step === "captain") {
    return (
      <div>
        {header}
        <p className="muted">Choose your captain (2x points) and vice-captain (1.5x points).</p>
        <div className="list">
          {[...picks]
            .sort((a, b) => players[a].role - players[b].role)
            .map((i) => (
              <div key={i} className="player">
                <span className={`crest c${players[i].side} sm`}>{meta.short[players[i].side]}</span>
                <span className="grow">
                  {players[i].name}
                  <span className="muted small"> · {roles[players[i].role].key}</span>
                </span>
                <button className={captain === i ? "cv on" : "cv"} onClick={() => (setCaptain(i), vice === i && setVice(null))}>
                  C
                </button>
                <button className={vice === i ? "cv on" : "cv"} onClick={() => (setVice(i), captain === i && setCaptain(null))}>
                  VC
                </button>
              </div>
            ))}
        </div>
        <div className="sticky-actions">
          <button className="btn ghost" onClick={() => setStep("pick")}>
            Back
          </button>
          <button className="btn ghost" onClick={() => setStep("preview")}>
            Preview
          </button>
          <button className="btn primary" disabled={captain === null || vice === null || !ctx.account} onClick={save}>
            {ctx.account ? (team ? "Save changes" : "Save team") : "Connect wallet to save"}
          </button>
        </div>
      </div>
    );
  }

  if (step === "preview") {
    return (
      <div>
        <TeamPreview data={data} team={{ picks, captain, viceCaptain: vice }} />
        <div className="sticky-actions">
          <button className="btn ghost" onClick={() => setStep("captain")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div className="tabs small">
        {roles.map((r, k) => (
          <button key={r.key} className={role === k ? "tab active" : "tab"} onClick={() => setRole(k)}>
            {r.key} ({picks.filter((i) => players[i].role === k).length})
          </button>
        ))}
      </div>
      <p className="muted small">
        Pick {roles[role].min}
        {roles[role].max !== roles[role].min ? `-${roles[role].max}` : ""} {roles[role].label.toLowerCase()}
      </p>
      <div className="list">
        <div className="player head muted small">
          <span className="grow">Player</span>
          <span className="num">Sel by</span>
          <span className="num">Credits</span>
          <span className="pick" />
        </div>
        {players
          .filter((p) => p.role === role)
          .sort((a, b) => b.credits - a.credits)
          .map((p) => {
            const on = picks.includes(p.index);
            return (
              <button key={p.index} className={on ? "player selectable on" : "player selectable"} onClick={() => toggle(p.index)}>
                <span className={`crest c${p.side} sm`}>{meta.short[p.side]}</span>
                <span className="grow">{p.name}</span>
                <span className="num muted">{selectedBy[p.index]}%</span>
                <span className="num">{p.credits / 10}</span>
                <span className="pick">{on ? "−" : "+"}</span>
              </button>
            );
          })}
      </div>
      <div className="sticky-actions">
        <span className={hint ? "bad small grow" : "muted small grow"}>{hint || problems[0] || "Team looks good"}</span>
        <button className="btn ghost" disabled={picks.length === 0} onClick={() => setStep("preview")}>
          Preview
        </button>
        <button className="btn primary" disabled={problems.length > 0} onClick={() => setStep("captain")}>
          Next
        </button>
      </div>
    </div>
  );
}

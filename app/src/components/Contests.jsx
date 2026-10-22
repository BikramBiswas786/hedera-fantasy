import { useEffect, useMemo, useState } from "react";
import { getDeployment, shortAddr, errorMessage } from "../chain.js";
import { contestKind, maxPool, contestPool, sameAddr, matchLink } from "../data.js";
import { PRIZE_PRESETS, prizeBps } from "../../../scoring/prizes.mjs";

const STATUS = ["Open", "Settled", "Cancelled"];
const MAX_POOL_SIZE = 300; // the contract's MAX_CONTEST_SIZE

const FILTERS = {
  all: { label: "All", test: () => true },
  free: { label: "Free", test: (c) => c.entryFee === 0n },
  duo: { label: "Duo", test: (c) => Number(c.maxEntries) === 2 },
  small: { label: "Small (3-10)", test: (c) => Number(c.maxEntries) > 2 && Number(c.maxEntries) <= 10 },
  large: { label: "Large (11+)", test: (c) => Number(c.maxEntries) > 10 },
  mine: { label: "Mine", test: (c, account) => sameAddr(c.sponsor, account) || c.entries.some((e) => sameAddr(e.user, account)) },
};

export default function Contests({ ctx, data, matchId, invitedContest, open, myTeams, createTeam, viewBoard }) {
  const [joining, setJoining] = useState(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("all");
  const [copied, setCopied] = useState(null);
  const operator = getDeployment(ctx.network)?.operator;

  useEffect(() => {
    if (invitedContest) document.getElementById(`contest-${invitedContest}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [invitedContest]);

  const shown = data.contests
    .filter((c) => FILTERS[filter].test(c, ctx.account))
    .sort((a, b) => (b.id === invitedContest) - (a.id === invitedContest));

  const share = async (c) => {
    const url = `${window.location.origin}${window.location.pathname}${matchLink(matchId, c.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(c.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  return (
    <div>
      <div className="row between wrap gap pool-bar">
        <div className="tabs small">
          {Object.entries(FILTERS).map(([k, f]) => (
            <button key={k} className={filter === k ? "tab active" : "tab"} onClick={() => setFilter(k)}>
              {f.label}
            </button>
          ))}
        </div>
        {open && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + Create pool
          </button>
        )}
      </div>

      {shown.length === 0 && <div className="empty">No pools here yet.{open && " Create one and invite your friends."}</div>}

      <div className="grid">
        {shown.map((c) => {
          const filled = c.entries.length;
          const spotsLeft = Number(c.maxEntries) - filled;
          const pool = Number(c.status) === 0 ? maxPool(c) : contestPool(c, filled);
          const winners = c.prizeBps.length;
          const mine = c.entries.filter((e) => sameAddr(e.user, ctx.account)).length;
          const byPlayer = operator && !sameAddr(c.sponsor, operator);
          return (
            <div key={c.id} id={`contest-${c.id}`} className={c.id === invitedContest ? "card contest invited" : "card contest"}>
              <div className="row between">
                <span className="contest-name">{contestKind(c)}</span>
                <span className="muted small">
                  #{c.id} · {STATUS[Number(c.status)]}
                </span>
              </div>
              {byPlayer && (
                <div className="muted small">
                  Created by {sameAddr(c.sponsor, ctx.account) ? "you" : shortAddr(c.sponsor)}
                  {c.id === invitedContest && !sameAddr(c.sponsor, ctx.account) && " · you were invited"}
                </div>
              )}
              <div className="row between baseline">
                <div>
                  <div className="muted small">{Number(c.status) === 0 && c.entryFee > 0n ? "Prize pool (when full)" : "Prize pool"}</div>
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
                <span className="accent">{spotsLeft > 0 ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left` : "Pool full"}</span>
                <span className="muted">{Number(c.maxEntries)} spots</span>
              </div>
              <div className="row between small muted footer-row">
                <span>🥇 {ctx.coin.format((pool * BigInt(c.prizeBps[0])) / 10000n)}</span>
                <span>
                  🏆 {winners} winner{winners === 1 ? "" : "s"} ({Math.round((winners / Number(c.maxEntries)) * 100)}%)
                </span>
                <span>{Number(c.maxEntriesPerUser) === 1 ? "Single entry" : `Up to ${Number(c.maxEntriesPerUser)} teams`}</span>
                <span title="Refunded automatically if fewer teams join">Min {Number(c.minEntries)} teams</span>
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
              <div className="row gap wrap">
                {open && Number(c.status) === 0 && spotsLeft > 0 && mine < Number(c.maxEntriesPerUser) && (
                  <button className="btn primary" onClick={() => setJoining(c)}>
                    Join{mine ? ` (${mine} joined)` : ""}
                  </button>
                )}
                {open && mine > 0 && mine >= Number(c.maxEntriesPerUser) && <span className="chip">Joined</span>}
                <button className="btn ghost" onClick={() => viewBoard(c.id)}>
                  Leaderboard
                </button>
                {open && Number(c.status) === 0 && (
                  <button className="btn ghost" onClick={() => share(c)}>
                    {copied === c.id ? "Link copied" : "Share"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {joining && (
        <JoinDialog ctx={ctx} data={data} contest={joining} myTeams={myTeams} createTeam={createTeam} close={() => setJoining(null)} />
      )}
      {creating && <CreatePoolDialog ctx={ctx} matchId={matchId} close={() => setCreating(false)} />}
    </div>
  );
}

const SIZES = [
  { n: 2, label: "Duo" },
  { n: 5, label: "5 teams" },
  { n: 10, label: "10 teams" },
  { n: 25, label: "25" },
  { n: 50, label: "50" },
  { n: 100, label: "100" },
  { n: 250, label: "250" },
  { n: 300, label: "300" },
];

const presetsFor = (size) =>
  size <= 2 ? ["winner"] : size <= 10 ? ["winner", "top2", "top3"] : ["top3", "top10pct", "top25pct", "top50pct", "winner"];

function CreatePoolDialog({ ctx, matchId, close }) {
  const [name, setName] = useState("");
  const [size, setSize] = useState(10);
  const [fee, setFee] = useState("2");
  const [seed, setSeed] = useState("0");
  const [preset, setPreset] = useState("top3");
  const [perUser, setPerUser] = useState(1);
  const [minEntries, setMinEntries] = useState(2);
  const [error, setError] = useState(null);

  const pickSize = (n) => {
    setSize(n);
    setPreset(n <= 2 ? "winner" : n <= 10 ? "top3" : "top10pct");
    setPerUser(n <= 10 ? 1 : 3);
    setMinEntries(n <= 10 ? Math.min(n, 2) : Math.max(2, Math.ceil(n / 10)));
  };

  const preview = useMemo(() => {
    try {
      const feeAmt = ctx.coin.parse(fee);
      const seedAmt = ctx.coin.parse(seed);
      const bps = prizeBps(preset, size);
      const pool = feeAmt * BigInt(size) + seedAmt;
      return { feeAmt, seedAmt, bps, pool, first: (pool * BigInt(bps[0])) / 10000n };
    } catch {
      return null;
    }
  }, [fee, seed, preset, size, ctx.coin]);

  const problem = !preview
    ? "Enter amounts like 2 or 0.5"
    : preview.feeAmt < 0n || preview.seedAmt < 0n
      ? "Amounts can't be negative"
      : preview.pool === 0n
        ? "Set an entry fee or seed the prize pool, otherwise there is nothing to win"
        : name.length > 48
          ? "Name is too long (48 characters max)"
          : null;

  const create = async () => {
    setError(null);
    const params = {
      matchId,
      entryFee: preview.feeAmt,
      sponsoredPool: preview.seedAmt,
      maxEntries: size,
      minEntries: Math.min(size, Math.max(1, Number(minEntries))),
      maxEntriesPerUser: Math.min(20, Math.max(1, Number(perUser))),
      platformFeeBps: 0,
      prizeBps: preview.bps,
      name: name.trim() || `${SIZES.find((s) => s.n === size)?.label || `${size} teams`} pool`,
    };
    const ok = await ctx.tx("Create pool", (w) => w.league.createContest(params, { value: ctx.coin.txValue(params.sponsoredPool) }));
    if (!ok) return;
    try {
      const id = Number(await ctx.read.league.contestCount());
      window.location.hash = matchLink(matchId, id); // highlight the new pool, ready to share
    } catch (e) {
      setError(errorMessage(e));
    }
    close();
  };

  return (
    <div className="modal" onClick={close}>
      <div className="card dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Create a pool</h3>
        <label className="field">
          <span>Name</span>
          <input value={name} maxLength={48} placeholder="e.g. Office league" onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span>Teams</span>
          <div className="chips">
            {SIZES.filter((s) => s.n <= MAX_POOL_SIZE).map((s) => (
              <button key={s.n} className={size === s.n ? "tab active" : "tab"} onClick={() => pickSize(s.n)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="row gap">
          <label className="field grow">
            <span>Entry fee ({ctx.coin.symbol})</span>
            <input type="number" min="0" step="0.5" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
          <label className="field grow">
            <span>Add to prize pool ({ctx.coin.symbol})</span>
            <input type="number" min="0" step="1" value={seed} onChange={(e) => setSeed(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Prize split</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {presetsFor(size).map((p) => (
              <option key={p} value={p}>
                {PRIZE_PRESETS[p].label}
              </option>
            ))}
          </select>
        </label>
        {size > 2 && (
          <div className="row gap">
            <label className="field grow">
              <span>Teams per player</span>
              <input type="number" min="1" max="20" value={perUser} onChange={(e) => setPerUser(e.target.value)} />
            </label>
            <label className="field grow">
              <span>Minimum teams to start</span>
              <input type="number" min="2" max={size} value={minEntries} onChange={(e) => setMinEntries(e.target.value)} />
            </label>
          </div>
        )}
        {preview && !problem && (
          <div className="preview small">
            Prize pool up to <strong>{ctx.coin.format(preview.pool)}</strong> · 1st prize {ctx.coin.format(preview.first)} ·{" "}
            {preview.bps.length} winner{preview.bps.length === 1 ? "" : "s"}
            {preview.seedAmt > 0n && <> · you pay {ctx.coin.format(preview.seedAmt)} now</>}
          </div>
        )}
        <p className="muted small">
          If fewer than the minimum teams join before the match starts, every entry fee{preview?.seedAmt > 0n ? " and your prize money" : ""} is
          refunded. After creating it, join with your own team and share the link.
        </p>
        {(problem || error) && <p className="bad small">{problem || error}</p>}
        <div className="row gap">
          <button className="btn primary" disabled={!!problem || !ctx.account} onClick={create}>
            {ctx.account ? "Create pool" : "Connect wallet first"}
          </button>
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
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
            <p>You have no team available for this pool.</p>
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

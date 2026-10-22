import { useEffect, useState } from "react";
import { RULES, canonicalJSON, computeMatchPoints } from "../../../scoring/index.mjs";
import { parseHcsRef } from "../../../scoring/hcs.mjs";
import { NETWORKS, ROLES, getDeployment, keccakText, loadRefText } from "../chain.js";

const Check = ({ ok }) => <span className={ok === null ? "muted" : ok ? "ok" : "bad"}>{ok === null ? "…" : ok ? "✓ verified" : "✗ mismatch"}</span>;

function RefLink({ network, refStr }) {
  const hcs = parseHcsRef(refStr);
  const explorer = NETWORKS[network].explorer;
  if (hcs && explorer) {
    return (
      <a href={`${explorer}/topic/${hcs.topicId}`} target="_blank" rel="noreferrer">
        {refStr}
      </a>
    );
  }
  return <code>{refStr}</code>;
}

/** Recomputes everything in the browser from public data and compares it with the chain. */
export default function Transparency({ ctx, data, matchId }) {
  const { m, meta, players, points, sport } = data;
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const rules = RULES[meta.rulesId];
  const rulesOk = rules ? keccakText(canonicalJSON(rules)) === m.rulesHash : false;
  const squadOk = meta.players.every(
    (p, i) => players[i] && p.side === players[i].side && p.role === players[i].role && p.credits === players[i].credits,
  );
  const deployment = getDeployment(ctx.network);
  const explorer = NETWORKS[ctx.network].explorer;

  useEffect(() => {
    if (!points) return;
    loadRefText(m.statsRef)
      .then((text) => setStats(JSON.parse(text)))
      .catch(setStatsError);
  }, [m.statsRef, points]);

  const statsOk = stats ? keccakText(canonicalJSON(stats)) === m.statsHash : null;
  const recomputed = stats && rules ? computeMatchPoints(rules, meta.players, stats) : null;
  const pointsOk = recomputed ? recomputed.points.every((p, i) => Math.round(p * 10) === Math.round(points[i] * 10)) : null;

  return (
    <div className="verify">
      <div className="card">
        <h3>How this match is kept fair</h3>
        <ol className="small">
          <li>Squads, roles and credits were written on-chain when the match was created, and can't change.</li>
          <li>The contract enforces team rules (11 players, 100 credits, max 7 per side, role limits) and locks teams at the deadline.</li>
          <li>The raw match stats are published on Hedera Consensus Service with a timestamp, and their hash is stored on-chain.</li>
          <li>Points come from open-source scoring code. This page re-runs it in your browser.</li>
          <li>The contract computes each team's score and rejects any payout ranking that isn't correct.</li>
        </ol>
      </div>

      <div className="card">
        <div className="row between">
          <h3>Scoring rules</h3>
          <Check ok={rulesOk} />
        </div>
        <p className="small muted">
          Version <code>{meta.rulesId}</code> · on-chain hash <code className="hash">{m.rulesHash}</code>
        </p>
        <details className="small">
          <summary>Show rules</summary>
          <pre>{JSON.stringify(rules, null, 2)}</pre>
        </details>
      </div>

      <div className="card">
        <div className="row between">
          <h3>Squad and credits</h3>
          <Check ok={squadOk} />
        </div>
        <p className="small muted">
          Published at <RefLink network={ctx.network} refStr={m.metadataURI} />, checked against the {players.length} players stored in the
          contract.
        </p>
      </div>

      <div className="card">
        <div className="row between">
          <h3>Match stats and points</h3>
          {points ? <Check ok={statsOk && pointsOk} /> : <span className="muted">Not posted yet</span>}
        </div>
        {points && (
          <>
            <p className="small muted">
              Raw stats at <RefLink network={ctx.network} refStr={m.statsRef} /> · hash <code className="hash">{m.statsHash}</code>{" "}
              <Check ok={statsOk} />
            </p>
            {statsError && <p className="bad small">Could not load stats: {String(statsError.message || statsError)}</p>}
            <table className="board small">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Role</th>
                  <th className="right">On-chain</th>
                  <th className="right">Recomputed</th>
                  <th>Breakdown</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p, i) => {
                  const r = recomputed?.breakdowns[i];
                  const same = r ? Math.round(r.total * 10) === Math.round(points[i] * 10) : null;
                  return (
                    <tr key={i}>
                      <td>
                        <span className={`crest c${p.side} sm`}>{meta.short[p.side]}</span> {p.name}
                      </td>
                      <td>{ROLES[sport][p.role].key}</td>
                      <td className="right">{points[i]}</td>
                      <td className={`right ${same === false ? "bad" : ""}`}>{r ? r.total : "…"}</td>
                      <td className="muted tiny-text">
                        {r && Object.entries(r.breakdown).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(" · ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card">
        <h3>Verify it yourself</h3>
        <p className="small">Contracts on {NETWORKS[ctx.network].label}:</p>
        <ul className="small">
          {["league", "fan"].map((k) => (
            <li key={k}>
              {k === "league" ? "FantasyLeague" : "FanToken"}:{" "}
              {explorer ? (
                <a href={`${explorer}/contract/${deployment[k]}`} target="_blank" rel="noreferrer">
                  {deployment[k]}
                </a>
              ) : (
                <code>{deployment[k]}</code>
              )}
            </li>
          ))}
          {deployment.hcsTopicId && (
            <li>
              HCS data topic:{" "}
              <a href={`${explorer}/topic/${deployment.hcsTopicId}`} target="_blank" rel="noreferrer">
                {deployment.hcsTopicId}
              </a>
            </li>
          )}
        </ul>
        <p className="small">Independent command-line audit (rules, squad, stats, points and every settled contest):</p>
        <pre>
          MATCH_ID={matchId} npx hardhat run scripts/verify.js --network {ctx.network}
        </pre>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { SPORTS, loadRefText } from "./chain.js";

const metaCache = new Map();

export async function loadMeta(ref) {
  if (!metaCache.has(ref)) metaCache.set(ref, loadRefText(ref).then(JSON.parse));
  return metaCache.get(ref);
}

export function matchPhase(m, now, disputeWindow) {
  const status = Number(m.status);
  if (status === 2) return { key: "abandoned", label: "Abandoned" };
  if (status === 1) {
    return now < Number(m.resultsPostedAt) + disputeWindow
      ? { key: "review", label: "Results in review" }
      : { key: "completed", label: "Completed" };
  }
  return now < Number(m.startTime) ? { key: "upcoming", label: "Upcoming" } : { key: "live", label: "Live" };
}

export function countdown(seconds) {
  if (seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

/** Contest pool as the contract computes it at settlement (with current entries). */
export function contestPool(c, entryCount) {
  const collected = c.entryFee * BigInt(entryCount);
  const fee = (collected * BigInt(c.platformFeeBps)) / 10000n;
  return collected - fee + c.sponsoredPool;
}

/** Prize pool shown on the contest card: as if the contest fills up. */
export function maxPool(c) {
  return contestPool(c, Number(c.maxEntries));
}

export function matchLink(matchId, contestId) {
  return `#/match/${matchId}${contestId ? `/contest/${contestId}` : ""}`;
}

export function contestKind(c) {
  if (c.name) return c.name;
  if (Number(c.maxEntries) === 2) return "Head-to-head";
  if (c.entryFee === 0n) return "Free contest";
  return `${Number(c.maxEntries)}-team pool`;
}

/** Everything the match screen needs, reloaded whenever ctx.version changes. */
export function useMatchData(ctx, matchId) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { league } = ctx.read;
      const [m, squad, disputeWindow, contestIds, teamCount] = await Promise.all([
        league.getMatch(matchId),
        league.getPlayers(matchId),
        league.disputeWindow(),
        league.getContestsOfMatch(matchId),
        league.teamCount(),
      ]);
      const meta = await loadMeta(m.metadataURI);
      const sport = SPORTS[Number(m.sport)];
      const players = squad.map((p, i) => ({
        index: i,
        side: Number(p.side),
        role: Number(p.role),
        credits: Number(p.credits),
        name: meta.players[i]?.name || `Player ${i + 1}`,
      }));
      const points = Number(m.status) === 1 ? (await league.getPoints(matchId)).map((t) => Number(t) / 10) : null;

      const contests = await Promise.all(
        contestIds.map(async (id) => {
          const [c, entries] = await Promise.all([league.getContest(id), league.getEntries(id)]);
          const scores = points ? await Promise.all(entries.map((e) => league.scoreOfTeam(e.teamId))) : null;
          return { id: Number(id), ...c.toObject(), prizeBps: c.prizeBps.map(Number), entries, scores };
        }),
      );

      // All teams for this match, used for "selected by %" and team previews.
      // Fine for testnet scale; a production app would index TeamSaved events instead.
      const teams = {};
      const limit = Math.min(Number(teamCount), 500);
      const ids = Array.from({ length: limit }, (_, k) => Number(teamCount) - k).filter((id) => id > 0);
      const all = await Promise.all(ids.map((id) => league.getTeam(id)));
      all.forEach((t, k) => {
        if (Number(t.matchId) === Number(matchId)) {
          teams[ids[k]] = {
            id: ids[k],
            owner: t.owner,
            picks: t.picks.map(Number),
            captain: Number(t.captain),
            viceCaptain: Number(t.viceCaptain),
          };
        }
      });

      const result = { m, meta, sport, players, points, contests, teams, disputeWindow: Number(disputeWindow) };
      if (!cancelled) setData(result);
    })().catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [ctx.read, matchId, ctx.version]);

  return { data, error };
}

export const sameAddr = (a, b) => !!a && !!b && ethers.getAddress(a) === ethers.getAddress(b);

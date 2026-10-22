// International T20 and ODI matches, plus major T20 leagues, with squads and scorecards from CricketData.org
// (api.cricapi.com). Needs a free API key in CRICKETDATA_API_KEY; the free plan allows
// 100 requests a day, so callers should list matches sparingly.
const BASE = "https://api.cricapi.com/v1";

const NATIONS = new Set([
  "India", "Australia", "England", "South Africa", "New Zealand", "Pakistan", "Sri Lanka", "Bangladesh",
  "West Indies", "Afghanistan", "Ireland", "Zimbabwe", "Netherlands", "Scotland", "Nepal", "Oman", "Namibia",
  "United Arab Emirates", "UAE", "United States of America", "USA", "Canada", "Papua New Guinea", "Uganda",
  "Hong Kong", "Kenya",
]);
// Franchise leagues, matched against the series part of the match name.
const LEAGUES =
  /Indian Premier League|\bIPL\b|Big Bash|\bWBBL\b|Pakistan Super League|\bPSL\b|Caribbean Premier League|\bCPL\b|\bSA20\b|The Hundred|International League T20|\bILT20\b|Major League Cricket|Super Smash|Vitality Blast|T20 Blast|Lanka Premier League|Bangladesh Premier League|Women'?s Premier League|\bWPL\b/i;

const MATCH_TYPES = { t20: { rulesId: "cricket-t20-v1", label: "T20I", hours: 3.5 }, odi: { rulesId: "cricket-odi-v1", label: "ODI", hours: 8 } };
const ROLE_CREDITS = [85, 85, 90, 80]; // WK, BAT, AR, BOWL (tenths); the feed has no player ratings

const gmtUnix = (s) => Math.floor(Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) / 1000);
const nationOf = (team) => team.replace(/\s+Women$/i, "").trim();
const isInternational = (teams) => Array.isArray(teams) && teams.length === 2 && teams.every((t) => NATIONS.has(nationOf(t)));
const seriesOf = (name = "") => name.split(",").pop().trim();
/** Internationals (T20I/ODI) and T20 matches in a major league. */
const isCovered = (m) => isInternational(m.teams) || (m.matchType === "t20" && LEAGUES.test(seriesOf(m.name)));

function roleOf(role = "") {
  const r = role.toLowerCase();
  if (r.includes("wk") || r.includes("keeper")) return 0;
  if (r.includes("allrounder") || r.includes("all-rounder")) return 2;
  if (r.includes("bowl")) return 3;
  return 1;
}

/** Match metadata from a match listing and its squads, in on-chain player order. */
function buildMeta(match, squads) {
  const type = MATCH_TYPES[match.matchType];
  const women = match.teams.some((t) => /women$/i.test(t));
  const international = isInternational(match.teams);
  const players = [];
  match.teams.forEach((teamName, side) => {
    const squad = squads.find((s) => s.teamName === teamName) || squads[side];
    for (const p of squad?.players || []) {
      players.push({ name: p.name, side, role: roleOf(p.role), credits: ROLE_CREDITS[roleOf(p.role)], ref: p.id });
    }
  });
  players.sort((a, b) => a.side - b.side || a.role - b.role || a.name.localeCompare(b.name));
  const info = (name) => (match.teamInfo || []).find((t) => t.name === name);
  return {
    sport: "cricket",
    rulesId: type.rulesId,
    competition: international ? `${type.label}${women ? " (Women)" : ""}` : seriesOf(match.name),
    name: match.name || `${match.teams[0]} vs ${match.teams[1]}`,
    teams: match.teams,
    short: match.teams.map((t) => info(t)?.shortname || nationOf(t).slice(0, 3).toUpperCase()),
    kickoff: match.dateTimeGMT,
    source: { provider: "cricketdata", matchId: match.id, key: `cricketdata:${match.id}:${gmtUnix(match.dateTimeGMT)}` },
    players,
  };
}

const clean = (s) => String(s || "").replace(/[†*]|\(c\)|\(wk\)/gi, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Finds a squad index for a name as written in a dismissal, preferring one side. */
function resolver(players) {
  return (name, side) => {
    const n = clean(name);
    if (!n) return -1;
    const order = [...players.keys()].sort((a, b) => (players[a].side === side ? 0 : 1) - (players[b].side === side ? 0 : 1));
    const last = n.split(" ").pop();
    for (const test of [(p) => clean(p.name) === n, (p) => clean(p.name).endsWith(` ${n}`), (p) => clean(p.name).split(" ").pop() === last]) {
      const hits = order.filter((i) => test(players[i]) && (side === undefined || players[i].side === side));
      if (hits.length === 1) return hits[0];
    }
    return -1;
  };
}

/**
 * Credits the fielding side for one dismissal: catches, stumpings, run-outs and
 * the LBW/bowled bonus. `stat(i)` returns the mutable stats object for player i.
 */
function creditDismissal(text, fieldingSide, find, stat) {
  const t = String(text || "").trim();
  let m;
  if ((m = /^lbw\s+b\s+(.+)$/i.exec(t)) || (m = /^b\s+(.+)$/i.exec(t))) {
    const i = find(m[1], fieldingSide);
    if (i >= 0) stat(i).lbwBowled = (stat(i).lbwBowled || 0) + 1;
  } else if ((m = /^c\s*(?:&|and)\s*b\s+(.+)$/i.exec(t))) {
    const i = find(m[1], fieldingSide);
    if (i >= 0) stat(i).catches = (stat(i).catches || 0) + 1;
  } else if ((m = /^c\s+(.+?)\s+b\s+.+$/i.exec(t))) {
    const i = find(m[1], fieldingSide);
    if (i >= 0) stat(i).catches = (stat(i).catches || 0) + 1;
  } else if ((m = /^st\s+(.+?)\s+b\s+.+$/i.exec(t))) {
    const i = find(m[1], fieldingSide);
    if (i >= 0) stat(i).stumpings = (stat(i).stumpings || 0) + 1;
  } else if ((m = /^run out\s*\((.+)\)/i.exec(t))) {
    const names = m[1].split("/").map((x) => x.trim()).filter(Boolean);
    const key = names.length === 1 ? "runOutDirect" : "runOutIndirect";
    for (const name of names) {
      const i = find(name, fieldingSide);
      if (i >= 0) stat(i)[key] = (stat(i)[key] || 0) + 1;
    }
  }
}

const oversToBalls = (o) => {
  const [whole, part = "0"] = String(o).split(".");
  return Number(whole) * 6 + Number(part);
};

/** Raw per-player stats from a CricketData scorecard. */
function statsFromScorecard(meta, card) {
  const byRef = new Map(meta.players.map((p, i) => [p.ref, i]));
  const find = resolver(meta.players);
  const players = {};
  const stat = (i) => (players[i] ??= { played: true });
  const idxOf = (obj, side) => (obj?.id && byRef.has(obj.id) ? byRef.get(obj.id) : find(obj?.name, side));

  for (const inning of card.scorecard || []) {
    for (const row of inning.batting || []) {
      const i = idxOf(row.batsman);
      if (i < 0) continue;
      const s = stat(i);
      s.runs = (s.runs || 0) + Number(row.r || 0);
      s.balls = (s.balls || 0) + Number(row.b || 0);
      s.fours = (s.fours || 0) + Number(row["4s"] || 0);
      s.sixes = (s.sixes || 0) + Number(row["6s"] || 0);
      const text = row["dismissal-text"] || "";
      if (text && !/not out|retired|absent/i.test(text)) s.out = true;
      creditDismissal(text, 1 - meta.players[i].side, find, stat);
    }
    for (const row of inning.bowling || []) {
      const i = idxOf(row.bowler);
      if (i < 0) continue;
      const s = stat(i);
      s.ballsBowled = (s.ballsBowled || 0) + oversToBalls(row.o || 0);
      s.runsConceded = (s.runsConceded || 0) + Number(row.r || 0);
      s.wickets = (s.wickets || 0) + Number(row.w || 0);
      s.maidens = (s.maidens || 0) + Number(row.m || 0);
    }
  }
  return players;
}

function createCricketFeed({ apiKey, fetchImpl = fetch, log = console.log } = {}) {
  if (!apiKey) return null;
  let requests = 0;
  const get = async (path, params = {}) => {
    const qs = new URLSearchParams({ apikey: apiKey, ...params });
    requests++;
    const res = await fetchImpl(`${BASE}${path}?${qs}`);
    if (!res.ok) throw new Error(`CricketData ${path}: HTTP ${res.status}`);
    const body = await res.json();
    if (body.status !== "success") throw new Error(`CricketData ${path}: ${body.reason || body.status}`);
    return body;
  };

  return {
    provider: "cricketdata",
    requests: () => requests,

    /** Covered matches starting between `from` and `to` (unix seconds). */
    async upcoming(from, to) {
      const out = [];
      for (let offset = 0; offset < 125; offset += 25) {
        const { data = [] } = await get("/matches", { offset });
        for (const m of data) {
          const start = m.dateTimeGMT ? gmtUnix(m.dateTimeGMT) : 0;
          if (!MATCH_TYPES[m.matchType] || m.matchStarted || !isCovered(m) || start <= from || start > to) continue;
          const { data: squads = [] } = await get("/match_squad", { id: m.id });
          const meta = buildMeta(m, squads);
          if (meta.players.length < 22) {
            log(`  skipping ${meta.name}: only ${meta.players.length} squad players announced`);
            continue;
          }
          out.push({ meta, startTime: start });
        }
        if (data.length < 25) break;
      }
      return out;
    },

    /** null while unfinished, { abandon: true } for no result, otherwise { stats }. */
    async result(meta, startTime, now) {
      const type = MATCH_TYPES[meta.rulesId === "cricket-odi-v1" ? "odi" : "t20"];
      if (now < startTime + type.hours * 3600) return null; // don't spend requests on matches still in play
      const { data } = await get("/match_scorecard", { id: meta.source.matchId });
      if (/abandon|no result|cancel/i.test(data.status || "")) return { abandon: true };
      if (!data.matchEnded) return null;
      const players = statsFromScorecard(meta, data);
      log(`  ${meta.name}: ${Object.keys(players).length} players featured`);
      return { stats: { source: meta.source, summary: data.status, players } };
    },
  };
}

module.exports = { createCricketFeed, buildMeta, statsFromScorecard, creditDismissal, resolver, roleOf, isInternational, isCovered, oversToBalls };

// Premier League fixtures, squads and per-fixture player stats from the official
// Fantasy Premier League API (public, no key needed).
const BASE = "https://fantasy.premierleague.com/api";

const ROLE = { 1: 0, 2: 1, 3: 2, 4: 3 }; // FPL element_type -> GK, DEF, MID, FWD
const UNAVAILABLE = new Set(["u", "n"]); // left the club / not eligible

const kickoffUnix = (iso) => Math.floor(Date.parse(iso) / 1000);

/**
 * FPL price (in £0.1m) mapped to credits in tenths, to the nearest 0.5: £4.0m is 7.0 and
 * £10.0m or more is 11.0, so the 100-credit budget limits how many stars a team can have.
 */
function credits(nowCost) {
  const raw = 70 + ((nowCost - 40) * 40) / 60;
  return Math.min(110, Math.max(70, Math.round(raw / 5) * 5));
}

/** Match metadata for one fixture, in on-chain player order. */
function buildMeta(bootstrap, fixture) {
  const teams = new Map(bootstrap.teams.map((t) => [t.id, t]));
  const home = teams.get(fixture.team_h);
  const away = teams.get(fixture.team_a);
  const players = bootstrap.elements
    .filter((e) => (e.team === home.id || e.team === away.id) && !UNAVAILABLE.has(e.status))
    .map((e) => ({
      name: e.web_name,
      side: e.team === home.id ? 0 : 1,
      role: ROLE[e.element_type],
      credits: credits(e.now_cost),
      ref: e.id,
    }))
    .filter((p) => p.role !== undefined)
    .sort((a, b) => a.side - b.side || a.role - b.role || b.credits - a.credits || a.ref - b.ref);
  return {
    sport: "football",
    rulesId: "football-epl-v1",
    competition: "Premier League",
    name: `${home.name} vs ${away.name}`,
    teams: [home.name, away.name],
    short: [home.short_name, away.short_name],
    kickoff: fixture.kickoff_time,
    source: { provider: "fpl", fixtureId: fixture.id, key: `fpl:${fixture.id}:${kickoffUnix(fixture.kickoff_time)}` },
    players,
  };
}

/** Raw stats for one player from an element-summary history row. */
function playerStats(h) {
  if (!h || !(h.minutes > 0)) return null;
  const started = h.starts !== undefined ? h.starts > 0 : h.minutes >= 60;
  return {
    minutes: h.minutes,
    started,
    subbedOn: !started,
    goals: h.goals_scored || 0,
    assists: h.assists || 0,
    goalsConceded: h.goals_conceded || 0,
    saves: h.saves || 0,
    penaltiesSaved: h.penalties_saved || 0,
    penaltiesMissed: h.penalties_missed || 0,
    yellowCards: h.yellow_cards || 0,
    redCards: h.red_cards || 0,
    ownGoals: h.own_goals || 0,
    tackles: h.tackles || 0,
    cbi: h.clearances_blocks_interceptions || 0,
  };
}

function createFplFeed({ fetchImpl = fetch, log = console.log } = {}) {
  let bootstrap;
  let fixtures;
  const get = async (path) => {
    const res = await fetchImpl(`${BASE}${path}`, { headers: { "User-Agent": "openxi-fantasy" } });
    if (!res.ok) throw new Error(`FPL ${path}: HTTP ${res.status}`);
    return res.json();
  };
  const loadBootstrap = async () => (bootstrap ??= await get("/bootstrap-static/"));
  const loadFixtures = async () => (fixtures ??= await get("/fixtures/"));

  return {
    provider: "fpl",

    /** Fixtures kicking off between `from` and `to` (unix seconds), with metadata. */
    async upcoming(from, to) {
      const all = await loadFixtures();
      const soon = all.filter((f) => f.kickoff_time && !f.started && kickoffUnix(f.kickoff_time) > from && kickoffUnix(f.kickoff_time) <= to);
      if (soon.length === 0) return [];
      const boot = await loadBootstrap();
      return soon.map((f) => ({ meta: buildMeta(boot, f), startTime: kickoffUnix(f.kickoff_time) }));
    },

    /**
     * Result for an on-chain match: null while not final, { abandon: true } if the fixture was
     * postponed or moved, otherwise { stats }.
     */
    async result(meta) {
      const fixture = (await loadFixtures()).find((f) => f.id === meta.source.fixtureId);
      if (!fixture || !fixture.kickoff_time || fixture.kickoff_time !== meta.kickoff) return { abandon: true };
      if (!fixture.finished) return null;
      const players = {};
      for (const [i, p] of meta.players.entries()) {
        const summary = await get(`/element-summary/${p.ref}/`);
        const s = playerStats(summary.history.find((h) => h.fixture === fixture.id));
        if (s) players[i] = s;
      }
      log(`  FPL fixture ${fixture.id}: ${Object.keys(players).length} players featured`);
      return {
        stats: {
          source: meta.source,
          summary: `${meta.short[0]} ${fixture.team_h_score}-${fixture.team_a_score} ${meta.short[1]}`,
          players,
        },
      };
    },
  };
}

module.exports = { createFplFeed, buildMeta, playerStats, credits };

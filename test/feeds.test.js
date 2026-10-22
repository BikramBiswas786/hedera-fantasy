const { expect } = require("chai");
const fpl = require("../scripts/feeds/fpl");
const cricket = require("../scripts/feeds/cricketdata");
const { autoPickTeam } = require("../scripts/lib");

const scoring = () => import("../scoring/index.mjs");

// Small FPL-shaped sample: two teams with full positional coverage.
function fplBootstrap() {
  const elements = [];
  let id = 1;
  for (const team of [1, 2]) {
    for (const [type, count] of [[1, 2], [2, 6], [3, 6], [4, 3]]) {
      for (let k = 0; k < count; k++) {
        elements.push({ id: id++, team, element_type: type, web_name: `P${id}`, now_cost: 40 + ((id * 7) % 70), status: "a" });
      }
    }
  }
  elements.push({ id: id++, team: 1, element_type: 3, web_name: "Gone", now_cost: 50, status: "u" });
  return {
    teams: [
      { id: 1, name: "Arsenal", short_name: "ARS" },
      { id: 2, name: "Chelsea", short_name: "CHE" },
    ],
    elements,
  };
}

describe("FPL feed", () => {
  it("maps prices to 7.0-11.0 credits in half steps", () => {
    expect(fpl.credits(40)).to.equal(70);
    expect(fpl.credits(70)).to.equal(90);
    expect(fpl.credits(100)).to.equal(110);
    expect(fpl.credits(150)).to.equal(110);
    expect(fpl.credits(20)).to.equal(70);
    for (let c = 40; c <= 150; c++) expect(fpl.credits(c) % 5).to.equal(0);
  });

  it("builds a squad the contract accepts, without unavailable players", () => {
    const meta = fpl.buildMeta(fplBootstrap(), { id: 99, team_h: 1, team_a: 2, kickoff_time: "2026-11-01T15:00:00Z" });
    expect(meta.name).to.equal("Arsenal vs Chelsea");
    expect(meta.short).to.deep.equal(["ARS", "CHE"]);
    expect(meta.source.key).to.equal(`fpl:99:${Date.parse("2026-11-01T15:00:00Z") / 1000}`);
    expect(meta.players.some((p) => p.name === "Gone")).to.equal(false);
    expect(meta.players.length).to.be.within(22, 255);
    expect(() => autoPickTeam(meta.players, "football", 0)).not.to.throw();
  });

  it("reads per-fixture stats and scores them", async () => {
    expect(fpl.playerStats({ minutes: 0 })).to.equal(null);
    const sub = fpl.playerStats({ minutes: 20, starts: 0, goals_scored: 1 });
    expect(sub).to.include({ started: false, subbedOn: true, goals: 1 });
    const keeper = fpl.playerStats({ minutes: 90, starts: 1, goals_conceded: 0, saves: 4, tackles: 1, clearances_blocks_interceptions: 3 });
    const { RULES, footballPlayerPoints } = await scoring();
    const { total, breakdown } = footballPlayerPoints(RULES["football-epl-v1"], "GK", keeper);
    // start 4 + clean sheet 20 + saves 24 + tackle 4 + CBI 6
    expect(breakdown).to.include({ appearance: 4, cleanSheet: 20, saves: 24, tackles: 4, clearancesBlocksInterceptions: 6 });
    expect(total).to.equal(58);
  });
});

describe("CricketData feed", () => {
  const players = [
    { name: "Rohit Sharma", side: 0, role: 1, ref: "a1" },
    { name: "Virat Kohli", side: 0, role: 1, ref: "a2" },
    { name: "Jasprit Bumrah", side: 0, role: 3, ref: "a3" },
    { name: "Rishabh Pant", side: 0, role: 0, ref: "a4" },
    { name: "Travis Head", side: 1, role: 1, ref: "b1" },
    { name: "Steven Smith", side: 1, role: 1, ref: "b2" },
    { name: "Mitchell Starc", side: 1, role: 3, ref: "b3" },
    { name: "Alex Carey", side: 1, role: 0, ref: "b4" },
  ];

  it("recognises international teams and roles", () => {
    expect(cricket.isInternational(["India", "Australia"])).to.equal(true);
    expect(cricket.isInternational(["India Women", "England Women"])).to.equal(true);
    expect(cricket.isInternational(["Mumbai Indians", "Chennai Super Kings"])).to.equal(false);
    expect(["WK-Batsman", "Batsman", "Batting Allrounder", "Bowling Allrounder", "Bowler"].map(cricket.roleOf)).to.deep.equal([0, 1, 2, 2, 3]);
    expect(cricket.oversToBalls("3.4")).to.equal(22);
    expect(cricket.oversToBalls(4)).to.equal(24);
  });

  it("covers internationals and major T20 leagues only", () => {
    const m = (name, teams, matchType = "t20") => ({ name, teams, matchType });
    expect(cricket.isCovered(m("India vs Australia, 1st T20I, Australia tour of India 2026", ["India", "Australia"]))).to.equal(true);
    expect(cricket.isCovered(m("India vs Australia, 2nd ODI", ["India", "Australia"], "odi"))).to.equal(true);
    expect(cricket.isCovered(m("Sydney Sixers Women vs Perth Scorchers Women, 5th Match, Women's Big Bash League 2026", ["Sydney Sixers Women", "Perth Scorchers Women"]))).to.equal(true);
    expect(cricket.isCovered(m("Mumbai Indians vs Chennai Super Kings, 12th Match, Indian Premier League 2027", ["Mumbai Indians", "Chennai Super Kings"]))).to.equal(true);
    expect(cricket.isCovered(m("Tamil Nadu vs Kerala, Elite Group B, Syed Mushtaq Ali Trophy 2026", ["Tamil Nadu", "Kerala"]))).to.equal(false);
    expect(cricket.isCovered(m("Sixers vs Scorchers, 3rd Match, Big Bash League 2026", ["Sydney Sixers", "Perth Scorchers"], "odi"))).to.equal(false);
  });

  it("credits catches, stumpings, run-outs and LBW/bowled to the fielding side", () => {
    const find = cricket.resolver(players);
    const out = {};
    const stat = (i) => (out[i] ??= {});
    cricket.creditDismissal("c Kohli b Bumrah", 0, find, stat);
    cricket.creditDismissal("c & b Bumrah", 0, find, stat);
    cricket.creditDismissal("lbw b Bumrah", 0, find, stat);
    cricket.creditDismissal("b Bumrah", 0, find, stat);
    cricket.creditDismissal("st †Pant b Bumrah", 0, find, stat);
    cricket.creditDismissal("run out (Kohli)", 0, find, stat);
    cricket.creditDismissal("run out (Sharma/Pant)", 0, find, stat);
    cricket.creditDismissal("not out", 0, find, stat);
    expect(out[1]).to.deep.equal({ catches: 1, runOutDirect: 1 });
    expect(out[2]).to.deep.equal({ catches: 1, lbwBowled: 2 });
    expect(out[3]).to.deep.equal({ stumpings: 1, runOutIndirect: 1 });
    expect(out[0]).to.deep.equal({ runOutIndirect: 1 });
  });

  it("turns a scorecard into scored stats", async () => {
    const meta = { players, rulesId: "cricket-t20-v1" };
    const card = {
      scorecard: [
        {
          batting: [
            { batsman: { id: "b1", name: "Travis Head" }, "dismissal-text": "c Kohli b Bumrah", r: 52, b: 30, "4s": 6, "6s": 2 },
            { batsman: { id: "b2", name: "Steven Smith" }, "dismissal-text": "not out", r: 10, b: 12, "4s": 1, "6s": 0 },
          ],
          bowling: [{ bowler: { id: "a3", name: "Jasprit Bumrah" }, o: 4, m: 1, r: 18, w: 1 }],
        },
      ],
    };
    const stats = cricket.statsFromScorecard(meta, card);
    expect(stats[4]).to.include({ played: true, runs: 52, balls: 30, fours: 6, sixes: 2, out: true });
    expect(stats[5].out).to.equal(undefined);
    expect(stats[2]).to.include({ played: true, ballsBowled: 24, runsConceded: 18, wickets: 1, maidens: 1 });
    expect(stats[1]).to.include({ played: true, catches: 1 });

    const { RULES, cricketPlayerPoints } = await scoring();
    const head = cricketPlayerPoints(RULES["cricket-t20-v1"], "BAT", stats[4]);
    // XI 4 + runs 52 + fours 24 + sixes 12 + 50 milestone 8 + SR 173 bonus 6
    expect(head.total).to.equal(106);
  });

  it("builds a T20I squad with the right rules and labels", () => {
    const match = {
      id: "m1",
      name: "India vs Australia, 1st T20I",
      matchType: "t20",
      dateTimeGMT: "2026-11-02T13:30:00",
      teams: ["India", "Australia"],
      teamInfo: [{ name: "India", shortname: "IND" }, { name: "Australia", shortname: "AUS" }],
    };
    const squads = [
      { teamName: "Australia", players: [{ id: "x", name: "Mitchell Starc", role: "Bowler" }] },
      { teamName: "India", players: [{ id: "y", name: "Rishabh Pant", role: "WK-Batsman" }] },
    ];
    const meta = cricket.buildMeta(match, squads);
    expect(meta).to.include({ rulesId: "cricket-t20-v1", competition: "T20I", kickoff: "2026-11-02T13:30:00" });
    expect(meta.short).to.deep.equal(["IND", "AUS"]);
    expect(meta.players.map((p) => [p.name, p.side, p.role])).to.deep.equal([
      ["Rishabh Pant", 0, 0],
      ["Mitchell Starc", 1, 3],
    ]);
    expect(meta.source.key).to.equal(`cricketdata:m1:${Date.parse("2026-11-02T13:30:00Z") / 1000}`);
  });
});

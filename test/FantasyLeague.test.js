const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { loadMatchData, rulesHash, autoPickTeam, scoring, hashJSON, SPORT } = require("../scripts/lib");

const E = (n) => ethers.parseEther(String(n));
const DISPUTE = 3600;

describe("FantasyLeague", function () {
  let league, admin, alice, bob, carol, treasury;

  async function setupMatch(id = "cricket-demo") {
    const { meta, stats } = loadMatchData(id);
    const start = (await time.latest()) + 7200;
    await league.createMatch(
      SPORT[meta.sport],
      meta.name,
      start,
      meta.players.map((p) => ({ side: p.side, role: p.role, credits: p.credits })),
      await rulesHash(meta.rulesId),
      `data/${id}.match.json`,
    );
    return { matchId: await league.matchCount(), meta, stats, start };
  }

  async function contest(matchId, overrides = {}) {
    const params = {
      matchId,
      entryFee: E(10),
      sponsoredPool: 0n,
      maxEntries: 100,
      minEntries: 2,
      maxEntriesPerUser: 3,
      platformFeeBps: 0,
      prizeBps: [6000, 3000, 1000],
      name: "Test pool",
      ...overrides,
    };
    await league.createContest(params, { value: params.sponsoredPool });
    return league.contestCount();
  }

  /** Join a contest, paying its entry fee in the native coin. */
  async function join(user, contestId, teamId) {
    const { entryFee } = await league.getContest(contestId);
    return league.connect(user).joinContest(contestId, teamId, { value: entryFee });
  }

  async function team(user, matchId, players, sport, variant) {
    const t = autoPickTeam(players, sport, variant);
    await league.connect(user).createTeam(matchId, t.picks, t.captain, t.viceCaptain);
    return { id: await league.teamCount(), ...t };
  }

  async function postResults(matchId, meta, stats) {
    const { RULES, computeMatchPoints, canonicalJSON } = await scoring();
    const { tenths, points } = computeMatchPoints(RULES[meta.rulesId], meta.players, stats);
    await league.postResults(matchId, tenths, hashJSON(canonicalJSON(stats)), "hcs:0.0.1234/1");
    return points;
  }

  async function ranking(contestId) {
    const entries = await league.getEntries(contestId);
    const scored = await Promise.all(entries.map(async (e, i) => ({ i, s: await league.scoreOfTeam(e.teamId) })));
    return scored.sort((a, b) => (b.s > a.s ? 1 : b.s < a.s ? -1 : 0)).map((x) => x.i);
  }

  beforeEach(async () => {
    [admin, alice, bob, carol, treasury] = await ethers.getSigners();
    league = await (await ethers.getContractFactory("FantasyLeague")).deploy(treasury.address, DISPUTE);
  });

  describe("team rules", () => {
    let matchId, meta;
    beforeEach(async () => ({ matchId, meta } = await setupMatch()));

    it("accepts a valid team", async () => {
      const t = await team(alice, matchId, meta.players, "cricket", 0);
      const saved = await league.getTeam(t.id);
      expect(saved.owner).to.equal(alice.address);
      expect(saved.picks.map(Number)).to.deep.equal(t.picks);
    });

    it("rejects duplicates, over-credit, C=VC, C outside team, role and side limits", async () => {
      const t = autoPickTeam(meta.players, "cricket", 0);
      const dup = [...t.picks];
      dup[1] = dup[0];
      await expect(league.createTeam(matchId, dup, t.captain, t.viceCaptain)).to.be.revertedWith("Team: duplicate player");
      await expect(league.createTeam(matchId, t.picks, t.captain, t.captain)).to.be.revertedWith("Team: C and VC same");
      const outside = meta.players.findIndex((_, i) => !t.picks.includes(i));
      await expect(league.createTeam(matchId, t.picks, outside, t.viceCaptain)).to.be.revertedWith("Team: C/VC not in team");

      // no wicket-keeper
      const noWk = meta.players.map((p, i) => ({ ...p, i })).filter((p) => p.role !== 0).slice(0, 11).map((p) => p.i);
      await expect(league.createTeam(matchId, noWk, noWk[0], noWk[1])).to.be.reverted;

      // 8 from one side
      const home = meta.players.map((p, i) => ({ ...p, i }));
      const eightHome = [0, 2, 3, 6, 9, 10, 11, 4].concat(home.filter((p) => p.side === 1).slice(0, 3).map((p) => p.i));
      await expect(league.createTeam(matchId, eightHome, eightHome[0], eightHome[1])).to.be.reverted;
    });

    it("rejects over 100 credits", async () => {
      const expensive = meta.players.map((p, i) => ({ ...p, i }));
      const byRole = (r) => expensive.filter((p) => p.role === r).sort((a, b) => b.credits - a.credits);
      const homeAway = (list, n) => list.slice(0, n).map((p) => p.i);
      const picks = [...homeAway(byRole(0), 1), ...homeAway(byRole(1), 4), ...homeAway(byRole(2), 2), ...homeAway(byRole(3), 4)];
      const credits = picks.reduce((a, i) => a + meta.players[i].credits, 0);
      expect(credits).to.be.greaterThan(1000);
      await expect(league.createTeam(matchId, picks, picks[0], picks[1])).to.be.revertedWith("Team: over credits");
    });

    it("locks teams at match start", async () => {
      const t = await team(alice, matchId, meta.players, "cricket", 0);
      await time.increase(7200);
      await expect(league.connect(alice).editTeam(t.id, t.picks, t.captain, t.viceCaptain)).to.be.revertedWith(
        "Team: deadline passed",
      );
      await expect(league.connect(alice).createTeam(matchId, t.picks, t.captain, t.viceCaptain)).to.be.revertedWith(
        "Team: deadline passed",
      );
    });

    it("validates football formations", async () => {
      const fb = await setupMatch("football-demo");
      await team(alice, fb.matchId, fb.meta.players, "football", 0);
      const twoGk = fb.meta.players.map((p, i) => ({ ...p, i }));
      const gks = twoGk.filter((p) => p.role === 0).map((p) => p.i);
      const t = autoPickTeam(fb.meta.players, "football", 0);
      const swapped = t.picks.map((i) => i);
      // replace the priciest outfield pick (not C/VC) with the second keeper, so only the role rule fails
      const notGk = swapped.reduce(
        (best, idx, pos) =>
          pos > 1 && fb.meta.players[idx].role !== 0 && (best < 0 || fb.meta.players[idx].credits > fb.meta.players[swapped[best]].credits)
            ? pos
            : best,
        -1,
      );
      swapped[notGk] = gks.find((g) => !swapped.includes(g));
      await expect(league.createTeam(fb.matchId, swapped, swapped[0], swapped[1])).to.be.revertedWith("Team: role limits");
    });
  });

  describe("contests", () => {
    let matchId, meta, stats;
    beforeEach(async () => ({ matchId, meta, stats } = await setupMatch()));

    it("full flow: join, results, verified ranking, payouts", async () => {
      const cId = await contest(matchId);
      const ta = await team(alice, matchId, meta.players, "cricket", 0);
      const tb = await team(bob, matchId, meta.players, "cricket", 3);
      const tc = await team(carol, matchId, meta.players, "cricket", 6);
      await join(alice, cId, ta.id);
      await join(bob, cId, tb.id);
      await join(carol, cId, tc.id);

      await expect(join(alice, cId, ta.id)).to.be.revertedWith("Join: team already joined");
      await expect(join(bob, cId, ta.id)).to.be.revertedWith("Join: not your team");

      await time.increase(7200);
      const points = await postResults(matchId, meta, stats);

      // contract score equals the off-chain engine's score (hundredths)
      const { teamScore } = await scoring();
      expect(await league.scoreOfTeam(ta.id)).to.equal(BigInt(Math.round(teamScore(points, ta.picks, ta.captain, ta.viceCaptain) * 100)));

      const order = await ranking(cId);
      await expect(league.settleContest(cId, order)).to.be.revertedWith("Settle: dispute window");
      await time.increase(DISPUTE);

      const reversed = [...order].reverse();
      await expect(league.settleContest(cId, reversed)).to.be.revertedWith("Settle: ranking not sorted");
      await expect(league.settleContest(cId, [order[0], order[0], order[1]])).to.be.revertedWith("Settle: bad ranking");
      await expect(league.settleContest(cId, order.slice(0, 2))).to.be.revertedWith("Settle: ranking length");

      await league.connect(carol).settleContest(cId, order); // anyone can settle
      const entries = await league.getEntries(cId);
      const winner = entries[order[0]].user;
      expect(await league.claimable(winner)).to.equal(E(18)); // 60% of 30
      await expect(league.settleContest(cId, order)).to.be.revertedWith("Settle: not open");

      // results cannot change after settlement
      await expect(postResults(matchId, meta, stats)).to.be.revertedWith("Match: already settled");
    });

    it("requires the exact entry fee and sponsored pool", async () => {
      const cId = await contest(matchId);
      const ta = await team(alice, matchId, meta.players, "cricket", 0);
      await expect(league.connect(alice).joinContest(cId, ta.id)).to.be.revertedWith("Join: wrong entry fee");
      await expect(league.connect(alice).joinContest(cId, ta.id, { value: E(11) })).to.be.revertedWith("Join: wrong entry fee");
      await expect(join(alice, cId, ta.id)).to.changeEtherBalances([alice, league], [-E(10), E(10)]);

      const params = { matchId, entryFee: 0, sponsoredPool: E(5), maxEntries: 10, minEntries: 2, maxEntriesPerUser: 1, platformFeeBps: 0, prizeBps: [10000], name: "" };
      await expect(league.createContest(params)).to.be.revertedWith("Contest: send sponsored pool");
    });

    it("lets anyone create a pool, but only operators take a fee", async () => {
      const duo = { matchId, entryFee: E(3), sponsoredPool: 0n, maxEntries: 2, minEntries: 2, maxEntriesPerUser: 1, platformFeeBps: 0, prizeBps: [10000], name: "Alice vs Bob" };
      await expect(league.connect(alice).createContest(duo))
        .to.emit(league, "ContestCreated")
        .withArgs(await league.contestCount() + 1n, matchId, alice.address, "Alice vs Bob", E(3), 0, 2, [10000]);
      const c = await league.getContest(await league.contestCount());
      expect(c.sponsor).to.equal(alice.address);
      expect(c.name).to.equal("Alice vs Bob");
      await expect(league.connect(alice).createContest({ ...duo, platformFeeBps: 500 })).to.be.revertedWith("Contest: only operators take a fee");
      await expect(league.connect(alice).createContest({ ...duo, maxEntries: 301, prizeBps: [10000] })).to.be.revertedWith("Contest: 2 to 300 entries");
      await expect(league.connect(alice).createContest({ ...duo, name: "x".repeat(49) })).to.be.revertedWith("Contest: name too long");
    });

    it("creates several pools in one transaction", async () => {
      const base = { matchId, entryFee: 0, maxEntries: 10, minEntries: 2, maxEntriesPerUser: 1, platformFeeBps: 0, prizeBps: [10000], name: "" };
      const before = await league.contestCount();
      await expect(league.createContests([{ ...base, sponsoredPool: E(1) }, { ...base, sponsoredPool: E(2) }], { value: E(2) })).to.be.revertedWith(
        "Contest: send sponsored pool",
      );
      await league.createContests([{ ...base, sponsoredPool: E(1) }, { ...base, sponsoredPool: E(2) }], { value: E(3) });
      expect(await league.contestCount()).to.equal(before + 2n);
      expect((await league.getContest(before + 2n)).sponsoredPool).to.equal(E(2));
    });

    it("settles a full 300-entry pool with 150 different winners within Hedera's 15M gas limit", async function () {
      this.timeout(900_000);
      const { prizeBps } = await import("../scoring/prizes.mjs");
      const cId = await contest(matchId, { entryFee: E(1), maxEntries: 300, maxEntriesPerUser: 1, prizeBps: prizeBps("top50pct", 300) });
      // worst case: every entry, and so every winner, is a different player
      const players = (await ethers.getSigners()).slice(10, 310);
      for (const [k, user] of players.entries()) {
        const t = autoPickTeam(meta.players, "cricket", k);
        await league.connect(user).createTeam(matchId, t.picks, t.captain, t.viceCaptain);
        await join(user, cId, await league.teamCount());
      }
      expect((await league.getEntries(cId)).length).to.equal(300);
      await time.increase(7200);
      await postResults(matchId, meta, stats);
      await time.increase(DISPUTE);
      const receipt = await (await league.settleContest(cId, await ranking(cId))).wait();
      console.log(`      settle gas for 300 entries / 150 winners: ${receipt.gasUsed}`);
      expect(receipt.gasUsed).to.be.lessThan(15_000_000n);
    });

    it("splits prizes between tied entries", async () => {
      const cId = await contest(matchId, { prizeBps: [7000, 3000] });
      const t = autoPickTeam(meta.players, "cricket", 0);
      await league.connect(alice).createTeam(matchId, t.picks, t.captain, t.viceCaptain);
      await join(alice, cId, await league.teamCount());
      await league.connect(bob).createTeam(matchId, t.picks, t.captain, t.viceCaptain);
      await join(bob, cId, await league.teamCount());
      await time.increase(7200);
      await postResults(matchId, meta, stats);
      await time.increase(DISPUTE);
      await league.settleContest(cId, [0, 1]);
      expect(await league.claimable(alice)).to.equal(E(10));
      expect(await league.claimable(bob)).to.equal(E(10));
    });

    it("lets the oracle correct results only during the dispute window", async () => {
      await time.increase(7200);
      await postResults(matchId, meta, stats);
      await postResults(matchId, meta, stats);
      await time.increase(DISPUTE);
      await expect(postResults(matchId, meta, stats)).to.be.revertedWith("Match: results final");
    });

    it("refunds an under-filled contest", async () => {
      const cId = await contest(matchId, { minEntries: 3 });
      const ta = await team(alice, matchId, meta.players, "cricket", 0);
      await join(alice, cId, ta.id);
      await expect(league.cancelContest(cId)).to.be.revertedWith("Cancel: not allowed");
      await time.increase(7200);
      await league.cancelContest(cId);
      expect(await league.claimable(alice)).to.equal(E(10));
      await expect(league.connect(alice).claim()).to.changeEtherBalance(alice, E(10));
      await expect(league.connect(alice).claim()).to.be.revertedWith("Claim: nothing to claim");
    });

    it("refunds entries and sponsor when a match is abandoned", async () => {
      const cId = await contest(matchId, { sponsoredPool: E(500), entryFee: 0 });
      const ta = await team(alice, matchId, meta.players, "cricket", 0);
      await join(alice, cId, ta.id);
      await league.abandonMatch(matchId);
      await league.cancelContest(cId);
      expect(await league.claimable(admin.address)).to.equal(E(500));
    });

    it("pays a sponsored free contest and the platform fee", async () => {
      const cId = await contest(matchId, { sponsoredPool: E(1000), entryFee: E(10), platformFeeBps: 1000, prizeBps: [10000] });
      const ta = await team(alice, matchId, meta.players, "cricket", 0);
      const tb = await team(bob, matchId, meta.players, "cricket", 3);
      await join(alice, cId, ta.id);
      await join(bob, cId, tb.id);
      await time.increase(7200);
      await postResults(matchId, meta, stats);
      await time.increase(DISPUTE);
      const order = await ranking(cId);
      await league.settleContest(cId, order);
      const winner = (await league.getEntries(cId))[order[0]].user;
      expect(await league.claimable(winner)).to.equal(E(1018)); // 1000 sponsored + 20 fees - 10%
      expect(await league.claimable(treasury.address)).to.equal(E(2));
    });
  });
});

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const DEPLOYMENTS = path.join(ROOT, "deployments.json");

const scoring = () => import("../scoring/index.mjs");

function loadMatchData(id) {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "data", `${id}.match.json`), "utf8"));
  const statsFile = path.join(ROOT, "data", `${id}.stats.json`);
  const stats = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile, "utf8")) : null;
  return { meta, stats };
}

const hashJSON = (canonical) => ethers.keccak256(ethers.toUtf8Bytes(canonical));

async function rulesHash(rulesId) {
  const { RULES, canonicalJSON } = await scoring();
  return hashJSON(canonicalJSON(RULES[rulesId]));
}

const SPORT = { cricket: 0, football: 1 };
// Role counts that always satisfy the on-chain limits
const TEAM_SHAPE = { cricket: [1, 4, 2, 4], football: [1, 4, 4, 2] };

/** Builds a valid team (11 picks, <=100 credits, <=7 per side). `variant` varies the picks. */
function autoPickTeam(players, sport, variant = 0) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const offset = variant + attempt;
    const picks = [];
    TEAM_SHAPE[sport].forEach((count, role) => {
      const pool = players.map((p, i) => ({ ...p, i })).filter((p) => Number(p.role) === role);
      for (let k = 0; k < count; k++) picks.push(pool[(offset + k * 2) % pool.length].i);
    });
    const unique = new Set(picks).size === 11;
    const credits = picks.reduce((a, i) => a + Number(players[i].credits), 0);
    const home = picks.filter((i) => Number(players[i].side) === 0).length;
    if (unique && credits <= 1000 && home <= 7 && home >= 4) {
      return { picks, captain: picks[(variant + 5) % 11], viceCaptain: picks[(variant + 9) % 11] };
    }
  }
  throw new Error("could not auto-pick a valid team");
}

function readDeployments() {
  return fs.existsSync(DEPLOYMENTS) ? JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf8")) : {};
}

function writeDeployments(network, data) {
  const all = readDeployments();
  all[network] = { ...(all[network] || {}), ...data };
  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(all, null, 2) + "\n");
  // the web app reads the same file
  const appCopy = path.join(ROOT, "app", "src", "deployments.json");
  if (fs.existsSync(path.dirname(appCopy))) fs.writeFileSync(appCopy, JSON.stringify(all, null, 2) + "\n");
}

module.exports = {
  ROOT,
  SPORT,
  scoring,
  loadMatchData,
  hashJSON,
  rulesHash,
  autoPickTeam,
  readDeployments,
  writeDeployments,
};

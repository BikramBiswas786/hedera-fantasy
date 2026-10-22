// Dev helper: serves Fantasy Premier League API responses from JSON files, so scripts/sync.js
// can be exercised against a local chain without network access.
//   MOCK_FPL_DIR=path NODE_OPTIONS="--require ./scripts/dev/mock-fpl.cjs" npx hardhat run scripts/sync.js --network localhost
// The directory holds bootstrap-static.json, fixtures.json and element-summary-<id>.json.
const fs = require("fs");
const path = require("path");

const dir = process.env.MOCK_FPL_DIR;
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, options) => {
  const m = /^https:\/\/fantasy\.premierleague\.com\/api\/(.+?)\/?$/.exec(String(url));
  if (!m || !dir) return realFetch(url, options);
  const file = path.join(dir, `${m[1].replace(/\//g, "-")}.json`);
  if (!fs.existsSync(file)) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(file), { status: 200, headers: { "content-type": "application/json" } });
};

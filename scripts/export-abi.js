// Copies contract ABIs into the web app. Run after `npx hardhat compile`.
const fs = require("fs");
const path = require("path");

const out = path.join(__dirname, "..", "app", "src", "abi");
fs.mkdirSync(out, { recursive: true });
for (const name of ["FanToken", "FantasyLeague"]) {
  const artifact = require(`../artifacts/contracts/${name}.sol/${name}.json`);
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(artifact.abi, null, 2) + "\n");
}
console.log(`ABIs written to ${out}`);

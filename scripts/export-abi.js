// Copies contract ABIs into the web app, in ethers' compact human-readable format.
// Run after `npx hardhat compile`.
const fs = require("fs");
const path = require("path");
const { Interface } = require("ethers");

const out = path.join(__dirname, "..", "app", "src", "abi");
fs.mkdirSync(out, { recursive: true });
for (const name of ["FanToken", "FantasyLeague"]) {
  const artifact = require(`../artifacts/contracts/${name}.sol/${name}.json`);
  const abi = new Interface(artifact.abi).format(false);
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(abi, null, 1) + "\n");
}
console.log(`ABIs written to ${out}`);

// Run against a local node: npx hardhat node, then npx hardhat run scripts/deploy.js --network localhost,
// then: cd app && node gas-safe.test.mjs
// Checks GasSafeSigner against a local Hardhat node whose estimateGas is made to fail
// the way Hedera's relay does ("missing revert data").
import { ethers } from "ethers";
import fs from "node:fs";
import { GasSafeSigner } from "./src/gasSafeSigner.js";

const RPC = "http://127.0.0.1:8545";
const deployments = JSON.parse(fs.readFileSync(new URL("./src/deployments.json", import.meta.url)));
const fanAbi = JSON.parse(fs.readFileSync(new URL("./src/abi/FanToken.json", import.meta.url)));

class FlakyEstimateProvider extends ethers.JsonRpcProvider {
  async estimateGas() {
    throw ethers.makeError("missing revert data", "CALL_EXCEPTION", { data: null });
  }
}

const read = new ethers.JsonRpcProvider(RPC, 31337, { staticNetwork: true });
const flakyRead = new FlakyEstimateProvider(RPC, 31337, { staticNetwork: true });
const wallet = ethers.Wallet.createRandom().connect(new FlakyEstimateProvider(RPC, 31337, { staticNetwork: true }));
const funder = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", read);
await (await funder.sendTransaction({ to: wallet.address, value: ethers.parseEther("1") })).wait();

// Without the wrapper the flaky estimate blocks the transaction.
const plain = new ethers.Contract(deployments.localhost.fan, fanAbi, wallet);
await plain.claimFaucet().then(
  () => { throw new Error("expected plain signer to fail"); },
  (e) => console.log("plain signer fails as on Hedera:", e.shortMessage),
);

// With the wrapper (estimates through a flaky provider too) it falls back and succeeds.
const fan = new ethers.Contract(deployments.localhost.fan, fanAbi, new GasSafeSigner(wallet, flakyRead));
await (await fan.claimFaucet()).wait();
console.log("faucet claimed, balance:", ethers.formatEther(await fan.balanceOf(wallet.address)));

// A real revert still surfaces its reason instead of "missing revert data".
await fan.claimFaucet().then(
  () => { throw new Error("expected cooldown revert"); },
  (e) => console.log("second claim reverts with:", e.reason),
);

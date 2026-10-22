import { ethers } from "ethers";
import leagueAbi from "./abi/FantasyLeague.json";
import fanAbi from "./abi/FanToken.json";
import deployments from "./deployments.json";
import { fetchHcsMessage } from "../../scoring/hcs.mjs";

export const NETWORKS = {
  localhost: {
    label: "Local (Hardhat)",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    explorer: null,
  },
  hederaTestnet: {
    label: "Hedera Testnet",
    chainId: 296,
    rpcUrl: "https://testnet.hashio.io/api",
    explorer: "https://hashscan.io/testnet",
    currency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  },
};

// Hardhat's well-known dev keys (accounts #1-#5), for the local demo only.
export const DEV_KEYS = [
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];

export const SPORTS = ["cricket", "football"];
export const ROLES = {
  cricket: [
    { key: "WK", label: "Wicket-keepers", min: 1, max: 8 },
    { key: "BAT", label: "Batters", min: 1, max: 8 },
    { key: "AR", label: "All-rounders", min: 1, max: 8 },
    { key: "BOWL", label: "Bowlers", min: 1, max: 8 },
  ],
  football: [
    { key: "GK", label: "Goalkeepers", min: 1, max: 1 },
    { key: "DEF", label: "Defenders", min: 3, max: 5 },
    { key: "MID", label: "Midfielders", min: 3, max: 5 },
    { key: "FWD", label: "Forwards", min: 1, max: 3 },
  ],
};
export const MAX_CREDITS = 1000;
export const MAX_PER_SIDE = 7;

export function getDeployment(network) {
  return deployments[network];
}

export function readContracts(network) {
  const d = getDeployment(network);
  const provider = new ethers.JsonRpcProvider(NETWORKS[network].rpcUrl, NETWORKS[network].chainId, { staticNetwork: true });
  return {
    provider,
    league: new ethers.Contract(d.league, leagueAbi, provider),
    fan: new ethers.Contract(d.fan, fanAbi, provider),
  };
}

export function writeContracts(network, signer) {
  const d = getDeployment(network);
  return {
    league: new ethers.Contract(d.league, leagueAbi, signer),
    fan: new ethers.Contract(d.fan, fanAbi, signer),
  };
}

/** Connect MetaMask (or any injected EVM wallet) and switch it to the selected network. */
export async function connectInjected(network) {
  if (!window.ethereum) throw new Error("No EVM wallet found. Install MetaMask, or use a dev account on the local network.");
  const net = NETWORKS[network];
  const hexId = "0x" + net.chainId.toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: net.label,
          rpcUrls: [net.rpcUrl],
          nativeCurrency: net.currency || { name: "ETH", symbol: "ETH", decimals: 18 },
          blockExplorerUrls: net.explorer ? [net.explorer] : undefined,
        },
      ],
    });
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  return provider.getSigner();
}

export function devSigner(network, index) {
  const provider = new ethers.JsonRpcProvider(NETWORKS[network].rpcUrl, NETWORKS[network].chainId, { staticNetwork: true });
  return new ethers.NonceManager(new ethers.Wallet(DEV_KEYS[index], provider));
}

const bundledData = import.meta.glob("../../data/*.json", { eager: true, query: "?raw", import: "default" });

/** Load JSON text behind an on-chain ref: "file:data/x.json" (bundled) or "hcs:<topic>:<seq>". */
export async function loadRefText(ref) {
  if (ref.startsWith("file:")) {
    const text = bundledData[`../../${ref.slice(5)}`];
    if (!text) throw new Error(`data file not bundled: ${ref}`);
    return text;
  }
  return fetchHcsMessage(ref);
}

export const keccakText = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));
export const fmtFan = (wei) => {
  const n = Number(ethers.formatEther(wei));
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : 0 });
};
export const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Turn a contract revert into a readable message. */
export function errorMessage(e) {
  return e?.reason || e?.shortMessage || e?.info?.error?.message || e?.message || String(e);
}

/** Prizes per entry, using the same tie-splitting rule as the contract. */
export function computePrizes(scores, prizeBps, pool) {
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => (b.s > a.s ? 1 : b.s < a.s ? -1 : a.i - b.i));
  const result = new Array(scores.length);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && order[end + 1].s === order[start].s) end++;
    let share = 0n;
    for (let r = start; r <= end && r < prizeBps.length; r++) share += BigInt(prizeBps[r]);
    const each = (pool * share) / 10000n / BigInt(end - start + 1);
    for (let k = start; k <= end; k++) result[order[k].i] = { rank: start + 1, prize: each };
    start = end + 1;
  }
  return result;
}

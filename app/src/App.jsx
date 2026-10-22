import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NETWORKS,
  DEV_KEYS,
  getDeployment,
  readContracts,
  writeContracts,
  connectInjected,
  devSigner,
  fmtFan,
  shortAddr,
  errorMessage,
} from "./chain.js";
import MatchList from "./components/MatchList.jsx";
import MatchView from "./components/MatchView.jsx";

const IS_LOCAL_HOST = ["localhost", "127.0.0.1"].includes(window.location.hostname);

const defaultNetwork = () => {
  const saved = (() => {
    try {
      return localStorage.getItem("network");
    } catch {
      return null;
    }
  })();
  if (saved && getDeployment(saved) && (saved !== "localhost" || IS_LOCAL_HOST)) return saved;
  return getDeployment("hederaTestnet") ? "hederaTestnet" : "localhost";
};

export default function App() {
  const [network, setNetwork] = useState(defaultNetwork);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [balance, setBalance] = useState(0n);
  const [claimable, setClaimable] = useState(0n);
  const [chainOffset, setChainOffset] = useState(0); // chain time minus wall clock, in seconds
  const [route, setRoute] = useState({ page: "home" });
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(null);
  const [version, setVersion] = useState(0); // bump to reload data

  const deployed = !!getDeployment(network);
  const read = useMemo(() => (deployed ? readContracts(network) : null), [network, deployed]);
  const write = useMemo(() => (signer && deployed ? writeContracts(network, signer) : null), [network, signer, deployed]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!read) return;
    read.provider.getBlock("latest").then((b) => setChainOffset(b.timestamp - Math.floor(Date.now() / 1000))).catch(() => {});
    if (!account) return;
    read.fan.balanceOf(account).then(setBalance).catch(() => {});
    read.league.claimable(account).then(setClaimable).catch(() => {});
  }, [read, account, version]);

  const switchNetwork = (n) => {
    try {
      localStorage.setItem("network", n);
    } catch {}
    setNetwork(n);
    setSigner(null);
    setAccount(null);
    setRoute({ page: "home" });
  };

  const connect = async (choice) => {
    try {
      const s = choice === "injected" ? await connectInjected(network) : devSigner(network, Number(choice));
      setSigner(s);
      setAccount(await s.getAddress());
    } catch (e) {
      setToast({ kind: "error", text: errorMessage(e) });
    }
  };

  /** Run a transaction with a pending indicator and a toast. */
  const tx = async (label, send) => {
    if (!write) return setToast({ kind: "error", text: "Connect a wallet first." });
    setBusy(label);
    try {
      const sent = await send(write);
      await sent.wait();
      setToast({ kind: "ok", text: `${label}: confirmed` });
      refresh();
      return true;
    } catch (e) {
      setToast({ kind: "error", text: `${label}: ${errorMessage(e)}` });
      return false;
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const ctx = { network, read, write, account, tx, refresh, version, chainNow: () => Math.floor(Date.now() / 1000) + chainOffset };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setRoute({ page: "home" })}>
          <span className="logo">XI</span>
          <span>
            OpenXI
            <small>Transparent fantasy sports on Hedera</small>
          </span>
        </button>
        <div className="wallet">
          <select value={network} onChange={(e) => switchNetwork(e.target.value)} aria-label="Network">
            {Object.entries(NETWORKS)
              .filter(([k]) => getDeployment(k) && (k !== "localhost" || IS_LOCAL_HOST))
              .map(([k, n]) => (
              <option key={k} value={k}>
                {n.label}
              </option>
            ))}
          </select>
          {account ? (
            <>
              <span className="chip">{fmtFan(balance)} FAN</span>
              {claimable > 0n && (
                <button className="btn win" disabled={!!busy} onClick={() => tx("Claim winnings", (w) => w.league.claim())}>
                  Claim {fmtFan(claimable)} FAN
                </button>
              )}
              <button className="btn ghost" disabled={!!busy} onClick={() => tx("Faucet", (w) => w.fan.claimFaucet())}>
                Get free FAN
              </button>
              <span className="chip addr" title={account}>
                {shortAddr(account)}
              </span>
            </>
          ) : (
            <select value="" onChange={(e) => connect(e.target.value)} aria-label="Connect wallet" className="connect">
              <option value="" disabled>
                Connect wallet
              </option>
              <option value="injected">MetaMask / EVM wallet</option>
              {network === "localhost" && DEV_KEYS.map((_, i) => <option key={i} value={i}>{`Dev account #${i + 1}`}</option>)}
            </select>
          )}
        </div>
      </header>

      {busy && <div className="busy">{busy}… waiting for confirmation</div>}
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}

      <main key={network}>
        {!deployed ? (
          <div className="empty">
            <h2>Not deployed on {NETWORKS[network].label}</h2>
            <p>
              Run <code>npx hardhat run scripts/deploy.js --network {network}</code> (see README), then reload.
            </p>
          </div>
        ) : route.page === "home" ? (
          <MatchList ctx={ctx} open={(matchId) => setRoute({ page: "match", matchId })} />
        ) : (
          <MatchView ctx={ctx} matchId={route.matchId} back={() => setRoute({ page: "home" })} />
        )}
      </main>

      <footer>
        Free-to-play. FAN is a testnet game token with no monetary value. Every rule, team, score and payout is on-chain
        and can be verified.
      </footer>
    </div>
  );
}

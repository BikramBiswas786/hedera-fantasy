# OpenXI: transparent fantasy cricket and football on Hedera

A Dream11-style daily fantasy game for **Premier League football and international cricket**, where the rules,
teams, scores and payouts live on Hedera. Users can check every step themselves instead of trusting the operator.

> Testnet only. Entry fees and prizes are paid in **testnet HBAR**, which has no monetary value. Get some free from
> the [Hedera portal faucet](https://portal.hedera.com/faucet).

**Live app:** https://openxi-fantasy.vercel.app (Hedera testnet). Every push to `main` redeploys it.

The current contract and HCS topic addresses are in [`deployments.json`](deployments.json) and on the app's 🔍 Verify tab.

## Real fixtures, automatically

The [Sync matches](.github/workflows/sync-matches.yml) workflow runs every hour on GitHub Actions:

| Step | Premier League | International cricket (T20I, ODI) |
|---|---|---|
| Fixtures and squads | [Fantasy Premier League API](https://fantasy.premierleague.com/api/bootstrap-static/) (public) | [CricketData.org](https://cricketdata.org) (free API key) |
| Credits | FPL prices: £4.0m is 7.0 credits, £10.0m and up is 11.0 | By role (the feed has no player ratings) |
| Imported | Fixtures starting in the next 14 days | Same, for internationals and major T20 leagues (IPL, BBL/WBBL, PSL, CPL, SA20, The Hundred and more) |
| Results | Per-player stats once FPL marks the fixture finished | Scorecard once the match has ended |
| Rules | `football-epl-v1` | `cricket-t20-v1`, `cricket-odi-v1` |

It also abandons postponed or no-result matches, which refunds every contest, and settles contests once the
dispute window has passed. `DRY_RUN=1` logs what it would do without sending transactions.

Feed limits to know about: FPL publishes no shots, chances or passes, so the Premier League rules score goals,
assists, clean sheets, saves, tackles, clearances/blocks/interceptions and cards. CricketData scorecards have no
dot balls, and a player who neither bats, bowls nor takes part in a dismissal misses the playing-XI bonus.

## What it does (Dream11 feature parity)

| Dream11 | OpenXI |
|---|---|
| Pick 11 players with 100 credits | Same. The contract rejects any team over 100 credits |
| Max 7 players from one team | Same, enforced on-chain |
| Role limits (cricket WK/BAT/AR/BOWL 1-8 each; football 1 GK, 3-5 DEF, 3-5 MID, 1-3 FWD) | Same, enforced on-chain |
| Captain 2x, vice-captain 1.5x | Same. The contract computes the multiplied score |
| Up to 20 teams per match, editable until the deadline | Same. Teams lock automatically at the on-chain start time |
| Mega contests, head-to-head, small leagues | Five pools for every match: free mega (sponsored), 250-team grand pool (up to 500 HBAR), head-to-head, 5-team and 10-team |
| Private / friends' contests | **Anyone can create a pool**: duo, 5, 10, 25, 50, 100, 250 or 300 teams, any entry fee, prize split and optional prize money, with a share link |
| Spots, prize breakdown, % winners, max entries per user | Shown on every contest card |
| Ties share the prizes for their ranks | Same rule, implemented in the contract |
| Unfilled contests refunded | Anyone can trigger the refund on-chain |
| "Selected by %" | Computed from the public on-chain teams |
| Leaderboard and team preview | Yes, with a pitch view |
| Points system | Dream11-style T20, ODI and football tables in `scoring/rules.mjs` |
| Cash contests | Entry fees and prizes in testnet HBAR, paid straight from and to your wallet |

## What's more transparent than Dream11

1. **Squads and credits are committed on-chain** when a match is created and can't change afterwards.
2. **The scoring rules are hashed on-chain** (`rulesHash`), so the rules for a match can't be swapped later.
3. **Raw match stats are published on Hedera Consensus Service (HCS)** with a consensus timestamp. Their hash
   (`statsHash`) goes on-chain with the points.
4. **The scoring code is open source** (`scoring/index.mjs`). The oracle, the CLI verifier and the web app all run
   the same code, and the app's 🔍 Verify tab re-runs it in your browser.
5. **The contract computes team scores itself.** Settlement takes a ranking and **reverts unless it is complete and
   correctly sorted**, so nobody, including the operator, can choose the winners.
6. **There is a dispute window.** Results can only be corrected for a fixed period after posting. Every version is
   emitted as an event, so corrections are public.
7. **Anyone can settle, cancel and refund.** The operator can't hold prizes back.
8. **Anyone can audit a match** with `scripts/verify.js`, which checks the rules, squad, stats, points and every
   contest ranking.

## Layout

```
contracts/FantasyLeague.sol   matches, teams, contests (paid in HBAR), results, verified settlement, refunds, claims
scoring/                      open-source points engine + rules + HCS reader (shared by scripts and app)
scripts/sync.js               imports real fixtures, posts results, settles (run hourly by GitHub Actions)
scripts/feeds/                Fantasy Premier League and CricketData.org adapters
scripts/                      deploy, verify, demo and manual match scripts
data/                         demo fixtures (fictional teams and players) with squads and raw stats
app/                          React + Vite web app (ethers v6, MetaMask or local dev accounts)
test/                         contract and feed tests
.github/workflows/            testnet deploy and hourly match sync
```

## Run it locally

```bash
npm install
(cd app && npm install)
npm run compile        # if the compiler download is blocked: USE_SOLCJS=1 npm run compile
npm test

npm run node           # terminal 1: local chain
npm run demo:local     # terminal 2: deploy, create 2 matches, seed 5 users with teams
npm run app            # terminal 3: open http://localhost:5173, pick "Dev account #1..5"

npm run demo:finish    # fast-forward past the deadline, post results, settle
MATCH_ID=1 npx hardhat run scripts/verify.js --network localhost
```

## Run it on GitHub Actions (recommended)

1. In the repo's **Settings → Secrets and variables → Actions**, add `HEDERA_ACCOUNT_ID` and `HEDERA_PRIVATE_KEY`
   (an ECDSA testnet account from <https://portal.hedera.com>), and optionally `CRICKETDATA_API_KEY`.
2. Run **Actions → Deploy to Hedera testnet**. It deploys the contract, creates the HCS topic and commits the new
   addresses, which redeploys the web app.
3. **Sync matches** then runs every hour. Run it by hand with "dry run" ticked to preview what it will import.

The operator account funds each free mega contest (10 HBAR by default, `MEGA_POOL`) and pays transaction fees, so
top it up from the portal faucet now and then.

## Deploy to Hedera testnet from your computer

1. Create a free testnet account at <https://portal.hedera.com> (ECDSA key). It comes with testnet HBAR.
2. `cp .env.example .env`, then fill in `HEDERA_ACCOUNT_ID` and `HEDERA_PRIVATE_KEY`.
3. Deploy. This also creates the HCS topic used for squads and stats:
   ```bash
   npm run deploy:testnet
   ```
4. Create a match (squad metadata is published to HCS), plus its three contests:
   ```bash
   MATCH=cricket-demo START_IN_MINUTES=120 npm run match:testnet
   ```
5. After the match, run `npm run testnet:finish`. It waits for each match to start, publishes stats and points,
   waits out the dispute window, then settles every contest. Or do the steps by hand:
   ```bash
   MATCH=cricket-demo MATCH_ID=1 npm run results:testnet
   MATCH_ID=1 npm run settle:testnet
   MATCH_ID=1 npm run verify:testnet
   ```
6. Copy the updated `deployments.json` into `app/src/deployments.json` (the scripts do this automatically), then
   `npm run app` and select "Hedera Testnet". MetaMask is added to Hedera testnet (chain 296) automatically.

The contract and the HCS topic can both be viewed on [HashScan](https://hashscan.io/testnet).

## Adding another competition

Write an adapter in `scripts/feeds/` with `upcoming(from, to)` returning `{ meta, startTime }` for each fixture and
`result(meta, startTime, now)` returning `null`, `{ abandon: true }` or `{ stats }`, then register it in
`scripts/sync.js`. `meta` holds `sport`, `rulesId`, `competition`, `name`, `teams`, `short`, `source.key` and
`players` (`name`, `side` 0/1, `role` 0-3, `credits` in tenths, `ref`); stats are keyed by player index with the
field names used in `scoring/index.mjs`. `scripts/dev/mock-fpl.cjs` shows how to test sync against local files.

## Known limits and next steps

- **Teams are public before the deadline.** Dream11 hides other users' teams until the match starts, but on-chain
  data is public. A commit-reveal scheme (commit a team hash, reveal after the deadline) would fix this, at the
  cost of an extra transaction per team.
- **Contest size.** Settlement checks every entry in one transaction, which handles a few hundred entries within
  Hedera's gas limit. Mega contests with thousands of entries would need a Merkle-root or batched settlement.
- **The oracle is still one key.** Data is verifiable after the fact, and the dispute window gives time to catch
  errors. For stronger guarantees, require several independent oracles or a multisig to agree.
- **Live points during the match** aren't implemented yet. The oracle could post interim (non-final) points to HCS.
- **Wallets.** MetaMask on Hedera testnet works today; HashPack could be supported through WalletConnect.
- **Legal.** Keep this on testnet. Paid contests with mainnet HBAR would be real-money fantasy gaming, which India's
  Promotion and Regulation of Online Gaming Act, 2025 bans, and many other countries regulate.

## Host the web app on Vercel

`vercel.json` builds the app in `app/`, and `.vercelignore` uploads only `app/`, `scoring/` and `data/`, never `.env`.

```bash
npx vercel login
npx vercel --prod
```

# OpenXI: transparent fantasy cricket and football on Hedera

A free-to-play, Dream11-style daily fantasy game where the rules, teams, scores and payouts live on Hedera.
Users can check every step themselves instead of trusting the operator.

> FAN is a testnet game token with no monetary value. This project is free-to-play only.

## What it does (Dream11 feature parity)

| Dream11 | OpenXI |
|---|---|
| Pick 11 players with 100 credits | Same. The contract rejects any team over 100 credits |
| Max 7 players from one team | Same, enforced on-chain |
| Role limits (cricket WK/BAT/AR/BOWL 1-8 each; football 1 GK, 3-5 DEF, 3-5 MID, 1-3 FWD) | Same, enforced on-chain |
| Captain 2x, vice-captain 1.5x | Same. The contract computes the multiplied score |
| Up to 20 teams per match, editable until the deadline | Same. Teams lock automatically at the on-chain start time |
| Mega contests, head-to-head, small leagues | All three are created for every match |
| Spots, prize breakdown, % winners, max entries per user | Shown on every contest card |
| Ties share the prizes for their ranks | Same rule, implemented in the contract |
| Unfilled contests refunded | Anyone can trigger the refund on-chain |
| "Selected by %" | Computed from the public on-chain teams |
| Leaderboard and team preview | Yes, with a pitch view |
| Points system | Dream11-style T20 and football tables in `scoring/rules.mjs` |

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
contracts/FantasyLeague.sol   matches, teams, contests, results, verified settlement, refunds, claims
contracts/FanToken.sol        free FAN game token with a daily faucet
scoring/                      open-source points engine + rules + HCS reader (shared by scripts and app)
scripts/                      deploy, create-match, post-results, settle, verify, local demo
data/                         demo fixtures (fictional teams and players) with squads and raw stats
app/                          React + Vite web app (ethers v6, MetaMask or local dev accounts)
test/                         contract tests
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

## Deploy to Hedera testnet

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
5. After the match, publish stats and points. Once the dispute window has passed, settle:
   ```bash
   MATCH=cricket-demo MATCH_ID=1 npm run results:testnet
   MATCH_ID=1 npm run settle:testnet
   MATCH_ID=1 npm run verify:testnet
   ```
6. Copy the updated `deployments.json` into `app/src/deployments.json` (the scripts do this automatically), then
   `npm run app` and select "Hedera Testnet". MetaMask is added to Hedera testnet (chain 296) automatically.

Contracts, the token and the HCS topic can all be viewed on [HashScan](https://hashscan.io/testnet).

## Adding real matches

Each match needs two files in `data/`:

- `<id>.match.json`: `sport`, `rulesId`, team names, and `players` (`name`, `side` 0/1, `role` 0-3, `credits` in tenths).
- `<id>.stats.json`: raw per-player stats keyed by player index. The field names are in `scoring/index.mjs`.

To go live, write a small adapter that turns a sports data API (for example CricAPI, SportMonks or API-Football)
into these two files, then run the same scripts.

## Known limits and next steps

- **Teams are public before the deadline.** Dream11 hides other users' teams until the match starts, but on-chain
  data is public. A commit-reveal scheme (commit a team hash, reveal after the deadline) would fix this, at the
  cost of an extra transaction per team.
- **Contest size.** Settlement checks every entry in one transaction, which handles a few hundred entries within
  Hedera's gas limit. Mega contests with thousands of entries would need a Merkle-root or batched settlement.
- **The oracle is still one key.** Data is verifiable after the fact, and the dispute window gives time to catch
  errors. For stronger guarantees, require several independent oracles or a multisig to agree.
- **Live points during the match** aren't implemented yet. The oracle could post interim (non-final) points to HCS.
- **FAN is an EVM ERC-20.** It could become a native Hedera Token Service (HTS) token, and HashPack could be supported
  through WalletConnect.
- **Legal.** Keep this free-to-play. India's Promotion and Regulation of Online Gaming Act, 2025 bans real-money
  online games, including paid fantasy sports. Check the law in each country before adding anything of value.

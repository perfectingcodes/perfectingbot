# perfectingbot

Scans meme-coin pairs on **Robinhood Chain (4663)** and **BNB Chain (56)**, scores them against
a tiered evidence model, and explains every verdict in plain English.

It flags setups. It does not place trades — see [Execution](#execution).

## Run it

```bash
npm install
npm run replay     # offline: proves the decision logic, no key or RPC needed
npm run doctor     # preflight: RPCs, launchpad firehose, FOMO plan tier
npm run dev        # live
```

`state/dashboard.html` is rewritten on every evaluation and auto-refreshes every 15s.

## How it decides

Evidence is grouped into three tiers, weighted by how hard each is to fake.
A tier-1 **veto** rejects a token no matter how good everything else looks.

| Tier | Budget | What it checks |
|---|---|---|
| **1 · on-chain truth** | 55 pts | honeypot probe, pool liquidity, holder concentration, launch bundling + same-funder clusters, fresh-wallet share, LP burn/lock, LP removal, mint function, ownership renounce, dev selling, 5m buy/sell flow |
| **2 · smart money** | 35 pts | how many *distinct* tracked wallets bought in the window, their 7d/30d track record (not 24h), and buy size relative to that trader's own book |
| **3 · social** | 10 pts | mention *acceleration* in σ above the token's own baseline — never raw volume |

Three rules do most of the work:

- **Unknown is not a pass.** Anything unmeasured costs half its points and is listed
  under BLIND SPOTS. A token nobody could check never scores like one that passed.
- **Vetoes ignore the score.** The replay's `MOONX` scores 71 and is still `REJECT`,
  because 86% of early flow was bundled into the launch block.
- **Wallets, not prints.** One wallet buying five times is one signal.

## What this depends on

- **[fomoapi.io](https://fomoapi.io/docs)** for the social/smart-money layer — independent,
  *not affiliated with fomo.family*. The `wss://api.fomoapi.io/ws/trades` on-chain stream
  (Growth tier+) is what provides the ~15s lead over the app feed. On a lower tier the
  stream announces its own delay and the timing edge is gone; the bot logs that loudly.
- **A dedicated RPC for both chains.** This is a hard requirement, not a nice-to-have —
  see below.

## RPC: read this before running live

Verified against the public endpoints on 2026-09-06:

- `rpc.mainnet.chain.robinhood.com` **ignores the `topics` filter** and returns every log
  in range. A PairCreated query over 50 blocks came back with 4,595 logs. Code that trusts
  the server-side filter will produce wrong verdicts, not empty ones.
  `src/chain/logs.ts` re-filters every result client-side for this reason.
- The same endpoint returns `429 Too Many Requests` during an ordinary log scan, and
  oversized-response errors on wide ranges.
- `bsc-dataseed.binance.org` rejects wide ranges outright (`Request exceeds defined limit`).

`getLogsChunked` adapts its range and backs off, and reports `complete: false` when it
could not scan the whole window — an incomplete scan can *condemn* a token but never
*clear* one. Still: tier 1 is the biggest edge, and it is only as good as the RPC.
Use Alchemy, Chainstack, OrbitFlare, SolidRPC, or NodeFlare and set `RH_RPC_URL` / `BSC_RPC_URL`.

## Launchpads

There's no integration with RobinFun, NOXA, Odyssey, or Four.meme, and none is needed.
Every one of them ends up deploying a pool, so `src/chain/launchpad.ts` watches
`PairCreated` (V2) and `PoolCreated` (V3) across *all* factories on both chains. New venues
are covered the day they launch, and no vendor can rate-limit us out of tier 1.

## Social

No provider is hardcoded, because the useful quantity is the derivative and that is ours
to compute. Point `SOCIAL_API_URL` at anything that returns a mention count (X API v2,
LunarCrush, TweetScout, your own scraper); `SocialTracker` samples it and differentiates.
Unset, tier 3 reads `unknown` and costs points — it never silently reads as neutral.

## Execution

`src/exec/` is an interface with three implementations:

- `FlagOnlyExecutor` — default. Reports, holds nothing.
- `PaperExecutor` — same interface, no funds. **Run this until the log earns real size.**
- `LiveExecutor` — **throws by design.** Not implemented.

Everything upstream is free to be wrong about. Signing swaps is the one step that isn't
reversible, so it stays unwired deliberately. Wiring it means a funded signer, slippage and
min-out bounds, gas policy, nonce handling, and an exit path (stop / trail / time-stop) at
least as tested as the entry.

`RiskManager` sits in front of every executor regardless: buys are scaled to a fraction of
the mirrored size (never dollar-for-dollar), clamped to a % of bankroll, capped by
concurrent positions, gated by per-token cooldown, and halted by a daily-loss kill switch.

## Tuning

Every threshold is an env var (see `.env.example`). Every evaluation — rejects included —
is appended to `state/setups.jsonl`. The rejects are the interesting ones: they're how you
find out whether the gates are too tight or too loose before money is involved.

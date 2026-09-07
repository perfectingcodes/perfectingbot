# perfecting

Scans meme-coin pairs on **Robinhood Chain (4663)**, **Solana**, **Base (8453)** and
**BNB Chain (56)**, scores them against a tiered evidence model, and explains every
verdict in plain English.

It flags setups. It does not place trades — see [Execution](#execution).

## Run it

```bash
npm install
npm run replay     # offline: proves the decision logic, no key or RPC needed
npm run doctor     # preflight: RPCs, launchpad firehose, FOMO plan tier
npm run dev        # dashboard on :5173 + scanner (scanner needs a key)
```

| script | needs | does |
|---|---|---|
| `replay` | nothing | runs the decision logic on fixed scenarios |
| `serve` | nothing | dashboard only |
| `doctor` | RPCs (key optional) | preflight checks |
| `dev` | key for the scanner half | dashboard + scanner |
| `scanner` | key | scanner only, no web server |
| `build` + `start` | key | compiled build, for hosting |

`state/setups.jsonl` is the single source of truth. The dashboard is a view over it, so
the scanner never renders HTML on the hot path, and the dashboard works with the scanner off.

## Design

A dark-only system with an explicit token layer, built so the visual language carries
information rather than decoration.

**Colour is assigned by job, not by taste.**

- **Status hues are reserved** for verdicts — good / warning / critical, used for
  SETUP / WATCH / REJECT and for pass / warn / fail on individual checks. They are never
  reused as a series colour, so a colour never impersonates a state.
- **Three categorical hues** identify the tiers: blue (on-chain truth), orange (smart
  money), aqua (social). These are the validated first three slots of the reference
  categorical palette, and they were re-checked against *this* surface rather than
  assumed — all-pairs CVD ΔE 9.4, normal-vision ΔE 20.9, all three ≥3:1 contrast.
  Every meter is also directly labelled, so hue never carries identity alone.
- **Brand green is chrome only** — wordmark, avatar ring, focus, active nav. It never
  touches data, which keeps it clear of the status green.
- **Unmeasured is grey, never green.** A blind spot must not read as a pass.

The score is a plain number, not a gauge or donut: a single value's best chart is the
number itself. The tier meters beside it are where the shape actually lives — three
thin tracks showing earned/max per tier, so you can see *where* a score came from
without expanding anything. Hovering any meter, sparkline bar, or gate mix segment
gives you the underlying counts.

Layout is a fixed left rail (identity, nav with live counts, scanner status) against a
scrolling main column with a sticky filter bar. Type is a sans stack for UI and mono
strictly for data — addresses, scores, counts — which makes numbers line up and keeps
prose readable. Reduced-motion is honoured; the whole thing collapses to a single
column under 900px.

Your own images drive the identity — drop them into `public/assets/`:

| file | where it appears |
|---|---|
| `avatar.png` | the agent's face in the sidebar, and the browser tab icon |
| `banner.png` | behind the sidebar identity block under a gradient veil, and as the empty-state showcase |

Both are optional. `/api/assets` reports what exists in one call, and the UI falls back
to a labelled placeholder naming the missing file rather than showing a broken image.

The terminal gets the same identity: `src/banner.ts` prints an ASCII reaching-hands
motif on boot, with colour suppressed when stdout isn't a TTY or `NO_COLOR` is set.

## Dashboard

Five views at `http://localhost:5173`, all sharing the filter bar (chain, verdict,
min score, time window, free-text search over tokens/addresses/traders):

- **Opportunities** — every evaluation with its full evidence breakdown, tier by tier.
- **Traders** — ranked by *hit rate in your own log*: the share of a trader's observed
  buys that cleared every hard gate. That is a different question from PnL, and a more
  useful one for deciding who to follow. Traders under 3 appearances are down-weighted
  so one lucky call can't top the board. The FOMO leaderboard is shown separately below
  it as the external view.
- **Tokens** — one row per token with a sparkline of every evaluation over time, so you
  can see a read change as evidence arrived.
- **Gates** — which checks actually reject things. A gate that never fails isn't
  protecting you; one that vetoes everything is mistuned. High `unknown` counts point at
  a missing data source, which is usually the biggest available improvement.
- **Config** — the live thresholds this process is running with.

JSON API behind it: `/api/setups`, `/api/traders`, `/api/tokens`, `/api/gates`,
`/api/summary`, `/api/leaderboard`, `/api/health` — all accept the same filter params.

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

## How it finds coins

Two independent paths, because they answer different questions.

**1. Smart-money stream** — `wss://api.fomoapi.io/ws/trades`, which carries
**Robinhood Chain and Solana only**. This is the low-latency path: a tracked wallet buys,
we evaluate immediately, ~15s before the app feed. It fires only when your watchlist acts,
so it goes quiet for long stretches.

> Subscribing a chain that stream does not carry (bsc, base) gives you a socket that
> connects, stays silent forever, and looks perfectly healthy. `config.streamChains` exists
> to stop that.

**2. Volume-led discovery** — polls FOMO's token boards (`trending`, `graduated`) across
every configured network every 90s, filters to tokens above a 24h-volume floor, and works
down them highest-volume-first. This is what keeps the scanner busy continuously, and it is
the only way Base and BSC are reached at all.

Discovery candidates enter with an **empty buyer list**, so tier 2 scores near zero and the
card reads *"found by volume, not by a tracked wallet — no smart-money confirmation at
all"*. That is deliberate: volume is a reason to look, never a reason to buy. Filter the
dashboard by **found by → volume / smart money** to see each path on its own.

### Discovery costs real money — read this before widening it

Each evaluation spends ~3 FOMO credits (stats + holders + devs), and discovery never
stops. The arithmetic is unforgiving:

| interval | evals/cycle | credits/day | credits/month | fits |
|---|---|---|---|---|
| 90s | 8 | 24,960 | 748,800 | **nothing** — 15× Scale |
| 300s | 4 | 4,032 | 120,960 | Scale |
| **900s** | **3** | **1,056** | **31,680** | **Growth, Scale** ← default |

My first cut at these defaults was 90s/8, which would have drained a Growth plan in two
days. The shipped defaults are the bottom row.

Two guards make that safe rather than merely documented:

- `CREDIT_DAILY_BUDGET` (default 1,500) is a hard ceiling. Discovery pauses when it's
  spent and resumes at UTC midnight. **The stream path is exempt** — it's the valuable
  signal and fires rarely, so discovery yields its budget to it, never the reverse.
- `DISCOVERY_REVISIT_MIN` stops the same token being re-evaluated on every cycle.

`npm run doctor` prints your projected burn and which plan tiers it fits, so you find out
before the bill does.

## Solana

Solana is not EVM, so tier 1 is a different implementation, not a port. `src/chain/solana.ts`
talks plain JSON-RPC (no `@solana/web3.js` — three read methods don't justify the dependency):

| check | why it matters |
|---|---|
| **freeze authority** | *the* Solana honeypot — if still live, the issuer can freeze your token account and stop you selling. Vetoes. |
| **mint authority** | if still live, supply can be inflated out from under holders |
| **top-10 concentration** | via `getTokenLargestAccounts`. Note it returns *accounts*, not people — one actor across many accounts means this can only ever **understate** concentration. Vetoes. |

Verified against mainnet: USDC reads both authorities live (Circle retains them), BONK reads
both revoked. Launch-bundling and same-funder clustering are **not implemented for Solana
yet**, and that check reports `unknown` — costing score — rather than quietly passing.

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
- `bsc-dataseed.binance.org` and `mainnet.base.org` reject wide ranges outright
  (`Request exceeds defined limit`).
- `api.mainnet-beta.solana.com` answers `getAccountInfo` fine but returns **HTTP 429 for
  `getTokenLargestAccounts`** even on a single call, so holder concentration reads as
  unmeasured. Use Helius, QuickNode, or Triton.

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

## Hosting on Replit

It works, with three things that are easy to get wrong:

1. **Reserved VM, not Autoscale.** `.replit` sets `deploymentTarget = "vm"` deliberately.
   Autoscale suspends idle instances, which kills the WebSocket stream — the dashboard
   would keep loading while the scanner quietly saw nothing. This is the failure mode
   worth avoiding, because it looks fine.
2. **Put the key in Secrets, not `.env`.** Tools → Secrets → `FOMO_API_KEY`. Replit
   injects secrets as environment variables, so `process.env.FOMO_API_KEY` picks them up
   with no code change. Secrets added while the app is running are not seen by the running
   process — Stop then Run, or `kill 1` in the shell. Never commit a `.env`; it's gitignored.
3. **The filesystem is ephemeral.** A redeploy wipes `state/setups.jsonl` and your whole
   tuning history with it. Set `STATE_DIR` to a mounted volume if you want it to survive.

Secrets to set: `FOMO_API_KEY`, `RH_RPC_URL`, `BSC_RPC_URL`, optionally `MODE`,
`BANKROLL_USD`, `ALERT_WEBHOOK_URL`, `SOCIAL_API_URL`.

Replit's shared egress IPs make the public RPC rate-limiting *worse* than it is locally,
and it already fails here — dedicated RPC URLs are not optional on a host.

The build runs `tsc` and starts `dist/main.js`, so nothing depends on Node's experimental
type-stripping. `src/ws-compat.ts` falls back to the `ws` package if the runtime has no
global `WebSocket`, so an older Node on the host can't silently cost you the trade stream.

`main.ts` starts the dashboard first and the scanner second: a missing key or a bad RPC
takes down the scanner, not the web server, so a deploy never crash-loops on config and
the dashboard tells you it's idle.

## Tuning

Every threshold is an env var (see `.env.example`). Every evaluation — rejects included —
is appended to `state/setups.jsonl`. The rejects are the interesting ones: they're how you
find out whether the gates are too tight or too loose before money is involved.

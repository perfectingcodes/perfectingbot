import type { Chain } from "./types.ts";

const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export const config = {
  fomoKey: process.env.FOMO_API_KEY ?? "",
  fomoBase: "https://api.fomoapi.io",
  webhook: process.env.ALERT_WEBHOOK_URL ?? "",
  mode: (process.env.MODE ?? "flag") as "flag" | "paper" | "live",

  chains: {
    robinhood: { id: 4663, rpc: process.env.RH_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com" },
    bsc: { id: 56, rpc: process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org" },
    base: { id: 8453, rpc: process.env.BASE_RPC_URL ?? "https://mainnet.base.org" },
    solana: { id: 1399811149, rpc: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com" },
  } satisfies Record<Chain, { id: number; rpc: string }>,

  /**
   * Only robinhood and solana are carried on FOMO's /ws/trades on-chain stream.
   * Everything else is reached through volume discovery, not streaming — subscribing
   * a chain the stream does not carry just yields a silent, permanently empty socket.
   */
  streamChains: ["robinhood", "solana"] as Chain[],

  /**
   * FOMO credit budget. Discovery is the expensive path — each evaluation costs ~3
   * credits and the polling never stops — so it runs against a hard daily ceiling.
   * Default 1,500/day fits a Growth plan (50k/month) with headroom.
   *
   * The stream path is exempt: it is the valuable signal and fires rarely, so
   * discovery yields its budget to it rather than the other way round.
   */
  credits: {
    dailyBudget: num(process.env.CREDIT_DAILY_BUDGET, 1_500),
  },

  /** Volume-led discovery: which networks to poll, how often, and how deep. */
  discovery: {
    enabled: (process.env.DISCOVERY ?? "on") !== "off",
    networks: (process.env.DISCOVERY_NETWORKS ?? "robinhood,solana,base,bsc").split(",").map((s) => s.trim()).filter(Boolean) as Chain[],
    boards: (process.env.DISCOVERY_BOARDS ?? "trending,graduated").split(",").map((s) => s.trim()).filter(Boolean),
    intervalMs: num(process.env.DISCOVERY_INTERVAL_SEC, 900) * 1000,
    /** Evaluate at most this many per cycle, highest 24h volume first. */
    perCycle: num(process.env.DISCOVERY_PER_CYCLE, 3),
    minVolume24hUsd: num(process.env.DISCOVERY_MIN_VOLUME, 50_000),
    /** Don't re-evaluate the same token more often than this. */
    revisitMs: num(process.env.DISCOVERY_REVISIT_MIN, 20) * 60_000,
  },

  /** Signal thresholds. These are the knobs worth tuning against replayed history. */
  signal: {
    /** Distinct tracked wallets that must buy the same token to call it consensus. */
    minDistinctBuyers: num(process.env.MIN_BUYERS, 2),
    /** Window those buys must land inside. */
    consensusWindowMs: num(process.env.CONSENSUS_WINDOW_MIN, 20) * 60_000,
    /** Ignore dust prints from tracked wallets. */
    minBuyUsd: num(process.env.MIN_BUY_USD, 250),
  },

  /** Hard risk gates. A setup must clear every one of these. */
  gates: {
    minLiquidityUsd: num(process.env.MIN_LIQUIDITY_USD, 25_000),
    maxTop10Percent: num(process.env.MAX_TOP10_PCT, 55),
    minHolders: num(process.env.MIN_HOLDERS, 150),
    /** Reject if the dev wallet has sold more than this share of its position. */
    maxDevSoldPercent: num(process.env.MAX_DEV_SOLD_PCT, 20),
    /** Reject when sell pressure already dominates the 5m window. */
    minBuySellRatio5m: num(process.env.MIN_BUY_SELL_RATIO, 1.1),
  },

  /** Position sizing and circuit breakers. Applied before any executor sees an order. */
  risk: {
    bankrollUsd: num(process.env.BANKROLL_USD, 1_000),
    maxPositionPct: num(process.env.MAX_POSITION_PCT, 2),
    /** Never mirror size-for-size; take this fraction of the smart wallet's notional. */
    mirrorFraction: num(process.env.MIRROR_FRACTION, 0.05),
    maxConcurrentPositions: num(process.env.MAX_CONCURRENT, 5),
    dailyLossLimitPct: num(process.env.DAILY_LOSS_LIMIT_PCT, 10),
    /** Don't re-enter the same token for this long after an exit or a flag. */
    cooldownMs: num(process.env.COOLDOWN_MIN, 60) * 60_000,
  },
} as const;

export function assertRunnable() {
  if (!config.fomoKey) throw new Error("FOMO_API_KEY is required for live mode. Use `npm run replay` to exercise the pipeline offline.");
  if (config.mode === "live") throw new Error("MODE=live is not implemented. See src/exec/live.ts.");
}

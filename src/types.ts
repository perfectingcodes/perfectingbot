export type Chain = "robinhood" | "bsc" | "base" | "solana";

/** Solana is not EVM, so the RPC-level checks differ entirely. */
export const EVM_CHAINS = ["robinhood", "bsc", "base"] as const;
export type EvmChain = (typeof EVM_CHAINS)[number];
export const isEvm = (c: Chain): c is EvmChain => (EVM_CHAINS as readonly string[]).includes(c);

/**
 * Where a candidate came from. Stream candidates carry the timing edge and smart-money
 * consensus; discovery candidates are found by volume and have neither, which the
 * scoring reflects rather than papers over.
 */
export type Source = "stream" | "discovery";

/** Normalized buy/sell event, from either the on-chain stream or the app feed. */
export interface TradeEvent {
  chain: Chain;
  chainId: number;
  side: "buy" | "sell";
  trader: { wallet: string; handle?: string };
  token: { address: string; symbol?: string; mcap?: number };
  usdValue: number;
  amountToken?: number;
  txHash?: string;
  blockTs: number;
  seenAt: number;
  /** "onchain" leads the app feed by ~15s; "feed" is the app-level alert. */
  source: "onchain" | "feed";
}

export interface TokenStats {
  holders: number;
  top10HoldersPercent: number;
  windows: Record<string, {
    buys: number; sells: number;
    uniqueBuyers: number; uniqueSellers: number;
    buyVolumeUsd: number; sellVolumeUsd: number;
    netVolumeUsd: number; buySellRatio: number;
  } | undefined>;
}

export interface GateResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface Setup {
  token: TradeEvent["token"];
  chain: Chain;
  /** Distinct tracked wallets that bought inside the consensus window. */
  buyers: { wallet: string; handle?: string; usdValue: number; at: number }[];
  firstSeen: number;
  leadMs: number;
  priceUsd: number;
  source: Source;
  /** Populated for discovery candidates. */
  volume24hUsd?: number;
  marketCapUsd?: number;
  change24h?: number;
}

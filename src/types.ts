export type Chain = "robinhood" | "bsc";

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
}

import { parseAbiItem, toEventSelector, type Address, type Log } from "viem";
import { clientFor } from "./clients.ts";
import type { Chain } from "../types.ts";

export interface NewPair {
  chain: Chain;
  pair: Address;
  token0: Address;
  token1: Address;
  kind: "v2" | "v3";
  blockNumber: bigint;
  at: number;
}

const pairCreated = parseAbiItem("event PairCreated(address indexed token0, address indexed token1, address pair, uint)");
/** Robinhood Chain is an Arbitrum L2, where concentrated-liquidity DEXs are the norm —
 *  those emit PoolCreated, not PairCreated. Watching only V2 would miss the entire chain. */
const poolCreated = parseAbiItem("event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)");

/**
 * The launchpad firehose, without depending on any launchpad's API.
 *
 * RobinFun / NOXA / Odyssey / Four.meme all ultimately deploy a V2-style pool, and every
 * one of those emits PairCreated. Watching the log instead of N proprietary endpoints means
 * new venues are covered the day they launch, and no vendor can rate-limit us out of tier 1.
 */
export class LaunchpadWatcher {
  private unwatch: (() => void)[] = [];
  private handlers: ((p: NewPair) => void)[] = [];

  private chain: Chain;

  constructor(chain: Chain) { this.chain = chain; }

  onNewPair(h: (p: NewPair) => void) { this.handlers.push(h); }

  start() {
    const client = clientFor(this.chain);
    // No factory address filter: we want every venue on the chain, known or not.
    for (const [kind, event] of [["v2", pairCreated], ["v3", poolCreated]] as const) {
      // Same defence as getLogsChunked: verify topic0 ourselves rather than trusting
      // that the endpoint honoured the filter it was handed.
      const selector = toEventSelector(event as any).toLowerCase();
      this.unwatch.push(client.watchEvent({
        event: event as any,
        poll: true,
        pollingInterval: 2_000,
        onLogs: (logs) => {
          for (const log of logs as Log[]) {
            if (log.topics?.[0]?.toLowerCase() !== selector) continue;
            const args = (log as any).args;
            const pair = args?.pair ?? args?.pool;
            if (!pair) continue;
            const p: NewPair = {
              chain: this.chain,
              pair: pair as Address,
              token0: args.token0 as Address,
              token1: args.token1 as Address,
              kind,
              blockNumber: log.blockNumber ?? 0n,
              at: Date.now(),
            };
            for (const h of this.handlers) h(p);
          }
        },
        onError: (err) => console.warn(`[launchpad:${this.chain}:${kind}] watch error: ${String(err).slice(0, 140)}`),
      }));
    }
    console.log(`[launchpad:${this.chain}] watching PairCreated + PoolCreated across all factories`);
  }

  stop() { for (const u of this.unwatch) u(); this.unwatch = []; }
}

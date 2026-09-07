import { config } from "./config.ts";
import type { FomoClient } from "./fomo/client.ts";
import type { Chain, TradeEvent } from "./types.ts";

export interface BoardToken {
  rank?: number;
  token: { name?: string; symbol?: string; address: string };
  holders?: number;
  network?: string;
  priceUsd?: number;
  change24h?: number;
  marketCapUsd?: number;
  volume24hUsd?: number;
  fomoBuyers?: number;
}

const NETWORK_ALIAS: Record<string, Chain> = {
  robinhood: "robinhood", hood: "robinhood", rh: "robinhood", "4663": "robinhood",
  bsc: "bsc", bnb: "bsc", "56": "bsc",
  base: "base", "8453": "base",
  solana: "solana", sol: "solana", "1399811149": "solana",
};

/**
 * Volume-led discovery.
 *
 * The trade stream only fires when a wallet we track buys, which means long stretches
 * of nothing. This polls FOMO's token boards instead and works down them by 24h volume,
 * so the scanner always has something to look at — "where the volume is" rather than
 * "where our watchlist happened to click".
 *
 * Candidates from here carry no smart-money consensus and no timing edge, and the
 * scoring says so: they enter with an empty buyer list, so tier 2 scores near zero.
 * That is intended. Volume is a reason to *look*, never a reason to buy.
 */
export class Discovery {
  private lastSeen = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  stats = { cycles: 0, fetched: 0, queued: 0, skipped: 0, errors: 0, budgetSkips: 0 };
  private warnedBudget = false;

  private fomo: FomoClient;
  private onCandidate: (e: TradeEvent, meta: BoardToken) => Promise<unknown>;

  constructor(fomo: FomoClient, onCandidate: (e: TradeEvent, meta: BoardToken) => Promise<unknown>) {
    this.fomo = fomo;
    this.onCandidate = onCandidate;
  }

  start() {
    if (!config.discovery.enabled) { console.log("[discovery] disabled"); return; }
    console.log(`[discovery] polling ${config.discovery.boards.join(", ")} across ${config.discovery.networks.join(", ")} every ${config.discovery.intervalMs / 1000}s`);
    void this.cycle();
    this.timer = setInterval(() => void this.cycle(), config.discovery.intervalMs);
  }

  stop() { clearInterval(this.timer); }

  async cycle() {
    // Discovery yields to the budget; the stream path keeps whatever is left.
    if (this.fomo.overBudget) {
      this.stats.budgetSkips++;
      if (!this.warnedBudget) {
        console.warn(`[discovery] daily credit budget spent (${this.fomo.spentToday}/${config.credits.dailyBudget}) — pausing until UTC midnight. Raise CREDIT_DAILY_BUDGET or widen DISCOVERY_INTERVAL_SEC.`);
        this.warnedBudget = true;
      }
      return;
    }
    this.warnedBudget = false;
    this.stats.cycles++;
    let tokens: BoardToken[] = [];

    for (const board of config.discovery.boards) {
      try {
        const res = await this.fomo.tokenBoard(board);
        if ((res as any)?.available === false) continue;
        tokens.push(...(res.tokens ?? []));
      } catch (err) {
        this.stats.errors++;
        console.warn(`[discovery] board ${board} failed: ${String(err).slice(0, 120)}`);
      }
    }
    this.stats.fetched += tokens.length;

    // Keep only networks we actually scan, above the volume floor, best volume first.
    const wanted = new Set(config.discovery.networks);
    const ranked = tokens
      .map((t) => ({ t, chain: NETWORK_ALIAS[String(t.network ?? "").toLowerCase()] }))
      .filter((x): x is { t: BoardToken; chain: Chain } => !!x.chain && wanted.has(x.chain))
      .filter((x) => (x.t.volume24hUsd ?? 0) >= config.discovery.minVolume24hUsd)
      .sort((a, b) => (b.t.volume24hUsd ?? 0) - (a.t.volume24hUsd ?? 0));

    let queued = 0;
    for (const { t, chain } of ranked) {
      if (queued >= config.discovery.perCycle) break;
      if (this.fomo.overBudget) break;
      const key = `${chain}:${t.token.address.toLowerCase()}`;
      const last = this.lastSeen.get(key) ?? 0;
      if (Date.now() - last < config.discovery.revisitMs) { this.stats.skipped++; continue; }
      this.lastSeen.set(key, Date.now());
      queued++;
      this.stats.queued++;

      try {
        await this.onCandidate(this.toEvent(t, chain), t);
      } catch (err) {
        this.stats.errors++;
        console.error(`[discovery] ${t.token.symbol ?? key}: ${String(err).slice(0, 140)}`);
      }
    }

    if (queued) console.log(`[discovery] cycle ${this.stats.cycles}: ${ranked.length} above floor, evaluated ${queued} · credits today ${this.fomo.spentToday}/${config.credits.dailyBudget}`);
  }

  /** Board rows carry no trade, so the synthetic event has no wallet, tx or lead time. */
  private toEvent(t: BoardToken, chain: Chain): TradeEvent {
    const now = Date.now();
    return {
      chain,
      chainId: config.chains[chain].id,
      side: "buy",
      trader: { wallet: "" },
      token: { address: t.token.address, symbol: t.token.symbol, mcap: t.marketCapUsd },
      usdValue: 0,
      amountToken: undefined,
      txHash: undefined,
      blockTs: now,
      seenAt: now,
      source: "feed",
    };
  }
}

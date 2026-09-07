import { config } from "./config.ts";
import { FomoClient } from "./fomo/client.ts";
import { ConsensusTracker } from "./signals/consensus.ts";
import { analyze, type TraderQuality } from "./signals/analyze.ts";
import { assess, type Assessment } from "./signals/evidence.ts";
import { SocialTracker, NullSocialSource, HttpSocialSource } from "./signals/social.ts";
import { RiskManager } from "./risk.ts";
import { explain, oneLine } from "./explain.ts";
import { notify } from "./notify.ts";
import { recordSetup } from "./report.ts";
import type { Executor } from "./exec/types.ts";
import type { Setup, TradeEvent } from "./types.ts";

export class Engine {
  private tracker = new ConsensusTracker();
  private quality = new Map<string, TraderQuality>();
  private watchlist = new Set<string>();
  private evaluating = new Set<string>();
  private social: SocialTracker;
  readonly risk = new RiskManager();
  stats = { seen: 0, tracked: 0, candidates: 0, setups: 0, rejected: 0, entered: 0 };

  private fomo: FomoClient;
  private executor: Executor;

  constructor(fomo: FomoClient, executor: Executor) {
    this.fomo = fomo;
    this.executor = executor;
    const url = process.env.SOCIAL_API_URL;
    this.social = new SocialTracker(url ? new HttpSocialSource(url) : new NullSocialSource());
  }

  /**
   * Watchlist is built from the 7d and 30d boards, not 24h: durable PnL is the point.
   * The window each wallet ranked on is kept so scoring can tell the two apart.
   */
  async loadWatchlist(limit = 100) {
    for (const window of ["7d", "30d"] as const) {
      const { traders } = await this.fomo.leaderboard(window);
      for (const t of traders.slice(0, limit)) {
        const evm = t.wallets?.evm?.toLowerCase();
        if (!evm) continue;
        this.watchlist.add(evm);
        const prev = this.quality.get(evm);
        // Keep the better rank, and prefer the longer window as the label.
        if (!prev || (t.rank ?? 999) < (prev.rank ?? 999)) {
          this.quality.set(evm, { handle: t.handle, rank: t.rank, pnlUsd: t.pnlUsd, window });
        }
      }
    }
    console.log(`[engine] watching ${this.watchlist.size} wallets with 7d/30d track records`);
    return this.watchlist.size;
  }

  seedWatchlist(entries: { wallet: string; handle?: string; rank?: number; window?: string }[]) {
    for (const e of entries) {
      const w = e.wallet.toLowerCase();
      this.watchlist.add(w);
      this.quality.set(w, { handle: e.handle, rank: e.rank, window: e.window ?? "7d" });
    }
  }

  async handle(e: TradeEvent): Promise<{ setup: Setup; assessment: Assessment } | null> {
    this.stats.seen++;
    const wallet = e.trader.wallet.toLowerCase();
    if (!this.watchlist.has(wallet)) return null;
    this.stats.tracked++;

    const buyers = this.tracker.record(e);
    if (buyers.length < config.signal.minDistinctBuyers) return null;

    const key = `${e.chain}:${e.token.address}`;
    if (this.evaluating.has(key)) return null;

    const gate = this.risk.canEnter(key);
    // Still worth *reporting* a setup we can't take; only silence true duplicates.
    if (!gate.ok && (gate.reason === "already holding" || gate.reason?.startsWith("cooldown"))) return null;

    this.evaluating.add(key);
    try {
      this.stats.candidates++;
      const priceUsd = e.amountToken && e.amountToken > 0 ? e.usdValue / e.amountToken : 0;
      if (priceUsd <= 0) {
        console.warn(`[engine] ${key}: event carried no unit price, cannot value the pool — skipped`);
        return null;
      }

      const setup: Setup = {
        token: e.token, chain: e.chain, buyers, priceUsd,
        firstSeen: Math.min(...buyers.map((b) => b.at)),
        leadMs: Math.max(0, e.seenAt - e.blockTs),
      };

      const evidence = await analyze(this.fomo, e, buyers, this.quality, this.social, priceUsd);
      const assessment = assess(evidence);

      console.log(explain(setup, assessment));
      recordSetup(setup, assessment);

      if (assessment.label === "REJECT") { this.stats.rejected++; return { setup, assessment }; }
      this.stats.setups++;
      await notify(oneLine(setup, assessment));

      if (assessment.label === "SETUP" && this.executor.name !== "flag-only" && gate.ok) {
        const sizeUsd = this.risk.sizeFor(Math.max(...buyers.map((b) => b.usdValue)));
        if (sizeUsd > 0) {
          const fill = await this.executor.enter({ setup, sizeUsd }, priceUsd);
          if (fill) { this.risk.onEnter(key); this.stats.entered++; }
        }
      } else if (assessment.label === "SETUP" && !gate.ok) {
        console.log(`  (not taken: ${gate.reason})`);
      }
      return { setup, assessment };
    } finally {
      this.evaluating.delete(key);
    }
  }

  sweep() { this.tracker.sweep(); }
}

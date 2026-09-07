import { config } from "../config.js";
/**
 * Rolling per-token record of which *distinct* tracked wallets bought recently.
 * One wallet buying five times is one signal, not five — the edge is agreement
 * between independent smart wallets, so dedupe by wallet before counting.
 */
export class ConsensusTracker {
    byToken = new Map();
    record(e) {
        if (e.side !== "buy" || e.usdValue < config.signal.minBuyUsd)
            return [];
        const key = `${e.chain}:${e.token.address}`;
        let wallets = this.byToken.get(key);
        if (!wallets)
            this.byToken.set(key, (wallets = new Map()));
        const prev = wallets.get(e.trader.wallet);
        // Keep the largest print from this wallet inside the window.
        if (!prev || e.usdValue > prev.usdValue) {
            wallets.set(e.trader.wallet, { wallet: e.trader.wallet, handle: e.trader.handle, usdValue: e.usdValue, at: e.blockTs });
        }
        return this.active(key);
    }
    /** Buys still inside the consensus window, newest first. */
    active(key) {
        const wallets = this.byToken.get(key);
        if (!wallets)
            return [];
        const cutoff = Date.now() - config.signal.consensusWindowMs;
        for (const [w, b] of wallets)
            if (b.at < cutoff)
                wallets.delete(w);
        if (wallets.size === 0)
            this.byToken.delete(key);
        return [...wallets.values()].sort((a, b) => b.at - a.at);
    }
    /** Drop stale tokens so a long-running process doesn't grow unbounded. */
    sweep() {
        for (const key of [...this.byToken.keys()])
            this.active(key);
    }
}
//# sourceMappingURL=consensus.js.map
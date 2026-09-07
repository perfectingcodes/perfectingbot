/**
 * Paper executor: same interface as a live one, no funds at risk.
 * Run this until the setup log shows an edge worth risking money on.
 */
export class PaperExecutor {
    name = "paper";
    positions = new Map();
    async enter(order, priceUsd) {
        const key = `${order.setup.chain}:${order.setup.token.address}`;
        const fill = { key, sizeUsd: order.sizeUsd, priceUsd, at: Date.now() };
        this.positions.set(key, fill);
        console.log(`[paper] ENTER ${order.setup.token.symbol ?? key} $${order.sizeUsd.toFixed(2)} @ ${priceUsd}`);
        return fill;
    }
    async exit(key, priceUsd) {
        const pos = this.positions.get(key);
        if (!pos)
            return null;
        this.positions.delete(key);
        const pnlUsd = pos.sizeUsd * (priceUsd / pos.priceUsd - 1);
        console.log(`[paper] EXIT ${key} pnl $${pnlUsd.toFixed(2)}`);
        return { pnlUsd };
    }
    open() { return [...this.positions.values()]; }
}
//# sourceMappingURL=paper.js.map
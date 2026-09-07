import type { Executor, Fill, Order } from "./types.ts";

/**
 * Paper executor: same interface as a live one, no funds at risk.
 * Run this until the setup log shows an edge worth risking money on.
 */
export class PaperExecutor implements Executor {
  readonly name = "paper";
  private positions = new Map<string, Fill>();

  async enter(order: Order, priceUsd: number): Promise<Fill> {
    const key = `${order.setup.chain}:${order.setup.token.address}`;
    const fill: Fill = { key, sizeUsd: order.sizeUsd, priceUsd, at: Date.now() };
    this.positions.set(key, fill);
    console.log(`[paper] ENTER ${order.setup.token.symbol ?? key} $${order.sizeUsd.toFixed(2)} @ ${priceUsd}`);
    return fill;
  }

  async exit(key: string, priceUsd: number) {
    const pos = this.positions.get(key);
    if (!pos) return null;
    this.positions.delete(key);
    const pnlUsd = pos.sizeUsd * (priceUsd / pos.priceUsd - 1);
    console.log(`[paper] EXIT ${key} pnl $${pnlUsd.toFixed(2)}`);
    return { pnlUsd };
  }

  open() { return [...this.positions.values()]; }
}

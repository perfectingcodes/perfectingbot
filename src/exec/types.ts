import type { Setup } from "../types.ts";

export interface Order { setup: Setup; sizeUsd: number }
export interface Fill { key: string; sizeUsd: number; priceUsd: number; at: number }

export interface Executor {
  readonly name: string;
  enter(order: Order, priceUsd: number): Promise<Fill | null>;
  exit(key: string, priceUsd: number): Promise<{ pnlUsd: number } | null>;
}

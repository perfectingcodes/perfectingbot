import { config } from "../config.ts";
import type { TokenStats } from "../types.ts";

/** Credit costs per the published pricing table; tracked so a run can't silently drain a plan. */
const COST = { default: 1, alerts: 0.5, thesis: 5, wallet: 10 } as const;

interface CacheEntry { at: number; value: unknown }

export class FomoClient {
  private cache = new Map<string, CacheEntry>();
  creditsUsed = 0;
  /** Day-stamped spend, so the budget resets without needing a scheduler. */
  private daySpent = 0;
  private dayStamp = utcDay();

  get spentToday() { this.rollDay(); return this.daySpent; }
  get budgetLeft() { return Math.max(0, config.credits.dailyBudget - this.spentToday); }
  get overBudget() { return this.budgetLeft <= 0; }

  private rollDay() {
    const d = utcDay();
    if (d !== this.dayStamp) { this.dayStamp = d; this.daySpent = 0; }
  }

  private key: string;
  private base: string;

  constructor(key = config.fomoKey, base = config.fomoBase) {
    this.key = key;
    this.base = base;
  }

  /** GET with bearer auth, retry/backoff on 429 + 5xx, and a TTL cache to protect the credit budget. */
  async get<T>(path: string, opts: { ttlMs?: number; cost?: number } = {}): Promise<T> {
    const { ttlMs = 15_000, cost = COST.default } = opts;
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`${this.base}${path}`, {
          headers: { authorization: `Bearer ${this.key}`, accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401) throw new Error(`401 from ${path} — check FOMO_API_KEY`);
        if (res.status === 402 || res.status === 403) throw new Error(`${res.status} from ${path} — plan tier does not include this endpoint`);
        if (res.status === 429 || res.status >= 500) {
          // Honor Retry-After when the server sends one, otherwise exponential backoff.
          const ra = Number(res.headers.get("retry-after"));
          await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(attempt));
          continue;
        }
        if (!res.ok) throw new Error(`${res.status} from ${path}: ${(await res.text()).slice(0, 200)}`);

        const value = (await res.json()) as T;
        this.creditsUsed += cost;
        this.rollDay();
        this.daySpent += cost;
        this.cache.set(path, { at: Date.now(), value });
        return value;
      } catch (err) {
        lastErr = err;
        if (err instanceof Error && /^(401|402|403)/.test(err.message)) throw err;
        await sleep(backoff(attempt));
      }
    }
    throw new Error(`FOMO request failed after retries: ${path}: ${String(lastErr)}`);
  }

  tokenStats(address: string) {
    return this.get<TokenStats>(`/v2/token/${address}/stats`, { ttlMs: 10_000 });
  }

  tokenHolders(address: string) {
    return this.get<{ handle: string; amount: number; valueUsd: number; priceUsd: number }[]>(
      `/token/${address}/holders`, { ttlMs: 30_000 });
  }

  tokenDevs(address: string) {
    return this.get<unknown>(`/v2/token/${address}/devs`, { ttlMs: 30_000 });
  }

  /** Token boards carry volume24hUsd and network — the input to volume-led discovery. */
  tokenBoard(board: string, limit = 50) {
    return this.get<{ board?: string; tokens?: any[]; available?: boolean }>(
      `/v2/leaderboard/tokens/${board}?limit=${limit}`, { ttlMs: 45_000 });
  }

  leaderboard(window: "24h" | "7d" | "30d" | "all" = "7d") {
    return this.get<{ traders: LeaderTrader[] }>(`/v2/leaderboard/${window}`, { ttlMs: 10 * 60_000 });
  }

  /** Holdings, so a buy can be sized against the trader's actual book rather than in a vacuum. */
  userBalances(handle: string) {
    return this.get<{ totalUsd?: number; balances?: { valueUsd?: number }[] }>(`/v2/users/${handle}/balances`, { ttlMs: 15 * 60_000 });
  }

  /** Wallet resolution costs 10 credits — cached hard. */
  user(handle: string) {
    return this.get<LeaderTrader>(`/v2/users/${handle}`, { ttlMs: 6 * 60 * 60_000, cost: COST.wallet });
  }
}

export interface LeaderTrader {
  rank?: number;
  handle: string;
  displayName?: string;
  pnlUsd?: number;
  volumeUsd?: number;
  trades?: number;
  followers?: number;
  wallets?: { solana?: string; evm?: string };
  verified?: boolean;
}

const utcDay = () => new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (n: number) => Math.min(8_000, 400 * 2 ** n) + Math.random() * 250;

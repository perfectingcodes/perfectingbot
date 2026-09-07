import { config } from "../config.js";
/** Credit costs per the published pricing table; tracked so a run can't silently drain a plan. */
const COST = { default: 1, alerts: 0.5, thesis: 5, wallet: 10 };
export class FomoClient {
    cache = new Map();
    creditsUsed = 0;
    key;
    base;
    constructor(key = config.fomoKey, base = config.fomoBase) {
        this.key = key;
        this.base = base;
    }
    /** GET with bearer auth, retry/backoff on 429 + 5xx, and a TTL cache to protect the credit budget. */
    async get(path, opts = {}) {
        const { ttlMs = 15_000, cost = COST.default } = opts;
        const hit = this.cache.get(path);
        if (hit && Date.now() - hit.at < ttlMs)
            return hit.value;
        let lastErr;
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const res = await fetch(`${this.base}${path}`, {
                    headers: { authorization: `Bearer ${this.key}`, accept: "application/json" },
                    signal: AbortSignal.timeout(10_000),
                });
                if (res.status === 401)
                    throw new Error(`401 from ${path} — check FOMO_API_KEY`);
                if (res.status === 402 || res.status === 403)
                    throw new Error(`${res.status} from ${path} — plan tier does not include this endpoint`);
                if (res.status === 429 || res.status >= 500) {
                    // Honor Retry-After when the server sends one, otherwise exponential backoff.
                    const ra = Number(res.headers.get("retry-after"));
                    await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(attempt));
                    continue;
                }
                if (!res.ok)
                    throw new Error(`${res.status} from ${path}: ${(await res.text()).slice(0, 200)}`);
                const value = (await res.json());
                this.creditsUsed += cost;
                this.cache.set(path, { at: Date.now(), value });
                return value;
            }
            catch (err) {
                lastErr = err;
                if (err instanceof Error && /^(401|402|403)/.test(err.message))
                    throw err;
                await sleep(backoff(attempt));
            }
        }
        throw new Error(`FOMO request failed after retries: ${path}: ${String(lastErr)}`);
    }
    tokenStats(address) {
        return this.get(`/v2/token/${address}/stats`, { ttlMs: 10_000 });
    }
    tokenHolders(address) {
        return this.get(`/token/${address}/holders`, { ttlMs: 30_000 });
    }
    tokenDevs(address) {
        return this.get(`/v2/token/${address}/devs`, { ttlMs: 30_000 });
    }
    /** Token boards carry volume24hUsd and network — the input to volume-led discovery. */
    tokenBoard(board, limit = 50) {
        return this.get(`/v2/leaderboard/tokens/${board}?limit=${limit}`, { ttlMs: 45_000 });
    }
    leaderboard(window = "7d") {
        return this.get(`/v2/leaderboard/${window}`, { ttlMs: 10 * 60_000 });
    }
    /** Holdings, so a buy can be sized against the trader's actual book rather than in a vacuum. */
    userBalances(handle) {
        return this.get(`/v2/users/${handle}/balances`, { ttlMs: 15 * 60_000 });
    }
    /** Wallet resolution costs 10 credits — cached hard. */
    user(handle) {
        return this.get(`/v2/users/${handle}`, { ttlMs: 6 * 60 * 60_000, cost: COST.wallet });
    }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (n) => Math.min(8_000, 400 * 2 ** n) + Math.random() * 250;
//# sourceMappingURL=client.js.map
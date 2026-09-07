import { config } from "../config.ts";

/**
 * Solana rug surface, over plain JSON-RPC.
 *
 * Deliberately no @solana/web3.js: we need three read methods, and the SDK is a large
 * dependency to carry for that. Everything here is a documented RPC call.
 *
 * The two authorities are the important part and have no EVM equivalent:
 *   mintAuthority   — still set means supply can be minted out from under holders
 *   freezeAuthority — still set means the issuer can freeze YOUR token account,
 *                     i.e. stop you selling. This is the Solana honeypot.
 */

let id = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * api.mainnet-beta.solana.com rate-limits ordinary reads (verified: HTTP 429 on a
 * single getTokenLargestAccounts). Retries with backoff, then gives up — callers turn
 * a failure into "unknown" evidence, never into a pass. Set SOLANA_RPC_URL to a
 * dedicated provider before trusting this in production.
 */
async function rpc<T>(method: string, params: unknown[], opts: { attempts?: number; timeoutMs?: number } = {}): Promise<T> {
  const { attempts = 4, timeoutMs = 10_000 } = opts;
  let last = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(config.chains.solana.rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        last = `HTTP ${res.status}`;
        // Cap the honoured retry-after: a refusing endpoint sometimes asks for minutes.
        const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 2_000) : 400 * 2 ** attempt + Math.random() * 200;
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) throw new Error(`solana rpc ${method}: HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(`solana rpc ${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
      return body.result as T;
    } catch (err) {
      last = String(err).slice(0, 140);
      if (/HTTP 4(?!29)/.test(last)) throw err;
      await sleep(500 * 2 ** attempt + Math.random() * 250);
    }
  }
  throw new Error(`solana rpc ${method} failed after retries: ${last}`);
}

export interface SolanaMintInfo {
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  decimals: number | null;
  supply: number | null;
}

export async function mintInfo(mint: string): Promise<SolanaMintInfo> {
  const out: SolanaMintInfo = { mintAuthorityRevoked: null, freezeAuthorityRevoked: null, decimals: null, supply: null };
  const acc = await rpc<any>("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]);
  const info = acc?.value?.data?.parsed?.info;
  if (!info) return out;

  // Null authority means it was revoked — which is the safe state.
  out.mintAuthorityRevoked = info.mintAuthority === null || info.mintAuthority === undefined;
  out.freezeAuthorityRevoked = info.freezeAuthority === null || info.freezeAuthority === undefined;
  out.decimals = typeof info.decimals === "number" ? info.decimals : null;
  out.supply = info.supply != null && out.decimals != null ? Number(info.supply) / 10 ** out.decimals : null;
  return out;
}

export interface SolanaConcentration {
  top10Percent: number | null;
  holdersSampled: number;
  /** Top-account balances, largest first, as a share of supply. */
  shares: number[];
}

export interface SolanaBundling {
  /** Largest group of top accounts holding near-identical balances. */
  clusterSize: number;
  /** Combined supply share held by that group. */
  clusterPercent: number;
  suspicious: boolean;
  detail: string;
}

/**
 * getTokenLargestAccounts returns the top 20 token accounts. That is enough for a
 * top-10 concentration read, but note it is *accounts*, not people — one actor can
 * hold across many accounts, so this can only ever understate concentration.
 */
/**
 * Circuit breaker. Public Solana RPCs refuse getTokenLargestAccounts outright rather than
 * throttling it, so retrying costs ~7s per token and never succeeds. After a few straight
 * failures we stop asking for a while instead of taxing every evaluation.
 */
const breaker = { fails: 0, openUntil: 0 };
const BREAKER_TRIP = 2;
const BREAKER_COOLDOWN_MS = 10 * 60_000;

export async function concentration(mint: string): Promise<SolanaConcentration> {
  if (Date.now() < breaker.openUntil) {
    throw new Error("getTokenLargestAccounts disabled: this RPC refused it repeatedly (set SOLANA_RPC_URL to a dedicated provider)");
  }
  let largest: any, supplyRes: any;
  try {
    // Fewer attempts and a shorter timeout: this is the method public RPCs refuse, and
    // a refusal must cost the scanner a second, not most of a minute.
    const fast = { attempts: 2, timeoutMs: 4_000 };
    [largest, supplyRes] = await Promise.all([
      rpc<any>("getTokenLargestAccounts", [mint, { commitment: "confirmed" }], fast),
      rpc<any>("getTokenSupply", [mint, { commitment: "confirmed" }], fast),
    ]);
    breaker.fails = 0;
  } catch (err) {
    if (++breaker.fails >= BREAKER_TRIP) {
      breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
      console.warn(`[solana] getTokenLargestAccounts refused ${breaker.fails}x — pausing that check for ${BREAKER_COOLDOWN_MS / 60_000}m. Concentration and bundling will read as unmeasured until SOLANA_RPC_URL points at a dedicated provider.`);
    }
    throw err;
  }
  const accounts: any[] = largest?.value ?? [];
  const total = Number(supplyRes?.value?.uiAmount ?? 0);
  if (!accounts.length || !total) return { top10Percent: null, holdersSampled: accounts.length, shares: [] };

  const shares = accounts.map((a) => Number(a.uiAmount ?? 0) / total).filter((n) => n > 0);
  const top10 = accounts.slice(0, 10).reduce((s, a) => s + Number(a.uiAmount ?? 0), 0);
  return { top10Percent: (top10 / total) * 100, holdersSampled: accounts.length, shares };
}

/**
 * Solana's bundling tell, computed from the balances we already fetched — no extra RPC,
 * which matters because the heavier history endpoints are exactly what public RPCs refuse.
 *
 * A bundled launch buys through many wallets in one transaction batch, so those wallets
 * end up holding *near-identical* amounts. Organic buyers never cluster that tightly.
 * Several top accounts within a couple of percent of each other, holding a meaningful
 * slice of supply between them, is one actor wearing many hats.
 */
export function bundling(shares: number[], tolerance = 0.02, minCluster = 3, minShare = 0.10): SolanaBundling {
  if (shares.length < minCluster) {
    return { clusterSize: 0, clusterPercent: 0, suspicious: false, detail: "too few accounts to judge distribution" };
  }
  let best = { size: 0, pct: 0 };
  for (let i = 0; i < shares.length; i++) {
    const anchor = shares[i]!;
    if (anchor <= 0) continue;
    // Group everything within `tolerance` of this anchor, relative to the anchor itself.
    const group = shares.filter((s) => Math.abs(s - anchor) / anchor <= tolerance);
    const pct = group.reduce((a, b) => a + b, 0);
    if (group.length > best.size || (group.length === best.size && pct > best.pct)) {
      best = { size: group.length, pct };
    }
  }
  const suspicious = best.size >= minCluster && best.pct >= minShare;
  return {
    clusterSize: best.size,
    clusterPercent: best.pct * 100,
    suspicious,
    detail: best.size >= minCluster
      ? `${best.size} top accounts hold near-identical balances totalling ${(best.pct * 100).toFixed(1)}% of supply`
      : "no cluster of near-identical top balances",
  };
}

export async function reachable(): Promise<{ ok: boolean; detail: string }> {
  try {
    const v = await rpc<any>("getVersion", []);
    return { ok: true, detail: `solana-core ${v?.["solana-core"] ?? "?"}` };
  } catch (err) {
    return { ok: false, detail: String(err).slice(0, 140) };
  }
}

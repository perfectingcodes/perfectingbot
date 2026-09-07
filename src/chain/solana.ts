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
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(config.chains.solana.rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        last = `HTTP ${res.status}`;
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** attempt + Math.random() * 250);
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
}

/**
 * getTokenLargestAccounts returns the top 20 token accounts. That is enough for a
 * top-10 concentration read, but note it is *accounts*, not people — one actor can
 * hold across many accounts, so this can only ever understate concentration.
 */
export async function concentration(mint: string): Promise<SolanaConcentration> {
  const [largest, supplyRes] = await Promise.all([
    rpc<any>("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]),
    rpc<any>("getTokenSupply", [mint, { commitment: "confirmed" }]),
  ]);
  const accounts: any[] = largest?.value ?? [];
  const total = Number(supplyRes?.value?.uiAmount ?? 0);
  if (!accounts.length || !total) return { top10Percent: null, holdersSampled: accounts.length };

  const top10 = accounts.slice(0, 10).reduce((s, a) => s + Number(a.uiAmount ?? 0), 0);
  return { top10Percent: (top10 / total) * 100, holdersSampled: accounts.length };
}

export async function reachable(): Promise<{ ok: boolean; detail: string }> {
  try {
    const v = await rpc<any>("getVersion", []);
    return { ok: true, detail: `solana-core ${v?.["solana-core"] ?? "?"}` };
  } catch (err) {
    return { ok: false, detail: String(err).slice(0, 140) };
  }
}

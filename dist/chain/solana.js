import { config } from "../config.js";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * api.mainnet-beta.solana.com rate-limits ordinary reads (verified: HTTP 429 on a
 * single getTokenLargestAccounts). Retries with backoff, then gives up — callers turn
 * a failure into "unknown" evidence, never into a pass. Set SOLANA_RPC_URL to a
 * dedicated provider before trusting this in production.
 */
async function rpc(method, params) {
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
            if (!res.ok)
                throw new Error(`solana rpc ${method}: HTTP ${res.status}`);
            const body = await res.json();
            if (body.error)
                throw new Error(`solana rpc ${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
            return body.result;
        }
        catch (err) {
            last = String(err).slice(0, 140);
            if (/HTTP 4(?!29)/.test(last))
                throw err;
            await sleep(500 * 2 ** attempt + Math.random() * 250);
        }
    }
    throw new Error(`solana rpc ${method} failed after retries: ${last}`);
}
export async function mintInfo(mint) {
    const out = { mintAuthorityRevoked: null, freezeAuthorityRevoked: null, decimals: null, supply: null };
    const acc = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]);
    const info = acc?.value?.data?.parsed?.info;
    if (!info)
        return out;
    // Null authority means it was revoked — which is the safe state.
    out.mintAuthorityRevoked = info.mintAuthority === null || info.mintAuthority === undefined;
    out.freezeAuthorityRevoked = info.freezeAuthority === null || info.freezeAuthority === undefined;
    out.decimals = typeof info.decimals === "number" ? info.decimals : null;
    out.supply = info.supply != null && out.decimals != null ? Number(info.supply) / 10 ** out.decimals : null;
    return out;
}
/**
 * getTokenLargestAccounts returns the top 20 token accounts. That is enough for a
 * top-10 concentration read, but note it is *accounts*, not people — one actor can
 * hold across many accounts, so this can only ever understate concentration.
 */
export async function concentration(mint) {
    const [largest, supplyRes] = await Promise.all([
        rpc("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]),
        rpc("getTokenSupply", [mint, { commitment: "confirmed" }]),
    ]);
    const accounts = largest?.value ?? [];
    const total = Number(supplyRes?.value?.uiAmount ?? 0);
    if (!accounts.length || !total)
        return { top10Percent: null, holdersSampled: accounts.length };
    const top10 = accounts.slice(0, 10).reduce((s, a) => s + Number(a.uiAmount ?? 0), 0);
    return { top10Percent: (top10 / total) * 100, holdersSampled: accounts.length };
}
export async function reachable() {
    try {
        const v = await rpc("getVersion", []);
        return { ok: true, detail: `solana-core ${v?.["solana-core"] ?? "?"}` };
    }
    catch (err) {
        return { ok: false, detail: String(err).slice(0, 140) };
    }
}
//# sourceMappingURL=solana.js.map
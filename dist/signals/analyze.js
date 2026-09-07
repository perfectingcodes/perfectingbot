import { getAddress } from "viem";
import { config } from "../config.js";
import { pairFromTx, poolLiquidity } from "../chain/inspect.js";
import { inspectSafety, freshWalletShare } from "../chain/safety.js";
import { inspectCluster } from "../chain/cluster.js";
import { runGates } from "./gates.js";
import { ev, fromGate } from "./evidence.js";
import { isEvm } from "../types.js";
import { mintInfo, concentration } from "../chain/solana.js";
/**
 * Collects every signal into one flat evidence list, tier by tier.
 * Each check returns its own plain-English verdict so the output explains itself.
 */
export async function analyze(fomo, trigger, buyers, quality, social, priceUsd) {
    const out = [];
    const token = getAddress(trigger.token.address);
    // ---- Tier 1: on-chain truth ------------------------------------------------
    const gates = await runGates(fomo, trigger, priceUsd);
    const byName = new Map(gates.map((g) => [g.name, g]));
    const liq = byName.get("liquidity");
    const conc = byName.get("concentration");
    const flow = byName.get("flow");
    const holders = byName.get("holders");
    const honeypot = byName.get("honeypot");
    // On Solana the equivalent protection is the freeze authority, checked in solanaTierOne.
    if (honeypot)
        out.push(fromGate(honeypot, 1, 0.22, true));
    if (liq)
        out.push(fromGate(liq, 1, 0.18, true));
    if (conc)
        out.push(fromGate(conc, 1, 0.14, true));
    if (holders)
        out.push(fromGate(holders, 1, 0.08, false));
    if (flow)
        out.push(fromGate(flow, 1, 0.10, false));
    if (isEvm(trigger.chain)) {
        await evmTierOne(out, fomo, trigger);
    }
    else {
        await solanaTierOne(out, trigger);
    }
    // ---- Tier 2: smart-money consensus ----------------------------------------
    const n = buyers.length;
    out.push(ev(2, "consensus", n >= 3 ? "pass" : n >= 2 ? "warn" : "fail", n === 0
        ? "found by volume, not by a tracked wallet — no smart-money confirmation at all"
        : `${n} independent tracked wallet${n === 1 ? "" : "s"} bought within ${Math.round(config.signal.consensusWindowMs / 60_000)}m`, { share: 0.40, credit: Math.max(0, Math.min(1, (n - 1) / 4)) }));
    // Track record, and explicitly prefer durable PnL over 24h lottery winners.
    const ranked = buyers.map((b) => quality.get(b.wallet.toLowerCase())).filter(Boolean);
    const durable = ranked.filter((q) => q.window === "7d" || q.window === "30d");
    const bestRank = ranked.length ? Math.min(...ranked.map((q) => q.rank ?? 999)) : 999;
    out.push(ev(2, "track-record", durable.length ? "pass" : ranked.length ? "warn" : "unknown", durable.length
        ? `best buyer ranks #${bestRank} on the ${durable[0].window} leaderboard (durable PnL, not a 24h spike)`
        : ranked.length ? `buyers only rank on the 24h board — could be lottery winners` : "no leaderboard data for these wallets", { share: 0.35, credit: durable.length ? Math.min(1, (200 - Math.min(bestRank, 200)) / 200) : 0.25 }));
    // Conviction relative to the trader's own book, not absolute dollars.
    const convictions = await Promise.all(buyers.map(async (b) => {
        const q = quality.get(b.wallet.toLowerCase());
        if (!q?.handle)
            return null;
        try {
            const bal = await fomo.userBalances(q.handle);
            const book = bal.totalUsd ?? bal.balances?.reduce((s, x) => s + (x.valueUsd ?? 0), 0) ?? 0;
            return book > 0 ? b.usdValue / book : null;
        }
        catch {
            return null;
        }
    }));
    const best = Math.max(0, ...convictions.filter((c) => c !== null));
    out.push(ev(2, "conviction", best === 0 ? "unknown" : best >= 0.03 ? "pass" : best >= 0.01 ? "warn" : "fail", best === 0 ? "could not size buys against trader books"
        : `largest buy is ${(best * 100).toFixed(1)}% of that trader's book${best < 0.01 ? " — a rounding error to them" : ""}`, { share: 0.25 }));
    // ---- Tier 3: social velocity ----------------------------------------------
    if (social.enabled) {
        const v = await social.poll(trigger.token.symbol ?? trigger.token.address);
        out.push(ev(3, "social-velocity", !v ? "unknown" : v.z >= 2 ? "pass" : v.z >= 1 ? "warn" : "fail", !v ? "no social coverage for this token"
            : `mentions accelerating ${v.z.toFixed(1)}σ above this token's own baseline (${v.rate.toFixed(1)}/min)`, { share: 1.0 }));
    }
    else {
        out.push(ev(3, "social-velocity", "unknown", "no social source configured (set SOCIAL_API_URL)", { share: 1.0 }));
    }
    return out;
}
/** EVM tier-1: pool discovery from the trigger tx, contract safety, launch bundling. */
async function evmTierOne(out, fomo, trigger) {
    if (!isEvm(trigger.chain))
        return;
    const chain = trigger.chain;
    const token = getAddress(trigger.token.address);
    let pair = null;
    if (trigger.txHash)
        pair = await pairFromTx(chain, trigger.txHash).catch(() => null);
    try {
        const safety = await inspectSafety(chain, token, pair);
        out.push(ev(1, "lp-pulled", safety.lpRemovedRecently === true ? "fail" : safety.lpRemovedRecently === false ? "pass" : "unknown", safety.lpRemovedRecently === true ? "liquidity was REMOVED from this pool in the last ~5k blocks"
            : safety.lpRemovedRecently === false ? "no liquidity removals in recent history"
                : "could not scan far enough to rule out a liquidity pull", { share: 0.10, veto: true }));
        out.push(ev(1, "mint", safety.mintable === null ? "unknown" : safety.mintable ? "warn" : "pass", safety.mintable === null ? "could not read contract bytecode to check for a mint function"
            : safety.mintable ? "contract exposes mint() — supply can be inflated" : "no mint function in bytecode", { share: 0.08 }));
        out.push(ev(1, "ownership", safety.ownerRenounced === null ? "unknown" : safety.ownerRenounced ? "pass" : "warn", safety.ownerRenounced === null ? "no standard owner() to check"
            : safety.ownerRenounced ? "ownership renounced" : "owner still controls the contract (taxes/pause can change)", { share: 0.06 }));
        const lp = safety.lpBurnedOrLockedPct;
        out.push(ev(1, "lp-locked", lp === null ? "unknown" : lp >= 90 ? "pass" : lp >= 50 ? "warn" : "fail", lp === null ? "could not read LP token supply" : `${lp.toFixed(1)}% of LP is burned or in a visible sink`, { share: 0.06 }));
    }
    catch (err) {
        out.push(ev(1, "contract-safety", "unknown", `contract checks failed: ${String(err).slice(0, 100)}`, { share: 0.30 }));
    }
    if (pair) {
        try {
            const cluster = await inspectCluster(chain, pair);
            out.push(ev(1, "bundling", cluster.suspicious ? "fail" : cluster.complete ? "pass" : "unknown", cluster.detail, { share: 0.12, veto: true }));
            if (cluster.firstBuyers.length) {
                const fresh = await freshWalletShare(chain, cluster.firstBuyers.slice(0, 20));
                out.push(ev(1, "fresh-wallets", fresh > 0.6 ? "fail" : fresh > 0.35 ? "warn" : "pass", `${Math.round(fresh * 100)}% of early buyers are brand-new wallets`, { share: 0.08 }));
            }
        }
        catch (err) {
            out.push(ev(1, "bundling", "unknown", `cluster analysis failed: ${String(err).slice(0, 100)}`, { share: 0.20 }));
        }
    }
    else {
        out.push(ev(1, "bundling", "unknown", "no pool address recovered — cannot check launch bundling", { share: 0.20 }));
    }
}
/**
 * Solana tier-1. The two mint authorities carry most of the weight here: a live
 * freeze authority is the Solana honeypot — the issuer can freeze your token account
 * and stop you selling — and a live mint authority means supply can be inflated.
 * Launch-bundling analysis is not implemented for Solana yet and says so rather than
 * quietly scoring as if it had passed.
 */
async function solanaTierOne(out, trigger) {
    const mint = trigger.token.address;
    try {
        const info = await mintInfo(mint);
        out.push(ev(1, "freeze-authority", info.freezeAuthorityRevoked === null ? "unknown" : info.freezeAuthorityRevoked ? "pass" : "fail", info.freezeAuthorityRevoked === null ? "could not read the mint account"
            : info.freezeAuthorityRevoked ? "freeze authority revoked — your account cannot be frozen"
                : "FREEZE AUTHORITY STILL LIVE — the issuer can freeze your account and stop you selling", { share: 0.24, veto: true }));
        out.push(ev(1, "mint-authority", info.mintAuthorityRevoked === null ? "unknown" : info.mintAuthorityRevoked ? "pass" : "warn", info.mintAuthorityRevoked === null ? "could not read the mint account"
            : info.mintAuthorityRevoked ? "mint authority revoked — supply is fixed"
                : "mint authority still live — supply can be inflated", { share: 0.14 }));
    }
    catch (err) {
        out.push(ev(1, "mint-account", "unknown", `mint account unreadable: ${String(err).slice(0, 100)}`, { share: 0.38 }));
    }
    try {
        const conc = await concentration(mint);
        out.push(ev(1, "sol-concentration", conc.top10Percent === null ? "unknown" : conc.top10Percent <= config.gates.maxTop10Percent ? "pass" : "fail", conc.top10Percent === null ? "could not read largest token accounts"
            : `top 10 accounts hold ${conc.top10Percent.toFixed(1)}% (max ${config.gates.maxTop10Percent}%) — accounts, not people, so this understates`, { share: 0.14, veto: true }));
    }
    catch (err) {
        out.push(ev(1, "sol-concentration", "unknown", `largest-accounts read failed: ${String(err).slice(0, 100)}`, { share: 0.14 }));
    }
    out.push(ev(1, "bundling", "unknown", "launch-bundling and same-funder analysis is not implemented for Solana yet", { share: 0.14 }));
}
//# sourceMappingURL=analyze.js.map
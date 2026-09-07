import { getAddress, type Address } from "viem";
import { config } from "../config.ts";
import type { FomoClient } from "../fomo/client.ts";
import { pairFromTx, poolLiquidity } from "../chain/inspect.ts";
import { inspectSafety, freshWalletShare } from "../chain/safety.ts";
import { inspectCluster } from "../chain/cluster.ts";
import { runGates } from "./gates.ts";
import { ev, fromGate, type Evidence } from "./evidence.ts";
import type { SocialTracker } from "./social.ts";
import type { TradeEvent } from "../types.ts";

export interface TraderQuality { handle?: string; rank?: number; pnlUsd?: number; window?: string; bookUsd?: number }
export interface Buy { wallet: string; handle?: string; usdValue: number; at: number }

/**
 * Collects every signal into one flat evidence list, tier by tier.
 * Each check returns its own plain-English verdict so the output explains itself.
 */
export async function analyze(
  fomo: FomoClient,
  trigger: TradeEvent,
  buyers: Buy[],
  quality: Map<string, TraderQuality>,
  social: SocialTracker,
  priceUsd: number,
): Promise<Evidence[]> {
  const out: Evidence[] = [];
  const token = getAddress(trigger.token.address);

  // ---- Tier 1: on-chain truth ------------------------------------------------
  const gates = await runGates(fomo, trigger, priceUsd);
  const byName = new Map(gates.map((g) => [g.name, g]));
  const liq = byName.get("liquidity");
  const conc = byName.get("concentration");
  const flow = byName.get("flow");
  const holders = byName.get("holders");
  const honeypot = byName.get("honeypot");

  if (honeypot) out.push(fromGate(honeypot, 1, 0.22, true));
  if (liq) out.push(fromGate(liq, 1, 0.18, true));
  if (conc) out.push(fromGate(conc, 1, 0.14, true));
  if (holders) out.push(fromGate(holders, 1, 0.08, false));
  if (flow) out.push(fromGate(flow, 1, 0.10, false));

  let pair: Address | null = null;
  if (trigger.txHash) {
    pair = await pairFromTx(trigger.chain, trigger.txHash).catch(() => null);
  }

  // Contract rug surface: mint, ownership, LP lock, LP pulls.
  try {
    const safety = await inspectSafety(trigger.chain, token, pair);
    out.push(ev(1, "lp-pulled",
      safety.lpRemovedRecently === true ? "fail" : safety.lpRemovedRecently === false ? "pass" : "unknown",
      safety.lpRemovedRecently === true ? "liquidity was REMOVED from this pool in the last ~5k blocks"
        : safety.lpRemovedRecently === false ? "no liquidity removals in recent history"
        : "could not scan far enough to rule out a liquidity pull",
      { share: 0.10, veto: true }));

    out.push(ev(1, "mint", safety.mintable === null ? "unknown" : safety.mintable ? "warn" : "pass",
      safety.mintable === null ? "could not read contract bytecode to check for a mint function"
        : safety.mintable ? "contract exposes mint() — supply can be inflated" : "no mint function in bytecode",
      { share: 0.08 }));

    out.push(ev(1, "ownership", safety.ownerRenounced === null ? "unknown" : safety.ownerRenounced ? "pass" : "warn",
      safety.ownerRenounced === null ? "no standard owner() to check"
        : safety.ownerRenounced ? "ownership renounced" : "owner still controls the contract (taxes/pause can change)",
      { share: 0.06 }));

    const lp = safety.lpBurnedOrLockedPct;
    out.push(ev(1, "lp-locked", lp === null ? "unknown" : lp >= 90 ? "pass" : lp >= 50 ? "warn" : "fail",
      lp === null ? "could not read LP token supply" : `${lp.toFixed(1)}% of LP is burned or in a visible sink`,
      { share: 0.06 }));
  } catch (err) {
    out.push(ev(1, "contract-safety", "unknown", `contract checks failed: ${String(err).slice(0, 100)}`, { share: 0.30 }));
  }

  // Insider distribution: bundled launch buys and same-funder clusters.
  if (pair) {
    try {
      const cluster = await inspectCluster(trigger.chain, pair);
      // An incomplete swap scan cannot clear a token — only condemn one.
      out.push(ev(1, "bundling",
        cluster.suspicious ? "fail" : cluster.complete ? "pass" : "unknown",
        cluster.detail, { share: 0.12, veto: true }));

      if (cluster.firstBuyers.length) {
        const fresh = await freshWalletShare(trigger.chain, cluster.firstBuyers.slice(0, 20));
        out.push(ev(1, "fresh-wallets", fresh > 0.6 ? "fail" : fresh > 0.35 ? "warn" : "pass",
          `${Math.round(fresh * 100)}% of early buyers are brand-new wallets`, { share: 0.08 }));
      }
    } catch (err) {
      out.push(ev(1, "bundling", "unknown", `cluster analysis failed: ${String(err).slice(0, 100)}`, { share: 0.20 }));
    }
  } else {
    out.push(ev(1, "bundling", "unknown", "no pool address recovered — cannot check launch bundling", { share: 0.20 }));
  }

  // Dev behaviour.
  try {
    const devs: any = await fomo.tokenDevs(trigger.token.address);
    const selling = Array.isArray(devs) ? devs.some((d: any) => (d?.soldPercent ?? 0) > config.gates.maxDevSoldPercent)
      : (devs?.soldPercent ?? 0) > config.gates.maxDevSoldPercent;
    out.push(ev(1, "dev-selling", selling ? "fail" : "pass",
      selling ? `dev has sold more than ${config.gates.maxDevSoldPercent}% of their position` : "dev position looks intact",
      { share: 0.10, veto: true }));
  } catch {
    out.push(ev(1, "dev-selling", "unknown", "dev position data unavailable", { share: 0.10 }));
  }

  // ---- Tier 2: smart-money consensus ----------------------------------------
  const n = buyers.length;
  out.push(ev(2, "consensus", n >= 3 ? "pass" : n >= 2 ? "warn" : "fail",
    `${n} independent tracked wallet${n === 1 ? "" : "s"} bought within ${Math.round(config.signal.consensusWindowMs / 60_000)}m`,
    { share: 0.40, credit: Math.min(1, (n - 1) / 4) }));

  // Track record, and explicitly prefer durable PnL over 24h lottery winners.
  const ranked = buyers.map((b) => quality.get(b.wallet.toLowerCase())).filter(Boolean) as TraderQuality[];
  const durable = ranked.filter((q) => q.window === "7d" || q.window === "30d");
  const bestRank = ranked.length ? Math.min(...ranked.map((q) => q.rank ?? 999)) : 999;
  out.push(ev(2, "track-record", durable.length ? "pass" : ranked.length ? "warn" : "unknown",
    durable.length
      ? `best buyer ranks #${bestRank} on the ${durable[0]!.window} leaderboard (durable PnL, not a 24h spike)`
      : ranked.length ? `buyers only rank on the 24h board — could be lottery winners` : "no leaderboard data for these wallets",
    { share: 0.35, credit: durable.length ? Math.min(1, (200 - Math.min(bestRank, 200)) / 200) : 0.25 }));

  // Conviction relative to the trader's own book, not absolute dollars.
  const convictions = await Promise.all(buyers.map(async (b) => {
    const q = quality.get(b.wallet.toLowerCase());
    if (!q?.handle) return null;
    try {
      const bal = await fomo.userBalances(q.handle);
      const book = bal.totalUsd ?? bal.balances?.reduce((s, x) => s + (x.valueUsd ?? 0), 0) ?? 0;
      return book > 0 ? b.usdValue / book : null;
    } catch { return null; }
  }));
  const best = Math.max(0, ...convictions.filter((c): c is number => c !== null));
  out.push(ev(2, "conviction", best === 0 ? "unknown" : best >= 0.03 ? "pass" : best >= 0.01 ? "warn" : "fail",
    best === 0 ? "could not size buys against trader books"
      : `largest buy is ${(best * 100).toFixed(1)}% of that trader's book${best < 0.01 ? " — a rounding error to them" : ""}`,
    { share: 0.25 }));

  // ---- Tier 3: social velocity ----------------------------------------------
  if (social.enabled) {
    const v = await social.poll(trigger.token.symbol ?? trigger.token.address);
    out.push(ev(3, "social-velocity", !v ? "unknown" : v.z >= 2 ? "pass" : v.z >= 1 ? "warn" : "fail",
      !v ? "no social coverage for this token"
        : `mentions accelerating ${v.z.toFixed(1)}σ above this token's own baseline (${v.rate.toFixed(1)}/min)`,
      { share: 1.0 }));
  } else {
    out.push(ev(3, "social-velocity", "unknown", "no social source configured (set SOCIAL_API_URL)", { share: 1.0 }));
  }

  return out;
}

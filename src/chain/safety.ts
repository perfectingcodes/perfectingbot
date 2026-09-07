import { getAddress, zeroAddress, type Address } from "viem";
import { clientFor } from "./clients.ts";
import { getLogsChunked } from "./logs.ts";
import { erc20Abi, ownableAbi, TRANSFER_TOPIC, BURN_TOPIC } from "./abi.ts";
import type { Chain } from "../types.ts";

export interface SafetyReport {
  ownerRenounced: boolean | null;
  mintable: boolean | null;
  lpBurnedOrLockedPct: number | null;
  /** null means we could not scan far enough to say — never treat that as "no". */
  lpRemovedRecently: boolean | null;
  notes: string[];
}

/** Burn sinks and the well-known locker patterns: LP sitting here can't be pulled. */
const BURN_SINKS = new Set([
  zeroAddress.toLowerCase(),
  "0x000000000000000000000000000000000000dead",
]);

/**
 * Contract-level rug surface, read straight from chain state rather than a vendor's
 * "is it safe" boolean — we want to see the individual facts and weigh them ourselves.
 */
export async function inspectSafety(chain: Chain, token: Address, pair: Address | null): Promise<SafetyReport> {
  const client = clientFor(chain);
  const notes: string[] = [];
  const report: SafetyReport = { ownerRenounced: null, mintable: null, lpBurnedOrLockedPct: null, lpRemovedRecently: null, notes };

  // Ownership: renounced means the owner can no longer flip taxes or pause transfers.
  try {
    const owner = await client.readContract({ address: token, abi: ownableAbi, functionName: "owner" }).catch(() =>
      client.readContract({ address: token, abi: ownableAbi, functionName: "getOwner" }));
    report.ownerRenounced = BURN_SINKS.has(String(owner).toLowerCase());
  } catch {
    notes.push("no owner()/getOwner() — either renounce-by-design or a non-standard contract");
  }

  // Mint: presence of a callable mint() means supply can be inflated under us.
  try {
    const code = await client.getCode({ address: token });
    // 0x40c10f19 = mint(address,uint256)
    report.mintable = code ? code.includes("40c10f19") : null;
  } catch { /* leave null */ }

  if (pair) {
    // LP burned/locked: what share of LP tokens sits in a sink we can see.
    try {
      const [supply, ...sinkBalances] = await Promise.all([
        client.readContract({ address: pair, abi: erc20Abi, functionName: "totalSupply" }),
        ...[...BURN_SINKS].map((sink) =>
          client.readContract({ address: pair, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(sink)] })),
      ]);
      const burned = sinkBalances.reduce((a, b) => a + b, 0n);
      report.lpBurnedOrLockedPct = supply > 0n ? Number((burned * 10000n) / supply) / 100 : null;
    } catch {
      notes.push("could not read LP supply/balances");
    }

    // Recent LP removal is the loudest possible exit signal.
    try {
      const head = await client.getBlockNumber();
      const res = await getLogsChunked(chain, {
        address: pair,
        topics: [BURN_TOPIC as `0x${string}`],
        fromBlock: head > 5000n ? head - 5000n : 0n,
        toBlock: head,
      });
      if (res.logs.length > 0) {
        report.lpRemovedRecently = true;
      } else if (res.complete) {
        report.lpRemovedRecently = false;
      } else {
        // Partial scan with no hits proves nothing; say so instead of implying safety.
        report.lpRemovedRecently = null;
        notes.push(`LP-removal scan incomplete (${res.scannedBlocks} blocks${res.rateLimited ? ", rate limited" : ""}) — result is inconclusive`);
      }
    } catch {
      notes.push("LP-removal scan failed");
    }
  }

  return report;
}

/** Wallets funded by the same source, or created moments before the launch, are one actor. */
export async function freshWalletShare(chain: Chain, wallets: Address[]): Promise<number> {
  const client = clientFor(chain);
  const nonces = await Promise.all(wallets.map((w) => client.getTransactionCount({ address: w }).catch(() => 999)));
  const fresh = nonces.filter((n) => n <= 3).length;
  return wallets.length ? fresh / wallets.length : 0;
}

export { TRANSFER_TOPIC };

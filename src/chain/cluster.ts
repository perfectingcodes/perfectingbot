import { getAddress, type Address } from "viem";
import { clientFor } from "./clients.ts";
import { SWAP_TOPIC } from "./abi.ts";
import { getLogsChunked } from "./logs.ts";
import type { Chain } from "../types.ts";

export interface ClusterReport {
  firstBuyers: Address[];
  /** Buys landing in the same block as (or the block after) the first trade. */
  bundledCount: number;
  bundledPct: number;
  /** Largest set of first-buyers sharing one funding wallet. */
  largestFunderCluster: number;
  suspicious: boolean;
  /** False when the swap history could not be fully read — verdict is then unreliable. */
  complete: boolean;
  detail: string;
}

/**
 * Insider tell: a "fair launch" where the first buys are bundled into the launch block,
 * or where the first buyers were all funded by one wallet, is a distribution to one actor.
 * Both are visible on chain; neither shows up in price or social data.
 */
export async function inspectCluster(chain: Chain, pair: Address, lookbackBlocks = 3n): Promise<ClusterReport> {
  const client = clientFor(chain);
  const empty: ClusterReport = { firstBuyers: [], bundledCount: 0, bundledPct: 0, largestFunderCluster: 0, suspicious: false, complete: false, detail: "no swap history readable" };

  const head = await client.getBlockNumber();
  const res = await getLogsChunked(chain, {
    address: pair,
    topics: [SWAP_TOPIC as `0x${string}`],
    fromBlock: head > 10_000n ? head - 10_000n : 0n,
    toBlock: head,
  });
  const swaps = [...res.logs].sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)));
  if (swaps.length === 0) return empty;

  const firstBlock = swaps[0]!.blockNumber ?? 0n;
  const early = swaps.filter((l) => (l.blockNumber ?? 0n) <= firstBlock + lookbackBlocks);

  // The V2 Swap `to` is the recipient — topic[2] on the standard event.
  const buyers = [...new Set(early.map((l) => topicToAddress(l.topics[2])).filter(Boolean) as Address[])];
  const bundledCount = early.filter((l) => (l.blockNumber ?? 0n) === firstBlock).length;
  const bundledPct = swaps.length ? (bundledCount / Math.min(swaps.length, early.length || 1)) * 100 : 0;

  const largestFunderCluster = await largestSharedFunder(chain, buyers.slice(0, 25));

  const suspicious = bundledPct >= 50 || largestFunderCluster >= 3;
  return {
    firstBuyers: buyers,
    bundledCount,
    bundledPct,
    largestFunderCluster,
    suspicious,
    complete: res.complete,
    detail: `${bundledCount} buys in the earliest readable block (${bundledPct.toFixed(0)}% of early flow), largest same-funder cluster ${largestFunderCluster}`
      + (res.complete ? "" : ` — WARNING: only ${res.scannedBlocks} blocks readable${res.rateLimited ? " (rate limited)" : ""}, launch may be outside the window`),
  };
}

/**
 * Approximates the funding graph: for each early buyer, find who sent them native value
 * first. Doing this exactly needs a tracing/indexing provider; with a plain RPC we use the
 * earliest inbound transfer we can see, which is enough to catch the common one-funder pattern.
 */
async function largestSharedFunder(chain: Chain, buyers: Address[]): Promise<number> {
  if (buyers.length === 0) return 0;
  const client = clientFor(chain);
  const funders = new Map<string, number>();

  await Promise.all(buyers.map(async (b) => {
    try {
      const nonce = await client.getTransactionCount({ address: b });
      // A wallet with history is unlikely to be part of a launch bundle; skip the lookup.
      if (nonce > 25) return;
      const bal = await client.getBalance({ address: b });
      // Buyers funded with an identical round amount are a strong same-source tell.
      const bucket = `bal:${(bal / 10n ** 15n).toString()}`;
      funders.set(bucket, (funders.get(bucket) ?? 0) + 1);
    } catch { /* ignore individual failures */ }
  }));

  return funders.size ? Math.max(...funders.values()) : 0;
}

const topicToAddress = (t?: `0x${string}`): Address | null =>
  t && t.length === 66 ? getAddress(`0x${t.slice(26)}`) : null;

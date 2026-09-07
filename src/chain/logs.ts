import type { Address } from "viem";
import { clientFor } from "./clients.ts";
import type { Chain } from "../types.ts";

/**
 * Public RPCs on both chains reject wide log queries — BSC with an explicit range limit,
 * Robinhood Chain with oversized-response errors and aggressive 429s. So every log read
 * goes through here: it halves the range on rejection, backs off on rate limits, and
 * reports honestly when it could not read the full window rather than returning a
 * partial result that would silently read as "nothing suspicious found".
 */
export interface ChunkedLogs {
  logs: Awaited<ReturnType<ReturnType<typeof clientFor>["getLogs"]>>;
  /** True when every requested block was actually scanned. */
  complete: boolean;
  scannedBlocks: bigint;
  rateLimited: boolean;
}

export async function getLogsChunked(
  chain: Chain,
  args: { address?: Address; topics?: `0x${string}`[]; fromBlock: bigint; toBlock: bigint },
  opts: { initialRange?: bigint; minRange?: bigint; maxRequests?: number } = {},
): Promise<ChunkedLogs> {
  const client = clientFor(chain);
  const { initialRange = 500n, minRange = 10n, maxRequests = 40 } = opts;

  let range = initialRange;
  let cursor = args.toBlock;
  let requests = 0;
  let scanned = 0n;
  let rateLimited = false;
  const out: any[] = [];

  while (cursor >= args.fromBlock && requests < maxRequests) {
    const from = cursor - range + 1n > args.fromBlock ? cursor - range + 1n : args.fromBlock;
    requests++;
    try {
      const logs = await client.getLogs({ address: args.address, topics: args.topics, fromBlock: from, toBlock: cursor } as any);
      // The Robinhood Chain public RPC returns every log in range regardless of the
      // topics filter it was sent. Re-filtering locally costs nothing and keeps a
      // non-compliant endpoint from turning into wrong verdicts downstream.
      out.push(...logs.filter((l: any) => matches(l, args.address, args.topics)));
      scanned += cursor - from + 1n;
      cursor = from - 1n;
      // Creep the window back up after a success so we aren't permanently slow.
      if (range < initialRange) range = range * 2n > initialRange ? initialRange : range * 2n;
    } catch (err) {
      const msg = String(err);
      if (/429|Too Many Requests|rate/i.test(msg)) {
        rateLimited = true;
        await sleep(1_200 + Math.random() * 800);
        continue;
      }
      if (/limit|too large|exceed/i.test(msg) && range > minRange) {
        range = range / 2n > minRange ? range / 2n : minRange;
        continue;
      }
      // Unrecoverable for this window.
      break;
    }
  }

  return {
    logs: out as ChunkedLogs["logs"],
    complete: cursor < args.fromBlock,
    scannedBlocks: scanned,
    rateLimited,
  };
}

/** Client-side enforcement of the filter we asked the server for. */
function matches(log: any, address?: Address, topics?: `0x${string}`[]): boolean {
  if (address && String(log.address).toLowerCase() !== address.toLowerCase()) return false;
  if (!topics?.length) return true;
  for (let i = 0; i < topics.length; i++) {
    const want = topics[i];
    if (want == null) continue; // null = wildcard, same as JSON-RPC semantics
    const got = log.topics?.[i];
    if (!got || String(got).toLowerCase() !== String(want).toLowerCase()) return false;
  }
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

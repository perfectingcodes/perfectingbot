import { getAddress, type Address } from "viem";
import { clientFor } from "./clients.ts";
import { erc20Abi, pairAbi, SWAP_TOPIC } from "./abi.ts";
import type { EvmChain } from "../types.ts";

/**
 * Robinhood Chain publishes no canonical DEX factory, so instead of hardcoding an address
 * we recover the pool from the trade's own receipt: the contract that emitted the UniV2
 * Swap log *is* the pair. This works on any V2-style DEX on any chain, unchanged.
 */
export async function pairFromTx(chain: EvmChain, txHash: string): Promise<Address | null> {
  const client = clientFor(chain);
  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  const swap = receipt.logs.find((l) => l.topics[0]?.toLowerCase() === SWAP_TOPIC);
  return swap ? getAddress(swap.address) : null;
}

export interface LiquiditySnapshot {
  pair: Address;
  tokenReserve: number;
  liquidityUsd: number;
}

/**
 * Values the pool from the token side: reserves x observed USD price x 2.
 * Deriving price from the trade we just saw avoids needing a price oracle or a
 * known stablecoin address on a chain we may not have address book coverage for.
 */
export async function poolLiquidity(
  chain: EvmChain, pair: Address, token: Address, tokenPriceUsd: number,
): Promise<LiquiditySnapshot> {
  const client = clientFor(chain);
  const [token0, reserves, decimals] = await Promise.all([
    client.readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
    client.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  ]);
  const isToken0 = getAddress(token0) === getAddress(token);
  const raw = isToken0 ? reserves[0] : reserves[1];
  const tokenReserve = Number(raw) / 10 ** Number(decimals);
  return { pair, tokenReserve, liquidityUsd: tokenReserve * tokenPriceUsd * 2 };
}

/**
 * Honeypot probe without a router address: eth_call a transfer *as* a real holder.
 * A token that blocks holder transfers will revert here while still accepting buys.
 * Not proof of safety — plenty of traps only arm on sell — but it catches the crude ones.
 */
export async function transfersWork(chain: EvmChain, token: Address, holder: Address, amount: bigint): Promise<boolean> {
  try {
    await clientFor(chain).simulateContract({
      address: token, abi: erc20Abi, functionName: "transfer",
      args: ["0x000000000000000000000000000000000000dEaD", amount],
      account: holder,
    });
    return true;
  } catch {
    return false;
  }
}

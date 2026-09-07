import { createPublicClient, http, defineChain, type PublicClient } from "viem";
import { bsc, base } from "viem/chains";
import { config } from "../config.ts";
import type { EvmChain } from "../types.ts";

/** Robinhood Chain: Arbitrum L2, ETH gas token, chain id 4663. */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.chains.robinhood.rpc] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

const make = (chain: any, rpc: string) =>
  createPublicClient({ chain, transport: http(rpc, { retryCount: 3, timeout: 8_000 }) }) as PublicClient;

const clients: Record<EvmChain, PublicClient> = {
  robinhood: make(robinhoodChain, config.chains.robinhood.rpc),
  bsc: make(bsc, config.chains.bsc.rpc),
  base: make(base, config.chains.base.rpc),
};

export const clientFor = (c: EvmChain) => clients[c];

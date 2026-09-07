import { createPublicClient, http, defineChain } from "viem";
import { bsc, base } from "viem/chains";
import { config } from "../config.js";
/** Robinhood Chain: Arbitrum L2, ETH gas token, chain id 4663. */
export const robinhoodChain = defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.chains.robinhood.rpc] } },
    blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});
const make = (chain, rpc) => createPublicClient({ chain, transport: http(rpc, { retryCount: 3, timeout: 8_000 }) });
const clients = {
    robinhood: make(robinhoodChain, config.chains.robinhood.rpc),
    bsc: make(bsc, config.chains.bsc.rpc),
    base: make(base, config.chains.base.rpc),
};
export const clientFor = (c) => clients[c];
//# sourceMappingURL=clients.js.map
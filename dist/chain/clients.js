import { createPublicClient, http, defineChain } from "viem";
import { bsc } from "viem/chains";
import { config } from "../config.js";
/** Robinhood Chain: Arbitrum L2, ETH gas token, chain id 4663. */
export const robinhoodChain = defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.chains.robinhood.rpc] } },
    blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});
const clients = {
    robinhood: createPublicClient({ chain: robinhoodChain, transport: http(config.chains.robinhood.rpc, { retryCount: 3, timeout: 8_000 }) }),
    bsc: createPublicClient({ chain: bsc, transport: http(config.chains.bsc.rpc, { retryCount: 3, timeout: 8_000 }) }),
};
export const clientFor = (c) => clients[c];
//# sourceMappingURL=clients.js.map
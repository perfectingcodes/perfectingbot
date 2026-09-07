/** Solana is not EVM, so the RPC-level checks differ entirely. */
export const EVM_CHAINS = ["robinhood", "bsc", "base"];
export const isEvm = (c) => EVM_CHAINS.includes(c);
//# sourceMappingURL=types.js.map
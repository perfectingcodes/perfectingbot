export const erc20Abi = [
    { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
    { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
    { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
    { name: "owner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];
export const pairAbi = [
    { name: "token0", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    { name: "token1", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    { name: "getReserves", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }] },
];
/** UniswapV2 Swap(address,uint256,uint256,uint256,uint256,address) */
export const SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
/** UniswapV2Factory PairCreated(address,address,address,uint256) */
export const PAIR_CREATED_TOPIC = "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9";
/** UniswapV2Pair Mint(address,uint256,uint256) — liquidity add */
export const MINT_TOPIC = "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f";
/** UniswapV2Pair Burn(address,uint256,uint256,address) — liquidity remove */
export const BURN_TOPIC = "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496";
/** ERC20 Transfer(address,address,uint256) */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const ownableAbi = [
    { name: "owner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    { name: "getOwner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    { name: "mint", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
];
//# sourceMappingURL=abi.js.map
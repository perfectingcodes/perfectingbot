import { getAddress } from "viem";
import { config } from "../config.js";
import { pairFromTx, poolLiquidity, transfersWork } from "../chain/inspect.js";
import { isEvm } from "../types.js";
/**
 * Hard risk gates. Every one must pass — these are vetoes, not score inputs,
 * because "great social signal" never compensates for a token you cannot sell.
 */
export async function runGates(fomo, trigger, tokenPriceUsd) {
    const gates = [];
    const g = config.gates;
    let stats = null;
    try {
        stats = await fomo.tokenStats(trigger.token.address);
    }
    catch (err) {
        gates.push({ name: "stats", passed: false, detail: `token stats unavailable: ${String(err).slice(0, 120)}` });
    }
    if (stats) {
        gates.push({
            name: "holders", passed: stats.holders >= g.minHolders,
            detail: `${stats.holders} holders (min ${g.minHolders})`,
        });
        gates.push({
            name: "concentration", passed: stats.top10HoldersPercent <= g.maxTop10Percent,
            detail: `top10 hold ${stats.top10HoldersPercent.toFixed(1)}% (max ${g.maxTop10Percent}%)`,
        });
        const w5 = stats.windows["5m"];
        if (w5) {
            gates.push({
                name: "flow", passed: w5.buySellRatio >= g.minBuySellRatio5m,
                detail: `5m buy/sell ${w5.buySellRatio.toFixed(2)} (min ${g.minBuySellRatio5m})`,
            });
        }
    }
    // Liquidity + tradability, straight from chain state. EVM only: pool discovery works
    // by reading the trigger tx's Swap log, which has no Solana analogue here.
    // Solana pool depth is handled in solanaTierOne as explicit unknown evidence — it must
    // never be emitted here as a passing gate, because this one is a veto and a free pass
    // on a veto is worse than no check at all.
    if (!isEvm(trigger.chain)) {
        // no liquidity gate for Solana
    }
    else if (trigger.txHash) {
        try {
            const pair = await pairFromTx(trigger.chain, trigger.txHash);
            if (!pair) {
                gates.push({ name: "liquidity", passed: false, detail: "no UniV2 Swap log in trigger tx — unknown venue" });
            }
            else {
                const snap = await poolLiquidity(trigger.chain, pair, getAddress(trigger.token.address), tokenPriceUsd);
                gates.push({
                    name: "liquidity", passed: snap.liquidityUsd >= g.minLiquidityUsd,
                    detail: `~$${Math.round(snap.liquidityUsd).toLocaleString()} in ${pair.slice(0, 10)} (min $${g.minLiquidityUsd.toLocaleString()})`,
                });
            }
        }
        catch (err) {
            gates.push({ name: "liquidity", passed: false, detail: `chain read failed: ${String(err).slice(0, 120)}` });
        }
    }
    else {
        gates.push({ name: "liquidity", passed: false, detail: "no txHash on event (feed source) — cannot verify pool on-chain" });
    }
    if (isEvm(trigger.chain)) {
        gates.push(await honeypotGate(fomo, trigger.chain, trigger.token.address));
    }
    return gates;
}
/** Uses a real holder from FOMO's holder list as the simulated sender. */
async function honeypotGate(fomo, chain, token) {
    try {
        const holders = await fomo.tokenHolders(token);
        const holder = holders.find((h) => h.amount > 0);
        if (!holder)
            return { name: "honeypot", passed: false, detail: "no holder available to simulate a transfer" };
        // amount is human-scale in the holders payload; probe with 1% of it.
        const probe = BigInt(Math.max(1, Math.floor(holder.amount * 0.01)));
        const ok = await transfersWork(chain, getAddress(token), getAddress(holder.wallet ?? "0x0000000000000000000000000000000000000001"), probe);
        return { name: "honeypot", passed: ok, detail: ok ? "holder transfer simulates clean" : "holder transfer reverts — likely trap" };
    }
    catch (err) {
        return { name: "honeypot", passed: false, detail: `probe failed: ${String(err).slice(0, 120)}` };
    }
}
export const allPassed = (gates) => gates.length > 0 && gates.every((g) => g.passed);
//# sourceMappingURL=gates.js.map
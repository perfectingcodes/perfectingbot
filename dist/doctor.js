/**
 * Preflight. Confirms the things the bot silently depends on are actually reachable:
 * both RPCs, the PairCreated firehose, and (when a key is present) the FOMO plan tier.
 * Run this before trusting a live session.
 */
import { parseAbiItem } from "viem";
import { clientFor } from "./chain/clients.js";
import { getLogsChunked } from "./chain/logs.js";
import { config } from "./config.js";
import { FomoClient } from "./fomo/client.js";
import { reachable as solanaReachable } from "./chain/solana.js";
import { EVM_CHAINS } from "./types.js";
const ENV_VAR = { robinhood: "RH_RPC_URL", bsc: "BSC_RPC_URL", base: "BASE_RPC_URL" };
const pairCreated = parseAbiItem("event PairCreated(address indexed token0, address indexed token1, address pair, uint)");
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const warn = (m) => console.log(`  warn  ${m}`);
console.log("\nRPC + launchpad firehose");
for (const chain of EVM_CHAINS) {
    const client = clientFor(chain);
    try {
        const [id, head] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
        if (id !== config.chains[chain].id) {
            bad(`${chain}: RPC reports chainId ${id}, expected ${config.chains[chain].id}`);
            continue;
        }
        ok(`${chain}: chainId ${id}, head ${head}`);
        const PAIR_CREATED = "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9";
        const POOL_CREATED = "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118";
        let found = 0, limited = false, incomplete = false;
        for (const [label, topic] of [["v2", PAIR_CREATED], ["v3", POOL_CREATED]]) {
            const res = await getLogsChunked(chain, {
                topics: [topic],
                fromBlock: head > 2000n ? head - 2000n : 0n,
                toBlock: head,
            }, { initialRange: 200n, maxRequests: 12 });
            found += res.logs.length;
            limited ||= res.rateLimited;
            incomplete ||= !res.complete;
            if (res.logs.length)
                ok(`${chain}: ${res.logs.length} ${label} pool creations in ${res.scannedBlocks} blocks`);
        }
        if (limited)
            bad(`${chain}: RPC rate-limited during a routine log scan — the public endpoint cannot sustain tier-1 on-chain checks. Set ${ENV_VAR[chain]} to a dedicated provider (Alchemy / Chainstack / OrbitFlare / SolidRPC / NodeFlare).`);
        else if (incomplete)
            bad(`${chain}: RPC could not serve the full log range — set a dedicated ${ENV_VAR[chain]}.`);
        else if (found === 0)
            warn(`${chain}: no pool creations in the scanned window (quiet period)`);
    }
    catch (e) {
        bad(`${chain}: unreachable at ${config.chains[chain].rpc} — ${String(e).slice(0, 120)}`);
    }
}
console.log("\nSolana RPC");
{
    const r = await solanaReachable();
    if (r.ok) {
        ok(`solana: ${r.detail}`);
        try {
            // USDC mint: both authorities are set on it, so a correct read returns false/false.
            const { mintInfo } = await import("./chain/solana.js");
            const info = await mintInfo("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
            if (info.decimals === 6)
                ok(`solana: mint + freeze authority reads work (control token, ${info.decimals} decimals)`);
            else
                warn(`solana: control token returned decimals=${info.decimals}, expected 6`);
            // getTokenLargestAccounts is far heavier and is the first thing a public RPC refuses.
            const { concentration } = await import("./chain/solana.js");
            try {
                const c = await concentration("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
                if (c.top10Percent !== null)
                    ok(`solana: holder concentration readable (${c.holdersSampled} accounts sampled)`);
                else
                    warn("solana: concentration returned no data");
            }
            catch {
                bad("solana: getTokenLargestAccounts rejected by this RPC — holder concentration will read as unmeasured. Set SOLANA_RPC_URL to a dedicated provider (Helius / QuickNode / Triton).");
            }
        }
        catch (e) {
            bad(`solana: mint account read failed — ${String(e).slice(0, 140)}`);
        }
    }
    else {
        bad(`solana: unreachable at ${config.chains.solana.rpc} — ${r.detail}`);
    }
}
console.log("\nFOMO API");
if (!config.fomoKey) {
    warn("FOMO_API_KEY not set — signal layer is offline (npm run replay still works)");
}
else {
    const fomo = new FomoClient();
    try {
        const { traders } = await fomo.leaderboard("7d");
        ok(`leaderboard/7d returned ${traders?.length ?? 0} traders`);
        const withEvm = traders?.filter((t) => t.wallets?.evm).length ?? 0;
        if (withEvm === 0)
            bad("no traders expose an EVM wallet — watchlist would be empty");
        else
            ok(`${withEvm} traders expose EVM wallets`);
    }
    catch (e) {
        bad(`leaderboard failed — ${String(e).slice(0, 160)}`);
    }
    try {
        // /ws/trades is Growth+; a 402/403 here means the 15s lead time is not available.
        const res = await fetch(`${config.fomoBase}/v2/tokens/activity`, { headers: { authorization: `Bearer ${config.fomoKey}` } });
        if (res.ok)
            ok("token activity endpoint reachable");
        else if (res.status === 402 || res.status === 403)
            warn(`activity endpoint returned ${res.status} — plan tier may exclude on-chain data`);
        else
            warn(`activity endpoint returned ${res.status}`);
    }
    catch (e) {
        warn(`activity probe failed: ${String(e).slice(0, 100)}`);
    }
}
console.log("\nDiscovery");
if (!config.discovery.enabled)
    warn("discovery disabled (DISCOVERY=off) — the scanner only reacts to tracked wallets");
else {
    ok(`polling ${config.discovery.boards.join(", ")} across ${config.discovery.networks.join(", ")} every ${config.discovery.intervalMs / 1000}s`);
    ok(`up to ${config.discovery.perCycle}/cycle above $${config.discovery.minVolume24hUsd.toLocaleString()} 24h volume, revisit after ${config.discovery.revisitMs / 60_000}m`);
    const unstreamed = config.discovery.networks.filter((c) => !config.streamChains.includes(c));
    if (unstreamed.length)
        ok(`${unstreamed.join(", ")} reached by discovery only — /ws/trades does not carry them`);
}
console.log("\nConfig");
ok(`mode=${config.mode}  bankroll=$${config.risk.bankrollUsd}  max position=${config.risk.maxPositionPct}% ($${(config.risk.bankrollUsd * config.risk.maxPositionPct / 100).toFixed(2)})`);
ok(`consensus: ${config.signal.minDistinctBuyers} wallets / ${config.signal.consensusWindowMs / 60_000}m, min buy $${config.signal.minBuyUsd}`);
if (config.mode === "live")
    bad("MODE=live is not implemented — src/exec/live.ts throws by design");
if (!process.env.SOCIAL_API_URL)
    warn("SOCIAL_API_URL not set — tier 3 social velocity is unmeasured");
console.log(`\n${failures === 0 ? "preflight passed" : `${failures} failure(s) — fix before running live`}\n`);
process.exit(failures === 0 ? 0 : 1);
//# sourceMappingURL=doctor.js.map
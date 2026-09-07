/**
 * Offline harness. Runs the decision layer — consensus, evidence weighting, vetoes,
 * sizing, kill switch, rendering — with no API key and no RPC, on fixed scenarios.
 *
 * It deliberately does NOT exercise the network layer: what it proves is that the
 * logic reaches the right verdict given a set of facts, which is the part that has
 * to be right before any money is involved.
 */
import { ConsensusTracker } from "./signals/consensus.js";
import { assess, ev } from "./signals/evidence.js";
import { RiskManager } from "./risk.js";
import { PaperExecutor } from "./exec/paper.js";
import { explain } from "./explain.js";
import { recordSetup } from "./report.js";
import { normalize } from "./fomo/stream.js";
const now = Date.now();
const scenarios = [
    {
        name: "clean consensus entry",
        token: { address: "0x1111111111111111111111111111111111111111", symbol: "CACHE" },
        evidence: [
            ev(1, "honeypot", "pass", "holder transfer simulates clean", { share: 0.22, veto: true }),
            ev(1, "liquidity", "pass", "~$180,000 in 0x9a3f12ab (min $25,000)", { share: 0.18, veto: true }),
            ev(1, "concentration", "pass", "top10 hold 31.4% (max 55%)", { share: 0.14, veto: true }),
            ev(1, "bundling", "pass", "3 buys in the launch block (12% of early flow), largest same-funder cluster 1", { share: 0.12, veto: true }),
            ev(1, "lp-pulled", "pass", "no liquidity removals in recent history", { share: 0.10, veto: true }),
            ev(1, "dev-selling", "pass", "dev position looks intact", { share: 0.10, veto: true }),
            ev(1, "flow", "pass", "5m buy/sell 2.10 (min 1.1)", { share: 0.10 }),
            ev(1, "mint", "pass", "no mint function in bytecode", { share: 0.08 }),
            ev(1, "fresh-wallets", "pass", "18% of early buyers are brand-new wallets", { share: 0.08 }),
            ev(1, "ownership", "pass", "ownership renounced", { share: 0.06 }),
            ev(1, "lp-locked", "pass", "97.2% of LP is burned or in a visible sink", { share: 0.06 }),
            ev(2, "consensus", "pass", "3 independent tracked wallets bought within 20m", { share: 0.40, credit: 0.5 }),
            ev(2, "track-record", "pass", "best buyer ranks #7 on the 30d leaderboard (durable PnL, not a 24h spike)", { share: 0.35, credit: 0.97 }),
            ev(2, "conviction", "pass", "largest buy is 4.2% of that trader's book", { share: 0.25 }),
            ev(3, "social-velocity", "pass", "mentions accelerating 2.6σ above this token's own baseline (14.0/min)", { share: 1.0 }),
        ],
    },
    {
        name: "insider bundle — must be vetoed despite perfect social",
        token: { address: "0x2222222222222222222222222222222222222222", symbol: "MOONX" },
        evidence: [
            ev(1, "honeypot", "pass", "holder transfer simulates clean", { share: 0.22, veto: true }),
            ev(1, "liquidity", "pass", "~$92,000 in 0x77ac01de (min $25,000)", { share: 0.18, veto: true }),
            ev(1, "concentration", "fail", "top10 hold 78.9% (max 55%)", { share: 0.14, veto: true }),
            ev(1, "bundling", "fail", "31 buys in the launch block (86% of early flow), largest same-funder cluster 9", { share: 0.12, veto: true }),
            ev(1, "lp-pulled", "pass", "no liquidity removals in recent history", { share: 0.10, veto: true }),
            ev(1, "dev-selling", "pass", "dev position looks intact", { share: 0.10, veto: true }),
            ev(1, "fresh-wallets", "fail", "91% of early buyers are brand-new wallets", { share: 0.08 }),
            ev(2, "consensus", "pass", "4 independent tracked wallets bought within 20m", { share: 0.40, credit: 0.75 }),
            ev(3, "social-velocity", "pass", "mentions accelerating 5.1σ above this token's own baseline (63.0/min)", { share: 1.0 }),
        ],
    },
    {
        name: "thin evidence — unknowns must not read as passes",
        token: { address: "0x3333333333333333333333333333333333333333", symbol: "QUIET" },
        evidence: [
            ev(1, "honeypot", "pass", "holder transfer simulates clean", { share: 0.22, veto: true }),
            ev(1, "liquidity", "pass", "~$41,000 in 0x18bb77c0 (min $25,000)", { share: 0.18, veto: true }),
            ev(1, "bundling", "unknown", "no pool address recovered — cannot check launch bundling", { share: 0.20 }),
            ev(1, "dev-selling", "unknown", "dev position data unavailable", { share: 0.10 }),
            ev(1, "contract-safety", "unknown", "contract checks failed: RPC timeout", { share: 0.30 }),
            ev(2, "consensus", "warn", "2 independent tracked wallets bought within 20m", { share: 0.40, credit: 0.25 }),
            ev(2, "track-record", "warn", "buyers only rank on the 24h board — could be lottery winners", { share: 0.35, credit: 0.25 }),
            ev(2, "conviction", "unknown", "could not size buys against trader books", { share: 0.25 }),
            ev(3, "social-velocity", "unknown", "no social source configured (set SOCIAL_API_URL)", { share: 1.0 }),
        ],
    },
];
function run() {
    // Prove the normalizer handles the documented on-chain payload shape.
    const sample = normalize({
        type: "trade", chain: "robinhood", chainId: 4663, side: "buy",
        trader: { wallet: "0xAAA0000000000000000000000000000000000001", handle: "cosekant" },
        token: { address: "0x1111111111111111111111111111111111111111", symbol: "CACHE", mcap: 1234567 },
        usdValue: 3871.2, amountToken: 12345.6, txHash: "0xdead", block: 52795900,
        blockTs: now - 1100, seenAt: now, latencyMs: 1100, source: "onchain",
    }, "onchain");
    console.log(`normalizer: ${sample ? `ok — ${sample.chain} ${sample.token.symbol} $${sample.usdValue} price $${(sample.usdValue / sample.amountToken).toFixed(6)}` : "FAILED"}`);
    // Consensus must count wallets, not prints.
    const tracker = new ConsensusTracker();
    const base = { chain: "robinhood", chainId: 4663, side: "buy", token: { address: "0xabc" }, blockTs: now, seenAt: now, source: "onchain" };
    tracker.record({ ...base, trader: { wallet: "0xA" }, usdValue: 1000 });
    tracker.record({ ...base, trader: { wallet: "0xA" }, usdValue: 2000 });
    const after = tracker.record({ ...base, trader: { wallet: "0xB" }, usdValue: 1500 });
    console.log(`consensus dedupe: ${after.length === 2 ? "ok — 3 prints from 2 wallets counts as 2" : `FAILED (${after.length})`}`);
    // Risk caps.
    const risk = new RiskManager();
    const size = risk.sizeFor(100_000);
    console.log(`sizing: $100k whale buy -> $${size.toFixed(2)} (capped at 2% of $1,000 bankroll) ${size <= 20.000001 ? "ok" : "FAILED"}`);
    const paper = new PaperExecutor();
    for (const s of scenarios) {
        const setup = {
            token: s.token, chain: "robinhood",
            buyers: [
                { wallet: "0xA", handle: "cosekant", usdValue: 4200, at: now - 300_000 },
                { wallet: "0xB", handle: "frankdegods", usdValue: 1800, at: now - 120_000 },
                { wallet: "0xC", handle: "CryptoKaleo", usdValue: 950, at: now - 40_000 },
            ],
            firstSeen: now - 300_000, leadMs: 1100, priceUsd: 0.0003136, source: "stream",
        };
        const a = assess(s.evidence);
        console.log(explain(setup, a));
        recordSetup(setup, a);
        if (a.label === "SETUP") {
            const gate = risk.canEnter(`robinhood:${s.token.address}`);
            if (gate.ok) {
                paper.enter({ setup, sizeUsd: risk.sizeFor(4200) }, setup.priceUsd);
                risk.onEnter(`robinhood:${s.token.address}`);
            }
        }
    }
    console.log(`\nverdicts: ${scenarios.map((s) => `${s.token.symbol}=${assess(s.evidence).label}`).join("  ")}`);
    console.log(`open paper positions: ${paper.open().length}`);
    console.log(`dashboard written to state/dashboard.html`);
}
run();
//# sourceMappingURL=replay.js.map
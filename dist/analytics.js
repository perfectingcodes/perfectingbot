import { loadRecent } from "./report.js";
/**
 * Everything here is derived from our own log, not from anyone's marketing.
 * "Best traders" means: whose buys, historically, led to setups that cleared
 * our gates — which is a different and more useful question than who has the
 * biggest PnL on a leaderboard.
 */
export function traderStats(records) {
    const map = new Map();
    for (const r of records) {
        for (const b of r.setup.buyers) {
            const key = b.wallet.toLowerCase();
            let s = map.get(key);
            if (!s) {
                s = { wallet: b.wallet, handle: b.handle, appearances: 0, setups: 0, rejects: 0, watches: 0,
                    hitRate: 0, avgScore: 0, bestScore: 0, totalUsd: 0, avgUsd: 0, chains: [], tokens: [], lastSeen: 0 };
                map.set(key, s);
            }
            if (!s.handle && b.handle)
                s.handle = b.handle;
            s.appearances++;
            if (r.assessment.label === "SETUP")
                s.setups++;
            else if (r.assessment.label === "WATCH")
                s.watches++;
            else
                s.rejects++;
            s.totalUsd += b.usdValue;
            s.avgScore += r.assessment.score;
            s.bestScore = Math.max(s.bestScore, r.assessment.score);
            s.lastSeen = Math.max(s.lastSeen, r.at);
            if (!s.chains.includes(r.setup.chain))
                s.chains.push(r.setup.chain);
            const tok = r.setup.token.symbol ?? r.setup.token.address.slice(0, 10);
            if (!s.tokens.includes(tok))
                s.tokens.push(tok);
        }
    }
    for (const s of map.values()) {
        s.avgScore = Math.round(s.avgScore / s.appearances);
        s.avgUsd = Math.round(s.totalUsd / s.appearances);
        s.hitRate = s.appearances ? s.setups / s.appearances : 0;
    }
    // Rank by hit rate, but require a minimum sample so one lucky call can't top the board.
    return [...map.values()].sort((a, b) => {
        const qa = a.appearances >= 3 ? a.hitRate : a.hitRate * 0.5;
        const qb = b.appearances >= 3 ? b.hitRate : b.hitRate * 0.5;
        return qb - qa || b.avgScore - a.avgScore || b.appearances - a.appearances;
    });
}
export function tokenStats(records) {
    const map = new Map();
    // Oldest first so history reads chronologically.
    for (const r of [...records].sort((a, b) => a.at - b.at)) {
        const key = `${r.setup.chain}:${r.setup.token.address}`;
        let t = map.get(key);
        if (!t) {
            t = { address: r.setup.token.address, symbol: r.setup.token.symbol, chain: r.setup.chain,
                evaluations: 0, bestScore: 0, latestScore: 0, latestLabel: "", firstSeen: r.at, lastSeen: r.at,
                history: [], buyers: [], failedChecks: [] };
            map.set(key, t);
        }
        t.evaluations++;
        t.bestScore = Math.max(t.bestScore, r.assessment.score);
        t.latestScore = r.assessment.score;
        t.latestLabel = r.assessment.label;
        t.lastSeen = r.at;
        t.history.push({ at: r.at, score: r.assessment.score, label: r.assessment.label });
        for (const b of r.setup.buyers) {
            const who = b.handle ?? b.wallet.slice(0, 8);
            if (!t.buyers.includes(who))
                t.buyers.push(who);
        }
        t.failedChecks = r.assessment.evidence.filter((e) => e.verdict === "fail").map((e) => e.name);
    }
    return [...map.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}
/** Which gates actually do the rejecting — the fastest way to tell if they're mistuned. */
export function gateStats(records) {
    const counts = new Map();
    for (const r of records) {
        for (const e of r.assessment.evidence) {
            let c = counts.get(e.name);
            if (!c)
                counts.set(e.name, (c = { name: e.name, fail: 0, pass: 0, warn: 0, unknown: 0, vetoed: 0 }));
            c[e.verdict]++;
            if (e.veto && e.verdict === "fail")
                c.vetoed++;
        }
    }
    return [...counts.values()].sort((a, b) => b.vetoed - a.vetoed || b.fail - a.fail);
}
export function summary(records) {
    const setups = records.filter((r) => r.assessment.label === "SETUP");
    const watches = records.filter((r) => r.assessment.label === "WATCH");
    const blind = records.reduce((s, r) => s + r.assessment.unknowns.length, 0);
    return {
        evaluations: records.length,
        setups: setups.length,
        watches: watches.length,
        rejects: records.length - setups.length - watches.length,
        avgScore: records.length ? Math.round(records.reduce((s, r) => s + r.assessment.score, 0) / records.length) : 0,
        blindSpotsPerEval: records.length ? +(blind / records.length).toFixed(1) : 0,
        chains: [...new Set(records.map((r) => r.setup.chain))],
        since: records.length ? Math.min(...records.map((r) => r.at)) : 0,
    };
}
export const all = (limit = 2000) => loadRecent(limit);
//# sourceMappingURL=analytics.js.map
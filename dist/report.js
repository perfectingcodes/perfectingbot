import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
/**
 * STATE_DIR is configurable because a Replit deploy has an ephemeral filesystem: a
 * redeploy wipes it and takes your evaluation history with it. Point this at a mounted
 * volume (or sync the file out) if you want the log to survive, since the log is the
 * only record you have for tuning the gates.
 */
const DIR = process.env.STATE_DIR ?? "state";
const LOG = `${DIR}/setups.jsonl`;
/**
 * Append-only log of every evaluation, rejects included — the rejects are how you find
 * out whether the gates are mistuned. This file is the single source of truth; the
 * dashboard is a view over it, so nothing is rendered on the hot path.
 */
export function recordSetup(setup, assessment) {
    mkdirSync(DIR, { recursive: true });
    appendFileSync(LOG, JSON.stringify({ at: Date.now(), setup, assessment }, bigintSafe) + "\n");
}
export function loadRecent(n = 50) {
    if (!existsSync(LOG))
        return [];
    const out = [];
    for (const line of readFileSync(LOG, "utf8").split("\n")) {
        if (!line.trim())
            continue;
        // One malformed line (a partial write during a crash) must not blank the dashboard.
        try {
            out.push(JSON.parse(line));
        }
        catch { /* skip */ }
    }
    return out.slice(-n).reverse();
}
const bigintSafe = (_, v) => (typeof v === "bigint" ? v.toString() : v);
//# sourceMappingURL=report.js.map
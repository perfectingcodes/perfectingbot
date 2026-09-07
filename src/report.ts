import { appendFileSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import type { Assessment } from "./signals/evidence.ts";
import type { Setup } from "./types.ts";

const DIR = "state";
const LOG = `${DIR}/setups.jsonl`;
const HTML = `${DIR}/dashboard.html`;

export interface Record_ { at: number; setup: Setup; assessment: Assessment }

/** Every evaluation is logged, rejects included — the rejects are how you tune the gates. */
export function recordSetup(setup: Setup, assessment: Assessment) {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(LOG, JSON.stringify({ at: Date.now(), setup, assessment }, bigintSafe) + "\n");
  try { writeFileSync(HTML, renderDashboard(loadRecent(50))); } catch { /* never let reporting break the bot */ }
}

export function loadRecent(n = 50): Record_[] {
  if (!existsSync(LOG)) return [];
  const lines = readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-n).map((l) => JSON.parse(l) as Record_).reverse();
}

const bigintSafe = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function renderDashboard(records: Record_[]): string {
  const rows = records.map((r) => {
    const s = r.setup, a = r.assessment;
    const tone = a.label === "SETUP" ? "ok" : a.label === "WATCH" ? "warn" : "bad";
    const tiers = [1, 2, 3].map((t) => {
      const items = a.evidence.filter((e) => e.tier === t);
      if (!items.length) return "";
      return `<div class="tier"><h4>${["", "On-chain truth", "Smart money", "Social"][t]}</h4>${items.map((e) => `
        <div class="ck ${e.verdict}"><span class="mk">${{ pass: "✓", warn: "!", fail: "✗", unknown: "?" }[e.verdict]}</span>
        <b>${esc(e.name)}</b><span>${esc(e.says)}</span>${e.veto && e.verdict === "fail" ? '<em>disqualifying</em>' : ""}</div>`).join("")}</div>`;
    }).join("");

    return `<details class="card ${tone}"${a.label === "SETUP" ? " open" : ""}>
      <summary><span class="badge">${a.label}</span><span class="score">${a.score}</span>
      <b>${esc(s.token.symbol ?? s.token.address.slice(0, 10))}</b>
      <span class="chain">${esc(s.chain)}</span>
      <span class="head">${esc(a.headline)}</span>
      <time>${new Date(r.at).toLocaleTimeString()}</time></summary>
      <div class="body">
        <div class="meta"><code>${esc(s.token.address)}</code> · ${s.buyers.length} wallets: ${esc(s.buyers.map((b) => b.handle ?? b.wallet.slice(0, 8)).join(", "))} · lead ${s.leadMs}ms</div>
        ${tiers}
      </div></details>`;
  }).join("");

  return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="15">
<title>perfectingbot</title><style>
:root{--bg:#0d1117;--fg:#e6edf3;--dim:#8b949e;--line:#30363d;--ok:#3fb950;--warn:#d29922;--bad:#f85149}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
h1{font-size:16px;margin:0 0 4px}.sub{color:var(--dim);margin-bottom:20px}
.card{border:1px solid var(--line);border-left-width:3px;border-radius:6px;margin-bottom:8px;background:#161b22}
.card.ok{border-left-color:var(--ok)}.card.warn{border-left-color:var(--warn)}.card.bad{border-left-color:var(--bad)}
summary{padding:10px 14px;cursor:pointer;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.badge{font-size:11px;padding:2px 7px;border-radius:3px;background:#21262d;color:var(--dim);letter-spacing:.5px}
.ok .badge{background:rgba(63,185,80,.15);color:var(--ok)}.warn .badge{background:rgba(210,153,34,.15);color:var(--warn)}.bad .badge{background:rgba(248,81,73,.15);color:var(--bad)}
.score{font-size:18px;font-weight:700;min-width:34px}.chain{color:var(--dim);font-size:12px}
.head{color:var(--dim);flex:1;min-width:200px}time{color:var(--dim);font-size:12px}
.body{padding:0 14px 14px}.meta{color:var(--dim);font-size:12px;padding:6px 0 12px;border-top:1px solid var(--line);word-break:break-all}
.tier h4{margin:12px 0 6px;font-size:11px;color:var(--dim);letter-spacing:1px;text-transform:uppercase}
.ck{display:flex;gap:8px;padding:3px 0;align-items:baseline}.ck b{min-width:120px}.ck span:last-child{color:var(--dim)}
.mk{width:12px}.ck.pass .mk{color:var(--ok)}.ck.warn .mk{color:var(--warn)}.ck.fail .mk{color:var(--bad)}.ck.unknown .mk{color:var(--dim)}
.ck em{color:var(--bad);font-style:normal;font-size:11px}
</style>
<h1>perfectingbot</h1>
<div class="sub">${records.length} evaluations · ${records.filter((r) => r.assessment.label === "SETUP").length} setups · auto-refreshes every 15s</div>
${rows || '<div class="sub">No evaluations yet.</div>'}`;
}

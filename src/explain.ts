import type { Assessment, Evidence } from "./signals/evidence.ts";
import type { Setup } from "./types.ts";

const MARK: Record<Evidence["verdict"], string> = { pass: "✓", warn: "!", fail: "✗", unknown: "?" };
const TIER_NAME: Record<number, string> = { 1: "ON-CHAIN TRUTH", 2: "SMART MONEY", 3: "SOCIAL" };

/**
 * The whole point of this file: a person reading one screen should know what the
 * bot saw, what it rejected, and what it still can't see — without reading the code.
 */
export function explain(setup: Setup, a: Assessment): string {
  const L: string[] = [];
  const sym = setup.token.symbol ?? setup.token.address.slice(0, 10);

  L.push("");
  L.push(`${"═".repeat(66)}`);
  L.push(`  ${a.label}  ${sym}  ·  score ${a.score}/100  ·  ${setup.chain}`);
  L.push(`  ${a.headline}`);
  L.push(`${"═".repeat(66)}`);

  L.push(`  token   ${setup.token.address}`);
  L.push(`  bought  ${setup.buyers.length} wallets · ${setup.buyers.map((b) => b.handle ?? b.wallet.slice(0, 8)).join(", ")}`);
  L.push(`  timing  saw it ${setup.leadMs}ms after the block${setup.leadMs < 15_000 ? " (ahead of the app feed)" : ""}`);

  for (const tier of [1, 2, 3] as const) {
    const rows = a.evidence.filter((e) => e.tier === tier);
    if (!rows.length) continue;
    const got = rows.reduce((s, r) => s + r.points, 0);
    const max = rows.reduce((s, r) => s + r.maxPoints, 0);
    L.push("");
    L.push(`  ${TIER_NAME[tier]}  ${got.toFixed(0)}/${max.toFixed(0)} pts`);
    for (const r of rows) {
      L.push(`    ${MARK[r.verdict]} ${pad(r.name, 16)} ${r.says}${r.veto && r.verdict === "fail" ? "   ← DISQUALIFYING" : ""}`);
    }
  }

  if (a.unknowns.length) {
    L.push("");
    L.push(`  BLIND SPOTS (score was reduced for these, they are not passes)`);
    for (const u of a.unknowns) L.push(`    ? ${u.says}`);
  }

  L.push("");
  L.push(`  WHAT WOULD CHANGE THIS`);
  for (const line of nextSteps(a)) L.push(`    · ${line}`);
  L.push("");
  return L.join("\n");
}

function nextSteps(a: Assessment): string[] {
  const out: string[] = [];
  if (a.vetoes.length) {
    out.push(`nothing — a disqualifying check failed, and score is irrelevant when it does`);
    return out;
  }
  for (const e of a.evidence) {
    if (e.verdict === "fail" && e.tier === 1) out.push(`${e.name} would have to flip: ${e.says}`);
    if (e.verdict === "warn" && e.maxPoints >= 5) out.push(`${e.name} is soft: ${e.says}`);
    if (e.verdict === "unknown" && e.maxPoints >= 5) out.push(`${e.name} is unmeasured — wire the data source to stop losing ${(e.maxPoints * 0.5).toFixed(0)} pts here`);
  }
  if (!out.length) out.push("every check that can be measured is passing");
  return out.slice(0, 6);
}

const pad = (s: string, n: number) => s.length >= n ? s : s + " ".repeat(n - s.length);

/** One-line form for webhooks and logs. */
export const oneLine = (setup: Setup, a: Assessment) =>
  `[${a.label} ${a.score}] ${setup.token.symbol ?? setup.token.address.slice(0, 10)} on ${setup.chain} — ${a.headline}`;

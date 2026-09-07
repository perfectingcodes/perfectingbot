import type { GateResult } from "../types.ts";

export type Verdict = "pass" | "warn" | "fail" | "unknown";
export type Tier = 1 | 2 | 3;

export interface Evidence {
  tier: Tier;
  name: string;
  verdict: Verdict;
  /** Contribution to the score, already weighted. Negative for warnings. */
  points: number;
  maxPoints: number;
  /** One line a human can read without knowing how the bot works. */
  says: string;
  /** True for facts that disqualify outright regardless of everything else. */
  veto?: boolean;
}

/**
 * Tier weights follow the priority stack: on-chain truth outranks smart money,
 * which outranks social. Social can only ever add a little — it is confirmation,
 * never a reason on its own.
 */
export const TIER_BUDGET: Record<Tier, number> = { 1: 55, 2: 35, 3: 10 };

export interface Assessment {
  score: number;
  label: "SETUP" | "WATCH" | "REJECT";
  headline: string;
  evidence: Evidence[];
  vetoes: Evidence[];
  unknowns: Evidence[];
}

export function assess(evidence: Evidence[]): Assessment {
  const vetoes = evidence.filter((e) => e.veto && e.verdict === "fail");
  const unknowns = evidence.filter((e) => e.verdict === "unknown");

  const earned = evidence.reduce((sum, e) => sum + e.points, 0);
  const available = evidence.reduce((sum, e) => sum + (e.verdict === "unknown" ? 0 : e.maxPoints), 0);
  // Score against what we could actually measure, then penalise blind spots separately,
  // so a token we know nothing about never scores the same as one that passed real checks.
  const base = available > 0 ? (earned / available) * 100 : 0;
  const blindSpotPenalty = unknowns.reduce((s, e) => s + e.maxPoints, 0) * 0.5;
  const score = Math.max(0, Math.min(100, Math.round(base - blindSpotPenalty)));

  const label: Assessment["label"] = vetoes.length > 0 ? "REJECT" : score >= 70 ? "SETUP" : score >= 45 ? "WATCH" : "REJECT";

  const headline =
    vetoes.length > 0
      ? `Disqualified: ${vetoes.map((v) => v.says).join("; ")}`
      : label === "SETUP"
        ? `Clears every hard check, ${describeStrength(evidence)}`
        : label === "WATCH"
          ? `Nothing disqualifying, but ${weakestLine(evidence)}`
          : `Too weak to act on: ${weakestLine(evidence)}`;

  return { score, label, headline, evidence, vetoes, unknowns };
}

const describeStrength = (ev: Evidence[]) => {
  const strong = ev.filter((e) => e.verdict === "pass" && e.tier <= 2).map((e) => e.name);
  return strong.length ? `strongest on ${strong.slice(0, 3).join(", ")}` : "on thin evidence";
};

const weakestLine = (ev: Evidence[]) => {
  const bad = ev.filter((e) => e.verdict === "fail" || e.verdict === "warn").sort((a, b) => b.maxPoints - a.maxPoints)[0];
  return bad ? bad.says : "not enough confirming signals";
};

/** Helper so each check reads the same way at the call site. */
export function ev(
  tier: Tier, name: string, verdict: Verdict, says: string,
  opts: { share: number; veto?: boolean; credit?: number } ,
): Evidence {
  const maxPoints = TIER_BUDGET[tier] * opts.share;
  const credit = opts.credit ?? (verdict === "pass" ? 1 : verdict === "warn" ? 0.25 : 0);
  return { tier, name, verdict, says, maxPoints, points: maxPoints * credit, veto: opts.veto };
}

export const fromGate = (g: GateResult, tier: Tier, share: number, veto = true): Evidence =>
  ev(tier, g.name, g.passed ? "pass" : "fail", g.detail, { share, veto });

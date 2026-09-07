/**
 * Tier weights follow the priority stack: on-chain truth outranks smart money,
 * which outranks social. Social can only ever add a little — it is confirmation,
 * never a reason on its own.
 */
export const TIER_BUDGET = { 1: 55, 2: 35, 3: 10 };
export function assess(evidence) {
    const vetoes = evidence.filter((e) => e.veto && e.verdict === "fail");
    const unknowns = evidence.filter((e) => e.verdict === "unknown");
    const earned = evidence.reduce((sum, e) => sum + e.points, 0);
    const available = evidence.reduce((sum, e) => sum + (e.verdict === "unknown" ? 0 : e.maxPoints), 0);
    // Score against what we could actually measure, then penalise blind spots separately,
    // so a token we know nothing about never scores the same as one that passed real checks.
    const base = available > 0 ? (earned / available) * 100 : 0;
    const blindSpotPenalty = unknowns.reduce((s, e) => s + e.maxPoints, 0) * 0.5;
    const score = Math.max(0, Math.min(100, Math.round(base - blindSpotPenalty)));
    const label = vetoes.length > 0 ? "REJECT" : score >= 70 ? "SETUP" : score >= 45 ? "WATCH" : "REJECT";
    const headline = vetoes.length > 0
        ? `Disqualified: ${vetoes.map((v) => v.says).join("; ")}`
        : label === "SETUP"
            ? `Clears every hard check, ${describeStrength(evidence)}`
            : label === "WATCH"
                ? `Nothing disqualifying, but ${weakestLine(evidence)}`
                : `Too weak to act on: ${weakestLine(evidence)}`;
    return { score, label, headline, evidence, vetoes, unknowns };
}
const describeStrength = (ev) => {
    const strong = ev.filter((e) => e.verdict === "pass" && e.tier <= 2).map((e) => e.name);
    return strong.length ? `strongest on ${strong.slice(0, 3).join(", ")}` : "on thin evidence";
};
const weakestLine = (ev) => {
    const bad = ev.filter((e) => e.verdict === "fail" || e.verdict === "warn").sort((a, b) => b.maxPoints - a.maxPoints)[0];
    return bad ? bad.says : "not enough confirming signals";
};
/** Helper so each check reads the same way at the call site. */
export function ev(tier, name, verdict, says, opts) {
    const maxPoints = TIER_BUDGET[tier] * opts.share;
    const credit = opts.credit ?? (verdict === "pass" ? 1 : verdict === "warn" ? 0.25 : 0);
    return { tier, name, verdict, says, maxPoints, points: maxPoints * credit, veto: opts.veto };
}
export const fromGate = (g, tier, share, veto = true) => ev(tier, g.name, g.passed ? "pass" : "fail", g.detail, { share, veto });
//# sourceMappingURL=evidence.js.map
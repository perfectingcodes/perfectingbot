import { config } from "./config.js";
/**
 * Position sizing and circuit breakers. Every order passes through here, so a bug
 * downstream still cannot size past the caps or trade through the kill switch.
 */
export class RiskManager {
    openTokens = new Set();
    cooldownUntil = new Map();
    realizedPnlUsd = 0;
    dayStamp = today();
    halted = false;
    haltReason = "";
    /** Never mirror dollar-for-dollar: scale down, then clamp to the per-position cap. */
    sizeFor(mirroredUsd) {
        const cap = config.risk.bankrollUsd * (config.risk.maxPositionPct / 100);
        return Math.max(0, Math.min(cap, mirroredUsd * config.risk.mirrorFraction));
    }
    canEnter(key) {
        this.rollDay();
        if (this.halted)
            return { ok: false, reason: `halted: ${this.haltReason}` };
        if (this.openTokens.has(key))
            return { ok: false, reason: "already holding" };
        const until = this.cooldownUntil.get(key) ?? 0;
        if (Date.now() < until)
            return { ok: false, reason: `cooldown for ${Math.ceil((until - Date.now()) / 60_000)}m` };
        if (this.openTokens.size >= config.risk.maxConcurrentPositions)
            return { ok: false, reason: "max concurrent positions" };
        return { ok: true };
    }
    onEnter(key) { this.openTokens.add(key); }
    onExit(key, pnlUsd) {
        this.openTokens.delete(key);
        this.cooldownUntil.set(key, Date.now() + config.risk.cooldownMs);
        this.realizedPnlUsd += pnlUsd;
        const limit = -config.risk.bankrollUsd * (config.risk.dailyLossLimitPct / 100);
        if (this.realizedPnlUsd <= limit) {
            this.halted = true;
            this.haltReason = `daily loss limit hit (${this.realizedPnlUsd.toFixed(2)} USD)`;
            console.error(`[risk] KILL SWITCH: ${this.haltReason}`);
        }
    }
    rollDay() {
        if (today() !== this.dayStamp) {
            this.dayStamp = today();
            this.realizedPnlUsd = 0;
            if (this.halted && this.haltReason.startsWith("daily loss")) {
                this.halted = false;
                this.haltReason = "";
            }
        }
    }
    snapshot() {
        return { open: this.openTokens.size, realizedPnlUsd: this.realizedPnlUsd, halted: this.halted, haltReason: this.haltReason };
    }
}
const today = () => new Date().toISOString().slice(0, 10);
//# sourceMappingURL=risk.js.map
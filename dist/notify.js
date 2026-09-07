import { config } from "./config.js";
/** Console always; webhook when configured. Rendering lives in explain.ts. */
export async function notify(text) {
    if (!config.webhook)
        return;
    try {
        await fetch(config.webhook, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: text.slice(0, 1900) }),
            signal: AbortSignal.timeout(5_000),
        });
    }
    catch (err) {
        console.warn(`[notify] webhook failed: ${String(err).slice(0, 120)}`);
    }
}
//# sourceMappingURL=notify.js.map
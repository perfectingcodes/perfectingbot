let cached = null;
export async function resolveWebSocket() {
    if (cached)
        return cached;
    if (typeof globalThis.WebSocket === "function") {
        cached = globalThis.WebSocket;
        return cached;
    }
    try {
        const mod = await import("ws");
        console.warn("[ws] no global WebSocket on this runtime — falling back to the `ws` package");
        cached = (mod.WebSocket ?? mod.default);
        return cached;
    }
    catch {
        throw new Error("No WebSocket available: this runtime lacks a global WebSocket and the `ws` package is not installed. Use Node 22+ or run `npm install ws`.");
    }
}
//# sourceMappingURL=ws-compat.js.map
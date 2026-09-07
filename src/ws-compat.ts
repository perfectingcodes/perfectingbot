/**
 * Node 22+ ships a global WebSocket, but Replit and other hosts can land on an older
 * runtime where it is missing or flag-gated. Resolving the constructor at startup — with
 * the `ws` package as a fallback — means a host's Node version can't silently cost us the
 * trade stream, which is the whole timing edge.
 */
type WSCtor = new (url: string) => WebSocket;

let cached: WSCtor | null = null;

export async function resolveWebSocket(): Promise<WSCtor> {
  if (cached) return cached;
  if (typeof globalThis.WebSocket === "function") {
    cached = globalThis.WebSocket as unknown as WSCtor;
    return cached;
  }
  try {
    const mod = await import("ws");
    console.warn("[ws] no global WebSocket on this runtime — falling back to the `ws` package");
    cached = ((mod as any).WebSocket ?? (mod as any).default) as WSCtor;
    return cached;
  } catch {
    throw new Error("No WebSocket available: this runtime lacks a global WebSocket and the `ws` package is not installed. Use Node 22+ or run `npm install ws`.");
  }
}

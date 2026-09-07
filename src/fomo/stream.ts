import { config } from "../config.ts";
import { resolveWebSocket } from "../ws-compat.ts";
import type { Chain, TradeEvent } from "../types.ts";

type Handler = (e: TradeEvent) => void;

/**
 * Wraps wss://api.fomoapi.io/ws/trades (on-chain, ~15s ahead of the app feed; Growth+)
 * with a fallback to /ws/alerts (app feed, all plans). Reconnects with jittered backoff
 * and re-sends subscriptions, so a dropped socket doesn't silently stop the bot.
 */
export class FomoStream {
  private ws?: WebSocket;
  private handlers: Handler[] = [];
  private attempt = 0;
  private closed = false;
  private heartbeat?: NodeJS.Timeout;
  private lastMsgAt = Date.now();
  private WS?: new (url: string) => WebSocket;

  private opts: { chain: Chain; endpoint?: "trades" | "alerts"; key?: string };

  constructor(opts: { chain: Chain; endpoint?: "trades" | "alerts"; key?: string }) {
    this.opts = opts;
  }

  onTrade(h: Handler) { this.handlers.push(h); }

  async start() {
    this.closed = false;
    this.WS = await resolveWebSocket();
    this.connect();
  }

  stop() {
    this.closed = true;
    clearInterval(this.heartbeat);
    this.ws?.close();
  }

  private connect() {
    const endpoint = this.opts.endpoint ?? "trades";
    const key = this.opts.key ?? config.fomoKey;
    const url = `${config.fomoBase.replace("https://", "wss://")}/ws/${endpoint}?chain=${this.opts.chain}&key=${encodeURIComponent(key)}`;
    if (!this.WS) throw new Error("FomoStream.start() must be awaited before connecting");
    const ws = new this.WS(url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.attempt = 0;
      this.lastMsgAt = Date.now();
      console.log(`[stream:${this.opts.chain}] connected to /ws/${endpoint}`);
    });

    ws.addEventListener("message", (ev) => {
      this.lastMsgAt = Date.now();
      let msg: any;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }

      if (msg.type === "welcome") {
        console.log(`[stream:${this.opts.chain}] realtime=${msg.realtime} delaySeconds=${msg.delaySeconds ?? 0}`);
        // A non-zero delay means we're on a tier without the timing edge — say so loudly.
        if (msg.delaySeconds) console.warn(`[stream:${this.opts.chain}] feed is delayed ${msg.delaySeconds}s; the lead-time edge is absent on this plan`);
        return;
      }
      if (msg.type !== "trade" && msg.type !== "alert") return;

      const e = normalize(msg, endpoint === "trades" ? "onchain" : "feed");
      if (e) for (const h of this.handlers) h(e);
    });

    ws.addEventListener("close", () => this.scheduleReconnect(endpoint));
    ws.addEventListener("error", () => { try { ws.close(); } catch {} });

    // A silent socket is worse than a closed one: it looks healthy while missing every signal.
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastMsgAt > 90_000) {
        console.warn(`[stream:${this.opts.chain}] no messages for 90s, forcing reconnect`);
        try { ws.close(); } catch {}
      }
    }, 30_000);
  }

  private scheduleReconnect(endpoint: string) {
    if (this.closed) return;
    const wait = Math.min(30_000, 500 * 2 ** this.attempt++) + Math.random() * 500;
    console.warn(`[stream:${this.opts.chain}] /ws/${endpoint} disconnected, retrying in ${Math.round(wait)}ms`);
    setTimeout(() => this.connect(), wait);
  }
}

/** Both stream shapes collapse into one TradeEvent so downstream code has a single contract. */
export function normalize(msg: any, source: "onchain" | "feed"): TradeEvent | null {
  const chainId = msg.chainId ?? (msg.chain === "robinhood" || msg.chain === "hood" || msg.chain === "rh" ? 4663 : msg.chain === "bsc" ? 56 : undefined);
  const chain: Chain | undefined = chainId === 4663 ? "robinhood" : chainId === 56 ? "bsc" : undefined;
  const address = msg.token?.address;
  if (!chain || !address) return null;

  const blockTs = msg.blockTs ?? msg.ts ?? Date.now();
  return {
    chain,
    chainId: chainId!,
    side: msg.side === "sell" ? "sell" : "buy",
    trader: { wallet: msg.trader?.wallet ?? "", handle: msg.trader?.handle },
    token: { address: String(address).toLowerCase(), symbol: msg.token?.symbol, mcap: msg.token?.mcap },
    usdValue: Number(msg.usdValue ?? 0),
    amountToken: msg.amountToken !== undefined ? Number(msg.amountToken) : undefined,
    txHash: msg.txHash,
    blockTs,
    seenAt: msg.seenAt ?? Date.now(),
    source,
  };
}

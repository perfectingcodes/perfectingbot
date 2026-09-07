import { config } from "./config.js";
import { banner, c } from "./banner.js";
import { FomoClient } from "./fomo/client.js";
import { FomoStream } from "./fomo/stream.js";
import { Engine } from "./engine.js";
import { LaunchpadWatcher } from "./chain/launchpad.js";
import { FlagOnlyExecutor } from "./exec/flag.js";
import { PaperExecutor } from "./exec/paper.js";
import { LiveExecutor } from "./exec/live.js";
const executorFor = (mode) => mode === "paper" ? new PaperExecutor() : mode === "live" ? new LiveExecutor() : new FlagOnlyExecutor();
export async function startScanner() {
    if (!config.fomoKey)
        throw new Error("FOMO_API_KEY is required. Use `npm run replay` to exercise the pipeline offline.");
    if (config.mode === "live")
        throw new Error("MODE=live is not implemented. See src/exec/live.ts.");
    const fomo = new FomoClient();
    const engine = new Engine(fomo, executorFor(config.mode));
    banner(`mode=${config.mode}  executor=${executorFor(config.mode).name}`);
    await engine.loadWatchlist(100);
    const timers = [
        setInterval(() => engine.loadWatchlist(100).catch((e) => console.warn(`[engine] watchlist refresh failed: ${e}`)), 60 * 60_000),
        setInterval(() => engine.sweep(), 60_000),
        setInterval(() => console.log(`[stats] ${JSON.stringify({ ...engine.stats, ...engine.risk.snapshot(), credits: fomo.creditsUsed })}`), 5 * 60_000),
    ];
    const chains = ["robinhood", "bsc"];
    const streams = chains.map((chain) => {
        const s = new FomoStream({ chain });
        s.onTrade((e) => { engine.handle(e).catch((err) => console.error(`[engine] ${e.token.address}: ${err}`)); });
        s.start().catch((err) => console.error(`[stream:${chain}] failed to start: ${err.message ?? err}`));
        return s;
    });
    const watchers = chains.map((chain) => {
        const w = new LaunchpadWatcher(chain);
        w.onNewPair((p) => console.log(`[launchpad:${chain}] new ${p.kind} pool ${p.pair} (${p.token0} / ${p.token1})`));
        w.start();
        return w;
    });
    return {
        engine,
        fomo,
        stop() {
            for (const t of timers)
                clearInterval(t);
            for (const s of streams)
                s.stop();
            for (const w of watchers)
                w.stop();
        },
    };
}
//# sourceMappingURL=scanner.js.map
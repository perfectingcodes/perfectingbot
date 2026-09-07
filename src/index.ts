import { config, assertRunnable } from "./config.ts";
import { FomoClient } from "./fomo/client.ts";
import { FomoStream } from "./fomo/stream.ts";
import { Engine } from "./engine.ts";
import { FlagOnlyExecutor } from "./exec/flag.ts";
import { PaperExecutor } from "./exec/paper.ts";
import { LiveExecutor } from "./exec/live.ts";
import { LaunchpadWatcher } from "./chain/launchpad.ts";
import type { Chain } from "./types.ts";

const executorFor = (mode: string) =>
  mode === "paper" ? new PaperExecutor() : mode === "live" ? new LiveExecutor() : new FlagOnlyExecutor();

async function main() {
  assertRunnable();
  const fomo = new FomoClient();
  const engine = new Engine(fomo, executorFor(config.mode));
  console.log(`[boot] mode=${config.mode} executor=${executorFor(config.mode).name}`);

  await engine.loadWatchlist(100);
  // Refresh the leaderboard hourly; smart money rotates.
  setInterval(() => engine.loadWatchlist(100).catch((e) => console.warn(`[engine] watchlist refresh failed: ${e}`)), 60 * 60_000);
  setInterval(() => engine.sweep(), 60_000);
  setInterval(() => console.log(`[stats] ${JSON.stringify({ ...engine.stats, ...engine.risk.snapshot(), credits: fomo.creditsUsed })}`), 5 * 60_000);

  const chains: Chain[] = ["robinhood", "bsc"];
  const streams = chains.map((chain) => {
    const s = new FomoStream({ chain });
    s.onTrade((e) => { engine.handle(e).catch((err) => console.error(`[engine] ${e.token.address}: ${err}`)); });
    s.start();
    return s;
  });

  // Tier 1: every new pool on both chains, regardless of which launchpad made it.
  const watchers = chains.map((chain) => {
    const w = new LaunchpadWatcher(chain);
    w.onNewPair((p) => console.log(`[launchpad:${chain}] new pool ${p.pair} (${p.token0} / ${p.token1})`));
    w.start();
    return w;
  });

  const shutdown = () => {
    console.log(`\n[shutdown] ${JSON.stringify({ ...engine.stats, credits: fomo.creditsUsed })}`);
    for (const s of streams) s.stop();
    for (const w of watchers) w.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });

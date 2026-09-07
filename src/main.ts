/**
 * Hosting entry: one process, one port.
 *
 * The dashboard always starts. The scanner starts only if it can — a missing key or a
 * bad RPC takes down the scanner, not the web server, so a deploy never crash-loops
 * on configuration and you can see *why* it isn't scanning on the dashboard itself.
 */
import { startDashboard } from "./serve.ts";
import { startScanner } from "./scanner.ts";
import { config } from "./config.ts";

const server = startDashboard();

let scanner: Awaited<ReturnType<typeof startScanner>> | null = null;
if (config.fomoKey) {
  try {
    scanner = await startScanner();
  } catch (err) {
    console.error(`[boot] scanner did not start: ${(err as Error).message ?? err}`);
    console.error(`[boot] dashboard stays up; fix the config and redeploy`);
  }
} else {
  console.warn(`[boot] FOMO_API_KEY not set — dashboard only, scanner idle`);
}

const shutdown = () => { scanner?.stop(); server.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

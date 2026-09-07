/**
 * Dashboard + JSON API over state/setups.jsonl.
 *
 * Deliberately independent of the scanner: the scanner needs an API key and dedicated
 * RPCs, the dashboard needs neither. On a host like Replit both run in one process
 * (see main.ts), but the dashboard still comes up and stays useful when the scanner
 * cannot start.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname, basename } from "node:path";
import { loadRecent, type Record_ } from "./report.ts";
import { traderStats, tokenStats, gateStats, summary } from "./analytics.ts";
import { config } from "./config.ts";
import { FomoClient } from "./fomo/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
// Works from src/ under strip-types and from dist/ after a build.
const publicDir = join(here, here.endsWith("dist") ? "../public" : "../public");

function filtered(url: URL): Record_[] {
  let rows = loadRecent(Number(url.searchParams.get("limit") ?? 2000));
  const chain = url.searchParams.get("chain");
  const label = url.searchParams.get("label");
  const minScore = Number(url.searchParams.get("minScore") ?? 0);
  const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
  const sinceHours = Number(url.searchParams.get("sinceHours") ?? 0);

  if (chain && chain !== "all") rows = rows.filter((r) => r.setup.chain === chain);
  if (label && label !== "all") rows = rows.filter((r) => r.assessment.label === label);
  if (minScore > 0) rows = rows.filter((r) => r.assessment.score >= minScore);
  if (sinceHours > 0) { const cut = Date.now() - sinceHours * 3_600_000; rows = rows.filter((r) => r.at >= cut); }
  if (q) {
    rows = rows.filter((r) =>
      (r.setup.token.symbol ?? "").toLowerCase().includes(q) ||
      r.setup.token.address.toLowerCase().includes(q) ||
      r.setup.buyers.some((b) => (b.handle ?? "").toLowerCase().includes(q) || b.wallet.toLowerCase().includes(q)));
  }
  return rows;
}

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

/**
 * Serves public/assets/* so you can drop an avatar.png or banner.png in and have the
 * dashboard pick it up. This binds to 0.0.0.0, so the path is flattened to a bare
 * filename and re-resolved under the assets root — a request can't climb out of it
 * with ../ or an absolute path, and only known image types are served at all.
 */
function serveAsset(res: ServerResponse, pathname: string): boolean {
  const name = basename(decodeURIComponent(pathname.slice("/assets/".length)));
  const ext = extname(name).toLowerCase();
  const type = MIME[ext];
  if (!name || !type) return false;

  const root = resolve(publicDir, "assets");
  const file = resolve(root, name);
  if (!file.startsWith(root + "/")) return false;
  if (!existsSync(file) || !statSync(file).isFile()) return false;

  res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=300" });
  res.end(readFileSync(file));
  return true;
}

const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

export function createDashboardServer() {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      switch (url.pathname) {
        case "/api/health":
          return json(res, { ok: true, scanner: Boolean(config.fomoKey), mode: config.mode, evaluations: loadRecent(5000).length });
        case "/api/summary":
          return json(res, { ...summary(filtered(url)), thresholds: { signal: config.signal, gates: config.gates, risk: config.risk } });
        case "/api/setups":
          return json(res, filtered(url));
        case "/api/traders":
          return json(res, traderStats(filtered(url)));
        case "/api/tokens":
          return json(res, tokenStats(filtered(url)));
        case "/api/gates":
          return json(res, gateStats(filtered(url)));
        case "/api/leaderboard": {
          // The external view: who FOMO ranks. Distinct from /api/traders, which is
          // who has actually produced setups that cleared our own gates.
          if (!config.fomoKey) return json(res, { available: false, reason: "FOMO_API_KEY not set" });
          try {
            const fomo = new FomoClient();
            const window = (url.searchParams.get("window") ?? "7d") as "24h" | "7d" | "30d" | "all";
            const { traders } = await fomo.leaderboard(window);
            return json(res, { available: true, window, traders: traders ?? [] });
          } catch (err) {
            return json(res, { available: false, reason: String(err).slice(0, 200) });
          }
        }
        case "/":
        case "/index.html": {
          const html = readFileSync(join(publicDir, "index.html"), "utf8");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          return res.end(html);
        }
        default:
          if (url.pathname.startsWith("/assets/") && serveAsset(res, url.pathname)) return;
          res.writeHead(404, { "content-type": "text/plain" });
          return res.end("not found");
      }
    } catch (err) {
      return json(res, { error: String(err).slice(0, 500) }, 500);
    }
  });
}

export function startDashboard(port = Number(process.env.PORT ?? 5173)) {
  const server = createDashboardServer();
  // 0.0.0.0 so it is reachable inside a container / on Replit, not just localhost.
  server.listen(port, "0.0.0.0", () => {
    const n = loadRecent(5000).length;
    console.log(`[serve] dashboard on http://localhost:${port} (${n} evaluation${n === 1 ? "" : "s"})`);
    if (n === 0) console.log(`[serve] no evaluations yet — run \`npm run replay\` to populate it`);
  });
  return server;
}

// Standalone entry: `npm run serve`.
if (process.argv[1] && /serve\.(ts|js)$/.test(process.argv[1])) startDashboard();

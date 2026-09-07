/**
 * Serves the setup dashboard. Separate from the bot on purpose: the scanner needs an
 * API key and dedicated RPCs, but the dashboard is just a view over state/setups.jsonl,
 * so it runs on its own and stays useful while the scanner is offline.
 *
 * Re-renders per request, so `npm run replay` or a live run shows up on the next refresh.
 */
import { createServer } from "node:http";
import { loadRecent, renderDashboard } from "./report.ts";

const port = Number(process.env.PORT ?? 5173);

createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, evaluations: loadRecent(500).length }));
    return;
  }
  if (req.url === "/setups.json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(loadRecent(200), null, 2));
    return;
  }
  try {
    const html = renderDashboard(loadRecent(50));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`dashboard render failed: ${String(err)}`);
  }
}).listen(port, () => {
  const n = loadRecent(500).length;
  console.log(`[serve] dashboard on http://localhost:${port} (${n} evaluation${n === 1 ? "" : "s"} in state/setups.jsonl)`);
  if (n === 0) console.log(`[serve] no evaluations yet — run \`npm run replay\` to populate it`);
});

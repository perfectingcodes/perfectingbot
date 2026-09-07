/** Scanner only. Requires FOMO_API_KEY. For the dashboard too, use `npm start` (main.ts). */
import { startScanner } from "./scanner.js";
const scanner = await startScanner().catch((err) => { console.error(err.message ?? err); process.exit(1); });
const shutdown = () => { scanner.stop(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
//# sourceMappingURL=index.js.map
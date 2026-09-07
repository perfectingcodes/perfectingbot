/**
 * Deliberately not implemented.
 *
 * Everything upstream of this file — signals, gates, sizing, kill switch — is safe to run
 * today and costs nothing to be wrong about. Signing swaps is the one step that is not
 * reversible, so it stays unwired until the paper log shows the setups are actually good.
 *
 * Wiring it means: a funded key in a signer this process can reach, slippage and
 * min-out bounds, gas/priority policy, nonce handling, and an exit path (stop, trail,
 * time-stop) that is at least as tested as the entry. Ask for it explicitly.
 */
export class LiveExecutor {
    name = "live";
    async enter() {
        throw new Error("LiveExecutor is not implemented — run MODE=paper until the setup log justifies real size.");
    }
    async exit() {
        throw new Error("LiveExecutor is not implemented.");
    }
}
//# sourceMappingURL=live.js.map
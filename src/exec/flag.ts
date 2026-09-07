import type { Executor } from "./types.ts";

/** Default mode: surface the setup, take no position. */
export class FlagOnlyExecutor implements Executor {
  readonly name = "flag-only";
  async enter() { return null; }
  async exit() { return null; }
}

#!/usr/bin/env -S deno run -N -R -W --allow-run --allow-env
/** Passthrough command-line entrypoint. For the API, import @deerdaily/bot-api/api. @module */
import process from "node:process";
import { spawnServer } from "./src/process.ts";

try {
  const args = typeof Deno !== "undefined" ? Deno.args : process.argv.slice(2);
  process.exitCode = await spawnServer(args).exited;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

#!/usr/bin/env -S deno run -N -R -W --allow-run --allow-env
/** Passthrough command-line entrypoint. For the API, import @deerdaily/bot-api/api. @module */
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnServer } from "./src/process.ts";

function isMain(): boolean {
  if (typeof import.meta.main === "boolean") return import.meta.main;
  // Fallback for Node versions without import.meta.main; npm's shim links here.
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

// Importing the package root must not start a server.
if (isMain()) {
  try {
    const args = typeof Deno !== "undefined"
      ? Deno.args
      : process.argv.slice(2);
    process.exitCode = await spawnServer(args, { forwardSignals: true })
      .exited;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

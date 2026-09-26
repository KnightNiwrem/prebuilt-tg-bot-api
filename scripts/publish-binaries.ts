// Compatibility entrypoint: npm publication is now staging-only.
import { command } from "./command.ts";
console.log(
  await command(Deno.execPath(), [
    "run",
    "--config",
    "deno.local.json",
    "-A",
    "scripts/release-ci.ts",
    "stage",
  ]),
);

// The exact static npm import is part of the release and compilation contract.
// deno-lint-ignore no-import-prefix
import { resolveBinaryPath } from "npm:@deerdaily/bot-api-binaries@10.3.0";
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import process from "node:process";

export interface Binary {
  path: string;
  cleanup(): void;
}

export function resolveBinary(): Binary {
  const override = process.env.TELEGRAM_BOT_API_BINARY;
  if (override) return { path: override, cleanup() {} };
  const path = resolveBinaryPath();
  if (typeof Deno === "undefined" || !Deno.build.standalone) {
    return { path, cleanup() {} };
  }
  // The OS cannot execute a file inside Deno's virtual filesystem. Materialize
  // the already embedded bytes for this process only; this is not a cache.
  const directory = mkdtempSync(join(tmpdir(), "telegram-bot-api-"));
  // Retries cover Windows briefly locking a just-exited executable.
  const cleanup = () =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  try {
    const executable = join(directory, basename(path));
    copyFileSync(path, executable);
    if (process.platform !== "win32") chmodSync(executable, 0o700);
    return { path: executable, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

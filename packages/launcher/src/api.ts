import { createConnection } from "node:net";
import { type RunningProcess, spawnServer } from "./process.ts";

/** Programmatic options. The CLI itself never parses or builds server flags. */
export interface BotApiOptions {
  apiId: number | string;
  apiHash: string;
  port?: number;
  local?: boolean;
  dir?: string;
  tempDir?: string;
  /** Interface on which the server listens; defaults to 127.0.0.1. */
  host?: string;
  /** Additional upstream arguments, passed unchanged after the named options. */
  args?: readonly string[];
  /** Maximum TCP readiness wait, in milliseconds. Default: 30,000. */
  readyTimeoutMs?: number;
  /** Grace period before forced termination, in milliseconds. Default: 5,000. */
  stopTimeoutMs?: number;
}

/** Handle to one server process. */
export interface BotApiServer {
  readonly pid: number;
  /** Resolves once the configured TCP listener accepts a connection. */
  ready(): Promise<void>;
  /** Terminates the child, escalating to SIGKILL after the grace period. */
  stop(): Promise<void>;
}

export function argumentsFor(options: BotApiOptions): string[] {
  const args = [
    "--api-id",
    String(options.apiId),
    "--api-hash",
    options.apiHash,
    "--http-port",
    String(options.port ?? 8081),
    "--http-ip-address",
    options.host ?? "127.0.0.1",
  ];
  if (options.local) args.push("--local");
  if (options.dir !== undefined) args.push("--dir", options.dir);
  if (options.tempDir !== undefined) args.push("--temp-dir", options.tempDir);
  return [...args, ...options.args ?? []];
}

function probe(
  host: string,
  port: number,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const socket = createConnection({ host, port });
    const finish = (ready: boolean) => {
      signal.removeEventListener("abort", abort);
      socket.destroy();
      resolve(ready);
    };
    const abort = () => finish(false);
    signal.addEventListener("abort", abort, { once: true });
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

/** Start the native server with inherited stdio and environment. */
export function startBotApiServer(options: BotApiOptions): BotApiServer {
  return createServer(options, spawnServer);
}

/** Internal injection point for lifecycle tests using a script instead of C++. */
export function createServer(
  options: BotApiOptions,
  launch: (args: readonly string[]) => RunningProcess,
): BotApiServer {
  const port = options.port ?? 8081;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError("port must be between 1 and 65535");
  }
  for (
    const value of [
      options.readyTimeoutMs ?? 30_000,
      options.stopTimeoutMs ?? 5_000,
    ]
  ) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError("timeouts must be non-negative finite numbers");
    }
  }
  const running = launch(argumentsFor(options));
  const controller = new AbortController();
  let exitError: Error | undefined;
  void running.exited.then((code) => {
    exitError = new Error(
      `Telegram Bot API exited before readiness (code ${code})`,
    );
    controller.abort();
  }, (error) => {
    exitError = error;
    controller.abort();
  });
  let readiness: Promise<void> | undefined;
  return {
    get pid() {
      return running.child.pid ?? 0;
    },
    ready() {
      return readiness ??= (async () => {
        const timeout = options.readyTimeoutMs ?? 30_000;
        const deadline = Date.now() + timeout;
        const host = options.host === "0.0.0.0"
          ? "127.0.0.1"
          : options.host === "::"
          ? "::1"
          : options.host ?? "127.0.0.1";
        while (Date.now() < deadline) {
          if (exitError) throw exitError;
          if (controller.signal.aborted) {
            throw new Error("Telegram Bot API stopped before readiness");
          }
          if (await probe(host, port, controller.signal)) {
            if (exitError) throw exitError;
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (exitError) throw exitError;
        throw new Error(
          `Telegram Bot API did not listen on ${host}:${port} within ${timeout}ms`,
        );
      })();
    },
    stop() {
      controller.abort();
      return running.stop(options.stopTimeoutMs);
    },
  };
}

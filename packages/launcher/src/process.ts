import { spawn } from "node:child_process";
import { constants } from "node:os";
import process from "node:process";
import { resolveBinary } from "./binary.ts";

export interface RunningProcess {
  child: { pid: number | undefined };
  exited: Promise<number>;
  stop(timeoutMs?: number): Promise<void>;
}

/** Shared lifecycle; use each runtime's native process and signal primitives. */
export function spawnServer(args: readonly string[]): RunningProcess {
  const binary = resolveBinary();
  let pid: number | undefined;
  let wait: Promise<number>;
  let kill: (signal: "SIGINT" | "SIGTERM" | "SIGKILL" | "SIGBREAK") => void;
  const deno = typeof Deno !== "undefined";
  try {
    if (deno) {
      const child = new Deno.Command(binary.path, {
        args: [...args],
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).spawn();
      pid = child.pid;
      wait = child.status.then((status) => status.code);
      kill = (signal) => child.kill(signal);
    } else {
      const child = spawn(binary.path, [...args], {
        stdio: "inherit",
        shell: false,
      });
      pid = child.pid;
      wait = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once(
          "exit",
          (code, signal) =>
            resolve(
              code ?? 128 + (signal ? constants.signals[signal] ?? 1 : 1),
            ),
        );
      });
      kill = (signal) => {
        child.kill(signal);
      };
    }
  } catch (error) {
    binary.cleanup();
    throw new Error(
      `Unable to start Telegram Bot API: ${
        error instanceof Error ? error.message : error
      }`,
      { cause: error },
    );
  }
  let settled = false;
  let shutdown: Promise<void> | undefined;
  const signalChild = (
    signal: "SIGINT" | "SIGTERM" | "SIGKILL" | "SIGBREAK",
  ) => {
    if (settled) return;
    try {
      kill(process.platform === "win32" ? "SIGKILL" : signal);
    } catch (error) {
      // The child can exit between checking its status and sending the signal.
      if (
        !(error instanceof Error) ||
        !/No such process|not found|terminated/i.test(error.message)
      ) throw error;
    }
  };
  const handlers: Array<["SIGINT" | "SIGTERM" | "SIGBREAK", () => void]> = [];
  const signals = process.platform === "win32"
    ? ["SIGINT", "SIGBREAK"] as const
    : ["SIGINT", "SIGTERM"] as const;
  for (const signal of signals) {
    const handler = () => signalChild(signal);
    handlers.push([signal, handler]);
    if (deno) Deno.addSignalListener(signal, handler);
    else process.on(signal, handler);
  }
  const onExit = () => signalChild("SIGKILL");
  process.on("exit", onExit);
  const exited = wait.catch((error: Error) => {
    throw new Error(`Unable to start Telegram Bot API: ${error.message}`, {
      cause: error,
    });
  }).finally(() => {
    settled = true;
    for (const [signal, handler] of handlers) {
      if (deno) Deno.removeSignalListener(signal, handler);
      else process.off(signal, handler);
    }
    process.off("exit", onExit);
    binary.cleanup();
  });
  void exited.catch(() => {});
  return {
    child: { pid },
    exited,
    stop(timeoutMs = 5_000) {
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
        return Promise.reject(
          new RangeError("stop timeout must be a non-negative finite number"),
        );
      }
      return shutdown ??= (async () => {
        if (settled) {
          await exited;
          return;
        }
        signalChild("SIGTERM");
        const timer = setTimeout(() => signalChild("SIGKILL"), timeoutMs);
        try {
          await exited;
        } finally {
          clearTimeout(timer);
        }
      })();
    },
  };
}

import { spawn } from "node:child_process";
import { constants } from "node:os";
import process from "node:process";
import { resolveBinary } from "./binary.ts";

type Signal =
  | "SIGINT"
  | "SIGTERM"
  | "SIGQUIT"
  | "SIGHUP"
  | "SIGUSR1"
  | "SIGUSR2"
  | "SIGBREAK"
  | "SIGKILL";

export interface SpawnOptions {
  /**
   * Relay the launcher's signals to the server. Only the CLI owns its process's
   * signals; an application embedding the API keeps its own signal behavior.
   */
  forwardSignals?: boolean;
}

export interface RunningProcess {
  child: { pid: number | undefined };
  exited: Promise<number>;
  stop(timeoutMs?: number): Promise<void>;
}

const windows = process.platform === "win32";
// Every signal upstream handles on POSIX: quit (INT/TERM/QUIT), log reopening
// (USR1/USR2), and HUP, which it deliberately ignores.
const relayed = [
  "SIGINT",
  "SIGTERM",
  "SIGQUIT",
  "SIGHUP",
  "SIGUSR1",
  "SIGUSR2",
] as const;
// Windows console events reach every process attached to the console.
const consoleEvents = ["SIGINT", "SIGBREAK"] as const;
const consoleGraceMs = 5_000;

/** Node timers overflow to 1ms above this range. Validate before signalling. */
export function validateTimeout(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 2_147_483_647) {
    throw new RangeError(
      "timeouts must be finite numbers between 0 and 2147483647ms",
    );
  }
}

/** Shared lifecycle; use each runtime's native process and signal primitives. */
export function spawnServer(
  args: readonly string[],
  options: SpawnOptions = {},
): RunningProcess {
  const forward = options.forwardSignals ?? false;
  // A terminal sends Ctrl+C to its whole foreground process group, and upstream
  // treats a second quit signal as "exit immediately". Run the server in its own
  // session so the relay below delivers each signal exactly once.
  const detached = forward && !windows;
  const binary = resolveBinary();
  const cleanup = () => {
    try {
      binary.cleanup();
    } catch (error) {
      // A leftover temporary copy must not replace the server's exit status.
      console.error(
        `Warning: could not remove the temporary server copy: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  };
  let pid: number | undefined;
  let wait: Promise<number>;
  let kill: (signal: Signal) => void;
  const deno = typeof Deno !== "undefined";
  try {
    if (deno) {
      const child = new Deno.Command(binary.path, {
        args: [...args],
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        detached,
      }).spawn();
      pid = child.pid;
      wait = child.status.then((status) => status.code);
      kill = (signal) => child.kill(signal);
    } else {
      const child = spawn(binary.path, [...args], {
        stdio: "inherit",
        shell: false,
        detached,
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
    cleanup();
    throw new Error(
      `Unable to start Telegram Bot API: ${
        error instanceof Error ? error.message : error
      }`,
      { cause: error },
    );
  }
  let settled = false;
  let quitSent = false;
  let shutdown: Promise<void> | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const signalChild = (signal: Signal) => {
    if (settled) return;
    try {
      // Windows has no deliverable termination signals; both runtimes map
      // SIGKILL to TerminateProcess.
      kill(windows ? "SIGKILL" : signal);
      if (["SIGINT", "SIGTERM", "SIGQUIT", "SIGKILL"].includes(signal)) {
        quitSent = true;
      }
    } catch (error) {
      // The child can exit between checking its status and sending the signal.
      if (
        !(error instanceof Error) ||
        !/No such process|not found|terminated/i.test(error.message)
      ) throw error;
    }
  };
  const listeners: Array<[Signal, () => void]> = [];
  if (forward && windows) {
    // The console already delivered Ctrl+C/Ctrl+Break to the server. Let it
    // shut down by itself; terminate it only if it outlives the grace period.
    for (const signal of consoleEvents) {
      listeners.push([signal, () => {
        quitSent = true; // The console has already delivered the quit event.
        forceTimer ??= setTimeout(() => signalChild("SIGKILL"), consoleGraceMs);
      }]);
    }
  } else if (forward) {
    for (const signal of relayed) {
      listeners.push([signal, () => signalChild(signal)]);
    }
  }
  for (const [signal, listener] of listeners) {
    if (deno) Deno.addSignalListener(signal, listener);
    else process.on(signal, listener);
  }
  // If the host exits first, ask the server to shut down gracefully by itself.
  // Deno.exit() fires only "unload", not Node's "exit" event.
  const onExit = () => {
    if (!quitSent) signalChild("SIGTERM");
  };
  if (deno) globalThis.addEventListener("unload", onExit);
  else process.on("exit", onExit);
  const exited = wait.catch((error: Error) => {
    throw new Error(`Unable to start Telegram Bot API: ${error.message}`, {
      cause: error,
    });
  }).finally(() => {
    settled = true;
    clearTimeout(forceTimer);
    for (const [signal, listener] of listeners) {
      if (deno) Deno.removeSignalListener(signal, listener);
      else process.off(signal, listener);
    }
    if (deno) globalThis.removeEventListener("unload", onExit);
    else process.off("exit", onExit);
    cleanup();
  });
  void exited.catch(() => {});
  return {
    child: { pid },
    exited,
    stop(timeoutMs = 5_000) {
      try {
        validateTimeout(timeoutMs);
      } catch (error) {
        return Promise.reject(error);
      }
      return shutdown ??= (async () => {
        if (settled) {
          await exited;
          return;
        }
        if (!quitSent) signalChild("SIGTERM");
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

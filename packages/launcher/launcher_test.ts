import assert from "node:assert/strict";
import { argumentsFor, createServer } from "./src/api.ts";
import { spawnServer } from "./src/process.ts";
import { resolveBinary } from "./src/binary.ts";
import type * as Source from "./src/api.ts";
import type * as Published from "./api.d.ts";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/server.ts", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));

function withRuntime<T>(fn: () => T): T {
  const previous = Deno.env.get("TELEGRAM_BOT_API_BINARY");
  Deno.env.set("TELEGRAM_BOT_API_BINARY", Deno.execPath());
  try {
    return fn();
  } finally {
    if (previous === undefined) Deno.env.delete("TELEGRAM_BOT_API_BINARY");
    else Deno.env.set("TELEGRAM_BOT_API_BINARY", previous);
  }
}

function unusedPort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

function mockServer(args: string[] = [], readyTimeoutMs = 2000) {
  return withRuntime(() =>
    createServer({
      apiId: 123,
      apiHash: "test",
      port: unusedPort(),
      args,
      readyTimeoutMs,
      stopTimeoutMs: 100,
    }, (flags) => spawnServer(["run", "--no-config", "-A", fixture, ...flags]))
  );
}

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

Deno.test("npm declarations match the TypeScript source", () => {
  // Checked at compile time; a drifting api.d.ts fails `deno test`.
  const same: [
    Equal<Source.BotApiOptions, Published.BotApiOptions>,
    Equal<Source.BotApiServer, Published.BotApiServer>,
    Equal<
      typeof Source.startBotApiServer,
      typeof Published.startBotApiServer
    >,
  ] = [true, true, true];
  assert.deepEqual(same, [true, true, true]);
});

Deno.test("override skips absent platform package resolution", () => {
  withRuntime(() => assert.equal(resolveBinary().path, Deno.execPath()));
});

Deno.test("API builds separate argv entries without quoting", () => {
  assert.deepEqual(
    argumentsFor({
      apiId: 12,
      apiHash: "a b",
      port: 9000,
      local: true,
      dir: "two words",
      args: ["--unknown", ""],
    }),
    [
      "--api-id",
      "12",
      "--api-hash",
      "a b",
      "--http-port",
      "9000",
      "--http-ip-address",
      "127.0.0.1",
      "--local",
      "--dir",
      "two words",
      "--unknown",
      "",
    ],
  );
});

Deno.test("CLI preserves arguments, environment, and exit status", async () => {
  const args = [
    "two words",
    "",
    "--unknown=1",
    "*",
    "$(echo unsafe)",
    '"quoted"',
    "日本語",
  ];
  const script =
    'console.log(JSON.stringify({args:Deno.args,env:Deno.env.get("BOT_API_TEST_VALUE")})); Deno.exit(37)';
  const result = await new Deno.Command(Deno.execPath(), {
    cwd: root,
    args: [
      "run",
      "--config",
      "deno.local.json",
      "-A",
      "packages/launcher/cli.ts",
      "eval",
      script,
      ...args,
    ],
    env: {
      TELEGRAM_BOT_API_BINARY: Deno.execPath(),
      BOT_API_TEST_VALUE: "inherited",
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert.equal(result.code, 37, new TextDecoder().decode(result.stderr));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(result.stdout)), {
    args,
    env: "inherited",
  });
});

Deno.test("ready observes listener and stop is idempotent", async () => {
  const server = mockServer();
  try {
    assert.ok((server.pid ?? 0) > 0);
    assert.equal(server.ready(), server.ready());
    await server.ready();
  } finally {
    await Promise.all([server.stop(), server.stop()]);
  }
});

Deno.test("ready rejects early child exit", async () => {
  const server = mockServer(["--exit-early"]);
  try {
    await assert.rejects(server.ready(), /code 23/);
  } finally {
    await server.stop();
  }
});

Deno.test("readiness timeout leaves stop available", async () => {
  const server = mockServer(["--never-listen"], 100);
  try {
    await assert.rejects(server.ready(), /did not listen/);
  } finally {
    await server.stop();
  }
});

Deno.test("stopping aborts a pending readiness wait", async () => {
  const server = mockServer(["--never-listen"]);
  const ready = assert.rejects(server.ready(), /stopped|exited/);
  await server.stop();
  await ready;
});

Deno.test({
  name: "stop escalates when SIGTERM is ignored",
  ignore: Deno.build.os === "windows",
  async fn() {
    const server = mockServer(["--ignore-term"]);
    try {
      await server.ready();
    } finally {
      await server.stop();
    }
  },
});

Deno.test("spawn errors reject instead of hanging", async () => {
  const previous = Deno.env.get("TELEGRAM_BOT_API_BINARY");
  Deno.env.set(
    "TELEGRAM_BOT_API_BINARY",
    "nonexistent-bot-api-executable-123456",
  );
  try {
    await assert.rejects(
      async () => await spawnServer([]).exited,
      /Unable to start/,
    );
  } finally {
    if (previous === undefined) Deno.env.delete("TELEGRAM_BOT_API_BINARY");
    else Deno.env.set("TELEGRAM_BOT_API_BINARY", previous);
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.test({
    name: `CLI forwards ${signal} and preserves child exit`,
    ignore: Deno.build.os === "windows",
    async fn() {
      const script =
        `Deno.addSignalListener("${signal}", () => Deno.exit(42)); console.log("ready"); setTimeout(() => Deno.exit(77), 3000);`;
      const child = new Deno.Command(Deno.execPath(), {
        cwd: root,
        args: [
          "run",
          "--config",
          "deno.local.json",
          "-A",
          "packages/launcher/cli.ts",
          "eval",
          script,
        ],
        env: { TELEGRAM_BOT_API_BINARY: Deno.execPath() },
        stdout: "piped",
        stderr: "inherit",
      }).spawn();
      const reader = child.stdout.getReader();
      try {
        const output = await reader.read();
        assert.match(new TextDecoder().decode(output.value), /ready/);
        child.kill(signal);
        assert.equal((await child.status).code, 42);
      } finally {
        await reader.cancel();
        reader.releaseLock();
        try {
          child.kill("SIGKILL");
        } catch { /* Already exited. */ }
        await child.status;
      }
    },
  });
}

/** Reads stdout line by line; each read fails instead of hanging. */
function lineReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  return {
    async next(timeoutMs = 5_000): Promise<string> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no output within ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      try {
        while (!buffer.includes("\n")) {
          const { value, done } = await Promise.race([reader.read(), timeout]);
          if (done) throw new Error("output ended");
          buffer += value;
        }
      } finally {
        clearTimeout(timer);
      }
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      return line;
    },
    cancel: () => reader.cancel().catch(() => {}),
  };
}

function statusWithin(child: Deno.ChildProcess, timeoutMs = 5_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    child.status,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`still running after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function killQuietly(pid: number | undefined, signal: Deno.Signal = "SIGKILL") {
  if (pid === undefined) return;
  try {
    Deno.kill(pid, signal);
  } catch { /* Already exited. */ }
}

async function processGroup(pid: number): Promise<number> {
  const { stdout } = await new Deno.Command("ps", {
    args: ["-o", "pgid=", "-p", String(pid)],
    stdout: "piped",
  }).output();
  return Number(new TextDecoder().decode(stdout).trim());
}

Deno.test({
  name: "terminal Ctrl+C reaches the server exactly once",
  ignore: Deno.build.os === "windows",
  async fn() {
    // A terminal signals its whole foreground process group; model that group.
    const launcher = new Deno.Command(Deno.execPath(), {
      cwd: root,
      args: [
        "run",
        "--config",
        "deno.local.json",
        "-A",
        "packages/launcher/cli.ts",
        "run",
        "--no-config",
        fileURLToPath(
          new URL("./fixtures/upstream_signals.ts", import.meta.url),
        ),
      ],
      env: { TELEGRAM_BOT_API_BINARY: Deno.execPath() },
      stdout: "piped",
      stderr: "inherit",
      detached: true,
    }).spawn();
    const output = lineReader(launcher.stdout);
    let server: number | undefined;
    try {
      server = Number((await output.next()).replace("ready ", ""));
      // Sharing the group would deliver Ctrl+C twice. Whether upstream then
      // sees two quit signals is a race, so assert the cause directly.
      assert.notEqual(await processGroup(server), launcher.pid);
      Deno.kill(-launcher.pid, "SIGINT");
      assert.equal(await output.next(), "graceful SIGINT");
      assert.equal((await statusWithin(launcher)).code, 0);
    } finally {
      killQuietly(-launcher.pid);
      killQuietly(server);
      await output.cancel();
      await launcher.status;
    }
  },
});

function host(port: number, mode: "run" | "exit") {
  return new Deno.Command(Deno.execPath(), {
    cwd: root,
    args: [
      "run",
      "--config",
      "deno.local.json",
      "-A",
      "packages/launcher/fixtures/host.ts",
      String(port),
      mode,
    ],
    env: { TELEGRAM_BOT_API_BINARY: Deno.execPath() },
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
}

Deno.test({
  name: "API leaves the host application's signal handling alone",
  ignore: Deno.build.os === "windows",
  async fn() {
    const app = host(unusedPort(), "run");
    const output = lineReader(app.stdout);
    let server: number | undefined;
    try {
      server = JSON.parse(await output.next()).pid;
      app.kill("SIGTERM");
      assert.equal((await statusWithin(app)).signal, "SIGTERM");
    } finally {
      killQuietly(app.pid);
      killQuietly(server);
      await output.cancel();
      await app.status;
    }
  },
});

Deno.test({
  name: "host exit asks the server to shut down gracefully",
  ignore: Deno.build.os === "windows",
  async fn() {
    const app = host(unusedPort(), "exit");
    const output = lineReader(app.stdout);
    let server: number | undefined;
    try {
      server = JSON.parse(await output.next()).pid;
      assert.equal((await statusWithin(app)).code, 0);
      // The orphaned server still writes to the inherited pipe.
      assert.equal(await output.next(), "SIGTERM received");
    } finally {
      killQuietly(server);
      await output.cancel();
    }
  },
});

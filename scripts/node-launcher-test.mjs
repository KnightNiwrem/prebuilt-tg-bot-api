import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, readFile } from "node:fs/promises";
import { createServer as createListener } from "node:net";
import { resolve } from "node:path";
import process from "node:process";
import { test } from "node:test";

// Test the generated Node distribution against the real checked-in meta-package.
await mkdir("dist/npm-launcher/node_modules/@deerdaily", { recursive: true });
await cp(
  "packages/binaries/meta",
  "dist/npm-launcher/node_modules/@deerdaily/bot-api-binaries",
  { recursive: true },
);
const { createServer } = await import("../dist/npm-launcher/src/api.js");
const { spawnServer } = await import("../dist/npm-launcher/src/process.js");
const cli = resolve("dist/npm-launcher/cli.js");

function launch(args) {
  return spawn(process.execPath, [cli, ...args], {
    env: {
      ...process.env,
      TELEGRAM_BOT_API_BINARY: process.execPath,
      BOT_API_TEST_VALUE: "inherited",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("Node distribution keeps exact dependency version", async () => {
  const pkg = JSON.parse(
    await readFile("dist/npm-launcher/package.json", "utf8"),
  );
  const pin = JSON.parse(await readFile("upstream.json", "utf8"));
  assert.equal(pkg.dependencies["@deerdaily/bot-api-binaries"], pin.version);
});

test("Node CLI preserves argv, stdout, stderr, environment and exit code", {
  timeout: 10_000,
}, async () => {
  const args = ["", "two words", "--unknown", "$(not-a-command)", "日本語"];
  const child = launch([
    "-e",
    'console.log(JSON.stringify({args:process.argv.slice(1),env:process.env.BOT_API_TEST_VALUE}));console.error("stderr-marker");process.exit(29)',
    "--",
    ...args,
  ]);
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => stdout += chunk);
  child.stderr.on("data", (chunk) => stderr += chunk);
  const [code] = await once(child, "close");
  assert.equal(code, 29);
  assert.deepEqual(JSON.parse(stdout), { args, env: "inherited" });
  assert.equal(stderr.trim(), "stderr-marker");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`Node CLI forwards ${signal}`, {
    skip: process.platform === "win32",
    timeout: 10_000,
  }, async () => {
    const child = launch([
      "-e",
      `process.on("${signal}",()=>process.exit(42));console.log("ready");setTimeout(()=>process.exit(77),3000)`,
    ]);
    try {
      await once(child.stdout, "data");
      child.kill(signal);
      assert.equal((await once(child, "close"))[0], 42);
    } finally {
      child.kill("SIGKILL");
    }
  });
}

test(
  "Node API readiness and forced shutdown",
  { timeout: 10_000 },
  async () => {
    const listener = createListener();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const previous = process.env.TELEGRAM_BOT_API_BINARY;
    process.env.TELEGRAM_BOT_API_BINARY = process.execPath;
    let server;
    try {
      server = createServer(
        { apiId: 123, apiHash: "test", port, stopTimeoutMs: 50 },
        () =>
          spawnServer([
            "-e",
            `require("node:http").createServer((req,res)=>res.end("mock")).listen(${port},"127.0.0.1");process.on("SIGTERM",()=>{});`,
          ]),
      );
    } finally {
      if (previous === undefined) delete process.env.TELEGRAM_BOT_API_BINARY;
      else process.env.TELEGRAM_BOT_API_BINARY = previous;
    }
    try {
      await server.ready();
      assert.ok(server.pid > 0);
    } finally {
      await server.stop();
    }
    await server.stop();
  },
);

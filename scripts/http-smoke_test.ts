import assert from "node:assert/strict";
import { httpSmokeAttempt } from "./http-smoke.ts";

Deno.test("HTTP smoke removes its temporary directory when spawning fails", async () => {
  let directory: string | undefined;
  await assert.rejects(() =>
    httpSmokeAttempt((options) => {
      directory = options.dir;
      throw new Error("spawn failed");
    }), /spawn failed/);
  assert.ok(directory);
  await assert.rejects(() => Deno.stat(directory!), Deno.errors.NotFound);
});

Deno.test("HTTP smoke rejects an unrelated HTTP response and shuts down the fixture", async () => {
  let stopped = false;
  await assert.rejects(() =>
    httpSmokeAttempt((options) => {
      const server = Deno.serve({
        hostname: "127.0.0.1",
        port: options.port,
        onListen() {},
      }, () => Response.json({ wrong: "server" }, { status: 404 }));
      return {
        pid: Deno.pid,
        ready: () => Promise.resolve(),
        stop: async () => {
          await server.shutdown();
          stopped = true;
        },
      };
    })
  );
  assert.ok(stopped);
});

Deno.test("HTTP smoke rejects a competing listener even with the right response", async () => {
  let competing: Deno.HttpServer | undefined;
  try {
    await assert.rejects(() =>
      httpSmokeAttempt((options) => {
        competing = Deno.serve({
          hostname: "127.0.0.1",
          port: options.port,
          onListen() {},
        }, () =>
          Response.json({
            ok: false,
            error_code: 404,
            description: "Not Found",
          }, { status: 404 }));
        return {
          pid: undefined,
          ready: () => Promise.resolve(),
          stop: () => Promise.resolve(),
        };
      }), /Another process/);
  } finally {
    await competing?.shutdown();
  }
});

import assert from "node:assert/strict";
import {
  type BotApiServer,
  startBotApiServer,
} from "../packages/launcher/mod.ts";

async function listening(port: number): Promise<boolean> {
  try {
    const connection = await Deno.connect({ hostname: "127.0.0.1", port });
    connection.close();
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.ConnectionRefused) return false;
    throw error;
  }
}

/** Injectable only to exercise CI smoke failures with JavaScript fixtures. */
export async function httpSmokeAttempt(
  launch = startBotApiServer,
): Promise<void> {
  // The native server cannot inherit a reserved socket, so validate the response
  // and listener ownership, and let the caller retry a port collision.
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = listener.addr.port;
  listener.close();
  const dir = await Deno.makeTempDir();
  let server: BotApiServer | undefined;
  try {
    const apiId = Deno.env.get("TELEGRAM_API_ID");
    const apiHash = Deno.env.get("TELEGRAM_API_HASH");
    const credentialed = Boolean(apiId && apiHash);
    server = launch({
      apiId: credentialed ? apiId! : 1,
      apiHash: credentialed ? apiHash! : "0".repeat(32),
      port,
      local: true,
      dir,
    });
    await server.ready();
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 404);
    // The pinned upstream HttpConnection returns this JSON for a non-/bot path.
    assert.deepEqual(await response.json(), {
      ok: false,
      error_code: 404,
      description: "Not Found",
    });
    if (credentialed) {
      const result = await fetch(
        `http://127.0.0.1:${port}/bot000:placeholder/getMe`,
        { signal: AbortSignal.timeout(10_000) },
      );
      const body = await result.json();
      assert.equal(body.ok, false);
      assert.equal(body.error_code, result.status);
      console.log(`Credentialed getMe responded: ${result.status}`);
    }
    await server.stop();
    server = undefined;
    assert.equal(
      await listening(port),
      false,
      "Another process still owns the smoke-test port",
    );
    console.log(
      "HTTP server returned the expected Bot API response and released its listener",
    );
  } finally {
    try {
      await server?.stop();
    } finally {
      // A just-terminated Windows process can briefly keep its files locked.
      await Deno.remove(dir, { recursive: true }).catch((error) =>
        console.warn(`Could not remove ${dir}: ${error}`)
      );
    }
  }
}

if (import.meta.main) {
  const errors: unknown[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await httpSmokeAttempt();
      break;
    } catch (error) {
      errors.push(error);
      if (attempt === 3) {
        throw new AggregateError(
          errors,
          "HTTP smoke failed after three fresh ports",
        );
      }
      console.warn(
        `HTTP smoke attempt ${attempt} failed; retrying with a fresh port: ${error}`,
      );
    }
  }
}

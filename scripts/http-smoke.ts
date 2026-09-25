import { startBotApiServer } from "../packages/launcher/mod.ts";

// Upstream only checks that credentials are present before listening, so dummy
// values prove the server serves HTTP. Real credentials add the getMe request.
const apiId = Deno.env.get("TELEGRAM_API_ID");
const apiHash = Deno.env.get("TELEGRAM_API_HASH");
const credentialed = Boolean(apiId && apiHash);
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = listener.addr.port;
listener.close();
const dir = await Deno.makeTempDir();
const server = startBotApiServer({
  apiId: credentialed ? apiId! : 1,
  apiHash: credentialed ? apiHash! : "0".repeat(32),
  port,
  local: true,
  dir,
});
try {
  await server.ready();
  // Without credentials, request a path that never reaches Telegram.
  const path = credentialed ? "/bot000:placeholder/getMe" : "/";
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    signal: AbortSignal.timeout(10_000),
  });
  await response.arrayBuffer();
  console.log(`HTTP server responded to ${path}: ${response.status}`);
} finally {
  await server.stop();
  // A just-terminated Windows process can briefly keep its files locked.
  await Deno.remove(dir, { recursive: true }).catch((error) =>
    console.warn(`Could not remove ${dir}: ${error}`)
  );
}

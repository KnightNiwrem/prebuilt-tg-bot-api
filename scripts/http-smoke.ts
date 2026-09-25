import { startBotApiServer } from "../packages/launcher/mod.ts";
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = listener.addr.port;
listener.close();
const dir = await Deno.makeTempDir();
const server = startBotApiServer({
  apiId: Deno.env.get("TELEGRAM_API_ID")!,
  apiHash: Deno.env.get("TELEGRAM_API_HASH")!,
  port,
  local: true,
  dir,
});
try {
  await server.ready();
  const response = await fetch(
    `http://127.0.0.1:${port}/bot000:placeholder/getMe`,
    { signal: AbortSignal.timeout(10_000) },
  );
  await response.arrayBuffer();
  console.log(`HTTP server responded: ${response.status}`);
} finally {
  await server.stop();
  await Deno.remove(dir, { recursive: true });
}

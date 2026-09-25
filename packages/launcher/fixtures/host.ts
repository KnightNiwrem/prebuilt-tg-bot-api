// An application embedding the API. With "exit", it exits right after readiness.
import { fileURLToPath } from "node:url";
import { createServer } from "../src/api.ts";
import { spawnServer } from "../src/process.ts";

const [port, mode] = Deno.args;
const fixture = fileURLToPath(new URL("./server.ts", import.meta.url));
const server = createServer(
  { apiId: 1, apiHash: "test", port: Number(port), args: ["--report-term"] },
  (flags) => spawnServer(["run", "--no-config", "-A", fixture, ...flags]),
);
await server.ready();
console.log(JSON.stringify({ pid: server.pid }));
if (mode === "exit") Deno.exit(0);
setInterval(() => {}, 1000);

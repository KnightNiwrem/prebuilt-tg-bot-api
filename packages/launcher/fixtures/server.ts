const args = Deno.args;
const port = Number(args[args.indexOf("--http-port") + 1]);
if (args.includes("--exit-early")) Deno.exit(23);
if (args.includes("--never-listen")) {
  setInterval(() => {}, 1000);
} else {
  const server = Deno.serve(
    { port, hostname: "127.0.0.1", onListen() {} },
    () => new Response("mock"),
  );
  if (Deno.build.os !== "windows") {
    Deno.addSignalListener("SIGTERM", () => {
      if (!args.includes("--ignore-term")) void server.shutdown();
    });
  }
}

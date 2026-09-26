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
    let termCount = 0;
    Deno.addSignalListener("SIGTERM", () => {
      termCount++;
      if (args.includes("--report-term")) console.log("SIGTERM received");
      if (args.includes("--slow-term")) {
        if (termCount > 1) Deno.exit(99);
        setTimeout(() => {
          console.log("shutdown complete");
          void server.shutdown();
        }, 100);
        return;
      }
      if (!args.includes("--ignore-term")) void server.shutdown();
    });
  }
}

// Mimics upstream: the first quit signal starts a graceful shutdown, while a
// second one exits immediately without closing cleanly.
let quits = 0;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, () => {
    if (++quits > 1) {
      console.log("forced exit");
      Deno.exit(99);
    }
    console.log(`graceful ${signal}`);
    setTimeout(() => Deno.exit(0), 200);
  });
}
console.log(`ready ${Deno.pid}`);
setInterval(() => {}, 1000);

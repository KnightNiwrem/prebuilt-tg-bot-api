import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { detectLibc, targetFor } from "./index.js";

test("all seven supported targets", () => {
  for (const arch of ["x64", "arm64"]) {
    assert.equal(targetFor("linux", arch, "glibc"), `linux-${arch}`);
    assert.equal(targetFor("linux", arch, "musl"), `linux-${arch}-musl`);
    assert.equal(targetFor("darwin", arch), `darwin-${arch}`);
  }
  assert.equal(targetFor("win32", "x64"), "win32-x64");
});
test("unsupported targets name the failing platform", () => {
  for (
    const [os, arch, libc] of [["win32", "arm64"], ["linux", "ia32", "glibc"], [
      "freebsd",
      "x64",
    ], ["linux", "x64", "unknown"]]
  ) {
    assert.throws(() => targetFor(os, arch, libc), new RegExp(`${os}-${arch}`));
  }
});
test("Linux libc detection", { skip: process.platform !== "linux" }, () => {
  assert.ok(["glibc", "musl"].includes(detectLibc()));
});

test("Node glibc wins when a musl loader is also installed", (t) => {
  t.mock.method(fs, "readdirSync", () => ["ld-musl-x86_64.so.1"]);
  t.mock.method(
    process.report,
    "getReport",
    () => ({ header: { glibcVersionRuntime: "2.39" }, sharedObjects: [] }),
  );
  syncBuiltinESMExports();
  try {
    assert.equal(detectLibc(), "glibc");
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("undetectable Linux libc falls back to any installed variant", {
  skip: process.platform !== "linux" ||
    !["x64", "arm64"].includes(process.arch),
}, async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "bot-api-meta-"));
  try {
    // Only the musl package is installed, as with npm on a musl host.
    const target = `linux-${process.arch}-musl`;
    const pkg = join(root, "node_modules", "@deerdaily", `bot-api-${target}`);
    fs.mkdirSync(join(pkg, "bin"), { recursive: true });
    fs.writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({
        name: `@deerdaily/bot-api-${target}`,
        main: "index.js",
      }),
    );
    fs.writeFileSync(join(pkg, "index.js"), "");
    fs.writeFileSync(join(pkg, "bin", "telegram-bot-api"), "");
    fs.copyFileSync(
      new URL("./index.js", import.meta.url),
      join(root, "index.js"),
    );
    const resolver = await import(pathToFileURL(join(root, "index.js")).href);

    const exists = fs.existsSync;
    t.mock.method(process.report, "getReport", () => ({ header: {} }));
    t.mock.method(fs, "readFileSync", () => {
      throw new Error("no ldd");
    });
    t.mock.method(fs, "readdirSync", () => []);
    t.mock.method(
      fs,
      "existsSync",
      (path) => path.startsWith(root) && exists(path),
    );
    syncBuiltinESMExports();
    try {
      assert.throws(() => resolver.detectLibc(), /Cannot determine Linux libc/);
      assert.equal(
        resolver.resolveBinaryPath(),
        join(pkg, "bin", "telegram-bot-api"),
      );
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

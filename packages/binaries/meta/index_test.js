import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import process from "node:process";
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

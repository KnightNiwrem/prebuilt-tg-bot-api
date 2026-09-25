import assert from "node:assert/strict";
import { test } from "node:test";
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

import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import process from "node:process";
import type { PackedPackage } from "./assemble.ts";
import { command } from "./command.ts";
import { testRegistry } from "./registry.ts";
import { targets } from "./targets.ts";

// Validate JSR's real dependency graph before registry setup, using JS-only
// package fixtures. Native payloads are independently tested by build-binaries.
const temporary = await Deno.makeTempDir({ prefix: "bot-api-package-check-" });
const tarballs = join(temporary, "tarballs");
await Deno.mkdir(tarballs);
try {
  const packages: PackedPackage[] = [];
  for (const target of [...targets, "meta"]) {
    const stage = join(temporary, target);
    await Deno.mkdir(stage);
    for (const file of ["package.json", "index.js", "index.d.ts"]) {
      await Deno.copyFile(
        `packages/binaries/${target}/${file}`,
        join(stage, file),
      );
    }
    const manifest = JSON.parse(
      await Deno.readTextFile(join(stage, "package.json")),
    );
    const [info] = JSON.parse(
      await command("npm", [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        tarballs,
      ], { cwd: stage }),
    );
    packages.push({
      name: manifest.name,
      version: manifest.version,
      manifest,
      filename: info.filename,
      integrity: info.integrity,
    });
  }
  const downloaded = new Set<string>();
  const registry = testRegistry(
    packages,
    tarballs,
    (name) => downloaded.add(name),
  );
  try {
    const url = `http://127.0.0.1:${registry.addr.port}/`;
    console.log(
      await command(Deno.execPath(), [
        "publish",
        "--dry-run",
        "--allow-dirty",
        "--no-lock",
        "--config",
        resolve("packages/launcher/deno.json"),
      ], {
        env: {
          NPM_CONFIG_REGISTRY: url,
          DENO_NPM_REGISTRY: url,
          DENO_DIR: join(temporary, "deno-cache"),
        },
      }),
    );
    const expected = new Set([
      "@deerdaily/bot-api-binaries",
      `@deerdaily/bot-api-${process.platform}-${process.arch}`,
      ...(process.platform === "linux"
        ? [`@deerdaily/bot-api-linux-${process.arch}-musl`]
        : []),
    ]);
    assert.deepEqual(
      downloaded,
      expected,
      "Deno 2.9.6 should filter OS/CPU but download both Linux libc variants",
    );
  } finally {
    await registry.shutdown();
  }
} finally {
  await Deno.remove(temporary, { recursive: true });
}

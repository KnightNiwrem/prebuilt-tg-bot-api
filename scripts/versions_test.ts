import assert from "node:assert/strict";
import { bump, validatePin } from "./bump-upstream.ts";
import { checkVersions } from "./check-versions.ts";
import { validateVersionAdvance } from "./versions.ts";
import { targets } from "./targets.ts";
import { dirname, join } from "node:path";

Deno.test(
  "release metadata and static dependency pin stay in sync",
  () => checkVersions(),
);
Deno.test("upstream pins reject moving references and platform versions", () => {
  const sha = "a".repeat(40);
  validatePin(sha, "10.3.0", null);
  validatePin(sha, "10.3.0-build.2", "v10.3");
  assert.throws(() => validatePin("master", "10.3.0", null));
  assert.throws(() => validatePin(sha, "10.3.0-linux-x64", null));
  assert.throws(() => validatePin(sha, "latest", null));
});

Deno.test("version validation rejects malformed numbers and mismatched tags", () => {
  const sha = "a".repeat(40);
  for (const version of ["01.2.3", "1.02.3", "1.2.03", "10.3.0-build.01"]) {
    assert.throws(() => validatePin(sha, version, null));
  }
  assert.throws(() => validatePin(sha, "10.3.0", "v10.4"), /does not match/);
  validatePin(sha, "10.3.0-build.2", "v10.3");
});

Deno.test("version advancement rejects rollback while preserving release rebuilds", () => {
  for (
    const [old, next] of [["10.3.0", "10.2.9"], [
      "10.3.0-build.2",
      "10.3.0-build.1",
    ], ["10.3.0-build.2", "10.3.0-build.2"]]
  ) assert.throws(() => validateVersionAdvance(old, next));
  for (
    const [old, next] of [
      ["10.3.0", "10.3.0-build.1"],
      ["10.3.0-build.2", "10.3.0-build.10"],
      ["10.3.0-build.2", "10.3.0"],
      ["10.3.0-build.2", "10.4.0"],
    ]
  ) validateVersionAdvance(old, next);
});

const bumpFiles = [
  "upstream.json",
  "deno.local.json",
  "packages/launcher/src/binary.ts",
  "packages/launcher/deno.json",
  ...[...targets, "meta"].map((target) =>
    `packages/binaries/${target}/package.json`
  ),
];
async function bumpFixture(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "bot-api-bump-" });
  for (const file of bumpFiles) {
    const destination = join(root, file);
    await Deno.mkdir(dirname(destination), { recursive: true });
    await Deno.copyFile(file, destination);
  }
  return root;
}
async function snapshot(root: string): Promise<string[]> {
  return await Promise.all(
    bumpFiles.map((file) => Deno.readTextFile(join(root, file))),
  );
}

Deno.test("a missing source pin or local mapping leaves every bump file untouched", async () => {
  for (const file of ["packages/launcher/src/binary.ts", "deno.local.json"]) {
    const root = await bumpFixture();
    try {
      const path = join(root, file);
      await Deno.writeTextFile(
        path,
        (await Deno.readTextFile(path)).replace(
          "npm:@deerdaily/bot-api-binaries@",
          "npm:@invalid/missing@",
        ),
      );
      const before = await snapshot(root);
      await assert.rejects(() => bump("b".repeat(40), "10.4.0", "v10.4", root));
      assert.deepEqual(await snapshot(root), before);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("a bump preserves the local mapping and validates even the no-op path", async () => {
  const root = await bumpFixture();
  try {
    const path = join(root, "deno.local.json");
    const config = JSON.parse(await Deno.readTextFile(path));
    const oldSpecifier = Object.keys(config.imports)[0];
    config.imports[oldSpecifier] = "./custom-fixture.js";
    await Deno.writeTextFile(path, JSON.stringify(config));
    await bump("b".repeat(40), "10.4.0", "v10.4", root);
    await checkVersions(root);
    assert.equal(
      JSON.parse(await Deno.readTextFile(path))
        .imports["npm:@deerdaily/bot-api-binaries@10.4.0"],
      "./custom-fixture.js",
    );
    const once = await snapshot(root);
    await bump("b".repeat(40), "10.4.0", "v10.4", root);
    assert.deepEqual(await snapshot(root), once);
    const metaPath = join(root, "packages/binaries/meta/package.json");
    const meta = JSON.parse(await Deno.readTextFile(metaPath));
    meta.version = "9.0.0";
    await Deno.writeTextFile(metaPath, JSON.stringify(meta));
    await assert.rejects(() => bump("b".repeat(40), "10.4.0", "v10.4", root));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a mid-bump write failure rolls back already updated files", async () => {
  const root = await bumpFixture();
  const before = await snapshot(root);
  const write = Deno.writeTextFile;
  let failed = false;
  try {
    Deno.writeTextFile = async (path, data, options) => {
      if (String(path) === join(root, "deno.local.json") && !failed) {
        failed = true;
        throw new Error("simulated disk failure");
      }
      await write(path, data, options);
    };
    await assert.rejects(
      () => bump("b".repeat(40), "10.4.0", null, root),
      /Version bump failed/,
    );
    assert.ok(failed);
    assert.deepEqual(await snapshot(root), before);
  } finally {
    Deno.writeTextFile = write;
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("empty local import targets fail validation before a version bump writes", async () => {
  for (const target of ["", "   "]) {
    const root = await bumpFixture();
    try {
      const path = join(root, "deno.local.json");
      const config = JSON.parse(await Deno.readTextFile(path));
      config.imports[Object.keys(config.imports)[0]] = target;
      await Deno.writeTextFile(path, JSON.stringify(config));
      const before = await snapshot(root);
      await assert.rejects(() => checkVersions(root), /non-empty/);
      await assert.rejects(
        () => bump("b".repeat(40), "10.4.0", null, root),
        /non-empty/,
      );
      assert.deepEqual(await snapshot(root), before);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

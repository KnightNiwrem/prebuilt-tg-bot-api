import assert from "node:assert/strict";
import { join } from "node:path";
import { checkVersions } from "./check-versions.ts";
import { targets } from "./targets.ts";
import { validateVersionAdvance, versionParts } from "./versions.ts";

export function validatePin(
  ref: string,
  version: string,
  tag: string | null,
): void {
  assert.match(
    ref,
    /^[a-f0-9]{40}$/,
    "Use an immutable 40-character upstream commit SHA",
  );
  const parsed = versionParts(version);
  if (tag !== null) {
    assert.match(
      tag,
      /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/,
      "Unexpected upstream release tag",
    );
    const parts = tag.replace(/^v/, "").split(".").map(BigInt);
    if (parts.length === 2) parts.push(0n);
    assert.deepEqual(
      parts,
      parsed.base,
      "Upstream tag does not match the binary version",
    );
  }
}

export async function bump(
  ref: string,
  version: string,
  tag: string | null = null,
  root = ".",
): Promise<void> {
  validatePin(ref, version, tag);
  // Validate even a no-op: a partially edited checkout is not a completed bump.
  await checkVersions(root);
  const original = new Map<string, string>();
  const updates = new Map<string, string>();
  const readText = async (path: string) => {
    const text = await Deno.readTextFile(join(root, path));
    original.set(path, text);
    return text;
  };
  const read = async (path: string) => JSON.parse(await readText(path));
  const update = (path: string, value: unknown) =>
    updates.set(path, JSON.stringify(value, null, 2) + "\n");
  const pin = await read("upstream.json");
  if (pin.ref === ref && pin.version === version && pin.tag === tag) return;
  validateVersionAdvance(pin.version, version);
  const oldSpecifier = `npm:@deerdaily/bot-api-binaries@${pin.version}`;
  const newSpecifier = `npm:@deerdaily/bot-api-binaries@${version}`;
  const source = "packages/launcher/src/binary.ts";
  const text = await readText(source);
  const local = await read("deno.local.json");
  assert.ok(
    text.includes(`from "${oldSpecifier}"`),
    "Launcher does not contain the old binary import",
  );
  assert.equal(
    typeof local.imports?.[oldSpecifier],
    "string",
    "Local import map does not contain the old binary pin",
  );
  for (const target of [...targets, "meta"]) {
    const path = `packages/binaries/${target}/package.json`;
    const manifest = await read(path);
    manifest.version = version;
    if (target === "meta") {
      for (const name of Object.keys(manifest.optionalDependencies)) {
        manifest.optionalDependencies[name] = version;
      }
    }
    update(path, manifest);
  }
  updates.set(
    source,
    text.replace(`from "${oldSpecifier}"`, `from "${newSpecifier}"`),
  );
  local.imports[newSpecifier] = local.imports[oldSpecifier];
  delete local.imports[oldSpecifier];
  update("deno.local.json", local);
  const launcher = await read("packages/launcher/deno.json");
  const parsed = versionParts(launcher.version);
  assert.equal(
    parsed.build,
    undefined,
    "Review the launcher prerelease version manually",
  );
  const [major, minor, patch] = parsed.base;
  launcher.version = `${major}.${minor}.${patch + 1n}`;
  update("packages/launcher/deno.json", launcher);
  // Read and validate everything first. Write the completion marker last, and
  // roll back ordinary write failures instead of leaving a half-bumped checkout.
  update("upstream.json", { ...pin, ref, version, tag });
  const touched: string[] = [];
  try {
    for (const [path, contents] of updates) {
      touched.push(path);
      await Deno.writeTextFile(join(root, path), contents);
    }
  } catch (error) {
    const failures = [error];
    for (const path of touched.reverse()) {
      try {
        await Deno.writeTextFile(join(root, path), original.get(path)!);
      } catch (rollback) {
        failures.push(rollback);
      }
    }
    throw new AggregateError(
      failures,
      "Version bump failed; restore any reported write failures before retrying",
    );
  }
  console.log(
    `Pinned ${version} at ${ref}; launcher ${launcher.version}. Refresh the public lockfile after npm publication.`,
  );
}
if (import.meta.main) {
  const [ref, version, tag] = Deno.args;
  await bump(ref, version, tag ?? null);
}

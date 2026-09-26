import assert from "node:assert/strict";
import { targets } from "./targets.ts";
import { join } from "node:path";
import { binaryVersionPattern } from "./versions.ts";

export async function checkVersions(root = "."): Promise<void> {
  const read = async (path: string) =>
    JSON.parse(await Deno.readTextFile(join(root, path)));
  const pin = await read("upstream.json");
  assert.match(pin.version, binaryVersionPattern);
  assert.match(pin.ref, /^[a-f0-9]{40}$/);
  const meta = await read("packages/binaries/meta/package.json");
  assert.equal(meta.version, pin.version);
  assert.equal(Object.keys(meta.optionalDependencies).length, targets.length);
  for (const target of targets) {
    const pkg = await read(`packages/binaries/${target}/package.json`);
    assert.equal(pkg.name, `@deerdaily/bot-api-${target}`);
    assert.equal(pkg.version, pin.version);
    assert.equal(meta.optionalDependencies[pkg.name], pin.version);
    const [os, cpu, libc] = target.split("-");
    assert.deepEqual(pkg.os, [os]);
    assert.deepEqual(pkg.cpu, [cpu]);
    assert.deepEqual(pkg.libc, os === "linux" ? [libc ?? "glibc"] : undefined);
  }
  const specifier = `npm:@deerdaily/bot-api-binaries@${pin.version}`;
  assert.ok(
    (await Deno.readTextFile(join(root, "packages/launcher/src/binary.ts")))
      .includes(
        `from "${specifier}"`,
      ),
    `Launcher source is missing the expected import: ${specifier}`,
  );
  const target = (await read("deno.local.json")).imports?.[specifier];
  assert.ok(
    typeof target === "string" && target.trim().length > 0,
    `Local import map needs a non-empty target for ${specifier}`,
  );
  console.log(`Binary packages and launcher pin agree: ${pin.version}`);
}
if (import.meta.main) await checkVersions();

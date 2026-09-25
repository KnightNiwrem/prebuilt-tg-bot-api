import { targets } from "./targets.ts";

export function validatePin(
  ref: string,
  version: string,
  tag: string | null,
): void {
  if (!/^[a-f0-9]{40}$/.test(ref)) {
    throw new Error("Use an immutable 40-character upstream commit SHA");
  }
  if (!/^\d+\.\d+\.\d+(?:-build\.\d+)?$/.test(version)) {
    throw new Error("Expected x.y.z or x.y.z-build.N");
  }
  if (tag !== null && !/^v?\d+\.\d+(?:\.\d+)?$/.test(tag)) {
    throw new Error("Unexpected upstream release tag");
  }
}

export async function bump(
  ref: string,
  version: string,
  tag: string | null = null,
): Promise<void> {
  validatePin(ref, version, tag);
  const read = async (path: string) =>
    JSON.parse(await Deno.readTextFile(path));
  const write = async (path: string, value: unknown) =>
    await Deno.writeTextFile(path, JSON.stringify(value, null, 2) + "\n");
  const pin = await read("upstream.json");
  if (pin.ref === ref && pin.version === version && pin.tag === tag) return;
  if (pin.version === version) {
    throw new Error(
      "A different build of an existing version needs a -build.N version",
    );
  }
  const oldVersion = pin.version;
  await write("upstream.json", { ...pin, ref, version, tag });
  for (const target of [...targets, "meta"]) {
    const path = `packages/binaries/${target}/package.json`;
    const manifest = await read(path);
    manifest.version = version;
    if (target === "meta") {
      for (const name of Object.keys(manifest.optionalDependencies)) {
        manifest.optionalDependencies[name] = version;
      }
    }
    await write(path, manifest);
  }
  const source = "packages/launcher/src/binary.ts";
  await Deno.writeTextFile(
    source,
    (await Deno.readTextFile(source)).replace(
      `npm:@deerdaily/bot-api-binaries@${oldVersion}`,
      `npm:@deerdaily/bot-api-binaries@${version}`,
    ),
  );
  const local = await read("deno.local.json");
  local.imports[`npm:@deerdaily/bot-api-binaries@${version}`] =
    local.imports[`npm:@deerdaily/bot-api-binaries@${oldVersion}`];
  delete local.imports[`npm:@deerdaily/bot-api-binaries@${oldVersion}`];
  await write("deno.local.json", local);
  const launcher = await read("packages/launcher/deno.json");
  const [major, minor, patch] = launcher.version.split(".").map(Number);
  launcher.version = `${major}.${minor}.${patch + 1}`;
  await write("packages/launcher/deno.json", launcher);
  console.log(
    `Pinned ${version} at ${ref}; launcher ${launcher.version}. Refresh the public lockfile after npm publication.`,
  );
}
if (import.meta.main) {
  const [ref, version, tag] = Deno.args;
  await bump(ref, version, tag ?? null);
}

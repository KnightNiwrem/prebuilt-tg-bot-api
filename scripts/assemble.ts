import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { checkVersions } from "./check-versions.ts";
import { command } from "./command.ts";
import { binaryName, buildTarget, targets } from "./targets.ts";

export interface PackedPackage {
  name: string;
  version: string;
  filename: string;
  integrity: string;
  manifest: Record<string, unknown>;
}

export async function assemble(): Promise<void> {
  await checkVersions();
  await Deno.mkdir("dist/packages", { recursive: true });
  await Deno.mkdir("dist/release", { recursive: true });
  const checksums: string[] = [];
  const licenses: string[] = [];
  for await (const entry of Deno.readDir("licenses")) {
    if (entry.isFile) licenses.push(entry.name);
  }
  for (const target of targets) {
    const binary = binaryName(target);
    const source = `artifacts/native-${buildTarget(target)}/${binary}`;
    const bytes = await Deno.readFile(source);
    if (bytes.length < 100_000) {
      throw new Error(`Not a native server binary: ${source}`);
    }
    const directory = `packages/binaries/${target}/bin`;
    const notices = `packages/binaries/${target}/LICENSES`;
    await Deno.mkdir(notices, { recursive: true });
    for (const license of licenses) {
      await Deno.copyFile(`licenses/${license}`, `${notices}/${license}`);
    }
    await Deno.mkdir(directory, { recursive: true });
    await Deno.copyFile(source, `${directory}/${binary}`);
    if (Deno.build.os !== "windows") {
      await Deno.chmod(`${directory}/${binary}`, 0o755);
    }
    const asset = `telegram-bot-api-${target}${
      target === "win32-x64" ? ".exe" : ""
    }`;
    await Deno.copyFile(source, `dist/release/${asset}`);
    checksums.push(
      `${createHash("sha256").update(bytes).digest("hex")}  ${asset}`,
    );
  }
  await Deno.writeTextFile(
    "dist/release/SHA256SUMS",
    checksums.join("\n") + "\n",
  );
  await Deno.mkdir("dist/release/LICENSES", { recursive: true });
  for (const license of licenses) {
    await Deno.copyFile(
      `licenses/${license}`,
      `dist/release/LICENSES/${license}`,
    );
  }
  await command("node", ["scripts/build-npm.mjs"]);
  const packed: PackedPackage[] = [];
  for (
    const directory of [
      ...targets.map((target) => `packages/binaries/${target}`),
      "packages/binaries/meta",
      "dist/npm-launcher",
    ]
  ) {
    const manifest = JSON.parse(
      await Deno.readTextFile(join(directory, "package.json")),
    );
    const output = await command("npm", [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      resolve("dist/packages"),
    ], { cwd: directory });
    const [info] = JSON.parse(output);
    packed.push({
      name: manifest.name,
      version: manifest.version,
      filename: info.filename,
      integrity: info.integrity,
      manifest,
    });
  }
  await Deno.writeTextFile(
    "dist/packages.json",
    JSON.stringify(packed, null, 2) + "\n",
  );
}
if (import.meta.main) await assemble();

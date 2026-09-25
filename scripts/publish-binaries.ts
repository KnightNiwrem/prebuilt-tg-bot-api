import { command } from "./command.ts";
import { targets } from "./targets.ts";
import { checkVersions } from "./check-versions.ts";

if (Deno.env.get("CI") !== "true") {
  throw new Error("Publish from GitHub Actions for provenance");
}
await checkVersions();
const packages = JSON.parse(await Deno.readTextFile("dist/packages.json"));
for (const target of [...targets, "meta"]) {
  const name = target === "meta"
    ? "@deerdaily/bot-api-binaries"
    : `@deerdaily/bot-api-${target}`;
  const pkg = packages.find((entry: { name: string }) => entry.name === name);
  if (!pkg) throw new Error(`Missing assembled tarball for ${name}`);
  // Retrying after a partial publication is safe only when the exact tarball agrees.
  const response = await fetch(
    `https://registry.npmjs.org/${name}/${pkg.version}`,
  );
  if (response.ok) {
    const existing = await response.json();
    if (existing.dist.integrity !== pkg.integrity) {
      throw new Error(
        `${name}@${pkg.version} exists with different bytes. Use -build.N.`,
      );
    }
    console.log(
      `Already published with identical integrity: ${name}@${pkg.version}`,
    );
    continue;
  }
  if (response.status !== 404) {
    throw new Error(`Registry preflight failed: ${response.status}`);
  }
  console.log(
    await command("npm", [
      "publish",
      `dist/packages/${pkg.filename}`,
      "--provenance",
      "--access",
      "public",
      "--tag",
      pkg.version.includes("-") ? "build" : "latest",
    ]),
  );
}

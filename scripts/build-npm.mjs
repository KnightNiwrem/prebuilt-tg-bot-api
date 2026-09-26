import { stripTypeScriptTypes } from "node:module";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const config = JSON.parse(
  await readFile("packages/launcher/deno.json", "utf8"),
);
const pin = JSON.parse(await readFile("upstream.json", "utf8"));
for (
  const file of [
    "cli.ts",
    "mod.ts",
    "src/api.ts",
    "src/process.ts",
    "src/binary.ts",
  ]
) {
  const source = (await readFile(`packages/launcher/${file}`, "utf8"))
    .replace(/^#![^\n]*\n/, "#!/usr/bin/env node\n")
    .replace(/(["'])(\.\.?\/[^"']+)\.ts\1/g, "$1$2.js$1")
    .replace(
      `npm:@deerdaily/bot-api-binaries@${pin.version}`,
      "@deerdaily/bot-api-binaries",
    );
  const path = `dist/npm-launcher/${file.replace(/\.ts$/, ".js")}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stripTypeScriptTypes(source));
}
await chmod("dist/npm-launcher/cli.js", 0o755);
for (const file of ["README.md", "LICENSE"]) {
  await copyFile(`packages/launcher/${file}`, `dist/npm-launcher/${file}`);
}
await copyFile("packages/launcher/api.d.ts", "dist/npm-launcher/mod.d.ts");
await writeFile(
  "dist/npm-launcher/package.json",
  JSON.stringify(
    {
      name: config.name,
      version: config.version,
      license: config.license,
      description:
        "Zero-install launcher for the official native Telegram Bot API server",
      type: "module",
      engines: { node: ">=22" },
      bin: { "bot-api": "./cli.js" },
      exports: {
        ".": { types: "./mod.d.ts", default: "./mod.js" },
        "./api": { types: "./mod.d.ts", default: "./mod.js" },
      },
      files: ["*.js", "*.d.ts", "src", "README.md", "LICENSE"],
      dependencies: { "@deerdaily/bot-api-binaries": pin.version },
      repository: {
        type: "git",
        url: "git+https://github.com/KnightNiwrem/prebuilt-tg-bot-api.git",
        directory: "packages/launcher",
      },
    },
    null,
    2,
  ) + "\n",
);

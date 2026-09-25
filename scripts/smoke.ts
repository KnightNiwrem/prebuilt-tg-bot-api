import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { command } from "./command.ts";
import { testRegistry } from "./registry.ts";
import { binaryName } from "./targets.ts";

async function help(
  program: string,
  args: string[],
  options: Deno.CommandOptions = {},
): Promise<void> {
  const result = await new Deno.Command(program, {
    ...options,
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  assert.equal(result.code, 0, stdout + stderr);
  // Upstream uses LOG(PLAIN), which writes its help to stderr on some platforms.
  assert.match(stdout + stderr, /Telegram Bot API server/);
  assert.match(stdout + stderr, /--api-id/);
}

if (Deno.env.get("CI") !== "true") {
  throw new Error("Native smoke tests and deno compile are CI-only");
}
const target = Deno.env.get("BOT_API_TEST_TARGET")!;
const triple = Deno.env.get("BOT_API_COMPILE_TARGET")!;
const pin = JSON.parse(await Deno.readTextFile("upstream.json"));
const launcher = JSON.parse(
  await Deno.readTextFile("packages/launcher/deno.json"),
);
const packages = JSON.parse(await Deno.readTextFile("dist/packages.json"));
const registry = testRegistry(packages);
let registryStopped = false;
const directory = resolve(`dist/smoke-${target}`);
await Deno.mkdir(directory, { recursive: true });
const registryUrl = `http://127.0.0.1:${registry.addr.port}/`;
const env = {
  NPM_CONFIG_REGISTRY: registryUrl,
  DENO_NPM_REGISTRY: registryUrl,
  DENO_DIR: join(directory, "deno-cache"),
};
try {
  await Deno.writeTextFile(
    join(directory, ".npmrc"),
    `registry=${registryUrl}\n`,
  );
  await Deno.writeTextFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await Deno.writeTextFile(
    join(directory, "deno.json"),
    JSON.stringify({ nodeModulesDir: "none" }),
  );
  await command("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    `@deerdaily/bot-api@${launcher.version}`,
  ], { cwd: directory, env });
  const installed = join(directory, "node_modules/@deerdaily/bot-api/cli.js");
  await help("node", [installed, "--help"], { env });
  // Stage the installed package tree for the separate Alpine/Node smoke job.
  if (target.endsWith("-musl")) {
    await command("npm", [
      "install",
      "--force",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `@deerdaily/bot-api-${target}@${pin.version}`,
    ], { cwd: directory, env });
    console.log(
      "Native musl smoke runs under Alpine. Deno has no musl compile target; no standalone musl launcher is advertised.",
    );
  } else {
    const config = join(directory, "deno.json");
    const cli = resolve("packages/launcher/cli.ts");
    await help(Deno.execPath(), [
      "run",
      "--config",
      config,
      "-N",
      "-R",
      "-W",
      "--allow-run",
      "--allow-env",
      cli,
      "--help",
    ], { env });
    await Deno.mkdir("dist/compiled", { recursive: true });
    const executable = resolve(
      `dist/compiled/bot-api-${target}${
        Deno.build.os === "windows" ? ".exe" : ""
      }`,
    );
    await command(Deno.execPath(), [
      "compile",
      "--config",
      config,
      "--target",
      triple,
      "-N",
      "-R",
      "-W",
      "--allow-run",
      "--allow-env",
      "--output",
      executable,
      cli,
    ], { env });
    // Remove access to both package trees and the compile cache before execution.
    await Deno.rename(
      join(directory, "deno-cache"),
      join(directory, "hidden-deno-cache"),
    );
    await Deno.rename(
      join(directory, "node_modules"),
      join(directory, "hidden-node_modules"),
    );
    await registry.shutdown();
    registryStopped = true;
    const clean = await Deno.makeTempDir();
    try {
      await help(executable, ["--help"], {
        cwd: clean,
        env: {
          DENO_DIR: clean,
          TMPDIR: clean,
          TEMP: clean,
          TMP: clean,
          NPM_CONFIG_REGISTRY: "http://127.0.0.1:1/",
          DENO_NPM_REGISTRY: "http://127.0.0.1:1/",
        },
      });
      for await (const entry of Deno.readDir(clean)) {
        assert.ok(
          !entry.name.startsWith("telegram-bot-api-"),
          "Compiled launcher must clean up the extracted server",
        );
      }
    } finally {
      await Deno.remove(clean, { recursive: true });
    }
  }
  // Serve HTTP from the real binary; TELEGRAM_API_* secrets, when present,
  // are inherited and add a credentialed request.
  const binary = resolve(
    `packages/binaries/${target}/bin/${binaryName(target)}`,
  );
  console.log(
    await command(Deno.execPath(), [
      "run",
      "--config",
      "deno.local.json",
      "-A",
      "scripts/http-smoke.ts",
    ], { env: { TELEGRAM_BOT_API_BINARY: binary } }),
  );
  console.log(`Smoke passed: ${target}, binary ${pin.version}`);
} finally {
  if (!registryStopped) await registry.shutdown();
}

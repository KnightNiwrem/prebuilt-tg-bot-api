import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const target = process.env.BOT_API_TEST_TARGET;
assert.match(target, /^linux-(?:x64|arm64)-musl$/);
const directory = resolve(`dist/smoke-${target}/node_modules/@deerdaily`);
const resolver = await import(
  pathToFileURL(`${directory}/bot-api-binaries/index.js`).href
);
assert.equal(resolver.detectLibc(), "musl");
assert.equal(
  resolver.targetFor(process.platform, process.arch, resolver.detectLibc()),
  target,
);
assert.equal(
  resolver.resolveBinaryPath(),
  `${directory}/bot-api-${target}/bin/telegram-bot-api`,
);
const result = spawnSync(process.execPath, [
  `${directory}/bot-api/cli.js`,
  "--help",
], { encoding: "utf8" });
assert.equal(result.status, 0, result.stdout + result.stderr);
assert.match(result.stdout + result.stderr, /Telegram Bot API server/);
console.log(`Alpine resolved and ran @deerdaily/bot-api-${target}`);

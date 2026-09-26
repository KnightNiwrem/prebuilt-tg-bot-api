import assert from "node:assert/strict";
import { command } from "./command.ts";
import { numericId, repository, validateRun } from "./release.ts";

assert.equal(Deno.env.get("GITHUB_REPOSITORY"), repository);
const id = numericId(Deno.args[0]);
const run = JSON.parse(
  await command("gh", ["api", `repos/${repository}/actions/runs/${id}`]),
);
validateRun(run, "build-binaries.yml", Deno.env.get("GITHUB_SHA")!);
console.log(`Validated successful build ${id} at ${run.head_sha}`);

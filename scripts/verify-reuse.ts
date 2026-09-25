import assert from "node:assert/strict";
import { command } from "./command.ts";
import { targets } from "./targets.ts";

const id = Deno.args[0];
if (!/^\d+$/.test(id)) {
  throw new Error("Expected a numeric native build run ID");
}
const repo = Deno.env.get("GITHUB_REPOSITORY")!;
const api = async (path: string) =>
  JSON.parse(await command("gh", ["api", `repos/${repo}/${path}`]));
const run = await api(`actions/runs/${id}`);
assert.equal(run.path, ".github/workflows/build-binaries.yml");
assert.notEqual(run.event, "pull_request");
assert.equal(run.head_repository.full_name, repo);
const jobs = await api(`actions/runs/${id}/jobs?per_page=100`);
for (const target of targets) {
  const job = jobs.jobs.find((job: { name: string }) =>
    job.name.startsWith(`build (${target},`)
  );
  assert.equal(
    job?.conclusion,
    "success",
    `Native build must have passed for ${target}`,
  );
}
for (
  const path of [
    "upstream.json",
    "scripts/build-linux.sh",
    "scripts/build-macos.sh",
    "scripts/build-windows.ps1",
  ]
) {
  const old = await api(`contents/${path}?ref=${run.head_sha}`);
  assert.equal(
    atob(old.content.replace(/\s/g, "")),
    await Deno.readTextFile(path),
    `Cannot reuse artifacts after changing ${path}`,
  );
}
console.log(
  `Reusing seven successful native jobs from ${id} (${run.head_sha}); source pin and native scripts match.`,
);

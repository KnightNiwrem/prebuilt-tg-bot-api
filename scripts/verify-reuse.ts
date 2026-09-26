import assert from "node:assert/strict";
import { command } from "./command.ts";
import { buildTargets } from "./targets.ts";

export function nativeJob(workflow: string): string {
  assert.ok(
    !/^(?:env|defaults)\s*:/m.test(workflow),
    "Review global build environment/defaults before allowing artifact reuse",
  );
  const job = workflow.match(/\n {2}build:\n([\s\S]*?)\n {2}smoke:/)?.[1];
  assert.ok(job, "Cannot identify native build recipe");
  return job.replace("    if: inputs.native_run_id == ''\n", "");
}

if (import.meta.main) {
  const id = Deno.args[0];
  if (!/^\d+$/.test(id)) {
    throw new Error("Expected a numeric native build run ID");
  }
  const repo = Deno.env.get("GITHUB_REPOSITORY")!;
  const api = async (path: string) =>
    JSON.parse(await command("gh", ["api", `repos/${repo}/${path}`]));
  const run = await api(`actions/runs/${id}`);
  assert.equal(run.path, ".github/workflows/build-binaries.yml");
  assert.ok(
    ["push", "workflow_dispatch"].includes(run.event),
    "Untrusted build event",
  );
  assert.equal(run.head_repository.full_name, repo);
  const jobs = await api(`actions/runs/${id}/jobs?per_page=100`);
  for (const target of buildTargets) {
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
  const oldWorkflow = await api(
    `contents/.github/workflows/build-binaries.yml?ref=${run.head_sha}`,
  );
  const previousWorkflow = atob(oldWorkflow.content.replace(/\s/g, ""));
  const currentWorkflow = await Deno.readTextFile(
    ".github/workflows/build-binaries.yml",
  );

  assert.equal(
    nativeJob(previousWorkflow),
    nativeJob(currentWorkflow),
    "Native job recipe changed; run a fresh build",
  );
  console.log(
    `Reusing ${buildTargets.length} successful native jobs from ${id} (${run.head_sha}); source pin and native scripts match.`,
  );
}

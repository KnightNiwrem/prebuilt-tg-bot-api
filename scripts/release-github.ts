import assert from "node:assert/strict";
import { command } from "./command.ts";
import {
  numericId,
  type Release,
  type ReleaseKind,
  repository,
  validateRelease,
  validateRun,
  type WorkflowRun,
} from "./release.ts";

export async function githubRun(
  id: string,
  attempt: string,
): Promise<WorkflowRun> {
  return JSON.parse(
    await command("gh", [
      "api",
      `repos/${repository}/actions/runs/${numericId(id)}/attempts/${
        numericId(attempt)
      }`,
    ]),
  );
}

export async function readRelease(path: string): Promise<Release> {
  const value: unknown = JSON.parse(await Deno.readTextFile(path));
  validateRelease(value);
  return value;
}

/** Only downloads a small, explicitly named JSON artifact. No package payloads. */
export async function releaseMetadata(
  kind: ReleaseKind,
  id: string,
  attempt: string,
  commit: string,
  directory: string,
): Promise<Release> {
  const run = await githubRun(id, attempt);
  validateRun(run, `publish-${kind}.yml`, commit, true);
  assert.equal(run.event, "workflow_dispatch");
  assert.equal(run.head_branch, "main");
  const artifacts = JSON.parse(
    await command("gh", [
      "api",
      `repos/${repository}/actions/runs/${id}/artifacts?name=release-${kind}-${attempt}`,
    ]),
  );
  assert.ok(
    artifacts.artifacts.some((artifact: { name: string; expired: boolean }) =>
      artifact.name === `release-${kind}-${attempt}` && !artifact.expired
    ),
    "The exact saved release bundle is missing or expired",
  );
  await command("gh", [
    "run",
    "download",
    numericId(id),
    "--repo",
    repository,
    "--name",
    `release-metadata-${kind}-${numericId(attempt)}`,
    "--dir",
    directory,
  ]);
  const release = await readRelease(`${directory}/release.json`);
  assert.equal(release.kind, kind);
  assert.equal(release.runId, id);
  assert.equal(release.attempt, attempt);
  assert.equal(release.commit, commit);
  return release;
}

export async function requireCI(commit: string): Promise<void> {
  const result = JSON.parse(
    await command("gh", [
      "api",
      `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${commit}&status=success&per_page=100`,
    ]),
  );
  const run = result.workflow_runs.find((run: WorkflowRun) =>
    ["push", "workflow_dispatch"].includes(run.event) &&
    run.head_repository.full_name === repository
  );
  assert.ok(
    run,
    "A successful ordinary CI run is required for this exact commit",
  );
  validateRun(run, "ci.yml", commit);
}

export async function checkReleaseVersions(release: Release): Promise<void> {
  const upstream = JSON.parse(await Deno.readTextFile("upstream.json"));
  const launcher = JSON.parse(
    await Deno.readTextFile("packages/launcher/deno.json"),
  );
  for (const pkg of release.packages) {
    assert.equal(
      pkg.version,
      release.kind === "binaries" ? upstream.version : launcher.version,
    );
  }
}

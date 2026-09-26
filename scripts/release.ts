import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { targets } from "./targets.ts";

export const repository = "KnightNiwrem/prebuilt-tg-bot-api";
export const registry = "https://registry.npmjs.org";
export type ReleaseKind = "binaries" | "launcher";
export interface ReleasePackage {
  name: string;
  version: string;
  filename: string;
  integrity: string;
  shasum: string;
  tag: string;
  stageId?: string;
  published?: boolean;
}
export interface Release {
  schema: 1;
  kind: ReleaseKind;
  repository: string;
  commit: string;
  runId: string;
  attempt: string;
  buildRunId?: string;
  assets: Record<string, string>;
  packages: ReleasePackage[];
}
export interface WorkflowRun {
  head_sha: string;
  head_branch: string;
  head_repository: { full_name: string };
  path: string;
  event: string;
  status: string;
  conclusion: string;
}

export function numericId(value: string): string {
  assert.match(
    value,
    /^[1-9]\d*$/,
    "Expected a positive numeric run ID/attempt",
  );
  return value;
}
export function releaseKind(value: string): ReleaseKind {
  assert.ok(
    value === "binaries" || value === "launcher",
    "Unknown release kind",
  );
  return value;
}
export function packageNames(kind: ReleaseKind): string[] {
  return kind === "launcher" ? ["@deerdaily/bot-api"] : [
    ...targets.map((target) => `@deerdaily/bot-api-${target}`),
    "@deerdaily/bot-api-binaries",
  ];
}
export function validateRun(
  run: WorkflowRun,
  workflow: string,
  commit: string,
  allowPartial = false,
): void {
  assert.equal(run.head_repository.full_name, repository, "Foreign repository");
  assert.equal(run.path, `.github/workflows/${workflow}`, "Wrong workflow");
  assert.equal(
    run.head_sha,
    commit,
    "Run must match the release commit exactly",
  );
  assert.ok(
    ["push", "workflow_dispatch"].includes(run.event),
    "Untrusted event",
  );
  assert.equal(run.status, "completed", "Run is still in progress");
  assert.ok(
    (allowPartial ? ["success", "failure", "cancelled"] : ["success"])
      .includes(run.conclusion),
    "Required workflow did not succeed",
  );
}
export function validateRelease(value: unknown): asserts value is Release {
  assert.ok(value && typeof value === "object");
  const release = value as Release;
  assert.equal(release.schema, 1);
  releaseKind(release.kind);
  assert.equal(release.repository, repository);
  assert.match(release.commit, /^[a-f0-9]{40}$/);
  numericId(release.runId);
  numericId(release.attempt);
  if (release.kind === "binaries") numericId(release.buildRunId!);
  assert.ok(release.assets && typeof release.assets === "object");
  for (const [filename, digest] of Object.entries(release.assets)) {
    assert.match(filename, /^[a-zA-Z0-9._-]+$/);
    assert.match(digest, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(
    Object.keys(release.assets).sort(),
    release.kind === "binaries"
      ? [
        ...targets.map((target) =>
          `telegram-bot-api-${target}${target === "win32-x64" ? ".exe" : ""}`
        ),
        "SHA256SUMS",
        "LICENSES.tar.gz",
      ].sort()
      : [],
    "Incomplete release assets",
  );
  assert.ok(Array.isArray(release.packages));
  assert.deepEqual(
    release.packages.map((pkg) => pkg.name),
    packageNames(release.kind),
    "Unexpected packages or approval order",
  );
  for (const pkg of release.packages) {
    assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-build\.\d+)?$/);
    assert.match(pkg.filename, /^[a-zA-Z0-9._-]+\.tgz$/);
    assert.match(pkg.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    assert.match(pkg.shasum, /^[a-f0-9]{40}$/);
    assert.equal(pkg.tag, pkg.version.includes("-") ? "build" : "latest");
    if (pkg.stageId) validateStageId(pkg.stageId);
  }
}
export function validateStageId(value: string): string {
  assert.match(value, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  return value;
}
export function hashes(
  bytes: Uint8Array,
): { integrity: string; shasum: string } {
  return {
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    shasum: createHash("sha1").update(bytes).digest("hex"),
  };
}
export function verifyTarball(pkg: ReleasePackage, bytes: Uint8Array): void {
  assert.deepEqual(hashes(bytes), {
    integrity: pkg.integrity,
    shasum: pkg.shasum,
  }, `Tarball changed: ${pkg.name}@${pkg.version}`);
}
export async function publicVersion(
  pkg: Pick<ReleasePackage, "name" | "version">,
): Promise<
  { name: string; version: string; dist: { integrity: string } } | null
> {
  const response = await fetch(
    `${registry}/${encodeURIComponent(pkg.name)}/${
      encodeURIComponent(pkg.version)
    }`,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Registry lookup failed: ${response.status}`);
  }
  const body = await response.json();
  assert.equal(body.name, pkg.name);
  assert.equal(body.version, pkg.version);
  assert.equal(typeof body.dist?.integrity, "string");
  return body;
}
export function assertPublishedIntegrity(
  pkg: ReleasePackage,
  existing: { dist: { integrity: string } } | null,
): void {
  assert.ok(existing, `${pkg.name}@${pkg.version} is not public yet`);
  assert.equal(
    existing.dist.integrity,
    pkg.integrity,
    `${pkg.name}@${pkg.version} has different bytes; use a new version`,
  );
}
export function stageReceipt(output: string, pkg: ReleasePackage): string {
  const json = JSON.parse(output);
  // npm 11.19 uses a package-name key for --json; accept the unwrapped form too.
  const receipt = json[pkg.name] ?? json;
  assert.equal(receipt.name, pkg.name);
  assert.equal(receipt.version, pkg.version);
  assert.equal(receipt.integrity, pkg.integrity);
  assert.equal(receipt.shasum, pkg.shasum);
  return validateStageId(receipt.stageId);
}
export function matchStage(
  release: Release,
  stage: {
    id: string;
    packageName: string;
    version: string;
    tag: string;
    shasum: string;
    integrity?: string;
  },
): ReleasePackage {
  validateStageId(stage.id);
  const pkg = release.packages.find((pkg) => pkg.name === stage.packageName);
  assert.ok(pkg, "Stage is not part of this release");
  assert.equal(stage.version, pkg.version);
  assert.equal(stage.tag, pkg.tag);
  assert.equal(
    stage.shasum,
    pkg.shasum,
    "Stage does not match the saved tarball",
  );
  if (stage.integrity) assert.equal(stage.integrity, pkg.integrity);
  if (pkg.stageId) assert.equal(stage.id, pkg.stageId);
  return pkg;
}

/** Prevent exposing a meta-package before all of its exact platform pins exist. */
export async function requireApprovalDependencies(
  release: Release,
  pkg: ReleasePackage,
  lookup: (pkg: ReleasePackage) => ReturnType<typeof publicVersion> =
    publicVersion,
): Promise<void> {
  if (pkg.name === "@deerdaily/bot-api-binaries") {
    for (const dependency of release.packages.slice(0, -1)) {
      assertPublishedIntegrity(dependency, await lookup(dependency));
    }
  }
}

export async function stagePackages(
  release: Release,
  io: {
    lookup: (pkg: ReleasePackage) => ReturnType<typeof publicVersion>;
    stage: (pkg: ReleasePackage) => Promise<string>;
    save: () => Promise<void>;
  },
): Promise<void> {
  for (const pkg of release.packages) {
    const existing = await io.lookup(pkg);
    if (existing) {
      assertPublishedIntegrity(pkg, existing);
      pkg.published = true;
    } else if (!pkg.stageId) {
      try {
        pkg.stageId = stageReceipt(await io.stage(pkg), pkg);
      } catch (error) {
        throw new Error(
          `Staging ${pkg.name} stopped. If npm already holds this version, use ` +
            `'npm stage list ${pkg.name}' and review it against this run's ` +
            `release metadata before approval. Do not replace its bytes.`,
          { cause: error },
        );
      }
    }
    await io.save();
  }
}

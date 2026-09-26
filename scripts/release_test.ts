import assert from "node:assert/strict";
import {
  hashes,
  matchStage,
  packageNames,
  type Release,
  type ReleasePackage,
  repository,
  requireApprovalDependencies,
  stagePackages,
  stageReceipt,
  validateRelease,
  validateReleaseCommit,
  validateRun,
  verifyTarball,
  type WorkflowRun,
} from "./release.ts";
import { targets } from "./targets.ts";

const bytes = new TextEncoder().encode("test package payload");
const stageId = "01234567-89ab-4cde-8012-3456789abcde";
function fixture(): Release {
  return {
    schema: 1,
    kind: "binaries",
    repository,
    commit: "a".repeat(40),
    runId: "123",
    attempt: "1",
    buildRunId: "100",
    assets: Object.fromEntries(
      [
        ...targets.map((target) =>
          `telegram-bot-api-${target}${target === "win32-x64" ? ".exe" : ""}`
        ),
        "SHA256SUMS",
        "LICENSES.tar.gz",
      ].map((name) => [name, "b".repeat(64)]),
    ),
    packages: packageNames("binaries").map((name) => ({
      name,
      version: "10.3.0",
      filename: name.slice(1).replace("/", "-") + ".tgz",
      ...hashes(bytes),
      tag: "latest",
    })),
  };
}
const receipt = (pkg: ReleasePackage) =>
  JSON.stringify({ [pkg.name]: { ...pkg, stageId } });
const publicPackage = (pkg: ReleasePackage) => ({
  name: pkg.name,
  version: pkg.version,
  dist: { integrity: pkg.integrity },
});

Deno.test("release rejects foreign, PR, wrong workflow, unfinished and wrong-commit runs", () => {
  const run: WorkflowRun = {
    head_sha: "a".repeat(40),
    head_branch: "main",
    head_repository: { full_name: repository },
    path: ".github/workflows/build-binaries.yml",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
  };
  validateRun(run, "build-binaries.yml", run.head_sha);
  for (
    const change of [
      { head_repository: { full_name: "other/repo" } },
      { event: "pull_request" },
      { event: "pull_request_target" },
      { path: ".github/workflows/ci.yml" },
      { head_sha: "b".repeat(40) },
      { status: "in_progress" },
      { conclusion: "failure" },
    ]
  ) {
    assert.throws(() =>
      validateRun({ ...run, ...change }, "build-binaries.yml", run.head_sha)
    );
  }
  validateRun(
    { ...run, conclusion: "failure" },
    "build-binaries.yml",
    run.head_sha,
    true,
  );
});

Deno.test("release metadata rejects missing packages/assets and path traversal", () => {
  validateRelease(fixture());
  const missingPackage = fixture();
  missingPackage.packages.pop();
  assert.throws(() => validateRelease(missingPackage));
  const missingAsset = fixture();
  delete missingAsset.assets.SHA256SUMS;
  assert.throws(() => validateRelease(missingAsset));
  const traversal = fixture();
  traversal.packages[0].filename = "../payload.tgz";
  assert.throws(() => validateRelease(traversal));
});

Deno.test("tarball verification and npm receipts reject changed bytes", () => {
  const pkg = fixture().packages[0];
  verifyTarball(pkg, bytes);
  assert.throws(() => verifyTarball(pkg, new TextEncoder().encode("changed")));
  assert.equal(stageReceipt(receipt(pkg), pkg), stageId);
  assert.equal(stageReceipt(JSON.stringify({ ...pkg, stageId }), pkg), stageId);
  assert.throws(() =>
    stageReceipt(receipt({ ...pkg, ...hashes(new Uint8Array([1])) }), pkg)
  );
});

Deno.test("staging checkpoints partial progress and never restages known stages", async () => {
  const release = fixture();
  const saved: Release[] = [];
  let calls = 0;
  await assert.rejects(() =>
    stagePackages(release, {
      lookup: () => Promise.resolve(null),
      stage: (pkg) => {
        if (++calls === 3) return Promise.reject(new Error("interrupted"));
        return Promise.resolve(receipt(pkg));
      },
      save: () => {
        saved.push(structuredClone(release));
        return Promise.resolve();
      },
    }), /Staging .* stopped/);
  assert.equal(saved.length, 2);
  assert.ok(saved[1].packages[1].stageId);
  assert.equal(saved[1].packages[2].stageId, undefined);
  calls = 0;
  await stagePackages(release, {
    lookup: () => Promise.resolve(null),
    stage: (pkg) => {
      calls++;
      return Promise.resolve(receipt(pkg));
    },
    save: () => Promise.resolve(),
  });
  assert.equal(calls, 6);
});

Deno.test("staging skips identical public versions but stops on a checksum conflict", async () => {
  const release = fixture();
  let staged = 0;
  const io = {
    lookup: (pkg: ReleasePackage) => Promise.resolve(publicPackage(pkg)),
    stage: () => {
      staged++;
      return Promise.reject(new Error("must not stage"));
    },
    save: () => Promise.resolve(),
  };
  await stagePackages(release, io);
  assert.equal(staged, 0);
  assert.ok(release.packages.every((pkg) => pkg.published));
  await assert.rejects(
    () =>
      stagePackages(fixture(), {
        ...io,
        lookup: (pkg) =>
          Promise.resolve({
            ...publicPackage(pkg),
            dist: { integrity: "different bytes" },
          }),
      }),
    /different bytes/,
  );
  assert.equal(staged, 0);
});

Deno.test("approval binds a stage to the saved package, version, tag and checksum", () => {
  const release = fixture();
  const pkg = release.packages[0];
  const stage = {
    id: stageId,
    packageName: pkg.name,
    version: pkg.version,
    tag: pkg.tag,
    shasum: pkg.shasum,
  };
  assert.equal(matchStage(release, stage), pkg); // Recovery of a lost receipt.
  for (
    const change of [
      { packageName: "@someone/else" },
      { version: "99.0.0" },
      { tag: "build" },
      { shasum: "c".repeat(40) },
      { integrity: "wrong" },
    ]
  ) assert.throws(() => matchStage(release, { ...stage, ...change }));
  pkg.stageId = "abcdef01-2345-4678-9012-3456789abcde";
  assert.throws(() => matchStage(release, stage));
});

Deno.test("meta-package approval requires all seven exact public integrities", async () => {
  const release = fixture();
  const meta = release.packages.at(-1)!;
  const visited: string[] = [];
  await requireApprovalDependencies(release, meta, (pkg) => {
    visited.push(pkg.name);
    return Promise.resolve(publicPackage(pkg as ReleasePackage));
  });
  assert.deepEqual(visited, packageNames("binaries").slice(0, -1));
  await assert.rejects(
    () =>
      requireApprovalDependencies(release, meta, () => Promise.resolve(null)),
    /not public yet/,
  );
  await assert.rejects(
    () =>
      requireApprovalDependencies(release, meta, (pkg) =>
        Promise.resolve({
          name: pkg.name,
          version: pkg.version,
          dist: {
            integrity: pkg.name === release.packages.at(-2)!.name
              ? "wrong"
              : pkg.integrity,
          },
        })),
    /different bytes/,
  );
});

Deno.test("launcher releases require one launcher package and no native assets", () => {
  const release: Release = {
    ...fixture(),
    kind: "launcher",
    assets: {},
    packages: [{
      ...fixture().packages[0],
      name: "@deerdaily/bot-api",
      version: "0.1.0",
      filename: "launcher.tgz",
    }],
  };
  delete release.buildRunId;
  validateRelease(release);
  assert.throws(() =>
    validateRelease({ ...release, assets: { SHA256SUMS: "a".repeat(64) } })
  );
  assert.throws(() =>
    validateRelease({ ...release, packages: [fixture().packages[0]] })
  );
  assert.throws(() =>
    validateRelease({
      ...release,
      packages: [...release.packages, ...release.packages],
    })
  );
});

Deno.test("dispatch refuses main moving after local review", () => {
  const reviewed = "a".repeat(40);
  validateReleaseCommit(reviewed, reviewed);
  assert.throws(
    () => validateReleaseCommit(reviewed, "b".repeat(40)),
    /main moved/,
  );
  assert.throws(
    () => validateReleaseCommit("main", reviewed),
    /full commit SHA/,
  );
});

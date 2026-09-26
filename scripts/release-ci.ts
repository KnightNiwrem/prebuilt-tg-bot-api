import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { assemble, type PackedPackage } from "./assemble.ts";
import { checkVersions } from "./check-versions.ts";
import { command } from "./command.ts";
import {
  checkReleaseVersions,
  readRelease,
  releaseMetadata,
  requireCI,
} from "./release-github.ts";
import {
  assertPublishedIntegrity,
  hashes,
  numericId,
  packageNames,
  publicVersion,
  registry,
  type Release,
  type ReleaseKind,
  releaseKind,
  repository,
  stagePackages,
  validateRelease,
  validateReleaseCommit,
  verifyTarball,
} from "./release.ts";

const bundle = "dist/release-bundle";
const metadata = "dist/release-metadata";

function context(): { commit: string; runId: string; attempt: string } {
  assert.equal(Deno.env.get("CI"), "true", "Artifact handling is CI-only");
  assert.equal(Deno.env.get("GITHUB_ACTIONS"), "true");
  assert.equal(Deno.env.get("GITHUB_REPOSITORY"), repository);
  assert.equal(Deno.env.get("GITHUB_REF"), "refs/heads/main");
  assert.equal(Deno.env.get("GITHUB_EVENT_NAME"), "workflow_dispatch");
  for (const key of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "JSR_TOKEN"]) {
    assert.ok(!Deno.env.get(key), `${key} must not be passed to release jobs`);
  }
  const commit = Deno.env.get("GITHUB_SHA")!;
  validateReleaseCommit(Deno.env.get("EXPECTED_SHA")!, commit);
  assert.match(commit, /^[a-f0-9]{40}$/);
  return {
    commit,
    runId: numericId(Deno.env.get("GITHUB_RUN_ID")!),
    attempt: numericId(Deno.env.get("GITHUB_RUN_ATTEMPT")!),
  };
}

async function save(release: Release): Promise<void> {
  validateRelease(release);
  await Deno.mkdir(metadata, { recursive: true });
  await Deno.writeTextFile(
    `${metadata}/release.json`,
    JSON.stringify(release, null, 2) + "\n",
  );
}

async function verifyBundle(release: Release): Promise<void> {
  await checkReleaseVersions(release);
  for (const pkg of release.packages) {
    verifyTarball(
      pkg,
      await Deno.readFile(`${bundle}/packages/${pkg.filename}`),
    );
  }
  for (const [name, digest] of Object.entries(release.assets)) {
    const bytes = await Deno.readFile(`${bundle}/assets/${name}`);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      digest,
      `Release asset changed: ${name}`,
    );
  }
}

async function prepare(kind: ReleaseKind): Promise<void> {
  const release: Release = {
    schema: 1,
    kind,
    repository,
    ...context(),
    packages: [],
    assets: {},
  };
  await checkVersions();
  await Deno.mkdir(`${bundle}/packages`, { recursive: true });
  let packed: PackedPackage[];
  if (kind === "binaries") {
    release.buildRunId = numericId(Deno.env.get("BUILD_RUN_ID")!);
    await assemble();
    packed = JSON.parse(await Deno.readTextFile("dist/packages.json"));
    await command("tar", [
      "-czf",
      "dist/release/LICENSES.tar.gz",
      "-C",
      "dist/release",
      "LICENSES",
    ]);
    await Deno.remove("dist/release/LICENSES", { recursive: true });
    await Deno.rename("dist/release", `${bundle}/assets`);
    for await (const file of Deno.readDir(`${bundle}/assets`)) {
      assert.ok(file.isFile);
      const bytes = await Deno.readFile(`${bundle}/assets/${file.name}`);
      release.assets[file.name] = createHash("sha256").update(bytes).digest(
        "hex",
      );
    }
  } else {
    await command("node", ["scripts/build-npm.mjs"]);
    await Deno.mkdir("dist/packages", { recursive: true });
    packed = JSON.parse(
      await command("npm", [
        "pack",
        "./dist/npm-launcher",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        resolve("dist/packages"),
      ]),
    );
  }
  for (const name of packageNames(kind)) {
    const pkg = packed.find((pkg) => pkg.name === name);
    assert.ok(pkg, `Missing package ${name}`);
    const bytes = await Deno.readFile(`dist/packages/${pkg.filename}`);
    assert.equal(hashes(bytes).integrity, pkg.integrity);
    release.packages.push({
      name,
      version: pkg.version,
      filename: pkg.filename,
      ...hashes(bytes),
      tag: pkg.version.includes("-") ? "build" : "latest",
    });
    await Deno.rename(
      `dist/packages/${pkg.filename}`,
      `${bundle}/packages/${pkg.filename}`,
    );
  }
  await verifyBundle(release);
  await save(release);
  await Deno.copyFile(`${metadata}/release.json`, `${bundle}/release.json`);
}

async function restore(kind: ReleaseKind, restaging: boolean): Promise<void> {
  const current = context();
  const id = numericId(Deno.env.get("STAGING_RUN_ID")!);
  const attempt = numericId(Deno.env.get("STAGING_ATTEMPT")!);
  const release = await releaseMetadata(
    kind,
    id,
    attempt,
    current.commit,
    "dist/source-metadata",
  );
  await command("gh", [
    "run",
    "download",
    id,
    "--repo",
    repository,
    "--name",
    `release-${kind}-${attempt}`,
    "--dir",
    bundle,
  ]);
  const original = await readRelease(`${bundle}/release.json`);
  // Stage IDs/publication status may change after the bundle is saved; bytes cannot.
  const identity = (value: Release) => ({
    ...value,
    packages: value.packages.map((
      { stageId: _stage, published: _published, ...pkg },
    ) => pkg),
  });
  assert.deepEqual(
    identity(original),
    identity(release),
    "Metadata does not describe this saved bundle",
  );
  await verifyBundle(release);
  if (restaging) Object.assign(release, current);
  await save(release);
  if (restaging) {
    await Deno.copyFile(`${metadata}/release.json`, `${bundle}/release.json`);
  }
}

async function stage(): Promise<void> {
  context();
  const release = await readRelease(`${metadata}/release.json`);
  await verifyBundle(release);
  if (Deno.env.get("DRY_RUN") === "true") {
    console.log(
      "Dry run: verified saved packages; no npm staging or publication.",
    );
    return;
  }
  assert.ok(
    Deno.env.get("ACTIONS_ID_TOKEN_REQUEST_URL"),
    "npm staging requires GitHub OIDC",
  );
  await stagePackages(release, {
    lookup: publicVersion,
    stage: (pkg) =>
      command("npm", [
        "stage",
        "publish",
        `${bundle}/packages/${pkg.filename}`,
        "--registry",
        registry,
        "--access",
        "public",
        "--provenance",
        "--ignore-scripts",
        "--tag",
        pkg.tag,
        "--json",
      ]),
    save: () => save(release),
  });
}

async function requirePublic(release: Release): Promise<void> {
  for (const pkg of release.packages) {
    assertPublishedIntegrity(pkg, await publicVersion(pkg));
  }
}

async function finalize(): Promise<void> {
  const current = context();
  const release = await readRelease(`${metadata}/release.json`);
  assert.equal(release.kind, "binaries");
  await verifyBundle(release);
  await requirePublic(release);
  if (Deno.env.get("DRY_RUN") === "true") {
    console.log(
      "Dry run: all npm integrities match; no GitHub Release created.",
    );
    return;
  }
  const version = release.packages[0].version;
  const tag = `binaries-v${version}`;
  const refs = JSON.parse(
    await command("gh", [
      "api",
      `repos/${repository}/git/matching-refs/tags/${tag}`,
    ]),
  );
  let tagObject = refs.find((ref: { ref: string }) =>
    ref.ref === `refs/tags/${tag}`
  )?.object;
  // Existing lightweight or annotated tags must also point at the release commit.
  for (let depth = 0; tagObject?.type === "tag" && depth < 8; depth++) {
    const annotated = JSON.parse(
      await command("gh", [
        "api",
        `repos/${repository}/git/tags/${tagObject.sha}`,
      ]),
    );
    tagObject = annotated.object;
  }
  if (tagObject) {
    assert.equal(
      tagObject.type,
      "commit",
      "Cannot resolve existing release tag",
    );
    assert.equal(
      tagObject.sha,
      current.commit,
      "Existing tag points at a different commit",
    );
  }
  // A missing release is different from a failed API call.
  const pages = JSON.parse(
    await command("gh", [
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/releases?per_page=100`,
    ]),
  );
  let existing = pages.flat().find((item: { tag_name: string }) =>
    item.tag_name === tag
  );
  if (existing) {
    assert.equal(
      existing.target_commitish,
      current.commit,
      "Existing release targets a different commit",
    );
    if (!existing.draft) {
      for (const [name, hash] of Object.entries(release.assets)) {
        assert.ok(
          existing.assets.some((asset: { name: string; digest: string }) =>
            asset.name === name && asset.digest === `sha256:${hash}`
          ),
          `Published release asset differs: ${name}`,
        );
      }
      console.log(`Already finalized: ${existing.html_url}`);
      return;
    }
  } else {
    existing = JSON.parse(
      await command("gh", [
        "api",
        "--method",
        "POST",
        `repos/${repository}/releases`,
        "-f",
        `tag_name=${tag}`,
        "-f",
        `target_commitish=${current.commit}`,
        "-f",
        `name=Bot API ${version} binaries`,
        "-F",
        "draft=true",
        "-F",
        `prerelease=${version.includes("-")}`,
        "-F",
        "generate_release_notes=true",
      ]),
    );
  }
  await command("gh", [
    "release",
    "upload",
    tag,
    ...Object.keys(release.assets).map((name) => `${bundle}/assets/${name}`),
    "--repo",
    repository,
    "--clobber",
  ]);
  await command("gh", [
    "api",
    "--method",
    "PATCH",
    `repos/${repository}/releases/${existing.id}`,
    "-F",
    "draft=false",
  ]);
  console.log(
    `Finalized ${tag} after matching all eight public npm integrities.`,
  );
}

async function summary(): Promise<void> {
  context();
  const release = await readRelease(`${metadata}/release.json`);
  const lines = [
    `## ${release.kind} release`,
    `Commit: \`${release.commit}\``,
    `Build: ${release.buildRunId ?? "launcher only"}`,
    "",
    "| Package | Version | Stage ID / status |",
    "| --- | --- | --- |",
    ...release.packages.map((pkg) =>
      `| ${pkg.name} | ${pkg.version} | ${
        pkg.published
          ? "public, matching integrity"
          : pkg.stageId ?? "not staged / receipt unavailable"
      } |`
    ),
    "",
    `Review locally: \`deno task release review ${release.kind} ${release.runId} ${release.attempt}\``,
    "",
    "The metadata artifact includes tarball SHA-512 and SHA-1 hashes. Staging does not make packages public.",
  ];
  await Deno.writeTextFile(
    Deno.env.get("GITHUB_STEP_SUMMARY")!,
    lines.join("\n") + "\n",
    { append: true },
  );
}

if (import.meta.main) {
  const [action, rawKind] = Deno.args;
  const { commit } = context();
  switch (action) {
    case "preflight":
      await checkVersions();
      await requireCI(commit);
      break;
    case "prepare":
      await prepare(releaseKind(rawKind));
      break;
    case "restore":
      await restore(releaseKind(rawKind), Deno.args[2] === "restage");
      break;
    case "stage":
      await stage();
      break;
    case "verify-public":
      await requirePublic(await readRelease(`${metadata}/release.json`));
      break;
    case "finalize":
      await finalize();
      break;
    case "summary":
      await summary();
      break;
    default:
      throw new Error(`Unknown CI release action: ${action}`);
  }
}

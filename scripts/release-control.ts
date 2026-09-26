import assert from "node:assert/strict";
import { command, interactiveCommand } from "./command.ts";
import { checkReleaseVersions, releaseMetadata } from "./release-github.ts";
import {
  assertPublishedIntegrity,
  matchStage,
  numericId,
  packageNames,
  publicVersion,
  registry,
  releaseKind,
  repository,
  requireApprovalDependencies,
  validateStageId,
} from "./release.ts";

const help = `Metadata-only maintainer commands (no native downloads):
  deno task release stage-binaries BUILD_RUN_ID [--dry-run]
  deno task release retry-binaries STAGING_RUN_ID [ATTEMPT] [--dry-run]
  deno task release finalize-binaries STAGING_RUN_ID [ATTEMPT] [--dry-run]
  deno task release refresh-lockfile [--dry-run]
  deno task release stage-launcher [--dry-run]
  deno task release retry-launcher STAGING_RUN_ID [ATTEMPT] [--dry-run]
  deno task release publish-jsr STAGING_RUN_ID [ATTEMPT] [--dry-run]
  deno task release review binaries|launcher STAGING_RUN_ID [ATTEMPT]
  deno task release approve binaries|launcher STAGING_RUN_ID STAGE_ID [ATTEMPT] [--dry-run]

ATTEMPT defaults to 1. Dry runs never dispatch, stage, approve, or publish.
Run from the repository root at the reviewed release commit. Dispatches require
that commit to be main's current head. Review and approval require npm login;
approval preserves npm's interactive 2FA. Requires Node 24, npm >=11.15, gh, Deno.`;

async function main(): Promise<void> {
  const dryRun = Deno.args.includes("--dry-run");
  const [action, ...args] = Deno.args.filter((arg) => arg !== "--dry-run");
  if (!action || action === "--help") {
    console.log(help);
    return;
  }
  const known = [
    "stage-binaries",
    "retry-binaries",
    "finalize-binaries",
    "refresh-lockfile",
    "stage-launcher",
    "retry-launcher",
    "publish-jsr",
    "review",
    "approve",
  ];
  assert.ok(known.includes(action), help);
  const commit = (await command("git", ["rev-parse", "HEAD"])).trim();
  assert.match(commit, /^[a-f0-9]{40}$/);
  if (action === "review" || action === "approve") {
    const kind = releaseKind(args[0]);
    const id = numericId(args[1]);
    const attempt = numericId(args[action === "approve" ? 3 : 2] ?? "1");
    const directory = await Deno.makeTempDir({
      prefix: "bot-api-release-metadata-",
    });
    try {
      const release = await releaseMetadata(
        kind,
        id,
        attempt,
        commit,
        directory,
      );
      await checkReleaseVersions(release);
      console.log(JSON.stringify(release, null, 2));
      if (action === "review") return;
      const stageId = validateStageId(args[2]);
      const stage = JSON.parse(
        await command("npm", [
          "stage",
          "view",
          stageId,
          "--json",
          "--registry",
          registry,
        ]),
      );
      const pkg = matchStage(release, stage);
      await requireApprovalDependencies(release, pkg);
      if (kind === "launcher") {
        const { version } = JSON.parse(
          await Deno.readTextFile("upstream.json"),
        );
        for (const name of packageNames("binaries")) {
          assert.ok(
            await publicVersion({ name, version }),
            `Missing public binary dependency: ${name}@${version}`,
          );
        }
      }
      const existing = await publicVersion(pkg);
      if (existing) {
        assertPublishedIntegrity(pkg, existing);
        console.log("Already public with matching integrity.");
        return;
      }
      console.log(
        `${
          dryRun ? "Would approve" : "Approving"
        } ${pkg.name}@${pkg.version}, stage ${stageId}, tag ${pkg.tag}`,
      );
      if (!dryRun) {
        await interactiveCommand("npm", [
          "stage",
          "approve",
          stageId,
          "--registry",
          registry,
          "--browser=false",
        ]);
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
    return;
  }
  assert.equal(
    (await command("git", ["status", "--porcelain", "--untracked-files=no"]))
      .trim(),
    "",
    "Commit reviewed changes before dispatching a release",
  );
  const main = JSON.parse(
    await command("gh", ["api", `repos/${repository}/commits/main`]),
  );
  assert.equal(
    main.sha,
    commit,
    "Dispatches require the reviewed checkout to match main's current head",
  );
  let workflow: string;
  let fields: Record<string, string> = {};
  switch (action) {
    case "stage-binaries":
      workflow = "publish-binaries.yml";
      fields = { phase: "stage", build_run_id: numericId(args[0]) };
      break;
    case "retry-binaries":
    case "finalize-binaries":
      workflow = "publish-binaries.yml";
      fields = {
        phase: action === "retry-binaries" ? "stage" : "finalize",
        staging_run_id: numericId(args[0]),
        staging_attempt: numericId(args[1] ?? "1"),
      };
      break;
    case "refresh-lockfile":
      workflow = "refresh-lockfile.yml";
      break;
    case "stage-launcher":
      workflow = "publish-launcher.yml";
      fields = { phase: "stage-npm" };
      break;
    case "retry-launcher":
    case "publish-jsr":
      workflow = "publish-launcher.yml";
      fields = {
        phase: action === "retry-launcher" ? "stage-npm" : "publish-jsr",
        staging_run_id: numericId(args[0]),
        staging_attempt: numericId(args[1] ?? "1"),
      };
      break;
    default:
      throw new Error(help);
  }
  const argv = [
    "workflow",
    "run",
    workflow,
    "--repo",
    repository,
    "--ref",
    "main",
    ...Object.entries(fields).flatMap((
      [key, value],
    ) => ["-f", `${key}=${value}`]),
  ];
  console.log(
    `${dryRun ? "Would dispatch" : "Dispatching"} ${workflow} at ${commit}: ${
      JSON.stringify(fields)
    }`,
  );
  if (!dryRun) {
    console.log(await command("gh", argv));
    console.log(
      `Find the run: gh run list --repo ${repository} --workflow ${workflow} --event workflow_dispatch --limit 5`,
    );
  }
}

if (import.meta.main) await main();

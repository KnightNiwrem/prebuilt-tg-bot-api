# Releasing

## First-time maintainer setup

Use Node 24, npm 11.19.0 (staging requires at least 11.15.0), Deno 2.9.6, and an
authenticated GitHub CLI. Run `npm login` interactively with account 2FA. Normal
releases use short-lived OIDC in CI and interactive npm approval locally. Do not
configure `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or a JSR token in Actions.

1. Provision the nine npm package names under `@deerdaily`: `bot-api-linux-x64`,
   `bot-api-linux-x64-musl`, `bot-api-linux-arm64`, `bot-api-linux-arm64-musl`,
   `bot-api-darwin-x64`, `bot-api-darwin-arm64`, `bot-api-win32-x64`,
   `bot-api-binaries`, and `bot-api`. npm requires an existing package before
   trusted publishing can be configured. This repository has already
   bootstrapped all nine with nonfunctional `0.0.0-bootstrap.0` packages
   containing only metadata, README, and license. **Do not repeat that
   publication or point production dependencies at it.** npm assigned both
   `bootstrap` and `latest` to those initial skeletons; the first approved
   functional versions will replace `latest`.
2. Create GitHub's `release` environment. Allow only branch `main`, require the
   maintainer as reviewer, and disable administrator bypass. A sole maintainer
   needs **Prevent self-review** disabled to approve their own dispatches.
3. For each of the eight platform/meta packages, set an npm GitHub Actions
   trusted publisher with owner `KnightNiwrem`, repository
   `prebuilt-tg-bot-api`, workflow `publish-binaries.yml`, and environment
   `release`. For `@deerdaily/bot-api`, use `publish-launcher.yml` instead.
4. Enable **staged publishing only**, and disable direct publishing on every
   trusted publisher. The CLI equivalent is:

   ```sh
   npm trust github <package> --repository KnightNiwrem/prebuilt-tg-bot-api --file <workflow.yml> --environment release --allow-stage-publish
   npm trust list <package> --json
   ```

   The only permission should be `createStagedPackage`. Remove any other
   publisher allowing `createPackage`. Set each package to **Require two-factor
   authentication and disallow tokens** in npm's web settings; `npm trust list`
   does not verify that separate setting. Revoke obsolete automation tokens and
   remove their secret references.
5. Create JSR `@deerdaily/bot-api`, link it to this repository, require
   publishing from CI, and retain the scope requirement that the triggering
   GitHub actor be a scope member. JSR trusts the linked repository, not a
   particular workflow or environment. Review changes to workflows and release
   scripts accordingly.
6. Merge the reviewed release tooling into `main`. Run ordinary CI and the
   native build/smoke matrix for that exact commit, then follow the binary
   staging steps below. Setup does not itself publish functional versions.

As checked on 2026-09-26, all nine npm trusted publishers have the intended
workflow/environment and only `createStagedPackage`. The GitHub environment has
the intended restrictions, and JSR's public API confirms the repository link.
The maintainer reports completing npm's separate 2FA setting and JSR's scope
restrictions; those settings were not independently exposed by the read-only
checks used here.

No publishing credentials are needed for ordinary CI or native builds. Smoke
tests use a temporary loopback registry. Ordinary CI also validates JSR against
JavaScript dependency fixtures; these checks work before functional packages are
public. They do not replace native smoke tests or the public lockfile check.
Optional `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` secrets add credentialed
`getMe` coverage; the basic HTTP smoke test always runs. Allow Actions to create
PRs for the upstream watcher.

References: [npm staged publishing](https://docs.npmjs.com/staged-publishing/),
[npm trusted publishers](https://docs.npmjs.com/trusted-publishers/),
[JSR scope security](https://jsr.io/docs/scopes).

## Two version streams

`upstream.json` records the source commit, optional tag, and native package
version. All seven platform packages and the meta-package use the same exact
version. A rebuild of the same upstream version uses `-build.N`; never overwrite
a published version. The launcher is versioned separately in
`packages/launcher/deno.json` and published to JSR and npm at the same launcher
version. A launcher-only fix must leave `src/binary.ts`'s binary pin unchanged.

For a new upstream release, the scheduled watcher opens a PR. It prefers numeric
upstream tags. Upstream has no tags at bootstrap, so the documented fallback is
the immutable commit updating `project(TelegramBotApi VERSION ...)`. The watcher
does not silently rebuild the same release after unrelated master commits.

To perform a manual upstream bump or rebuild:

```sh
deno run --allow-read --allow-write scripts/bump-upstream.ts <40-character-sha> <x.y.z-or-x.y.z-build.N> [upstream-tag]
deno fmt
deno task verify
```

The script updates manifests, the static import, the development import map, and
the launcher's patch version. Review the patch version before publishing. Native
versions never contain the platform name.

## Build, stage, and approve binaries

The local `deno task release` commands use `deno.local.json` and only retrieve
metadata. They never install the launcher's native dependencies or download
package tarballs. `deno task release --help` lists the commands. Add `--dry-run`
to preview a dispatch or validate an approval without performing it.

Keep `main` at the same release commit until staging, npm approvals, and GitHub
Release finalization finish. Release jobs are restricted to `main`, and saved
artifacts must match its exact SHA. The launcher can use a later commit after
the public lockfile is added.

1. Merge reviewed changes into `main`, check out that commit locally, and
   require successful ordinary CI. Dispatch `build-binaries.yml` on `main` and
   wait for all native builds and smoke jobs to pass:

   ```sh
   gh workflow run build-binaries.yml --ref main
   gh run list --workflow build-binaries.yml --limit 5
   gh run watch <build-run-id> --exit-status
   ```

   Builds produce five native artifacts supplying seven platform packages.
   Native builds, downloads, packaging, and Deno compilation stay in CI.
2. Preview, then dispatch staging with the successful build run ID:

   ```sh
   deno task release stage-binaries <build-run-id> --dry-run
   deno task release stage-binaries <build-run-id>
   ```

   Approve the `release` environment job in GitHub. CI verifies the source
   repository, workflow, successful non-PR run, and exact commit. It downloads
   the native artifacts, assembles packages, and saves the exact tarballs and
   release assets **before** calling `npm stage publish` with OIDC/provenance.
   No npm package becomes public at this point.
3. Find the staging run and review its summary and small manifest:

   ```sh
   gh run list --workflow publish-binaries.yml --limit 5
   gh run watch <staging-run-id> --exit-status
   deno task release review binaries <staging-run-id>
   ```

   The manifest records the commit, build run, versions, tags, stage IDs, and
   tarball SHA-512/SHA-1 hashes. Metadata is saved even after partial staging.
4. For each of the **seven platform packages first**, inspect and approve its
   explicitly selected stage ID:

   ```sh
   npm stage view <stage-id>
   deno task release approve binaries <staging-run-id> <stage-id> --dry-run
   deno task release approve binaries <staging-run-id> <stage-id>
   ```

   npm handles browser/OTP 2FA in your terminal. The task checks the stage's
   package name, version, tag, and checksum against the saved manifest. It uses
   the recorded stage ID when available. It never calls `npm stage download`.
   Approval promotes the payload npm already holds.
5. Repeat approval for `@deerdaily/bot-api-binaries` **last**. The task refuses
   until all seven exact platform versions are public with matching integrity.
   Registry propagation can lag; wait and retry a metadata check if necessary.
6. Dispatch finalization and approve its GitHub environment job:

   ```sh
   deno task release finalize-binaries <staging-run-id>
   ```

   CI restores the exact saved bundle, verifies all eight public npm
   integrities, and creates `binaries-v<version>` at the original commit. The
   GitHub Release includes raw servers, `SHA256SUMS`, and `LICENSES.tar.gz`. It
   stays a draft until asset uploads finish. A staging run never creates a final
   release.

For a rehearsal in CI, manually dispatch the workflow with `dry_run=true` and
`expected_sha` set to the reviewed full commit SHA. All release/lockfile
dispatches carry this SHA; jobs reject a run whose recorded commit differs from
it. This catches `main` moving between local preflight and dispatch. Later
changes to `main` do not change or cancel an already dispatched run. The local
task supplies the SHA automatically. A rehearsal prepares/checks packages
remotely but never stages, approves, or publishes. Local `--dry-run` does not
dispatch even that rehearsal.

### Recovery and retention

Release bundles are retained for 30 days, metadata for 90 days, subject to
GitHub's repository limits. Native build artifacts currently last 14 days.
Finish the release while the exact bundle is available; inspect/archive it
remotely if a longer delay is needed. Do not rebuild occupied versions.

After a partial staging failure, use the saved run and attempt:

```sh
deno task release retry-binaries <staging-run-id> [attempt]
```

This downloads the prior bundle **in CI** and preserves its bytes and known
stage IDs. It skips already-public versions only when their integrity matches.
Use the new retry run's metadata for subsequent approvals/finalization. Do not
use GitHub's generic rerun button for staging: use the retry command. Artifact
names contain the run attempt; CLI commands default to attempt `1`.

If npm accepted a stage but its receipt was lost, CI cannot list stages using
OIDC. Run `npm stage list <package>` locally and inspect the candidate with
`npm stage view <id>`. The approval task accepts a recovered ID only if its
identity and checksum match the saved manifest. Approve it, then retry the
remaining staging. An occupied version with different bytes requires a new
version, not an overwrite or automatic rejection of another stage. If no saved
metadata/bundle survived, stop and recover the original CI artifacts before
continuing; do not guess which payload to approve.

If finalization fails after npm approval, dispatch `finalize-binaries` again
against the same staging run/attempt. It resumes draft asset uploads; an already
public GitHub Release must have matching asset digests. Missing/expired
artifacts or a different commit are errors, not permission to rebuild under that
version.

When all five native jobs passed but packaging/smoke code needed changes, reuse
the prior CI artifacts:

```sh
gh workflow run build-binaries.yml --ref main -f native_run_id=<previous-build-run-id>
```

The reuse verifier checks the source pin, native scripts, job recipe,
repository, and successful native jobs, then repeats packaging and smoke tests
on the new commit. Changed native inputs require a fresh build.

## Publish the launcher

1. After the pinned binary packages are public and the GitHub Release is
   finalized, refresh the real public lockfile **in CI**:

   ```sh
   deno task release refresh-lockfile
   gh run list --workflow refresh-lockfile.yml --limit 5
   gh run watch <lockfile-run-id> --exit-status
   gh run download <lockfile-run-id> --name public-lockfile-<attempt> --dir /tmp/bot-api-public-lockfile
   ```

   Use the successful run attempt (normally `1`) in the artifact name. Review
   `commit.txt`, `deno.lock.diff`, and `deno.lock` in that small artifact.
   Ensure the commit and exact binary pins match your checkout, copy the
   reviewed lockfile into the repository, and commit it through the usual PR
   process. Do not resolve public native dependencies on the local machine.
   Never invent integrity values or commit a loopback registry lockfile.
2. Merge the lockfile and reviewed launcher version into `main`, check out that
   commit, and wait for ordinary CI. Keep `main` at this commit until both
   registry publications finish:

   ```sh
   deno task release stage-launcher --dry-run
   deno task release stage-launcher
   ```

   Approve the GitHub environment job. CI verifies the committed public lockfile
   with `deno check --frozen`, dry-runs JSR packaging, generates/archives the
   Node launcher, and stages npm through OIDC. TypeScript conversion never
   rebuilds the server. This phase does **not** publish JSR.
3. Review and approve the npm launcher:

   ```sh
   deno task release review launcher <launcher-staging-run-id>
   deno task release approve launcher <launcher-staging-run-id> <stage-id>
   ```

4. Dispatch JSR separately and approve the GitHub environment job:

   ```sh
   deno task release publish-jsr <launcher-staging-run-id>
   ```

   The job restores the saved launcher identity and requires its exact npm
   integrity to be public before `deno publish` uses GitHub OIDC. This is the
   explicit JSR publication gate; JSR has no npm-style staging/approval step.
5. Verify the exact versions on both registries. Remove pending-publication
   notes only after the functional packages are available. Optionally deprecate
   only the old `0.0.0-bootstrap.0` skeletons after real releases are live.

Use `retry-launcher <staging-run-id> [attempt]` to resume npm staging with the
saved tarball. Retry only `publish-jsr` if npm approval succeeded but JSR
failed, using the same commit. If JSR already published that version
successfully, do not republish or change its source. A launcher-only fix reuses
the pinned public binary version and needs no native build.

## Build environment and verification

Linux uses native x64/arm64 runners and Alpine 3.22 with static OpenSSL, zlib,
musl, and compiler runtimes. The same strategy serves glibc and musl host
packages. macOS targets 15+ on native Intel/Apple Silicon macOS 15 runners, with
static OpenSSL (pinned source release, system CA paths) and Homebrew zlib,
system libraries, and ad-hoc code signing. The build rejects linker warnings
about dependencies built for a newer macOS than the deployment target.
Supporting an older macOS requires rebuilding compatible dependencies and
testing on that OS, not just lowering the deployment flag. Windows uses MSVC and
vcpkg static dependencies. The upstream source and submodule commits are pinned.
Runner images, distribution package revisions, Homebrew, and the runner's vcpkg
baseline can evolve; these are repeatable CI recipes, not a claim of
byte-for-byte reproducibility. Save build logs, package versions, and artifacts
with each release. Use a rebuild version if those environments change the
shipped bytes.

Smoke tests require exit code zero and upstream help text on its original output
stream (upstream's logging may write help to stderr). The HTTP smoke always
verifies the server's expected JSON 404 response, then checks that shutdown
releases its listener. Port collisions retry with a fresh port. With credentials
it also requests the dummy getMe endpoint. No live Telegram credentials are
required for normal CI.

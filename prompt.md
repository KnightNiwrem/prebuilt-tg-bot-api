# Task: Ship `tdlib/telegram-bot-api` as a zero-install Deno/Node launcher

## Background (read first — you have no other context)

Telegram publishes an official, self-hostable **Bot API server**: https://github.com/tdlib/telegram-bot-api. It is a C++ program built on top of TDLib. Running your own instance is useful for bot developers (local testing, larger file limits, webhook to localhost, etc.). Upstream distributes it **only as source code and a Docker image** — there are no prebuilt release binaries — so getting it running means installing a C++ toolchain, CMake, gperf, OpenSSL/zlib headers, and compiling for a long time.

We want to remove that friction for the JavaScript/TypeScript ecosystem. The end state is that a developer with nothing but Deno installed can type one command and have the official server running:

```
deno -N -R -W --allow-run --allow-env jsr:@deerdaily/bot-api --api-id ... --api-hash ... --local
```

The same package must also work from Node (`npx`), and must be compilable into a single self-contained executable per platform with `deno compile`.

We considered compiling the server to WebAssembly (which would run inside Deno's sandbox) and **rejected it** because the server's inbound HTTP listener, outbound webhook delivery, and multi-threaded scheduler don't map onto Emscripten's socket/threading model without forking the server. Instead we distribute **prebuilt native binaries** built in CI, plus a **thin launcher** that selects, resolves, and spawns the right one. This is the same pattern esbuild, SWC, Rollup, Biome, and Turbo use. The trade-off is that the spawned server process runs outside Deno's permission sandbox; we accept that and document it honestly.

## Starting point

This repository already contains the launcher, binary package manifests, build scripts, documentation, and GitHub Actions workflows. Inspect and extend the existing implementation rather than recreating the project. The GitHub repository is `KnightNiwrem/prebuilt-tg-bot-api`, with default branch `main`. The intended npm and JSR scopes are both `@deerdaily`; account ownership and scope permissions must be configured by the maintainer.

**Publishing decision:** releases require explicit maintainer approval, use no long-lived npm/JSR credentials in CI, and require no native binary downloads onto the maintainer's local machine. Native builds and artifact handling stay in GitHub Actions. CI authenticates to npm with OIDC and may **stage packages only**; the maintainer makes them public using local `npm stage approve` with 2FA. JSR publication uses GitHub Actions OIDC in a manually dispatched workflow job gated by a protected `release` environment. Local tasks may dispatch workflows, inspect release metadata, and approve npm stages; they must not download binary tarballs. This supersedes the earlier plan to upload packages from the local CLI.

Setup snapshot (2026-09-26): all nine nonfunctional npm skeletons exist at `0.0.0-bootstrap.0`; public metadata now resolves and reports integrities, with both `bootstrap` and initially auto-assigned `latest` tags. Do not repeat bootstrap publication. All nine npm trusted publishers were verified to have only `createStagedPackage`, the correct binary/launcher workflow, repository, and `release` environment. GitHub's environment was verified to require the maintainer reviewer, restrict deployments to branch `main`, and disallow administrator bypass (self-review remains allowed for the sole maintainer). JSR's public API confirms `@deerdaily/bot-api` is linked to this repository. The maintainer reports completing npm's separate 2FA/disallow-tokens package settings and JSR's scope security settings; those private settings were not independently verifiable through the read-only APIs used. Workflow migration and `deno task release` now implement staging, metadata-only approval, finalization, remote lockfile refresh, and separately gated JSR publication. Merge reviewed changes to `main` and validate there before the first functional release; setup alone does not authorize real publication.

## Architecture (decided — do not re-litigate)

### Three layers

1. **Native binaries on npm, one package per platform.** Platform goes in the **package name**, never in the version:

   | Package | `os` | `cpu` | `libc` |
   |---|---|---|---|
   | `@deerdaily/bot-api-linux-x64` | `["linux"]` | `["x64"]` | `["glibc"]` |
   | `@deerdaily/bot-api-linux-x64-musl` | `["linux"]` | `["x64"]` | `["musl"]` |
   | `@deerdaily/bot-api-linux-arm64` | `["linux"]` | `["arm64"]` | `["glibc"]` |
   | `@deerdaily/bot-api-linux-arm64-musl` | `["linux"]` | `["arm64"]` | `["musl"]` |
   | `@deerdaily/bot-api-darwin-x64` | `["darwin"]` | `["x64"]` | — |
   | `@deerdaily/bot-api-darwin-arm64` | `["darwin"]` | `["arm64"]` | — |
   | `@deerdaily/bot-api-win32-x64` | `["win32"]` | `["x64"]` | — |

   Each contains only the executable (`bin/telegram-bot-api` or `bin/telegram-bot-api.exe`), a `package.json` carrying the `os`/`cpu`/`libc` fields above, and a tiny `index.js` + `index.d.ts` that exports the absolute path to the binary.

2. **A meta-package on npm**, `@deerdaily/bot-api-binaries`, whose `package.json` lists every platform package under `optionalDependencies` at the **exact same version** as itself. It exports a function that returns the resolved binary path for the current platform: detect os/arch/libc at runtime, resolve the matching package (`import.meta.resolve` / `createRequire(...).resolve`), and throw a clear error naming the unsupported target if none is installed.

3. **The launcher on JSR**, `@deerdaily/bot-api`. TypeScript, runs on Deno and Node. It **statically imports** `npm:@deerdaily/bot-api-binaries@<EXACT_VERSION>` where the version is a **constant baked into the source** — never `latest`, never a semver range, never fetched at runtime. Responsibilities:
   - Resolve the binary path via the meta-package.
   - Spawn it with the launcher's CLI arguments passed through **verbatim** (`Deno.args` / `process.argv.slice(2)`), `stdio: "inherit"`, environment inherited. The launcher never parses, rewrites, validates, or documents the server's flags — upstream's docs remain the docs.
   - Forward SIGINT/SIGTERM to the child and exit with the child's exit code. On Windows, terminate the child on shutdown by whatever means works (signals are unreliable there).
   - Escape hatch: if `TELEGRAM_BOT_API_BINARY` is set, use that path and skip resolution entirely (air-gapped / custom-build users).
   - A **separate module** exposes a small programmatic API — `startBotApiServer({ apiId, apiHash, port, local, dir, ... })` returning `{ ready(): Promise<void>; stop(): Promise<void>; pid }` — that reuses the same spawn logic. `ready()` polls the HTTP port until it accepts connections; `stop()` sends SIGTERM, waits, then SIGKILLs. Keep the CLI entrypoint pure passthrough; only the API module builds flags from options.

### Versioning rules

- Platform packages and the meta-package share one version that **tracks upstream** `telegram-bot-api` (e.g. `9.2.0`). They bump **only** for an upstream release, identified by its tag or the existing pinned-commit fallback when tags are unavailable. If the same upstream version must be rebuilt (build-flag fix), publish `9.2.0-build.2`; prerelease ordering doesn't matter because the launcher pins exactly.
- The JSR launcher versions **independently** (`0.1.0`, `0.1.1`, …). Launcher-only fixes must **not** change the pinned binary version, so users upgrading the launcher download nothing new.
- Deduplication of the large binaries is handled entirely by Deno's (and npm's) global package cache, which stores one copy per exact `name@version`. **Do not write a custom downloader, cache directory, or checksum logic in the launcher.**
- Keep the npm import statically analyzable so it is recorded in `deno.lock`, integrity-checked, and embedded by `deno compile`.

### Why these choices (so you don't undo them)

- JSR does not host raw binary assets → binaries live on npm; only TypeScript lives on JSR.
- Platform in the *name* (not the version) is required for `optionalDependencies` selection, keeps semver meaningful, keeps lockfiles correct, and matches ecosystem convention.
- Spawning a native binary forfeits Deno's sandbox for the server process. Accepted. Document the real permission set (`--allow-run` is unavoidable).

## Repository layout to maintain

```
deno.json                      # workspace root, including release dispatch/review/approval tasks
packages/
  launcher/                    # JSR: @deerdaily/bot-api
    deno.json
    mod.ts                     # programmatic API export
    cli.ts                     # passthrough CLI entrypoint (bin)
    src/...
    *_test.ts
  binaries/
    meta/                      # npm: @deerdaily/bot-api-binaries
      package.json
      index.js  index.d.ts
    linux-x64/ linux-x64-musl/ linux-arm64/ linux-arm64-musl/
    darwin-x64/ darwin-arm64/ win32-x64/
      package.json  index.js  index.d.ts   # bin/ uses CI artifacts, never committed
scripts/                       # build, assembly, checksums, staging, local release approval
.github/workflows/
  build-binaries.yml           # matrix build of upstream at a pinned commit
  smoke.yml                    # validate CI artifacts and compile standalone launchers
  publish-binaries.yml         # OIDC npm staging; separate post-approval release finalization
  publish-launcher.yml         # explicit stage-npm / publish-jsr phases, each manually dispatched
  refresh-lockfile.yml         # resolve public dependencies in CI; return a small lockfile diff
  ci.yml                       # lint, fmt, type-check, launcher unit tests
  upstream-watch.yml           # detect new upstream tag, open bump PR
docs/adr/0001-prebuilt-binaries.md
README.md  RELEASING.md
```

Adjust names if you have a strong reason, but keep the three-layer separation.

## Build and stage in CI; approve releases manually

### CI responsibilities

- `build-binaries.yml` builds `telegram-bot-api` from a **pinned upstream commit**, recording the release tag when available, for every target in the table. Prefer **fully static** builds (musl-static on Linux; static OpenSSL and zlib everywhere) so binaries have zero runtime dependencies. Use native arm64 runners where available; otherwise cross-compile (zig/clang or `cross`) — pick whichever makes the matrix simplest and most reliable.
- macOS: ad-hoc `codesign` the binaries in CI and verify the signature. Ad-hoc signing does not clear Gatekeeper quarantine on downloaded files; document `xattr -d com.apple.quarantine` for trusted downloads.
- Windows: verify upstream actually builds on windows-latest. If it doesn't within reasonable effort, drop `win32-x64` from the matrix and make the launcher error clearly on Windows rather than shipping something broken. Record the decision in the ADR.
- Keep `ci.yml` for formatting, linting, type checks, tests, version consistency, and JSR package validation against unpublished dependency fixtures. Keep `build-binaries.yml` and `smoke.yml` for native builds, all-platform smoke tests, and standalone launcher compilation. These workflows already validate packages using temporary local registries and do not need public npm/JSR publication or publishing credentials.
- After the matrix succeeds, retain downloadable native artifacts and standalone launchers. The current build produces five native artifacts; each static Linux binary supplies both the glibc and musl package for its CPU. Smoke jobs already assemble and test the seven platform packages. Native build artifacts currently expire after 14 days; document the download window and preserve the exact artifacts used for a release.
- `upstream-watch.yml` continues to detect upstream updates and open bump PRs. It never publishes packages. Keep its existing pinned-commit fallback where upstream tags are unavailable, and update its PR instructions to describe staging and maintainer approval.
- Ordinary build/test jobs need no registry publishing credentials or OIDC permissions. Grant `id-token: write` only to the jobs that stage npm packages or publish JSR. Preserve GitHub permissions needed for artifact access and upstream PR creation, and optional Telegram credentials for deeper smoke tests. Do not store or pass `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or a JSR personal access token to release jobs.

### One-time account and registry setup

- Use Node 24 and an explicitly selected npm version supporting staging (npm >= 11.15.0) in CI and the maintainer's CLI. The maintainer needs npm publish access to all nine packages and account 2FA. Verify the CLI's actual stage commands/output before implementing wrappers.
- npm requires a package to already exist before configuring its trusted publisher or staging versions. The maintainer explicitly chooses **metadata-only skeleton packages** for this one-time bootstrap, avoiding native downloads even on this trusted remote development machine. Create isolated temporary directories for all nine npm names with version `0.0.0-bootstrap.0`, the correct repository/license metadata, and a README/description clearly stating that this is a nonfunctional bootstrap prerelease. Include no server binaries, dependencies, optional dependencies, executable entrypoints, or lifecycle scripts. Do not edit production versions or dependency pins to point at these skeletons.
- The maintainer inspects each skeleton with `npm pack --dry-run --ignore-scripts`, authenticates interactively with `npm login` and 2FA, and publishes using `npm publish --access public --tag bootstrap --ignore-scripts --provenance=false` from the isolated package directory. This is the sole metadata-only direct-publication bootstrap exception; normal releases use OIDC staging. Do not publish any package merely because preparation/dry-run validation succeeded.
- Check `npm view <package> dist-tags --json` after first publication. A prerelease version and custom tag are not a privacy guarantee: npm has reported assigning `latest` on initial publication even with a custom tag. Do not promise that default installs cannot reach the skeleton or that the `latest` tag can be removed. Keep prerelease/README labeling explicit, then approve the first functional releases with the intended `latest` tag and optionally deprecate only `0.0.0-bootstrap.0` after they are live. Leave the bootstrap version immutable; do not attempt to overwrite it or substitute it for any exact production dependency. See the [npm maintainer report about initial tags](https://github.com/npm/cli/issues/8490).
- Create the GitHub `release` environment, restrict deployment branches to `main`, require the maintainer as a reviewer, and disallow administrator bypass. For a sole maintainer who dispatches and approves their own releases, leave **Prevent self-review** disabled; otherwise that maintainer cannot approve the job. Configure these settings in GitHub: a YAML `environment: release` declaration alone does not establish protection rules.
- For each of the eight binary/meta npm packages, configure a GitHub Actions trusted publisher for owner `KnightNiwrem`, repository `prebuilt-tg-bot-api`, workflow filename `publish-binaries.yml`, and environment `release`. For npm `@deerdaily/bot-api`, use `publish-launcher.yml` with the same repository/environment. Enter the filename only, not `.github/workflows/...`.
- The equivalent CLI setup is `npm trust github <package> --repository KnightNiwrem/prebuilt-tg-bot-api --file <workflow-filename> --environment release --allow-stage-publish`. Do not pass `--allow-publish`. These flags and the stage subcommands were checked against the installed npm 11.19.0 CLI; recheck on version changes.
- Allow **`npm stage publish` only** for each trusted publisher; do not allow direct `npm publish`. Audit/remove any other trusted-publisher connection that still permits direct publishing. Enable npm's **Require two-factor authentication and disallow tokens** package setting. Revoke obsolete automation tokens and remove their GitHub secret references. The registry must enforce the staging-only permission; merely changing a workflow command is insufficient.
- Create JSR `@deerdaily/bot-api`, link it to `KnightNiwrem/prebuilt-tg-bot-api`, retain the scope setting requiring the triggering GitHub actor to be a scope member, and require publishing from CI. Use `deno publish` with GitHub OIDC and no stored JSR token. JSR's linked-repository trust is broader than npm's workflow/environment binding, so protect changes to workflows and release scripts. The GitHub environment approval is a job gate, not a JSR registry staging feature.

### Binary release: stage remotely, approve locally

1. Commit and push the reviewed version changes. Require successful ordinary CI and a successful `build-binaries.yml` run, including its smoke tests, for the release commit.
2. Manually dispatch the staging phase of `publish-binaries.yml` with that build run ID and approve its `release` environment job. Preserve the existing repository/workflow/success/non-PR/exact-commit checks in `scripts/verify-build-run.ts`. Reject dispatches from an unapproved branch or a mismatching commit.
3. The runner downloads only that run's `native-*` artifacts into a fresh staging directory. Fail if artifacts are missing or expired; never substitute arbitrary binaries. Assemble the platform packages and meta-package from those artifacts and the matching checkout, preserve executable permissions, include license notices, generate `SHA256SUMS`, and pack the npm tarballs. Save the exact release tarballs and metadata in CI for retries; none need to pass through the maintainer's local machine.
4. Adapt `scripts/publish-binaries.ts` to use `npm stage publish` with OIDC and public access instead of `npm publish`. Preserve version/integrity checks and the `build` dist-tag for prerelease rebuild versions. Stage all seven platform packages and the meta-package without making them public. Preserve supported npm provenance generation; do not replace OIDC with a token fallback.
5. Report package names, exact versions, stage IDs, tarball integrities, commit SHA, and source build run in a small release manifest/job summary. Local tooling may retrieve this metadata and use `npm stage list`/`npm stage view` with the maintainer's interactive authentication. OIDC staging credentials cannot list or approve stages. A retry must distinguish already-public versions, pending stages, and unstaged packages; never blindly restage an occupied version or change its bytes. If pending stages must be reconciled locally, make that explicit and retain their IDs.
6. The maintainer reviews the release identity and uses `npm stage approve <stage-id>` with 2FA for each of the seven platforms, then the meta-package. A local task may guide this sequence but must preserve the maintainer's explicit selection and npm's 2FA. Do not call `npm stage download` as part of normal approval. Stage approval promotes the package already stored by npm; it does not upload a local tarball.
7. A separately dispatched finalization phase verifies that all eight expected npm versions are public with the exact expected integrities before creating the GitHub Release. Attach the same CI-built binaries, `SHA256SUMS`, and license bundle under `binaries-v<version>` at the original build commit. Staging alone must not create a final release or mark publication complete. Keep GitHub write permissions confined to the finalization job.

### Launcher release: refresh the lockfile remotely, stage npm, approve JSR

1. Approve the pinned binary packages first when adopting a new binary version. Resolve the public npm dependencies into `deno.lock` **in CI**, then provide a small lockfile artifact/diff for the maintainer to review and commit. A dedicated `refresh-lockfile.yml` can do this without registry write permissions. Get ordinary CI passing on the resulting launcher release commit. Never commit a temporary test-registry lockfile. Do not require the maintainer to run public dependency resolution locally: that can download native npm packages even though the launcher source itself is small.
2. Manually dispatch the `stage-npm` phase of `publish-launcher.yml` on the reviewed commit. In the runner, perform the existing verification/version checks, `deno check --frozen packages/launcher/cli.ts packages/launcher/mod.ts`, and `deno publish --dry-run` against public dependencies. Generate the Node launcher with `scripts/build-npm.mjs`, inspect/pack its contents, and stage it through npm OIDC. Report its stage ID and release identity like the binary packages.
3. Approve the npm launcher locally using `npm stage approve <stage-id>` with 2FA. Then dispatch the separate `publish-jsr` phase for the same source commit and approve the protected `release` environment job. Require the matching npm launcher version/integrity to be public before publishing JSR. Use `deno publish` with GitHub OIDC; retain independent retry support for a partial release without changing source under an existing version. This separation prevents a single staging dispatch from publishing JSR before npm approval.
4. A launcher-only fix reuses the existing exact binary version and needs no native rebuild. The launcher release commit can differ from the earlier binary release commit, including because the public lockfile is committed after binary publication.

### Local task scope, validation, and documentation

- Provide documented Deno tasks for dispatching the binary staging workflow, viewing a release's small metadata manifest, approving selected npm stages, refreshing the lockfile in CI, and dispatching the launcher phases. Choose names explicitly and label proposed commands as unavailable until implemented. Local task dependencies must not import the launcher's production npm dependency graph or implicitly download binaries.
- Include a dry-run mode that performs only metadata checks/previews locally; run any preparation that needs native artifacts remotely. Dry runs must not stage, approve, publish, or create a GitHub Release.
- Update `RELEASING.md` and other maintainer docs with the bootstrap, exact account settings, environment approval, staging/approval order, artifact retention, lockfile refresh, independent retries, and post-publication verification. Treat npm/JSR/GitHub account changes and real publication as maintainer actions; dry-run validation does not imply permission to publish.
- OIDC replaces reusable registry secrets with short-lived workflow credentials; it does not make a compromised runner or malicious workflow safe. Preserve source/build identity checks, review release metadata, restrict trusted publishers, pin third-party Actions to reviewed immutable commits, and protect workflow/release-script changes. Do not claim that an environment gate alone prevents another JSR-authorized workflow from publishing.
- Verify behavior against the current [npm staged publishing documentation](https://docs.npmjs.com/staged-publishing/), [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/), [JSR publishing documentation](https://jsr.io/docs/publishing-packages), and [JSR scope security settings](https://jsr.io/docs/scopes).

## HARD RULE: no local builds — CI only

**You must not build `telegram-bot-api`, TDLib, OpenSSL, zlib, or any native artefact on this machine**, and you must not install a C++ toolchain, CMake, gperf, Emscripten, or similar for that purpose. Native builds happen **only** in GitHub Actions. Reasons: this environment does not represent any target platform, the builds take a very long time, and every shipped artefact must be reproducible from CI alone.

Your loop is:

1. Write or modify workflow YAML, scripts, and package files.
2. Commit and push to a branch (or open a PR).
3. Observe the result with the GitHub CLI:
   - `gh run list --workflow <file> --limit 5`
   - `gh run watch <run-id> --exit-status` — blocks until completion; prefer this over polling
   - `gh run view <run-id> --log-failed` — read only the failing steps
   - `gh run download <run-id> --name <metadata-artifact>` — download only small manifests, reports, or lockfile diffs locally; inspect native artifacts in CI
4. Fix and repeat.

You **may** run locally: `deno fmt`, lint/type checks/tests using `deno.local.json` and JavaScript fixtures, launcher unit tests (mock the server with a trivial script that echoes its args or opens a port), TypeScript-to-JavaScript conversion, package-content checks that need no native payload, preparation/dry-run packing of the metadata-only bootstrap skeletons, and metadata-only release dispatch/review/approval tasks. The maintainer performs the explicit one-time skeleton publications described above. Public dependency resolution, native artifact downloads/assembly/packing, and real-dependency `deno publish --dry-run` happen in CI. Anything that compiles a native binary, including `deno compile`, is CI-only, no exceptions. If you believe a local native build or native binary download is necessary, **stop and ask** instead of doing it.

## Verification required before declaring done

- Confirmed for Deno 2.9.6/2.9.7: npm optional dependencies are filtered by OS/CPU but not `libc`; runtime libc detection and the possible extra Linux package download are documented and implemented. Recheck this finding when upgrading Deno rather than reimplementing detection.
- Confirm in CI (one job per target, not locally) that `deno compile --target <triple>` embeds the correct platform package and the resulting executable starts the server.
- Per-platform smoke-test job: run the launcher with `--help` (or `--version`), assert exit code and that stdout is upstream's help text. Where API credentials are available as secrets, a deeper job starts the server with `--local`, requests `GET http://127.0.0.1:<port>/bot000:placeholder/getMe`, and asserts a response arrives (an HTTP 401/404 from the server counts as success — it proves the process is up and serving).

## Deliverables

- The repository layout above, with `ci.yml` green and at least one successful end-to-end `build-binaries.yml` run.
- `README.md` for end users: the one-liner, the required permissions and *why* each is needed, `deno compile` instructions, the env override, supported platforms, upgrade semantics (launcher vs binary versions).
- OIDC-only npm staging workflows, local metadata-only review/approval tasks, a separately approved JSR publishing phase, remote public-lockfile refresh, and post-approval GitHub Release finalization. No reusable registry credentials in CI or required local binary downloads.
- `RELEASING.md`: the two independent version streams, upstream-bump flow, step-by-step account/environment setup, one-time metadata-only skeleton bootstrap, registry-enforced staging permissions, local 2FA approval, CI artifact verification/retention, public lockfile refresh, and recovery from partial releases. Update other maintainer docs to match.
- `docs/adr/0001-prebuilt-binaries.md`: the wasm-vs-prebuilt decision, the sandboxing trade-off, platform-in-name and pinned-version rationale, and any platform you dropped.

## Working style

- Small, reviewable commits with clear messages. Push early; let CI tell you what's wrong.
- When something is ambiguous (Windows support, default libc assumption, runner choice), pick the conservative option, note it in the ADR or README, and flag it in your summary rather than blocking.
- Report progress in terms of CI runs: link the run, state what passed/failed, and what you changed in response.

# Releasing

## First-time maintainer setup

The maintainer creates registry namespaces and package entries. Automation does
not create them. Provision the npm `@deerdaily` scope with access for these nine
packages:

- `bot-api-linux-x64`, `bot-api-linux-x64-musl`
- `bot-api-linux-arm64`, `bot-api-linux-arm64-musl`
- `bot-api-darwin-x64`, `bot-api-darwin-arm64`, `bot-api-win32-x64`
- `bot-api-binaries`, `bot-api`

Create JSR `@deerdaily/bot-api` and link it to this GitHub repository for OIDC
publication. Configure npm trusted publishing for the appropriate workflow, or
provide `NPM_TOKEN` with publish access. The workflows request OIDC for npm
provenance. Configure the GitHub `release` environment as desired. Optional
`TELEGRAM_API_ID` and `TELEGRAM_API_HASH` secrets enable the HTTP smoke test.
The repository must allow Actions to create pull requests for the upstream
watcher.

No registry credentials are needed to run CI or build the native artifacts.
Smoke tests serve freshly packed npm tarballs through a temporary loopback
registry. This exercises the real npm resolver and optional dependencies without
occupying public version numbers. Test-registry lockfiles stay under ignored
`dist/`.

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

## Build and publish binaries

1. Commit and push the reviewed changes. Run `build-binaries.yml` on that
   commit. It builds all seven targets, then runs Node/Deno smoke tests and five
   supported Deno compilation targets. Musl packages additionally run under
   Alpine/Node.
2. Observe with `gh run watch <run-id> --exit-status`; inspect failures with
   `gh run view <run-id> --log-failed`. Native builds are CI-only, including
   dependencies and Deno compiled launchers. Do not install native build tools
   or run the build scripts locally.
3. Once registry setup is complete, dispatch `publish-binaries.yml` on the
   **same commit** and supply that successful build run ID. The workflow rejects
   failed runs, different commits, unrelated workflows, and pull-request runs.
4. It assembles npm packages from the native artifacts, generates SHA256SUMS,
   publishes platforms before the meta-package with provenance, and creates
   `binaries-v<version>` with the raw servers and checksums. CI artifacts also
   include standalone launchers. No launcher package is released by this
   workflow.

Partially completed npm publication can be retried: already published packages
are accepted only when their tarball integrity matches exactly. A mismatch
requires a new rebuild version. If npm succeeded but GitHub Release creation
failed, finish the release from the same validated artifacts; never rebuild
under the old version. Pre-release rebuild packages use npm's `build` dist-tag;
exact launcher pins are unaffected by tag ordering.

## Publish the launcher

After the binary packages exist publicly, resolve them into the real lockfile:

```sh
deno check packages/launcher/cli.ts packages/launcher/mod.ts
deno publish --dry-run
git diff -- deno.lock
```

Commit the generated public npm integrity records. Do not invent integrity
values or copy a loopback-registry lockfile. Before initial binary publication,
the committed lockfile has no binary npm entries; full public dependency
verification and `deno publish --dry-run` are intentionally blocked on that
publication.

Review the launcher version, run CI, and dispatch `publish-launcher.yml`. It
verifies the committed lockfile with `deno check --frozen`, dry-runs and
publishes JSR, then publishes the Node package generated from the same
TypeScript source. Node conversion strips TypeScript and rewrites the exact npm
specifier into an exact package.json dependency; it does not bundle or rebuild
the native server.

If one registry succeeds and the other fails, resume the failed publication
using the identical commit and generated package. Do not change source under an
already published version. A launcher-only release follows this section and
reuses the existing binary packages; no native rebuild is needed.

## Build environment and verification

Linux uses native x64/arm64 runners and Alpine 3.22 with static OpenSSL, zlib,
musl, and compiler runtimes. The same strategy serves glibc and musl host
packages. macOS uses native Intel/Apple Silicon runners, static Homebrew
OpenSSL/zlib, system libraries, and ad-hoc code signing. Windows uses MSVC and
vcpkg static dependencies. The upstream source and submodule commits are pinned.
Runner images, distribution package revisions, Homebrew, and the runner's vcpkg
baseline can evolve; these are repeatable CI recipes, not a claim of
byte-for-byte reproducibility. Save build logs, package versions, and artifacts
with each release. Use a rebuild version if those environments change the
shipped bytes.

Smoke tests require exit code zero and upstream help text on its original output
stream (upstream's logging may write help to stderr). With credentials, the API
starts a server and requests the dummy getMe endpoint; any HTTP status proves
the listener responds. No live Telegram credentials are required for normal CI.

# ADR 0001: native npm payloads with a TypeScript launcher

Status: implemented; first public registry release requires maintainer setup.

## Decision

Ship unmodified `tdlib/telegram-bot-api` as seven native npm packages, a small
npm resolver meta-package, and an independently versioned TypeScript launcher on
JSR. Generate the npm CLI/API from the same source for Node. JSR contains no raw
native payloads. Package names encode OS/CPU/libc; versions describe upstream
releases. The meta-package lists exact optional dependencies, and the launcher
statically imports one exact meta-package version.

WebAssembly was rejected: the server's incoming HTTP listener, outbound
webhooks, and threaded TDLib scheduler cannot be ported to Emscripten's sockets
and threads without maintaining a server fork. Native subprocesses preserve
upstream behavior and accept the explicit loss of Deno sandbox isolation.
OS/container isolation is the appropriate boundary for the child.

The CLI never parses flags. A separate API constructs named options and owns
readiness and graceful shutdown. Both share lifecycle handling. The override
`TELEGRAM_BOT_API_BINARY` skips native-package resolution, but cannot remove the
statically imported dependency from the runtime's module graph.

## Pinning, cache, and compilation

An exact static npm import gives Deno a resolvable dependency graph and registry
integrity checks. Package manager caches handle deduplication. There is no
binary downloader, custom cache, or runtime checksum mechanism. Release
SHA256SUMS are for separately downloaded artifacts, not a second launcher cache
protocol.

Deno compile embeds npm assets in a virtual filesystem. An OS subprocess cannot
execute that virtual path, so compiled mode extracts the existing bytes into a
private per-process temporary directory and deletes it after exit. This is not a
persistent cache. Extraction requires write permission and an executable temp
filesystem. Forced OS termination can prevent cleanup.

Deno 2.9.6 filters optional packages by OS and CPU but does not model `libc` in
npm resolution. See the exact source links in
[CONTRIBUTING.md](../../CONTRIBUTING.md#deno-optional-dependency-verification).
The resolver checks Node's runtime report first, so a glibc host with musl also
installed still selects the package npm installed. Deno checks ldd before
musl/glibc loader files and avoids the permission-sensitive report. If libc
cannot be determined, any installed Linux variant is used: both carry the same
static server. Deno may download both Linux variants for its CPU. No
`--allow-sys` permission or shell probe is required.

## Platform choices and deviations from the initial brief

- **Upstream tags:** the GitHub tags endpoint was empty on 2026-09-25. Pin the
  immutable version-declaration commit for 10.3, not a nonexistent `v10.3` tag
  and not moving `master`. Watch numeric tags when available, otherwise CMake
  version changes. Same-version rebuilds require `-build.N`.
- **Linux:** fully static musl servers work on both glibc and musl hosts.
  Preserve the two package names and correct host constraints, but build once
  per CPU and ship the same static binary in both. Native arm64 runners avoid
  cross-toolchain complexity.
- **macOS:** link OpenSSL/zlib statically; keep the system C/C++ frameworks.
  Target macOS 15+, matching the native CI runners and Homebrew bottles. The
  initial 13.0 deployment flag did not make the prebuilt dependency objects
  compatible with macOS 13: the linker warned that they targeted macOS 15.
  Raising the declared minimum corrects that unsupported compatibility claim.
  Reject such linker warnings in future builds; older OS support would require
  compatible dependency builds and tests on the older OS. Ad-hoc signing
  provides a valid code signature, not notarization or automatic quarantine
  removal. Document the xattr fallback honestly.
- **Windows:** upstream explicitly documents MSVC/vcpkg builds. Keep x64 in the
  build and smoke matrix; success is required before publication. Use static
  vcpkg dependencies and terminate the child for supported console shutdown
  signals. Windows arm64 is outside the agreed native matrix. Upstream's CMake
  minimum leaves CMP0091 on its old behavior, which ignores
  `CMAKE_MSVC_RUNTIME_LIBRARY`. Set `CMAKE_POLICY_DEFAULT_CMP0091=NEW` before
  configuration and verify the resulting executable imports no VC runtime,
  OpenSSL, or zlib DLLs. The first CI artifact exposed this despite passing help
  on a runner with the redistributable installed.
- **musl compilation:** Deno offers GNU/Linux runtime targets, not native musl
  targets. Both Alpine packages are tested through native Node. The five agreed
  targets for which Deno supplies runtimes are compiled and executed in CI;
  standalone Alpine compatibility is not claimed. Revisit when Deno publishes
  musl runtimes.
- **help output:** upstream uses its logging subsystem and may write help to
  stderr. Smoke tests inspect both streams and preserve them; they do not
  rewrite upstream output just to satisfy a stdout-only assertion.
- **reproducibility:** source/submodules are immutable. CI dependency revisions
  are currently supplied by Alpine, Homebrew, and the runner vcpkg checkout, so
  bit-identical rebuilds are not guaranteed. Rebuild versions identify changes.

## Release safety

Public publishing requires maintainer approval and is separate from builds.
GitHub OIDC may only stage npm packages; the maintainer approves selected stages
locally with 2FA without downloading native payloads. A binary release requires
successful ordinary CI and a same-commit native build/smoke run. Saved tarballs
and receipts support exact-byte retries. All platforms become public before the
meta-package, and GitHub Release finalization verifies their public integrities.
The public lockfile is refreshed in CI. npm launcher approval precedes a
separate JSR dispatch gated by the protected release environment. No reusable
registry tokens are passed to jobs. JSR trusts the linked repository more
broadly than npm's workflow/environment binding, so workflow review remains
necessary. Pre-publication tests use temporary registries and never commit their
lockfiles.

No native artifact, including a Deno executable, is built on a developer machine
as part of this repository's workflow. Local tests use trivial scripts for the
subprocess and HTTP listener. Registry namespaces remain a maintainer action.

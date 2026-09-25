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
npm resolution. See the exact source links in README.md. The resolver checks
musl loaders, ldd content, and glibc loaders; Node's diagnostic report is a
fallback. Unknown libc fails clearly instead of guessing. Deno may download both
Linux variants for its CPU. No `--allow-sys` permission or shell probe is
required.

## Platform choices and deviations from the initial brief

- **Upstream tags:** the GitHub tags endpoint was empty on 2026-09-25. Pin the
  immutable version-declaration commit for 10.3, not a nonexistent `v10.3` tag
  and not moving `master`. Watch numeric tags when available, otherwise CMake
  version changes. Same-version rebuilds require `-build.N`.
- **Linux:** fully static musl servers work on both glibc and musl hosts.
  Preserve the two package names and correct host constraints even though both
  are built with musl. Native arm64 runners avoid cross-toolchain complexity.
- **macOS:** link OpenSSL/zlib statically; keep the system C/C++ frameworks.
  Target macOS 13+. Ad-hoc signing provides a valid code signature, not
  notarization or automatic quarantine removal. Document the xattr fallback
  honestly.
- **Windows:** upstream explicitly documents MSVC/vcpkg builds. Keep x64 in the
  build and smoke matrix; success is required before publication. Use static
  vcpkg dependencies and terminate the child for supported console shutdown
  signals. Windows arm64 is outside the agreed native matrix.
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

Public publishing is manual and separate from builds. A binary publication must
refer to a successful same-commit build run. All platforms publish before the
meta-package; npm integrity checks permit safe retry after partial publication.
The launcher release validates the real public lockfile. Pre-publication tests
use temporary local tarball registries and never commit their lockfiles.

No native artifact, including a Deno executable, is built on a developer machine
as part of this repository's workflow. Local tests use trivial scripts for the
subprocess and HTTP listener. Registry namespaces remain a maintainer action.

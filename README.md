# Telegram Bot API, without a C++ toolchain

A small Deno/Node launcher for the unmodified
[official Telegram Bot API server](https://github.com/tdlib/telegram-bot-api).
Native binaries are built in GitHub Actions and distributed as platform-specific
npm packages. The TypeScript launcher is published independently to JSR and npm.

**Release status:** package namespaces and initial publication are maintainer
setup tasks. The public commands below become available after that first
release. Development and CI use the same source with local package resolution.

## Run

With Deno 2.9.6 or newer:

```sh
deno run -N -R -W --allow-run --allow-env jsr:@deerdaily/bot-api --api-id ... --api-hash ... --local
```

With Node 22 or newer:

```sh
npx @deerdaily/bot-api --help
```

The CLI forwards arguments unchanged, inherits stdin/stdout/stderr and the
environment, forwards SIGINT/SIGTERM, and returns the server's exit code. There
is no flag parser. See the
[upstream usage guide](https://github.com/tdlib/telegram-bot-api#usage) or
invoke `--help` for the server's options. Windows uses forced process
termination on supported console shutdown signals.

## Permissions and security

The spawned native server runs with your OS account's privileges, **outside
Deno's permission sandbox**. Restrict the account, filesystem, and network
through the OS or a container when isolation matters. Deno permission flags do
not constrain the child process.

| Permission             | Launcher use                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--allow-run`          | Starts and terminates the native server; always required.                                                       |
| `-R` / `--allow-read`  | Resolves the npm executable, detects Linux libc, and reads embedded bytes in compiled mode.                     |
| `-W` / `--allow-write` | Compiled mode materializes and removes a temporary executable. Ordinary CLI mode does not write a binary cache. |
| `--allow-env`          | Reads the binary override and runtime environment.                                                              |
| `-N` / `--allow-net`   | Programmatic `ready()` connects to the listener. The passthrough CLI itself makes no network requests.          |

Fetching initial JSR/npm modules is managed by Deno, separately from script
network permissions. The command above grants the complete permission set for
both modes; it does not sandbox server file access or network traffic. There are
no install scripts and no custom downloader or persistent binary cache.

## Programmatic API

```ts
import { startBotApiServer } from "jsr:@deerdaily/bot-api/api";

const server = startBotApiServer({
  apiId: 12345,
  apiHash: "your-api-hash",
  port: 8081,
  local: true,
  dir: "./bot-api-data",
});

try {
  await server.ready();
  console.log(`Server process: ${server.pid}`);
  // Run your application while the server is alive.
} finally {
  await server.stop();
}
```

On Node import from `@deerdaily/bot-api/api` instead. Only this API constructs
arguments. It accepts `host` (default `127.0.0.1`), `tempDir`, extra `args`,
`readyTimeoutMs` (30 seconds), and `stopTimeoutMs` (5 seconds). `ready()` checks
TCP acceptance, not Telegram authentication or application health; an already
occupied port can satisfy that check. Avoid overriding host or port through
`args`, since readiness uses the named options. `stop()` is idempotent and
escalates to SIGKILL. A readiness timeout leaves shutdown to the caller; always
use `finally`.

## Existing binaries and offline use

```sh
TELEGRAM_BOT_API_BINARY=/opt/telegram-bot-api deno run -R --allow-run --allow-env jsr:@deerdaily/bot-api --help
```

The override skips platform detection and executable resolution entirely. It is
a single executable path, never a shell command. The static npm import remains
part of the module graph: provision JSR/npm dependencies before going offline,
use a compiled launcher, or vendor the modules. The override cannot prevent the
runtime from loading the small imported meta-package and its declared
dependencies.

## Platforms

All packages are under `@deerdaily/` and contain `bin/telegram-bot-api` (or
`.exe`).

| Package suffix             | Native server           | Standalone Deno target      |
| -------------------------- | ----------------------- | --------------------------- |
| `bot-api-linux-x64`        | Linux x64, glibc host   | `x86_64-unknown-linux-gnu`  |
| `bot-api-linux-arm64`      | Linux arm64, glibc host | `aarch64-unknown-linux-gnu` |
| `bot-api-linux-x64-musl`   | Alpine / musl x64       | Not provided by Deno        |
| `bot-api-linux-arm64-musl` | Alpine / musl arm64     | Not provided by Deno        |
| `bot-api-darwin-x64`       | macOS 13+ Intel         | `x86_64-apple-darwin`       |
| `bot-api-darwin-arm64`     | macOS 13+ Apple Silicon | `aarch64-apple-darwin`      |
| `bot-api-win32-x64`        | Windows x64             | `x86_64-pc-windows-msvc`    |

Linux servers use fully static musl builds even in packages selected on glibc
hosts. This avoids a minimum glibc version for the **server**. The Deno/Node
runtime still has its own OS requirements. OpenSSL and zlib are static on macOS
and Windows; system OS libraries remain necessary. Windows arm64 and other
targets report an explicit unsupported-target error; use a custom binary via the
override.

Alpine is tested with native Node. Deno currently publishes GNU/Linux compile
targets, not musl targets; a standalone Deno launcher is therefore not
advertised as Alpine-compatible. See
[Deno's target list](https://docs.deno.com/runtime/reference/cli/compile/#supported-targets).

### Deno optional dependency verification

Checked against **Deno 2.9.6 source on 2026-09-25**:

- [`all_system_packages` and `as_valid_serialized_for_system`](https://github.com/denoland/deno/blob/v2.9.6/libs/npm/resolution/snapshot.rs)
  filter incompatible optional dependencies using OS/CPU system metadata.
- [`NpmPackageVersionInfo`](https://github.com/denoland/deno/blob/v2.9.6/libs/npm/registry.rs)
  carries `os` and `cpu`, but no `libc`. The serialized resolver likewise
  restores OS/CPU only. This Deno release **does not honor npm's `libc`
  constraint**.

Consequently Deno may fetch both Linux packages for the matching CPU, including
one extra package on Alpine. The meta-package detects the host libc at runtime
and selects the right package. Current npm honors the package constraints. Do
not disable optional dependencies. Deno caches exact `name@version` packages
globally; npm manages its own content cache and installation tree. The launcher
does not duplicate either cache.

## Standalone executable

Compilation is performed in CI in this repository, one job for each supported
Deno target. The corresponding command for consumers is:

```sh
deno compile --target x86_64-unknown-linux-gnu -N -R -W --allow-run --allow-env --output bot-api jsr:@deerdaily/bot-api
./bot-api --help
```

Use a target from the table. Keep the default compilation mode: `--bundle` and
`--exclude-unused-npm` can discard packages reached through dynamic resolution.
Deno embeds npm dependencies and their assets. Since the OS cannot execute a
virtual filesystem path, the launcher copies the embedded server into a private
temporary directory, starts it, and removes it after the child exits. An
OS-level forced kill can leave that temporary directory behind. A writable,
executable temporary filesystem is required (`TMPDIR` on Unix, `TEMP` on
Windows).

The distributed executable needs neither Deno nor npm nor a network connection
to start its embedded server. The server may need network access for its own
work. CI tests compiled launchers with the build cache and installed npm tree
moved out of reach. Cross-target compilation support is Deno's; the matrix
validates each target on its native runner.

macOS binaries are ad-hoc signed in CI, not Apple-notarized. If a browser
download is quarantined, inspect its origin, then use
`xattr -d com.apple.quarantine /path/to/bot-api` (or the native server path).
Ad-hoc signing alone does not remove Gatekeeper quarantine.

## Versions and development

Binary packages and `bot-api-binaries` share upstream version `10.3.0`; rebuilds
use `10.3.0-build.N`. The launcher starts at `0.1.0` and pins the exact binary
version in source. Launcher-only fixes keep that pin, so they reuse already
cached binary packages. Moving to a new upstream server requires a new launcher
release.

Upstream currently has **no Git tags**. The initial pin is the immutable
[commit declaring version 10.3](https://github.com/tdlib/telegram-bot-api/commit/2efabc722e9493b9cac450233198d09e5cea0573).
The watcher prefers version tags if upstream starts publishing them; otherwise
it watches changes to the declared CMake version, not arbitrary master commits.

```sh
deno task verify
deno task versions
TELEGRAM_BOT_API_BINARY=/path/to/existing/server deno task dev --help
```

Tests use scripts, not a locally built native server. `deno.local.json` maps the
exact npm import to the checked-in resolver for pre-publication work. Production
uses the actual static npm import. **All native builds, including
`deno compile`, belong in GitHub Actions.**

See [RELEASING.md](RELEASING.md) and the
[architecture decision](docs/adr/0001-prebuilt-binaries.md). Launcher code is
MIT licensed; the server is Boost-licensed and contains upstream third-party
dependencies.

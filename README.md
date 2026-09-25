# Telegram Bot API, without a C++ toolchain

Run the unmodified
[official Telegram Bot API server](https://github.com/tdlib/telegram-bot-api)
with Deno or Node. The launcher selects a prebuilt native binary for your
platform and lets you run it from the command line or manage it from TypeScript.

The first public package release is pending. The registry commands below become
available after publication.

## Run

With Deno 2.9.6 or newer:

```sh
deno run -N -R -W --allow-run --allow-env jsr:@deerdaily/bot-api --api-id ... --api-hash ... --local
```

With Node 22 or newer:

```sh
npx @deerdaily/bot-api --api-id ... --api-hash ... --local
```

Replace `...` with your Telegram API ID and hash. Pass `--help` to see the
server's options, or consult the
[upstream usage guide](https://github.com/tdlib/telegram-bot-api#usage).

The CLI forwards arguments unchanged, inherits stdin/stdout/stderr and the
environment, and returns the server's exit code. On Linux and macOS the server
runs in its own process group and the launcher relays each signal exactly once
(SIGINT, SIGTERM, SIGQUIT, SIGHUP, SIGUSR1, SIGUSR2), so Ctrl+C starts
upstream's graceful shutdown and a second Ctrl+C forces an immediate exit, just
as when running the server directly. On Windows, the console delivers Ctrl+C to
the server itself; the launcher terminates it only if it is still running five
seconds later.

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

On Node, install `@deerdaily/bot-api` with npm and import from
`@deerdaily/bot-api/api` instead.

The API also accepts `host` (default `127.0.0.1`), `tempDir`, extra `args`,
`readyTimeoutMs` (30 seconds), and `stopTimeoutMs` (5 seconds). The default port
is `8081`.

`ready()` checks TCP acceptance, not Telegram authentication or application
health; an already occupied port can satisfy that check. Avoid overriding host
or port through `args`, since readiness uses the named options. `stop()` is
idempotent and escalates to SIGKILL; on Windows it terminates immediately. A
readiness timeout leaves shutdown to the caller; always use `finally`.

The API does not install signal handlers, so your application keeps its own
SIGINT/SIGTERM behavior. Call `stop()` from your shutdown path. If your
application exits without doing so, the server is sent SIGTERM and finishes
shutting down by itself. `pid` is `undefined` only if the process could not be
started.

## Supported platforms

The launcher automatically selects a platform package under `@deerdaily/`. Keep
optional dependencies enabled when installing.

| Package suffix             | Native server           | Standalone Deno target      |
| -------------------------- | ----------------------- | --------------------------- |
| `bot-api-linux-x64`        | Linux x64, glibc host   | `x86_64-unknown-linux-gnu`  |
| `bot-api-linux-arm64`      | Linux arm64, glibc host | `aarch64-unknown-linux-gnu` |
| `bot-api-linux-x64-musl`   | Alpine / musl x64       | Not provided by Deno        |
| `bot-api-linux-arm64-musl` | Alpine / musl arm64     | Not provided by Deno        |
| `bot-api-darwin-x64`       | macOS 15+ Intel         | `x86_64-apple-darwin`       |
| `bot-api-darwin-arm64`     | macOS 15+ Apple Silicon | `aarch64-apple-darwin`      |
| `bot-api-win32-x64`        | Windows x64             | `x86_64-pc-windows-msvc`    |

Linux servers use fully static musl builds even on glibc hosts, avoiding a
minimum glibc version for the server. DNS behavior and memory/performance
characteristics can differ from glibc. The Deno/Node runtime still has its own
OS requirements. OpenSSL and zlib are static on macOS and Windows; system OS
libraries remain necessary.

Use Node on Alpine; standalone Deno launchers are not supported there. Deno
2.9.6 and 2.9.7 may download both Linux libc variants for your CPU; the launcher
selects the appropriate package at runtime. The launcher uses the package
manager's cache, with no install scripts, custom downloader, or persistent
binary cache of its own.

macOS 13/14, Windows arm64, and other unlisted targets are unsupported by these
packages. Use a compatible custom binary on an unsupported platform.

## Existing binaries and offline use

Set `TELEGRAM_BOT_API_BINARY` to use an existing server executable:

```sh
TELEGRAM_BOT_API_BINARY=/opt/telegram-bot-api deno run -R --allow-run --allow-env jsr:@deerdaily/bot-api --help
```

The override skips platform detection and executable resolution. It is a single
executable path, never a shell command, and works with both the CLI and API.

The override does not remove the launcher's npm dependency from the module
graph. Before going offline, provision JSR/npm dependencies, vendor the modules,
or use a compiled launcher.

## Standalone executable

Compile a launcher that embeds the server and needs neither Deno nor npm to run:

```sh
deno compile --target x86_64-unknown-linux-gnu -N -R -W --allow-run --allow-env --output bot-api jsr:@deerdaily/bot-api
./bot-api --help
```

Use a target from the platform table and compile on that platform: CI verifies
each target by compiling on its own OS and CPU. Cross-compiling for another
platform is unverified, because the embedded package must match the target
rather than the machine running `deno compile`. Keep the default compilation
mode: `--bundle` and `--exclude-unused-npm` can discard packages reached through
dynamic resolution. No network connection is needed to start the embedded
server; the server may need network access for its own work.

The launcher extracts the embedded server into a private temporary directory and
removes it after the child exits. A writable, executable temporary filesystem is
required (`TMPDIR` on Unix, `TEMP` on Windows). On `noexec` systems, choose an
approved location or use an installed custom binary through
`TELEGRAM_BOT_API_BINARY`. Forced termination or power loss can leave temporary
files behind; use graceful shutdown and an OS-managed cleanup policy. Do not
delete a running server's extraction directory.

macOS binaries are ad-hoc signed, not Apple-notarized. If a browser download is
quarantined, inspect its origin, then use
`xattr -d com.apple.quarantine /path/to/bot-api` (or the native server path).
Ad-hoc signing alone does not remove Gatekeeper quarantine, and organizational
security policy can still block execution.

## Permissions

The spawned native server runs with your OS account's privileges, **outside
Deno's permission sandbox**. Use an OS account or container with suitable
filesystem and network restrictions when isolation matters.

| Permission             | Launcher use                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--allow-run`          | Starts and terminates the native server; always required.                                                  |
| `-R` / `--allow-read`  | Resolves the npm executable, detects Linux libc, and reads embedded bytes in compiled mode.                |
| `-W` / `--allow-write` | Compiled mode creates and removes a temporary executable. Ordinary CLI mode does not write a binary cache. |
| `--allow-env`          | Reads the binary override and runtime environment.                                                         |
| `-N` / `--allow-net`   | Programmatic `ready()` connects to the listener. The passthrough CLI itself makes no network requests.     |

Fetching initial JSR/npm modules is managed by Deno, separately from script
network permissions. The examples grant the complete permission set for CLI and
compiled use; these flags do not constrain the native server's file access or
network traffic.

## Deployment considerations

- **HTTPS trust:** the server loads CA roots from fixed system locations:
  `/etc/ssl/cert.pem` and `/etc/ssl/certs` on Linux and macOS, and the OS
  certificate store on Windows. Minimal images and private CAs need roots
  installed there. Do not assume `SSL_CERT_FILE` redirects the pinned TDLib
  certificate loader, or disable certificate verification to work around missing
  roots. Successful startup does not prove HTTPS webhooks work.
- **Updates:** statically linked libraries are part of the server binary. OS
  library updates cannot replace them; upgrade the binary package through a
  launcher release and regenerate standalone executables to adopt fixes.
- **Production use:** sustained-load behavior and site-specific DNS
  compatibility are not yet established by the test suite. Validate your
  deployment, and preserve logs and the exact version/build identity for
  diagnostics. The stripped packages do not include debug symbols.

## Versions

The launcher and native server are versioned separately. Each launcher release
pins an exact binary package version; launcher-only updates can reuse cached
binaries. Native rebuilds of the same Bot API release use versions such as
`10.3.0-build.N`. Pass `--version` to print the server's Bot API version.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, checks, and build
guidance. Maintainer follow-ups are tracked in [KIV.md](KIV.md); release
procedures are in [RELEASING.md](RELEASING.md).

## License

The launcher is [MIT licensed](LICENSE). The server is Boost-licensed and
contains third-party dependencies; see the
[bundled notices](licenses/README.md).

# Contributing

This repository packages the unmodified Telegram Bot API server with a
TypeScript launcher for Deno and Node. See the [README](README.md) for usage,
the [architecture decision](docs/adr/0001-prebuilt-binaries.md) for design
rationale, and [KIV.md](KIV.md) for maintainer follow-ups.

## Development setup

Use Deno 2.9.6 and Node 24 to match CI. From a checkout, run:

```sh
deno task verify
deno task versions
```

`verify` checks formatting, linting, types, and the Deno/Node test suites. It
also generates and tests the npm launcher. `versions` checks that manifests and
binary pins agree.

Local tests use scripts in place of the native server. No C++ toolchain,
registry credentials, or Telegram credentials are needed. To try the launcher
with an existing server:

```sh
TELEGRAM_BOT_API_BINARY=/path/to/existing/server deno task dev --help
```

`deno.local.json` maps the exact npm import to the checked-in resolver for
pre-publication work. Production uses the actual static npm import.

**All native builds, including `deno compile`, belong in GitHub Actions.** Do
not install native build tools or run the native build scripts locally as part
of this project's development workflow. The README's compilation example is for
consumers of published packages.

## Repository layout

| Path                 | Purpose                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `packages/launcher/` | TypeScript CLI, API, lifecycle handling, and tests.                               |
| `packages/binaries/` | Platform package manifests and the binary resolver meta-package.                  |
| `scripts/`           | Version checks, npm conversion, native build recipes, packaging, and smoke tests. |
| `.github/workflows/` | Checks, native builds, publication, and upstream monitoring.                      |
| `upstream.json`      | Immutable upstream source pin and native package version.                         |
| `licenses/`          | License texts bundled with native packages.                                       |

Make launcher changes in the TypeScript source. `scripts/build-npm.mjs`
generates the Node package under `dist/npm-launcher/`; do not edit generated
output. Keep the CLI's argument passthrough behavior separate from the API's
named options.

## Validation

Run `deno fmt`, `deno task verify`, and `deno task versions` before submitting
changes. Add or update relevant tests when changing launcher behavior or package
resolution.

Ordinary CI also runs:

```sh
deno run -A scripts/check-package.ts
```

This uses JavaScript-only npm fixtures and a temporary loopback registry to
check optional-dependency downloads and perform a JSR publish dry-run without
creating public registry entries.

Native changes are validated by `build-binaries.yml` and its smoke matrix in
GitHub Actions. The matrix checks startup, package selection, the five supported
Deno compilation targets, and Alpine with native Node. Compiled launchers are
tested with the build cache and installed npm tree moved out of reach, the test
registry shut down, and registry URLs made unreachable. Each standalone target
is validated on its native runner.

Optional credentials enable HTTP smoke tests. These checks do not establish
clean-machine HTTPS trust, sustained-load behavior, or compatibility with every
enterprise DNS configuration. Follow-up coverage is tracked in [KIV.md](KIV.md).

### Deno optional dependency verification

The following findings were checked against Deno 2.9.6 and the 2.9.7 source on
2026-09-25:

- [`all_system_packages` and `as_valid_serialized_for_system`](https://github.com/denoland/deno/blob/v2.9.6/libs/npm/resolution/snapshot.rs)
  filter incompatible optional dependencies using OS/CPU system metadata.
- [`NpmPackageVersionInfo`](https://github.com/denoland/deno/blob/v2.9.6/libs/npm/registry.rs)
  carries `os` and `cpu`, but no `libc`. The serialized resolver likewise
  restores OS/CPU only. This Deno release does not honor npm's `libc`
  constraint.

The same behavior was found in the
[2.9.7 resolver](https://github.com/denoland/deno/blob/v2.9.7/libs/npm/resolution/snapshot.rs)
and
[registry schema](https://github.com/denoland/deno/blob/v2.9.7/libs/npm/registry.rs).
`scripts/check-package.ts` verifies the downloaded tarball set empirically: one
matching OS/CPU platform package outside Linux, and both matching libc variants
on Linux. Revisit this expectation when upgrading Deno. The meta-package detects
host libc at runtime and selects the appropriate package.

## Version changes and releases

Binary packages and `bot-api-binaries` share the version recorded in
`upstream.json`; rebuilds use `-build.N`. The launcher has its own version and
pins an exact binary version in source. Launcher-only fixes keep that pin;
adopting a new upstream server requires a launcher release.

At bootstrap, upstream had no Git tags. The initial pin is the immutable
[commit declaring version 10.3](https://github.com/tdlib/telegram-bot-api/commit/2efabc722e9493b9cac450233198d09e5cea0573).
The watcher prefers version tags when available; otherwise it watches changes to
the declared CMake version, not arbitrary master commits.

Follow [RELEASING.md](RELEASING.md) for version bump commands, registry setup,
build dispatch, and publication. Keep maintainer follow-ups in [KIV.md](KIV.md)
and user-facing instructions in the README.

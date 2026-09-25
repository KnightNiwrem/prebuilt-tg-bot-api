# Keep in view

Follow-up work for maintainers. Unchecked items are not implemented or verified
yet. Development guidance is in [CONTRIBUTING.md](CONTRIBUTING.md), release
procedures are in [RELEASING.md](RELEASING.md), and current user-facing
limitations belong in the [README](README.md).

## First public release

- [ ] Provision the npm and JSR namespaces, package entries, and publishing
      access described in
      [first-time maintainer setup](RELEASING.md#first-time-maintainer-setup).
- [ ] Publish the native packages, resolve and commit the public npm integrity
      records in `deno.lock`, and publish the launcher to JSR and npm using the
      release procedure. Then remove the pending-publication notes from both
      READMEs and update the architecture decision's status.

## Portable HTTPS trust

- [ ] Build OpenSSL with appropriate system CA paths and test the pinned TDLib
      TLS code without the build machine's Homebrew files. The current macOS
      build uses Homebrew OpenSSL paths.
- [ ] Test trusted and untrusted certificates on clean hosts. Never work around
      missing roots by disabling verification. Minimal images still need
      maintained CA stores, and private trust policies require explicitly
      provisioned roots.

The pinned
[TDLib certificate loader](https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/tdnet/td/net/SslCtx.cpp)
reads OpenSSL's compiled-in paths on Unix. It does not use the usual
environment-aware default-path loader, so do not assume `SSL_CERT_FILE`
redirects it. Windows uses its OS certificate store. Startup success does not
establish that HTTPS webhooks work.

## Linux hardening and thread stacks

- [ ] Evaluate static PIE with matching compilation flags, verify the resulting
      ELF headers, and test actual randomized loading in CI. The current recipe
      uses `-static`, not `-static-pie`; adding a linker flag or passing
      `--help` does not establish runtime hardening properties.
- [ ] Explicitly size and test worker-thread stacks, and add DNS and load tests
      for the static musl servers shipped to both glibc and musl hosts. Account
      for site-specific DNS/search behavior and memory/performance differences.

References:
[musl's documented differences](https://wiki.musl-libc.org/functional-differences-from-glibc.html)
and
[GCC's static/PIE options](https://gcc.gnu.org/onlinedocs/gcc/Link-Options.html).

## Dependency maintenance

- [ ] Add dependency-only update monitoring and vulnerability review alongside
      the watcher, which currently follows only Bot API versions.
- [ ] Record exact dependency inputs and archive inventories with releases.
- [ ] Publish security rebuilds under `-build.N` and advance the launcher's
      exact binary pin when adopting them. Users must upgrade the binary package
      and regenerate standalone launchers; OS library updates cannot replace
      embedded code.

## Diagnostics and broader verification

- [ ] Generate and retain matching debug symbols separately from npm payloads,
      and preserve original release artifacts. Current packages are stripped; a
      later rebuild cannot be assumed to match old crash addresses.
- [ ] Add clean-host TLS, DNS, and sustained-load tests beyond startup, package
      selection, supported Deno compilation targets, and optional credentialed
      HTTP responses.
- [ ] Pin build inputs where practical. Floating package-manager inputs mean the
      current recipes are not byte-for-byte reproducible.

## Platform support and distribution

- [ ] Evaluate Developer ID signing and notarization with maintainer-controlled
      Apple credentials. Current binaries are only ad-hoc signed; organizational
      security policy may still block execution after notarization. See
      [Apple's distribution requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
- [ ] If adding support for macOS before 15, rebuild compatible dependencies and
      test on the older OS. Lowering the executable's deployment target alone
      does not make Homebrew dependency bottles compatible. Preserve CI's
      rejection of linker warnings about newer dependency targets.
- [ ] Revisit standalone Alpine support when Deno supplies musl runtimes. See
      [Deno's target list](https://docs.deno.com/runtime/reference/cli/compile/#supported-targets).
      Alpine currently uses native Node.

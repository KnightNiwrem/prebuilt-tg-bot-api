# Bundled dependency notices

Native packages include these upstream license texts in `LICENSES/`, in addition
to the launcher code's MIT license. Linux statically links musl and the GCC
runtime; macOS and Windows have platform runtime dependencies of their own.
Consult the saved build environment metadata for the actual distribution package
revisions.

| Component                | Upstream source / license                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram Bot API / TDLib | [Boost 1.0](https://github.com/tdlib/telegram-bot-api/blob/master/LICENSE_1_0.txt)                                                                                  |
| OpenSSL 3                | [Apache 2.0](https://github.com/openssl/openssl/blob/openssl-3.5.4/LICENSE.txt)                                                                                     |
| zlib                     | [zlib license](https://github.com/madler/zlib/blob/v1.3.1/LICENSE)                                                                                                  |
| musl                     | [Copyright and component notices](https://git.musl-libc.org/cgit/musl/tree/COPYRIGHT)                                                                               |
| GCC runtime              | [GPLv3](https://github.com/gcc-mirror/gcc/blob/master/COPYING3) with the [runtime library exception](https://github.com/gcc-mirror/gcc/blob/master/COPYING.RUNTIME) |

These notices cover the bundled native dependencies; they do not change the MIT
license of the independently authored launcher. Review notices when changing
dependency versions or build flags.

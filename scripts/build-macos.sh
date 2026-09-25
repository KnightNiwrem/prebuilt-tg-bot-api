#!/usr/bin/env bash
set -euo pipefail
test "${CI:-}" = true || { echo 'Native builds are CI-only' >&2; exit 1; }
brew install gperf zlib ninja
# Homebrew's bottles on the macOS 15 runners also target macOS 15. Setting an
# older target here does not rebuild those static dependencies for the older OS.
export MACOSX_DEPLOYMENT_TARGET=15.0

# TDLib loads CA roots only from OpenSSL's compiled-in OPENSSLDIR. Homebrew's
# OpenSSL points there at Homebrew's own prefix, which clean Macs lack, so build
# OpenSSL against the system bundle at /etc/ssl/cert.pem instead.
OPENSSL_VERSION=3.5.8
OPENSSL_SHA256=a8f84a39918ec6415ce765d9b429d313ba97b8143169c172e734b9514464f5b2
openssl_prefix="$RUNNER_TEMP/openssl"
curl -fsSL -o "$RUNNER_TEMP/openssl.tar.gz" \
  "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VERSION/openssl-$OPENSSL_VERSION.tar.gz"
echo "$OPENSSL_SHA256  $RUNNER_TEMP/openssl.tar.gz" | shasum -a 256 -c -
tar -xzf "$RUNNER_TEMP/openssl.tar.gz" -C "$RUNNER_TEMP"
case "$(uname -m)" in
  arm64) openssl_target=darwin64-arm64-cc ;;
  x86_64) openssl_target=darwin64-x86_64-cc ;;
  *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac
(
  cd "$RUNNER_TEMP/openssl-$OPENSSL_VERSION"
  ./Configure "$openssl_target" no-shared no-tests no-docs \
    --prefix="$openssl_prefix" --openssldir=/etc/ssl
  make -j3 build_libs
  make install_dev
)

cmake -S upstream -B "$RUNNER_TEMP/bot-api-build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DOPENSSL_USE_STATIC_LIBS=TRUE \
  -DOPENSSL_ROOT_DIR="$openssl_prefix" \
  -DZLIB_LIBRARY="$(brew --prefix zlib)/lib/libz.a" \
  -DZLIB_INCLUDE_DIR="$(brew --prefix zlib)/include"
build_log="$RUNNER_TEMP/bot-api-build.log"
cmake --build "$RUNNER_TEMP/bot-api-build" --target telegram-bot-api --parallel 3 2>&1 | tee "$build_log"
if grep -E 'was built for newer .* than being linked' "$build_log"; then
  echo 'A dependency exceeds the macOS deployment target; rebuild it or review the supported OS baseline.' >&2
  exit 1
fi
mkdir -p dist
{
  echo "openssl $OPENSSL_VERSION (source, sha256 $OPENSSL_SHA256)"
  brew list --versions
} > dist/build-environment.txt
cp "$RUNNER_TEMP/bot-api-build/telegram-bot-api" dist/telegram-bot-api
strip dist/telegram-bot-api
codesign --force --sign - dist/telegram-bot-api
codesign --verify --verbose dist/telegram-bot-api
otool -L dist/telegram-bot-api
if otool -L dist/telegram-bot-api | grep -E '/opt/homebrew|/usr/local|libssl|libcrypto|libz\.'; then
  echo 'Unexpected non-system runtime dependency' >&2
  exit 1
fi
# The default CA locations are string constants inside the static OpenSSL.
if ! strings dist/telegram-bot-api | grep -qx '/etc/ssl/cert.pem'; then
  echo 'Expected OpenSSL to load CA roots from /etc/ssl/cert.pem' >&2
  exit 1
fi
if strings dist/telegram-bot-api | grep -E '(/opt/homebrew|/usr/local)/etc/openssl'; then
  echo 'Homebrew OpenSSL paths leaked into the server' >&2
  exit 1
fi

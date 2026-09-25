#!/usr/bin/env bash
set -euo pipefail
test "${CI:-}" = true || { echo 'Native builds are CI-only' >&2; exit 1; }
brew install gperf openssl@3 zlib ninja
# Homebrew's bottles on the macOS 15 runners also target macOS 15. Setting an
# older target here does not rebuild those static dependencies for the older OS.
export MACOSX_DEPLOYMENT_TARGET=15.0
cmake -S upstream -B "$RUNNER_TEMP/bot-api-build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DOPENSSL_USE_STATIC_LIBS=TRUE \
  -DOPENSSL_ROOT_DIR="$(brew --prefix openssl@3)" \
  -DZLIB_LIBRARY="$(brew --prefix zlib)/lib/libz.a" \
  -DZLIB_INCLUDE_DIR="$(brew --prefix zlib)/include"
build_log="$RUNNER_TEMP/bot-api-build.log"
cmake --build "$RUNNER_TEMP/bot-api-build" --target telegram-bot-api --parallel 3 2>&1 | tee "$build_log"
if grep -E 'was built for newer .* than being linked' "$build_log"; then
  echo 'A dependency exceeds the macOS deployment target; rebuild it or review the supported OS baseline.' >&2
  exit 1
fi
mkdir -p dist
brew list --versions > dist/build-environment.txt
cp "$RUNNER_TEMP/bot-api-build/telegram-bot-api" dist/telegram-bot-api
strip dist/telegram-bot-api
codesign --force --sign - dist/telegram-bot-api
codesign --verify --verbose dist/telegram-bot-api
otool -L dist/telegram-bot-api
if otool -L dist/telegram-bot-api | grep -E '/opt/homebrew|/usr/local|libssl|libcrypto|libz\.'; then
  echo 'Unexpected non-system runtime dependency' >&2
  exit 1
fi

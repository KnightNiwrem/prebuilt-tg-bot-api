#!/usr/bin/env bash
set -euo pipefail
test "${CI:-}" = true || { echo 'Native builds are CI-only' >&2; exit 1; }
brew install gperf openssl@3 zlib ninja
export MACOSX_DEPLOYMENT_TARGET=13.0
cmake -S upstream -B "$RUNNER_TEMP/bot-api-build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DOPENSSL_USE_STATIC_LIBS=TRUE \
  -DOPENSSL_ROOT_DIR="$(brew --prefix openssl@3)" \
  -DZLIB_LIBRARY="$(brew --prefix zlib)/lib/libz.a" \
  -DZLIB_INCLUDE_DIR="$(brew --prefix zlib)/include"
cmake --build "$RUNNER_TEMP/bot-api-build" --target telegram-bot-api --parallel 3
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

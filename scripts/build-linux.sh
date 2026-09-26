#!/bin/sh
set -eu
test "${CI:-}" = true || { echo 'Native builds are CI-only' >&2; exit 1; }
apk add --no-cache build-base linux-headers cmake ninja gperf openssl-dev openssl-libs-static zlib-dev zlib-static
# TDLib creates threads with default attributes; musl defaults to 128 KiB stacks.
# Static musl takes the default from PT_GNU_STACK (capped at 8 MiB), so match
# glibc's usual 8 MiB.
thread_stack=8388608
cmake -S upstream -B /tmp/bot-api-build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DOPENSSL_USE_STATIC_LIBS=TRUE \
  -DZLIB_USE_STATIC_LIBS=ON \
  "-DCMAKE_EXE_LINKER_FLAGS=-static -Wl,-z,stack-size=$thread_stack"
cmake --build /tmp/bot-api-build --target telegram-bot-api --parallel 2
mkdir -p dist
apk info -v > dist/build-environment.txt
cp /tmp/bot-api-build/telegram-bot-api dist/telegram-bot-api
strip dist/telegram-bot-api
if ldd dist/telegram-bot-api 2>&1 | grep -q '=>'; then
  echo 'Expected a fully static Linux binary' >&2
  exit 1
fi
if ! readelf -lW dist/telegram-bot-api | grep GNU_STACK | grep -q "$(printf '0x%06x' "$thread_stack")"; then
  readelf -lW dist/telegram-bot-api | grep GNU_STACK >&2
  echo 'Expected an 8 MiB default thread stack in PT_GNU_STACK' >&2
  exit 1
fi

$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true') { throw 'Native builds are CI-only' }
& "$env:VCPKG_INSTALLATION_ROOT/vcpkg.exe" install openssl:x64-windows-static zlib:x64-windows-static gperf:x64-windows
if ($LASTEXITCODE) { throw 'vcpkg install failed' }
$env:PATH = "$env:VCPKG_INSTALLATION_ROOT/installed/x64-windows/tools/gperf;$env:PATH"
cmake -S upstream -B "$env:RUNNER_TEMP/bot-api-build" -A x64 `
  "-DCMAKE_TOOLCHAIN_FILE=$env:VCPKG_INSTALLATION_ROOT/scripts/buildsystems/vcpkg.cmake" `
  -DVCPKG_TARGET_TRIPLET=x64-windows-static -DCMAKE_BUILD_TYPE=Release `
  -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded -DTD_ENABLE_DOTNET=OFF
if ($LASTEXITCODE) { throw 'CMake configuration failed' }
cmake --build "$env:RUNNER_TEMP/bot-api-build" --config Release --target telegram-bot-api --parallel 2
if ($LASTEXITCODE) { throw 'Native build failed' }
New-Item -ItemType Directory -Force dist | Out-Null
& "$env:VCPKG_INSTALLATION_ROOT/vcpkg.exe" list | Out-File -Encoding utf8 dist/build-environment.txt
Copy-Item "$env:RUNNER_TEMP/bot-api-build/Release/telegram-bot-api.exe" dist/

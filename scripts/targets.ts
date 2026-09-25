export const targets = [
  "linux-x64",
  "linux-x64-musl",
  "linux-arm64",
  "linux-arm64-musl",
  "darwin-x64",
  "darwin-arm64",
  "win32-x64",
] as const;
export const binaryName = (target: string): string =>
  target === "win32-x64" ? "telegram-bot-api.exe" : "telegram-bot-api";

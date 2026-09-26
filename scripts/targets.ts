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
/** Linux servers are fully static, so glibc and musl packages share one build. */
export const buildTarget = (target: string): string =>
  target.replace(/-musl$/, "");
export const buildTargets: string[] = [...new Set(targets.map(buildTarget))];

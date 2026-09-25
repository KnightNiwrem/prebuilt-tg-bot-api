import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);

/** Detect the host C library without executing a shell or requiring --allow-sys. */
export function detectLibc() {
  // Prefer the runtime's libc on Node: glibc hosts can also have musl installed.
  // Deno's compatibility report needs --allow-sys, so use filesystem probes there.
  if (!("Deno" in globalThis) && process.report?.getReport) {
    try {
      const report = process.report.getReport();
      if (report.header?.glibcVersionRuntime) return "glibc";
      if (report.sharedObjects?.some((path) => /musl/.test(path))) {
        return "musl";
      }
    } catch { /* Fall back if diagnostic reports are unavailable. */ }
  }
  try {
    const ldd = readFileSync("/usr/bin/ldd", "utf8");
    if (ldd.includes("musl")) return "musl";
    if (/GNU|GLIBC|glibc/.test(ldd)) return "glibc";
  } catch { /* Some minimal images don't ship ldd. */ }
  try {
    if (readdirSync("/lib").some((name) => /^ld-musl-.*\.so\.1$/.test(name))) {
      return "musl";
    }
  } catch { /* Try the remaining probes. */ }
  if (
    existsSync("/lib64/ld-linux-x86-64.so.2") ||
    existsSync("/lib/ld-linux-aarch64.so.1")
  ) {
    return "glibc";
  }
  throw new Error(
    "Cannot determine Linux libc. Set TELEGRAM_BOT_API_BINARY to a compatible executable.",
  );
}

/** Return the npm platform suffix, rejecting unsupported combinations. */
export function targetFor(platform, arch, libc) {
  if (
    platform === "linux" && ["x64", "arm64"].includes(arch) &&
    ["glibc", "musl"].includes(libc)
  ) {
    return `linux-${arch}${libc === "musl" ? "-musl" : ""}`;
  }
  if (platform === "darwin" && ["x64", "arm64"].includes(arch)) {
    return `darwin-${arch}`;
  }
  if (platform === "win32" && arch === "x64") return "win32-x64";
  throw new Error(
    `Unsupported Telegram Bot API target: ${platform}-${arch}${
      libc ? `-${libc}` : ""
    }. Set TELEGRAM_BOT_API_BINARY to a custom build.`,
  );
}

/** Resolve the installed optional package. Never downloads or runs install scripts. */
export function resolveBinaryPath() {
  const target = targetFor(
    process.platform,
    process.arch,
    process.platform === "linux" ? detectLibc() : undefined,
  );
  const name = `@deerdaily/bot-api-${target}`;
  try {
    const entry = require.resolve(name);
    const binary = join(
      dirname(entry),
      "bin",
      process.platform === "win32"
        ? "telegram-bot-api.exe"
        : "telegram-bot-api",
    );
    if (!existsSync(binary)) throw new Error(`Missing executable: ${binary}`);
    return binary;
  } catch (cause) {
    throw new Error(
      `Cannot resolve ${name}. Install optional dependencies (do not use --omit=optional), or set TELEGRAM_BOT_API_BINARY.`,
      { cause },
    );
  }
}

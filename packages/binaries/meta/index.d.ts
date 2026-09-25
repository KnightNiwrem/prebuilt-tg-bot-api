/** Detect Linux's C library without spawning a process. */
export declare function detectLibc(): "glibc" | "musl";
/** Map a supported OS, architecture, and C library to a package suffix. */
export declare function targetFor(
  platform: string,
  arch: string,
  libc?: string,
): string;
/** Return the absolute path of the installed native server. */
export declare function resolveBinaryPath(): string;

import { join, resolve } from "node:path";

async function exists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** Follow npm.cmd's PATH/prefix selection without passing user arguments to cmd.exe. */
export async function windowsNpmInvocation(
  args: string[],
  paths = (Deno.env.get("PATH") ?? "").split(";"),
): Promise<{ executable: string; argv: string[] }> {
  for (const entry of paths) {
    if (!entry) continue;
    const directory = resolve(entry.replace(/^"|"$/g, ""));
    // Version-manager native shims (for example Volta) can execute directly.
    const exe = join(directory, "npm.exe");
    if (await exists(exe)) return { executable: exe, argv: args };
    if (!await exists(join(directory, "npm.cmd"))) continue;
    let cli = join(directory, "node_modules", "npm", "bin", "npm-cli.js");
    if (!await exists(cli)) {
      throw new Error(
        `Unsupported npm.cmd shim in ${directory}; use an npm installation with its JavaScript entrypoint`,
      );
    }
    const localNode = join(directory, "node.exe");
    const executable = await exists(localNode) ? localNode : "node";
    const prefixScript = join(
      directory,
      "node_modules",
      "npm",
      "bin",
      "npm-prefix.js",
    );
    if (await exists(prefixScript)) {
      const result = await new Deno.Command(executable, {
        args: [prefixScript],
        stdout: "piped",
        stderr: "inherit",
      }).output();
      if (!result.success) {
        throw new Error("Cannot resolve npm's configured global prefix");
      }
      const prefix = new TextDecoder().decode(result.stdout).trim();
      const upgraded = join(prefix, "node_modules", "npm", "bin", "npm-cli.js");
      if (prefix && await exists(upgraded)) cli = upgraded;
    }
    return { executable, argv: [cli, ...args] };
  }
  throw new Error("Cannot locate npm on PATH");
}

/** CI helper; run npm's JavaScript entrypoint directly on Windows, without a shell. */
async function invocation(
  program: string,
  args: string[],
): Promise<{ executable: string; argv: string[] }> {
  if (program === "npm" && Deno.build.os === "windows") {
    return await windowsNpmInvocation(args);
  }
  return { executable: program, argv: args };
}

export async function command(
  program: string,
  args: string[],
  options: Deno.CommandOptions = {},
): Promise<string> {
  const { executable, argv } = await invocation(program, args);
  const result = await new Deno.Command(executable, {
    ...options,
    args: argv,
    stdout: "piped",
    stderr: "inherit",
  }).output();
  const output = new TextDecoder().decode(result.stdout);
  if (!result.success) {
    throw new Error(`${program} ${args[0]} failed (${result.code}): ${output}`);
  }
  return output;
}

/** Preserve npm's interactive browser/OTP authentication on the maintainer's CLI. */
export async function interactiveCommand(
  program: string,
  args: string[],
): Promise<void> {
  const { executable, argv } = await invocation(program, args);
  const process = new Deno.Command(executable, {
    args: argv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await process.status;
  if (!status.success) {
    throw new Error(`${program} ${args[0]} failed (${status.code})`);
  }
}

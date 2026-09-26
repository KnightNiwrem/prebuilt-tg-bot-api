import { join, resolve } from "node:path";

async function exists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** Select npm's CLI on Windows using the permitted Node on PATH, without cmd.exe. */
export async function windowsNpmInvocation(
  args: string[],
  paths = (Deno.env.get("PATH") ?? "").split(";"),
  cwd?: Deno.CommandOptions["cwd"],
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
    // The release task grants --allow-run=node for the runtime selected on PATH.
    // A different node.exe beside npm.cmd may be outside that permission.
    const executable = "node";
    const prefixScript = join(
      directory,
      "node_modules",
      "npm",
      "bin",
      "npm-prefix.js",
    );
    if (await exists(prefixScript)) {
      const result = await new Deno.Command(executable, {
        cwd,
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
  cwd?: Deno.CommandOptions["cwd"],
): Promise<{ executable: string; argv: string[] }> {
  if (program === "npm" && Deno.build.os === "windows") {
    return await windowsNpmInvocation(args, undefined, cwd);
  }
  return { executable: program, argv: args };
}

export async function command(
  program: string,
  args: string[],
  options: Deno.CommandOptions = {},
): Promise<string> {
  const { executable, argv } = await invocation(program, args, options.cwd);
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

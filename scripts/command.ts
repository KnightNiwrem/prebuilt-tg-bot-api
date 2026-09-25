import { dirname, join } from "node:path";

let windowsNpm: string | undefined;

/** CI helper; run npm's JavaScript entrypoint directly on Windows, without a shell. */
export async function command(
  program: string,
  args: string[],
  options: Deno.CommandOptions = {},
): Promise<string> {
  let executable = program;
  let argv = args;
  if (program === "npm" && Deno.build.os === "windows") {
    if (!windowsNpm) {
      const node = await new Deno.Command("node", {
        args: ["-p", "process.execPath"],
        stdout: "piped",
      }).output();
      if (!node.success) throw new Error("Cannot locate the Node installation");
      windowsNpm = join(
        dirname(new TextDecoder().decode(node.stdout).trim()),
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      );
      await Deno.stat(windowsNpm);
    }
    executable = "node";
    argv = [windowsNpm, ...args];
  }
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

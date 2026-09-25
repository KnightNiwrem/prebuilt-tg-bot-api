/** CI helper; npm's Windows shim requires cmd.exe. Only trusted build args enter here. */
export async function command(
  program: string,
  args: string[],
  options: Deno.CommandOptions = {},
): Promise<string> {
  let executable = program;
  let argv = args;
  if (program === "npm" && Deno.build.os === "windows") {
    if (args.some((arg) => /["%\r\n]/.test(arg))) {
      throw new Error("Unsafe npm shim argument");
    }
    executable = "cmd.exe";
    argv = ["/d", "/s", "/c", `npm ${args.map((arg) => `"${arg}"`).join(" ")}`];
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

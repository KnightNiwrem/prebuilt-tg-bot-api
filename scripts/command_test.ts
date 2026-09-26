import assert from "node:assert/strict";
import { join } from "node:path";
import { windowsNpmInvocation } from "./command.ts";

Deno.test("Windows npm follows PATH and a global CLI upgrade without using a shell", async () => {
  const root = await Deno.makeTempDir({ prefix: "bot-api-npm-resolution-" });
  const user = join(root, "user tools"),
    bundled = join(root, "bundled"),
    upgraded = join(root, "global upgrade");
  const cli = (directory: string) =>
    join(directory, "node_modules", "npm", "bin", "npm-cli.js");
  try {
    for (const directory of [user, bundled, upgraded]) {
      await Deno.mkdir(join(directory, "node_modules", "npm", "bin"), {
        recursive: true,
      });
      await Deno.writeTextFile(join(directory, "npm.cmd"), "fixture shim");
      await Deno.writeTextFile(
        cli(directory),
        "console.log(JSON.stringify(process.argv.slice(2)))",
      );
    }
    const args = ["stage", "view", "literal & text", "$(not-a-command)"];
    assert.deepEqual((await windowsNpmInvocation(args, [user, bundled])).argv, [
      cli(user),
      ...args,
    ]);
    await Deno.writeTextFile(
      join(user, "node_modules", "npm", "bin", "npm-prefix.js"),
      `console.log(${JSON.stringify(upgraded)})`,
    );
    const selected = await windowsNpmInvocation(args, [user, bundled]);
    assert.deepEqual(selected.argv, [cli(upgraded), ...args]);
    const result = await new Deno.Command(selected.executable, {
      args: selected.argv,
      stdout: "piped",
    }).output();
    assert.ok(result.success);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(result.stdout)), args);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

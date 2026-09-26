import assert from "node:assert/strict";
import { join } from "node:path";
import { command, windowsNpmInvocation } from "./command.ts";

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

async function npmFixture(
  directory: string,
  prefixSource: string,
): Promise<string> {
  const bin = join(directory, "node_modules", "npm", "bin");
  await Deno.mkdir(bin, { recursive: true });
  await Deno.writeTextFile(join(directory, "npm.cmd"), "fixture shim");
  await Deno.writeTextFile(join(bin, "npm-prefix.js"), prefixSource);
  const cli = join(bin, "npm-cli.js");
  await Deno.writeTextFile(cli, 'console.log("selected fixture CLI")');
  return cli;
}

Deno.test("Windows npm uses the permitted PATH runtime when a different paired node exists", async () => {
  const root = await Deno.makeTempDir({ prefix: "bot-api-npm-permission-" });
  try {
    await npmFixture(root, `console.log(${JSON.stringify(root)})`);
    // This paired runtime is outside --allow-run=node. It must not be executed.
    await Deno.writeTextFile(
      join(root, "node.exe"),
      "unselected runtime fixture",
    );
    const script = join(root, "permission-test.ts");
    await Deno.writeTextFile(
      script,
      `
      import { windowsNpmInvocation } from ${
        JSON.stringify(new URL("./command.ts", import.meta.url).href)
      };
      const invocation = await windowsNpmInvocation([], [Deno.args[0]]);
      const result = await new Deno.Command(invocation.executable, { args: invocation.argv, stdout: "piped" }).output();
      if (!result.success) Deno.exit(result.code);
      console.log(new TextDecoder().decode(result.stdout).trim());
    `,
    );
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-config",
        "--no-prompt",
        "--allow-read",
        "--allow-env",
        "--allow-run=node",
        script,
        root,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert.ok(result.success, new TextDecoder().decode(result.stderr));
    assert.equal(
      new TextDecoder().decode(result.stdout).trim(),
      "selected fixture CLI",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Windows npm prefix selection uses the final command's working directory", async () => {
  const root = await Deno.makeTempDir({ prefix: "bot-api-npm-cwd-" });
  const install = join(root, "install"),
    cwd = join(root, "package"),
    upgraded = join(root, "upgrade");
  const previousPath = Deno.env.get("PATH");
  try {
    const expected = await npmFixture(upgraded, 'console.log("")');
    await npmFixture(
      install,
      'console.log(require("node:fs").readFileSync("npm-prefix-fixture.txt", "utf8"))',
    );
    await Deno.mkdir(cwd);
    await Deno.writeTextFile(join(cwd, "npm-prefix-fixture.txt"), upgraded);
    const selected = await windowsNpmInvocation([], [install], cwd);
    assert.equal(selected.argv[0], expected);
    if (Deno.build.os === "windows") {
      Deno.env.set("PATH", `${install};${previousPath ?? ""}`);
      assert.equal(
        (await command("npm", [], { cwd })).trim(),
        "selected fixture CLI",
      );
    }
  } finally {
    if (previousPath === undefined) Deno.env.delete("PATH");
    else Deno.env.set("PATH", previousPath);
    await Deno.remove(root, { recursive: true });
  }
});

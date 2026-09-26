import { appendFile } from "node:fs/promises";
import { bump } from "./bump-upstream.ts";
import { command } from "./command.ts";

const pin = JSON.parse(await Deno.readTextFile("upstream.json"));
const api = async (path: string) =>
  JSON.parse(await command("gh", ["api", `repos/${pin.repository}/${path}`]));
const tags = JSON.parse(
  await command("gh", [
    "api",
    "--paginate",
    "--slurp",
    `repos/${pin.repository}/tags?per_page=100`,
  ]),
).flat() as Array<
  { name: string; commit: { sha: string } }
>;
const releases = tags.filter((tag) => /^v?\d+\.\d+(?:\.\d+)?$/.test(tag.name));
function parts(version: string): number[] {
  return version.replace(/^v/, "").split(".").map(Number);
}
function compare(a: string, b: string): number {
  const left = parts(a), right = parts(b);
  for (let i = 0; i < 3; i++) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) {
      return (left[i] ?? 0) - (right[i] ?? 0);
    }
  }
  return 0;
}
releases.sort((a, b) => compare(b.name, a.name));
let ref: string, version: string, tag: string | null;
if (releases.length) {
  tag = releases[0].name;
  // Resolve annotated tags through the commits API to an immutable commit.
  ref = (await api(`commits/${encodeURIComponent(tag)}`)).sha;
  version = [...parts(tag), 0].slice(0, 3).join(".");
} else {
  const commits = await api("commits?path=CMakeLists.txt&per_page=1");
  ref = commits[0].sha;
  const file = await api(`contents/CMakeLists.txt?ref=${ref}`);
  const cmake = atob(file.content.replace(/\s/g, ""));
  const match = cmake.match(
    /project\(TelegramBotApi VERSION (\d+\.\d+(?:\.\d+)?)/,
  );
  if (!match) {
    throw new Error(
      "Upstream CMake version declaration changed; manual review required",
    );
  }
  version = [...parts(match[1]), 0].slice(0, 3).join(".");
  tag = null;
}
if (compare(version, pin.version.split("-")[0]) <= 0) {
  console.log(`No newer upstream version (pinned ${pin.version}).`);
} else {
  await bump(ref, version, tag);
  const output = Deno.env.get("GITHUB_OUTPUT");
  if (output) await appendFile(output, `version=${version}\nchanged=true\n`);
}

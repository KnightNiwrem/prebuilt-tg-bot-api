import { command } from "./command.ts";
const id = Deno.args[0];
if (!/^\d+$/.test(id)) throw new Error("Expected a numeric build run ID");
const repo = Deno.env.get("GITHUB_REPOSITORY")!;
const run = JSON.parse(
  await command("gh", ["api", `repos/${repo}/actions/runs/${id}`]),
);
if (
  run.conclusion !== "success" || run.head_sha !== Deno.env.get("GITHUB_SHA") ||
  run.path !== ".github/workflows/build-binaries.yml" ||
  run.event === "pull_request"
) {
  throw new Error(
    "Publication requires a successful build-binaries run for this exact commit, outside pull_request events",
  );
}
console.log(`Validated successful build ${id} at ${run.head_sha}`);

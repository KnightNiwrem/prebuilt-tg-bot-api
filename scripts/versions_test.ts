import assert from "node:assert/strict";
import { validatePin } from "./bump-upstream.ts";
import { checkVersions } from "./check-versions.ts";

Deno.test(
  "release metadata and static dependency pin stay in sync",
  checkVersions,
);
Deno.test("upstream pins reject moving references and platform versions", () => {
  const sha = "a".repeat(40);
  validatePin(sha, "10.3.0", null);
  validatePin(sha, "10.3.0-build.2", "v10.3");
  assert.throws(() => validatePin("master", "10.3.0", null));
  assert.throws(() => validatePin(sha, "10.3.0-linux-x64", null));
  assert.throws(() => validatePin(sha, "latest", null));
});

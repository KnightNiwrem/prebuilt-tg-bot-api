import assert from "node:assert/strict";
import { nativeJob } from "./verify-reuse.ts";

Deno.test("native reuse rejects workflow defaults that can change build execution", () => {
  const workflow =
    "name: Build\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps: []\n  smoke:\n    steps: []\n";
  assert.match(nativeJob(workflow), /runs-on/);
  for (
    const globals of [
      "env:\n  CFLAGS: changed\n",
      "defaults:\n  run:\n    shell: pwsh\n",
      "defaults:\n  run:\n    working-directory: other\n",
    ]
  ) assert.throws(() => nativeJob(globals + workflow), /environment\/defaults/);
});

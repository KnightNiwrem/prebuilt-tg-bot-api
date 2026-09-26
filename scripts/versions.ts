import assert from "node:assert/strict";

export const binaryVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-build\.(0|[1-9]\d*))?$/;

export function versionParts(
  version: string,
): { base: bigint[]; build?: bigint } {
  const match = version.match(binaryVersionPattern);
  assert.ok(
    match,
    "Expected canonical x.y.z or x.y.z-build.N (no leading zeroes)",
  );
  return {
    base: match.slice(1, 4).map(BigInt),
    build: match[4] === undefined ? undefined : BigInt(match[4]),
  };
}

/** Rebuild counters advance independently of SemVer prerelease precedence. */
export function validateVersionAdvance(previous: string, next: string): void {
  const old = versionParts(previous), current = versionParts(next);
  for (let i = 0; i < 3; i++) {
    if (current.base[i] > old.base[i]) return;
    assert.ok(
      current.base[i] >= old.base[i],
      "Cannot move to an older upstream version",
    );
  }
  assert.notEqual(next, previous, "An existing version cannot be changed");
  // A stable upstream release may be followed by -build.1; exact dependency
  // pins deliberately do not follow SemVer's stable-over-prerelease ordering.
  if (old.build !== undefined && current.build !== undefined) {
    assert.ok(current.build > old.build, "Rebuild number must increase");
  }
}

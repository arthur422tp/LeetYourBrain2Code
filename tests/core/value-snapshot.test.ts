import { describe, expect, it } from "vitest";

import type { ValueSnapshot } from "../../src/shared/trace-types";
import { valueSnapshotsEqual } from "../../src/core/value-snapshot";

describe("valueSnapshotsEqual", () => {
  it("compares snapshot data rather than object property insertion order", () => {
    const first = {
      type: "unknown",
      className: "Node",
      repr: "<Node>"
    } as ValueSnapshot;
    const second = {
      repr: "<Node>",
      type: "unknown",
      className: "Node"
    } as ValueSnapshot;

    expect(valueSnapshotsEqual(first, second)).toBe(true);
  });
});

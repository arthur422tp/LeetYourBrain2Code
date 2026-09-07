import { describe, expect, it } from "vitest";

import type { ObjectTopologyState } from "../../src/core/runtime-state";
import type { ObjectSnapshot, ValueSnapshot } from "../../src/shared/trace-types";
import { diffObjectTopology } from "../../src/core/object-diff";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function node(objectId: string, value: number, nextObjectId: string | null): ObjectSnapshot {
  return {
    objectId,
    className: "ListNode",
    attributes: {
      val: int(value),
      next: nextObjectId === null
        ? { type: "none", value: null }
        : { type: "reference", objectId: nextObjectId, className: "ListNode" }
    }
  };
}

function topology(objects: Record<string, ObjectSnapshot>): ObjectTopologyState {
  return { objects: new Map(Object.entries(objects)), truncated: false };
}

describe("diffObjectTopology", () => {
  it("distinguishes next-edge mutation from local pointer movement", () => {
    const before = topology({
      "obj-1": node("obj-1", 1, "obj-2"),
      "obj-2": node("obj-2", 2, null)
    });
    const after = topology({
      "obj-1": node("obj-1", 1, null),
      "obj-2": node("obj-2", 2, null)
    });

    expect(diffObjectTopology(before, after).attributeChanges).toEqual([
      expect.objectContaining({ objectId: "obj-1", attribute: "next", kind: "changed" })
    ]);
  });

  it("sorts added and removed object ids deterministically", () => {
    const before = topology({ "obj-3": node("obj-3", 3, null) });
    const after = topology({
      "obj-1": node("obj-1", 1, null),
      "obj-2": node("obj-2", 2, null)
    });

    expect(diffObjectTopology(before, after)).toEqual({
      addedObjectIds: ["obj-1", "obj-2"],
      removedObjectIds: ["obj-3"],
      attributeChanges: []
    });
  });
});

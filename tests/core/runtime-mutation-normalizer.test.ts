import { describe, expect, it } from "vitest";

import { normalizeRuntimeMutations } from "../../src/core/runtime-mutation-normalizer";
import type { FrameDiff } from "../../src/core/state-diff";
import type { ObjectDiff } from "../../src/core/object-diff";
import type { ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const none = (): ValueSnapshot => ({ type: "none", value: null });
const reference = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "ListNode"
});

const emptyObjects: ObjectDiff = {
  addedObjectIds: [],
  removedObjectIds: [],
  attributeChanges: []
};

function normalize(
  frameDiff: FrameDiff | null,
  origin: "initial_snapshot" | "transition" = "transition"
) {
  return normalizeRuntimeMutations({
    frameDiff,
    objectDiff: emptyObjects,
    frameOrigin: origin,
    objectOrigin: origin
  });
}

describe("normalizeRuntimeMutations local variables", () => {
  it("emits scalar add/remove/change but never unchanged", () => {
    const result = normalize({
      frameId: 4,
      variables: [
        { name: "left", kind: "changed", before: int(2), after: int(3) },
        { name: "count", kind: "added", after: int(0) },
        { name: "old", kind: "removed", before: int(9) },
        { name: "right", kind: "unchanged", before: int(5), after: int(5) }
      ],
      containerChanges: []
    });

    expect(result).toEqual([
      {
        kind: "variable",
        origin: "transition",
        frameId: 4,
        variableName: "count",
        action: "added",
        after: int(0)
      },
      {
        kind: "variable",
        origin: "transition",
        frameId: 4,
        variableName: "left",
        action: "changed",
        before: int(2),
        after: int(3)
      },
      {
        kind: "variable",
        origin: "transition",
        frameId: 4,
        variableName: "old",
        action: "removed",
        before: int(9)
      }
    ]);
  });

  it("normalizes local reference bind, redirect, and unbind", () => {
    const result = normalize({
      frameId: 7,
      variables: [
        { name: "a", kind: "added", after: reference("obj-1") },
        { name: "b", kind: "changed", before: reference("obj-1"), after: reference("obj-2") },
        { name: "c", kind: "changed", before: reference("obj-3"), after: none() }
      ],
      containerChanges: []
    });

    expect(result).toEqual([
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 7, variableName: "a" },
        action: "bound",
        beforeObjectId: null,
        afterObjectId: "obj-1"
      },
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 7, variableName: "b" },
        action: "redirected",
        beforeObjectId: "obj-1",
        afterObjectId: "obj-2"
      },
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 7, variableName: "c" },
        action: "unbound",
        beforeObjectId: "obj-3",
        afterObjectId: null
      }
    ]);
  });

  it("keeps reference-to-scalar transitions lossless as ordinary variable changes", () => {
    const result = normalize({
      frameId: 1,
      variables: [{ name: "x", kind: "changed", before: reference("obj-1"), after: int(5) }],
      containerChanges: []
    });

    expect(result).toEqual([{
      kind: "variable",
      origin: "transition",
      frameId: 1,
      variableName: "x",
      action: "changed",
      before: reference("obj-1"),
      after: int(5)
    }]);
  });

  it("preserves initial snapshot origin", () => {
    expect(normalize({
      frameId: 1,
      variables: [{ name: "head", kind: "added", after: reference("obj-1") }],
      containerChanges: []
    }, "initial_snapshot")[0]).toMatchObject({ origin: "initial_snapshot" });
  });
});

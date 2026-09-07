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

describe("normalizeRuntimeMutations structural and object changes", () => {
  it("prefers granular list changes over duplicate coarse variable changes", () => {
    const before: ValueSnapshot = {
      type: "list",
      length: 3,
      items: [int(1), int(2), int(3)],
      truncated: false
    };
    const after: ValueSnapshot = {
      type: "list",
      length: 3,
      items: [int(1), int(9), int(3)],
      truncated: false
    };

    const result = normalizeRuntimeMutations({
      frameDiff: {
        frameId: 4,
        variables: [{ name: "nums", kind: "changed", before, after }],
        containerChanges: [{
          container: "nums",
          kind: "list",
          changes: [{ index: 1, kind: "changed", before: int(2), after: int(9) }]
        }]
      },
      objectDiff: emptyObjects,
      frameOrigin: "transition",
      objectOrigin: "transition"
    });

    expect(result).toEqual([{
      kind: "sequence_element",
      origin: "transition",
      frameId: 4,
      containerName: "nums",
      containerKind: "list",
      index: 1,
      action: "changed",
      before: int(2),
      after: int(9)
    }]);
  });

  it("normalizes tuple additions and removals as sequence changes", () => {
    const result = normalizeRuntimeMutations({
      frameDiff: {
        frameId: 4,
        variables: [],
        containerChanges: [{
          container: "values",
          kind: "tuple",
          changes: [
            { index: 0, kind: "removed", before: int(3) },
            { index: 2, kind: "added", after: int(8) }
          ]
        }]
      },
      objectDiff: emptyObjects,
      frameOrigin: "transition",
      objectOrigin: "transition"
    });

    expect(result).toEqual([
      {
        kind: "sequence_element",
        origin: "transition",
        frameId: 4,
        containerName: "values",
        containerKind: "tuple",
        index: 0,
        action: "removed",
        before: int(3)
      },
      {
        kind: "sequence_element",
        origin: "transition",
        frameId: 4,
        containerName: "values",
        containerKind: "tuple",
        index: 2,
        action: "added",
        after: int(8)
      }
    ]);
  });

  it("normalizes dict and set changes", () => {
    const key: ValueSnapshot = { type: "str", value: "a", length: 1, truncated: false };
    const result = normalizeRuntimeMutations({
      frameDiff: {
        frameId: 2,
        variables: [],
        containerChanges: [
          { container: "mapping", kind: "dict", changes: [{ key, kind: "added", after: int(1) }] },
          { container: "seen", kind: "set", changes: [{ member: int(7), kind: "added" }] }
        ]
      },
      objectDiff: emptyObjects,
      frameOrigin: "transition",
      objectOrigin: "transition"
    });

    expect(result).toEqual([
      {
        kind: "mapping_entry",
        origin: "transition",
        frameId: 2,
        containerName: "mapping",
        key,
        action: "added",
        after: int(1)
      },
      {
        kind: "set_membership",
        origin: "transition",
        frameId: 2,
        containerName: "seen",
        action: "added",
        member: int(7)
      }
    ]);
  });

  it("normalizes object reference redirects and scalar attributes", () => {
    const result = normalizeRuntimeMutations({
      frameDiff: null,
      objectDiff: {
        addedObjectIds: [],
        removedObjectIds: [],
        attributeChanges: [
          {
            objectId: "obj-2",
            attribute: "next",
            kind: "changed",
            before: reference("obj-3"),
            after: reference("obj-1")
          },
          {
            objectId: "obj-2",
            attribute: "val",
            kind: "changed",
            before: int(2),
            after: int(4)
          }
        ]
      },
      frameOrigin: "transition",
      objectOrigin: "transition"
    });

    expect(result).toEqual([
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "object_attribute", objectId: "obj-2", attribute: "next" },
        action: "redirected",
        beforeObjectId: "obj-3",
        afterObjectId: "obj-1"
      },
      {
        kind: "object_attribute",
        origin: "transition",
        objectId: "obj-2",
        attribute: "val",
        action: "changed",
        before: int(2),
        after: int(4)
      }
    ]);
  });

  it("keeps mixed reference-to-scalar attributes lossless", () => {
    const result = normalizeRuntimeMutations({
      frameDiff: null,
      objectDiff: {
        addedObjectIds: [],
        removedObjectIds: [],
        attributeChanges: [{
          objectId: "obj-2",
          attribute: "next",
          kind: "changed",
          before: reference("obj-3"),
          after: int(1)
        }]
      },
      frameOrigin: "transition",
      objectOrigin: "transition"
    });

    expect(result).toEqual([{
      kind: "object_attribute",
      origin: "transition",
      objectId: "obj-2",
      attribute: "next",
      action: "changed",
      before: reference("obj-3"),
      after: int(1)
    }]);
  });

  it("uses capture visibility copy semantics rather than allocation semantics", () => {
    const result = normalizeRuntimeMutations({
      frameDiff: null,
      objectDiff: {
        addedObjectIds: ["obj-4"],
        removedObjectIds: ["obj-7"],
        attributeChanges: []
      },
      frameOrigin: "transition",
      objectOrigin: "transition"
    });

    expect(result).toEqual([
      { kind: "object_visibility", origin: "transition", objectId: "obj-4", action: "appeared" },
      { kind: "object_visibility", origin: "transition", objectId: "obj-7", action: "disappeared" }
    ]);
  });

  it("retains origins on object visibility events", () => {
    const result = normalizeRuntimeMutations({
      frameDiff: null,
      objectDiff: {
        addedObjectIds: ["obj-1"],
        removedObjectIds: [],
        attributeChanges: []
      },
      frameOrigin: "transition",
      objectOrigin: "initial_snapshot"
    });

    expect(result).toEqual([{
      kind: "object_visibility",
      origin: "initial_snapshot",
      objectId: "obj-1",
      action: "appeared"
    }]);
  });

  it("orders mixed mutations by category and clones all emitted snapshots", () => {
    const localBefore = {
      type: "reference",
      objectId: "obj-1",
      className: "ListNode"
    } as Extract<ValueSnapshot, { type: "reference" }>;
    const localAfter = {
      type: "reference",
      objectId: "obj-2",
      className: "ListNode"
    } as Extract<ValueSnapshot, { type: "reference" }>;
    const mutableInt = (value: number) => ({
      type: "int",
      value: String(value)
    } as Extract<ValueSnapshot, { type: "int" }>);
    const scalarBefore = mutableInt(2);
    const scalarAfter = mutableInt(3);
    const sequenceBefore = mutableInt(4);
    const sequenceAfter = mutableInt(5);
    const mappingKey = {
      type: "str",
      value: "key",
      length: 3,
      truncated: false
    } as Extract<ValueSnapshot, { type: "str" }>;
    const mappingAfter = mutableInt(6);
    const setMember = mutableInt(7);
    const objectReferenceBefore = {
      type: "reference",
      objectId: "obj-4",
      className: "ListNode"
    } as Extract<ValueSnapshot, { type: "reference" }>;
    const objectReferenceAfter = {
      type: "reference",
      objectId: "obj-5",
      className: "ListNode"
    } as Extract<ValueSnapshot, { type: "reference" }>;
    const attributeBefore = mutableInt(8);
    const attributeAfter = mutableInt(9);

    const result = normalizeRuntimeMutations({
      frameDiff: {
        frameId: 4,
        variables: [
          { name: "plain", kind: "changed", before: scalarBefore, after: scalarAfter },
          { name: "pointer", kind: "changed", before: localBefore, after: localAfter }
        ],
        containerChanges: [
          {
            container: "items",
            kind: "list",
            changes: [{ index: 1, kind: "changed", before: sequenceBefore, after: sequenceAfter }]
          },
          {
            container: "mapping",
            kind: "dict",
            changes: [{ key: mappingKey, kind: "added", after: mappingAfter }]
          },
          {
            container: "seen",
            kind: "set",
            changes: [{ member: setMember, kind: "added" }]
          }
        ]
      },
      objectDiff: {
        addedObjectIds: ["obj-9"],
        removedObjectIds: ["obj-0"],
        attributeChanges: [
          {
            objectId: "obj-3",
            attribute: "next",
            kind: "changed",
            before: objectReferenceBefore,
            after: objectReferenceAfter
          },
          {
            objectId: "obj-2",
            attribute: "value",
            kind: "changed",
            before: attributeBefore,
            after: attributeAfter
          }
        ]
      },
      frameOrigin: "transition",
      objectOrigin: "transition"
    });

    expect(result.map((mutation) => {
      switch (mutation.kind) {
        case "reference":
          return `${mutation.owner.scope}:${mutation.owner.scope === "local"
            ? mutation.owner.variableName
            : `${mutation.owner.objectId}.${mutation.owner.attribute}`}`;
        case "variable":
          return `variable:${mutation.variableName}`;
        case "sequence_element":
          return `sequence:${mutation.containerName}[${mutation.index}]`;
        case "mapping_entry":
          return `mapping:${mutation.containerName}`;
        case "set_membership":
          return `set:${mutation.containerName}`;
        case "object_visibility":
          return `visibility:${mutation.objectId}`;
        case "object_attribute":
          return `attribute:${mutation.objectId}.${mutation.attribute}`;
      }
    })).toEqual([
      "local:pointer",
      "variable:plain",
      "sequence:items[1]",
      "mapping:mapping",
      "set:seen",
      "visibility:obj-0",
      "visibility:obj-9",
      "object_attribute:obj-3.next",
      "attribute:obj-2.value"
    ]);

    localBefore.objectId = "mutated";
    localAfter.objectId = "mutated";
    scalarBefore.value = "mutated";
    scalarAfter.value = "mutated";
    sequenceBefore.value = "mutated";
    sequenceAfter.value = "mutated";
    mappingKey.value = "mutated";
    mappingAfter.value = "mutated";
    setMember.value = "mutated";
    objectReferenceBefore.objectId = "mutated";
    objectReferenceAfter.objectId = "mutated";
    attributeBefore.value = "mutated";
    attributeAfter.value = "mutated";

    expect(result).toContainEqual(expect.objectContaining({
      kind: "reference",
      owner: { scope: "local", frameId: 4, variableName: "pointer" },
      beforeObjectId: "obj-1",
      afterObjectId: "obj-2"
    }));
    expect(result).toContainEqual(expect.objectContaining({
      kind: "variable",
      variableName: "plain",
      before: int(2),
      after: int(3)
    }));
    expect(result).toContainEqual(expect.objectContaining({
      kind: "mapping_entry",
      key: { type: "str", value: "key", length: 3, truncated: false },
      after: int(6)
    }));
    expect(result).toContainEqual(expect.objectContaining({
      kind: "object_attribute",
      objectId: "obj-2",
      attribute: "value",
      before: int(8),
      after: int(9)
    }));
  });
});

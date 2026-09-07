import { describe, expect, it } from "vitest";

import type { RuntimeState } from "../../src/core/runtime-state";
import {
  buildLinkedListVisuals,
  type LinkedListVisualModel
} from "../../src/core/linked-list-interpreter";
import type { RuntimeMutation } from "../../src/core/runtime-mutation";
import type { ObjectSnapshot, ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

const ref = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "ListNode"
});

function node(objectId: string, value: number, nextObjectId: string | null): ObjectSnapshot {
  return {
    objectId,
    className: "ListNode",
    attributes: {
      val: int(value),
      next: nextObjectId === null ? { type: "none", value: null } : ref(nextObjectId)
    }
  };
}

function runtimeWithLinkedList(input: {
  locals: Record<string, ValueSnapshot>;
  objects: ObjectSnapshot[];
  truncated?: boolean;
}): RuntimeState {
  return {
    step: 3,
    activeFrameId: 4,
    frames: new Map([[
      4,
      {
        frameId: 4,
        parentFrameId: null,
        functionName: "reverseList",
        line: 7,
        locals: input.locals
      }
    ]]),
    callStack: [4],
    currentLine: 7,
    stdout: "",
    objectTopology: {
      objects: new Map(input.objects.map((object) => [object.objectId, object])),
      truncated: input.truncated ?? false
    }
  };
}

describe("buildLinkedListVisuals", () => {
  it("builds one structure with pointer aliases instead of duplicate visuals", () => {
    const runtime = runtimeWithLinkedList({
      locals: {
        head: ref("obj-1"),
        curr: ref("obj-2"),
        slow: ref("obj-2")
      },
      objects: [
        node("obj-1", 1, "obj-2"),
        node("obj-2", 2, "obj-3"),
        node("obj-3", 3, null)
      ]
    });

    const visuals = buildLinkedListVisuals(runtime, []);

    expect(visuals).toHaveLength(1);
    expect(visuals[0]!.pointers).toEqual(expect.arrayContaining([
      expect.objectContaining({ variableName: "head", objectId: "obj-1" }),
      expect.objectContaining({ variableName: "curr", objectId: "obj-2" }),
      expect.objectContaining({ variableName: "slow", objectId: "obj-2" })
    ]));
    expect(visuals[0]!.nodes.map((item) => item.objectId)).toEqual([
      "obj-1",
      "obj-2",
      "obj-3"
    ]);
  });

  it("keeps partially reversed fragments as separate components", () => {
    const visuals = buildLinkedListVisuals(
      runtimeWithLinkedList({
        locals: { prev: { type: "none", value: null }, curr: ref("obj-1") },
        objects: [
          node("obj-1", 1, null),
          node("obj-2", 2, "obj-3"),
          node("obj-3", 3, null)
        ]
      }),
      []
    );

    expect(visuals[0]?.components).toEqual([
      { componentId: "component:obj-1", nodeIds: ["obj-1"], entryNodeIds: ["obj-1"] },
      { componentId: "component:obj-2", nodeIds: ["obj-2", "obj-3"], entryNodeIds: ["obj-2"] }
    ]);
  });

  it("detects cycles with finite node traversal", () => {
    const visual = buildLinkedListVisuals(
      runtimeWithLinkedList({
        locals: { head: ref("obj-1") },
        objects: [node("obj-1", 1, "obj-2"), node("obj-2", 2, "obj-1")]
      }),
      []
    )[0] as LinkedListVisualModel;

    expect(visual.cyclic).toBe(true);
    expect(visual.nodes).toHaveLength(2);
    expect(visual.components[0]?.entryNodeIds).toEqual([]);
  });

  it("marks pointer movement and next-edge mutations independently", () => {
    const mutations: RuntimeMutation[] = [
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 4, variableName: "curr" },
        action: "redirected",
        beforeObjectId: "obj-1",
        afterObjectId: "obj-2"
      },
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "object_attribute", objectId: "obj-1", attribute: "next" },
        action: "unbound",
        beforeObjectId: "obj-2",
        afterObjectId: null
      }
    ];
    const visual = buildLinkedListVisuals(
      runtimeWithLinkedList({
        locals: { curr: ref("obj-2") },
        objects: [node("obj-1", 1, null), node("obj-2", 2, null)]
      }),
      mutations
    )[0]!;

    expect(visual.pointers).toContainEqual({
      variableName: "curr",
      objectId: "obj-2",
      status: "moved"
    });
    expect(visual.nodes.find((item) => item.objectId === "obj-1")?.nextStatus).toBe("removed");
    expect(visual.nodes.find((item) => item.objectId === "obj-2")?.status).toBe("detached");
  });

  it("maps a redirected next reference to a changed edge", () => {
    const visual = buildLinkedListVisuals(
      runtimeWithLinkedList({
        locals: { head: ref("obj-1") },
        objects: [node("obj-1", 1, "obj-2"), node("obj-2", 2, null)]
      }),
      [{
        kind: "reference",
        origin: "transition",
        owner: { scope: "object_attribute", objectId: "obj-1", attribute: "next" },
        action: "redirected",
        beforeObjectId: "obj-3",
        afterObjectId: "obj-2"
      }]
    )[0]!;

    expect(visual.nodes.find((item) => item.objectId === "obj-1")?.nextStatus).toBe("changed");
  });

  it("uses visibility and attribute mutations for node status", () => {
    const visible = buildLinkedListVisuals(
      runtimeWithLinkedList({
        locals: { head: ref("obj-1") },
        objects: [node("obj-1", 1, null)]
      }),
      [{
        kind: "object_visibility",
        origin: "transition",
        objectId: "obj-1",
        action: "appeared"
      }]
    )[0]!;
    expect(visible.nodes[0]?.status).toBe("added");

    const changed = buildLinkedListVisuals(
      runtimeWithLinkedList({
        locals: { head: ref("obj-1") },
        objects: [node("obj-1", 1, null)]
      }),
      [{
        kind: "object_attribute",
        origin: "transition",
        objectId: "obj-1",
        attribute: "val",
        action: "changed",
        before: int(1),
        after: int(2)
      }]
    )[0]!;
    expect(changed.nodes[0]?.status).toBe("changed");
  });

  it("recognizes arbitrary node class names and reports dangling topology as truncated", () => {
    const customObject: ObjectSnapshot = {
      objectId: "obj-9",
      className: "CustomNode",
      attributes: {
        data: int(9),
        next: ref("obj-missing")
      }
    };

    const visual = buildLinkedListVisuals(
      runtimeWithLinkedList({
        locals: { head: ref("obj-9") },
        objects: [customObject]
      }),
      []
    )[0]!;

    expect(visual.nodes[0]).toEqual(expect.objectContaining({
      className: "CustomNode",
      label: int(9),
      nextObjectId: "obj-missing"
    }));
    expect(visual.truncated).toBe(true);
  });
});

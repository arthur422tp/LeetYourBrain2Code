import { describe, expect, it } from "vitest";

import type { RuntimeState } from "../../src/core/runtime-state";
import { buildTreeVisuals } from "../../src/core/tree-interpreter";
import type { RuntimeMutation } from "../../src/core/runtime-mutation";
import type { ObjectSnapshot, ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const none = (): ValueSnapshot => ({ type: "none", value: null });
const treeRef = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "TreeNode"
});
const otherRef = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "OtherNode"
});

function treeNode(
  objectId: string,
  value: number | null,
  leftObjectId: string | null,
  rightObjectId: string | null
): ObjectSnapshot {
  return {
    objectId,
    className: "TreeNode",
    attributes: {
      ...(value === null ? {} : { val: int(value) }),
      left: leftObjectId === null ? none() : treeRef(leftObjectId),
      right: rightObjectId === null ? none() : treeRef(rightObjectId)
    }
  };
}

function runtimeWithTree(input: {
  locals?: Record<string, ValueSnapshot>;
  objects: ObjectSnapshot[];
  truncated?: boolean;
}): RuntimeState {
  return {
    step: 5,
    activeFrameId: 4,
    frames: new Map([[4, {
      frameId: 4,
      parentFrameId: null,
      functionName: "solve",
      line: 9,
      locals: input.locals ?? {}
    }]]),
    callStack: [4],
    currentLine: 9,
    stdout: "",
    objectTopology: {
      objects: new Map(input.objects.map((object) => [object.objectId, object])),
      truncated: input.truncated ?? false
    }
  };
}

describe("buildTreeVisuals", () => {
  it("accepts only TreeNode with reference-or-None left/right and allows missing val", () => {
    const lookalike: ObjectSnapshot = {
      objectId: "foo-1",
      className: "Foo",
      attributes: { left: none(), right: none() }
    };
    const malformed: ObjectSnapshot = {
      objectId: "bad-1",
      className: "TreeNode",
      attributes: { left: int(3), right: none() }
    };
    const visual = buildTreeVisuals(runtimeWithTree({
      objects: [treeNode("obj-1", null, null, null), lookalike, malformed]
    }), [])[0]!;

    expect(visual.nodes).toEqual([
      expect.objectContaining({ objectId: "obj-1", className: "TreeNode", label: null })
    ]);
  });

  it("classifies internal, external, unresolved, and None targets without fabricating truncation", () => {
    const root = treeNode("obj-1", 1, "obj-2", null);
    root.attributes.right = otherRef("ext-1");
    const external: ObjectSnapshot = { objectId: "ext-1", className: "OtherNode", attributes: {} };
    const visual = buildTreeVisuals(runtimeWithTree({
      objects: [root, treeNode("obj-2", 2, null, null), external]
    }), [])[0]!;
    expect(visual.nodes.find((node) => node.objectId === "obj-1")).toMatchObject({
      leftObjectId: "obj-2",
      leftTargetKind: "tree_node",
      rightObjectId: "ext-1",
      rightTargetKind: "external"
    });
    expect(visual.truncated).toBe(false);

    root.attributes.right = treeRef("missing-1");
    const unresolved = buildTreeVisuals(runtimeWithTree({
      objects: [root, treeNode("obj-2", 2, null, null)]
    }), [])[0]!;
    expect(unresolved.nodes.find((node) => node.objectId === "obj-1")).toMatchObject({
      rightObjectId: "missing-1",
      rightTargetKind: "unresolved"
    });
    expect(unresolved.truncated).toBe(false);
  });

  it("builds deterministic components and chooses main by pointer coverage", () => {
    const visual = buildTreeVisuals(runtimeWithTree({
      locals: { current: treeRef("obj-2"), parent: treeRef("obj-1"), temp: treeRef("obj-9") },
      objects: [
        treeNode("obj-1", 1, "obj-2", "obj-3"),
        treeNode("obj-2", 2, null, null),
        treeNode("obj-3", 3, null, null),
        treeNode("obj-9", 9, "obj-10", null),
        treeNode("obj-10", 10, null, null)
      ]
    }), [])[0]!;

    expect(visual.components).toEqual([
      expect.objectContaining({
        componentId: "tree-component:obj-1",
        nodeIds: ["obj-1", "obj-2", "obj-3"],
        entryNodeIds: ["obj-1"],
        pointerCount: 2,
        role: "main"
      }),
      expect.objectContaining({
        componentId: "tree-component:obj-10",
        nodeIds: ["obj-10", "obj-9"],
        entryNodeIds: ["obj-9"],
        pointerCount: 1,
        role: "detached"
      })
    ]);
  });

  it("uses node count then lexical componentId when pointer coverage ties", () => {
    const larger = buildTreeVisuals(runtimeWithTree({
      objects: [
        treeNode("obj-5", 5, null, null),
        treeNode("obj-1", 1, "obj-2", null),
        treeNode("obj-2", 2, null, null)
      ]
    }), [])[0]!;
    expect(larger.components.find((component) => component.role === "main")?.componentId)
      .toBe("tree-component:obj-1");

    const lexical = buildTreeVisuals(runtimeWithTree({
      objects: [treeNode("obj-9", 9, null, null), treeNode("obj-1", 1, null, null)]
    }), [])[0]!;
    expect(lexical.components.find((component) => component.role === "main")?.componentId)
      .toBe("tree-component:obj-1");
  });

  it("keeps active-frame aliases as pointers and reports cycle/shared child facts", () => {
    const visual = buildTreeVisuals(runtimeWithTree({
      locals: { root: treeRef("obj-1"), curr: treeRef("obj-2"), alias: treeRef("obj-2") },
      objects: [
        treeNode("obj-1", 1, "obj-2", "obj-2"),
        treeNode("obj-2", 2, "obj-1", null)
      ]
    }), [])[0]!;

    expect(visual.pointers).toEqual([
      { variableName: "alias", objectId: "obj-2", status: "unchanged" },
      { variableName: "curr", objectId: "obj-2", status: "unchanged" },
      { variableName: "root", objectId: "obj-1", status: "unchanged" }
    ]);
    expect(visual.components[0]).toMatchObject({
      cyclic: true,
      sharedChildNodeIds: ["obj-2"]
    });
  });

  it("propagates runtime topology truncation and returns no visual without candidates", () => {
    expect(buildTreeVisuals(runtimeWithTree({
      objects: [treeNode("obj-1", 1, null, null)],
      truncated: true
    }), [])[0]?.truncated).toBe(true);
    expect(buildTreeVisuals(runtimeWithTree({ objects: [] }), [])).toEqual([]);
  });

  it("projects local reference movement and just-unbound pointers", () => {
    const moved = buildTreeVisuals(runtimeWithTree({
      locals: { curr: treeRef("obj-2") },
      objects: [treeNode("obj-1", 1, null, null), treeNode("obj-2", 2, null, null)]
    }), [{
      kind: "reference",
      origin: "transition",
      owner: { scope: "local", frameId: 4, variableName: "curr" },
      action: "redirected",
      beforeObjectId: "obj-1",
      afterObjectId: "obj-2"
    }])[0]!;
    expect(moved.pointers).toContainEqual({ variableName: "curr", objectId: "obj-2", status: "moved" });

    const removed = buildTreeVisuals(runtimeWithTree({
      locals: {},
      objects: [treeNode("obj-1", 1, null, null)]
    }), [{
      kind: "reference",
      origin: "transition",
      owner: { scope: "local", frameId: 4, variableName: "root" },
      action: "unbound",
      beforeObjectId: "obj-1",
      afterObjectId: null
    }])[0]!;
    expect(removed.pointers).toContainEqual({ variableName: "root", objectId: null, status: "removed" });
  });

  it("maps left/right reference actions and val changes", () => {
    const mutations: RuntimeMutation[] = [
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "object_attribute", objectId: "obj-1", attribute: "left" },
        action: "unbound",
        beforeObjectId: "obj-2",
        afterObjectId: null
      },
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "object_attribute", objectId: "obj-1", attribute: "right" },
        action: "redirected",
        beforeObjectId: "obj-2",
        afterObjectId: "obj-3"
      },
      {
        kind: "object_attribute",
        origin: "transition",
        objectId: "obj-1",
        attribute: "val",
        action: "changed",
        before: int(1),
        after: int(4)
      }
    ];
    const visual = buildTreeVisuals(runtimeWithTree({
      objects: [treeNode("obj-1", 4, null, "obj-3"), treeNode("obj-2", 2, null, null), treeNode("obj-3", 3, null, null)]
    }), mutations)[0]!;

    expect(visual.nodes.find((node) => node.objectId === "obj-1")).toMatchObject({
      leftStatus: "removed",
      rightStatus: "changed",
      valueStatus: "changed",
      status: "changed"
    });
  });

  it("gives appeared status precedence over changed", () => {
    const visual = buildTreeVisuals(runtimeWithTree({
      objects: [treeNode("obj-1", 1, null, null)]
    }), [
      { kind: "object_visibility", origin: "transition", objectId: "obj-1", action: "appeared" },
      {
        kind: "object_attribute",
        origin: "transition",
        objectId: "obj-1",
        attribute: "val",
        action: "changed",
        before: int(0),
        after: int(1)
      }
    ])[0]!;
    expect(visual.nodes[0]?.status).toBe("added");
  });

  it("marks only the directly removed child detached when current incoming count is zero", () => {
    const visual = buildTreeVisuals(runtimeWithTree({
      objects: [
        treeNode("obj-1", 1, null, null),
        treeNode("obj-2", 2, "obj-3", null),
        treeNode("obj-3", 3, null, null)
      ]
    }), [{
      kind: "reference",
      origin: "transition",
      owner: { scope: "object_attribute", objectId: "obj-1", attribute: "left" },
      action: "unbound",
      beforeObjectId: "obj-2",
      afterObjectId: null
    }])[0]!;

    expect(visual.nodes.find((node) => node.objectId === "obj-2")?.status).toBe("detached");
    expect(visual.nodes.find((node) => node.objectId === "obj-3")?.status).toBe("unchanged");
  });

  it("does not mark a previous target detached while another current Tree edge still targets it", () => {
    const visual = buildTreeVisuals(runtimeWithTree({
      objects: [
        treeNode("obj-1", 1, null, null),
        treeNode("obj-4", 4, "obj-2", null),
        treeNode("obj-2", 2, null, null)
      ]
    }), [{
      kind: "reference",
      origin: "transition",
      owner: { scope: "object_attribute", objectId: "obj-1", attribute: "left" },
      action: "redirected",
      beforeObjectId: "obj-2",
      afterObjectId: null
    }])[0]!;
    expect(visual.nodes.find((node) => node.objectId === "obj-2")?.status).not.toBe("detached");
  });
});

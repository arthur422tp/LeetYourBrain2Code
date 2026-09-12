import { describe, expect, it } from "vitest";

import {
  buildGraphVisuals,
  type GraphVisualModel
} from "../../src/core/graph-interpreter";
import type { RuntimeMutation } from "../../src/core/runtime-mutation";
import type { RuntimeState } from "../../src/core/runtime-state";
import type { ObjectSnapshot, ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

const graphRef = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "Node"
});

const neighborList = (...objectIds: string[]): ValueSnapshot => ({
  type: "list",
  length: objectIds.length,
  items: objectIds.map(graphRef),
  truncated: false
});

function graphNode(
  objectId: string,
  value: number | null,
  neighbors: string[]
): ObjectSnapshot {
  return {
    objectId,
    className: "Node",
    attributes: {
      ...(value === null ? {} : { val: int(value) }),
      neighbors: neighborList(...neighbors)
    }
  };
}

function runtimeWithObjects(input: {
  objects: ObjectSnapshot[];
  locals?: Record<string, ValueSnapshot>;
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
        functionName: "cloneGraph",
        line: 7,
        locals: input.locals ?? {}
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

describe("buildGraphVisuals", () => {
  it("accepts strict Node neighbors and preserves ordered duplicate neighbors", () => {
    const visual = buildGraphVisuals(runtimeWithObjects({
      objects: [
        graphNode("obj-1", 1, ["obj-2", "obj-2"]),
        graphNode("obj-2", 2, ["obj-1"])
      ]
    }), [])[0]!;

    expect(visual).toMatchObject({
      visualId: "graph:Node",
      nodes: [
        {
          objectId: "obj-1",
          neighbors: [
            { objectId: "obj-2", targetKind: "graph_node" },
            { objectId: "obj-2", targetKind: "graph_node" }
          ]
        },
        { objectId: "obj-2" }
      ],
      edges: [
        {
          fromObjectId: "obj-1",
          toObjectId: "obj-2",
          targetKind: "graph_node",
          status: "unchanged"
        },
        {
          fromObjectId: "obj-2",
          toObjectId: "obj-1",
          targetKind: "graph_node",
          status: "unchanged"
        }
      ]
    });
  });

  it("rejects false-positive and malformed Node shapes while accepting isolated nodes", () => {
    const lookalike: ObjectSnapshot = {
      objectId: "obj-lookalike",
      className: "GraphNode",
      attributes: { neighbors: neighborList() }
    };
    const missingNeighbors: ObjectSnapshot = {
      objectId: "obj-missing",
      className: "Node",
      attributes: { val: int(4) }
    };
    const primitiveNeighbor: ObjectSnapshot = {
      objectId: "obj-primitive",
      className: "Node",
      attributes: {
        neighbors: { type: "list", length: 1, items: [int(2)], truncated: false }
      }
    };

    const visuals = buildGraphVisuals(runtimeWithObjects({
      objects: [graphNode("obj-isolated", 1, []), lookalike, missingNeighbors, primitiveNeighbor]
    }), []);

    expect(visuals).toHaveLength(1);
    expect(visuals[0]!.nodes).toEqual([
      expect.objectContaining({
        objectId: "obj-isolated",
        neighbors: []
      })
    ]);
  });

  it("classifies external and unresolved neighbor targets without fabricating nodes", () => {
    const root = graphNode("obj-1", 1, []);
    root.attributes.neighbors = {
      type: "tuple",
      length: 2,
      items: [graphRef("obj-external"), graphRef("obj-missing")],
      truncated: false
    };
    const external: ObjectSnapshot = {
      objectId: "obj-external",
      className: "OtherNode",
      attributes: {}
    };

    const visual = buildGraphVisuals(runtimeWithObjects({
      objects: [root, external]
    }), [])[0]!;

    expect(visual.nodes.map((node) => node.objectId)).toEqual(["obj-1"]);
    expect(visual.nodes[0]?.neighbors).toEqual([
      { objectId: "obj-external", targetKind: "external" },
      { objectId: "obj-missing", targetKind: "unresolved" }
    ]);
    expect(visual.edges).toEqual([
      {
        fromObjectId: "obj-1",
        toObjectId: "obj-external",
        targetKind: "external",
        status: "unchanged"
      },
      {
        fromObjectId: "obj-1",
        toObjectId: "obj-missing",
        targetKind: "unresolved",
        status: "unchanged"
      }
    ]);
    expect(visual.truncated).toBe(false);
  });

  it("preserves all components and ranks main by pointer coverage, size, then id", () => {
    const visual = buildGraphVisuals(runtimeWithObjects({
      locals: {
        first: graphRef("obj-9"),
        second: graphRef("obj-9"),
        root: graphRef("obj-1")
      },
      objects: [
        graphNode("obj-1", 1, ["obj-2"]),
        graphNode("obj-2", 2, []),
        graphNode("obj-9", 9, [])
      ]
    }), [])[0]!;

    expect(visual.components).toEqual([
      {
        componentId: "graph-component:obj-9",
        nodeIds: ["obj-9"],
        pointerCount: 2,
        role: "main"
      },
      {
        componentId: "graph-component:obj-1",
        nodeIds: ["obj-1", "obj-2"],
        pointerCount: 1,
        role: "secondary"
      }
    ]);

    const larger = buildGraphVisuals(runtimeWithObjects({
      objects: [graphNode("obj-1", 1, ["obj-2"]), graphNode("obj-2", 2, []), graphNode("obj-9", 9, [])]
    }), [])[0]!;
    expect(larger.components[0]?.componentId).toBe("graph-component:obj-1");

    const lexical = buildGraphVisuals(runtimeWithObjects({
      objects: [graphNode("obj-9", 9, []), graphNode("obj-1", 1, [])]
    }), [])[0]!;
    expect(lexical.components[0]?.componentId).toBe("graph-component:obj-1");
  });

  it("projects active-frame pointer movement, addition, and removal", () => {
    const mutations: RuntimeMutation[] = [
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 4, variableName: "current" },
        action: "redirected",
        beforeObjectId: "obj-1",
        afterObjectId: "obj-2"
      },
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 4, variableName: "newNode" },
        action: "bound",
        beforeObjectId: null,
        afterObjectId: "obj-1"
      },
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 4, variableName: "oldNode" },
        action: "unbound",
        beforeObjectId: "obj-1",
        afterObjectId: null
      }
    ];
    const visual = buildGraphVisuals(runtimeWithObjects({
      locals: { current: graphRef("obj-2"), newNode: graphRef("obj-1") },
      objects: [graphNode("obj-1", 1, []), graphNode("obj-2", 2, [])]
    }), mutations)[0]!;

    expect(visual.pointers).toEqual([
      { variableName: "current", objectId: "obj-2", status: "moved" },
      { variableName: "newNode", objectId: "obj-1", status: "added" },
      { variableName: "oldNode", objectId: null, status: "removed" }
    ]);
  });

  it("projects edge additions and removals from neighbors snapshots", () => {
    const before = neighborList("obj-2", "obj-3");
    const after = neighborList("obj-3", "obj-4");
    const mutation: RuntimeMutation = {
      kind: "object_attribute",
      origin: "transition",
      objectId: "obj-1",
      attribute: "neighbors",
      action: "changed",
      before,
      after
    };
    const visual = buildGraphVisuals(runtimeWithObjects({
      objects: [
        graphNode("obj-1", 1, ["obj-3", "obj-4"]),
        graphNode("obj-2", 2, []),
        graphNode("obj-3", 3, []),
        graphNode("obj-4", 4, [])
      ]
    }), [mutation])[0]!;

    expect(visual.edges).toContainEqual({
      fromObjectId: "obj-1",
      toObjectId: "obj-2",
      targetKind: "graph_node",
      status: "removed"
    });
    expect(visual.edges).toContainEqual({
      fromObjectId: "obj-1",
      toObjectId: "obj-3",
      targetKind: "graph_node",
      status: "unchanged"
    });
    expect(visual.edges).toContainEqual({
      fromObjectId: "obj-1",
      toObjectId: "obj-4",
      targetKind: "graph_node",
      status: "added"
    });
    expect(visual.nodes.find((node) => node.objectId === "obj-1")?.status).toBe("changed");
  });

  it("does not treat a neighbors reorder as a topology mutation", () => {
    const mutation: RuntimeMutation = {
      kind: "object_attribute",
      origin: "transition",
      objectId: "obj-1",
      attribute: "neighbors",
      action: "changed",
      before: neighborList("obj-2", "obj-3"),
      after: neighborList("obj-3", "obj-2")
    };
    const visual = buildGraphVisuals(runtimeWithObjects({
      objects: [
        graphNode("obj-1", 1, ["obj-3", "obj-2"]),
        graphNode("obj-2", 2, []),
        graphNode("obj-3", 3, [])
      ]
    }), [mutation])[0]!;

    expect(visual.edges.filter((edge) => edge.fromObjectId === "obj-1")).toEqual([
      {
        fromObjectId: "obj-1",
        toObjectId: "obj-2",
        targetKind: "graph_node",
        status: "unchanged"
      },
      {
        fromObjectId: "obj-1",
        toObjectId: "obj-3",
        targetKind: "graph_node",
        status: "unchanged"
      }
    ]);
    expect(visual.nodes.find((node) => node.objectId === "obj-1")?.neighbors).toEqual([
      { objectId: "obj-3", targetKind: "graph_node" },
      { objectId: "obj-2", targetKind: "graph_node" }
    ]);
  });

  it("maps node appearance precedence and capture truncation", () => {
    const visual = buildGraphVisuals(runtimeWithObjects({
      truncated: true,
      objects: [graphNode("obj-1", 1, [])]
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
    ])[0]! as GraphVisualModel;

    expect(visual.nodes[0]?.status).toBe("added");
    expect(visual.truncated).toBe(true);
  });
});

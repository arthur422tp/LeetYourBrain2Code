import { describe, expect, it } from "vitest";

import type {
  GraphNodeVisual,
  GraphVisualModel
} from "../../src/core/graph-interpreter";
import {
  GRAPH_NODE_SIZE,
  layoutGraph
} from "../../src/sidepanel/components/graph-layout";

const int = (value: number) => ({ type: "int" as const, value: String(value) });

function node(objectId: string, value: number, neighbors: string[]): GraphNodeVisual {
  return {
    objectId,
    className: "Node",
    label: int(value),
    neighbors: neighbors.map((neighborId) => ({
      objectId: neighborId,
      targetKind: "graph_node" as const
    })),
    status: "unchanged"
  };
}

function model(input: {
  nodes: GraphNodeVisual[];
  edges: GraphVisualModel["edges"];
  components: GraphVisualModel["components"];
}): GraphVisualModel {
  return {
    kind: "graph",
    visualId: "graph:Node",
    nodes: input.nodes,
    edges: input.edges,
    components: input.components,
    pointers: [],
    truncated: false
  };
}

const cycleModel = model({
  nodes: [
    node("obj-4", 4, ["obj-1"]),
    node("obj-1", 1, ["obj-2"]),
    node("obj-3", 3, ["obj-4"]),
    node("obj-2", 2, ["obj-3"])
  ],
  edges: [
    { fromObjectId: "obj-4", toObjectId: "obj-1", targetKind: "graph_node", status: "unchanged" },
    { fromObjectId: "obj-2", toObjectId: "obj-3", targetKind: "graph_node", status: "unchanged" },
    { fromObjectId: "obj-1", toObjectId: "obj-2", targetKind: "graph_node", status: "unchanged" },
    { fromObjectId: "obj-3", toObjectId: "obj-4", targetKind: "graph_node", status: "unchanged" }
  ],
  components: [{
    componentId: "graph-component:obj-1",
    nodeIds: ["obj-4", "obj-1", "obj-3", "obj-2"],
    pointerCount: 1,
    role: "main"
  }]
});

describe("layoutGraph", () => {
  it("lays a four-node cycle out as an open square with space around every node", () => {
    const layout = layoutGraph(cycleModel)[0]!;
    const byId = new Map(layout.nodes.map((node) => [node.objectId, node]));
    const lengths = layout.connections.map((edge) => Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1));
    for (const length of lengths) expect(length).toBeCloseTo(92);
    const first = byId.get("obj-1")!;
    const opposite = byId.get("obj-3")!;
    expect(Math.hypot(first.x - opposite.x, first.y - opposite.y)).toBeCloseTo(92 * Math.SQRT2);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(28);
      expect(node.y).toBeGreaterThanOrEqual(28);
      expect(layout.width - node.x - node.width).toBeGreaterThanOrEqual(27.999);
      expect(layout.height - node.y - node.height).toBeGreaterThanOrEqual(27.999);
    }
  });

  it("returns identical geometry for identical models and reordered inputs", () => {
    const shuffled = structuredClone(cycleModel);
    shuffled.nodes.reverse();
    shuffled.edges.reverse();
    shuffled.components.reverse();

    expect(layoutGraph(cycleModel)).toEqual(layoutGraph(structuredClone(cycleModel)));
    expect(layoutGraph(cycleModel)).toEqual(layoutGraph(shuffled));
  });

  it("keeps disconnected component geometry independent", () => {
    const firstComponent = {
      componentId: "graph-component:obj-a",
      nodeIds: ["obj-a", "obj-b"],
      pointerCount: 1,
      role: "main" as const
    };
    const secondComponent = {
      componentId: "graph-component:obj-x",
      nodeIds: ["obj-x", "obj-y"],
      pointerCount: 0,
      role: "secondary" as const
    };
    const first = model({
      nodes: [node("obj-a", 1, ["obj-b"]), node("obj-b", 2, []), node("obj-x", 3, ["obj-y"]), node("obj-y", 4, [])],
      edges: [
        { fromObjectId: "obj-a", toObjectId: "obj-b", targetKind: "graph_node", status: "unchanged" },
        { fromObjectId: "obj-x", toObjectId: "obj-y", targetKind: "graph_node", status: "unchanged" }
      ],
      components: [secondComponent, firstComponent]
    });
    const changedSecond = structuredClone(first);
    changedSecond.nodes.push(node("obj-z", 5, ["obj-x"]));
    changedSecond.edges.push({
      fromObjectId: "obj-z",
      toObjectId: "obj-x",
      targetKind: "graph_node",
      status: "unchanged"
    });
    changedSecond.components[0]!.nodeIds.push("obj-z");

    expect(layoutGraph(first)[0]?.nodes).toEqual(layoutGraph(changedSecond)[0]?.nodes);
  });

  it("pairs reciprocal directed edges for presentation", () => {
    const reciprocal = model({
      nodes: [node("A", 1, ["B"]), node("B", 2, ["A"])],
      edges: [
        { fromObjectId: "B", toObjectId: "A", targetKind: "graph_node", status: "added" },
        { fromObjectId: "A", toObjectId: "B", targetKind: "graph_node", status: "unchanged" }
      ],
      components: [{ componentId: "graph-component:A", nodeIds: ["A", "B"], pointerCount: 0, role: "main" }]
    });
    const oneWay = structuredClone(reciprocal);
    oneWay.edges = oneWay.edges.filter((edge) => edge.fromObjectId === "A");
    oneWay.nodes[1]!.neighbors = [];

    expect(layoutGraph(reciprocal)[0]?.connections).toEqual([
      expect.objectContaining({
        key: "A↔B",
        fromObjectId: "A",
        toObjectId: "B",
        reciprocal: true,
        reverseFromObjectId: "B",
        reverseToObjectId: "A"
      })
    ]);
    expect(layoutGraph(oneWay)[0]?.connections).toEqual([
      expect.objectContaining({
        key: "A→B",
        fromObjectId: "A",
        toObjectId: "B",
        reciprocal: false
      })
    ]);
  });

  it("produces finite coordinates and separates small-graph node centers", () => {
    const layout = layoutGraph(model({
      nodes: [
        node("obj-1", 1, ["obj-2", "obj-3"]),
        node("obj-2", 2, ["obj-1", "obj-3"]),
        node("obj-3", 3, ["obj-1", "obj-2"])
      ],
      edges: [
        { fromObjectId: "obj-1", toObjectId: "obj-2", targetKind: "graph_node", status: "unchanged" },
        { fromObjectId: "obj-1", toObjectId: "obj-3", targetKind: "graph_node", status: "unchanged" },
        { fromObjectId: "obj-2", toObjectId: "obj-1", targetKind: "graph_node", status: "unchanged" },
        { fromObjectId: "obj-2", toObjectId: "obj-3", targetKind: "graph_node", status: "unchanged" },
        { fromObjectId: "obj-3", toObjectId: "obj-1", targetKind: "graph_node", status: "unchanged" },
        { fromObjectId: "obj-3", toObjectId: "obj-2", targetKind: "graph_node", status: "unchanged" }
      ],
      components: [{ componentId: "graph-component:obj-1", nodeIds: ["obj-1", "obj-2", "obj-3"], pointerCount: 0, role: "main" }]
    }))[0]!;

    expect(layout.nodes.every((item) =>
      Number.isFinite(item.x) && Number.isFinite(item.y) &&
      item.width === GRAPH_NODE_SIZE && item.height === GRAPH_NODE_SIZE
    )).toBe(true);
    for (let leftIndex = 0; leftIndex < layout.nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < layout.nodes.length; rightIndex += 1) {
        const left = layout.nodes[leftIndex]!;
        const right = layout.nodes[rightIndex]!;
        const distance = Math.hypot(
          left.x + left.width / 2 - right.x - right.width / 2,
          left.y + left.height / 2 - right.y - right.height / 2
        );
        expect(distance).toBeGreaterThanOrEqual(GRAPH_NODE_SIZE + 10);
      }
    }
  });
});

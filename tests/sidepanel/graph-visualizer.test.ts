import { describe, expect, it } from "vitest";

import type {
  GraphNodeVisual,
  GraphVisualModel
} from "../../src/core/graph-interpreter";
import {
  createGraphVisualizer
} from "../../src/sidepanel/components/GraphVisualizer";

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

function graphModel(input: {
  nodes: GraphNodeVisual[];
  edges: GraphVisualModel["edges"];
  components?: GraphVisualModel["components"];
  pointers?: GraphVisualModel["pointers"];
}): GraphVisualModel {
  return {
    kind: "graph",
    visualId: "graph:Node",
    nodes: input.nodes,
    edges: input.edges,
    components: input.components ?? [{
      componentId: "graph-component:obj-1",
      nodeIds: input.nodes.map((item) => item.objectId),
      pointerCount: input.pointers?.length ?? 0,
      role: "main"
    }],
    pointers: input.pointers ?? [],
    truncated: false
  };
}

const fourNodeModel = graphModel({
  nodes: [
    node("obj-1", 1, ["obj-2", "obj-2"]),
    node("obj-2", 2, ["obj-1"]),
    node("obj-3", 3, []),
    node("obj-4", 4, [])
  ],
  edges: [
    { fromObjectId: "obj-1", toObjectId: "obj-2", targetKind: "graph_node", status: "unchanged" },
    { fromObjectId: "obj-2", toObjectId: "obj-1", targetKind: "graph_node", status: "added" }
  ],
  components: [
    {
      componentId: "graph-component:obj-1",
      nodeIds: ["obj-1", "obj-2"],
      pointerCount: 1,
      role: "main"
    },
    {
      componentId: "graph-component:obj-3",
      nodeIds: ["obj-3", "obj-4"],
      pointerCount: 0,
      role: "secondary"
    }
  ],
  pointers: [{ variableName: "curr", objectId: "obj-1", status: "unchanged" }]
});

function oneWayModel(): GraphVisualModel {
  const result = structuredClone(fourNodeModel);
  result.nodes[1]!.neighbors = [];
  result.edges = [result.edges[0]!];
  return result;
}

describe("createGraphVisualizer", () => {
  it("renders compact nodes and pointer badges", () => {
    const handle = createGraphVisualizer(fourNodeModel);
    const nodes = handle.element.querySelectorAll(".graph-visualizer__node-button");
    expect(nodes).toHaveLength(4);
    expect(nodes[0]?.textContent).toBe("1");
    expect(handle.element.textContent).not.toContain("obj-1obj-2obj-3obj-4");
    expect(handle.element.querySelector('[data-pointer-name="curr"]')).not.toBeNull();
    handle.dispose();
  });

  it("renders one-way and reciprocal connections with directional metadata", () => {
    const oneWay = createGraphVisualizer(oneWayModel());
    const oneWayConnection = oneWay.element.querySelector<SVGGElement>(".graph-visualizer__connection")!;
    expect(oneWay.element.querySelectorAll(".graph-visualizer__connection")).toHaveLength(1);
    expect(oneWayConnection.dataset.reciprocal).toBe("false");
    expect(oneWayConnection.dataset.edgeForward).toBe("obj-1→obj-2");
    expect(oneWayConnection.querySelector("[marker-end]")).not.toBeNull();
    oneWay.dispose();

    const reciprocal = createGraphVisualizer(fourNodeModel);
    const reciprocalConnection = reciprocal.element.querySelector<SVGGElement>(".graph-visualizer__connection")!;
    expect(reciprocal.element.querySelectorAll(".graph-visualizer__connection")).toHaveLength(1);
    expect(reciprocalConnection.dataset.reciprocal).toBe("true");
    expect(reciprocalConnection.dataset.edgeForward).toBe("obj-1→obj-2");
    expect(reciprocalConnection.dataset.edgeReverse).toBe("obj-2→obj-1");
    reciprocal.dispose();
  });

  it("shows duplicate ordered neighbors and node inspection details", () => {
    const handle = createGraphVisualizer(fourNodeModel);
    const button = handle.element.querySelector<HTMLButtonElement>('[data-inspect-key="node:obj-1"]')!;
    button.click();
    const text = handle.element.querySelector(".visualizer-inspector")?.textContent ?? "";
    expect(text).toContain("value");
    expect(text).toContain("object ID");
    expect(text).toContain("status");
    expect(text).toContain("pointers");
    expect(text).toContain("outgoing references");
    expect(text).toContain("neighbors");
    expect(text).toContain("0 → obj-2");
    expect(text).toContain("1 → obj-2");
    handle.dispose();
  });

  it("shows both directions in a reciprocal connection inspector", () => {
    const handle = createGraphVisualizer(fourNodeModel);
    const connection = handle.element.querySelector<SVGPathElement>(
      '[data-inspect-key="connection:obj-1↔obj-2"]'
    )!;
    connection.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const text = handle.element.querySelector(".visualizer-inspector")?.textContent ?? "";
    expect(text).toContain("obj-1 → obj-2");
    expect(text).toContain("unchanged");
    expect(text).toContain("obj-2 → obj-1");
    expect(text).toContain("added");
    expect(text).toContain("presentation");
    expect(text).toContain("reciprocal");
    handle.dispose();
  });

  it("preserves selection and viewport, then falls back to the main node", () => {
    const handle = createGraphVisualizer(fourNodeModel);
    const nodeButton = handle.element.querySelector<HTMLButtonElement>('[data-inspect-key="node:obj-1"]')!;
    nodeButton.click();
    const viewport = handle.element.querySelector<HTMLElement>(".graph-visualizer__viewport")!;
    viewport.scrollLeft = 35;
    viewport.scrollTop = 48;

    const updated = structuredClone(fourNodeModel);
    updated.nodes[0]!.label = int(42);
    handle.update(updated);
    expect(handle.element.querySelector('[data-inspect-key="node:obj-1"]')?.getAttribute("aria-pressed"))
      .toBe("true");
    expect(handle.element.querySelector(".visualizer-inspector")?.textContent).toContain("42");
    expect(viewport.scrollLeft).toBe(35);
    expect(viewport.scrollTop).toBe(48);

    handle.element.querySelector<SVGPathElement>(
      '[data-inspect-key="connection:obj-1↔obj-2"]'
    )!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    handle.update(oneWayModel());
    expect(handle.element.querySelector('[data-inspect-key="node:obj-1"]')?.getAttribute("aria-pressed"))
      .toBe("true");
    handle.dispose();
  });
});

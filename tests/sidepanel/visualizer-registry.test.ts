import { describe, expect, it } from "vitest";

import type { TreeVisualModel } from "../../src/core/tree-interpreter";
import type { GraphVisualModel } from "../../src/core/graph-interpreter";
import type { MatrixVisualModel } from "../../src/core/matrix-interpreter";
import type { ListVisualModel } from "../../src/core/visual-model";
import {
  createVisualizer,
  updateVisualizer
} from "../../src/sidepanel/components/visualizer-registry";

const int = (value: number) => ({ type: "int" as const, value: String(value) });

function treeModel(objectId: string): TreeVisualModel {
  return {
    kind: "tree",
    visualId: "tree:TreeNode",
    nodes: [{
      objectId,
      className: "TreeNode",
      label: int(1),
      leftObjectId: null,
      rightObjectId: null,
      leftTargetKind: "none",
      rightTargetKind: "none",
      status: "unchanged",
      valueStatus: "unchanged",
      leftStatus: "unchanged",
      rightStatus: "unchanged"
    }],
    components: [{
      componentId: `tree-component:${objectId}`,
      nodeIds: [objectId],
      entryNodeIds: [objectId],
      pointerCount: 0,
      cyclic: false,
      sharedChildNodeIds: [],
      role: "main"
    }],
    pointers: [],
    truncated: false
  };
}

function listModel(): ListVisualModel {
  return {
    kind: "list",
    visualId: "list:nums",
    variableName: "nums",
    items: [int(1)],
    pointers: [],
    changedIndexes: []
  };
}

function graphModel(objectId: string): GraphVisualModel {
  return {
    kind: "graph",
    visualId: "graph:Node",
    nodes: [{
      objectId,
      className: "Node",
      label: int(1),
      neighbors: [],
      status: "unchanged"
    }],
    edges: [],
    components: [{
      componentId: `graph-component:${objectId}`,
      nodeIds: [objectId],
      pointerCount: 0,
      role: "main"
    }],
    pointers: [],
    truncated: false
  };
}

function matrixModel(value = 1): MatrixVisualModel {
  return {
    kind: "matrix",
    visualId: "matrix:dp",
    variableName: "dp",
    rowCount: 1,
    columnCount: 1,
    cells: [[int(value)]],
    focuses: [],
    changedCells: []
  };
}

describe("visualizer registry", () => {
  it("creates and updates Tree through the generic registry", () => {
    const first = treeModel("obj-1");
    const second = treeModel("obj-2");
    const handle = createVisualizer(first);
    expect(handle.kind).toBe("tree");
    expect(handle.element.dataset.visualId).toBe("tree:TreeNode");
    updateVisualizer(handle, second);
    expect(handle.element.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
  });

  it("rejects cross-kind updates", () => {
    const handle = createVisualizer(treeModel("obj-1"));
    expect(() => updateVisualizer(handle, listModel())).toThrow(/Cannot update tree visualizer with list/);
  });

  it("creates and updates Graph through the generic registry", () => {
    const first = graphModel("obj-1");
    const second = graphModel("obj-2");
    const handle = createVisualizer(first);

    expect(handle.kind).toBe("graph");
    expect(handle.element.dataset.visualId).toBe("graph:Node");
    updateVisualizer(handle, second);
    expect(handle.element.dataset.visualId).toBe("graph:Node");
    expect(handle.element.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
  });

  it("rejects updating a Graph visualizer with a Tree model", () => {
    const handle = createVisualizer(graphModel("obj-1"));
    expect(() => updateVisualizer(handle, treeModel("obj-2"))).toThrow(
      /Cannot update graph visualizer with tree/
    );
  });

  it("creates and updates Matrix through the generic registry", () => {
    const first = matrixModel(1);
    const second = matrixModel(2);
    const handle = createVisualizer(first);
    const root = handle.element;

    expect(handle.kind).toBe("matrix");
    expect(handle.element.dataset.visualId).toBe("matrix:dp");
    updateVisualizer(handle, second);
    expect(handle.element).toBe(root);
    expect(handle.element.textContent).toContain("2");
  });

  it("rejects updating a Matrix visualizer with a List model", () => {
    const handle = createVisualizer(matrixModel());
    expect(() => updateVisualizer(handle, listModel())).toThrow(
      /Cannot update matrix visualizer with list/
    );
  });
});

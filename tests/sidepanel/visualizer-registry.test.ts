import { describe, expect, it } from "vitest";

import type { TreeVisualModel } from "../../src/core/tree-interpreter";
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
});

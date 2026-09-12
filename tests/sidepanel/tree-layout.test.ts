import { describe, expect, it } from "vitest";

import type {
  TreeNodeVisual,
  TreeVisualModel
} from "../../src/core/tree-interpreter";
import {
  TREE_FALLBACK_COLUMNS,
  TREE_HORIZONTAL_GAP,
  TREE_NODE_HEIGHT,
  TREE_NODE_WIDTH,
  TREE_VERTICAL_GAP,
  type TreeLayoutNode,
  layoutTree
} from "../../src/sidepanel/components/tree-layout";

const int = (value: number) => ({ type: "int" as const, value: String(value) });

function node(
  objectId: string,
  value: number,
  leftObjectId: string | null,
  rightObjectId: string | null
): TreeNodeVisual {
  return {
    objectId,
    className: "TreeNode",
    label: int(value),
    leftObjectId,
    rightObjectId,
    leftTargetKind: leftObjectId === null ? "none" : "tree_node",
    rightTargetKind: rightObjectId === null ? "none" : "tree_node",
    status: "unchanged",
    valueStatus: "unchanged",
    leftStatus: "unchanged",
    rightStatus: "unchanged"
  };
}

const strictModel: TreeVisualModel = {
  kind: "tree",
  visualId: "tree:TreeNode",
  nodes: [
    node("obj-8", 8, null, null),
    node("obj-4", 4, "obj-2", "obj-7"),
    node("obj-1", 1, null, null),
    node("obj-7", 7, "obj-6", "obj-8"),
    node("obj-3", 3, null, null),
    node("obj-2", 2, "obj-1", "obj-3"),
    node("obj-6", 6, null, null)
  ],
  components: [{
    componentId: "tree-component:obj-1",
    nodeIds: ["obj-1", "obj-2", "obj-3", "obj-4", "obj-6", "obj-7", "obj-8"],
    entryNodeIds: ["obj-4"],
    pointerCount: 1,
    cyclic: false,
    sharedChildNodeIds: [],
    role: "main"
  }],
  pointers: [{ variableName: "root", objectId: "obj-4", status: "unchanged" }],
  truncated: false
};

const fiveNodeFallbackModel: TreeVisualModel = {
  kind: "tree",
  visualId: "tree:TreeNode",
  nodes: [
    node("obj-5", 5, null, null),
    node("obj-3", 3, "obj-4", null),
    node("obj-1", 1, "obj-2", "obj-3"),
    node("obj-4", 4, "obj-5", null),
    node("obj-2", 2, "obj-4", null)
  ],
  components: [{
    componentId: "tree-component:obj-1",
    nodeIds: ["obj-1", "obj-2", "obj-3", "obj-4", "obj-5"],
    entryNodeIds: ["obj-1"],
    pointerCount: 1,
    cyclic: false,
    sharedChildNodeIds: ["obj-4"],
    role: "main"
  }],
  pointers: [],
  truncated: false
};

const selfCycleModel: TreeVisualModel = {
  kind: "tree",
  visualId: "tree:TreeNode",
  nodes: [node("obj-1", 1, "obj-1", null)],
  components: [{
    componentId: "tree-component:obj-1",
    nodeIds: ["obj-1"],
    entryNodeIds: [],
    pointerCount: 0,
    cyclic: true,
    sharedChildNodeIds: [],
    role: "main"
  }],
  pointers: [],
  truncated: false
};

describe("layoutTree", () => {
  it("fits a seven-node tree in a narrow sidebar without shrinking its values", () => {
    const layout = layoutTree(strictModel)[0]!;
    expect(layout.width).toBeLessThanOrEqual(280);
    expect(layout.height).toBeLessThanOrEqual(280);
    expect(layout.nodes.every((node) => node.width >= 44)).toBe(true);
    const byId = new Map(layout.nodes.map((node) => [node.objectId, node]));
    expect(byId.get("obj-4")!.x).toBe((byId.get("obj-2")!.x + byId.get("obj-7")!.x) / 2);
  });

  it("reserves vertical room for multiple long pointer labels", () => {
    const model = structuredClone(strictModel);
    model.pointers = ["newNode", "tail", "aVeryLongPointerName"].map((variableName) => ({variableName, objectId: "obj-4", status: "unchanged"}));
    const layout = layoutTree(model)[0]!;
    const root = layout.nodes.find((node) => node.objectId === "obj-4")!;
    expect(root.height).toBeGreaterThan(120);
    for (const edge of layout.edges) {
      const from = layout.nodes.find((node) => node.objectId === edge.fromObjectId)!;
      const to = layout.nodes.find((node) => node.objectId === edge.toObjectId)!;
      expect(edge.y1).toBe(from.y + from.height);
      expect(edge.y2).toBe(to.y + to.height - 44);
    }
  });

  it("produces identical geometry for identical strict-tree models", () => {
    expect(layoutTree(strictModel)).toEqual(layoutTree(structuredClone(strictModel)));
  });

  it("places parent above children and preserves left/right direction", () => {
    const layout = layoutTree(strictModel)[0]!;
    const byId = new Map(layout.nodes.map((item) => [item.objectId, item]));
    const root = byId.get("obj-4")!;
    const left = byId.get("obj-2")!;
    const right = byId.get("obj-7")!;
    expect(left.y).toBeGreaterThan(root.y);
    expect(right.y).toBeGreaterThan(root.y);
    expect(left.x).toBeLessThan(root.x);
    expect(right.x).toBeGreaterThan(root.x);
  });

  it("preserves the side of a lone child without inventing a sibling", () => {
    for (const field of ["left", "right"] as const) {
      const single = structuredClone(strictModel);
      single.nodes = [node("root", 1, field === "left" ? "child" : null, field === "right" ? "child" : null), node("child", 2, null, null)];
      single.components[0]!.nodeIds = ["root", "child"];
      single.components[0]!.entryNodeIds = ["root"];
      const layout = layoutTree(single)[0]!;
      const root = layout.nodes.find((node) => node.objectId === "root")!;
      const child = layout.nodes.find((node) => node.objectId === "child")!;
      expect(layout.nodes).toHaveLength(2);
      expect(child.y).toBeGreaterThan(root.y);
      expect(Math.sign(child.x - root.x)).toBe(field === "left" ? -1 : 1);
    }
  });

  it("does not overlap same-depth strict-tree nodes", () => {
    const layout = layoutTree(strictModel)[0]!;
    const rows = new Map<number, TreeLayoutNode[]>();
    for (const item of layout.nodes) {
      rows.set(item.y, [...(rows.get(item.y) ?? []), item]);
    }
    for (const row of rows.values()) {
      const sorted = [...row].sort((left, right) => left.x - right.x);
      for (let index = 1; index < sorted.length; index += 1) {
        expect(sorted[index]!.x - sorted[index - 1]!.x)
          .toBeGreaterThanOrEqual(TREE_NODE_WIDTH);
      }
    }
  });

  it("uses fixed three-column lexical fallback for cycle/shared-child topology", () => {
    const layout = layoutTree(fiveNodeFallbackModel)[0]!;
    expect(layout.mode).toBe("fallback");
    expect(layout.nodes.map((item) => item.objectId)).toEqual([
      "obj-1",
      "obj-2",
      "obj-3",
      "obj-4",
      "obj-5"
    ]);
    expect(layout.nodes[0]!.x).toBe(0);
    expect(layout.nodes[0]!.y).toBe(layout.nodes[2]!.y);
    expect(layout.nodes[3]!.x).toBe(0);
    expect(layout.nodes[3]!.y).toBeGreaterThan(layout.nodes[0]!.y);
    expect(layout.width).toBe(TREE_FALLBACK_COLUMNS * TREE_NODE_WIDTH +
      (TREE_FALLBACK_COLUMNS - 1) * TREE_HORIZONTAL_GAP);
    expect(layout.height).toBe(2 * TREE_NODE_HEIGHT + TREE_VERTICAL_GAP);
  });

  it("terminates self-cycle layout and emits the real self edge", () => {
    const layout = layoutTree(selfCycleModel)[0]!;
    expect(layout.mode).toBe("fallback");
    expect(layout.edges).toContainEqual(expect.objectContaining({
      fromObjectId: "obj-1",
      toObjectId: "obj-1",
      field: "left"
    }));
  });

  it("does not depend on TreeNode array insertion order", () => {
    const shuffled = structuredClone(strictModel);
    shuffled.nodes.reverse();
    expect(layoutTree(shuffled)).toEqual(layoutTree(strictModel));
  });
});

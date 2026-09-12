import { describe, expect, it } from "vitest";

import type {
  TreeNodeVisual,
  TreeVisualModel
} from "../../src/core/tree-interpreter";
import { createTreeVisualizer } from "../../src/sidepanel/components/TreeVisualizer";

const int = (value: number) => ({ type: "int" as const, value: String(value) });

function node(
  objectId: string,
  value: number | null,
  leftObjectId: string | null = null,
  rightObjectId: string | null = null,
  overrides: Partial<TreeNodeVisual> = {}
): TreeNodeVisual {
  return {
    objectId,
    className: "TreeNode",
    label: value === null ? null : int(value),
    leftObjectId,
    rightObjectId,
    leftTargetKind: leftObjectId === null ? "none" : "tree_node",
    rightTargetKind: rightObjectId === null ? "none" : "tree_node",
    status: "unchanged",
    valueStatus: "unchanged",
    leftStatus: "unchanged",
    rightStatus: "unchanged",
    ...overrides
  };
}

const model: TreeVisualModel = {
  kind: "tree",
  visualId: "tree:TreeNode",
  nodes: [node("obj-1", 1, "obj-2", "obj-3"), node("obj-2", 2), node("obj-3", 3)],
  components: [{
    componentId: "tree-component:obj-1",
    nodeIds: ["obj-1", "obj-2", "obj-3"],
    entryNodeIds: ["obj-1"],
    pointerCount: 1,
    cyclic: false,
    sharedChildNodeIds: [],
    role: "main"
  }],
  pointers: [{ variableName: "root", objectId: "obj-1", status: "unchanged" }],
  truncated: false
};

const sharedCycleModel: TreeVisualModel = {
  kind: "tree",
  visualId: "tree:TreeNode",
  nodes: [node("obj-1", 1, "obj-2", "obj-2"), node("obj-2", 2, "obj-1")],
  components: [{
    componentId: "tree-component:obj-1",
    nodeIds: ["obj-1", "obj-2"],
    entryNodeIds: [],
    pointerCount: 1,
    cyclic: true,
    sharedChildNodeIds: ["obj-2"],
    role: "main"
  }],
  pointers: [{ variableName: "root", objectId: "obj-1", status: "unchanged" }],
  truncated: true
};

const twoComponentModel: TreeVisualModel = {
  kind: "tree",
  visualId: "tree:TreeNode",
  nodes: [node("obj-2", 2), node("obj-1", 1)],
  components: [
    {
      componentId: "tree-component:obj-1",
      nodeIds: ["obj-1"],
      entryNodeIds: ["obj-1"],
      pointerCount: 1,
      cyclic: false,
      sharedChildNodeIds: [],
      role: "main"
    },
    {
      componentId: "tree-component:obj-2",
      nodeIds: ["obj-2"],
      entryNodeIds: ["obj-2"],
      pointerCount: 0,
      cyclic: false,
      sharedChildNodeIds: [],
      role: "detached"
    }
  ],
  pointers: [{ variableName: "root", objectId: "obj-1", status: "unchanged" }],
  truncated: false
};

const updatedTwoComponentModel: TreeVisualModel = {
  ...twoComponentModel,
  nodes: [node("obj-1", 1), node("obj-9", 9)],
  components: [
    { ...twoComponentModel.components[0]!, nodeIds: ["obj-1"] },
    {
      ...twoComponentModel.components[1]!,
      componentId: "tree-component:obj-9",
      nodeIds: ["obj-9"],
      entryNodeIds: ["obj-9"]
    }
  ]
};

describe("createTreeVisualizer", () => {
  it("renders nodes, pointer badges, and SVG internal edge metadata", () => {
    const handle = createTreeVisualizer(model);
    expect(handle.element.dataset.visualId).toBe("tree:TreeNode");
    expect(handle.element.querySelector('[data-node-id="obj-1"]')).not.toBeNull();
    expect(handle.element.querySelector(
      '[data-pointer-name="root"][data-pointer-status="unchanged"]'
    )).not.toBeNull();
    expect(handle.element.querySelector(
      '[data-edge-from="obj-1"][data-edge-to="obj-2"][data-edge-field="left"][data-edge-target-kind="tree_node"]'
    )).not.toBeNull();
  });

  it("shows readable details for the selected node and preserves selection across steps", () => {
    const handle = createTreeVisualizer(model);
    const button = handle.element.querySelector<HTMLButtonElement>('[data-node-id="obj-2"] button')!;
    expect(button).not.toBeNull();
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(handle.element.querySelector(".tree-visualizer__inspector")?.textContent).toContain("obj-2");
    const changed = structuredClone(model);
    changed.nodes[1]!.label = int(42);
    handle.update(changed);
    expect(handle.element.querySelector(".tree-visualizer__inspector")?.textContent).toContain("42");
    expect(handle.element.querySelector('[data-node-id="obj-2"] button')?.getAttribute("aria-pressed")).toBe("true");
    handle.dispose();
  });

  it("preserves viewport position and falls back when the selected node disappears", () => {
    const handle = createTreeVisualizer(twoComponentModel);
    handle.element.querySelector<HTMLButtonElement>('[data-node-id="obj-2"] button')!.click();
    const viewport = handle.element.querySelector<HTMLElement>(".tree-visualizer__viewport")!;
    viewport.scrollLeft = 30;
    viewport.scrollTop = 50;
    handle.update(updatedTwoComponentModel);
    const updatedViewport = handle.element.querySelector<HTMLElement>(".tree-visualizer__viewport")!;
    expect(updatedViewport.scrollLeft).toBe(30);
    expect(updatedViewport.scrollTop).toBe(50);
    expect(handle.element.querySelector(".tree-visualizer__inspector")?.textContent).toContain("obj-1");
    handle.element.querySelector<HTMLButtonElement>('[data-node-id="obj-9"] button')!.click();
    expect(handle.element.querySelector(".tree-visualizer__inspector")?.textContent).toContain("obj-9");
    handle.dispose();
  });

  it("renders changed val independently", () => {
    const changed = structuredClone(model);
    changed.nodes[0]!.valueStatus = "changed";
    const handle = createTreeVisualizer(changed);
    expect(handle.element.querySelector(
      '[data-node-id="obj-1"] [data-value-status="changed"]'
    )).not.toBeNull();
  });

  it("renders removed, external, and unresolved edge terminals without fake nodes", () => {
    const special = structuredClone(model);
    special.nodes[0]!.leftObjectId = null;
    special.nodes[0]!.leftTargetKind = "none";
    special.nodes[0]!.leftStatus = "removed";
    special.nodes[0]!.rightObjectId = "missing-9";
    special.nodes[0]!.rightTargetKind = "unresolved";
    special.nodes[1]!.rightObjectId = "external-1";
    special.nodes[1]!.rightTargetKind = "external";
    const handle = createTreeVisualizer(special);
    expect(handle.element.querySelector('[data-edge-field="left"][data-edge-status="removed"]')?.textContent)
      .toContain("left → None");
    expect(handle.element.querySelector('[data-edge-field="right"][data-edge-target-kind="unresolved"]')?.textContent)
      .toContain("missing-9");
    expect(handle.element.querySelector('[data-edge-field="right"][data-edge-target-kind="external"]')?.textContent)
      .toContain("external-1");
    expect(handle.element.querySelector('[data-node-id="missing-9"]')).toBeNull();
  });

  it("renders factual cycle/shared-child/truncation notices and no diagnosis", () => {
    const text = createTreeVisualizer(sharedCycleModel).element.textContent ?? "";
    expect(text).toContain("Cycle detected in TreeNode references");
    expect(text).toContain("Shared child: obj-2 has 2 incoming TreeNode references");
    expect(text).toContain("Topology truncated");
    const diagnosticLanguage = [
      ["root", " cause"].join(""),
      ["likely", " cause"].join(""),
      ["this is the ", "bug"].join(""),
      ["ca", "used"].join(""),
      ["infinite", " loop"].join(""),
      ["LeetCode", " TLE"].join("")
    ].join("|");
    expect(text).not.toMatch(new RegExp(diagnosticLanguage, "i"));
  });

  it("renders main before detached and updates the existing handle", () => {
    const handle = createTreeVisualizer(twoComponentModel);
    const roles = [...handle.element.querySelectorAll<HTMLElement>("[data-component-role]")]
      .map((element) => element.dataset.componentRole);
    expect(roles).toEqual(["main", "detached"]);
    const element = handle.element;
    handle.update(updatedTwoComponentModel);
    expect(handle.element).toBe(element);
    expect(handle.element.querySelector('[data-node-id="obj-9"]')).not.toBeNull();
  });

  it("does not scroll a compact tree that already fits the viewport", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
    Object.defineProperty(Element.prototype, "clientWidth", {
      configurable: true,
      get() {
        return this.classList.contains("tree-visualizer__viewport")
          ? 240
          : descriptor?.get?.call(this) ?? descriptor?.value ?? 0;
      }
    });

    try {
      const handle = createTreeVisualizer(model);
      const viewport = handle.element.querySelector<HTMLElement>(".tree-visualizer__viewport")!;
      expect(viewport.scrollLeft).toBe(0);
    } finally {
      if (descriptor) {
        Object.defineProperty(Element.prototype, "clientWidth", descriptor);
      } else {
        delete (Element.prototype as { clientWidth?: number }).clientWidth;
      }
    }
  });
});

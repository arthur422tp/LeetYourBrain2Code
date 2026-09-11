# Tree Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic LeetCode `TreeNode` visualization that renders current runtime topology, pointers, mutations, detached components, cycles, shared children, and capture truncation without inferring correctness or cause.

**Architecture:** Add a pure `tree-interpreter.ts` projection over existing `RuntimeState` + `RuntimeMutation[]`, then add a stateless `tree-layout.ts` geometry layer and a DOM/SVG `TreeVisualizer`. Integrate `tree` into the existing `StructureVisualModel`, visual candidate resolver, and typed visualizer registry without changing TraceSession schema, RuntimeMutation schema, or navigation ownership.

**Tech Stack:** TypeScript 5.8, DOM/SVG APIs, Vitest 3.2, jsdom, Vite 6, existing runtime object topology and visualizer registry.

**Spec:** `docs/superpowers/specs/2026-09-11-tree-visualization-design.md`

## Global Constraints

- Support only `className === "TreeNode"` in v0.1.
- A TreeNode candidate requires both `left` and `right` attributes, each captured as `None` or `reference`.
- `val` is display-only and may be absent.
- Produce at most one Tree visual with stable `visualId = "tree:TreeNode"` containing all current TreeNode components.
- Main component selection is exactly: higher active-frame pointer coverage → larger node count → lexicographically smaller `componentId`.
- Never special-case a local variable named `root`.
- Internal Tree edges are only references whose targets are captured TreeNode candidates.
- Captured non-TreeNode targets are `external`; missing referenced targets are `unresolved`.
- `model.truncated` means only `runtime.objectTopology.truncated`; do not infer truncation from unresolved/external references.
- `RuntimeMutation[]` remains the only mutation authority; do not diff TreeVisualModels to invent mutations.
- Node status precedence is `added > detached > changed > unchanged`.
- A directly detached node is only the previous `left/right` target removed or redirected away this step, still captured, with zero current internal incoming edges.
- Descendants do not inherit `detached` node status.
- Cycle/shared-child topology remains visible and uses deterministic fallback layout; it is not a diagnosis.
- Strict-tree layout requires: no cycle, no shared child, exactly one entry node, every non-entry node indegree exactly 1.
- Strict-tree layout must satisfy parent-above-child, left-child-left-of-parent, right-child-right-of-parent, no same-depth overlap, deterministic output.
- Non-tree fallback is fixed three-column row-major over lexically sorted node IDs.
- Layout is a pure function of the current TreeVisualModel; navigation history cannot affect geometry.
- Tree visual candidate priority is `[false, mutated, pointerRelevant, pointerCount]`.
- Do not add object-attribute AST relations in v0.1.
- Tree must not be hard-coded primary.
- Renderer uses HTML nodes + SVG internal edges and a bounded scrollable viewport with `max-height: 360px; overflow: auto`.
- Preserve existing List / Dict / Linked List behavior, Failure-First, Behavioral Timeline, Trace Outline, Previous/Next/Play, and `setStep` ownership.
- UI copy must remain factual: no bug, root cause, likely cause, correctness, infinite-loop, or LeetCode-TLE claims.

---

## File Structure

- Create `src/core/tree-interpreter.ts` — TreeNode detection, target classification, components, main/detached roles, pointers, topology facts, mutation projection.
- Create `tests/core/tree-interpreter.test.ts` — pure interpreter tests.
- Create `src/sidepanel/components/tree-layout.ts` — stateless strict-tree and fallback geometry.
- Create `tests/sidepanel/tree-layout.test.ts` — geometry and determinism tests.
- Create `src/sidepanel/components/TreeVisualizer.ts` — HTML/SVG rendering only.
- Create `tests/sidepanel/tree-visualizer.test.ts` — DOM, metadata, copy, bounded viewport behavior.
- Modify `src/core/visual-candidate.ts` — add `tree` to `VisualKind` only.
- Modify `src/core/visual-model.ts` — add Tree model to union, build Tree visuals, compute Tree priority using existing tuple.
- Modify `tests/core/visual-model.test.ts` — Tree candidate coexistence/priority regressions.
- Modify `src/sidepanel/components/visualizer-registry.ts` — register Tree visualizer.
- Create `tests/sidepanel/visualizer-registry.test.ts` — create/update/mismatched-kind contract.
- Modify `src/sidepanel/styles.css` — Tree viewport/node/edge/component styles.
- Modify `tests/sidepanel/trace-visualizer.test.ts` — raw-step, timeline, Failure-First, and autoplay synchronization with Tree state.
- Modify `README.md` and `README.zh-TW.md` — document Tree coverage and update the previous “trees outside scope” boundary.

---

### Task 1: Tree Interpreter Baseline — Detection, Topology, Components, Pointers

**Files:**
- Create: `src/core/tree-interpreter.ts`
- Create: `tests/core/tree-interpreter.test.ts`
- Reference: `src/core/linked-list-interpreter.ts`
- Reference: `src/core/runtime-state.ts`
- Reference: `src/shared/trace-types.ts`

**Interfaces:**
- Consumes: `RuntimeState`, `RuntimeMutation[]`, `ObjectSnapshot`, `ValueSnapshot`, `ObjectId`.
- Produces:

```ts
export type TreeTargetKind = "none" | "tree_node" | "external" | "unresolved";

export interface TreeNodeVisual {
  objectId: ObjectId;
  className: "TreeNode";
  label: ValueSnapshot | null;
  leftObjectId: ObjectId | null;
  rightObjectId: ObjectId | null;
  leftTargetKind: TreeTargetKind;
  rightTargetKind: TreeTargetKind;
  status: "unchanged" | "added" | "changed" | "detached";
  valueStatus: "unchanged" | "changed";
  leftStatus: "unchanged" | "added" | "removed" | "changed";
  rightStatus: "unchanged" | "added" | "removed" | "changed";
}

export interface TreePointerVisual {
  variableName: string;
  objectId: ObjectId | null;
  status: "unchanged" | "moved" | "added" | "removed";
}

export interface TreeComponent {
  componentId: string;
  nodeIds: ObjectId[];
  entryNodeIds: ObjectId[];
  pointerCount: number;
  cyclic: boolean;
  sharedChildNodeIds: ObjectId[];
  role: "main" | "detached";
}

export interface TreeVisualModel {
  kind: "tree";
  visualId: "tree:TreeNode";
  nodes: TreeNodeVisual[];
  components: TreeComponent[];
  pointers: TreePointerVisual[];
  truncated: boolean;
}

export function buildTreeVisuals(
  runtime: RuntimeState,
  mutations: RuntimeMutation[]
): TreeVisualModel[];
```

- [ ] **Step 1: Write failing Tree interpreter tests**

Create deterministic fixtures in `tests/core/tree-interpreter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RuntimeState } from "../../src/core/runtime-state";
import { buildTreeVisuals } from "../../src/core/tree-interpreter";
import type { ObjectSnapshot, ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const none = (): ValueSnapshot => ({ type: "none", value: null });
const treeRef = (objectId: string): ValueSnapshot => ({ type: "reference", objectId, className: "TreeNode" });
const otherRef = (objectId: string): ValueSnapshot => ({ type: "reference", objectId, className: "OtherNode" });

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
```

Add these concrete cases:

```ts
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
```

- [ ] **Step 2: Run interpreter tests and verify RED**

```bash
npx vitest run tests/core/tree-interpreter.test.ts
```

Expected: FAIL because `src/core/tree-interpreter.ts` does not exist.

- [ ] **Step 3: Implement TreeNode guards and target classification**

Use exact guards:

```ts
function isReference(value: ValueSnapshot | undefined): value is Extract<ValueSnapshot, { type: "reference" }> {
  return value?.type === "reference";
}

function isNone(value: ValueSnapshot | undefined): boolean {
  return value?.type === "none";
}

function isTreeNodeCandidate(object: ObjectSnapshot): boolean {
  const left = object.attributes.left;
  const right = object.attributes.right;
  return object.className === "TreeNode" &&
    left !== undefined && right !== undefined &&
    (isNone(left) || isReference(left)) &&
    (isNone(right) || isReference(right));
}

function classifyTarget(
  value: ValueSnapshot,
  allObjects: Map<ObjectId, ObjectSnapshot>,
  candidates: Map<ObjectId, ObjectSnapshot>
): { objectId: ObjectId | null; kind: TreeTargetKind } {
  if (value.type === "none") return { objectId: null, kind: "none" };
  const objectId = (value as Extract<ValueSnapshot, { type: "reference" }>).objectId;
  if (candidates.has(objectId)) return { objectId, kind: "tree_node" };
  if (allObjects.has(objectId)) return { objectId, kind: "external" };
  return { objectId, kind: "unresolved" };
}
```

Clone `val` with `cloneValueSnapshot` when present; otherwise use `null`.

- [ ] **Step 4: Implement deterministic topology analysis**

Build internal directed `left/right` targets only for `targetKind === "tree_node"`. From those edges:

```text
incoming[node] = count of internal TreeNode references targeting node
undirected adjacency = source↔target for component grouping
entryNodeIds = nodes with incoming == 0
sharedChildNodeIds = nodes with incoming > 1
```

Cycle detection uses finite DFS with `visiting` and `visited` sets over directed internal edges. Sort object IDs and adjacency traversal lexically before processing.

Component ID:

```ts
const componentId = `tree-component:${nodeIds[0]!}`;
```

- [ ] **Step 5: Implement current active-frame pointers and main role ranking**

Collect active-frame locals that reference candidate TreeNodes. Sort pointers by `variableName`. For Task 1 all statuses remain `"unchanged"`.

Rank components exactly:

```ts
const ranked = [...components].sort((left, right) =>
  right.pointerCount - left.pointerCount ||
  right.nodeIds.length - left.nodeIds.length ||
  left.componentId.localeCompare(right.componentId)
);
const mainId = ranked[0]?.componentId ?? null;
```

Return main first, then detached components sorted by componentId. Build nodes sorted by objectId with unchanged mutation statuses.

- [ ] **Step 6: Run interpreter tests and verify GREEN**

```bash
npx vitest run tests/core/tree-interpreter.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit baseline interpreter**

```bash
git add src/core/tree-interpreter.ts tests/core/tree-interpreter.test.ts
git commit -m "feat: interpret TreeNode topology"
```

---

### Task 2: Tree Mutation Projection and Direct Detachment Evidence

**Files:**
- Modify: `src/core/tree-interpreter.ts`
- Modify: `tests/core/tree-interpreter.test.ts`
- Reference: `src/core/runtime-mutation.ts`

**Interfaces:**
- Reuses Task 1 `buildTreeVisuals(runtime, mutations): TreeVisualModel[]`.
- Introduces no Tree-specific RuntimeMutation variant.

- [ ] **Step 1: Add failing mutation tests**

Append:

```ts
import type { RuntimeMutation } from "../../src/core/runtime-mutation";

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
```

- [ ] **Step 2: Run interpreter tests and verify RED**

```bash
npx vitest run tests/core/tree-interpreter.test.ts
```

Expected: new status assertions FAIL because Task 1 emits unchanged statuses.

- [ ] **Step 3: Implement pointer status projection**

Use existing reference semantics:

```ts
function pointerStatus(mutation: ReferenceMutation | undefined): TreePointerVisual["status"] {
  if (!mutation) return "unchanged";
  if (mutation.action === "bound") return "added";
  if (mutation.action === "unbound") return "removed";
  return "moved";
}
```

Add just-unbound pointers only when the mutation belongs to the active frame, `beforeObjectId` is a current candidate, and no current pointer with the same name already exists.

- [ ] **Step 4: Implement field/value/node status projection**

For object-attribute `ReferenceMutation` on `left/right`:

```text
bound → added
unbound → removed
redirected → changed
```

For `object_attribute` mutation on `val`, set `valueStatus = "changed"`.

Compute direct-detached candidate IDs from previous `left/right` targets of `unbound`/`redirected` mutations. Keep an ID detached only when it remains a current TreeNode candidate and its current internal incoming count is zero.

Assign node status exactly:

```ts
const status = appeared.has(objectId)
  ? "added"
  : detached.has(objectId)
    ? "detached"
    : changedObjectIds.has(objectId)
      ? "changed"
      : "unchanged";
```

- [ ] **Step 5: Run interpreter tests and verify GREEN**

```bash
npx vitest run tests/core/tree-interpreter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit mutation projection**

```bash
git add src/core/tree-interpreter.ts tests/core/tree-interpreter.test.ts
git commit -m "feat: project tree mutations"
```

---

### Task 3: Stateless Tree Layout

**Files:**
- Create: `src/sidepanel/components/tree-layout.ts`
- Create: `tests/sidepanel/tree-layout.test.ts`
- Reference: `src/core/tree-interpreter.ts`

**Interfaces:**

```ts
export const TREE_NODE_WIDTH = 104;
export const TREE_NODE_HEIGHT = 72;
export const TREE_HORIZONTAL_GAP = 32;
export const TREE_VERTICAL_GAP = 72;
export const TREE_FALLBACK_COLUMNS = 3;

export interface TreeLayoutNode {
  objectId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TreeLayoutEdge {
  fromObjectId: string;
  toObjectId: string;
  field: "left" | "right";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TreeComponentLayout {
  componentId: string;
  mode: "tree" | "fallback";
  width: number;
  height: number;
  nodes: TreeLayoutNode[];
  edges: TreeLayoutEdge[];
}

export function layoutTree(model: TreeVisualModel): TreeComponentLayout[];
```

- [ ] **Step 1: Write failing strict-tree and fallback layout tests**

Create literal Tree model fixtures and assert:

```ts
it("produces identical geometry for identical strict-tree models", () => {
  expect(layoutTree(strictModel)).toEqual(layoutTree(structuredClone(strictModel)));
});

it("places parent above children and preserves left/right direction", () => {
  const layout = layoutTree(strictModel)[0]!;
  const byId = new Map(layout.nodes.map((node) => [node.objectId, node]));
  const root = byId.get("obj-4")!;
  const left = byId.get("obj-2")!;
  const right = byId.get("obj-7")!;
  expect(left.y).toBeGreaterThan(root.y);
  expect(right.y).toBeGreaterThan(root.y);
  expect(left.x).toBeLessThan(root.x);
  expect(right.x).toBeGreaterThan(root.x);
});

it("does not overlap same-depth strict-tree nodes", () => {
  const layout = layoutTree(strictModel)[0]!;
  const rows = new Map<number, TreeLayoutNode[]>();
  for (const node of layout.nodes) rows.set(node.y, [...(rows.get(node.y) ?? []), node]);
  for (const row of rows.values()) {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index]!.x - sorted[index - 1]!.x).toBeGreaterThanOrEqual(TREE_NODE_WIDTH);
    }
  }
});

it("uses fixed three-column lexical fallback for cycle/shared-child topology", () => {
  const layout = layoutTree(fiveNodeFallbackModel)[0]!;
  expect(layout.mode).toBe("fallback");
  expect(layout.nodes.map((node) => node.objectId)).toEqual(["obj-1", "obj-2", "obj-3", "obj-4", "obj-5"]);
  expect(layout.nodes[0]!.y).toBe(layout.nodes[2]!.y);
  expect(layout.nodes[3]!.y).toBeGreaterThan(layout.nodes[0]!.y);
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
```

- [ ] **Step 2: Run layout tests and verify RED**

```bash
npx vitest run tests/sidepanel/tree-layout.test.ts
```

Expected: FAIL because `tree-layout.ts` does not exist.

- [ ] **Step 3: Implement strict-tree eligibility**

Require all of:

```text
component.cyclic === false
component.sharedChildNodeIds.length === 0
component.entryNodeIds.length === 1
every non-entry internal node has indegree === 1
```

Otherwise choose fallback.

- [ ] **Step 4: Implement deterministic hierarchical layout**

Use `TREE_NODE_WIDTH + TREE_HORIZONTAL_GAP` for horizontal stride and `TREE_NODE_HEIGHT + TREE_VERTICAL_GAP` for vertical stride. Recursively memoize subtree span for strict topology only. Place leaves in one slot, preserve explicit left-before-right ordering, and normalize x so the minimum node x is 0.

Internal SVG edge geometry is:

```ts
x1 = parent.x + TREE_NODE_WIDTH / 2;
y1 = parent.y + TREE_NODE_HEIGHT;
x2 = child.x + TREE_NODE_WIDTH / 2;
y2 = child.y;
```

Only `targetKind === "tree_node"` produces layout edges.

- [ ] **Step 5: Implement fixed three-column fallback**

Sort node IDs lexically. Place:

```ts
const column = index % TREE_FALLBACK_COLUMNS;
const row = Math.floor(index / TREE_FALLBACK_COLUMNS);
const x = column * (TREE_NODE_WIDTH + TREE_HORIZONTAL_GAP);
const y = row * (TREE_NODE_HEIGHT + TREE_VERTICAL_GAP);
```

Build internal edges by coordinate lookup after all nodes are placed; never recursively traverse fallback topology.

- [ ] **Step 6: Run layout tests and verify GREEN**

```bash
npx vitest run tests/sidepanel/tree-layout.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit layout**

```bash
git add src/sidepanel/components/tree-layout.ts tests/sidepanel/tree-layout.test.ts
git commit -m "feat: lay out tree visuals"
```

---

### Task 4: Tree Renderer, DOM Metadata, Factual Notices, Styles

**Files:**
- Create: `src/sidepanel/components/TreeVisualizer.ts`
- Create: `tests/sidepanel/tree-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`
- Reference: `src/sidepanel/components/LinkedListVisualizer.ts`
- Reference: `src/sidepanel/components/value-format.ts`

**Interfaces:**

```ts
export interface TreeVisualizerHandle {
  element: HTMLElement;
  update(model: TreeVisualModel): void;
  dispose(): void;
}

export function createTreeVisualizer(initialModel: TreeVisualModel): TreeVisualizerHandle;
```

- [ ] **Step 1: Write failing renderer tests**

Use a strict Tree model fixture with root/left/right nodes and a `root` pointer. Add:

```ts
it("renders nodes, pointer badges, and SVG internal edge metadata", () => {
  const handle = createTreeVisualizer(model);
  expect(handle.element.dataset.visualId).toBe("tree:TreeNode");
  expect(handle.element.querySelector('[data-node-id="obj-1"]')).not.toBeNull();
  expect(handle.element.querySelector('[data-pointer-name="root"][data-pointer-status="unchanged"]')).not.toBeNull();
  expect(handle.element.querySelector(
    '[data-edge-from="obj-1"][data-edge-to="obj-2"][data-edge-field="left"][data-edge-target-kind="tree_node"]'
  )).not.toBeNull();
});

it("renders changed val independently", () => {
  const changed = structuredClone(model);
  changed.nodes[0]!.valueStatus = "changed";
  const handle = createTreeVisualizer(changed);
  expect(handle.element.querySelector('[data-node-id="obj-1"] [data-value-status="changed"]')).not.toBeNull();
});

it("renders removed, external, and unresolved edge terminals without fake nodes", () => {
  const special = structuredClone(model);
  special.nodes[0]!.leftObjectId = null;
  special.nodes[0]!.leftTargetKind = "none";
  special.nodes[0]!.leftStatus = "removed";
  special.nodes[0]!.rightObjectId = "missing-9";
  special.nodes[0]!.rightTargetKind = "unresolved";
  const handle = createTreeVisualizer(special);
  expect(handle.element.querySelector('[data-edge-field="left"][data-edge-status="removed"]')?.textContent)
    .toContain("left → None");
  expect(handle.element.querySelector('[data-edge-field="right"][data-edge-target-kind="unresolved"]')?.textContent)
    .toContain("missing-9");
  expect(handle.element.querySelector('[data-node-id="missing-9"]')).toBeNull();
});

it("renders factual cycle/shared-child/truncation notices and no diagnosis", () => {
  const abnormal = sharedCycleModel;
  const text = createTreeVisualizer(abnormal).element.textContent ?? "";
  expect(text).toContain("Cycle detected in TreeNode references");
  expect(text).toContain("Shared child: obj-2 has 2 incoming TreeNode references");
  expect(text).toContain("Topology truncated");
  expect(text).not.toMatch(/root cause|likely cause|this is the bug|caused|infinite loop|LeetCode TLE/i);
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
```

- [ ] **Step 2: Run renderer tests and verify RED**

```bash
npx vitest run tests/sidepanel/tree-visualizer.test.ts
```

Expected: FAIL because `TreeVisualizer.ts` does not exist.

- [ ] **Step 3: Implement DOM/SVG renderer**

Start with:

```ts
function render(model: TreeVisualModel): HTMLElement {
  const section = document.createElement("section");
  section.className = "tree-visualizer";
  section.dataset.visualId = model.visualId;
  section.setAttribute("aria-label", "TreeNode visualization");

  const viewport = document.createElement("div");
  viewport.className = "tree-visualizer__viewport";
  section.append(viewport);

  const layouts = layoutTree(model);
  // render component canvases from layouts and model facts
  return section;
}
```

For every TreeNode card add `data-node-id`, `data-node-status`, formatted `val`, objectId, pointer badges, and `data-value-status`.

For every internal TreeNode SVG edge add `data-edge-from`, `data-edge-to`, `data-edge-field`, `data-edge-status`, `data-edge-target-kind="tree_node"`.

For current `external`/`unresolved` references and current `None` slots with `status="removed"`, render compact HTML terminal markers with the same `data-edge-*` fields. These terminals are not TreeNode cards.

- [ ] **Step 4: Implement factual notices**

Compute current incoming TreeNode counts from model nodes. Render:

```text
Cycle detected in TreeNode references
Shared child: <objectId> has <N> incoming TreeNode references
Topology truncated
```

Show truncation only when `model.truncated` is true.

- [ ] **Step 5: Add bounded Tree styles**

Append focused rules:

```css
.tree-visualizer__viewport {
  position: relative;
  max-height: 360px;
  overflow: auto;
}

.tree-visualizer__canvas {
  position: relative;
  min-width: 100%;
}

.tree-visualizer__edges {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.tree-visualizer__node {
  position: absolute;
  width: 104px;
  min-height: 72px;
}
```

Reuse existing CSS variables/colors. Add modifier classes for `is-added`, `is-changed`, `is-detached`, edge statuses, pointer badges, component headings, and notices.

- [ ] **Step 6: Run renderer tests and verify GREEN**

```bash
npx vitest run tests/sidepanel/tree-visualizer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit renderer**

```bash
git add src/sidepanel/components/TreeVisualizer.ts src/sidepanel/styles.css tests/sidepanel/tree-visualizer.test.ts
git commit -m "feat: render TreeNode visuals"
```

---

### Task 5: Visual Model, Candidate Priority, and Registry Integration

**Files:**
- Modify: `src/core/visual-candidate.ts`
- Modify: `src/core/visual-model.ts`
- Modify: `tests/core/visual-model.test.ts`
- Modify: `src/sidepanel/components/visualizer-registry.ts`
- Create: `tests/sidepanel/visualizer-registry.test.ts`

**Interfaces:**
- `VisualKind` adds `"tree"`.
- `StructureVisualModel` adds `TreeVisualModel`.
- Resolver sorting and visible limit remain unchanged.
- Registry gains a typed `tree` factory.

- [ ] **Step 1: Add concrete Tree helpers and failing priority tests to `visual-model.test.ts`**

Add:

```ts
const treeRef = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "TreeNode"
});

function treeRuntime(extraLocals: Record<string, ValueSnapshot> = {}): RuntimeState {
  return {
    ...runtime({ root: treeRef("tree-1"), ...extraLocals }),
    objectTopology: {
      objects: new Map([["tree-1", {
        objectId: "tree-1",
        className: "TreeNode",
        attributes: {
          val: int(1),
          left: { type: "none", value: null },
          right: { type: "none", value: null }
        }
      }]]),
      truncated: false
    }
  };
}
```

Add exact tests:

```ts
it("builds Tree through the existing visual state path", () => {
  const state = buildVisualState(treeRuntime(), null, [], null, []);
  expect(state.visuals.find((visual) => visual.kind === "tree")).toMatchObject({
    kind: "tree",
    visualId: "tree:TreeNode"
  });
  expect(state.primaryVisualId).toBe("tree:TreeNode");
});

it("prioritizes a mutated Tree over a pointer-relevant non-mutated list", () => {
  const state = buildVisualState(
    treeRuntime({ nums: list([1, 2, 3]), i: int(1) }),
    null,
    [{ ...relation("i"), line: 99 }],
    null,
    [{
      kind: "object_attribute",
      origin: "transition",
      objectId: "tree-1",
      attribute: "val",
      action: "changed",
      before: int(0),
      after: int(1)
    }]
  );
  expect(state.primaryVisualId).toBe("tree:TreeNode");
});

it("does not hard-code Tree primary over a mutated dict", () => {
  const state = buildVisualState(
    treeRuntime({ seen: dict([[1, 10]]) }),
    null,
    [],
    null,
    [{
      kind: "mapping_entry",
      origin: "transition",
      frameId: 4,
      containerName: "seen",
      key: int(2),
      action: "added",
      after: int(11)
    }]
  );
  expect(state.primaryVisualId).toBe("dict:seen");
});
```

- [ ] **Step 2: Add failing typed registry tests**

Create `tests/sidepanel/visualizer-registry.test.ts` with a complete one-node Tree model and a one-item List model, then assert:

```ts
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
```

`treeModel(objectId)` must return a valid `TreeVisualModel` with one main component, one unchanged node, and no pointers. `listModel()` must return a valid `ListVisualModel` with `visualId: "list:nums"`.

- [ ] **Step 3: Run integration tests and verify RED**

```bash
npx vitest run tests/core/visual-model.test.ts tests/sidepanel/visualizer-registry.test.ts
```

Expected: FAIL because Tree is not yet in model/registry unions.

- [ ] **Step 4: Extend union types without changing resolver policy**

Change:

```ts
export type VisualKind = "list" | "dict" | "linked_list" | "tree";
```

In `visual-model.ts`:

```ts
import { buildTreeVisuals, type TreeVisualModel } from "./tree-interpreter";
export type StructureVisualModel = ContainerVisualModel | LinkedListVisualModel | TreeVisualModel;
```

Build Tree alongside existing visuals:

```ts
const treeVisuals = buildTreeVisuals(runtime, mutations);
const allVisuals: StructureVisualModel[] = [...containerVisuals, ...linkedListVisuals, ...treeVisuals];
```

- [ ] **Step 5: Add Tree candidate priority exactly as specified**

Add `treeWasMutated(visual, activeFrameId, mutations)` that returns true when a mutation touches a represented Tree node/object attribute, represented active-frame pointer name, or visibility for a represented current Tree node.

Candidate:

```ts
if (visual.kind === "tree") {
  const pointerRelevant = visual.pointers.length > 0;
  const mutated = treeWasMutated(visual, activeFrameId, mutations);
  return {
    visualId: visual.visualId,
    kind: visual.kind,
    priority: [false, mutated, pointerRelevant, visual.pointers.length] as const
  };
}
```

Do not inspect source text, `root` names, or add AST relations.

- [ ] **Step 6: Register Tree visualizer**

Add:

```ts
import { createTreeVisualizer } from "./TreeVisualizer";
```

and:

```ts
tree: (model: ModelOf<"tree">) =>
  withVisualId(model, createTreeVisualizer(model), "tree")
```

inside the existing `registry satisfies VisualizerRegistry` object.

- [ ] **Step 7: Run integration and existing visualizer regressions**

```bash
npx vitest run \
  tests/core/visual-model.test.ts \
  tests/core/visual-candidate-resolver.test.ts \
  tests/core/linked-list-interpreter.test.ts \
  tests/sidepanel/visualizer-registry.test.ts \
  tests/sidepanel/linked-list-visualizer.test.ts \
  tests/sidepanel/list-visualizer.test.ts
```

Expected: PASS. Resolver behavior and visible limit are unchanged.

- [ ] **Step 8: Commit visual integration**

```bash
git add src/core/visual-candidate.ts src/core/visual-model.ts tests/core/visual-model.test.ts src/sidepanel/components/visualizer-registry.ts tests/sidepanel/visualizer-registry.test.ts
git commit -m "feat: integrate tree visual selection"
```

---

### Task 6: End-to-End Navigation Regression, Documentation, Full Gates

**Files:**
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `README.md`
- Modify: `README.zh-TW.md`
- Reference: `src/sidepanel/components/TraceVisualizer.ts`

**Interfaces:**
- No new production interface.
- Confirms `interpretTrace → VisualState → visualizer-registry` keeps Tree synchronized under every existing raw-step owner.

- [ ] **Step 1: Add exact Tree trace helpers to `trace-visualizer.test.ts`**

Add:

```ts
const treeReference = (objectId: string) => ({
  type: "reference" as const,
  objectId,
  className: "TreeNode"
});

const treeObject = (
  objectId: string,
  value: number,
  left: string | null = null,
  right: string | null = null
) => ({
  objectId,
  className: "TreeNode",
  attributes: {
    val: int(value),
    left: left === null ? { type: "none" as const, value: null } : treeReference(left),
    right: right === null ? { type: "none" as const, value: null } : treeReference(right)
  }
});

function treeSession(): TraceSession {
  const base = session();
  return {
    ...base,
    sourceCode: "class Solution:\n    def solve(self, root):\n        child = TreeNode(2)\n        root.left = child\n        return root\n",
    rawTestcase: "[4]",
    subscriptRelations: [],
    events: [
      {
        ...base.events[0]!,
        step: 1,
        function: "solve",
        line: 2,
        locals: { root: treeReference("obj-1") },
        objects: [treeObject("obj-1", 4)],
        objectsTruncated: false
      },
      {
        ...base.events[0]!,
        step: 2,
        function: "solve",
        line: 4,
        locals: { root: treeReference("obj-1"), child: treeReference("obj-2") },
        objects: [treeObject("obj-1", 4, "obj-2"), treeObject("obj-2", 2)],
        objectsTruncated: false
      }
    ]
  };
}

function treeBehaviorSession(): TraceSession {
  const base = alternatingRepeatedStateSession();
  return {
    ...base,
    events: base.events.map((event) => ({
      ...event,
      locals: { ...event.locals, root: treeReference("obj-1") },
      objects: [treeObject("obj-1", 4, "obj-2"), treeObject("obj-2", 2)],
      objectsTruncated: false
    }))
  };
}

function treeFailureFirstSession(): TraceSession {
  const base = failureFirstSession("timeout");
  return {
    ...base,
    events: base.events.map((event) => ({
      ...event,
      locals: { ...event.locals, root: treeReference("obj-1") },
      objects: [treeObject("obj-1", 4, "obj-2"), treeObject("obj-2", 2)],
      objectsTruncated: false
    }))
  };
}
```

- [ ] **Step 2: Add raw-step and autoplay Tree synchronization tests**

```ts
it("keeps Tree state synchronized with direct raw-step navigation", () => {
  const view = createTraceVisualizer(treeSession());
  expect(view.element.querySelector('[data-node-id="obj-2"]')).toBeNull();

  view.setStep(1);

  expect(view.element.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
  expect(view.element.querySelector(
    '[data-edge-from="obj-1"][data-edge-to="obj-2"][data-edge-field="left"]'
  )).not.toBeNull();
  expect(view.element.querySelector('[data-pointer-name="child"]')).not.toBeNull();
});

it("updates Tree through the existing autoplay cursor", () => {
  vi.useFakeTimers();
  try {
    const view = createTraceVisualizer(treeSession());
    view.element.querySelector<HTMLButtonElement>("#trace-play")!.click();
    vi.advanceTimersByTime(700);
    expect(view.element.dataset.stepIndex).toBe("1");
    expect(view.element.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
    view.dispose();
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 3: Add Behavioral Timeline and Failure-First Tree synchronization tests**

```ts
it("updates Tree when a behavioral timeline band navigates the raw cursor", () => {
  const view = createTraceVisualizer(treeBehaviorSession());
  view.setStep(4);
  const band = view.element.querySelector<HTMLButtonElement>(
    '.trace-viewer__timeline-band[data-pattern-kind="repeated_state"]'
  )!;
  band.click();

  expect(view.element.dataset.stepIndex).toBe("0");
  expect(view.element.querySelector('[data-node-id="obj-1"]')).not.toBeNull();
  expect(view.element.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
  expect(view.element.querySelector('[data-edge-from="obj-1"][data-edge-to="obj-2"]')).not.toBeNull();
});

it("updates Tree when Failure-First Inspect navigates through the existing owner", () => {
  const view = createTraceVisualizer(treeFailureFirstSession());
  view.element.querySelector<HTMLButtonElement>(
    ".trace-viewer__failure-first-inspect"
  )!.click();

  expect(view.element.dataset.stepIndex).toBe("5");
  expect(view.element.querySelector('[data-node-id="obj-1"]')).not.toBeNull();
  expect(view.element.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
  expect(view.element.querySelector('[data-edge-from="obj-1"][data-edge-to="obj-2"]')).not.toBeNull();
});
```

These tests must pass without changing `TraceVisualizer` navigation code.

- [ ] **Step 4: Run TraceVisualizer regression**

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts
```

Expected: PASS. If Tree assertions fail, fix Tree interpretation/rendering/integration; do not add a Tree-specific cursor.

- [ ] **Step 5: Update English README**

Add after linked-list coverage:

```markdown
- dedicated binary-tree visualization for standard LeetCode `TreeNode` objects, including active pointers, `left` / `right` edge mutation, detached components, and deterministic cycle/shared-child fallback presentation;
```

Replace the old boundary saying trees are outside scope with:

```markdown
Dedicated TreeNode visualization supports the standard LeetCode binary-tree shape only. Generic node-edge graphs, custom/N-ary tree inference, and DP tables remain outside the current scope.
```

Add document links:

```markdown
- [Tree Visualization Design Spec](docs/superpowers/specs/2026-09-11-tree-visualization-design.md)
- [Tree Visualization Implementation Plan](docs/superpowers/plans/2026-09-11-tree-visualization-implementation-plan.md)
```

- [ ] **Step 6: Mirror the same scope in `README.zh-TW.md`**

Add:

```markdown
- 標準 LeetCode `TreeNode` 的專用二元樹視覺化，包含 active pointer、`left` / `right` 邊變更、斷開 component，以及 cycle / shared-child 的 deterministic fallback 呈現；
```

Use this boundary:

```markdown
專用 TreeNode 視覺化目前只支援標準 LeetCode binary-tree 結構；generic node-edge graph、自訂／N-ary tree inference 與 DP table 仍不在目前範圍內。
```

Add the two Tree document links with Traditional Chinese labels.

- [ ] **Step 7: Run dedicated Tree gates**

```bash
npx vitest run \
  tests/core/tree-interpreter.test.ts \
  tests/sidepanel/tree-layout.test.ts \
  tests/sidepanel/tree-visualizer.test.ts \
  tests/core/visual-model.test.ts \
  tests/sidepanel/visualizer-registry.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run full regression, typecheck, and builds**

```bash
npm test
npm run typecheck
npm run build
```

Expected:

```text
vitest: all test files pass
TypeScript: exits 0 with no type errors
Vite side panel/content/page-bridge builds: exit 0
```

Existing non-blocking dependency/Vite warnings may remain if unchanged; do not introduce new Tree-attributable warnings.

- [ ] **Step 9: Scan Tree copy for forbidden diagnostic language**

```bash
grep -RniE "root cause|likely cause|this is the bug|caused.*(timeout|failure)|infinite loop" \
  src/sidepanel/components/TreeVisualizer.ts \
  tests/sidepanel/tree-visualizer.test.ts
```

Expected: no matches.

- [ ] **Step 10: Commit navigation coverage and docs**

```bash
git add tests/sidepanel/trace-visualizer.test.ts README.md README.zh-TW.md
git commit -m "docs: document tree visualization coverage"
```

---

## Final Verification Checklist

Before claiming Tree Visualization complete, collect fresh evidence for every item below:

```text
[ ] Standard TreeNode detection works without problem-title/configuration inference.
[ ] Foo(left,right) and malformed TreeNode slots fail closed.
[ ] Missing val still renders topology.
[ ] none/tree_node/external/unresolved child kinds are distinct.
[ ] runtime.objectTopology.truncated is the sole model.truncated authority.
[ ] Multiple components remain visible.
[ ] Main selection uses pointer coverage → node count → componentId only.
[ ] Current pointers and just-removed pointers are active-frame scoped.
[ ] left/right/val/local pointer/object appearance statuses derive from RuntimeMutation[].
[ ] Directly detached node semantics do not propagate to descendants.
[ ] Cycles remain visible and finite.
[ ] Shared children remain visible with actual incoming count.
[ ] Strict trees use deterministic hierarchical geometry.
[ ] Non-tree topology uses deterministic three-column fallback.
[ ] Same TreeVisualModel always produces the same geometry.
[ ] Renderer uses bounded scrolling rather than model pruning.
[ ] External/unresolved references do not create fake TreeNode cards.
[ ] Tree priority is exactly [false, mutated, pointerRelevant, pointerCount].
[ ] Existing resolver policy and visible limit are unchanged.
[ ] Tree is not automatically primary.
[ ] Existing List/Dict/Linked List tests remain green.
[ ] TraceVisualizer navigation requires no Tree-specific cursor/state.
[ ] Failure-First/Timeline/Outline/Play behavior remains unchanged.
[ ] README boundaries distinguish TreeNode support from generic Graph/N-ary/DP non-goals.
[ ] npm test passes.
[ ] npm run typecheck passes.
[ ] npm run build passes.
```

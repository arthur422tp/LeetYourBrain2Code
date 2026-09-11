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
- Modify `tests/sidepanel/trace-visualizer.test.ts` — end-to-end navigation/state synchronization for Tree visuals.
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

- [ ] **Step 1: Write failing Tree detection and target-classification tests**

Create deterministic helpers in `tests/core/tree-interpreter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RuntimeState } from "../../src/core/runtime-state";
import { buildTreeVisuals } from "../../src/core/tree-interpreter";
import type { ObjectSnapshot, ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const none = (): ValueSnapshot => ({ type: "none", value: null });
const treeRef = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "TreeNode"
});
const externalRef = (objectId: string): ValueSnapshot => ({
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
    frames: new Map([[
      4,
      {
        frameId: 4,
        parentFrameId: null,
        functionName: "solve",
        line: 9,
        locals: input.locals ?? {}
      }
    ]]),
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

Add concrete cases:

```ts
it("detects only TreeNode objects with reference-or-None left/right slots", () => {
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
    objects: [treeNode("obj-1", 1, null, null), lookalike, malformed]
  }), [])[0]!;

  expect(visual.nodes.map((node) => node.objectId)).toEqual(["obj-1"]);
});

it("allows missing val while preserving TreeNode topology", () => {
  const visual = buildTreeVisuals(runtimeWithTree({
    objects: [treeNode("obj-1", null, null, null)]
  }), [])[0]!;
  expect(visual.nodes[0]).toMatchObject({ objectId: "obj-1", label: null });
});

it("classifies tree_node, external, unresolved, and none child targets without conflating truncation", () => {
  const root = treeNode("obj-1", 1, "obj-2", null);
  root.attributes.right = externalRef("ext-1");
  const external: ObjectSnapshot = {
    objectId: "ext-1",
    className: "OtherNode",
    attributes: {}
  };
  const visual = buildTreeVisuals(runtimeWithTree({
    objects: [root, treeNode("obj-2", 2, null, null), external]
  }), [])[0]!;
  const rootVisual = visual.nodes.find((node) => node.objectId === "obj-1")!;

  expect(rootVisual).toMatchObject({
    leftObjectId: "obj-2",
    leftTargetKind: "tree_node",
    rightObjectId: "ext-1",
    rightTargetKind: "external"
  });
  expect(visual.truncated).toBe(false);

  root.attributes.right = treeRef("missing-1");
  const unresolved = buildTreeVisuals(runtimeWithTree({ objects: [root, treeNode("obj-2", 2, null, null)] }), [])[0]!;
  expect(unresolved.nodes.find((node) => node.objectId === "obj-1")).toMatchObject({
    rightObjectId: "missing-1",
    rightTargetKind: "unresolved"
  });
  expect(unresolved.truncated).toBe(false);
});
```

- [ ] **Step 2: Write failing topology/component/main-role tests**

```ts
it("builds deterministic components and selects main by pointer coverage then size then id", () => {
  const visual = buildTreeVisuals(runtimeWithTree({
    locals: {
      current: treeRef("obj-2"),
      parent: treeRef("obj-1"),
      temp: treeRef("obj-9")
    },
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

it("uses node count then componentId when pointer coverage ties", () => {
  const visual = buildTreeVisuals(runtimeWithTree({
    objects: [
      treeNode("obj-5", 5, null, null),
      treeNode("obj-1", 1, "obj-2", null),
      treeNode("obj-2", 2, null, null)
    ]
  }), [])[0]!;
  expect(visual.components.find((component) => component.role === "main")?.componentId)
    .toBe("tree-component:obj-1");
});
```

- [ ] **Step 3: Write failing pointer/cycle/shared-child/truncation tests**

```ts
it("keeps active-frame TreeNode aliases as factual pointers", () => {
  const visual = buildTreeVisuals(runtimeWithTree({
    locals: { root: treeRef("obj-1"), curr: treeRef("obj-2"), alias: treeRef("obj-2") },
    objects: [treeNode("obj-1", 1, "obj-2", null), treeNode("obj-2", 2, null, null)]
  }), [])[0]!;

  expect(visual.pointers).toEqual([
    { variableName: "alias", objectId: "obj-2", status: "unchanged" },
    { variableName: "curr", objectId: "obj-2", status: "unchanged" },
    { variableName: "root", objectId: "obj-1", status: "unchanged" }
  ]);
});

it("reports cycle and shared child as topology facts without dropping the component", () => {
  const cycle = buildTreeVisuals(runtimeWithTree({
    objects: [treeNode("obj-1", 1, "obj-1", null)]
  }), [])[0]!;
  expect(cycle.components[0]).toMatchObject({ cyclic: true, nodeIds: ["obj-1"] });

  const shared = buildTreeVisuals(runtimeWithTree({
    objects: [
      treeNode("obj-1", 1, "obj-2", "obj-2"),
      treeNode("obj-2", 2, null, null)
    ]
  }), [])[0]!;
  expect(shared.components[0]).toMatchObject({
    cyclic: false,
    sharedChildNodeIds: ["obj-2"]
  });
});

it("propagates runtime topology truncation only", () => {
  expect(buildTreeVisuals(runtimeWithTree({
    objects: [treeNode("obj-1", 1, null, null)],
    truncated: true
  }), [])[0]?.truncated).toBe(true);
});

it("returns no Tree visual when no candidate exists", () => {
  expect(buildTreeVisuals(runtimeWithTree({ objects: [] }), [])).toEqual([]);
});
```

- [ ] **Step 4: Run interpreter tests and verify RED**

```bash
npx vitest run tests/core/tree-interpreter.test.ts
```

Expected: FAIL because `src/core/tree-interpreter.ts` does not exist.

- [ ] **Step 5: Implement candidate detection and target classification**

Start `src/core/tree-interpreter.ts` with these exact guards and public interfaces:

```ts
import type { RuntimeState } from "./runtime-state";
import type { RuntimeMutation } from "./runtime-mutation";
import type { ObjectId, ObjectSnapshot, ValueSnapshot } from "../shared/trace-types";
import { cloneValueSnapshot } from "./value-snapshot";

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

function labelFor(object: ObjectSnapshot): ValueSnapshot | null {
  const value = object.attributes.val;
  return value ? cloneValueSnapshot(value) : null;
}
```

For each child slot, classify using current captured objects:

```ts
function classifyTarget(
  value: ValueSnapshot,
  allObjects: Map<ObjectId, ObjectSnapshot>,
  candidates: Map<ObjectId, ObjectSnapshot>
): { objectId: ObjectId | null; kind: TreeTargetKind } {
  if (value.type === "none") {
    return { objectId: null, kind: "none" };
  }
  const objectId = (value as Extract<ValueSnapshot, { type: "reference" }>).objectId;
  if (candidates.has(objectId)) return { objectId, kind: "tree_node" };
  if (allObjects.has(objectId)) return { objectId, kind: "external" };
  return { objectId, kind: "unresolved" };
}
```

- [ ] **Step 6: Implement deterministic component analysis and topology facts**

Use only internal `tree_node` edges. Build `incoming: Map<ObjectId, number>` and undirected adjacency. Sort all traversals lexically before enqueueing. Component ID is:

```ts
const componentId = `tree-component:${nodeIds[0]}`;
```

Cycle detection must use a directed DFS over current `left/right` internal targets with `visiting` + `visited` sets. Shared children are exactly nodes with `incoming > 1`.

After pointer collection, assign roles by sorting component summaries:

```ts
const ranked = [...components].sort((left, right) =>
  right.pointerCount - left.pointerCount ||
  right.nodeIds.length - left.nodeIds.length ||
  left.componentId.localeCompare(right.componentId)
);
const mainId = ranked[0]?.componentId ?? null;
```

Return components in presentation order: main first, then detached by `componentId`.

- [ ] **Step 7: Implement baseline active-frame pointers and unchanged statuses**

Collect current active-frame locals whose reference target is in `candidates`, sort by `variableName`, and emit `status: "unchanged"` for Task 1.

Build nodes in lexical objectId order with:

```ts
status: "unchanged",
valueStatus: "unchanged",
leftStatus: "unchanged",
rightStatus: "unchanged"
```

Return:

```ts
return [{
  kind: "tree",
  visualId: "tree:TreeNode",
  nodes,
  components,
  pointers,
  truncated: runtime.objectTopology.truncated
}];
```

- [ ] **Step 8: Run interpreter tests and verify GREEN**

```bash
npx vitest run tests/core/tree-interpreter.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit baseline interpreter**

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
- Consumes existing `RuntimeMutation[]`; no new mutation kind.
- Preserves the Task 1 `buildTreeVisuals(runtime, mutations): TreeVisualModel[]` interface.
- Produces factual pointer/node/field statuses in the existing Tree model.

- [ ] **Step 1: Write failing pointer and field mutation tests**

Append:

```ts
import type { RuntimeMutation } from "../../src/core/runtime-mutation";

it("projects local reference movement without renaming pointer semantics", () => {
  const mutations: RuntimeMutation[] = [{
    kind: "reference",
    origin: "transition",
    owner: { scope: "local", frameId: 4, variableName: "curr" },
    action: "redirected",
    beforeObjectId: "obj-1",
    afterObjectId: "obj-2"
  }];
  const visual = buildTreeVisuals(runtimeWithTree({
    locals: { curr: treeRef("obj-2") },
    objects: [treeNode("obj-1", 1, null, null), treeNode("obj-2", 2, null, null)]
  }), mutations)[0]!;

  expect(visual.pointers).toContainEqual({
    variableName: "curr",
    objectId: "obj-2",
    status: "moved"
  });
});

it("retains just-unbound Tree pointer as removed with null target", () => {
  const visual = buildTreeVisuals(runtimeWithTree({
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

  expect(visual.pointers).toContainEqual({ variableName: "root", objectId: null, status: "removed" });
});

it("maps left and right reference actions to edge statuses", () => {
  const visual = buildTreeVisuals(runtimeWithTree({
    objects: [treeNode("obj-1", 1, null, "obj-3"), treeNode("obj-2", 2, null, null), treeNode("obj-3", 3, null, null)]
  }), [
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
    }
  ])[0]!;

  expect(visual.nodes.find((node) => node.objectId === "obj-1")).toMatchObject({
    leftStatus: "removed",
    rightStatus: "changed",
    status: "changed"
  });
});
```

- [ ] **Step 2: Write failing value/appearance/detachment precedence tests**

```ts
it("projects val mutation and appeared visibility into independent statuses", () => {
  const visual = buildTreeVisuals(runtimeWithTree({
    objects: [treeNode("obj-1", 2, null, null), treeNode("obj-2", 9, null, null)]
  }), [
    {
      kind: "object_attribute",
      origin: "transition",
      objectId: "obj-1",
      attribute: "val",
      action: "changed",
      before: int(1),
      after: int(2)
    },
    {
      kind: "object_visibility",
      origin: "transition",
      objectId: "obj-2",
      action: "appeared"
    }
  ])[0]!;

  expect(visual.nodes.find((node) => node.objectId === "obj-1")).toMatchObject({
    valueStatus: "changed",
    status: "changed"
  });
  expect(visual.nodes.find((node) => node.objectId === "obj-2")?.status).toBe("added");
});

it("marks only the directly removed child detached when its current incoming count becomes zero", () => {
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

it("does not mark previous child detached when another current TreeNode edge still targets it", () => {
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

- [ ] **Step 3: Run interpreter tests and verify RED**

```bash
npx vitest run tests/core/tree-interpreter.test.ts
```

Expected: new mutation assertions FAIL because Task 1 emits unchanged statuses only.

- [ ] **Step 4: Implement pointer-status projection**

Add helpers equivalent to existing Linked List semantics:

```ts
function localReferenceMutation(
  mutations: RuntimeMutation[],
  frameId: number,
  variableName: string
): ReferenceMutation | undefined {
  return mutations.find((mutation): mutation is ReferenceMutation =>
    mutation.kind === "reference" &&
    mutation.owner.scope === "local" &&
    mutation.owner.frameId === frameId &&
    mutation.owner.variableName === variableName
  );
}

function pointerStatus(...): TreePointerVisual["status"] {
  const mutation = localReferenceMutation(...);
  if (!mutation) return "unchanged";
  if (mutation.action === "bound") return "added";
  if (mutation.action === "unbound") return "removed";
  return "moved";
}
```

When adding removed pointers, require all of:

```text
owner.scope === "local"
owner.frameId === activeFrameId
action === "unbound"
beforeObjectId is a current TreeNode candidate
no current pointer with the same variableName already exists
```

- [ ] **Step 5: Implement edge/value/node mutation projection and precedence**

For `left/right`, find the matching object-attribute `ReferenceMutation` and map:

```ts
function edgeStatus(mutation: ReferenceMutation | undefined): TreeNodeVisual["leftStatus"] {
  if (!mutation) return "unchanged";
  if (mutation.action === "bound") return "added";
  if (mutation.action === "unbound") return "removed";
  return "changed";
}
```

For `val`, `valueStatus = "changed"` only when a current-step `object_attribute` mutation targets that object and attribute `val`.

Compute direct-detached IDs from previous `left/right` targets of `unbound`/`redirected` mutations and current internal incoming counts. Then assign node status in this exact order:

```ts
const status = appeared.has(objectId)
  ? "added"
  : detached.has(objectId)
    ? "detached"
    : changedObjectIds.has(objectId)
      ? "changed"
      : "unchanged";
```

`changedObjectIds` may include reference/object-attribute mutations on the current TreeNode object, but must not override `added` or `detached`.

- [ ] **Step 6: Run interpreter tests and verify GREEN**

```bash
npx vitest run tests/core/tree-interpreter.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit mutation projection**

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
- Consumes: `TreeVisualModel`, per-component topology.
- Produces:

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

- [ ] **Step 1: Write strict-tree determinism and geometry tests**

Use a small literal `TreeVisualModel` fixture with root 4, left 2, right 7 and unchanged statuses. Add:

```ts
it("lays a strict binary tree deterministically", () => {
  const first = layoutTree(model);
  const second = layoutTree(structuredClone(model));
  expect(second).toEqual(first);
  expect(first[0]?.mode).toBe("tree");
});

it("places parent above children and preserves left/right direction", () => {
  const layout = layoutTree(model)[0]!;
  const byId = new Map(layout.nodes.map((node) => [node.objectId, node]));
  const root = byId.get("obj-4")!;
  const left = byId.get("obj-2")!;
  const right = byId.get("obj-7")!;

  expect(left.y).toBeGreaterThan(root.y);
  expect(right.y).toBeGreaterThan(root.y);
  expect(left.x).toBeLessThan(root.x);
  expect(right.x).toBeGreaterThan(root.x);
});

it("does not overlap nodes on the same depth", () => {
  const layout = layoutTree(model)[0]!;
  const rows = new Map<number, TreeLayoutNode[]>();
  for (const node of layout.nodes) {
    rows.set(node.y, [...(rows.get(node.y) ?? []), node]);
  }
  for (const row of rows.values()) {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index]!.x - sorted[index - 1]!.x).toBeGreaterThanOrEqual(TREE_NODE_WIDTH);
    }
  }
});
```

- [ ] **Step 2: Write fallback-layout tests**

```ts
it.each(["cycle", "shared-child"])("uses deterministic fallback for %s topology", () => {
  const layout = layoutTree(nonTreeModel)[0]!;
  expect(layout.mode).toBe("fallback");
  expect(layout.nodes.map((node) => node.objectId)).toEqual([...layout.nodes.map((node) => node.objectId)].sort());
});

it("places fallback nodes in fixed three-column row-major order", () => {
  const layout = layoutTree(fiveNodeFallbackModel)[0]!;
  const positions = layout.nodes.map(({ objectId, x, y }) => ({ objectId, x, y }));
  expect(positions[0]!.y).toBe(positions[1]!.y);
  expect(positions[1]!.y).toBe(positions[2]!.y);
  expect(positions[3]!.y).toBeGreaterThan(positions[0]!.y);
  expect(positions[0]!.x).toBeLessThan(positions[1]!.x);
  expect(positions[1]!.x).toBeLessThan(positions[2]!.x);
});

it("terminates and emits a self-cycle edge without recursive layout", () => {
  const layout = layoutTree(selfCycleModel)[0]!;
  expect(layout.mode).toBe("fallback");
  expect(layout.edges).toContainEqual(expect.objectContaining({
    fromObjectId: "obj-1",
    toObjectId: "obj-1",
    field: "left"
  }));
});
```

- [ ] **Step 3: Run layout tests and verify RED**

```bash
npx vitest run tests/sidepanel/tree-layout.test.ts
```

Expected: FAIL because `tree-layout.ts` does not exist.

- [ ] **Step 4: Implement strict-tree eligibility and deterministic component ordering**

Create helpers:

```ts
function isStrictTree(component: TreeComponent): boolean {
  return !component.cyclic &&
    component.sharedChildNodeIds.length === 0 &&
    component.entryNodeIds.length === 1;
}
```

Before using hierarchical mode, recompute internal indegree from model nodes and require every non-entry node in the component to have indegree exactly `1`; otherwise use fallback.

`layoutTree` returns main first and detached components by componentId, matching model order defensively via explicit sort.

- [ ] **Step 5: Implement hierarchical subtree-span layout**

For the strict component, recursively calculate subtree slot width with memoization over internal left/right TreeNode children. Since strict eligibility excludes cycles/shared children, recursion is finite.

Use:

```ts
const horizontalStride = TREE_NODE_WIDTH + TREE_HORIZONTAL_GAP;
const verticalStride = TREE_NODE_HEIGHT + TREE_VERTICAL_GAP;
```

Assign leaves one horizontal slot. Place an internal node centered between its existing left/right child subtree extents; when only one child exists, offset the child one stride in the correct semantic direction so `left.x < parent.x` and `right.x > parent.x` remain true. Normalize the component afterward so `minX === 0`.

Build SVG edge geometry from node centers:

```ts
x1 = parent.x + TREE_NODE_WIDTH / 2;
y1 = parent.y + TREE_NODE_HEIGHT;
x2 = child.x + TREE_NODE_WIDTH / 2;
y2 = child.y;
```

Only `targetKind === "tree_node"` produces layout edges.

- [ ] **Step 6: Implement fixed three-column fallback**

Sort component node IDs lexically and place:

```ts
const column = index % TREE_FALLBACK_COLUMNS;
const row = Math.floor(index / TREE_FALLBACK_COLUMNS);
const x = column * (TREE_NODE_WIDTH + TREE_HORIZONTAL_GAP);
const y = row * (TREE_NODE_HEIGHT + TREE_VERTICAL_GAP);
```

Build actual internal TreeNode edges by direct lookup after all nodes have coordinates; never recursively traverse fallback topology.

- [ ] **Step 7: Run layout tests and verify GREEN**

```bash
npx vitest run tests/sidepanel/tree-layout.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit layout**

```bash
git add src/sidepanel/components/tree-layout.ts tests/sidepanel/tree-layout.test.ts
git commit -m "feat: lay out tree visuals"
```

---

### Task 4: Tree Renderer, DOM Metadata, Factual Topology Notices, Styles

**Files:**
- Create: `src/sidepanel/components/TreeVisualizer.ts`
- Create: `tests/sidepanel/tree-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`
- Reference: `src/sidepanel/components/LinkedListVisualizer.ts`
- Reference: `src/sidepanel/components/value-format.ts`
- Reference: `src/sidepanel/components/tree-layout.ts`

**Interfaces:**
- Consumes: `TreeVisualModel`, `layoutTree(model)`.
- Produces:

```ts
export interface TreeVisualizerHandle {
  element: HTMLElement;
  update(model: TreeVisualModel): void;
  dispose(): void;
}

export function createTreeVisualizer(initialModel: TreeVisualModel): TreeVisualizerHandle;
```

- [ ] **Step 1: Write failing node/pointer/edge DOM tests**

Create a model fixture with root/left/right nodes, pointer `root`, one changed edge, and deterministic component. Assert:

```ts
it("renders TreeNode cards, pointer badges, and internal SVG edge metadata", () => {
  const handle = createTreeVisualizer(model);
  document.body.append(handle.element);

  expect(handle.element.dataset.visualId).toBe("tree:TreeNode");
  expect(handle.element.querySelector('[data-node-id="obj-1"]')).not.toBeNull();
  expect(handle.element.querySelector('[data-pointer-name="root"][data-pointer-status="unchanged"]')).not.toBeNull();
  expect(handle.element.querySelector(
    '[data-edge-from="obj-1"][data-edge-to="obj-2"][data-edge-field="left"]'
  )).not.toBeNull();
});

it("renders value mutation independently from topology status", () => {
  const changed = structuredClone(model);
  changed.nodes[0]!.valueStatus = "changed";
  const handle = createTreeVisualizer(changed);
  expect(handle.element.querySelector('[data-node-id="obj-1"] [data-value-status="changed"]')).not.toBeNull();
});
```

- [ ] **Step 2: Write failing external/unresolved/removed-edge and notice tests**

```ts
it("renders removed child slots and external/unresolved targets without fake TreeNode cards", () => {
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

it("shows factual cycle/shared-child/truncation notices only", () => {
  const abnormal = structuredClone(model);
  abnormal.components[0]!.cyclic = true;
  abnormal.components[0]!.sharedChildNodeIds = ["obj-2"];
  abnormal.truncated = true;
  const text = createTreeVisualizer(abnormal).element.textContent ?? "";

  expect(text).toContain("Cycle detected in TreeNode references");
  expect(text).toContain("Shared child: obj-2 has 2 incoming TreeNode references");
  expect(text).toContain("Topology truncated");
  expect(text).not.toMatch(/root cause|likely cause|bug|caused|infinite loop|LeetCode TLE/i);
});
```

For the shared-child count assertion, construct the fixture so `obj-2` actually has two internal incoming edges; renderer must compute display count from current model edges rather than hard-code `2`.

- [ ] **Step 3: Write failing component order/update/viewport tests**

```ts
it("renders main component before detached components", () => {
  const handle = createTreeVisualizer(twoComponentModel);
  const roles = [...handle.element.querySelectorAll<HTMLElement>("[data-component-role]")]
    .map((element) => element.dataset.componentRole);
  expect(roles).toEqual(["main", "detached"]);
});

it("updates in place without owning navigation state", () => {
  const handle = createTreeVisualizer(model);
  const element = handle.element;
  handle.update(updatedModel);
  expect(handle.element).toBe(element);
  expect(handle.element.querySelector('[data-node-id="obj-9"]')).not.toBeNull();
});
```

Also assert the viewport element has class `tree-visualizer__viewport`; CSS contract is verified by loading `styles.css` text or by a direct source assertion in the test:

```ts
expect(styles).toContain("max-height: 360px");
expect(styles).toContain("overflow: auto");
```

- [ ] **Step 4: Run renderer tests and verify RED**

```bash
npx vitest run tests/sidepanel/tree-visualizer.test.ts
```

Expected: FAIL because `TreeVisualizer.ts` does not exist.

- [ ] **Step 5: Implement renderer structure**

Use:

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
  // render main first, then detached component sections
  // each component: SVG internal edge layer + absolutely positioned HTML node layer
  // then append factual notices outside the viewport
  return section;
}
```

Render each node card with `data-node-id`, `data-node-status`, formatted `val`, objectId, pointer badges, and `data-value-status`.

Render internal TreeNode edges as SVG `<line>`/`<path>` elements carrying:

```text
data-edge-from
data-edge-to
data-edge-field
data-edge-status
data-edge-target-kind="tree_node"
```

For `external`/`unresolved` references and current `None` fields with `status="removed"`, render compact HTML terminal markers inside the component canvas with the same `data-edge-*` metadata; these are factual edge terminals, not fake nodes.

- [ ] **Step 6: Implement factual notices and shared-child incoming counts**

Build incoming counts directly from current model nodes whose target kind is `tree_node`. For each `sharedChildNodeId`, render exactly:

```text
Shared child: <objectId> has <N> incoming TreeNode references
```

Render cycle notice once per cyclic component. Render `Topology truncated` once per visual when `model.truncated` is true.

- [ ] **Step 7: Add bounded viewport and Tree-specific styling**

Append focused rules to `src/sidepanel/styles.css`:

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

Reuse existing CSS variables/colors; do not introduce a new design system. Add modifier classes for `is-added`, `is-changed`, `is-detached`, edge statuses, pointer badges, component headings, and factual notices.

- [ ] **Step 8: Run renderer tests and verify GREEN**

```bash
npx vitest run tests/sidepanel/tree-visualizer.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit renderer**

```bash
git add src/sidepanel/components/TreeVisualizer.ts src/sidepanel/styles.css tests/sidepanel/tree-visualizer.test.ts
git commit -m "feat: render TreeNode visuals"
```

---

### Task 5: Visual Model, Candidate Priority, and Visualizer Registry Integration

**Files:**
- Modify: `src/core/visual-candidate.ts`
- Modify: `src/core/visual-model.ts`
- Modify: `tests/core/visual-model.test.ts`
- Modify: `src/sidepanel/components/visualizer-registry.ts`
- Create: `tests/sidepanel/visualizer-registry.test.ts`

**Interfaces:**
- Extends `VisualKind` with `"tree"`.
- Extends `StructureVisualModel` with `TreeVisualModel`.
- Preserves `resolveVisualCandidates(candidates)` behavior and the existing 3-visible limit.
- Registry gains a typed `tree` factory.

- [ ] **Step 1: Write failing visual-model candidate tests**

In `tests/core/visual-model.test.ts`, add Tree fixtures using `ObjectSnapshot` and Tree refs. Add:

```ts
it("builds a Tree visual without fabricating active-line relevance", () => {
  const treeRuntime: RuntimeState = {
    ...runtime({ root: { type: "reference", objectId: "tree-1", className: "TreeNode" } }),
    objectTopology: {
      objects: new Map([["tree-1", {
        objectId: "tree-1",
        className: "TreeNode",
        attributes: { val: int(1), left: { type: "none", value: null }, right: { type: "none", value: null } }
      }]]),
      truncated: false
    }
  };

  const state = buildVisualState(treeRuntime, null, [], null, []);
  expect(state.visuals.find((visual) => visual.kind === "tree")).toMatchObject({
    kind: "tree",
    visualId: "tree:TreeNode"
  });
  expect(state.primaryVisualId).toBe("tree:TreeNode");
});
```

Add competition cases:

```ts
it("prioritizes a mutated Tree over a pointer-relevant non-mutated list", () => {
  // runtime contains nums + root TreeNode
  // current mutations contain object_attribute/reference mutation on the TreeNode
  expect(state.primaryVisualId).toBe("tree:TreeNode");
});

it("does not hard-code Tree primary when an existing visual has stronger priority", () => {
  // Tree has pointers but no mutation; dict receives mapping_entry mutation
  expect(state.primaryVisualId).toBe("dict:seen");
});

it("keeps Tree, List, Dict, and Linked List candidates under the existing top-three resolver", () => {
  expect(state.visuals).toHaveLength(3);
  expect(state.visuals.map((visual) => visual.kind)).toEqual(expect.arrayContaining(["tree"]));
});
```

The exact candidate set in the last test must be constructed so Tree is inside the top three by the existing tuple rather than assuming all four are visible.

- [ ] **Step 2: Write failing typed registry tests**

Create `tests/sidepanel/visualizer-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createVisualizer, updateVisualizer } from "../../src/sidepanel/components/visualizer-registry";
import type { TreeVisualModel } from "../../src/core/tree-interpreter";

it("creates and updates a tree visualizer through the generic registry", () => {
  const first: TreeVisualModel = treeModel("obj-1");
  const second: TreeVisualModel = treeModel("obj-2");
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

- [ ] **Step 3: Run integration tests and verify RED**

```bash
npx vitest run tests/core/visual-model.test.ts tests/sidepanel/visualizer-registry.test.ts
```

Expected: FAIL because `VisualKind`, `StructureVisualModel`, and registry do not include `tree`.

- [ ] **Step 4: Extend `VisualKind` and `StructureVisualModel` only**

Change:

```ts
export type VisualKind = "list" | "dict" | "linked_list" | "tree";
```

In `visual-model.ts` import `buildTreeVisuals, type TreeVisualModel` and change:

```ts
export type StructureVisualModel = ContainerVisualModel | LinkedListVisualModel | TreeVisualModel;
```

Do not modify resolver sorting logic.

- [ ] **Step 5: Add Tree candidate construction using the existing priority tuple**

After building `linkedListVisuals`, build:

```ts
const treeVisuals = buildTreeVisuals(runtime, mutations);
const allVisuals: StructureVisualModel[] = [
  ...containerVisuals,
  ...linkedListVisuals,
  ...treeVisuals
];
```

Add a `treeWasMutated` helper analogous to `linkedListWasMutated`, using the Tree node object IDs and pointer names. Return true only when a current mutation touches a represented Tree node/object attribute, represented active-frame pointer, or represented TreeNode visibility.

Candidate mapping for Tree is exactly:

```ts
const pointerRelevant = visual.pointers.length > 0;
const mutated = treeWasMutated(visual, activeFrameId, mutations);
return {
  visualId: visual.visualId,
  kind: visual.kind,
  priority: [false, mutated, pointerRelevant, visual.pointers.length] as const
};
```

Do not inspect source text or variable names for first-priority relevance.

- [ ] **Step 6: Register the Tree visualizer**

In `visualizer-registry.ts`:

```ts
import { createTreeVisualizer } from "./TreeVisualizer";

const registry = {
  list: ...,
  dict: ...,
  linked_list: ...,
  tree: (model: ModelOf<"tree">) =>
    withVisualId(model, createTreeVisualizer(model), "tree")
} satisfies VisualizerRegistry;
```

- [ ] **Step 7: Run integration tests and verify GREEN**

```bash
npx vitest run tests/core/visual-model.test.ts tests/sidepanel/visualizer-registry.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run existing resolver and specialized-visual regressions**

```bash
npx vitest run tests/core/visual-candidate-resolver.test.ts tests/core/linked-list-interpreter.test.ts tests/sidepanel/linked-list-visualizer.test.ts tests/sidepanel/list-visualizer.test.ts
```

Expected: PASS with no resolver policy changes.

- [ ] **Step 9: Commit integration**

```bash
git add src/core/visual-candidate.ts src/core/visual-model.ts tests/core/visual-model.test.ts src/sidepanel/components/visualizer-registry.ts tests/sidepanel/visualizer-registry.test.ts
git commit -m "feat: integrate tree visual selection"
```

---

### Task 6: End-to-End Trace Navigation Regression, Documentation, and Full Gates

**Files:**
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `README.md`
- Modify: `README.zh-TW.md`
- Reference: `src/sidepanel/components/TraceVisualizer.ts`
- Reference: `src/core/trace-interpreter.ts`

**Interfaces:**
- No new production interface.
- Confirms existing navigation paths rebuild the same Tree state through `interpretTrace → VisualState → visualizer-registry`.

- [ ] **Step 1: Add a concrete Tree trace fixture to `trace-visualizer.test.ts`**

Create a minimal `TraceSession` with two events and stable object IDs. Event 1:

```text
root -> obj-1
obj-1: val=4 left=None right=None
```

Event 2:

```text
root -> obj-1
child -> obj-2
obj-1: val=4 left=obj-2 right=None
obj-2: val=2 left=None right=None
```

Use `objects` snapshots on both events so the existing state reconstructor can materialize topology. Keep status `completed`; Tree rendering is independent from Failure-First eligibility.

- [ ] **Step 2: Write failing raw-step synchronization test**

```ts
it("keeps Tree visualization synchronized with raw step navigation", () => {
  const handle = createTraceVisualizer(treeTraceSession());
  document.body.append(handle.element);

  expect(handle.element.querySelector('[data-node-id="obj-2"]')).toBeNull();

  handle.setStep(1);

  expect(handle.element.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
  expect(handle.element.querySelector(
    '[data-edge-from="obj-1"][data-edge-to="obj-2"][data-edge-field="left"]'
  )).not.toBeNull();
  expect(handle.element.textContent).toContain("child");
});
```

If the existing test helper indexes are 0-based, keep the assertion aligned with the current `setStep(index)` contract used elsewhere in this file.

- [ ] **Step 3: Add autoplay / timeline / Failure-First non-regression assertions without changing production navigation**

Use existing navigation helpers and patterns already present in `trace-visualizer.test.ts`. For Tree-specific state, assert after a navigation action that:

```ts
expect(view.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
expect(view.querySelector('[data-edge-from="obj-1"][data-edge-to="obj-2"]')).not.toBeNull();
```

For Failure-First, use an `exception` or `timeout` Tree trace with valid behavioral evidence already supported by the fixture helpers; click the existing `Inspect` button and assert Tree state matches the destination raw index. Do not add Tree-specific navigation code.

- [ ] **Step 4: Run trace visualizer tests**

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts
```

Expected: PASS after Tasks 1–5; if RED, fix only Tree interpretation/rendering/integration defects, not navigation ownership.

- [ ] **Step 5: Update English README coverage and boundary text**

In the MVP capability list, add after linked-list visualization:

```markdown
- dedicated binary-tree visualization for standard LeetCode `TreeNode` objects, including active pointers, `left` / `right` edge mutation, detached components, and deterministic cycle/shared-child fallback presentation;
```

Replace the old boundary sentence:

```markdown
Dedicated visualizers for trees, node-edge graphs, and DP tables are outside the current scope.
```

with:

```markdown
Dedicated TreeNode visualization supports the standard LeetCode binary-tree shape only. Generic node-edge graphs, custom/N-ary tree inference, and DP tables remain outside the current scope.
```

Add project-document links:

```markdown
- [Tree Visualization Design Spec](docs/superpowers/specs/2026-09-11-tree-visualization-design.md)
- [Tree Visualization Implementation Plan](docs/superpowers/plans/2026-09-11-tree-visualization-implementation-plan.md)
```

- [ ] **Step 6: Mirror the same factual scope change in `README.zh-TW.md`**

Use Traditional Chinese wording that preserves the same boundaries:

```markdown
- 標準 LeetCode `TreeNode` 的專用二元樹視覺化，包含 active pointer、`left` / `right` 邊變更、斷開 component，以及 cycle / shared-child 的 deterministic fallback 呈現；
```

Boundary:

```markdown
專用 TreeNode 視覺化目前只支援標準 LeetCode binary-tree 結構；generic node-edge graph、自訂／N-ary tree inference 與 DP table 仍不在目前範圍內。
```

Add the same two document links with Chinese labels.

- [ ] **Step 7: Run the dedicated Tree test set**

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

- [ ] **Step 8: Run full regression gates**

```bash
npm test
npm run typecheck
npm run build
```

Expected:

```text
vitest: all test files pass
TypeScript: exits 0 with no type errors
Vite builds: side panel, content script, and page bridge all exit 0
```

Existing non-blocking dependency/Vite warnings may remain if unchanged; do not introduce new warnings attributable to Tree code.

- [ ] **Step 9: Review forbidden wording in Tree UI and docs**

Run:

```bash
grep -RniE "root cause|likely cause|this is the bug|caused.*(timeout|failure)|infinite loop|LeetCode TLE" \
  src/sidepanel/components/TreeVisualizer.ts \
  tests/sidepanel/tree-visualizer.test.ts \
  README.md README.zh-TW.md
```

Expected: no Tree-specific diagnostic claims. Existing README boundary references that explicitly say a local timeout is *not* LeetCode TLE are acceptable and must not be removed.

- [ ] **Step 10: Commit end-to-end coverage and docs**

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
[ ] Current pointers and just-removed pointers are factual and active-frame scoped.
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
[ ] README boundaries now distinguish TreeNode support from generic Graph/N-ary/DP non-goals.
[ ] npm test passes.
[ ] npm run typecheck passes.
[ ] npm run build passes.
```

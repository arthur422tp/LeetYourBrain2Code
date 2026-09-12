# Graph Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic LeetCode `Node.neighbors` graph visualization, including typed adjacency-list input, directed runtime edge semantics, reciprocal presentation, deterministic force layout, selectable nodes/connections, persistent inspection, and full trace-navigation integration.

**Architecture:** Extend the existing typed-input pipeline with `graph_node`, convert LeetCode adjacency lists into real `Node` objects before tracing, then project captured `RuntimeState` + `RuntimeMutation[]` through a new pure `graph-interpreter.ts`. Reuse only small proven topology helpers, keep Graph semantics independent, calculate geometry in a stateless deterministic `graph-layout.ts`, and render compact HTML nodes plus SVG connections using the existing visual-model/resolver/registry path.

**Tech Stack:** TypeScript 5.8, Python runner inside Pyodide 0.29, DOM/SVG APIs, Vitest 3.2, jsdom 26, Vite 6, existing runtime object topology and RuntimeMutation semantics.

**Spec:** `docs/superpowers/specs/2026-09-12-graph-visualization-design.md`

## Global Constraints

- Graph v0.1 supports only standard LeetCode `className === "Node"` with `neighbors` captured as `list` or `tuple` of `Node` references.
- `val` is display-only and may be absent.
- Add `ParameterKind = "graph_node"`; standard adjacency-list testcase conversion is part of the same milestone.
- Empty adjacency input `[]` maps to `None`.
- Every adjacency index must be an integer in `1..N`; malformed input returns `input_error / unsupported_testcase_format` and must not synthesize missing nodes.
- Directed runtime references remain directed in `GraphVisualModel`.
- Reciprocal references may be paired only in presentation; the model retains both `A → B` and `B → A`.
- Duplicate neighbor entries remain in the ordered neighbor sequence shown by the inspector but deduplicate to one topology edge per `(fromObjectId, toObjectId)`.
- Preserve all captured Graph components, including isolated nodes.
- Main component selection is exactly: higher active-frame pointer coverage → larger node count → lexicographically smaller `componentId`.
- Secondary Graph components are not called detached errors.
- `RuntimeMutation[]` remains the only mutation authority; do not diff GraphVisualModels to invent mutations.
- Neighbor reorder with the same edge set is not a topology mutation.
- Do not add a Graph-specific RuntimeMutation or trace protocol.
- Graph cycles are normal topology, not warnings.
- Layout is a pure function of current Graph model data; navigation history, previous-step coordinates, DOM state, `Math.random()` and wall-clock time cannot affect geometry.
- Force layout uses deterministic object-ID-derived initialization, fixed parameters and fixed iteration count.
- Each disconnected component is laid out independently, then component boxes are ordered deterministically with the main component first.
- Use bounded scrolling rather than semantic pruning.
- Follow the established UI language: compact structure + direct selection + persistent selection + detail inspector + factual notices.
- Both nodes and visual connections are selectable.
- UI copy must remain factual: no BFS/DFS diagnosis, correctness claims, bug/root-cause claims, shortest-path interpretation, infinite-loop claims, or automatic fix suggestions.
- Preserve existing List / Dict / Linked List / Tree behavior and all navigation paths.
- Existing regression suite must remain green.

---

## File Structure

- Modify `src/shared/execution-types.ts` — add `graph_node` parameter kind.
- Modify `src/execution/entrypoint-resolver.ts` — recognize `Node` and quoted forward-reference annotations.
- Modify `src/worker/python/runner.py` — adjacency-list validation/building and fallback `Node`.
- Modify `tests/execution/entrypoint-resolver.test.ts` — Graph annotation classification.
- Modify `tests/execution/pyodide-runtime.test.ts` — actual adjacency-list execution and malformed-input coverage.
- Create `src/core/topology/components.ts` — deterministic weak component partitioning.
- Create `src/core/topology/pointers.ts` — active-frame object pointers and pointer mutation status.
- Create `src/core/topology/ranking.ts` — deterministic pointer-coverage component ranking.
- Create `tests/core/topology-helpers.test.ts` — shared helper contracts.
- Modify `src/core/linked-list-interpreter.ts` — consume only the shared mechanics without changing semantics.
- Modify `src/core/tree-interpreter.ts` — consume only the shared mechanics without changing semantics.
- Create `src/core/graph-interpreter.ts` — strict detection, ordered neighbors, directed edges, components, pointers, mutation projection.
- Create `tests/core/graph-interpreter.test.ts` — pure Graph interpretation tests.
- Create `src/sidepanel/components/graph-layout.ts` — stateless deterministic force layout and deterministic fallback.
- Create `tests/sidepanel/graph-layout.test.ts` — geometry/determinism tests.
- Modify `src/sidepanel/components/SelectionInspector.ts` — generic inspectable target + keyboard support + deterministic preferred fallback.
- Modify `src/sidepanel/components/TreeVisualizer.ts` — use the shared selection lifecycle without changing Tree rendering semantics.
- Modify `tests/sidepanel/selection-inspector.test.ts` — generic HTMLElement/SVG selection lifecycle.
- Modify `tests/sidepanel/tree-visualizer.test.ts` — Tree regression around shared inspector migration.
- Create `src/sidepanel/components/GraphVisualizer.ts` — compact Graph DOM/SVG renderer and node/connection inspector.
- Create `tests/sidepanel/graph-visualizer.test.ts` — Graph DOM and interaction tests.
- Modify `src/core/visual-candidate.ts` — add `graph` to `VisualKind`.
- Modify `src/core/visual-model.ts` — build Graph visual and Graph candidate priority.
- Modify `tests/core/visual-model.test.ts` — Graph coexistence and priority regressions.
- Modify `src/sidepanel/components/visualizer-registry.ts` — register Graph visualizer.
- Modify `tests/sidepanel/visualizer-registry.test.ts` — Graph create/update/mismatched-kind contract.
- Modify `src/sidepanel/styles.css` — compact Graph nodes, selectable connection hit targets, statuses, inspector and viewport.
- Modify `tests/sidepanel/trace-visualizer.test.ts` — Graph synchronization for direct step / autoplay / Behavioral Timeline / Failure-First / folded navigation.
- Modify `README.md` and `README.zh-TW.md` — document Graph v0.1 coverage and limitations.

---

### Task 1: Typed Graph Input — Entrypoint Detection and Adjacency Builder

**Files:**
- Modify: `src/shared/execution-types.ts`
- Modify: `src/execution/entrypoint-resolver.ts`
- Modify: `src/worker/python/runner.py`
- Modify: `tests/execution/entrypoint-resolver.test.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`

**Interfaces:**
- Consumes: user source code, raw LeetCode testcase text, existing `EntryPoint` request contract.
- Produces: `ParameterKind = "graph_node"`; Python runner passes `Node | None` into the selected solution method.

- [ ] **Step 1: Write failing annotation-classification tests**

Add these cases to `tests/execution/entrypoint-resolver.test.ts`:

```ts
it.each([
  "Node",
  "Optional[Node]",
  "Optional['Node']",
  "'Node'",
  "Node | None",
  "None | Node"
])("classifies %s as graph_node", (annotation) => {
  const result = resolveEntrypoint(`class Solution:\n    def cloneGraph(self, node: ${annotation}):\n        return node\n`);
  expect(result).toEqual({
    ok: true,
    entrypoint: {
      className: "Solution",
      methodName: "cloneGraph",
      parameterCount: 1,
      parameterKinds: ["graph_node"]
    }
  });
});
```

Also add a regression where a public typed `cloneGraph(node: Optional['Node'])` beats a same-arity private/helper method exactly as Tree input support does.

- [ ] **Step 2: Run resolver test and verify RED**

```bash
npx vitest run tests/execution/entrypoint-resolver.test.ts
```

Expected: FAIL because `ParameterKind` does not contain `graph_node` and `parameterKind()` returns `value` for `Node` annotations.

- [ ] **Step 3: Implement `graph_node` annotation normalization**

In `src/shared/execution-types.ts`:

```ts
export type ParameterKind = "value" | "linked_list" | "binary_tree" | "graph_node";
```

In `src/execution/entrypoint-resolver.ts`, normalize outer quotes before matching:

```ts
function stripAnnotationQuotes(annotation: string): string {
  const trimmed = annotation.trim();
  return (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ? trimmed.slice(1, -1)
    : trimmed;
}

function parameterKind(annotation: string | null): ParameterKind {
  if (annotation === null) return "value";
  const normalized = stripAnnotationQuotes(annotation).replace(/\s+/g, "");

  if (/^(?:ListNode|Optional\[ListNode\]|ListNode\|None|None\|ListNode)$/.test(normalized)) {
    return "linked_list";
  }
  if (/^(?:TreeNode|Optional\[TreeNode\]|TreeNode\|None|None\|TreeNode)$/.test(normalized)) {
    return "binary_tree";
  }
  if (/^(?:Node|Optional\[(?:'Node'|"Node"|Node)\]|Node\|None|None\|Node)$/.test(normalized)) {
    return "graph_node";
  }
  return "value";
}
```

The exact parser may use a helper instead of this regex, but the accepted forms and output must match the tests above.

- [ ] **Step 4: Run resolver test and verify GREEN**

```bash
npx vitest run tests/execution/entrypoint-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing runtime Graph input tests**

Add cases to `tests/execution/pyodide-runtime.test.ts` using the existing execution helper in that file. Use this user program:

```python
from typing import Optional

class Node:
    def __init__(self, val=0, neighbors=None):
        self.val = val
        self.neighbors = neighbors if neighbors is not None else []

class Solution:
    def cloneGraph(self, node: Optional['Node']) -> Optional['Node']:
        if node is None:
            return None
        print(node.val, [neighbor.val for neighbor in node.neighbors])
        return node
```

Assertions:

```ts
expect(result.status).toBe("completed");
expect(result.stdout).toContain("1 [2, 4]");
```

for raw testcase:

```text
[[2,4],[1,3],[2,4],[1,3]]
```

Add empty input:

```text
[]
```

and assert `None` reaches the method without input error.

Add malformed cases:

```text
[[2],[3]]
[["2"],[1]]
```

and assert:

```ts
expect(result.status).toBe("input_error");
expect(result.terminationReason).toBe("unsupported_testcase_format");
```

- [ ] **Step 6: Run runtime tests and verify RED**

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts
```

Expected: Graph cases FAIL because runner treats adjacency input as a normal nested list.

- [ ] **Step 7: Implement fallback Node and `_build_graph`**

In `src/worker/python/runner.py` add:

```python
class _FallbackGraphNode:
    def __init__(self, val=0, neighbors=None):
        self.val = val
        self.neighbors = neighbors if neighbors is not None else []


def _build_graph(adjacency, node_class):
    if adjacency is None:
        return None
    if not isinstance(adjacency, list):
        raise UnsupportedTestcaseFormat("graph parameters require an adjacency-list literal")
    if len(adjacency) == 0:
        return None
    if any(not isinstance(row, list) for row in adjacency):
        raise UnsupportedTestcaseFormat("graph adjacency entries must be lists")

    nodes = []
    try:
        for index in range(len(adjacency)):
            nodes.append(node_class(index + 1))
    except Exception as error:
        raise UnsupportedTestcaseFormat("graph values could not construct a Node") from error

    for source_index, row in enumerate(adjacency):
        neighbors = []
        for neighbor in row:
            if isinstance(neighbor, bool) or not isinstance(neighbor, int):
                raise UnsupportedTestcaseFormat("graph neighbor indexes must be integers")
            if neighbor < 1 or neighbor > len(nodes):
                raise UnsupportedTestcaseFormat("graph neighbor index is out of range")
            neighbors.append(nodes[neighbor - 1])
        nodes[source_index].neighbors = neighbors

    return nodes[0]
```

In `run_request()`, after executing user code:

```python
graph_node_class = namespace.get("Node", _FallbackGraphNode)
```

and in the conversion loop:

```python
if parameter_kind == "graph_node":
    converted_arguments.append(_build_graph(argument, graph_node_class))
    continue
```

Do not coerce invalid adjacency data.

- [ ] **Step 8: Run focused execution tests and commit**

```bash
npx vitest run tests/execution/entrypoint-resolver.test.ts tests/execution/pyodide-runtime.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add src/shared/execution-types.ts src/execution/entrypoint-resolver.ts src/worker/python/runner.py tests/execution/entrypoint-resolver.test.ts tests/execution/pyodide-runtime.test.ts
git commit -m "feat: support LeetCode graph inputs"
```

---

### Task 2: Extract Shared Topology Mechanics Without Changing Existing Visualizers

**Files:**
- Create: `src/core/topology/components.ts`
- Create: `src/core/topology/pointers.ts`
- Create: `src/core/topology/ranking.ts`
- Create: `tests/core/topology-helpers.test.ts`
- Modify: `src/core/linked-list-interpreter.ts`
- Modify: `src/core/tree-interpreter.ts`
- Test: `tests/core/linked-list-interpreter.test.ts`
- Test: `tests/core/tree-interpreter.test.ts`

**Interfaces:**

```ts
export interface TopologyEdge {
  fromObjectId: ObjectId;
  toObjectId: ObjectId;
}

export interface TopologyComponentBase {
  componentId: string;
  nodeIds: ObjectId[];
}

export function connectedComponents(
  nodeIds: readonly ObjectId[],
  edges: readonly TopologyEdge[],
  componentPrefix: string
): TopologyComponentBase[];
```

```ts
export interface ObjectPointerVisual {
  variableName: string;
  objectId: ObjectId | null;
  status: "unchanged" | "moved" | "added" | "removed";
}

export function buildActiveObjectPointers(
  runtime: RuntimeState,
  candidateObjectIds: ReadonlySet<ObjectId>,
  mutations: readonly RuntimeMutation[]
): ObjectPointerVisual[];
```

```ts
export interface RankedTopologyComponent extends TopologyComponentBase {
  pointerCount: number;
  role: "main" | "secondary";
}

export function rankComponentsByPointerCoverage(
  components: readonly TopologyComponentBase[],
  pointers: readonly ObjectPointerVisual[]
): RankedTopologyComponent[];
```

- [ ] **Step 1: Write failing shared-helper tests**

Create `tests/core/topology-helpers.test.ts` with concrete cases:

```ts
it("partitions weakly connected components deterministically", () => {
  expect(connectedComponents(
    ["obj-4", "obj-1", "obj-3", "obj-2"],
    [
      { fromObjectId: "obj-2", toObjectId: "obj-1" },
      { fromObjectId: "obj-4", toObjectId: "obj-3" }
    ],
    "graph-component"
  )).toEqual([
    { componentId: "graph-component:obj-1", nodeIds: ["obj-1", "obj-2"] },
    { componentId: "graph-component:obj-3", nodeIds: ["obj-3", "obj-4"] }
  ]);
});
```

Add pointer tests covering current local references plus an `unbound` mutation that yields `{ objectId: null, status: "removed" }`.

Add ranking tests covering pointer-count, node-count, then lexical tie-break.

- [ ] **Step 2: Run helper tests and verify RED**

```bash
npx vitest run tests/core/topology-helpers.test.ts
```

Expected: FAIL because the shared modules do not exist.

- [ ] **Step 3: Implement deterministic weak components**

In `components.ts`, build an undirected adjacency map from the provided directed edges, BFS from lexically sorted node IDs, sort each component's node IDs, and use:

```ts
componentId: `${componentPrefix}:${nodeIds[0]}`
```

Return components sorted by `componentId`.

- [ ] **Step 4: Implement active-frame pointer projection**

In `pointers.ts`, reuse existing local `ReferenceMutation` semantics exactly:

```ts
bound      -> "added"
unbound    -> "removed"
redirected -> "moved"
```

Current active-frame local references into `candidateObjectIds` become pointers. Also materialize an unbound pointer with `objectId: null` when the previous target was a candidate and no current local pointer of the same name exists.

- [ ] **Step 5: Implement deterministic ranking**

In `ranking.ts`, count pointers by component membership and sort by:

```ts
right.pointerCount - left.pointerCount ||
right.nodeIds.length - left.nodeIds.length ||
left.componentId.localeCompare(right.componentId)
```

Return exactly one `role: "main"` when at least one component exists; the rest are `secondary`.

- [ ] **Step 6: Migrate Linked List and Tree to shared mechanics**

Replace only duplicated mechanics:

```text
component partition
active-frame pointer collection
pointer mutation status
component pointer-count ranking where equivalent
```

Preserve domain-only semantics in each interpreter:

```text
Linked List: next, entry nodes, cycles, detached evidence
Tree: left/right, indegree, entry nodes, cycles, shared child, direct detached evidence
```

For Tree, map helper `secondary` back to the existing public `role: "detached"`; do not change `TreeVisualModel`.

- [ ] **Step 7: Run helper + existing structure interpreter regressions**

```bash
npx vitest run tests/core/topology-helpers.test.ts tests/core/linked-list-interpreter.test.ts tests/core/tree-interpreter.test.ts
npm run typecheck
```

Expected: PASS with no public Linked List/Tree model changes.

- [ ] **Step 8: Commit**

```bash
git add src/core/topology src/core/linked-list-interpreter.ts src/core/tree-interpreter.ts tests/core/topology-helpers.test.ts
git commit -m "refactor: share topology component and pointer mechanics"
```

---

### Task 3: Graph Interpreter — Detection, Directed Edges, Components, Pointers, Mutation Projection

**Files:**
- Create: `src/core/graph-interpreter.ts`
- Create: `tests/core/graph-interpreter.test.ts`
- Reference: `src/core/topology/*`
- Reference: `src/core/runtime-mutation.ts`
- Reference: `src/shared/trace-types.ts`

**Interfaces:**

Implementation adds an ordered-neighbor field because the approved spec requires the inspector to preserve neighbor sequence and duplicates even though topology edges are deduplicated.

```ts
export type GraphTargetKind = "graph_node" | "external" | "unresolved";

export interface GraphNeighborVisual {
  objectId: ObjectId;
  targetKind: GraphTargetKind;
}

export interface GraphNodeVisual {
  objectId: ObjectId;
  className: "Node";
  label: ValueSnapshot | null;
  neighbors: GraphNeighborVisual[]; // ordered, duplicates preserved
  status: "unchanged" | "added" | "changed";
}

export interface GraphEdgeVisual {
  fromObjectId: ObjectId;
  toObjectId: ObjectId;
  targetKind: GraphTargetKind;
  status: "unchanged" | "added" | "removed";
}

export type GraphPointerVisual = ObjectPointerVisual;

export interface GraphComponent {
  componentId: string;
  nodeIds: ObjectId[];
  pointerCount: number;
  role: "main" | "secondary";
}

export interface GraphVisualModel {
  kind: "graph";
  visualId: "graph:Node";
  nodes: GraphNodeVisual[];
  edges: GraphEdgeVisual[];
  components: GraphComponent[];
  pointers: GraphPointerVisual[];
  truncated: boolean;
}

export function buildGraphVisuals(
  runtime: RuntimeState,
  mutations: RuntimeMutation[]
): GraphVisualModel[];
```

- [ ] **Step 1: Write failing detection/topology tests**

Create helpers in `tests/core/graph-interpreter.test.ts`:

```ts
const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const graphRef = (objectId: string): ValueSnapshot => ({ type: "reference", objectId, className: "Node" });
const neighborList = (...objectIds: string[]): ValueSnapshot => ({
  type: "list",
  length: objectIds.length,
  items: objectIds.map(graphRef),
  truncated: false
});

function graphNode(objectId: string, value: number, neighbors: string[]): ObjectSnapshot {
  return {
    objectId,
    className: "Node",
    attributes: { val: int(value), neighbors: neighborList(...neighbors) }
  };
}
```

Add cases asserting:

```ts
expect(buildGraphVisuals(runtimeWithObjects([
  graphNode("obj-1", 1, ["obj-2", "obj-2"]),
  graphNode("obj-2", 2, ["obj-1"])
]), [])[0]).toMatchObject({
  visualId: "graph:Node",
  nodes: [
    expect.objectContaining({
      objectId: "obj-1",
      neighbors: [
        { objectId: "obj-2", targetKind: "graph_node" },
        { objectId: "obj-2", targetKind: "graph_node" }
      ]
    }),
    expect.objectContaining({ objectId: "obj-2" })
  ],
  edges: [
    { fromObjectId: "obj-1", toObjectId: "obj-2", targetKind: "graph_node", status: "unchanged" },
    { fromObjectId: "obj-2", toObjectId: "obj-1", targetKind: "graph_node", status: "unchanged" }
  ]
});
```

Also assert rejection of:

```text
className !== "Node"
neighbors missing
neighbors contains primitive item
```

and acceptance of `neighbors=[]` isolated Node.

- [ ] **Step 2: Add component/pointer/truncation tests**

Test two components where the smaller component has more active-frame pointer aliases and therefore becomes main. Test pointer tie → larger component → lexical component ID. Assert `runtime.objectTopology.truncated` maps directly to `model.truncated`.

- [ ] **Step 3: Add external/unresolved target tests**

Construct a `Node` whose `neighbors` reference snapshot names `className: "Node"` but the captured target object either:

```text
exists but fails Graph candidate contract → external
is missing from objectTopology           → unresolved
```

Assert no fake Graph node is created.

- [ ] **Step 4: Add mutation projection tests**

For source `obj-1`, create:

```ts
const before = neighborList("obj-2", "obj-3");
const after = neighborList("obj-3", "obj-4");
```

and mutation:

```ts
{
  kind: "object_attribute",
  origin: "transition",
  objectId: "obj-1",
  attribute: "neighbors",
  action: "changed",
  before,
  after
}
```

Assert:

```text
obj-1 → obj-2 removed
obj-1 → obj-3 unchanged
obj-1 → obj-4 added
```

Then test reorder only:

```text
[obj-2, obj-3] → [obj-3, obj-2]
```

and assert both topology edges remain `unchanged`.

- [ ] **Step 5: Run interpreter tests and verify RED**

```bash
npx vitest run tests/core/graph-interpreter.test.ts
```

Expected: FAIL because `graph-interpreter.ts` does not exist.

- [ ] **Step 6: Implement strict detection and ordered neighbor extraction**

Detection rule:

```ts
function isGraphNodeCandidate(object: ObjectSnapshot): boolean {
  const neighbors = object.attributes.neighbors;
  return object.className === "Node" &&
    (neighbors?.type === "list" || neighbors?.type === "tuple") &&
    neighbors.items.every((item) => item.type === "reference" && item.className === "Node");
}
```

Keep `neighbors.items` in sequence order for `GraphNodeVisual.neighbors`.

Build current topology edges by deduplicating `(source,target)` keys:

```ts
const edgeKey = (fromObjectId: ObjectId, toObjectId: ObjectId) =>
  `${fromObjectId}\u0000${toObjectId}`;
```

Use lexical node and edge ordering in the final model.

- [ ] **Step 7: Implement edge mutation projection from `ObjectAttributeMutation`**

For each `neighbors` mutation on a Graph candidate:

```ts
const beforeSet = referenceSet(mutation.before);
const afterSet = referenceSet(mutation.after);
```

Project:

```ts
before only -> removed
after only  -> added
both        -> unchanged
```

Merge removed evidence with current topology edges, without creating a target node when the removed target is absent from current topology.

Node status precedence:

```text
appeared → added
represented object attribute/reference mutation → changed
otherwise → unchanged
```

- [ ] **Step 8: Build components and pointers using Task 2 helpers**

Only internal `targetKind === "graph_node"` edges participate in component connectivity. Map shared helper `secondary` directly to Graph's public `secondary` role.

- [ ] **Step 9: Run focused tests and commit**

```bash
npx vitest run tests/core/graph-interpreter.test.ts tests/core/topology-helpers.test.ts tests/core/tree-interpreter.test.ts tests/core/linked-list-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add src/core/graph-interpreter.ts tests/core/graph-interpreter.test.ts
git commit -m "feat: interpret captured graph topology"
```

---

### Task 4: Deterministic Force-Directed Graph Layout

**Files:**
- Create: `src/sidepanel/components/graph-layout.ts`
- Create: `tests/sidepanel/graph-layout.test.ts`

**Interfaces:**

```ts
export interface GraphLayoutNode {
  objectId: ObjectId;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphLayoutConnection {
  key: string;
  fromObjectId: ObjectId;
  toObjectId: ObjectId;
  reciprocal: boolean;
  reverseFromObjectId?: ObjectId;
  reverseToObjectId?: ObjectId;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GraphComponentLayout {
  componentId: string;
  mode: "force" | "fallback";
  width: number;
  height: number;
  nodes: GraphLayoutNode[];
  connections: GraphLayoutConnection[];
}

export function layoutGraph(model: GraphVisualModel): GraphComponentLayout[];
```

- [ ] **Step 1: Write failing determinism tests**

Create a four-node cycle model and assert:

```ts
expect(layoutGraph(model)).toEqual(layoutGraph(structuredClone(model)));
```

Reverse `nodes`, `edges` and `components` arrays independently and assert identical output.

Assert all coordinates are finite:

```ts
for (const component of layoutGraph(model)) {
  for (const node of component.nodes) {
    expect(Number.isFinite(node.x)).toBe(true);
    expect(Number.isFinite(node.y)).toBe(true);
  }
}
```

- [ ] **Step 2: Write component-isolation and reciprocal-pair tests**

Create two disconnected components and verify changing only component B does not change component A's internal coordinates before component-box translation.

Create `A → B` + `B → A` and assert `layout.connections` contains one `reciprocal: true` connection. Create only `A → B` and assert `reciprocal: false`.

- [ ] **Step 3: Run layout tests and verify RED**

```bash
npx vitest run tests/sidepanel/graph-layout.test.ts
```

Expected: FAIL because `graph-layout.ts` does not exist.

- [ ] **Step 4: Implement deterministic seed coordinates**

Use a stable 32-bit hash with no randomness:

```ts
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededPoint(objectId: string): { x: number; y: number } {
  const xHash = fnv1a(`x:${objectId}`);
  const yHash = fnv1a(`y:${objectId}`);
  return {
    x: 40 + (xHash % 200),
    y: 40 + (yHash % 180)
  };
}
```

- [ ] **Step 5: Implement fixed force simulation**

Define constants in the module, for example:

```ts
export const GRAPH_NODE_SIZE = 44;
export const GRAPH_LAYOUT_ITERATIONS = 160;
const IDEAL_EDGE_LENGTH = 92;
const REPULSION = 3200;
const SPRING = 0.025;
const DAMPING = 0.82;
const STEP = 0.12;
const PADDING = 28;
```

For every iteration:

1. Iterate node pairs in lexical ID order and apply symmetric inverse-square repulsion with a deterministic epsilon for zero distance.
2. Iterate deduplicated internal edges in lexical `(from,to)` order and apply spring force toward `IDEAL_EDGE_LENGTH`.
3. Apply velocity damping and position update.
4. Do not read previous rendered positions.

Normalize final coordinates so the minimum x/y equals component padding.

- [ ] **Step 6: Add deterministic collision separation and fallback**

After simulation, perform lexical pair separation for centers closer than `GRAPH_NODE_SIZE + 10`, moving the lexically later node along a deterministic axis derived from `fnv1a(id)`. Cap this pass to a fixed count.

If any coordinate becomes non-finite, use deterministic circular fallback:

```ts
const angle = (2 * Math.PI * index) / Math.max(nodeIds.length, 1);
```

with lexically sorted IDs.

- [ ] **Step 7: Build presentation connection pairing**

The layout may pair reciprocal model edges for geometry only. Canonical pair key:

```ts
const pair = [fromObjectId, toObjectId].sort();
const connectionKey = `${pair[0]}↔${pair[1]}`;
```

A one-way connection key remains `${fromObjectId}→${toObjectId}`.

Removed-only mutation edges may be included as one-way presentation evidence but must not create layout nodes.

- [ ] **Step 8: Run layout tests and commit**

```bash
npx vitest run tests/sidepanel/graph-layout.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add src/sidepanel/components/graph-layout.ts tests/sidepanel/graph-layout.test.ts
git commit -m "feat: add deterministic graph layout"
```

---

### Task 5: Shared Selection Lifecycle for Nodes and SVG Connections

**Files:**
- Modify: `src/sidepanel/components/SelectionInspector.ts`
- Modify: `tests/sidepanel/selection-inspector.test.ts`
- Modify: `src/sidepanel/components/TreeVisualizer.ts`
- Modify: `tests/sidepanel/tree-visualizer.test.ts`

**Interfaces:**

```ts
export type InspectableElement = HTMLElement | SVGElement;

export function inspectionTarget<T extends InspectableElement>(
  element: T,
  key: string,
  label: string
): T;

export function createSelectionInspector(
  section: HTMLElement,
  getDetails: (key: string) => InspectionDetails | null,
  options?: {
    preferredFallbackKey?: () => string | undefined;
  }
): {
  refresh(): void;
  select(key: string | undefined): void;
  selectedKey(): string | undefined;
  dispose(): void;
};
```

`inspectionButton()` remains supported and can delegate to `inspectionTarget()`.

- [ ] **Step 1: Write failing generic-target tests**

Add to `tests/sidepanel/selection-inspector.test.ts`:

```ts
it("selects an SVG inspect target with keyboard activation", () => {
  const section = document.createElement("section");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = inspectionTarget(
    document.createElementNS("http://www.w3.org/2000/svg", "path"),
    "edge:a→b",
    "Inspect connection a to b"
  );
  svg.append(path);
  section.append(svg);
  const inspector = createSelectionInspector(section, (key) => ({
    title: key,
    fields: [["kind", "connection"]]
  }));

  path.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(path.getAttribute("aria-pressed")).toBe("true");
  expect(inspector.selectedKey()).toBe("edge:a→b");
  inspector.dispose();
});
```

Add preferred fallback test with DOM order intentionally different from desired main-node key.

- [ ] **Step 2: Run selection tests and verify RED**

```bash
npx vitest run tests/sidepanel/selection-inspector.test.ts
```

Expected: FAIL because current inspector only queries `button[data-inspect-key]`, has no keyboard handler and no preferred fallback API.

- [ ] **Step 3: Generalize selection targets**

Implement:

```ts
export function inspectionTarget<T extends InspectableElement>(
  element: T,
  key: string,
  label: string
): T {
  element.dataset.inspectKey = key;
  element.setAttribute("role", element instanceof HTMLButtonElement ? "button" : "button");
  element.setAttribute("aria-label", label);
  element.setAttribute("aria-pressed", "false");
  if (!(element instanceof HTMLButtonElement)) {
    element.setAttribute("tabindex", "0");
  }
  return element;
}
```

Query `[data-inspect-key]` rather than buttons. Add delegated `keydown` handling for `Enter` and `Space` that selects the closest inspect target and calls `preventDefault()` for Space.

When the current selection disappears, choose:

```text
options.preferredFallbackKey() if present and currently rendered
otherwise first rendered inspect target
```

- [ ] **Step 4: Migrate Tree's local selection bookkeeping**

Replace Tree's custom `selectNode` lifecycle with `createSelectionInspector()` using keys:

```text
node:<objectId>
```

and preferred fallback:

```ts
() => {
  const main = currentModel.components.find((component) => component.role === "main");
  return main?.entryNodeIds[0] ? `node:${main.entryNodeIds[0]}` :
    currentModel.nodes[0] ? `node:${currentModel.nodes[0].objectId}` : undefined;
}
```

Keep Tree's current inspector fields/copy and preserve viewport scroll behavior.

- [ ] **Step 5: Run shared-inspector + Tree regressions and commit**

```bash
npx vitest run tests/sidepanel/selection-inspector.test.ts tests/sidepanel/tree-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add src/sidepanel/components/SelectionInspector.ts src/sidepanel/components/TreeVisualizer.ts tests/sidepanel/selection-inspector.test.ts tests/sidepanel/tree-visualizer.test.ts
git commit -m "refactor: share visual selection lifecycle"
```

---

### Task 6: Graph Visualizer — Compact Nodes, Directed/Reciprocal Connections, Inspector

**Files:**
- Create: `src/sidepanel/components/GraphVisualizer.ts`
- Create: `tests/sidepanel/graph-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`
- Reference: `src/sidepanel/components/graph-layout.ts`
- Reference: `src/sidepanel/components/pointer-label.ts`
- Reference: `src/sidepanel/components/SelectionInspector.ts`

**Interfaces:**

```ts
export interface GraphVisualizerHandle {
  element: HTMLElement;
  update(model: GraphVisualModel): void;
  dispose(): void;
}

export function createGraphVisualizer(initialModel: GraphVisualModel): GraphVisualizerHandle;
```

Selection keys:

```text
node:<objectId>
connection:<canonical-presentation-connection-key>
```

- [ ] **Step 1: Write failing compact-render tests**

Create `tests/sidepanel/graph-visualizer.test.ts` and assert a four-node model renders:

```ts
const nodes = handle.element.querySelectorAll(".graph-visualizer__node-button");
expect(nodes).toHaveLength(4);
expect(nodes[0]?.textContent).toBe("1");
expect(handle.element.textContent).not.toContain("obj-1obj-2obj-3obj-4");
```

Assert pointer badges are visible above the target node and use the existing pointer-label wrapping helper.

- [ ] **Step 2: Write failing connection rendering tests**

For only `A → B`, assert one SVG connection with:

```text
data-reciprocal="false"
data-edge-forward="A→B"
```

and a directional marker/arrowhead.

For both `A → B` and `B → A`, assert one visual connection with:

```text
data-reciprocal="true"
data-edge-forward="A→B"
data-edge-reverse="B→A"
```

No second overlapping SVG connection should be rendered.

- [ ] **Step 3: Write failing node inspector tests**

Click `node:obj-1` and assert inspector contains:

```text
value
object ID
status
pointers
outgoing references
neighbors
0 → obj-2
1 → obj-2
```

The duplicate neighbor entries must remain visible.

- [ ] **Step 4: Write failing connection inspector tests**

For reciprocal connection with reverse edge `added`, click the connection and assert inspector contains both:

```text
obj-1 → obj-2 unchanged
obj-2 → obj-1 added
presentation reciprocal
```

For one-way connection, assert only one runtime direction appears.

- [ ] **Step 5: Write failing update-state tests**

Select a node, update the model while that object remains, and assert selection persists. Select a connection, remove it, update, and assert fallback selection becomes the main component's preferred node. Set non-zero `scrollLeft`/`scrollTop`, update the model, and assert both values are restored.

- [ ] **Step 6: Implement renderer skeleton and compact nodes**

Build:

```text
<section class="graph-visualizer">
  <h2>Graph</h2>
  <div class="graph-visualizer__viewport">
    <section class="graph-visualizer__component is-main|is-secondary">
      <div class="graph-visualizer__canvas">
        <svg class="graph-visualizer__connections">...</svg>
        <div class="graph-visualizer__nodes">...</div>
      </div>
    </section>
  </div>
  inspector
  factual notices
</section>
```

Node buttons show only `formatValue(node.label)` plus pointer badges around the node container. Store identity/status in data attributes rather than inline text.

- [ ] **Step 7: Implement selectable SVG connections**

Render a visible path plus a thicker transparent hit path for each `GraphLayoutConnection`. Apply `inspectionTarget()` to the hit path. Use arrow markers for one-way connections and a neutral reciprocal line treatment for paired references. Runtime direction detail belongs in inspector metadata, not dense edge labels.

- [ ] **Step 8: Implement inspector detail mapping**

Node details derive from `GraphNodeVisual.neighbors`, current pointers and node status.

Connection details look up all model edges represented by the selected layout connection and produce deterministic rows sorted by `fromObjectId`, then `toObjectId`.

Do not use `degree`; label count as `outgoing references`.

- [ ] **Step 9: Implement viewport/selection preservation and notices**

On update:

```ts
const previousScrollLeft = viewport.scrollLeft;
const previousScrollTop = viewport.scrollTop;
const previousSelection = inspector.selectedKey();
```

rerender the diagram, restore scroll, call `inspector.select(previousSelection)` when valid, then `refresh()`.

Notices may include only factual text such as:

```text
Topology truncated
Reference target not present in captured topology
Secondary graph component present
```

Do not render cycle warnings.

- [ ] **Step 10: Add Graph CSS and run tests**

In `src/sidepanel/styles.css` add bounded viewport styles, 44px compact circular nodes, mutation-state classes, selected/focus-visible treatment, SVG hit-target cursor/focus handling, main/secondary component spacing and inspector integration. Use the existing status palette conventions rather than introducing unrelated UI language.

```bash
npx vitest run tests/sidepanel/graph-visualizer.test.ts tests/sidepanel/selection-inspector.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/sidepanel/components/GraphVisualizer.ts src/sidepanel/styles.css tests/sidepanel/graph-visualizer.test.ts
git commit -m "feat: render interactive graph visualization"
```

---

### Task 7: Visual Model, Candidate Resolver and Registry Integration

**Files:**
- Modify: `src/core/visual-candidate.ts`
- Modify: `src/core/visual-model.ts`
- Modify: `tests/core/visual-model.test.ts`
- Modify: `src/sidepanel/components/visualizer-registry.ts`
- Modify: `tests/sidepanel/visualizer-registry.test.ts`

**Interfaces:**
- `VisualKind` gains `"graph"`.
- `StructureVisualModel` gains `GraphVisualModel`.
- `buildVisualState()` calls `buildGraphVisuals(runtime, mutations)`.
- Graph candidate priority uses the same specialized-structure tuple shape as Tree/Linked List:

```ts
[false, mutated, pointerRelevant, visual.pointers.length]
```

- [ ] **Step 1: Write failing visual-model tests**

Add a `graphRuntime()` fixture to `tests/core/visual-model.test.ts` and assert:

```ts
const state = buildVisualState(graphRuntime(), null, [], null, []);
expect(state.visuals.find((visual) => visual.kind === "graph")).toMatchObject({
  kind: "graph",
  visualId: "graph:Node"
});
expect(state.primaryVisualId).toBe("graph:Node");
```

Add coexistence test with a pointer-relevant list plus a mutated Graph and assert the mutated Graph wins according to the existing priority tuple.

Add regression proving Graph is not hard-coded primary when a higher-priority existing candidate exists.

- [ ] **Step 2: Run visual-model tests and verify RED**

```bash
npx vitest run tests/core/visual-model.test.ts
```

Expected: FAIL because `graph` is not a VisualKind/StructureVisualModel member.

- [ ] **Step 3: Integrate Graph into model and candidate priority**

In `src/core/visual-candidate.ts`:

```ts
export type VisualKind = "list" | "dict" | "linked_list" | "tree" | "graph";
```

In `visual-model.ts` import `buildGraphVisuals` / `GraphVisualModel`, extend the union and append graph visuals to `allVisuals`.

Add a Graph mutation relevance helper equivalent in authority to Tree/Linked List: mutations count when they touch Graph pointer names or Graph object IDs. The `neighbors` attribute mutation naturally qualifies through `object_attribute`.

- [ ] **Step 4: Write failing registry tests**

Add Graph create/update cases to `tests/sidepanel/visualizer-registry.test.ts`:

```ts
const handle = createVisualizer(graphModel);
expect(handle.kind).toBe("graph");
expect(handle.element.dataset.visualId).toBe("graph:Node");
updateVisualizer(handle, updatedGraphModel);
expect(handle.element.dataset.visualId).toBe("graph:Node");
```

Also assert updating Graph handle with Tree model throws the existing kind-mismatch error.

- [ ] **Step 5: Register Graph visualizer**

In `visualizer-registry.ts`:

```ts
import { createGraphVisualizer } from "./GraphVisualizer";
```

and:

```ts
graph: (model: ModelOf<"graph">) =>
  withVisualId(model, createGraphVisualizer(model), "graph")
```

- [ ] **Step 6: Run integration tests and commit**

```bash
npx vitest run tests/core/visual-model.test.ts tests/core/visual-candidate-resolver.test.ts tests/sidepanel/visualizer-registry.test.ts tests/sidepanel/graph-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add src/core/visual-candidate.ts src/core/visual-model.ts tests/core/visual-model.test.ts src/sidepanel/components/visualizer-registry.ts tests/sidepanel/visualizer-registry.test.ts
git commit -m "feat: integrate graph into visual model pipeline"
```

---

### Task 8: End-to-End Trace Navigation, Docs and Full Gates

**Files:**
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `README.md`
- Modify: `README.zh-TW.md`
- Verify all files touched by Tasks 1-7.

**Interfaces:**
- No new runtime interfaces.
- Acceptance invariant:

```text
same raw step
→ same RuntimeState
→ same GraphVisualModel
→ same graph geometry
→ same semantic evidence
```

- [ ] **Step 1: Add raw-step Graph navigation test**

Extend `tests/sidepanel/trace-visualizer.test.ts` with a trace fixture whose Graph changes from:

```text
step A: obj-1 → obj-2
step B: obj-1 ↔ obj-2
```

Navigate directly to each raw step and assert the same Graph visualizer handle updates in place and the connection changes between one-way and reciprocal presentation.

- [ ] **Step 2: Add autoplay synchronization test**

Reuse the existing fake timer / play control pattern. Advance into the Graph mutation step and assert Graph node/connection data attributes reflect that raw step rather than stale geometry.

- [ ] **Step 3: Add Behavioral Timeline and Failure-First tests**

Use the existing timeline/failure-first navigation hooks to land on the same Graph raw step. Assert the selected raw step produces the same connection identity and node values as direct navigation.

- [ ] **Step 4: Add folded/compressed navigation regression**

When the trace outline/folding UI jumps across a compressed range to the Graph mutation step, assert Graph rendering is reconstructed from the destination raw step rather than interpolated from previous viewport history.

- [ ] **Step 5: Run all Graph-focused tests**

```bash
npx vitest run \
  tests/execution/entrypoint-resolver.test.ts \
  tests/execution/pyodide-runtime.test.ts \
  tests/core/topology-helpers.test.ts \
  tests/core/graph-interpreter.test.ts \
  tests/core/visual-model.test.ts \
  tests/sidepanel/graph-layout.test.ts \
  tests/sidepanel/selection-inspector.test.ts \
  tests/sidepanel/graph-visualizer.test.ts \
  tests/sidepanel/visualizer-registry.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run existing structure/navigation regressions**

```bash
npx vitest run \
  tests/core/linked-list-interpreter.test.ts \
  tests/core/tree-interpreter.test.ts \
  tests/sidepanel/list-visualizer.test.ts \
  tests/sidepanel/linked-list-visualizer.test.ts \
  tests/sidepanel/tree-layout.test.ts \
  tests/sidepanel/tree-visualizer.test.ts \
  tests/sidepanel/behavioral-timeline.test.ts \
  tests/sidepanel/failure-first-entry.test.ts \
  tests/sidepanel/trace-folding.test.ts
```

Expected: PASS.

- [ ] **Step 7: Update README coverage**

Document Graph v0.1 as:

```text
Supported:
- standard LeetCode Node(val, neighbors)
- direct adjacency-list testcase execution
- directed and reciprocal runtime references
- multiple components and isolated nodes
- edge add/remove visualization
- node and connection inspection

Not yet supported:
- generic dict/list adjacency inference
- weighted graphs
- custom graph classes
- BFS/DFS/shortest-path semantic interpretation
```

Apply equivalent wording to `README.zh-TW.md` in Traditional Chinese.

- [ ] **Step 8: Run the full repository gates**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 9: Final factual-copy scan**

Search newly added Graph UI source/test strings:

```bash
rg -n "bug|root cause|likely cause|DFS is|BFS is|shortest path|infinite loop|TLE" src/sidepanel/components/GraphVisualizer.ts tests/sidepanel/graph-visualizer.test.ts
```

Expected: no diagnostic Graph UI copy. Test descriptions may mention prohibited wording only when asserting absence; if so, keep such assertions explicit and do not surface the wording in renderer code.

- [ ] **Step 10: Commit docs and end-to-end coverage**

```bash
git add tests/sidepanel/trace-visualizer.test.ts README.md README.zh-TW.md
git commit -m "test: cover graph navigation and document support"
```

---

## Implementation Order and Review Gates

Execute tasks strictly in order:

```text
1. typed Graph input
2. shared topology mechanics
3. Graph interpreter
4. deterministic Graph layout
5. shared selection lifecycle
6. Graph visualizer
7. visual-model / registry integration
8. end-to-end navigation + docs + full gates
```

Each task must complete its focused RED → GREEN cycle and commit before the next task begins. Do not merge Graph semantics into the shared topology helpers; do not start renderer work before the pure Graph model and layout contracts are green.

## Final Acceptance Checklist

Before declaring the milestone complete, verify all of the following from actual test output:

- standard Clone Graph-style adjacency testcase executes without manual conversion；
- malformed adjacency input fails closed；
- strict `Node.neighbors` detection rejects false positives；
- duplicate neighbors remain inspectable but do not create duplicate topology lines；
- reciprocal runtime references remain two model edges and one reciprocal visual connection；
- one-sided reciprocal mutation remains inspectable per direction；
- reorder-only `neighbors` mutation does not become topology change；
- multiple/isolated components stay visible；
- main component ranking follows pointer coverage → size → lexical ID；
- same Graph model always returns the same coordinates；
- Graph layout is navigation-history independent；
- node and connection selection persist when identity survives；
- stale selection falls back deterministically to main-component node；
- viewport scroll survives Graph step update；
- Graph cycles are not rendered as warnings；
- no Graph-specific RuntimeMutation or trace protocol was introduced；
- Tree / Linked List semantics remain unchanged after helper extraction；
- List / Dict / Linked List / Tree regressions remain green；
- direct step / autoplay / Behavioral Timeline / Failure-First / folded navigation converge on the same Graph raw-step evidence；
- `npm test`, `npm run typecheck`, and `npm run build` all pass.

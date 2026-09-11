# Tree Visualization

## Design Spec v0.1

---

# 1. Goal

LeetYourBrain2Code 已經完成：

- live LeetCode editor sync；
- active-tab ownership；
- selected-testcase execution；
- Pyodide execution trace；
- runtime-state reconstruction；
- Runtime Mutation Semantics；
- List / Dict / Linked List visualization；
- Behavioral Debugging Foundation；
- Behavioral Evidence Navigation；
- Behavioral Timeline；
- Trace Folding；
- Failure-First Entry Point。

下一個 milestone 是擴張 visualization coverage，加入 **LeetCode 標準 Binary Tree / `TreeNode` visualization**。

本次目標不是建立 generic graph engine，而是讓每個 raw trace step 都能 deterministic 地重建並呈現目前 captured 的 `TreeNode` topology、active-frame pointers 與 topology mutations，包括：

- 正常 binary tree；
- multiple disconnected TreeNode components；
- detached subtree；
- node value changes；
- `left` / `right` edge add / remove / redirect；
- local pointer movement；
- cycle；
- shared child；
- capture truncation；
- external / unresolved child references。

核心 acceptance statement：

> Given a captured LeetCode TreeNode execution, each raw step can deterministically reconstruct and render the observed TreeNode topology, pointer bindings, and mutations, including detached or non-tree topology, without inferring correctness or cause.

---

# 2. Product Principle

本專案維持既有原則：

> Visualize what the program actually did.

不做：

> Infer what the user intended, whether the solution is correct, or what caused the failure.

Tree visualizer 只呈現 captured runtime facts。

允許的 factual wording：

```text
Cycle detected in TreeNode references
Shared child: obj-7 has 2 incoming TreeNode references
Topology truncated
```

禁止把 topology fact 升級成診斷：

```text
Your tree is broken
This is the bug
This caused the timeout
Likely root cause
Failure source
```

Source location、mutation、cycle、shared child 都只是 observation evidence，不代表 causality。

---

# 3. Scope

Tree Visualization v0.1 包含：

1. LeetCode standard `TreeNode` detection；
2. Tree-specific runtime interpretation；
3. `TreeVisualModel`；
4. multiple connected components；
5. deterministic main-component selection；
6. active-frame TreeNode pointer badges；
7. `val` mutation projection；
8. `left` / `right` reference mutation projection；
9. newly appeared TreeNode presentation；
10. detached-node / detached-component presentation；
11. cycle detection；
12. shared-child detection；
13. external / unresolved child reference presentation；
14. Tree participation in the existing visual candidate resolver；
15. deterministic hierarchical layout for strict trees；
16. deterministic bounded fallback layout for non-tree topology；
17. HTML node + SVG edge renderer；
18. bounded scrollable viewport；
19. runtime capture truncation propagation；
20. unit, DOM, integration and regression tests。

---

# 4. Explicit Non-Goals

v0.1 不實作：

- generic N-ary tree inference；
- arbitrary custom tree classes；
- generic object graph visualizer；
- Graph Visualization；
- force-directed graph layout；
- graph algorithms / graph semantics；
- DP visualization；
- expression-level tracing；
- source-level attribute relation tracing；
- AST `node.left` / `node.right` / `node.val` relation extraction；
- algorithm classification；
- LeetCode problem-title classification；
- correctness judgment；
- root-cause analysis；
- automatic bug explanation；
- automatic fix suggestions；
- semantic subtree pruning；
- subtree collapse / expand state；
- zoom / pan controls；
- animation engine；
- cross-run conceptual node matching；
- revision-to-revision tree diff。

Graph Visualization remains a separate later milestone.

---

# 5. Existing Baseline

Current runtime already exposes the primitives Tree visualization needs:

```text
TraceEvent.objects
        ↓
RuntimeState.objectTopology
        ↓
RuntimeMutation[]
        ↓
VisualState
        ↓
VisualizerRegistry
```

`ObjectSnapshot` already contains:

```ts
interface ObjectSnapshot {
  objectId: ObjectId;
  className: string;
  attributes: Record<string, ValueSnapshot>;
}
```

`ValueSnapshot` already supports stable object references:

```ts
interface ObjectReferenceSnapshot {
  type: "reference";
  objectId: ObjectId;
  className: string;
}
```

`RuntimeState.objectTopology` already contains capture truncation state:

```ts
interface ObjectTopologyState {
  objects: Map<ObjectId, ObjectSnapshot>;
  truncated: boolean;
}
```

Existing Runtime Mutation Semantics already represent the events Tree needs:

- local reference bound / unbound / redirected；
- object-attribute reference bound / unbound / redirected；
- object attribute added / changed / removed；
- object visibility appeared / disappeared。

Therefore Tree Visualization must consume these existing contracts rather than introducing a second Tree-specific trace or mutation protocol.

---

# 6. Architecture

Tree follows the existing interpretation pipeline:

```text
TraceEvent
   ↓
RuntimeState
├─ frames
└─ objectTopology
   ↓
RuntimeMutation[]
   ↓
buildTreeVisuals(...)
   ↓
TreeVisualModel[]
   ↓
VisualCandidate[]
   ↓
resolveVisualCandidates(...)
   ↓
TreeVisualizer
   ↓
pure deterministic layout
```

The responsibilities are deliberately separated.

## 6.1 `src/core/tree-interpreter.ts`

Owns runtime interpretation only:

- TreeNode candidate detection；
- child-target classification；
- internal topology construction；
- connected components；
- component entry nodes；
- main-component selection；
- active-frame pointer bindings；
- node / edge mutation projection；
- detached evidence；
- cycle detection；
- shared-child detection；
- capture truncation propagation。

It must not:

- calculate pixel coordinates；
- access DOM；
- preserve UI history；
- infer correctness；
- infer root cause。

## 6.2 `src/core/visual-model.ts`

Extends the existing structure model union:

```ts
type StructureVisualModel =
  | ListVisualModel
  | DictVisualModel
  | LinkedListVisualModel
  | TreeVisualModel;
```

`buildVisualState()` builds Tree visuals in parallel with current container and Linked List visuals.

## 6.3 `src/core/visual-candidate.ts`

Adds one new kind only:

```ts
type VisualKind =
  | "list"
  | "dict"
  | "linked_list"
  | "tree";
```

The existing resolver algorithm is unchanged.

## 6.4 `src/sidepanel/components/tree-layout.ts`

Owns presentation geometry only.

Contract:

```text
TreeVisualModel
    ↓
node coordinates + edge geometry
```

It is a pure function and must not access DOM or previous-step layout state.

## 6.5 `src/sidepanel/components/TreeVisualizer.ts`

Owns rendering only:

- HTML TreeNode cards；
- pointer badges；
- SVG `left` / `right` edges；
- mutation classes；
- component sections；
- topology fact notices；
- viewport scrolling；
- accessibility metadata。

## 6.6 `src/sidepanel/components/visualizer-registry.ts`

Registers a `tree` factory using the existing typed registry. The registry remains the renderer-dispatch boundary.

Core invariant:

```text
runtime truth ≠ layout state ≠ DOM state
```

---

# 7. TreeNode Detection Contract

Tree v0.1 supports only the standard LeetCode-style class:

```python
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
```

Detection is fail-closed.

An `ObjectSnapshot` is a TreeNode candidate only when:

```text
className === "TreeNode"
AND
left attribute exists
AND
right attribute exists
AND
left  ∈ {None, reference}
AND
right ∈ {None, reference}
```

`val` does not participate in structural detection.

If `val` exists, its captured `ValueSnapshot` becomes the node label. If it does not exist, the label is `null` and topology may still be rendered.

Examples that must not be inferred as TreeNode:

```python
class Foo:
    left = ...
    right = ...
```

and malformed current state such as:

```python
root.left = 123
```

A reference-valued child may point to an object that is not a TreeNode. The source object may still satisfy the TreeNode candidate contract; the target is then represented factually as an external reference rather than being coerced into a TreeNode.

No class-name aliases such as `Node`, `BinaryNode`, `BSTNode`, or structural-only inference are supported in v0.1.

---

# 8. Tree Visual Model

The visual model stores interpreted runtime facts, not layout coordinates and not diagnostic conclusions.

```ts
type TreeTargetKind =
  | "none"
  | "tree_node"
  | "external"
  | "unresolved";

interface TreeNodeVisual {
  objectId: ObjectId;
  className: "TreeNode";
  label: ValueSnapshot | null;

  leftObjectId: ObjectId | null;
  rightObjectId: ObjectId | null;
  leftTargetKind: TreeTargetKind;
  rightTargetKind: TreeTargetKind;

  status:
    | "unchanged"
    | "added"
    | "changed"
    | "detached";

  valueStatus:
    | "unchanged"
    | "changed";

  leftStatus:
    | "unchanged"
    | "added"
    | "removed"
    | "changed";

  rightStatus:
    | "unchanged"
    | "added"
    | "removed"
    | "changed";
}

interface TreePointerVisual {
  variableName: string;
  objectId: ObjectId | null;
  status:
    | "unchanged"
    | "moved"
    | "added"
    | "removed";
}

interface TreeComponent {
  componentId: string;
  nodeIds: ObjectId[];
  entryNodeIds: ObjectId[];
  pointerCount: number;
  cyclic: boolean;
  sharedChildNodeIds: ObjectId[];
  role: "main" | "detached";
}

interface TreeVisualModel {
  kind: "tree";
  visualId: "tree:TreeNode";
  nodes: TreeNodeVisual[];
  components: TreeComponent[];
  pointers: TreePointerVisual[];
  truncated: boolean;
}
```

`visualId` is constant while a Tree visual exists because v0.1 produces at most one Tree visual containing all captured TreeNode components. This avoids coupling visual identity to whichever component happens to be selected as main at one step.

`truncated` means exactly:

```text
runtime.objectTopology.truncated === true
```

It must not be overloaded to mean malformed topology, non-TreeNode targets, or renderer viewport clipping.

---

# 9. Child Target Classification

For each candidate TreeNode and each field `left` / `right`:

## 9.1 `none`

The captured field is `None`.

```text
objectId = null
targetKind = "none"
```

## 9.2 `tree_node`

The field is a reference and the target exists in `objectTopology.objects` and also satisfies the TreeNode candidate contract.

This edge participates in Tree topology, components, cycle detection, shared-child detection and hierarchical layout.

## 9.3 `external`

The field is a reference, the target object exists in the captured topology, but the target does not satisfy the TreeNode candidate contract.

The reference is rendered factually, but the target is not converted into a TreeNode node.

## 9.4 `unresolved`

The field is a reference but the target object is absent from the captured `objectTopology.objects` map.

UI wording describes only the observation, for example:

```text
left → obj-9 (target not present in captured topology)
```

An unresolved target does not automatically set `truncated=true`; capture truncation remains controlled by `runtime.objectTopology.truncated`.

---

# 10. Topology Interpretation

Only `tree_node` child references form internal Tree edges.

Each candidate belongs to exactly one connected component. Components are calculated using undirected connectivity over the internal `left` / `right` edges so that every structurally connected set is grouped together regardless of edge direction.

For each component:

```text
internal indegree(node)
= number of TreeNode left/right references targeting node
```

`entryNodeIds` are nodes with internal indegree `0`.

Component IDs are deterministic:

```text
tree-component:<lexically-smallest-node-objectId>
```

Component node IDs and entry IDs are stored in lexical order for stable tests and rendering.

---

# 11. Main Component Selection

No variable-name heuristic such as `root` is allowed.

For each component, calculate active-frame pointer coverage:

```text
pointerCount
= number of active-frame local references whose target TreeNode belongs to the component
```

Main component ordering is:

```text
1. higher pointerCount
2. larger node count
3. lexically smaller componentId
```

Exactly one component is assigned:

```text
role = "main"
```

Every remaining disconnected component is assigned:

```text
role = "detached"
```

In this spec, `detached` means only:

> not connected to the selected main TreeNode component in the current captured topology.

It does not assert that the component was historically attached or that a particular mutation caused the disconnection.

---

# 12. Pointer Semantics

Tree pointers are derived from the active frame only, matching existing Linked List semantics.

A current local reference becomes a Tree pointer when its referenced object is a captured TreeNode candidate.

Examples:

```text
root
node
curr
parent
left_child
```

Variable names have no semantic ranking.

Pointer status is projected from existing local `ReferenceMutation` events:

```text
bound      → added
unbound    → removed
redirected → moved
no mutation → unchanged
```

An unbound pointer may remain in the Tree visual for the current step with:

```text
objectId = null
status = "removed"
```

so the pointer disappearance is visible without inventing a replacement target.

---

# 13. Mutation Projection

`RuntimeMutation[]` remains the only mutation authority.

Tree interpretation must not independently diff previous and current TreeVisualModels.

## 13.1 Local pointer changes

Existing local `ReferenceMutation` maps to `TreePointerVisual.status`.

## 13.2 `left` / `right` edge changes

Existing object-attribute `ReferenceMutation` maps to the corresponding field status:

```text
bound      → added
unbound    → removed
redirected → changed
```

## 13.3 `val` changes

Existing `ObjectAttributeMutation` on `val` maps to:

```text
valueStatus = "changed"
```

## 13.4 Node appearance

Existing `object_visibility` with `action = "appeared"` maps to:

```text
status = "added"
```

## 13.5 Node changed status

A TreeNode is `changed` when a captured mutation modifies:

- `val`；
- `left`；
- `right`；
- another captured object attribute on that TreeNode that is represented by the existing mutation substrate。

Status precedence is:

```text
added > detached > changed > unchanged
```

## 13.6 Detached node evidence

A node may receive `status = "detached"` when all of the following are true in the current step:

1. it was the previous target of a `left` or `right` reference mutation；
2. that field was removed or redirected away from the node；
3. the node still exists as a captured TreeNode candidate；
4. after the mutation, the node has zero internal TreeNode incoming edges。

This status describes the directly observed edge-detachment event only. Descendants do not automatically inherit `status = "detached"`; their disconnected component already communicates current topology.

---

# 14. Non-Tree Topology Facts

Buggy or intermediate user code may create topology that is not a strict tree. The visualizer must preserve it rather than disappear.

## 14.1 Cycle

A component is cyclic when following internal TreeNode `left` / `right` references contains a directed cycle.

Example:

```python
root.left = root
```

Model:

```text
cyclic = true
```

UI fact:

```text
Cycle detected in TreeNode references
```

## 14.2 Shared child

A node is a shared child when:

```text
internal indegree > 1
```

Example:

```python
root.left = child
root.right = child
```

Model:

```text
sharedChildNodeIds = [child]
```

UI fact:

```text
Shared child: <objectId> has 2 incoming TreeNode references
```

If incoming count is greater than 2, the actual count is shown.

No pattern is described as a bug, cause, or correctness failure.

---

# 15. Strict Tree Eligibility

A component may use hierarchical tree layout when all internal TreeNode topology satisfies:

```text
cyclic === false
sharedChildNodeIds.length === 0
entryNodeIds.length === 1
```

and every internal non-entry node has indegree exactly `1`.

External or unresolved child references do not become internal TreeNode nodes and therefore do not change the internal indegree rule. They are rendered as factual edge terminals attached to the source node.

A component that fails strict-tree eligibility is still rendered using fallback topology presentation.

---

# 16. Visual Candidate Integration

The existing `VisualPriority` tuple remains unchanged:

```ts
type VisualPriority = readonly [
  activeLineRelevant: boolean,
  mutated: boolean,
  pointerRelevant: boolean,
  rootReferenceCount: number
];
```

Tree v0.1 produces:

```text
[
  false,
  mutated,
  pointerRelevant,
  pointerCount
]
```

## 16.1 `activeLineRelevant`

Always `false` in v0.1.

Current `StaticRelation` only models subscript / iteration / membership relationships. Tree v0.1 does not extend the trace schema with object-attribute relations merely to manufacture first-priority relevance.

## 16.2 `mutated`

True when current-step RuntimeMutation touches:

- a TreeNode object in the model；
- a TreeNode `left` / `right` / `val` attribute；
- an active-frame local pointer represented by the Tree model；
- TreeNode object visibility。

## 16.3 `pointerRelevant`

True when the Tree model contains at least one current or just-removed active-frame Tree pointer.

## 16.4 `pointerCount`

Uses the Tree model pointer count as the fourth existing priority dimension, consistent with current specialized-structure behavior.

The visual candidate resolver itself is not modified beyond accepting `kind = "tree"`.

Tree is never automatically primary merely because a TreeNode exists.

---

# 17. Layout Architecture

Layout is a pure deterministic projection:

```text
layout = f(current TreeVisualModel)
```

Never:

```text
layout = f(previous UI coordinates, navigation history, current model)
```

Therefore the same raw step must render identically whether reached by:

- Previous / Next；
- autoplay；
- Trace Outline；
- Behavioral Timeline；
- Failure-First `Inspect`；
- direct raw-step navigation。

---

# 18. Strict Tree Hierarchical Layout

For strict components, layout uses a deterministic hierarchical tree algorithm based on subtree span / inorder placement.

Required properties:

1. parent depth is above child depth；
2. left child x-coordinate is less than parent x-coordinate；
3. right child x-coordinate is greater than parent x-coordinate；
4. nodes at the same depth do not overlap；
5. sibling subtree ordering follows `left` before `right`；
6. same topology and same object IDs produce the same coordinates；
7. traversal order and hash/map insertion order cannot change coordinates。

`depth` determines vertical placement. Subtree span determines horizontal placement.

Object ID lexical order is used only as a deterministic tie-break where topology alone does not establish order.

Layout does not mutate the TreeVisualModel.

---

# 19. Non-Tree Fallback Layout

Cycle or shared-child topology must not invoke a generic Graph engine in v0.1.

Fallback layout is deliberately simple and bounded:

1. component `nodeIds` are sorted lexically；
2. nodes are placed row-major in a fixed three-column grid；
3. SVG edges connect the actual current `left` / `right` relationships；
4. cycle and shared-child edges remain visible；
5. edge computation never recursively follows topology；
6. repeated rendering of the same model produces identical geometry。

The three-column grid is a presentation fallback, not a claim about tree depth or algorithm semantics.

This prevents malformed topology from causing recursive layout failure while keeping the captured relationships inspectable.

---

# 20. Renderer Architecture

Tree renderer uses a hybrid DOM/SVG design:

```text
TreeVisualizer
├─ scrollable viewport
│  ├─ SVG edge layer
│  │  ├─ left edges
│  │  └─ right edges
│  └─ HTML node layer
│     ├─ val
│     ├─ objectId
│     ├─ pointer badges
│     └─ mutation state
└─ factual topology notices
```

HTML owns node content and accessibility. SVG owns geometric relationships.

The renderer consumes TreeVisualModel and layout output only. It never reads RuntimeState or RuntimeMutation directly.

---

# 21. Node Presentation

Each TreeNode card shows at minimum:

```text
val
objectId
active pointer badges, if any
```

Stable DOM metadata:

```text
data-node-id
data-node-status
```

Pointer badges include:

```text
data-pointer-name
data-pointer-status
```

The card visually distinguishes:

```text
unchanged
added
changed
detached
```

`valueStatus = changed` must be independently testable even when node topology did not change.

Missing `val` is rendered factually as an absent/unavailable label rather than synthesized data.

---

# 22. Edge Presentation

Every non-`None` child reference carries stable metadata:

```text
data-edge-from
data-edge-to
data-edge-field="left|right"
data-edge-status
data-edge-target-kind
```

Current internal TreeNode edge states support:

```text
unchanged
added
changed
```

When a `left` / `right` reference is removed and now equals `None`, the current step renders a short terminal mutation marker such as:

```text
left → None
```

with `data-edge-status="removed"` so the removal remains visible even though no current child edge exists.

For external references, renderer shows a terminal target label using the captured object ID and does not create a fake TreeNode card.

For unresolved references, renderer shows a terminal target label indicating that the target is not present in captured topology.

---

# 23. Component Presentation

Components render vertically in deterministic order:

```text
main component first
then detached components sorted by componentId
```

Example:

```text
Main tree
─────────
      4
       \
        7

Detached component
──────────────────
      2
     / \
    1   3
```

The `Detached component` label means disconnected from the selected main component in the current topology only.

A detached component may contain active local pointers and remains fully inspectable.

---

# 24. Topology Notices

Renderer may show the following factual notices when applicable:

```text
Cycle detected in TreeNode references
Shared child: <objectId> has <N> incoming TreeNode references
Topology truncated
```

Notices must not include correctness, cause, suspicion or fix language.

`Topology truncated` appears only when:

```text
model.truncated === true
```

External and unresolved edges use edge-local labels instead of misusing the truncation notice.

---

# 25. Bounded Viewport

TreeVisualModel retains all TreeNodes available in the captured runtime topology.

The Tree renderer does not apply semantic node pruning.

Presentation is bounded by a scrollable viewport:

```text
max-height: 360px
overflow: auto
```

Both horizontal and vertical overflow are allowed.

v0.1 does not implement:

- node-count-based model truncation；
- automatic subtree collapse；
- semantic LOD；
- zoom / pan state。

Therefore:

```text
TreeVisualModel = captured truth
Viewport = presentation bound
```

Capture limits remain owned by the trace/runtime layer.

---

# 26. Update and Navigation Semantics

Tree visual state remains synchronized through existing raw-step state ownership.

The Tree renderer must not create a second cursor or independently navigate trace steps.

When `VisualState` changes:

```text
new TreeVisualModel
    ↓
recompute pure layout
    ↓
update TreeVisualizer
```

No layout history is required.

No Tree-specific changes are made to:

- `setStep` ownership；
- autoplay semantics；
- Failure-First navigation；
- Behavioral Timeline navigation；
- Trace Outline navigation。

---

# 27. Error Handling

Tree visualization is fail-closed at interpretation boundaries and fail-soft at presentation boundaries.

## 27.1 Detection failure

If no object satisfies the TreeNode candidate contract:

```text
buildTreeVisuals(...) → []
```

No Tree candidate is created. Raw trace, Locals, What Changed, stdout and other visualizers remain unaffected.

## 27.2 Malformed TreeNode field

If a current object named `TreeNode` has `left` or `right` that is neither `None` nor reference, it is not a candidate for that step.

The interpreter does not coerce primitive values into child references.

## 27.3 External target

Captured non-TreeNode target is classified `external` and displayed as a reference terminal.

## 27.4 Missing target

Reference target absent from captured topology is classified `unresolved` and displayed without synthesis.

## 27.5 Non-tree topology

Cycle or shared child does not suppress the visual. The component switches to deterministic fallback layout.

## 27.6 Layout safety

Fallback layout must terminate without graph traversal recursion. A malformed component must not crash the whole TraceVisualizer.

---

# 28. Performance and Determinism

Tree interpretation should be linear in captured TreeNode topology size:

```text
N = number of TreeNode candidates
E ≤ 2N internal child slots

interpretation: O(N + E)
component analysis: O(N + E)
cycle/shared-child analysis: O(N + E)
```

Normal hierarchical layout should remain bounded by the number of rendered TreeNodes and internal edges.

The implementation must not use an unbounded search for alternative layouts.

Deterministic ordering must explicitly sort object IDs / component IDs where map iteration order would otherwise influence output.

No additional runtime capture traversal is introduced by the renderer.

---

# 29. Testing Strategy

Testing is divided into four layers.

## 29.1 Tree interpreter unit tests

Required cases:

1. detects standard `TreeNode`；
2. rejects `Foo(left, right)` structural lookalike；
3. rejects TreeNode with primitive `left` or `right`；
4. allows missing `val`；
5. classifies `none` child；
6. classifies internal `tree_node` child；
7. classifies captured non-TreeNode child as `external`；
8. classifies missing target as `unresolved`；
9. builds normal binary-tree component；
10. builds multiple disconnected components；
11. deterministic component IDs；
12. main selection prefers pointer coverage；
13. main selection next prefers node count；
14. lexical tie-break is deterministic；
15. pointer bound → added；
16. pointer redirected → moved；
17. pointer unbound → removed；
18. `left` added；
19. `left` removed；
20. `left` redirected；
21. equivalent `right` mutation behavior；
22. `val` changed；
23. appeared node → added；
24. directly detached previous child → detached；
25. descendants do not automatically inherit detached node status；
26. detects cycle；
27. detects shared child；
28. preserves component under cycle；
29. propagates runtime `truncated`；
30. unresolved edge does not independently force `truncated=true`；
31. no candidates returns empty visuals。

## 29.2 Layout unit tests

Required cases:

1. same model → same coordinates；
2. parent above children；
3. left child left of parent；
4. right child right of parent；
5. same-depth nodes do not overlap；
6. map insertion order cannot change output；
7. multiple strict components are deterministic；
8. cycle uses fallback；
9. shared child uses fallback；
10. fallback node ordering is lexical；
11. fallback is fixed three-column row-major；
12. fallback terminates for self-cycle；
13. fallback terminates for multi-node cycle。

## 29.3 Renderer DOM tests

Required cases:

1. renders standard tree；
2. node metadata is stable；
3. edge metadata includes field and status；
4. renders pointer badges；
5. renders changed value state；
6. renders added node；
7. renders removed `left/right → None` mutation marker；
8. renders external target terminal；
9. renders unresolved target terminal；
10. renders main component first；
11. renders detached components；
12. renders cycle notice；
13. renders shared-child notice and incoming count；
14. renders `Topology truncated` only when model says truncated；
15. viewport is bounded and scrollable；
16. renderer update does not create navigation actions；
17. forbidden diagnostic language is absent。

## 29.4 Visual-state integration tests

Required cases:

1. Tree joins existing `StructureVisualModel` union；
2. Tree joins `VisualKind`；
3. registry can create and update TreeVisualizer；
4. Tree and List coexist；
5. Tree and Dict coexist；
6. Tree and Linked List coexist；
7. visual resolver still returns at most existing visible limit；
8. Tree mutation can increase Tree candidate priority；
9. Tree pointer can increase Tree candidate priority；
10. Tree `activeLineRelevant` remains false in v0.1；
11. Tree is not automatically primary merely because it exists；
12. raw-step jump reconstructs matching Tree state；
13. autoplay step updates Tree state；
14. Behavioral Timeline navigation updates Tree state；
15. Failure-First `Inspect` updates Tree state；
16. existing List / Dict / Linked List behavior remains unchanged。

Full existing test, typecheck and build gates remain mandatory before implementation completion.

---

# 30. Example Runtime Scenarios

## 30.1 Traversal pointer

```python
node = node.left
```

Expected facts:

```text
Tree topology unchanged
node pointer moved
Tree candidate mutated = true because represented local reference changed
```

No claim is made about traversal correctness.

## 30.2 Child insertion

```python
node.left = TreeNode(1)
```

Expected facts:

```text
new TreeNode appeared
left edge added
new node visually added
```

## 30.3 Subtree disconnection

```python
root.left = None
```

Expected facts:

```text
left edge removed
previous child may receive detached node status if it now has zero internal incoming edges
its surviving TreeNode component remains rendered
```

The subtree is not deleted from the visual merely because it is no longer reachable from main.

## 30.4 Cycle

```python
root.left = root
```

Expected facts:

```text
cycle detected
component remains visible
fallback layout used
```

## 30.5 Shared child

```python
root.left = child
root.right = child
```

Expected facts:

```text
child incoming TreeNode reference count = 2
shared-child notice shown
component remains visible
fallback layout used
```

---

# 31. Files Expected to Change

New core file:

```text
src/core/tree-interpreter.ts
```

New presentation files:

```text
src/sidepanel/components/TreeVisualizer.ts
src/sidepanel/components/tree-layout.ts
```

Existing core integration files:

```text
src/core/visual-model.ts
src/core/visual-candidate.ts
```

Existing side-panel integration files:

```text
src/sidepanel/components/visualizer-registry.ts
side-panel stylesheet(s) that currently own visualizer CSS
```

Expected tests include dedicated Tree interpreter, layout and renderer coverage plus extensions to existing visual-state / registry integration tests.

This spec does not require changing TraceSession schema or RuntimeMutation schema.

---

# 32. Deferred Extensions

The following are intentionally deferred until after Tree v0.1 is validated in real LeetCode usage:

## 32.1 Generic object-attribute StaticRelation

A later shared Tree/Graph milestone may add source-level relation extraction for expressions such as:

```python
node.left
node.right
node.val
```

At that point Tree may participate honestly in the `activeLineRelevant` priority dimension.

## 32.2 Generic object graph model

Graph Visualization may later extract common topology primitives from Tree and Linked List interpretation. Tree v0.1 does not prematurely introduce this abstraction.

## 32.3 Custom tree classes

Support for `Node`, `BSTNode`, n-ary `children`, or structural tree inference requires a separate contract and false-positive analysis.

## 32.4 Large-tree interaction

Collapse / expand, zoom, pan, minimap, semantic focus and LOD remain future UX work if captured real-world trees make plain scrolling insufficient.

---

# 33. Key Invariants

Implementation must preserve all of the following:

```text
1. Raw trace remains authoritative.
2. RuntimeMutation[] remains the only mutation authority.
3. Tree visualizer does not judge correctness.
4. Tree visualizer does not infer cause.
5. Only className="TreeNode" + valid left/right slots qualify in v0.1.
6. Non-tree topology remains visible.
7. Cycle/shared child are topology facts, not diagnoses.
8. Disconnected TreeNode components remain visible.
9. Main component selection does not depend on a variable named root.
10. Tree layout is stateless and deterministic.
11. Navigation history cannot affect layout output.
12. Graph Visualization is not implemented implicitly inside Tree fallback.
13. Tree model does not prune captured nodes for viewport convenience.
14. model.truncated means runtime capture truncation only.
15. External/unresolved references are represented explicitly rather than synthesized.
16. Tree does not fabricate activeLineRelevant in v0.1.
17. Existing visual candidate resolver semantics remain intact.
18. Existing List / Dict / Linked List behavior remains intact.
19. Existing Failure-First / Timeline / Outline / autoplay navigation remains the sole navigation system.
20. Renderer failure must not suppress raw trace inspection.
```

---

# 34. Completion Criteria

Tree Visualization v0.1 is complete when all of the following are true:

1. standard LeetCode `TreeNode` topology is detected from runtime objects without problem-specific configuration；
2. normal binary trees render hierarchically；
3. active-frame TreeNode pointers are visible；
4. `val`, `left`, `right`, local-reference and object-appearance mutations are visually projected from RuntimeMutation；
5. disconnected TreeNode components remain visible；
6. cycle and shared-child topology remain inspectable through deterministic fallback；
7. external and unresolved child references remain factual and visible；
8. runtime topology truncation is exposed without model-level semantic pruning；
9. direct step navigation and all existing navigation surfaces reconstruct the same Tree state；
10. Tree competes through the existing visual candidate resolver rather than being hard-coded primary；
11. no Tree-specific trace schema or mutation schema is introduced；
12. no correctness or causal diagnosis is introduced；
13. dedicated Tree tests pass；
14. all existing regression, typecheck and build gates pass。

This closes Tree Visualization as a visualization-coverage milestone while leaving Graph Visualization as a distinct next expansion rather than an implicit dependency of Tree v0.1.

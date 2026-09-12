# Graph Visualization

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
- List / Dict / Linked List / Tree visualization；
- Behavioral Debugging Foundation；
- Behavioral Evidence Navigation；
- Behavioral Timeline；
- Trace Folding；
- Failure-First Entry Point。

下一個 milestone 是擴張 visualization coverage，加入 **LeetCode 標準 Graph / `Node.neighbors` visualization**。

本次目標不是建立 generic graph-analysis engine，也不是推論 BFS / DFS / shortest-path 等演算法語意，而是讓每個 raw trace step 都能 deterministic 地重建並呈現目前 captured 的 `Node` object graph、active-frame pointers、directed runtime references 與 topology mutations。

Graph v0.1 必須直接支援 LeetCode 標準 adjacency-list testcase，讓真正的 Graph 題目可以從 testcase input 一路進入 runtime object topology，而不是只完成 synthetic renderer。

核心 acceptance statement：

> Given a captured LeetCode `Node.neighbors` execution, each raw step can deterministically reconstruct and render the observed graph topology, pointer bindings, and edge mutations, including reciprocal references and multiple components, without inferring algorithm intent, correctness, or cause.

---

# 2. Product Principle

本專案維持既有原則：

> Visualize what the program actually did.

Graph visualizer 呈現的是 runtime facts，而不是 graph algorithm interpretation。

允許的 factual wording：

```text
Reference added: obj-1 → obj-4
Reference removed: obj-2 → obj-1
Target not present in captured topology
Topology truncated
```

禁止把 runtime observation 升級為診斷：

```text
Your DFS is wrong
This edge caused the bug
You forgot to mark visited
This cycle caused the timeout
Shortest path is incorrect
Likely root cause
```

Graph cycle、high degree、multiple components、reciprocal references 都是正常 topology facts，不是 anomaly。

---

# 3. Scope

Graph Visualization v0.1 包含：

1. LeetCode standard `Node.neighbors` strict detection；
2. `graph_node` typed entrypoint parameter；
3. LeetCode adjacency-list testcase → runtime `Node` object graph conversion；
4. Graph-specific runtime interpretation；
5. directed runtime edge model；
6. reciprocal-edge presentation pairing；
7. active-frame Graph pointer badges；
8. multiple connected components；
9. deterministic main-component selection；
10. `neighbors` mutation → per-edge add/remove projection；
11. node `val` / object mutation presentation；
12. isolated nodes；
13. unresolved graph references；
14. Graph participation in existing visual candidate resolution；
15. deterministic force-directed layout；
16. independent component layout；
17. compact HTML nodes + SVG connections；
18. selectable nodes and selectable visual connections；
19. persistent selection + detail inspector；
20. bounded scrollable viewport；
21. runtime capture truncation propagation；
22. targeted shared topology helpers；
23. shared inspector lifecycle consolidation；
24. unit, DOM, integration and regression tests。

---

# 4. Explicit Non-Goals

Graph v0.1 不實作：

- arbitrary adjacency-list inference from generic Dict / List values；
- custom graph classes；
- arbitrary structural graph inference from any class containing `neighbors`；
- weighted graphs；
- edge labels / edge weights；
- graph algorithm classification；
- BFS / DFS / Dijkstra / A* semantic interpretation；
- visited / frontier / shortest-path inference；
- correctness judgment；
- root-cause analysis；
- automatic bug explanation；
- automatic fix suggestions；
- generic topology engine that rewrites Linked List / Tree around one universal abstraction；
- semantic graph pruning；
- graph zoom / pan controls beyond existing scrollable viewport behavior；
- revision-to-revision behavioral diff；
- DP visualization。

Adjacency-list container visualization may be considered in a later Graph v0.2 milestone.

---

# 5. Existing Baseline

The current runtime already exposes the primitives Graph visualization needs:

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

`ObjectSnapshot` exposes object identity, class name and captured attributes:

```ts
interface ObjectSnapshot {
  objectId: ObjectId;
  className: string;
  attributes: Record<string, ValueSnapshot>;
}
```

`ValueSnapshot` already supports:

```text
reference
list / tuple
primitive values
```

so `Node.neighbors` can be represented as a sequence of stable object references.

Existing Runtime Mutation Semantics already provide:

- local reference bound / unbound / redirected；
- object attribute added / changed / removed；
- object visibility appeared / disappeared。

Graph Visualization therefore consumes the existing runtime substrate rather than introducing a Graph-specific trace protocol or Graph-specific mutation variant.

The current visual UI language is also treated as an established baseline:

> compact structure + direct selection + persistent selection + detail inspector + factual notices

Graph must follow this hierarchy rather than returning to dense metadata cards.

---

# 6. End-to-End Architecture

Graph v0.1 extends the pipeline from testcase input through rendering:

```text
LeetCode adjacency-list testcase
        ↓
Entrypoint Resolver
ParameterKind = "graph_node"
        ↓
Python Runner
adjacency list → Node object graph
        ↓
Trace / RuntimeState
ObjectSnapshot(Node)
  val
  neighbors: [reference, ...]
        ↓
RuntimeMutation[]
        ↓
buildGraphVisuals(...)
        ↓
GraphVisualModel[]
        ↓
VisualCandidate[]
        ↓
existing candidate resolver
        ↓
Graph layout
        ↓
GraphVisualizer
```

Core invariant:

```text
runtime truth ≠ graph interpretation ≠ layout geometry ≠ DOM state
```

---

# 7. Typed Input and Entrypoint Resolution

## 7.1 ParameterKind

Extend:

```ts
type ParameterKind =
  | "value"
  | "linked_list"
  | "binary_tree"
  | "graph_node";
```

## 7.2 Supported annotations

Graph v0.1 recognizes standard LeetCode `Node` parameter forms, including forward references where required by Graph problems.

Expected accepted forms include:

```text
Node
Optional[Node]
Optional['Node']
'Node'
Node | None
None | Node
```

Whitespace-normalized equivalents are accepted.

The resolver must continue preferring the public typed solution entrypoint when helper methods with compatible arity exist.

## 7.3 Testcase conversion

LeetCode adjacency-list input such as:

```text
[[2,4],[1,3],[2,4],[1,3]]
```

represents nodes labeled `1..N` by list position.

The runtime builder constructs:

```text
Node(1).neighbors → [Node(2), Node(4)]
Node(2).neighbors → [Node(1), Node(3)]
Node(3).neighbors → [Node(2), Node(4)]
Node(4).neighbors → [Node(1), Node(3)]
```

and passes `Node(1)` as the parameter.

Empty input:

```text
[]
```

maps to:

```python
None
```

## 7.4 Validation

The builder is fail-closed.

Every neighbor index must be an integer satisfying:

```text
1 <= neighbor <= N
```

Malformed or out-of-range adjacency input returns the existing failure path:

```text
input_error
→ unsupported_testcase_format
```

The builder must not synthesize missing nodes to repair malformed input.

Duplicate neighbor entries are allowed as input facts. The runtime `neighbors` sequence preserves duplicates and order, while the Graph topology model deduplicates identical directed edges for rendering.

---

# 8. Graph Detection Contract

Graph v0.1 supports the standard LeetCode-style object shape:

```python
class Node:
    def __init__(self, val=0, neighbors=None):
        self.val = val
        self.neighbors = neighbors or []
```

Detection is fail-closed.

An `ObjectSnapshot` is a Graph node candidate only when:

```text
className === "Node"
AND
neighbors.type ∈ {"list", "tuple"}
AND
every neighbors item is a reference whose captured className is "Node"
```

`neighbors=[]` is valid.

`val` is optional and display-only. It does not participate in topology validity.

The following must not be inferred as Graph nodes:

```python
class User:
    neighbors = [...]
```

and malformed current state such as:

```python
node.neighbors = [1, 2, 3]
```

Graph v0.1 does not use structural-only inference and does not accept aliases such as `GraphNode`, `Vertex`, or arbitrary classes containing `neighbors`.

---

# 9. Graph Visual Model

The model stores interpreted runtime facts, not DOM state or force-simulation history.

```ts
type GraphTargetKind =
  | "graph_node"
  | "external"
  | "unresolved";

interface GraphNodeVisual {
  objectId: ObjectId;
  className: "Node";
  label: ValueSnapshot | null;
  status:
    | "unchanged"
    | "added"
    | "changed";
}

interface GraphEdgeVisual {
  fromObjectId: ObjectId;
  toObjectId: ObjectId;
  targetKind: GraphTargetKind;
  status:
    | "unchanged"
    | "added"
    | "removed";
}

interface GraphPointerVisual {
  variableName: string;
  objectId: ObjectId | null;
  status:
    | "unchanged"
    | "moved"
    | "added"
    | "removed";
}

interface GraphComponent {
  componentId: string;
  nodeIds: ObjectId[];
  pointerCount: number;
  role: "main" | "secondary";
}

interface GraphVisualModel {
  kind: "graph";
  visualId: "graph:Node";
  nodes: GraphNodeVisual[];
  edges: GraphEdgeVisual[];
  components: GraphComponent[];
  pointers: GraphPointerVisual[];
  truncated: boolean;
}
```

`GraphEdgeVisual` stores directed runtime truth. Reciprocal presentation is derived later by the renderer and never replaces the underlying directed edge pair.

`visualId` is constant while a Graph visual exists because Graph v0.1 produces at most one Graph visual containing all captured standard `Node` components.

---

# 10. Edge Semantics

Every captured `neighbors` reference defines one directed runtime edge:

```text
fromObjectId → toObjectId
```

Canonical directed edge identity is:

```text
(fromObjectId, toObjectId)
```

Duplicate references from the same source to the same target remain visible in the inspector's ordered neighbor sequence but collapse to one topology edge.

## 10.1 Reciprocal references

If both runtime edges exist:

```text
A → B
B → A
```

both remain present in `GraphVisualModel.edges`.

The renderer may visually pair them into one reciprocal connection:

```text
A ↔ B
```

This is presentation only.

The connection inspector must reveal both directed facts separately.

No model or UI wording may infer that reciprocal references mean the source problem is semantically an undirected graph.

## 10.2 External and unresolved targets

If a captured neighbor reference points to a non-candidate object present in `objectTopology`, it is classified as `external`.

If the target is absent from the captured topology, it is classified as `unresolved`.

No fake Graph node is created for either case.

---

# 11. Components and Main Selection

Graph components use weak connectivity over internal Graph-node edges: direction is ignored only for component partitioning.

Every captured Graph candidate belongs to exactly one component, including isolated nodes.

Component IDs are deterministic:

```text
graph-component:<lexically-smallest-objectId>
```

For each component:

```text
pointerCount
= number of active-frame local references targeting Graph nodes in that component
```

Main component ranking is:

```text
1. higher pointerCount
2. larger node count
3. lexically smaller componentId
```

Exactly one component receives:

```text
role = "main"
```

remaining components receive:

```text
role = "secondary"
```

Unlike Tree, Graph v0.1 does not call secondary components `detached`, because disconnected components are normal graph topology and the term would imply unsupported historical semantics.

---

# 12. Pointer Semantics

Graph pointers are derived from the active frame only.

A local reference becomes a Graph pointer when it targets a captured Graph node candidate.

Variable names carry no semantic ranking. Names such as:

```text
node
curr
clone
start
neighbor
```

are treated identically.

Pointer status is projected from existing local `ReferenceMutation` events:

```text
bound      → added
unbound    → removed
redirected → moved
no mutation → unchanged
```

An unbound Graph pointer may remain visible for the current step with:

```text
objectId = null
status = "removed"
```

so pointer disappearance remains inspectable without inventing a replacement target.

---

# 13. Mutation Projection

`RuntimeMutation[]` remains the only mutation authority.

Graph interpretation must not independently diff previous and current `GraphVisualModel` instances as a second mutation system.

## 13.1 Neighbor topology mutation

`neighbors` is a sequence-valued object attribute. Existing `ObjectAttributeMutation` on `neighbors` carries before/after snapshots.

The Graph interpreter projects topology mutations by converting both sequence snapshots into directed reference sets for that source object.

```text
added edge
= after edge set - before edge set

removed edge
= before edge set - after edge set
```

Current edges with no membership change are `unchanged`.

Removed edges may remain temporarily represented as mutation evidence for the current step even though they no longer exist in current topology.

A removed edge never causes a fake target node to be created.

## 13.2 Neighbor reorder

Example:

```text
[B, C] → [C, B]
```

has equal directed edge sets and therefore does not count as a topology mutation.

The ordered neighbor sequence remains visible in the selected node inspector because traversal order may affect program behavior.

## 13.3 Node status

Node appearance maps from existing `object_visibility(action="appeared")`:

```text
status = "added"
```

A node with another represented object-attribute mutation may be marked `changed`.

Status precedence:

```text
added > changed > unchanged
```

Graph v0.1 does not use Tree's `detached` node state.

---

# 14. Shared Topology Infrastructure

Graph v0.1 is the point where component and pointer logic has repeated across Linked List, Tree and Graph enough to justify targeted extraction.

The milestone may introduce small shared helpers such as:

```text
src/core/topology/
├─ components
├─ pointers
└─ component-ranking
```

Shared helpers may own generic mechanics such as:

- deterministic connected-component partitioning from a provided adjacency relation；
- active-frame object-pointer collection；
- pointer mutation status projection；
- pointer-coverage component ranking。

They must not own domain semantics such as:

```text
Linked List → next
Tree        → left / right
Graph       → neighbors[]
```

Graph mutation projection and Graph edge semantics remain Graph-specific.

This milestone explicitly rejects a large universal `TopologyGraph` abstraction that rewrites stable Linked List and Tree behavior around a new generic engine.

---

# 15. Visual Candidate Integration

Graph joins the existing visual model union and renderer registry as a normal `VisualKind`.

Conceptually:

```ts
type StructureVisualModel =
  | ContainerVisualModel
  | LinkedListVisualModel
  | TreeVisualModel
  | GraphVisualModel;
```

and:

```ts
type VisualKind =
  | "list"
  | "dict"
  | "linked_list"
  | "tree"
  | "graph";
```

Graph does not receive a special resolver path.

Graph candidate priority should follow the same product principle as existing structures: mutation relevance and active pointer relevance may influence candidate ranking, but the generic resolver remains the final selection authority.

Exact numeric tuple ordering belongs in implementation planning and tests, not in this design spec, provided it preserves existing resolver invariants and does not hardcode Graph as always-primary.

---

# 16. Deterministic Graph Layout

Graph v0.1 uses a deterministic force-directed layout for each component.

A normal random force simulation is not acceptable because replaying the same raw step must not move nodes arbitrarily.

The layout pipeline is:

```text
GraphVisualModel
    ↓
stable sorted nodes / edges
    ↓
objectId-derived deterministic initial coordinates
    ↓
fixed force constants
fixed iteration count
    ↓
final coordinates
```

Required invariant:

```text
same GraphVisualModel
→ same coordinates
```

The layout must not depend on:

```text
Math.random()
wall-clock time
previous navigation history
previous-step coordinates
DOM positions
viewport state
```

Each disconnected component is laid out independently so unrelated components do not repel one another.

Component boxes are then arranged deterministically with the main component first.

A circular deterministic layout may be used only as a bounded fallback if the force layout cannot produce valid geometry under a defined implementation condition.

---

# 17. UI Design Language

Graph adopts the current LeetYourBrain2Code visual language:

> compact structure + direct manipulation + persistent selection + detail inspector + factual notices

The main graph must remain low-information-density.

Graph node presentation should primarily show:

```text
pointer badges
      ↓
    ( val )
```

Do not place object ID, complete neighbors list, mutation metadata and explanatory text directly inside every node.

Mutation state is encoded visually through existing status conventions rather than textual clutter.

---

# 18. Node and Connection Selection

Both Graph nodes and visual connections are selectable first-class UI elements.

## 18.1 Node inspector

Selecting a node reveals facts such as:

```text
Node 3
──────────────
value               3
object ID            obj-3
status               changed
pointers             curr, clone
outgoing references  2
neighbors
  0 → obj-1
  1 → obj-4
```

Use `outgoing references`, not generic `degree`, because the runtime model is directed.

## 18.2 Connection inspector

A visually paired reciprocal connection may reveal:

```text
Connection
──────────────────
obj-1 → obj-2   unchanged
obj-2 → obj-1   added
presentation    reciprocal
```

`presentation = reciprocal` describes the rendering treatment only.

For a one-way connection, the inspector shows only the corresponding directed runtime reference.

## 18.3 Persistent selection

Stable node selection uses object identity.

Stable connection selection uses deterministic underlying directed-edge identity or deterministic reciprocal-pair identity at the UI layer.

Across step updates:

```text
selected entity still exists
→ preserve selection

selected entity no longer exists
→ deterministic fallback
```

The fallback preference should be main-component node selection rather than arbitrary DOM order.

---

# 19. Shared Inspector Consolidation

List / Dict / Linked List already use a generic selection-inspector primitive, while Tree currently contains some local selection lifecycle behavior.

Graph v0.1 may consolidate shared interaction mechanics so Tree / Linked List / Graph share behavior for:

- selected key tracking；
- `aria-pressed` updates；
- selection persistence after renderer replacement；
- deterministic fallback selection；
- inspector refresh。

Domain-specific inspector fields and rendering remain local to each visualizer.

This is a targeted behavior consolidation, not a Tree renderer rewrite.

---

# 20. Viewport and Navigation Stability

Graph uses a bounded scrollable viewport.

If the graph exceeds viewport bounds:

```text
scroll
```

not:

```text
semantic prune
```

The UI layer preserves:

```text
scrollLeft
scrollTop
selected entity
```

when updating to a new raw step where the relevant state remains valid.

Node geometry itself is not stored as UI history; it is recalculated by the deterministic layout from the current model.

All navigation paths must resolve the same raw step to the same runtime evidence:

```text
direct step navigation
Autoplay
Behavioral Timeline
Failure-First inspect
folded / compressed trace navigation
```

Required invariant:

```text
same raw step
→ same RuntimeState
→ same GraphVisualModel
→ same graph geometry
→ same semantic evidence
```

---

# 21. Factual Notices

Graph notices remain factual and separate from the main topology.

Allowed examples:

```text
Topology truncated
Reference target not present in captured topology
Secondary graph component present
```

Cycles are not warnings in Graph v0.1.

Disconnected components are not errors.

Reciprocal edges are not labeled as undirected unless future runtime contracts explicitly establish that semantic.

---

# 22. Accessibility

Selectable graph nodes and connections use accessible controls or equivalent keyboard-focusable semantics.

Requirements include:

- deterministic focusable selection targets；
- useful `aria-label` text；
- `aria-pressed` or equivalent selected-state semantics；
- visible `:focus-visible` treatment；
- status information not encoded only by color；
- pointer labels remain readable when variable names are long。

The existing pointer-label wrapping helper should be reused where applicable.

---

# 23. Failure Handling

Graph-specific failure handling should preserve existing execution status contracts.

## 23.1 Invalid testcase

Malformed adjacency lists return:

```text
input_error
unsupported_testcase_format
```

## 23.2 Unsupported class shape

Objects that do not satisfy strict `Node.neighbors` detection simply do not produce a Graph visual.

This is not an execution error.

## 23.3 Capture truncation

If:

```text
runtime.objectTopology.truncated === true
```

then:

```text
GraphVisualModel.truncated = true
```

and the UI provides a factual truncation notice.

## 23.4 Layout bounds

Layout failure must not fabricate topology or mutate runtime evidence. If force geometry cannot be produced safely for a component, use the defined deterministic fallback layout for that component.

---

# 24. Testing Strategy

Graph v0.1 requires coverage across five layers.

## 24.1 Entrypoint and input tests

Must cover:

- `Node` annotation；
- `Optional[Node]`；
- quoted forward references；
- adjacency list → correct object topology；
- empty graph；
- duplicate neighbor values；
- malformed input；
- out-of-range neighbor indexes；
- public typed entrypoint preference when helper methods coexist。

## 24.2 Graph interpreter tests

Must cover:

- strict detection；
- false-positive rejection；
- directed edge preservation；
- reciprocal edge preservation as two model edges；
- isolated nodes；
- multiple components；
- deterministic component IDs；
- main-component ranking；
- active-frame pointers；
- pointer add / move / remove；
- unresolved references；
- duplicate neighbors deduped in topology but preserved in inspector source sequence；
- neighbor reorder does not produce topology mutation；
- edge add projection；
- edge remove projection；
- node appearance / change states；
- capture truncation propagation。

## 24.3 Layout tests

Must cover:

- same model → same coordinates；
- input ordering does not change output geometry；
- disconnected components laid out independently；
- deterministic component-box ordering；
- finite coordinates；
- bounded small-graph readability / collision tolerance；
- deterministic fallback path。

## 24.4 Visualizer / DOM tests

Must cover:

- compact node rendering；
- pointer badges；
- one-way directional connection；
- reciprocal visual pairing；
- node selection；
- connection selection；
- node inspector contents；
- reciprocal connection inspector exposing both runtime directions；
- persistent selection across update；
- deterministic fallback when selected entity disappears；
- viewport scroll preservation；
- long pointer labels；
- factual notices；
- no diagnostic wording；
- accessibility state updates。

## 24.5 End-to-end navigation and regressions

Must verify Graph rendering through:

- direct raw-step navigation；
- autoplay；
- Behavioral Timeline；
- Failure-First entry；
- folded / compressed trace navigation。

Existing List / Dict / Linked List / Tree regression suites must remain green.

---

# 25. Acceptance Criteria

Graph Visualization v0.1 is complete when all of the following are true:

1. A standard LeetCode Graph problem using `Node.neighbors` can execute from its adjacency-list testcase without manual conversion.
2. Each raw step deterministically reconstructs the captured Graph topology.
3. Directed runtime references remain directed in the model.
4. Reciprocal references may render as one reciprocal connection without losing either underlying runtime edge.
5. Neighbor add/remove mutations are visible as edge-level evidence.
6. Neighbor reorder does not create a false topology mutation.
7. Multiple components and isolated nodes remain visible.
8. Main component selection is deterministic and variable-name agnostic.
9. Active-frame pointers are shown as first-class visual information.
10. Graph layout is deterministic and independent of navigation history.
11. Nodes and connections are selectable and expose runtime metadata through an inspector.
12. Selection and viewport state remain stable across valid step updates.
13. Graph cycles and disconnected components are not misrepresented as errors.
14. No Graph-specific mutation protocol or Graph-specific trace protocol is introduced.
15. Shared component/pointer/inspector code is extracted only where reuse is already demonstrated.
16. Existing visualizer regression tests remain green.

---

# 26. Architectural Decision Summary

Approved decisions for Graph v0.1:

```text
Runtime representation
→ standard LeetCode Node.neighbors only

Input
→ add graph_node ParameterKind
→ adjacency-list testcase builder included in same milestone

Edge semantics
→ directed runtime truth
→ reciprocal visual pairing only in presentation

Components
→ preserve all captured components
→ main by pointer coverage, then size, then lexical ID

Mutation authority
→ existing RuntimeMutation[] only
→ neighbors before/after projected into edge add/remove

Detection
→ strict className === "Node" + reference-only neighbors sequence

Layout
→ stateless deterministic force-directed layout
→ objectId-derived initialization
→ fixed parameters and iteration count

Interaction
→ selectable nodes + selectable connections
→ persistent inspector
→ viewport preservation

Architecture reuse
→ targeted topology helpers
→ targeted inspector consolidation
→ no universal generic topology engine

Product boundary
→ visualize observed runtime graph
→ do not infer graph algorithm intent, correctness, or root cause
```

This design keeps Graph as a first-class runtime visualization while preserving the architecture and product principles already established by Linked List and Tree Visualization.

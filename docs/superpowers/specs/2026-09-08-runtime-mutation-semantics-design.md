# Runtime Mutation Semantics & Behavioral Foundation

## Design Spec v0.1

---

# 1. Goal

LeetYourBrain2Code currently reconstructs runtime state at every captured trace step and derives two low-level diff models:

```text
FrameDiff
ObjectDiff
```

Those models are sufficient for direct highlighting, but they expose storage-oriented differences rather than a stable semantic description of what changed in the observable execution state.

The next architecture layer introduces a typed runtime-change intermediate representation:

```text
TraceEvent
    ↓
RuntimeState
    ↓
FrameDiff + ObjectDiff
    ↓
RuntimeMutation[]
    ↓
Visual interpretation / generic change UI / future behavior analysis
```

The first version has one narrow objective:

> Convert existing raw runtime diffs into deterministic, structure-neutral semantic mutation events that can be consumed consistently by current and future visualizers.

This is a foundation milestone. It does **not** yet implement no-progress detection, repeated-state detection, loop-pattern compression, hot-line analysis, or cross-revision trace comparison.

---

# 2. Product Principle

The project keeps its existing core principle:

> Visualize what the program actually did.

For this spec, “mutation” has a deliberately restricted meaning:

> A `RuntimeMutation` is a semantic description of an observed difference between consecutive reconstructable runtime states.

It is **not** proof that a specific Python statement, bytecode instruction, method call, or source line directly caused that change.

This distinction matters because the tracer currently uses line-level debugger semantics:

```text
line event = this source line is about to execute
```

Therefore a change observed at trace step `t` cannot safely be labeled as “caused by `currentLine_t`”.

The first version may display:

```text
Observed change
curr: obj-2 → obj-3
```

but must not claim:

```text
line 8 moved curr from obj-2 to obj-3
```

unless a future tracing design provides explicit causal attribution.

---

# 3. Why This Layer Now

Linked-list visualization introduced reusable runtime infrastructure:

- session-local object identity;
- normalized object topology;
- `ObjectDiff`;
- structure-specific interpretation;
- generic visual-candidate selection;
- static visualizer dispatch.

The current architecture now contains three different consumers of change information:

```text
List / Dict visual models
    consume FrameDiff

Linked List interpreter
    consumes FrameDiff + ObjectDiff

TraceVisualizer State Changes panel
    consumes FrameDiff directly
```

This creates duplicated interpretation logic.

Examples:

```text
FrameDiff variable changed between two references
    → Linked List interprets pointer movement

ObjectDiff .next changed between two references
    → Linked List interprets edge redirection

FrameDiff list index changed
    → List visualizer interprets changed index

FrameDiff dict entry changed
    → Dict visualizer interprets entry status
```

The raw diff models should remain responsible for comparison mechanics. A new semantic layer should become responsible for translating those comparison results into reusable runtime-change meaning.

---

# 4. Scope

This spec includes:

1. a typed `RuntimeMutation` union;
2. normalization from `FrameDiff` and `ObjectDiff`;
3. explicit reference-binding semantics;
4. sequence element changes;
5. mapping entry changes;
6. set membership changes;
7. ordinary variable value changes;
8. ordinary object attribute changes;
9. object visibility changes within captured topology;
10. initial-observation versus transition semantics;
11. deterministic mutation ordering;
12. mutation batches aligned one-to-one with reconstructed runtime steps;
13. migration of current List / Dict / Linked List change highlighting to consume mutation events;
14. migration of visual-candidate mutation relevance to consume mutation events;
15. a generic `What Changed` UI backed by mutation events;
16. retention of raw diffs as lower-level interpretation/debugging outputs;
17. tests for normalization, downstream interpretation, ordering, and UI rendering;
18. an extension boundary for later behavioral analysis.

---

# 5. Explicit Non-Goals

This spec does **not** implement:

- no-progress detection;
- repeated-state detection;
- infinite-loop diagnosis;
- hot-line detection;
- loop iteration reconstruction;
- mutation-pattern compression;
- trace compression;
- source-line causal attribution;
- expression-level tracing;
- bytecode-level tracing;
- cross-live-revision state or object matching;
- revision-to-revision trace diff;
- algorithm-intent inference;
- LeetCode problem classification;
- Tree visualization;
- Graph visualization;
- DP-table visualization;
- AI explanation, correction, or solution generation;
- a new worker protocol or trace schema version;
- a backend or persistent mutation store.

The implementation must derive the new layer entirely from the existing reconstructed state and diff pipeline.

---

# 6. Existing Baseline

Current trace interpretation is effectively:

```text
TraceEvent[]
    ↓
reconstructStates()
    ↓
RuntimeState[]
    ↓
┌─────────────────────┐
│ diffFrameState()    │
│ diffObjectTopology()│
└─────────────────────┘
    ↓
FrameDiff[] + ObjectDiff[]
    ↓
buildVisualState()
```

`FrameDiff` currently contains:

```ts
interface FrameDiff {
  frameId: number;
  variables: VariableDiff[];
  containerChanges: ContainerDiff[];
}
```

and `ContainerDiff` distinguishes:

```text
list / tuple
dict
set
```

`ObjectDiff` currently contains:

```ts
interface ObjectDiff {
  addedObjectIds: ObjectId[];
  removedObjectIds: ObjectId[];
  attributeChanges: ObjectAttributeDiff[];
}
```

Those types remain valid low-level comparison outputs.

The new mutation layer is added above them rather than replacing the diff algorithms themselves.

---

# 7. Architecture Direction

The target flow becomes:

```text
TraceEvent[]
    ↓
RuntimeState[]
    ↓
FrameDiff[] + ObjectDiff[]
    ↓
normalizeRuntimeMutations()
    ↓
RuntimeMutationBatch[]
    ↓
┌───────────────────────────────┐
│ Visual model interpretation   │
│ Visual candidate relevance    │
│ Generic What Changed UI       │
│ Future behavioral analyzers   │
└───────────────────────────────┘
```

The responsibility split is:

```text
Diff layer
    = what values differ?

Mutation layer
    = what kind of observable runtime change is this?

Structure interpreter
    = what does this change mean for a linked list / tree / graph / etc.?

Behavior analyzer (future)
    = what temporal pattern emerges across many changes or states?
```

These layers must not collapse into one another.

---

# 8. RuntimeMutation Contract

Create a new core contract, conceptually in:

```text
src/core/runtime-mutation.ts
```

The first version uses the following union:

```ts
export type MutationOrigin = "initial_snapshot" | "transition";

export type RuntimeMutation =
  | VariableMutation
  | ReferenceMutation
  | SequenceElementMutation
  | MappingEntryMutation
  | SetMembershipMutation
  | ObjectAttributeMutation
  | ObjectVisibilityMutation;
```

All variants must carry enough information for deterministic rendering and future behavior analysis without requiring the consumer to re-read the original raw diff.

No mutation receives a `causedByLine` field.

---

# 9. Mutation Origin

A reconstructed frame may appear for the first time because:

- execution just started;
- a function was called;
- a previously unseen frame became active.

In those cases, `diffFrameState(undefined, current)` reports locals as added.

Those are not necessarily mutations that occurred between two observed states of the same frame. They are initial observations.

Therefore every mutation carries:

```ts
origin: "initial_snapshot" | "transition"
```

Rules:

```text
previous state for the same frame absent
    → initial_snapshot

previous state for the same frame present
    → transition
```

For object-topology visibility:

```text
first captured trace step
    → appeared objects are initial_snapshot

later step
    → appeared/disappeared objects are transition
```

Future behavioral detectors must be able to ignore `initial_snapshot` events by default.

---

# 10. VariableMutation

Ordinary local-variable value changes use:

```ts
export interface VariableMutation {
  kind: "variable";
  origin: MutationOrigin;
  frameId: number;
  variableName: string;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}
```

Examples:

```text
left: 2 → 3
count: + 0
answer: removed
```

Reference-only changes are normalized into `ReferenceMutation` instead.

Container changes with a granular `ContainerDiff` are handled specially to avoid duplicate semantic events; see Section 17.

---

# 11. ReferenceMutation

References deserve a generic semantic type because pointer movement is useful beyond Linked Lists.

```ts
export type ReferenceOwner =
  | {
      scope: "local";
      frameId: number;
      variableName: string;
    }
  | {
      scope: "object_attribute";
      objectId: ObjectId;
      attribute: string;
    };

export interface ReferenceMutation {
  kind: "reference";
  origin: MutationOrigin;
  owner: ReferenceOwner;
  action: "bound" | "unbound" | "redirected";
  beforeObjectId: ObjectId | null;
  afterObjectId: ObjectId | null;
}
```

Normalization rules:

```text
absent → reference(obj-1)
None   → reference(obj-1)
    = bound

reference(obj-1) → absent
reference(obj-1) → None
    = unbound

reference(obj-1) → reference(obj-2)
    = redirected
```

A transition such as:

```text
reference(obj-1) → int(3)
```

is not reduced to `unbound`, because that would discard the replacement value. It remains an ordinary `VariableMutation` or `ObjectAttributeMutation`.

Likewise:

```text
absent → None
```

is not a reference mutation because no object reference is involved.

This keeps reference semantics factual and lossless.

---

# 12. SequenceElementMutation

List and tuple structural differences normalize to:

```ts
export interface SequenceElementMutation {
  kind: "sequence_element";
  origin: MutationOrigin;
  frameId: number;
  containerName: string;
  containerKind: "list" | "tuple";
  index: number;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}
```

The type deliberately says `element change`, not `write` or `in-place mutation`.

For example, a tuple value may change because the variable was rebound to a new tuple. The existing line-level trace cannot prove which Python operation caused the state difference.

---

# 13. MappingEntryMutation

Dict changes normalize to:

```ts
export interface MappingEntryMutation {
  kind: "mapping_entry";
  origin: MutationOrigin;
  frameId: number;
  containerName: string;
  key: ValueSnapshot;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}
```

Keys and values must be cloned from the raw diff so downstream consumers do not depend on mutable input objects.

---

# 14. SetMembershipMutation

Set changes normalize to:

```ts
export interface SetMembershipMutation {
  kind: "set_membership";
  origin: MutationOrigin;
  frameId: number;
  containerName: string;
  action: "added" | "removed";
  member: ValueSnapshot;
}
```

This expresses only observable membership changes.

It does not infer whether the source operation was `.add()`, `.remove()`, set union, reassignment, or another operation.

---

# 15. ObjectAttributeMutation

Non-reference user-object attribute changes normalize to:

```ts
export interface ObjectAttributeMutation {
  kind: "object_attribute";
  origin: MutationOrigin;
  objectId: ObjectId;
  attribute: string;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}
```

Examples:

```text
obj-7.val: 3 → 4
obj-2.color: "white" → "gray"
```

Reference-to-reference / reference-to-None / None-to-reference attribute changes become `ReferenceMutation` with:

```text
owner.scope = "object_attribute"
```

This means `.next`, `.left`, `.right`, `.parent`, and future graph-like references can reuse the same generic reference semantics without the mutation layer knowing which structure they belong to.

---

# 16. ObjectVisibilityMutation

The current object collector captures only objects reachable from configured observable roots within capture bounds.

Therefore `ObjectDiff.addedObjectIds` and `removedObjectIds` must **not** be described as object allocation and deallocation.

They normalize to visibility semantics:

```ts
export interface ObjectVisibilityMutation {
  kind: "object_visibility";
  origin: MutationOrigin;
  objectId: ObjectId;
  action: "appeared" | "disappeared";
}
```

Interpretation:

```text
appeared
    = this object became present in the captured observable topology

disappeared
    = this object is no longer present in the captured observable topology
```

It does not mean:

```text
Python allocated the object
Python garbage-collected the object
```

Structure interpreters may derive stronger structure-relative meaning when justified. For example, a Linked List interpreter may identify a component as detached from observed list roots, but that interpretation does not belong in the generic mutation layer.

---

# 17. Duplicate-Suppression Rules

`FrameDiff` intentionally contains both coarse variable differences and granular container differences.

Example:

```python
nums = [1, 2, 3]
# later observable state
nums = [1, 9, 3]
```

The raw diff may contain both:

```text
VariableDiff
nums changed

ContainerDiff
nums[1] changed 2 → 9
```

The mutation layer must not emit both a coarse `VariableMutation` and a granular `SequenceElementMutation` for the same same-kind container transition.

Rules:

1. If a changed local has a matching granular `ContainerDiff`, suppress the coarse `VariableMutation`.
2. Emit the granular sequence / mapping / set mutations instead.
3. If the variable changes type or no granular container diff exists, emit the ordinary `VariableMutation`.
4. Added and removed container locals remain ordinary variable additions/removals in v0.1 because no prior/current granular structural comparison exists.
5. `unchanged` raw variable diffs never produce mutation events.

This ensures the semantic layer expresses the most specific observable difference available without duplicating it.

---

# 18. Normalization API

Create a dedicated normalizer, conceptually:

```text
src/core/runtime-mutation-normalizer.ts
```

Primary API:

```ts
export function normalizeRuntimeMutations(input: {
  frameDiff: FrameDiff | null;
  objectDiff: ObjectDiff;
  frameOrigin: "initial_snapshot" | "transition";
  objectOrigin: "initial_snapshot" | "transition";
}): RuntimeMutation[];
```

The normalizer:

- receives only existing raw diff products plus explicit origin metadata;
- does not inspect LeetCode title or problem number;
- does not inspect source code AST;
- does not infer algorithm type;
- does not scan `RuntimeState` to rediscover differences already present in raw diffs;
- clones snapshots used by emitted events;
- returns deterministically ordered events.

The normalizer is a pure core function.

---

# 19. Mutation Batch

`interpretTrace()` should expose mutation events aligned with runtime steps.

Conceptual contract:

```ts
export interface RuntimeMutationBatch {
  step: number;
  frameId: number | null;
  currentLine: number | null;
  mutations: RuntimeMutation[];
}
```

`currentLine` is observation context only.

It must never be interpreted as a causal line.

`TraceInterpretation` becomes conceptually:

```ts
export interface TraceInterpretation {
  runtimeStates: RuntimeState[];
  frameDiffs: Array<FrameDiff | null>;
  objectDiffs: ObjectDiff[];
  mutationBatches: RuntimeMutationBatch[];
  visualStates: VisualState[];
}
```

Required invariant:

```text
runtimeStates.length
= frameDiffs.length
= objectDiffs.length
= mutationBatches.length
= visualStates.length
```

for every interpreted trace.

---

# 20. Frame Origin Tracking

The current interpreter already keeps:

```ts
previousFrameStates: Map<number, FrameState>
```

Before calling `diffFrameState()`, it can determine whether the active frame has been observed before.

Conceptually:

```text
previousFrameStates.has(frameId)
    ? transition
    : initial_snapshot
```

The origin must be captured before the map is updated.

This is preferable to making the normalizer guess origin from diff contents.

---

# 21. Object Origin Tracking

For object topology:

```text
step index = 0
    → objectOrigin = initial_snapshot

step index > 0
    → objectOrigin = transition
```

This does not assert that every object visible at later steps was newly allocated. It only controls whether an `appeared` / `disappeared` observation is part of the initial captured topology or a later topology transition.

---

# 22. Deterministic Ordering

Mutation ordering must be deterministic so:

- tests remain stable;
- UI rows do not jump nondeterministically;
- future behavior analyzers receive reproducible event sequences.

Canonical category order:

```text
1. local reference changes
2. ordinary variable changes
3. sequence element changes
4. mapping entry changes
5. set membership changes
6. object visibility changes
7. object-attribute reference changes
8. ordinary object attribute changes
```

Within each category:

```text
locals
    → frameId, variableName

sequence
    → frameId, containerName, index

mapping
    → frameId, containerName, valueSnapshotKey(key)

set
    → frameId, containerName, valueSnapshotKey(member)

object visibility
    → objectId

object attributes
    → objectId, attribute
```

The exact sorting helper should live with the normalizer rather than in UI code.

Consumers must not re-sort mutation events unless they are intentionally creating a different presentation.

---

# 23. Structure-Neutral Boundary

The mutation layer may understand generic runtime concepts:

```text
local variable
container element
mapping entry
set membership
object reference
object attribute
captured object visibility
```

It must not emit structure-specific concepts such as:

```text
linked-list node
head pointer
tail pointer
linked-list edge
detached linked-list component
tree parent / child
graph edge
BFS frontier
sliding window
DP dependency
```

For example:

```text
obj-2.next: obj-3 → obj-1
```

is represented generically as:

```text
ReferenceMutation
owner = object_attribute(obj-2, "next")
action = redirected
beforeObjectId = obj-3
afterObjectId = obj-1
```

The Linked List interpreter may then interpret that mutation as a changed `next` edge.

A future Tree interpreter may interpret:

```text
obj-1.left: None → obj-4
```

as a child-edge addition.

The generic mutation layer does neither.

---

# 24. Migrate Linked List Interpretation

The current Linked List interpreter derives pointer and edge status directly from `FrameDiff` and `ObjectDiff`.

After this milestone, change-status interpretation should consume `RuntimeMutation[]` instead.

Target conceptual API:

```ts
buildLinkedListVisuals(
  runtime: RuntimeState,
  mutations: RuntimeMutation[]
): LinkedListVisualModel[]
```

The interpreter may continue to inspect current `RuntimeState.objectTopology` to build structure shape.

Mutation consumption should cover:

```text
local ReferenceMutation
    → pointer added / removed / moved

object-attribute ReferenceMutation where attribute = "next"
    → nextStatus added / removed / changed

ObjectVisibilityMutation appeared
    → candidate node added status where relevant

ObjectAttributeMutation on candidate object
    → node changed status
```

Structure-specific derivations such as:

```text
detached component
cycle
entry roots
```

remain inside `linked-list-interpreter.ts` because they require topology semantics.

The goal is to remove duplicate low-level diff interpretation, not to move Linked List semantics into the mutation normalizer.

---

# 25. Migrate List and Dict Change Highlighting

Current List and Dict visual-model builders read `FrameDiff` directly.

They should consume mutations instead.

List:

```text
SequenceElementMutation
containerName = visual variable
    → changedIndexes
```

Dict:

```text
MappingEntryMutation
containerName = visual variable
    → entry added / changed status
```

Removed dict entries remain absent from the current-state visual model, as today; their removal is shown in `What Changed` rather than rendered as a persistent current entry.

AST-derived probe semantics remain unchanged because they answer a different question:

```text
What key is the current source expression probing?
```

That is not mutation semantics.

---

# 26. Migrate Visual Candidate Mutation Relevance

Current visual-candidate priority determines whether a visual is “mutated” by inspecting raw frame/object diffs.

This should move to mutation events.

Examples:

```text
List visual
    relevant SequenceElementMutation for its variable

Dict visual
    relevant MappingEntryMutation for its variable

Linked List visual
    relevant ReferenceMutation / ObjectAttributeMutation /
    ObjectVisibilityMutation touching one of its candidate objects or pointers
```

This makes mutation relevance a stable downstream contract for future Tree and Graph visualizers.

The candidate resolver itself remains generic and unchanged; only candidate construction changes.

---

# 27. VisualState Contract

`VisualState` should expose the normalized events:

```ts
export interface VisualState {
  // existing fields
  mutations: RuntimeMutation[];
}
```

The first implementation should stop using `stateChanges` / `objectChanges` as Side Panel presentation inputs.

Raw `FrameDiff` and `ObjectDiff` remain available on `TraceInterpretation` for:

- focused low-level tests;
- debugging;
- future internal consumers that genuinely need comparison mechanics.

Whether `VisualState.stateChanges` and `VisualState.objectChanges` are removed immediately or retained temporarily for compatibility is an implementation-plan decision, but no new UI or structure semantics should depend on them after migration.

The intended steady state is:

```text
raw diffs
    = core comparison implementation detail

RuntimeMutation[]
    = downstream semantic change contract
```

---

# 28. Generic `What Changed` UI

The Side Panel currently has a `State Changes` panel that renders changed and unchanged variables plus container details directly from `FrameDiff`.

Replace its presentation source with `RuntimeMutation[]` and rename the panel:

```text
What Changed
```

The first version should emphasize changes only.

Do not reproduce the existing large `Unchanged` group; current values are already available in `Locals` and structure visualizers.

Examples:

```text
left
2 → 3

nums[4]
7 → 9

seen
+ 12

head
obj-1 → obj-2

obj-2.next
obj-3 → obj-1

obj-7.val
3 → 4
```

For object visibility:

```text
obj-4
appeared in captured topology
```

or:

```text
obj-4
disappeared from captured topology
```

Do not label those rows as allocation / deallocation.

---

# 29. Initial Observation Presentation

Initial snapshot events should not visually imply an executed mutation.

When a displayed step contains only `initial_snapshot` events, the panel may label the section:

```text
Initial observations
```

When transition and initial-snapshot events coexist, rows should carry a subtle initial-observation marker rather than creating a second major panel.

Exact CSS styling is implementation detail, but semantic distinction is required.

The first version does not need complex grouping by mutation category.

---

# 30. Reference Presentation

The generic change UI must remain structure-neutral.

It may display session-local object references using existing opaque IDs:

```text
obj-1
obj-2
```

It must not replace them with inferred labels such as:

```text
node 1
head node
left child
```

Those labels belong to structure-specific visualizers.

A later UX improvement may allow visualizers to cross-highlight a generic object reference, but that is outside this spec.

---

# 31. Failure / Timeout Compatibility

The mutation layer operates only on captured trace prefixes.

For:

```text
runtime_error
trace_limit
timeout
```

all mutations derivable from captured states must remain available.

No behavior changes are required in worker termination or trace-prefix preservation.

The final captured mutation batch may be incomplete relative to an operation that never yielded another observable trace event. The UI must not invent missing changes.

---

# 32. Truncated Object Topology

Existing object topology may be marked truncated because capture limits were reached.

Mutation normalization still processes the available `ObjectDiff` exactly as captured.

It must not attempt to reconstruct missing objects or references.

A `disappeared` object in a truncated topology means only:

```text
not present in this captured topology snapshot
```

Structure-specific visualizers already carry truncation state where relevant and remain responsible for warning users that topology is partial.

---

# 33. Performance Requirements

Mutation normalization must be proportional to the existing diff size, not total runtime-state size.

Desired complexity per trace step:

```text
O(
  variable diffs
  + container element/entry/member diffs
  + object visibility diffs
  + object attribute diffs
)
```

The normalizer must not:

- re-scan every local container to rediscover element changes;
- traverse the object topology;
- inspect the whole trace history;
- compare arbitrary previous states itself.

Those responsibilities already belong elsewhere.

No new worker-side capture cost is introduced by this milestone.

---

# 34. Future Behavioral Analysis Boundary

This spec intentionally stops before behavioral diagnosis, but the mutation representation must support the next layer.

Future flow:

```text
RuntimeMutationBatch[]
        +
RuntimeState fingerprints / trace control context
        ↓
BehavioralSignal[]
```

Potential later signals include:

```text
no_progress
repeated_state
repeated_mutation_pattern
reference_walk
hot_line
trace_segment_summary
```

The future analyzer must not require structure visualizers to reconstruct generic mutations from visual models.

That is the architectural reason this layer exists now.

---

# 35. Example: Binary Search State Change

Observed states:

```text
before
left = 2
mid = 3
right = 5

after
left = 3
mid = 3
right = 5
```

Raw diff:

```text
VariableDiff(left, changed, 2, 3)
VariableDiff(mid, unchanged, 3, 3)
VariableDiff(right, unchanged, 5, 5)
```

Normalized mutation:

```text
RuntimeMutation[]
  VariableMutation
    variableName: left
    action: changed
    before: 2
    after: 3
```

No events are emitted for `mid` or `right`.

A future no-progress detector can compare later state/mutation sequences, but this milestone makes no diagnosis.

---

# 36. Example: List Change

Observed states:

```text
nums = [1, 2, 3]
nums = [1, 9, 3]
```

Raw diff may contain:

```text
VariableDiff(nums, changed)
ContainerDiff(nums, list)
  index 1: 2 → 9
```

Normalized result:

```text
SequenceElementMutation
  containerName: nums
  containerKind: list
  index: 1
  action: changed
  before: 2
  after: 9
```

No duplicate coarse `VariableMutation(nums changed)` is emitted.

---

# 37. Example: Linked List Reverse Step

Observed reference differences:

```text
curr
obj-2 → obj-3

obj-2.next
obj-3 → obj-1
```

Normalized mutations:

```text
ReferenceMutation
  owner:
    scope: local
    variableName: curr
  action: redirected
  beforeObjectId: obj-2
  afterObjectId: obj-3

ReferenceMutation
  owner:
    scope: object_attribute
    objectId: obj-2
    attribute: next
  action: redirected
  beforeObjectId: obj-3
  afterObjectId: obj-1
```

Generic UI can display those facts.

Linked List interpretation can additionally derive:

```text
curr pointer moved
next edge changed
component detached / connected
cycle state
```

when justified by current topology.

---

# 38. Example: Reference to Scalar

Observed change:

```text
x = reference(obj-1)
→
x = 5
```

Do **not** emit only:

```text
ReferenceMutation(unbound obj-1)
```

because that discards the new scalar value.

Emit:

```text
VariableMutation
  variableName: x
  action: changed
  before: reference(obj-1)
  after: 5
```

The semantic IR must preserve the complete observable state transition.

---

# 39. Example: Object Visibility

Suppose `obj-7` is no longer reachable from the configured topology capture roots at the next observable step.

Raw diff:

```text
removedObjectIds = ["obj-7"]
```

Normalized event:

```text
ObjectVisibilityMutation
  objectId: obj-7
  action: disappeared
```

The mutation layer must not say:

```text
obj-7 was deleted
obj-7 was freed
obj-7 was garbage-collected
```

because the trace does not establish any of those claims.

---

# 40. File-Level Architecture

Expected implementation surface:

## Core

Create:

```text
src/core/runtime-mutation.ts
src/core/runtime-mutation-normalizer.ts
```

Modify:

```text
src/core/trace-interpreter.ts
src/core/visual-model.ts
src/core/linked-list-interpreter.ts
```

`state-diff.ts` and `object-diff.ts` should remain focused on raw comparison mechanics and require little or no semantic expansion.

## Side Panel

Modify:

```text
src/sidepanel/components/TraceVisualizer.ts
```

Potentially create a focused renderer/formatter if the mutation UI would otherwise make `TraceVisualizer.ts` materially larger:

```text
src/sidepanel/components/MutationList.ts
```

This extraction is preferred if it keeps mutation rendering independently testable and prevents `TraceVisualizer.ts` from accumulating another unrelated rendering responsibility.

## Tests

Create:

```text
tests/core/runtime-mutation-normalizer.test.ts
```

Modify:

```text
tests/core/trace-interpreter.test.ts
tests/core/visual-model.test.ts
tests/core/linked-list-interpreter.test.ts
tests/sidepanel/trace-visualizer.test.ts
```

If `MutationList.ts` is created, add:

```text
tests/sidepanel/mutation-list.test.ts
```

---

# 41. Testing Strategy

## Normalizer unit tests

Must cover:

1. scalar variable added / removed / changed;
2. unchanged variable emits nothing;
3. local reference bound;
4. local reference unbound;
5. local reference redirected;
6. reference → scalar remains ordinary variable mutation;
7. sequence element added / removed / changed;
8. tuple element change uses factual sequence semantics;
9. coarse container variable diff is suppressed when granular diff exists;
10. dict entry added / removed / changed;
11. set member added / removed;
12. object attribute scalar added / removed / changed;
13. object-attribute reference bound / unbound / redirected;
14. object appeared / disappeared visibility semantics;
15. snapshots are cloned;
16. output ordering is deterministic;
17. initial versus transition origin is preserved.

## Trace interpreter tests

Verify:

```text
mutationBatches.length === runtimeStates.length
```

and that frame origin is correctly tracked per frame rather than globally.

A recursive or nested-call trace should confirm that the first observation of each frame is marked `initial_snapshot`, while later observations of the same frame are `transition`.

## Visual-model tests

Verify current visual behavior is preserved after migration:

- List changed indexes still highlight correctly;
- Dict added/changed entry statuses remain correct;
- Linked List pointer movement remains correct;
- Linked List `next` edge mutation remains correct;
- visual candidate ordering still prioritizes mutated relevant visuals.

## Side-panel tests

Verify:

- panel title is `What Changed`;
- unchanged variables are not rendered as change rows;
- scalar, sequence, mapping, set, reference, attribute, and visibility events render readably;
- initial observations are distinguished from transitions;
- empty mutation batch renders a neutral empty state;
- object visibility copy does not say allocated/deleted/freed;
- no source line is described as the cause of a mutation.

---

# 42. Regression Requirements

The milestone must not regress:

- live editor synchronization;
- latest-wins live scheduler behavior;
- active-tab ownership;
- selected testcase handling;
- Pyodide execution;
- line-level trace semantics;
- timeout trace prefix preservation;
- runtime-error trace prefix preservation;
- List visualization;
- Dict visualization;
- Linked List visualization;
- linked-list cycle-safe rendering;
- disconnected linked-list fragments;
- visual candidate cap and ordering;
- static visualizer registry dispatch;
- Locals panel;
- Call Stack panel;
- stdout / exception display.

Final implementation verification must include:

```bash
npm test
npm run typecheck
npm run build
```

---

# 43. Alternatives Considered

## Alternative A: Keep consuming raw diffs everywhere

```text
FrameDiff / ObjectDiff
    → each visualizer interprets independently
```

Advantages:

- smallest immediate code change;
- no new abstraction.

Disadvantages:

- duplicates reference semantics;
- makes Tree / Graph add more duplicated diff interpretation;
- generic UI remains tied to low-level diff shapes;
- future behavior analysis has no structure-neutral event stream.

Rejected because the architecture has already reached the point where the same raw changes are interpreted in multiple places.

## Alternative B: Add mutation semantics separately inside each structure interpreter

```text
ListMutation
DictMutation
LinkedListMutation
TreeMutation
...
```

Advantages:

- structure-specific names are easy to render;
- interpreters can optimize for their own UI.

Disadvantages:

- loses a common behavioral-analysis substrate;
- reference movement gets reimplemented repeatedly;
- generic state-change UI still needs another representation;
- encourages algorithm/structure semantics to leak downward.

Rejected because common runtime concepts should be normalized once.

## Alternative C: Generic semantic mutation IR above raw diffs

```text
FrameDiff + ObjectDiff
    ↓
RuntimeMutation[]
    ↓
structure interpreters + generic UI + future behavior layer
```

Advantages:

- preserves low-level diff responsibilities;
- centralizes generic runtime semantics;
- reduces duplicate downstream interpretation;
- supports current List / Dict / Linked List consumers;
- creates a clean input for later behavioral analysis;
- remains independent of LeetCode problem intent.

Chosen approach.

---

# 44. Acceptance Criteria

This design is complete when an implementation can satisfy all of the following:

1. Every interpreted trace step has a deterministic `RuntimeMutationBatch`.
2. Mutation normalization derives only from existing raw diffs and explicit origin metadata.
3. No mutation claims a source line caused the observed change.
4. Unchanged variables produce no mutation events.
5. Same-kind container changes prefer granular events over duplicate coarse variable changes.
6. Reference binding / unbinding / redirection is represented generically for locals and object attributes.
7. Object appearance/disappearance is described as capture visibility, not allocation/deallocation.
8. List, Dict, and Linked List change highlighting consume the mutation layer rather than independently decoding equivalent raw diffs.
9. Visual-candidate mutation relevance consumes the mutation layer.
10. The Side Panel `What Changed` UI renders normalized mutation events and does not render a redundant unchanged-variable group.
11. Initial observations are distinguishable from true observed transitions.
12. Raw `FrameDiff` and `ObjectDiff` remain available as lower-level interpretation outputs.
13. No worker protocol / trace schema change is required.
14. Failure, timeout, and trace-limit prefixes remain visualizable using only captured mutations.
15. Full test, typecheck, and build suites pass.

---

# 45. Follow-Up Boundary

After this spec is implemented and validated, the next design should operate **above** this layer rather than adding more semantics into it.

Recommended next milestone:

```text
Behavioral Signals v0.1
```

focused on a small set such as:

```text
repeated observable state
no-progress loop state
repeated mutation pattern
```

That future design should consume:

```text
RuntimeState[]
RuntimeMutationBatch[]
trace control context
```

and produce a separate typed model such as:

```text
BehavioralSignal[]
```

The mutation layer must remain a factual semantic transition layer even after behavioral analysis is added.

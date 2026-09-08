# Behavioral Debugging Foundation

## Design Spec v0.1

---

# 1. Goal

LeetYourBrain2Code currently has a deterministic runtime pipeline that can answer:

> What observable state changed at this trace step?

The current architecture already reconstructs runtime state, computes low-level diffs, normalizes those diffs into typed semantic mutations, and feeds those mutations into visual models and the `What Changed` UI:

```text
TraceEvent[]
    ↓
RuntimeState[]
    ↓
FrameDiff[] + ObjectDiff[]
    ↓
RuntimeMutationBatch[]
    ↓
Visual interpretation / candidate ranking / What Changed
```

The next milestone introduces a structure-neutral behavioral analysis layer that can answer a narrower but more useful debugging question:

> What repeated execution behavior is objectively observable in the captured trace?

The target architecture becomes:

```text
TraceEvent[]
    ↓
RuntimeState[]
    ↓
FrameDiff[] + ObjectDiff[]
    ↓
RuntimeMutationBatch[]
    ↓
BehavioralObservation[]
    ↓
BehavioralPattern[]
    ↓
Behavioral Signals UI
    ↓
Future failure analysis / trace compression / revision comparison
```

The first version is deliberately conservative. It detects factual repetition and lack of observable progress, but it does **not** diagnose an infinite loop, TLE, algorithmic bug, wrong answer, or causal source line.

This milestone also includes several targeted foundation fixes discovered while reviewing the current repository:

1. object-topology capture must traverse bounded built-in containers instead of treating them as traversal dead ends;
2. tracked Python bytecode caches must be removed and ignored;
3. the repository must gain a minimal CI workflow for the existing test/typecheck/build gates;
4. README architecture and project-document links must be synchronized with the current implementation.

These are required parts of this milestone, not optional cleanup.

---

# 2. Product Principle

The project keeps its existing core principle:

> **Visualize what the program actually did.**

The behavioral layer extends that principle with a second rule:

> **Describe only behavior that can be supported by captured runtime evidence.**

Therefore the first version may say:

```text
Repeated state × 5
The execution revisited the same observable state at the same location.
```

or:

```text
No observable progress across 4 revisits.
```

but it must not say:

```text
Infinite loop detected.
```

or:

```text
Line 8 caused the loop.
```

or:

```text
Change left = mid + 1 to fix this.
```

The behavioral layer is evidence, not diagnosis and not solution generation.

---

# 3. Why This Layer Now

The current implementation already has the necessary runtime substrate:

- live LeetCode editor synchronization;
- active-tab ownership;
- debounced latest-wins execution;
- bundled Pyodide worker execution;
- line-level trace capture;
- runtime-state reconstruction;
- scalar/container diffing;
- session-local object identity;
- bounded object topology;
- object topology diffing;
- normalized `RuntimeMutation` semantics;
- List / Dict / Linked List visual models;
- mutation-driven visual candidate ranking;
- a generic `What Changed` panel.

This means the next useful abstraction is no longer another structure renderer.

Adding Tree / Graph / DP immediately would increase visualization coverage, but would not substantially change the product's debugging model. The stronger product direction is to turn the existing deterministic trace into reusable behavioral evidence first.

Conceptually:

```text
state visualization
    = what exists now?

mutation semantics
    = what changed between observations?

behavioral patterns
    = what execution behavior is repeating across observations?
```

The behavioral layer should become a reusable boundary for later:

```text
Failure-first debugging
Trace compression
Timeout-prefix explanation
Hot-path / hot-line evidence
Revision-to-revision behavioral diff
```

without embedding any of those higher-level features into this milestone.

---

# 4. Scope

This spec includes:

1. a normalized `BehavioralObservation` representation derived from existing trace interpretation outputs;
2. deterministic execution-location keys;
3. exact observable-state fingerprints with completeness metadata;
4. exact-equality verification for repeated-state evidence;
5. normalized transition-shape fingerprints derived from runtime mutations plus execution location;
6. `RepeatedStatePattern`;
7. `NoProgressPattern`;
8. `RepeatedTransitionPattern`;
9. bounded repeated-pattern analysis;
10. pattern evidence ranges and repeat counts;
11. pattern-to-step association for UI presentation;
12. a minimal `Behavioral Signals` UI surface;
13. analysis of captured prefixes from completed, errored, trace-limited, and timeout executions when a usable prefix exists;
14. preservation of raw trace, raw diffs, and `RuntimeMutation[]` as lower-level evidence;
15. container-reachable object-topology traversal;
16. topology traversal bounds and safety rules;
17. removal and ignoring of Python bytecode cache artifacts;
18. a minimal GitHub Actions CI workflow;
19. README architecture synchronization in English and Traditional Chinese;
20. tests covering behavioral analysis, topology reachability, UI presentation, and compatibility with current visualizers.

---

# 5. Explicit Non-Goals

This spec does **not** implement:

- automatic infinite-loop diagnosis;
- LeetCode TLE diagnosis;
- correctness judgment;
- WA diagnosis;
- algorithm-intent inference;
- bug fixing or code suggestions;
- AI explanation, correction, or solution generation;
- source-line causal attribution;
- expression-level tracing;
- bytecode-level tracing;
- hot-line scoring;
- CPU profiling;
- complexity analysis;
- actual trace folding or collapsed-step playback;
- automatic skipping of repeated trace segments;
- cross-live-revision state matching;
- cross-execution object identity;
- revision-to-revision trace diff;
- Tree visualization;
- Graph visualization;
- DP-table visualization;
- Stack / Queue / Heap dedicated visualizers;
- a backend;
- persistent behavioral-pattern storage;
- a new trace schema version solely for behavioral analysis;
- worker-side behavioral detection;
- branch-protection policy or release automation.

The first version creates behavioral evidence that later features can consume.

---

# 6. Existing Baseline

The current core interpretation is effectively:

```text
TraceEvent[]
    ↓
reconstructStates()
    ↓
RuntimeState[]
    ↓
┌────────────────────────┐
│ diffFrameState()       │
│ diffObjectTopology()   │
└────────────────────────┘
    ↓
FrameDiff[] + ObjectDiff[]
    ↓
normalizeRuntimeMutations()
    ↓
RuntimeMutationBatch[]
    ↓
buildVisualState()
```

`RuntimeMutation` already distinguishes semantic runtime changes such as:

```text
variable
reference
sequence_element
mapping_entry
set_membership
object_attribute
object_visibility
```

This milestone must consume that layer rather than re-decoding raw diffs independently.

`FrameDiff` and `ObjectDiff` remain valid lower-level outputs and are retained for compatibility and debugging.

---

# 7. Target Architecture

The target core flow is:

```text
TraceEvent[]
    ↓
RuntimeState[]
    ↓
FrameDiff[] + ObjectDiff[]
    ↓
RuntimeMutationBatch[]
    ↓
buildBehavioralObservations()
    ↓
BehavioralObservation[]
    ↓
analyzeBehavioralPatterns()
    ↓
BehavioralAnalysis
    ├── patterns[]
    └── stepAnnotations[]
    ↓
TraceVisualizer / future analyzers
```

Responsibility split:

```text
Trace layer
    = what was observed by the runtime tracer?

Diff layer
    = what low-level values differ?

Mutation layer
    = what semantic runtime state changed?

Behavioral layer
    = what deterministic repetition exists across multiple observations?

Future diagnostic layer
    = what might that evidence imply for debugging?
```

The first four layers remain factual. The future diagnostic layer is explicitly outside this spec.

---

# 8. Behavioral Semantics Boundary

A `BehavioralPattern` is:

> A deterministic description of repeated behavior found in the captured observable execution trace.

It is not proof of total program behavior.

The tracer does not necessarily observe every source of state, including examples such as:

- external system state;
- time;
- randomness hidden inside native/runtime internals;
- opaque iterators without safely inspectable state;
- globals not represented in the active frame's captured locals;
- state omitted because of configured capture bounds.

Therefore user-facing wording must use terms such as:

```text
observable state
captured state
observed execution
captured trace prefix
```

rather than claiming complete knowledge of Python execution.

---

# 9. Source-Line Causality Remains Out of Scope

The existing tracer uses Python line-tracing semantics where a line event means approximately:

```text
this line is about to execute
```

A mutation observed at trace step `t` must not automatically be labeled as caused by `currentLine_t`.

Behavioral analysis may use execution location as an observation anchor:

```text
solve:line 5 was revisited with the same observable state
```

but must not convert correlation into causality:

```text
line 5 caused the state to stop changing
```

This restriction applies to all pattern types in this milestone.

---

# 10. Behavioral Observation Model

Each reconstructable runtime step produces one normalized behavioral observation.

Conceptually:

```ts
export interface BehavioralObservation {
  step: number;
  frameId: number | null;
  functionName: string | null;
  currentLine: number | null;
  locationKey: string | null;
  stateFingerprint: StateFingerprint | null;
  transitionFingerprint: TransitionFingerprint;
  mutationCount: number;
}
```

The model is internal to the TypeScript interpretation layer. It is not added to the worker protocol.

A step with no active user frame may still have a transition fingerprint, but exact location-based repeated-state analysis requires a non-null location key.

---

# 11. Execution Location Key

The first version uses a session-local execution-location key:

```text
frameId + functionName + currentLine
```

Conceptually:

```ts
interface ExecutionLocation {
  frameId: number;
  functionName: string;
  line: number;
}
```

The key intentionally includes `frameId`.

Two recursive calls to the same function and same source line are not automatically treated as the same behavioral location because their local execution contexts are different.

This is conservative and avoids merging unrelated recursive frames.

Future cross-frame or cross-revision alignment may use a weaker semantic location key, but that is not part of this milestone.

---

# 12. Observable State Fingerprint

Repeated-state analysis needs a deterministic way to index candidate equal states.

The first version defines:

```ts
export interface StateFingerprint {
  key: string;
  complete: boolean;
}
```

The fingerprint must cover the observable state needed to distinguish execution revisits within one trace session, including at least:

```text
active frame identity
active frame locals
call-stack shape / frame identities
current observable object topology
stdout progress marker
exception/terminal state when present
```

The fingerprint may use an internal deterministic hash or compact canonical key as an index accelerator.

**A fingerprint match alone is not sufficient evidence of equality.**

Before emitting `RepeatedStatePattern` or `NoProgressPattern`, the implementation must perform exact normalized equality on the relevant captured state. This prevents a hash collision from becoming a factual debugging claim.

---

# 13. State Completeness

Exact-state behavioral claims are only safe when the relevant captured state is complete under current trace limits.

`StateFingerprint.complete` must be `false` when equality can be ambiguous because of truncation, including at least:

- `objectTopology.truncated === true`;
- a recursively relevant `ValueSnapshot` is marked `truncated`;
- a container snapshot is truncated;
- a string snapshot is truncated;
- another existing snapshot variant explicitly indicates partial capture.

When `complete === false`:

- the observation may still participate in transition-pattern analysis;
- it must not independently prove `RepeatedStatePattern`;
- it must not independently prove `NoProgressPattern`.

The first version chooses false negatives over false factual claims.

---

# 14. Stdout as Observable Progress

A loop that repeatedly prints while leaving locals unchanged is still changing observable execution state.

Therefore exact-state comparison must include an stdout progress marker.

The first version does not need to duplicate the full stdout string inside every fingerprint. A deterministic marker such as the captured stdout length may be used because the current runtime model accumulates stdout monotonically within one session.

If the stdout representation changes in a future runtime design, the fingerprint contract must be revisited.

---

# 15. Transition Fingerprint

Repeated execution behavior can exist even when concrete values change each iteration.

Example:

```python
i += 1
```

produces different values each time:

```text
0 → 1
1 → 2
2 → 3
```

but the execution transition shape is repeated.

The behavioral layer therefore defines a normalized transition fingerprint based on:

```text
execution location
+
ordered RuntimeMutation shape
```

Conceptually:

```ts
export interface TransitionFingerprint {
  key: string;
}
```

A mutation shape includes semantic category, target shape, and action, but should not require concrete scalar values to match.

Examples:

```text
variable:i:changed:int→int
reference:local:curr:redirected
sequence:nums[*]:changed:int→int
mapping:seen[*]:added
object_attribute:*.next:reference_redirected
none
```

The wildcard form is intentional.

For example, these should be able to share the same transition shape:

```text
nums[0] changed
nums[1] changed
nums[2] changed
```

and:

```text
obj-3.next redirected
obj-4.next redirected
obj-5.next redirected
```

when they occur in the same repeated execution motif.

The purpose is behavioral compression evidence, not object identity matching.

---

# 16. Why `RepeatedTransitionPattern`, Not `RepeatedMutationPattern`

The initial working name for the third pattern was `RepeatedMutationPattern`.

The final design uses:

```text
RepeatedTransitionPattern
```

because a repeated loop motif often contains line events with no mutation at all.

For example:

```text
line 4: evaluate loop condition    mutation = none
line 5: read value                 mutation = none
line 6: increment index            mutation = i changed
```

A mutation-only sequence would discard the first two steps and lose the actual repeated execution shape.

Therefore repeated transition analysis operates on every behavioral observation:

```text
location + mutation shape
```

including the explicit `none` transition shape.

---

# 17. Behavioral Pattern Union

The first version defines exactly three pattern kinds:

```ts
export type BehavioralPattern =
  | RepeatedStatePattern
  | NoProgressPattern
  | RepeatedTransitionPattern;
```

Shared fields conceptually include:

```ts
interface BehavioralPatternBase {
  patternId: string;
  kind: string;
  startStep: number;
  endStep: number;
  repeatCount: number;
  evidenceSteps: number[];
}
```

Pattern IDs are interpretation-local identifiers. They are not persisted and do not need continuity across live revisions.

---

# 18. `RepeatedStatePattern`

A `RepeatedStatePattern` means:

> The execution revisited the same execution location with exactly equal complete observable state multiple times within the bounded analysis window.

Conceptually:

```ts
interface RepeatedStatePattern extends BehavioralPatternBase {
  kind: "repeated_state";
  location: ExecutionLocation;
  stateFingerprintKey: string;
}
```

Default minimum evidence:

```text
3 matching observations
```

Two equal states are not sufficient because ordinary control flow can legitimately revisit a location once.

The pattern must be supported by exact normalized equality after candidate fingerprint matching.

Example user-facing summary:

```text
Repeated state × 5
solve:line 5 was revisited with the same observable state.
```

This is factual and does not claim the execution is infinite.

---

# 19. `NoProgressPattern`

A `NoProgressPattern` is a stricter interpretation of repeated exact-state evidence.

It means:

> Across multiple revisits to the same execution location, the captured observable execution returned to the same complete state without observable net progress at that anchor.

Conceptually:

```ts
interface NoProgressPattern extends BehavioralPatternBase {
  kind: "no_progress";
  location: ExecutionLocation;
  revisitCount: number;
}
```

The first version derives `NoProgressPattern` only from complete repeated-state evidence.

It must not be emitted from mutation absence alone.

For example, this is insufficient:

```text
step 10 mutations = []
step 11 mutations = []
```

because multiple line events may legitimately execute without modifying visible state.

A stronger pattern is required:

```text
same frame
same function
same anchor line
same exact complete observable state
revisited at least 3 times
```

User-facing wording must remain:

```text
No observable progress across 4 revisits.
```

and not:

```text
Infinite loop detected.
```

Even if the trace later ends in local timeout, combining those facts into an infinite-loop diagnosis belongs to a future diagnostic layer.

---

# 20. `RepeatedTransitionPattern`

A `RepeatedTransitionPattern` means:

> A contiguous execution-and-mutation motif repeated multiple times in the captured trace.

Conceptually:

```ts
interface RepeatedTransitionPattern extends BehavioralPatternBase {
  kind: "repeated_transition";
  periodSteps: number;
  motifKeys: string[];
}
```

The motif is built from ordered transition fingerprints.

Example:

```text
solve:4 + none
solve:5 + none
solve:6 + variable:i:changed:int→int
```

repeated 12 times may produce:

```text
Repeated transition motif × 12
3-step execution pattern repeated across steps 20–55.
```

This pattern is useful even when the program is making progress.

For example, a correct finite scan through a list may produce a repeated transition motif while never producing `NoProgressPattern`.

That distinction is essential:

```text
repetition ≠ failure
```

---

# 21. Pattern Detection Bounds

Behavioral analysis must be bounded.

Recommended first-version defaults:

```text
behaviorWindowSteps = 256
minPatternRepeats   = 3
maxPatternPeriod    = 32
maxPatternsPerTrace = 64
```

These are analysis bounds, not execution limits.

They may be internal constants or added to existing execution configuration if there is a clear configuration path during implementation.

The implementation must not perform unrestricted quadratic comparison over the full trace.

Target complexity should be approximately:

```text
O(trace_steps × maxPatternPeriod)
```

or better, with bounded retained comparison state.

---

# 22. Pattern De-duplication

The analyzer must avoid flooding the UI with overlapping evidence for the same repeated region.

For the same pattern kind and same semantic anchor:

- prefer the longest current span;
- merge extension of an existing repetition into one pattern;
- do not emit one new pattern for every additional repeat;
- keep deterministic ordering by `startStep`, then `endStep`, then `kind`.

`RepeatedStatePattern` and `NoProgressPattern` may legitimately refer to the same evidence because they answer different questions:

```text
RepeatedStatePattern
    = exact repeated observation evidence

NoProgressPattern
    = no observable net progress at that repeated anchor
```

The UI may choose to visually group them, but the core model keeps them separately typed.

---

# 23. Initial Snapshot Handling

`RuntimeMutation` already distinguishes:

```text
initial_snapshot
transition
```

Behavioral transition analysis must not mistake initial observation of a frame or object as a repeated program mutation.

Rules:

- initial-snapshot mutations may contribute to exact state fingerprint construction;
- initial-snapshot mutation events do not count as repeated transition mutations;
- transition fingerprints for initial-only observation steps should encode the transition as initialization rather than ordinary runtime change, or be excluded from motif matching consistently;
- the implementation must use one deterministic policy across tests and UI.

The recommended first-version policy is to exclude initialization transitions from repeated-transition motif matching.

---

# 24. Frame and Function Boundaries

Pattern matching is frame-aware.

The first version must not create a repeated-state or no-progress pattern by combining:

```text
frame 4 solve:line 8
frame 7 solve:line 8
```

Likewise, transition motifs must not silently span incompatible frame lifecycles unless the repeated motif itself contains the same ordered frame identities.

This makes recursion behavior conservative in v0.1.

Future recursion-specific visualization can introduce semantic frame-role matching separately.

---

# 25. Failure and Terminal Execution Prefixes

Behavioral analysis runs on whatever valid reconstructed prefix is available.

Applicable session outcomes include:

```text
completed
runtime error
trace step limit
trace byte limit
stdout limit
hard timeout with usable captured prefix
```

If a captured prefix contains enough evidence, patterns may be emitted even when execution does not complete normally.

Examples:

```text
Runtime Error
Behavioral Signals:
  Repeated transition motif × 6 before the exception
```

or:

```text
Local timeout
Behavioral Signals:
  No observable progress across 38 revisits in captured trace
```

The UI must not convert this combination into an official LeetCode verdict.

In particular:

```text
local timeout ≠ LeetCode TLE
completed ≠ LeetCode Accepted
```

remain unchanged product boundaries.

---

# 26. Behavioral Analysis Output

`interpretTrace()` should expose behavioral output in a form similar to:

```ts
export interface BehavioralStepAnnotation {
  step: number;
  patternIds: string[];
}

export interface BehavioralAnalysis {
  patterns: BehavioralPattern[];
  stepAnnotations: BehavioralStepAnnotation[];
}
```

and conceptually:

```ts
export interface TraceInterpretation {
  runtimeStates: RuntimeState[];
  frameDiffs: Array<FrameDiff | null>;
  objectDiffs: ObjectDiff[];
  mutationBatches: RuntimeMutationBatch[];
  behavioralAnalysis: BehavioralAnalysis;
  visualStates: VisualState[];
}
```

Exact field placement may be adjusted in implementation if an equivalent typed boundary is cleaner, but behavioral analysis must remain a distinct output rather than being embedded into structure-specific visual models.

---

# 27. Minimal `Behavioral Signals` UI

This milestone includes a small UI surface to prove that the new layer is useful end to end.

The Side Panel gains a section conceptually named:

```text
Behavioral Signals
```

It displays factual summaries such as:

```text
Repeated state × 5
solve:line 5 revisited the same observable state.

No observable progress × 4
Captured state returned unchanged at the same execution anchor.

Repeated transition motif × 12
A 3-step execution/mutation pattern repeated across steps 20–55.
```

The panel should:

- show only patterns supported by the current trace interpretation;
- expose step/span information;
- avoid diagnostic severity language such as `bug`, `error`, `infinite`, or `TLE` unless describing an actual runtime terminal status from the execution layer;
- remain usable for correct finite loops;
- not replace `What Changed`;
- not hide raw trace steps.

The first version does not require animation, charts, or a separate full-screen analysis mode.

---

# 28. No Trace Compression Yet

`RepeatedTransitionPattern` creates the semantic boundary needed for later trace compression, but this milestone does not modify trace navigation semantics.

Therefore:

```text
step count remains unchanged
playback remains unchanged
scrubbing remains unchanged
all raw trace steps remain inspectable
```

A future compression feature may transform:

```text
steps 20–55
3-step motif repeated × 12
```

into a folded presentation unit, but it must use `BehavioralPattern` evidence rather than independently rediscovering repetition.

---

# 29. Object Topology Container Reachability — Existing Gap

The current topology collector starts from active-frame local values and follows safe user-object attributes.

However, built-in containers are currently rejected as object nodes and also treated as traversal dead ends.

This means a case such as:

```python
nodes = [ListNode(1), ListNode(2), ListNode(3)]
```

may serialize `nodes` correctly as a container of references while failing to capture the referenced objects in object topology when those nodes are not reachable through another direct object root.

This violates the intended topology contract that user objects reachable through bounded traced containers should be discoverable.

This milestone fixes that gap.

---

# 30. Container-Reachable Topology Traversal

The topology collector must distinguish:

```text
object node
    = captured as ObjectSnapshot

traversal container
    = not captured as ObjectSnapshot, but traversed to discover reachable objects
```

Supported traversal containers in v0.1:

```text
exact built-in list
exact built-in tuple
exact built-in dict
exact built-in set
exact built-in frozenset
```

The collector must not generalize this into arbitrary iterable traversal.

This avoids executing user-controlled iterator behavior merely for visualization.

For dicts, both keys and values are traversal candidates because either can contain user-object references.

Nested built-in containers are traversed recursively within bounds.

Example:

```python
state = {
    "frontier": [node_a, node_b],
    "seen": {node_c},
}
```

must allow `node_a`, `node_b`, and `node_c` to become observable topology nodes when within configured bounds.

---

# 31. Container Traversal Safety

Topology traversal must remain non-invasive.

Rules:

1. do not call `gc.get_objects()`;
2. do not scan the whole Python heap;
3. do not call arbitrary `__iter__` implementations;
4. do not invoke arbitrary property getters;
5. do not invoke user methods to discover edges;
6. user-object attributes remain sourced through safe instance state such as `vars(value)`;
7. built-in container traversal must use only exact supported built-in container types;
8. traversal failure degrades topology capture rather than failing the user's execution.

Custom subclasses of built-in containers are not required to receive traversal semantics in this milestone.

---

# 32. Container Traversal Bounds

Container reachability must reuse existing bounded-capture policy rather than create an unbounded secondary walk.

The topology collector should reuse the existing configured container item bound:

```text
maxContainerItems / max_container_items
```

which is already used by `ValueSerializer`.

The topology walk remains constrained by:

```text
maxObjectNodes
maxObjectAttributes
maxObjectDepth
maxContainerItems
maxSessionBytes
```

Depth semantics for topology traversal are:

> Every traversal edge from an observable root through either a container membership or an object attribute increases topology depth by one.

Therefore:

```text
local list root
    ↓ depth 1
ListNode
    ↓ depth 2 via .next
ListNode
```

When a traversal bound prevents complete exploration:

```text
objectTopology.truncated = true
```

must be set.

This also automatically prevents partial topology from proving exact repeated-state/no-progress patterns under the completeness rules in this spec.

---

# 33. Topology Cycles

Container traversal must be cycle-safe.

The collector requires visited identity tracking for traversal containers in addition to existing object-node identity tracking.

Examples that must terminate safely:

```python
a = []
a.append(a)
```

and:

```python
container = []
node = ListNode(1)
container.append(node)
node.extra = container
```

The topology collector must not recursively expand these structures without bound.

---

# 34. Repository Hygiene

The repository currently contains tracked Python bytecode/cache artifacts under Python source and fixture directories.

This milestone removes tracked:

```text
__pycache__/
*.pyc
```

artifacts and updates `.gitignore` with at least:

```gitignore
__pycache__/
*.py[cod]
```

If `.pytest_cache/` is already generated by the repository's local Python fixture workflow, it may also be ignored, but no unrelated ignore-rule expansion is required.

Removing cache artifacts must not remove Python source fixtures used by the tests.

---

# 35. Minimal Continuous Integration

The repository currently defines the required local validation commands:

```bash
npm test
npm run typecheck
npm run build
```

This milestone adds a minimal GitHub Actions workflow for pushes and pull requests.

Target pipeline:

```text
checkout
    ↓
Node.js setup
    ↓
npm ci
    ↓
npm test
    ↓
npm run typecheck
    ↓
npm run build
```

Recommended Node major version:

```text
22
```

The first CI milestone intentionally excludes:

- release publishing;
- Chrome Web Store publishing;
- coverage thresholds;
- matrix testing across many Node versions;
- browser E2E automation;
- branch protection configuration.

The goal is simply to make the repository's existing correctness gates visible on every push/PR.

---

# 36. README and Architecture Documentation Sync

The English and Traditional Chinese READMEs must be updated after implementation so they describe the architecture that actually exists.

The current high-level pipeline should evolve from a generic:

```text
Runtime state + state diff
    ↓
Side Panel visualization
```

into a concise form that includes the current semantic layers, for example:

```text
TraceEvent
    ↓
RuntimeState
    ↓
FrameDiff + ObjectDiff
    ↓
RuntimeMutation
    ↓
Behavioral Patterns + Visual Interpretation
    ↓
Side Panel
```

The README should also link the currently implemented architecture documents, including at least:

```text
Linked List visualization design
Linked List implementation plan
Runtime Mutation Semantics design
Runtime Mutation Semantics implementation plan
Behavioral Debugging Foundation design
```

When this milestone is implemented, README feature text may mention behavioral signals, but it must preserve the same conservative wording as the UI.

---

# 37. Compatibility

This milestone must preserve existing behavior for:

- live editor synchronization;
- active-tab ownership;
- selected testcase execution;
- List visualization;
- Dict visualization;
- Linked List visualization;
- `What Changed` mutation rendering;
- call stack;
- stdout;
- runtime exception display;
- timeout / trace-limit prefix retention;
- visual candidate ranking.

The behavioral layer is additive.

No existing structure visualizer should need to know how repeated-pattern analysis works.

---

# 38. Trace Schema and Worker Protocol

Behavioral analysis is derived from existing reconstructed TypeScript runtime state and mutation batches.

Therefore the first version does not require a new worker-protocol message or a new trace schema version solely for behavioral analysis.

Container-reachable topology capture may increase which object snapshots appear inside the existing `objects` field, but does not change the field's schema.

If implementation discovers that a schema change is actually required, that is an architectural deviation and must be reviewed explicitly rather than silently added during implementation.

---

# 39. Performance Requirements

The live-editor workflow means behavioral analysis will run frequently.

The implementation must therefore satisfy these constraints:

1. no unrestricted all-pairs comparison across trace steps;
2. pattern analysis is bounded by configured/default analysis window and motif period;
3. fingerprint generation must avoid copying entire runtime structures unnecessarily;
4. exact equality is performed only for candidate fingerprint matches, not every pair of states;
5. retained pattern count is bounded;
6. topology container traversal is bounded by existing trace limits;
7. analysis failure must not invalidate an otherwise usable execution trace.

If behavioral analysis fails internally, the Side Panel should still be able to render the trace, mutations, and structure visuals without behavioral signals.

---

# 40. Determinism Requirements

Given the same reconstructed trace input, behavioral interpretation must produce deterministic:

- observation keys;
- pattern kinds;
- pattern spans;
- repeat counts;
- ordering;
- UI summaries.

Pattern ordering:

```text
startStep ascending
endStep ascending
kind ascending
patternId deterministic within interpretation
```

The implementation must not use probabilistic confidence scores in v0.1.

A pattern either satisfies the deterministic evidence contract or it does not.

---

# 41. Behavioral Tests

Unit tests must cover at least:

### Observation / fingerprint tests

- same complete state produces matching candidate fingerprint;
- different scalar local produces different state evidence;
- changed stdout progress prevents exact-state equality;
- different frame IDs do not merge repeated-state evidence;
- truncated object topology marks the state incomplete;
- recursively truncated container/string snapshots mark state incomplete.

### `RepeatedStatePattern`

- three exact revisits at same frame/function/line produce one pattern;
- two revisits do not meet the default threshold;
- same state at a different frame does not merge;
- a changed value between anchor observations prevents false exact equality;
- incomplete state does not produce the pattern.

### `NoProgressPattern`

- a stalled binary-search-style state that returns to the same anchor unchanged repeatedly produces no-progress evidence;
- a changing loop counter does not produce no-progress evidence;
- repeated empty mutation batches alone do not produce no-progress evidence;
- incomplete state does not produce no-progress evidence.

### `RepeatedTransitionPattern`

- repeated single-step mutation shape is detected;
- repeated multi-step location/mutation motif is detected;
- changing concrete scalar values may still share mutation shape;
- repeated empty-transition line steps remain part of a motif;
- fewer than the minimum repeats do not emit a pattern;
- overlapping extensions merge instead of flooding output.

---

# 42. Topology Reachability Tests

Python topology tests must cover at least:

```python
nodes = [node_a, node_b]
```

where the only root is the list and both nodes become captured topology objects.

Also cover:

- nested list/tuple containers;
- dict key reachability;
- dict value reachability;
- set/frozenset reachability;
- nested container → object → object reference traversal;
- container cycles terminate safely;
- max container item bound sets `truncated` when discovery is incomplete;
- max object depth still applies across container membership edges;
- max object node bound remains enforced;
- topology failure remains non-fatal to user execution.

Existing direct-root Linked List tests must remain green.

---

# 43. Integration Tests

At least the following end-to-end interpretation cases should be covered:

### Stalled binary-search-style loop

Example shape:

```python
while left < right:
    mid = (left + right) // 2
    if nums[mid] < target:
        left = mid
```

for a testcase where execution repeatedly returns to the same observable boundary state.

Expected:

```text
RepeatedStatePattern present
NoProgressPattern present
```

The test must not assert an `infinite_loop` diagnosis because no such type exists in this milestone.

### Correct finite counter loop

Expected:

```text
RepeatedTransitionPattern may be present
NoProgressPattern absent
```

### Linked List reverse

Repeated pointer/edge mutation shapes may produce repeated-transition evidence while Linked List visualization continues to show factual topology changes.

### Runtime error after repetition

A usable trace prefix before exception may still produce behavioral evidence.

### Truncated state

Transition patterns may still be available, but exact repeated-state/no-progress evidence must be suppressed when equality is not provable.

---

# 44. Side Panel Tests

UI tests must verify:

- no Behavioral Signals panel content when there are no patterns;
- repeated-state summary text is factual;
- no-progress summary includes the word `observable` or equivalent conservative wording;
- repeated-transition summary exposes repeat count and span/period information;
- the UI does not render `infinite loop`, `TLE`, `bug`, or fix suggestions from these patterns;
- `What Changed` remains present and mutation-driven;
- raw trace navigation remains unchanged;
- behavioral rendering failure does not prevent the main trace view from rendering.

---

# 45. CI / Repository Tests

Repository-level acceptance includes:

```bash
npm test
npm run typecheck
npm run build
```

all passing from a clean checkout.

The committed tree must not contain tracked Python bytecode/cache files after the cleanup commit.

The CI workflow must run the same existing commands rather than introducing a separate incompatible validation path.

---

# 46. Acceptance Criteria

This milestone is complete when all of the following are true:

1. every reconstructable trace step can produce a normalized behavioral observation;
2. `RepeatedStatePattern` is derived from exact complete observable-state equality;
3. `NoProgressPattern` is derived conservatively from repeated exact state at the same execution anchor;
4. `RepeatedTransitionPattern` detects bounded repeated execution/mutation motifs even when concrete values change;
5. no pattern type claims infinite loop, TLE, correctness failure, or source-line causality;
6. behavioral analysis is bounded and does not use unrestricted quadratic full-trace comparison;
7. Side Panel can show factual Behavioral Signals without hiding raw trace steps;
8. List / Dict / Linked List visualization behavior remains compatible;
9. object-topology capture can discover user objects reachable only through supported built-in containers;
10. container topology traversal is bounded, cycle-safe, and non-invasive;
11. partial/truncated state cannot prove exact repeated-state/no-progress patterns;
12. tracked Python cache artifacts are removed and ignored;
13. a minimal GitHub Actions workflow runs `npm ci`, tests, typecheck, and build;
14. English and Traditional Chinese README architecture/document links reflect the implemented system;
15. no Tree / Graph / DP visualizer is introduced by this milestone;
16. no cross-execution or cross-revision object identity is introduced;
17. existing execution and visualization tests remain green.

---

# 47. Future Extension Boundary

The main reason to introduce `BehavioralPattern` as a separate typed layer is to prevent future debugging features from independently re-analyzing raw trace data.

Expected future consumers include:

```text
BehavioralPattern[]
    ↓
┌──────────────────────────────┐
│ Failure Evidence Composer    │
│ Trace Compression            │
│ Timeout-prefix inspection    │
│ Hot execution-region stats   │
│ Revision trace alignment     │
└──────────────────────────────┘
```

A future failure-analysis layer may combine factual evidence such as:

```text
NoProgressPattern
+
local timeout
```

and present a stronger but still carefully worded diagnostic.

A future trace-compression layer may consume:

```text
RepeatedTransitionPattern
```

and fold repeated motifs without changing underlying trace semantics.

A future revision-diff layer may compare behavioral patterns across two independent executions using semantic alignment rather than raw `obj-N` identity.

None of those consumers should bypass this layer and reinvent repetition detection independently.

---

# 48. Final Architecture After This Milestone

The intended project architecture after implementation is:

```text
LeetCode editor + testcase
        ↓
Live scheduler
        ↓
Pyodide Worker
        ↓
Python line-level tracer
        ↓
TraceEvent[]
        ↓
RuntimeState[]
        ↓
FrameDiff + ObjectDiff
        ↓
RuntimeMutation[]
        ↓
┌───────────────────────────────┐
│ Behavioral Analysis           │
│   Repeated State              │
│   No Observable Progress      │
│   Repeated Transition Motif   │
└───────────────────────────────┘
        ↓
BehavioralPattern[]

RuntimeMutation[] ───────────────┐
RuntimeState[] ──────────────────┤
Static relations ────────────────┤
                                ↓
                      Visual Interpretation
                                ↓
                    StructureVisualModel[]
                                ↓
                      Visualizer Registry
                                ↓
                    Chrome Side Panel
```

The product direction becomes:

```text
not only:
    show me the current runtime state

but also:
    show me when the observed execution starts repeating itself
```

while preserving the project's defining constraint:

> **The debugger reports runtime evidence before it attempts to explain what that evidence means.**

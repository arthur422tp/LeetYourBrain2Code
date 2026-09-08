# Behavioral Debugging Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, deterministic `RuntimeMutation[] -> BehavioralPattern[]` analysis layer with factual repeated-state, no-progress, and repeated-transition signals, while fixing container-reachable topology capture and repository maintenance gaps.

**Architecture:** Keep `TraceEvent -> RuntimeState -> FrameDiff/ObjectDiff -> RuntimeMutation` as the factual runtime foundation. Add three focused TypeScript core units: behavioral contracts, observation normalization, and bounded pattern detection; expose one `BehavioralAnalysis` from `interpretTrace()` and render it through a dedicated Side Panel component. Separately repair Python object-topology traversal so supported built-in containers expose reachable user objects without arbitrary iteration or property execution.

**Tech Stack:** TypeScript 5.8, Vitest 3, Vite 6, Chrome Manifest V3 Side Panel, Pyodide 0.29, Python runtime fixtures, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-behavioral-debugging-foundation-design.md`

## Global Constraints

- Behavioral output is runtime evidence, not diagnosis. Do not emit infinite-loop, TLE, WA, correctness, bug-fix, or solution claims.
- Source locations are observation anchors only; do not claim source-line causality.
- `RepeatedStatePattern` and `NoProgressPattern` require complete captured state plus exact normalized equality after candidate fingerprint matching.
- `RepeatedTransitionPattern` uses execution location plus normalized mutation shape and retains explicit no-mutation transitions.
- Initial-snapshot mutations do not count as ordinary repeated runtime transitions.
- Analysis defaults are exactly: `behaviorWindowSteps = 256`, `minPatternRepeats = 3`, `maxPatternPeriod = 32`, `maxPatternsPerTrace = 64`.
- Pattern analysis is bounded; do not add unrestricted all-pairs trace comparison.
- Behavioral analysis failure must not invalidate an otherwise renderable trace.
- Container topology traversal supports only exact built-in `list`, `tuple`, `dict`, `set`, and `frozenset`.
- Topology traversal remains bounded by `maxContainerItems`, `maxObjectNodes`, `maxObjectAttributes`, `maxObjectDepth`, and existing session byte limits.
- Truncated/partial capture cannot prove exact repeated-state or no-progress patterns.
- Preserve existing List, Dict, Linked List, mutation rendering, candidate ranking, call stack, stdout, exception, timeout-prefix, and raw-step navigation behavior.
- Do not add Tree, Graph, DP, backend persistence, cross-execution identity, or revision matching in this milestone.
- GitHub Actions uses Node.js 22 and runs `npm ci`, `npm test`, `npm run typecheck`, `npm run build`.

## File Map

Create:

```text
src/core/behavioral-pattern.ts
src/core/behavioral-observation.ts
src/core/behavioral-analyzer.ts
src/sidepanel/components/BehavioralSignals.ts

tests/core/behavioral-observation.test.ts
tests/core/behavioral-analyzer.test.ts
tests/sidepanel/behavioral-signals.test.ts
tests/fixtures/python/test_object_topology.py
.github/workflows/ci.yml
```

Modify:

```text
src/worker/python/object_topology.py
src/core/value-snapshot.ts
src/core/trace-interpreter.ts
src/sidepanel/components/TraceVisualizer.ts
src/sidepanel/styles.css

tests/core/value-snapshot.test.ts
tests/core/trace-interpreter.test.ts
tests/execution/pyodide-runtime.test.ts
tests/execution/execution-controller.test.ts
tests/sidepanel/trace-visualizer.test.ts

.gitignore
README.md
README.zh-TW.md
```

One spec ambiguity is resolved here so implementation is deterministic:

```text
RepeatedStatePattern
    may represent recurrence of the same complete state at the same anchor,
    even when another state occurred at that anchor between matches.

NoProgressPattern
    is stricter: consecutive observations of the same anchor must remain
    exact-equal. A different or incomplete state at that anchor resets the run.
```

---

### Task 1: Traverse Supported Containers During Object Topology Capture

**Files:**
- Modify: `src/worker/python/object_topology.py`
- Create: `tests/fixtures/python/test_object_topology.py`
- Modify: `tests/execution/pyodide-runtime.test.ts`

**Interfaces:**
- Consumes: `ObjectTopologyCollector.capture(roots)` and existing trace limits.
- Produces: unchanged `{ "objects": ObjectSnapshot[], "truncated": bool }` output with additional container-reachable objects.
- Preserves: object identity scope, `TraceEvent.objects`, `objectsTruncated`, worker protocol.

- [ ] **Step 1: Write the failing direct-container reachability test**

Create `tests/fixtures/python/test_object_topology.py`:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from object_topology import ObjectTopologyCollector


class Node:
    def __init__(self, value, next=None):
        self.value = value
        self.next = next


def collector(**overrides):
    limits = {
        "max_container_items": 20,
        "max_nesting_depth": 12,
        "max_snapshot_bytes": 256_000,
        "max_object_nodes": 200,
        "max_object_attributes": 20,
        "max_object_depth": 32,
    }
    limits.update(overrides)
    return ObjectTopologyCollector(limits)


def captured_values(topology):
    return sorted(
        int(obj["attributes"]["value"]["value"])
        for obj in topology["objects"]
    )


def test_list_root_discovers_user_objects_inside_container():
    first = Node(1)
    second = Node(2)

    topology = collector().capture([[first, second]])

    assert captured_values(topology) == [1, 2]
    assert topology["truncated"] is False
```

- [ ] **Step 2: Run the failing test**

```bash
python -m pytest tests/fixtures/python/test_object_topology.py -q
```

Expected: FAIL because the current collector skips built-in containers and never enqueues their members.

- [ ] **Step 3: Add exact-built-in traversal helpers and `max_container_items`**

In `ObjectTopologyCollector.__init__()`:

```python
self.max_container_items = max(
    0, int(_limit(limits, "max_container_items", "maxContainerItems", 1000))
)
```

Add:

```python
def _is_traversal_container(self, value):
    return type(value) in (list, tuple, dict, set, frozenset)


def _container_children(self, value):
    if type(value) in (list, tuple):
        items = list(value[: self.max_container_items])
        return items, len(value) > len(items)

    if type(value) is dict:
        entries = list(value.items())[: self.max_container_items]
        children = []
        for key, item in entries:
            children.extend((key, item))
        return children, len(value) > len(entries)

    if type(value) in (set, frozenset):
        items = []
        for item in value:
            if len(items) >= self.max_container_items:
                break
            items.append(item)
        return items, len(value) > len(items)

    return [], False
```

Do not generalize this to arbitrary `iter(value)`.

- [ ] **Step 4: Make traversal cycle-safe and depth-aware**

Replace the single `visited` set with:

```python
visited_objects = set()
visited_containers = set()
```

At the beginning of the queue loop:

```python
value, depth = queue.popleft()

if depth > self.max_object_depth:
    truncated = True
    continue

if self._is_traversal_container(value):
    identity = id(value)
    if identity in visited_containers:
        continue
    visited_containers.add(identity)

    children, container_truncated = self._container_children(value)
    truncated = truncated or container_truncated
    for child in children:
        queue.append((child, depth + 1))
    continue
```

Keep user objects on the existing capture path, using `visited_objects`. When an object attribute is either another safe object node or a supported traversal container, enqueue it at `depth + 1`.

- [ ] **Step 5: Add required traversal/bounds tests**

Append:

```python
def test_nested_containers_discover_objects():
    node = Node(7)
    assert captured_values(collector().capture([{"nodes": ([node],)}])) == [7]


def test_dict_keys_and_values_are_traversed():
    key = Node(1)
    value = Node(2)
    assert captured_values(collector().capture([{key: value}])) == [1, 2]


def test_set_and_frozenset_are_traversed():
    left = Node(3)
    right = Node(4)
    assert captured_values(collector().capture([{left}, frozenset({right})])) == [3, 4]


def test_object_attribute_container_reaches_child_objects():
    parent = Node(1)
    child = Node(2)
    parent.children = [child]
    assert captured_values(collector().capture([parent])) == [1, 2]


def test_container_cycle_terminates():
    root = []
    root.append(root)
    assert collector().capture([root]) == {"objects": [], "truncated": False}


def test_container_item_bound_marks_topology_truncated():
    topology = collector(max_container_items=2).capture([[Node(1), Node(2), Node(3)]])
    assert captured_values(topology) == [1, 2]
    assert topology["truncated"] is True


def test_container_membership_consumes_topology_depth():
    topology = collector(max_object_depth=0).capture([[Node(9)]])
    assert topology["objects"] == []
    assert topology["truncated"] is True
```

Also add a `max_object_nodes=1` assertion so the existing object-node bound remains enforced after container traversal.

- [ ] **Step 6: Run Python fixtures**

```bash
python -m pytest tests/fixtures/python/test_object_topology.py tests/fixtures/python/test_serializer.py tests/fixtures/python/test_trace_engine.py -q
```

Expected: PASS.

- [ ] **Step 7: Protect worker bundling in TypeScript**

In the existing `buildExecutionScript()` test in `tests/execution/pyodide-runtime.test.ts`, add:

```ts
expect(script).toContain("max_container_items");
expect(script).toContain("_is_traversal_container");
expect(script).toContain("_container_children");
```

- [ ] **Step 8: Run TypeScript regressions**

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts tests/core/state-reconstructor.test.ts tests/core/linked-list-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/worker/python/object_topology.py tests/fixtures/python/test_object_topology.py tests/execution/pyodide-runtime.test.ts
git commit -m "fix: traverse containers in object topology"
```

---

### Task 2: Define Behavioral Contracts and Snapshot Completeness

**Files:**
- Create: `src/core/behavioral-pattern.ts`
- Modify: `src/core/value-snapshot.ts`
- Modify: `tests/core/value-snapshot.test.ts`

**Interfaces:**
- Produces: `ExecutionLocation`, `BehavioralPattern` union, `BehavioralAnalysis`, analysis constants, and `isValueSnapshotComplete(snapshot)`.
- Later tasks must use these exact exported names.

- [ ] **Step 1: Create behavioral contracts**

Create `src/core/behavioral-pattern.ts`:

```ts
export const BEHAVIOR_WINDOW_STEPS = 256;
export const MIN_PATTERN_REPEATS = 3;
export const MAX_PATTERN_PERIOD = 32;
export const MAX_PATTERNS_PER_TRACE = 64;

export interface ExecutionLocation {
  frameId: number;
  functionName: string;
  line: number;
}

export interface BehavioralPatternBase {
  patternId: string;
  startStep: number;
  endStep: number;
  repeatCount: number;
  evidenceSteps: number[];
}

export interface RepeatedStatePattern extends BehavioralPatternBase {
  kind: "repeated_state";
  location: ExecutionLocation;
  stateFingerprintKey: string;
}

export interface NoProgressPattern extends BehavioralPatternBase {
  kind: "no_progress";
  location: ExecutionLocation;
  revisitCount: number;
}

export interface RepeatedTransitionPattern extends BehavioralPatternBase {
  kind: "repeated_transition";
  periodSteps: number;
  motifKeys: string[];
}

export type BehavioralPattern =
  | RepeatedStatePattern
  | NoProgressPattern
  | RepeatedTransitionPattern;

export interface BehavioralStepAnnotation {
  step: number;
  patternIds: string[];
}

export interface BehavioralAnalysis {
  patterns: BehavioralPattern[];
  stepAnnotations: BehavioralStepAnnotation[];
}

export const EMPTY_BEHAVIORAL_ANALYSIS: BehavioralAnalysis = {
  patterns: [],
  stepAnnotations: []
};
```

- [ ] **Step 2: Write failing recursive completeness tests**

Add to `tests/core/value-snapshot.test.ts`:

```ts
import { isValueSnapshotComplete } from "../../src/core/value-snapshot";

it("rejects recursively truncated snapshots", () => {
  expect(isValueSnapshotComplete({
    type: "list",
    length: 1,
    truncated: false,
    items: [{ type: "str", value: "abc", length: 9, truncated: true }]
  })).toBe(false);
});

it("accepts complete nested snapshots", () => {
  expect(isValueSnapshotComplete({
    type: "dict",
    length: 1,
    truncated: false,
    entries: [{
      key: { type: "str", value: "x", length: 1, truncated: false },
      value: { type: "int", value: "3" }
    }]
  })).toBe(true);
});

it("rejects explicitly truncated unknown snapshots", () => {
  expect(isValueSnapshotComplete({
    type: "unknown",
    className: "Thing",
    repr: "<snapshot truncated>",
    truncated: true
  })).toBe(false);
});
```

- [ ] **Step 3: Implement completeness recursion**

Add to `src/core/value-snapshot.ts`:

```ts
export function isValueSnapshotComplete(snapshot: ValueSnapshot): boolean {
  switch (snapshot.type) {
    case "str":
      return !snapshot.truncated;
    case "list":
    case "tuple":
    case "set":
      return !snapshot.truncated && snapshot.items.every(isValueSnapshotComplete);
    case "dict":
      return !snapshot.truncated && snapshot.entries.every((entry) =>
        isValueSnapshotComplete(entry.key) &&
        isValueSnapshotComplete(entry.value)
      );
    case "unknown":
      return snapshot.truncated !== true;
    default:
      return true;
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

```bash
npx vitest run tests/core/value-snapshot.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/behavioral-pattern.ts src/core/value-snapshot.ts tests/core/value-snapshot.test.ts
git commit -m "feat: add behavioral pattern contracts"
```

---

### Task 3: Build Deterministic Behavioral Observations

**Files:**
- Create: `src/core/behavioral-observation.ts`
- Create: `tests/core/behavioral-observation.test.ts`

**Interfaces:**
- Consumes: `RuntimeState[]`, `RuntimeMutationBatch[]`.
- Produces:

```ts
export interface StateFingerprint {
  key: string;
  complete: boolean;
}

export interface TransitionFingerprint {
  key: string;
  eligible: boolean;
}

export interface BehavioralObservation {
  step: number;
  frameId: number | null;
  functionName: string | null;
  currentLine: number | null;
  location: ExecutionLocation | null;
  locationKey: string | null;
  stateFingerprint: StateFingerprint | null;
  normalizedStateKey: string | null;
  transitionFingerprint: TransitionFingerprint;
  mutationCount: number;
}

export function buildBehavioralObservations(
  runtimeStates: RuntimeState[],
  mutationBatches: RuntimeMutationBatch[]
): BehavioralObservation[];
```

`StateFingerprint.key` is only a candidate index. `normalizedStateKey` is the exact canonical equality evidence.

- [ ] **Step 1: Write observation tests for exact state, stdout, frames, and truncation**

Create builders in `tests/core/behavioral-observation.test.ts`:

```ts
function state(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    step: 1,
    activeFrameId: 1,
    frames: new Map([[1, {
      frameId: 1,
      parentFrameId: null,
      functionName: "solve",
      line: 5,
      locals: { left: { type: "int", value: "2" } }
    }]]),
    callStack: [1],
    currentLine: 5,
    stdout: "",
    objectTopology: { objects: new Map(), truncated: false },
    ...overrides
  };
}

function batch(step: number): RuntimeMutationBatch {
  return { step, frameId: 1, currentLine: 5, mutations: [] };
}
```

Required assertions:

```ts
it("gives exact-equal states equal normalized keys", () => {
  const values = buildBehavioralObservations(
    [state({ step: 1 }), state({ step: 2 })],
    [batch(1), batch(2)]
  );
  expect(values[0]!.normalizedStateKey).toBe(values[1]!.normalizedStateKey);
  expect(values[0]!.stateFingerprint?.key).toBe(values[1]!.stateFingerprint?.key);
});

it("treats stdout growth as observable progress", () => {
  const values = buildBehavioralObservations(
    [state({ step: 1, stdout: "" }), state({ step: 2, stdout: "x" })],
    [batch(1), batch(2)]
  );
  expect(values[0]!.normalizedStateKey).not.toBe(values[1]!.normalizedStateKey);
});

it("keeps frame identity in the location key", () => {
  // Build frame 1 and frame 2 at solve:line 5 and assert locationKey differs.
});

it("marks truncated topology incomplete", () => {
  const [value] = buildBehavioralObservations([
    state({ objectTopology: { objects: new Map(), truncated: true } })
  ], [batch(1)]);
  expect(value!.stateFingerprint?.complete).toBe(false);
});
```

Also add a nested truncated-local case using the helper from Task 2.

- [ ] **Step 2: Implement deterministic location and canonical state serialization**

In `src/core/behavioral-observation.ts`, create location only when the active frame and line are available:

```ts
function executionLocation(runtime: RuntimeState): ExecutionLocation | null {
  if (runtime.activeFrameId === null || runtime.currentLine === null) return null;
  const frame = runtime.frames.get(runtime.activeFrameId);
  if (!frame) return null;
  return {
    frameId: frame.frameId,
    functionName: frame.functionName,
    line: runtime.currentLine
  };
}

function locationKey(location: ExecutionLocation): string {
  return `${location.frameId}:${location.functionName}:${location.line}`;
}
```

Build the exact state key from all frames currently in `runtime.callStack`, sorted object topology, stdout length, and exception state. Use existing `valueSnapshotKey()` for every captured value.

Canonical object attributes must be sorted by attribute name; topology objects must be sorted by `objectId`.

Do **not** include `runtime.step` or the current anchor line in `normalizedStateKey`; anchor equality is checked separately.

- [ ] **Step 3: Implement state completeness and candidate fingerprint**

A runtime state is incomplete when `objectTopology.truncated` is true, a call-stack frame is missing, or any local/return/object attribute snapshot is incomplete.

Add dependency-free FNV-1a indexing:

```ts
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
```

Set:

```ts
stateFingerprint: normalizedStateKey === null ? null : {
  key: fnv1a(normalizedStateKey),
  complete: runtimeStateIsComplete(runtime)
}
```

- [ ] **Step 4: Write transition-shape tests**

Add cases proving:

```text
0 -> 1 and 1 -> 2 for variable i share one mutation shape
nums[0] and nums[1] changes wildcard the index
obj-1.next and obj-2.next redirects wildcard the object id
an empty mutation batch produces an explicit `none` shape
an initialization-only batch has `eligible === false`
```

Use concrete assertions such as:

```ts
expect(first.transitionFingerprint.key).toBe(second.transitionFingerprint.key);
expect(empty.transitionFingerprint.key).toContain("|none");
expect(initial.transitionFingerprint.eligible).toBe(false);
```

- [ ] **Step 5: Implement normalized mutation shapes**

Add:

```ts
function valueType(value: ValueSnapshot | undefined): string {
  return value?.type ?? "absent";
}

function mutationShapeKey(mutation: RuntimeMutation): string {
  switch (mutation.kind) {
    case "variable":
      return `variable:${mutation.variableName}:${mutation.action}:${valueType(mutation.before)}->${valueType(mutation.after)}`;
    case "reference":
      return mutation.owner.scope === "local"
        ? `reference:local:${mutation.owner.variableName}:${mutation.action}`
        : `reference:object:*.${mutation.owner.attribute}:${mutation.action}`;
    case "sequence_element":
      return `sequence:${mutation.containerName}[*]:${mutation.action}:${valueType(mutation.before)}->${valueType(mutation.after)}`;
    case "mapping_entry":
      return `mapping:${mutation.containerName}[*]:${mutation.action}:${valueType(mutation.before)}->${valueType(mutation.after)}`;
    case "set_membership":
      return `set:${mutation.containerName}[*]:${mutation.action}:${valueType(mutation.member)}`;
    case "object_attribute":
      return `object_attribute:*.${mutation.attribute}:${mutation.action}:${valueType(mutation.before)}->${valueType(mutation.after)}`;
    case "object_visibility":
      return `object_visibility:*:${mutation.action}`;
  }
}
```

Use only `origin === "transition"` mutations in the shape. A batch containing any `initial_snapshot` mutation is ineligible in v0.1. A transition-eligible batch with no transition mutations uses shape `none`.

Final key:

```ts
const key = location === null
  ? `no-location|${shape}`
  : `${locationKey(location)}|${shape}`;
```

- [ ] **Step 6: Run focused tests**

```bash
npx vitest run tests/core/behavioral-observation.test.ts tests/core/value-snapshot.test.ts tests/core/runtime-mutation-normalizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/behavioral-observation.ts tests/core/behavioral-observation.test.ts
git commit -m "feat: normalize behavioral observations"
```

---

### Task 4: Detect Repeated State and Conservative No-Progress Runs

**Files:**
- Create: `src/core/behavioral-analyzer.ts`
- Create: `tests/core/behavioral-analyzer.test.ts`

**Interfaces:**
- Consumes: `BehavioralObservation[]`.
- Produces:

```ts
export function analyzeBehavioralPatterns(
  observations: BehavioralObservation[]
): BehavioralAnalysis;

export function analyzeBehavioralPatternsSafely(
  observations: BehavioralObservation[]
): BehavioralAnalysis;
```

- [ ] **Step 1: Create strict analyzer entry point and observation test builder**

Start the analyzer with constants from `behavioral-pattern.ts` and return an empty result for an empty input.

In `tests/core/behavioral-analyzer.test.ts` create:

```ts
function observation(
  step: number,
  exactState: string,
  overrides: Partial<BehavioralObservation> = {}
): BehavioralObservation {
  return {
    step,
    frameId: 1,
    functionName: "solve",
    currentLine: 5,
    location: { frameId: 1, functionName: "solve", line: 5 },
    locationKey: "1:solve:5",
    stateFingerprint: { key: `hash:${exactState}`, complete: true },
    normalizedStateKey: exactState,
    transitionFingerprint: { key: "1:solve:5|none", eligible: true },
    mutationCount: 0,
    ...overrides
  };
}
```

- [ ] **Step 2: Write repeated-state tests**

Required cases:

```ts
it("emits repeated state after three exact complete matches", () => {
  const analysis = analyzeBehavioralPatterns([
    observation(1, "same"),
    observation(4, "same"),
    observation(7, "same")
  ]);
  expect(analysis.patterns).toContainEqual(expect.objectContaining({
    kind: "repeated_state",
    startStep: 1,
    endStep: 7,
    repeatCount: 3,
    evidenceSteps: [1, 4, 7]
  }));
});
```

Also prove:

```text
two matches do not meet threshold
same line in a different frame does not merge
same candidate fingerprint with different normalizedStateKey does not count
incomplete observations do not count
```

- [ ] **Step 3: Implement bounded repeated-state bucketing**

Analyze only:

```ts
const window = observations.slice(-BEHAVIOR_WINDOW_STEPS);
```

Bucket by:

```text
locationKey + stateFingerprint.key
```

then group each bucket again by exact `normalizedStateKey`. Emit only exact groups with `length >= MIN_PATTERN_REPEATS`.

Use deterministic IDs:

```ts
function patternId(kind: string, startStep: number, endStep: number, suffix: string): string {
  return `${kind}:${startStep}:${endStep}:${suffix}`;
}
```

- [ ] **Step 4: Write stricter no-progress tests**

Required:

```ts
it("emits no progress for consecutive exact-equal anchor visits", () => {
  const analysis = analyzeBehavioralPatterns([
    observation(1, "same"),
    observation(3, "same"),
    observation(5, "same")
  ]);
  expect(analysis.patterns).toContainEqual(expect.objectContaining({
    kind: "no_progress",
    repeatCount: 3,
    revisitCount: 2,
    evidenceSteps: [1, 3, 5]
  }));
});
```

Also prove a same-anchor different state resets the no-progress run even when a later `RepeatedStatePattern` can still be formed, and prove empty mutation batches alone do not create no-progress when exact state changes.

- [ ] **Step 5: Implement no-progress runs per location**

Track the previous complete observation and current exact-equal run for each `locationKey`.

Rules:

```text
same location + complete + same candidate key + same normalizedStateKey
    append

different or incomplete state at that location
    finalize threshold-qualified run, then reset
```

For emitted patterns:

```ts
repeatCount = run.length;
revisitCount = run.length - 1;
```

Do not use `mutationCount === 0` as proof.

- [ ] **Step 6: Add deterministic sorting and cap**

Sort by:

```ts
left.startStep - right.startStep ||
left.endStep - right.endStep ||
left.kind.localeCompare(right.kind) ||
left.patternId.localeCompare(right.patternId)
```

then cap at `MAX_PATTERNS_PER_TRACE`.

- [ ] **Step 7: Add strict/safe entry point separation**

Keep the strict function for tests. Add:

```ts
export function analyzeBehavioralPatternsSafely(
  observations: BehavioralObservation[]
): BehavioralAnalysis {
  try {
    return analyzeBehavioralPatterns(observations);
  } catch {
    return EMPTY_BEHAVIORAL_ANALYSIS;
  }
}
```

Add one malformed coerced-input test proving the safe wrapper returns the empty analysis while strict tests remain failure-visible.

- [ ] **Step 8: Run tests and commit**

```bash
npx vitest run tests/core/behavioral-analyzer.test.ts tests/core/behavioral-observation.test.ts
npm run typecheck
git add src/core/behavioral-analyzer.ts tests/core/behavioral-analyzer.test.ts
git commit -m "feat: detect repeated runtime state"
```

---

### Task 5: Detect Repeated Transition Motifs in Bounded O(N × MaxPeriod) Work

**Files:**
- Modify: `src/core/behavioral-analyzer.ts`
- Modify: `tests/core/behavioral-analyzer.test.ts`

**Interfaces:**
- Consumes: `transitionFingerprint.key` and `.eligible`.
- Produces: `RepeatedTransitionPattern` in the same `BehavioralAnalysis`.

- [ ] **Step 1: Write single-step and multi-step motif tests**

Required:

```ts
it("detects one-step transition repetition", () => {
  const values = [1, 2, 3].map((step) => observation(step, `s${step}`, {
    transitionFingerprint: {
      key: "1:solve:5|variable:i:changed:int->int",
      eligible: true
    }
  }));
  expect(analyzeBehavioralPatterns(values).patterns).toContainEqual(
    expect.objectContaining({
      kind: "repeated_transition",
      periodSteps: 1,
      repeatCount: 3
    })
  );
});
```

Add a `A,B,C,A,B,C,A,B,C` case expecting `periodSteps: 3`, plus tests proving initialization observations break a motif and `none` transitions may be members of a motif.

- [ ] **Step 2: Implement one linear suffix scan per candidate period**

For each period from `1` to `min(MAX_PATTERN_PERIOD, floor(window.length / MIN_PATTERN_REPEATS))`, compare each observation with the one `period` positions earlier:

```ts
for (let period = 1; period <= maxPeriod; period += 1) {
  let matchedSuffix = 0;
  for (let index = period; index < window.length; index += 1) {
    const current = window[index]!;
    const previous = window[index - period]!;
    const matches =
      current.transitionFingerprint.eligible &&
      previous.transitionFingerprint.eligible &&
      current.transitionFingerprint.key === previous.transitionFingerprint.key;

    matchedSuffix = matches ? matchedSuffix + 1 : 0;
    const requiredMatches = period * (MIN_PATTERN_REPEATS - 1);
    if (matchedSuffix < requiredMatches) continue;

    const totalLength = matchedSuffix + period;
    const repeatCount = Math.floor(totalLength / period);
    const startIndex = index - matchedSuffix - period + 1;
    const endIndex = startIndex + repeatCount * period - 1;
    // emit candidate from window[startIndex..endIndex]
  }
}
```

This keeps comparison work approximately `O(window.length * maxPatternPeriod)`.

- [ ] **Step 3: Emit exact evidence span and motif keys**

For each candidate:

```ts
const motif = window.slice(startIndex, startIndex + period);
const evidence = window.slice(startIndex, endIndex + 1);
```

Set:

```ts
periodSteps: period,
motifKeys: motif.map((entry) => entry.transitionFingerprint.key),
evidenceSteps: evidence.map((entry) => entry.step),
repeatCount
```

- [ ] **Step 4: De-duplicate extensions and prefer the minimal equivalent period**

First keep only the longest candidate for the same:

```text
startStep + periodSteps + motifKeys
```

Then process candidates in `periodSteps` ascending and suppress a larger integer-multiple period when it covers the exact same start/end evidence span already represented by a smaller period.

Add a six-`A` test expecting one period-1 pattern covering steps 1–6, not one pattern per extension.

- [ ] **Step 5: Build step annotations after final capping**

For every final pattern, add its `patternId` to each `evidenceStep`; return annotations sorted by step and pattern ID.

Implementation shape:

```ts
const patternIdsByStep = new Map<number, string[]>();
for (const pattern of patterns) {
  for (const step of pattern.evidenceSteps) {
    const ids = patternIdsByStep.get(step) ?? [];
    ids.push(pattern.patternId);
    patternIdsByStep.set(step, ids);
  }
}
```

- [ ] **Step 6: Run tests and commit**

```bash
npx vitest run tests/core/behavioral-analyzer.test.ts tests/core/behavioral-observation.test.ts
npm run typecheck
git add src/core/behavioral-analyzer.ts tests/core/behavioral-analyzer.test.ts
git commit -m "feat: detect repeated runtime transitions"
```

---

### Task 6: Integrate Behavioral Analysis into Trace Interpretation

**Files:**
- Modify: `src/core/trace-interpreter.ts`
- Modify: `tests/core/trace-interpreter.test.ts`

**Interfaces:**
- Consumes: `buildBehavioralObservations()` and `analyzeBehavioralPatternsSafely()`.
- Produces: `TraceInterpretation.behavioralAnalysis: BehavioralAnalysis`.

- [ ] **Step 1: Add failing interpretation contract assertions**

Extend existing length/integration tests:

```ts
expect(result.runtimeStates.length).toBe(result.frameDiffs.length);
expect(result.runtimeStates.length).toBe(result.objectDiffs.length);
expect(result.runtimeStates.length).toBe(result.mutationBatches.length);
expect(result.runtimeStates.length).toBe(result.visualStates.length);
expect(result.behavioralAnalysis).toEqual(expect.objectContaining({
  patterns: expect.any(Array),
  stepAnnotations: expect.any(Array)
}));
```

- [ ] **Step 2: Add a repeated identical anchor trace**

Create synthetic `TraceEvent[]` where frame 1 revisits the same line with exact-equal locals at least three times. Assert `repeated_state` and `no_progress` are present and no unsupported diagnostic type exists.

- [ ] **Step 3: Add a finite changing-loop trace**

Create a repeated line/mutation motif while incrementing `i`. Assert `repeated_transition` is present and `no_progress` is absent.

- [ ] **Step 4: Add a truncated-state trace**

Use `objectsTruncated: true` on repeated states. Assert exact-state/no-progress patterns are absent while transition analysis remains eligible.

- [ ] **Step 5: Integrate analysis after mutation batches are built**

Add imports and extend `TraceInterpretation`:

```ts
behavioralAnalysis: BehavioralAnalysis;
```

Then:

```ts
const behavioralObservations = buildBehavioralObservations(
  runtimeStates,
  mutationBatches
);
const behavioralAnalysis = analyzeBehavioralPatternsSafely(
  behavioralObservations
);
```

Return it beside the existing arrays.

Do not move behavioral analysis into `buildVisualState()`; it remains structure-neutral.

- [ ] **Step 6: Run integration regressions and commit**

```bash
npx vitest run tests/core/trace-interpreter.test.ts tests/core/behavioral-analyzer.test.ts tests/core/visual-model.test.ts tests/core/linked-list-interpreter.test.ts
npm run typecheck
git add src/core/trace-interpreter.ts tests/core/trace-interpreter.test.ts
git commit -m "feat: attach behavioral analysis to traces"
```

---

### Task 7: Render `Behavioral Signals` Without Changing Raw Trace Navigation

**Files:**
- Create: `src/sidepanel/components/BehavioralSignals.ts`
- Create: `tests/sidepanel/behavioral-signals.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

**Interfaces:**
- Consumes: `BehavioralAnalysis`, current runtime step number.
- Produces:

```ts
export function createBehavioralSignals(
  analysis: BehavioralAnalysis,
  currentStep: number
): HTMLDivElement;
```

- [ ] **Step 1: Write pure renderer tests for all pattern kinds**

Create a fixed `BehavioralAnalysis` containing one `repeated_state`, one `no_progress`, and one `repeated_transition` pattern. Assert rendered text includes:

```text
Repeated state × 3
solve · line 5
No observable progress
Repeated transition motif × 3
3-step pattern
```

and explicitly:

```ts
expect(element.textContent).not.toMatch(/infinite loop|TLE|bug|fix/i);
```

Add an empty-analysis test expecting:

```text
No repeated behavioral signal in the captured trace.
```

- [ ] **Step 2: Implement pure DOM rendering**

`BehavioralSignals.ts` should map pattern kinds to factual title/detail copy:

```ts
function title(pattern: BehavioralPattern): string {
  switch (pattern.kind) {
    case "repeated_state":
      return `Repeated state × ${pattern.repeatCount}`;
    case "no_progress":
      return `No observable progress · ${pattern.revisitCount} revisits`;
    case "repeated_transition":
      return `Repeated transition motif × ${pattern.repeatCount}`;
  }
}
```

Details:

```text
Repeated state:
  <function> · line <n> revisited the same observable state.

No progress:
  Captured state stayed exact-equal across consecutive visits to <function> · line <n>.

Repeated transition:
  <period>-step pattern across captured steps <start>–<end>.
```

Mark a row `.is-active` when `pattern.evidenceSteps.includes(currentStep)`.

- [ ] **Step 3: Add the panel to `TraceVisualizer.ts`**

Create:

```ts
const behavioralPanel = createPanel(
  "Behavioral Signals",
  "trace-viewer__behavioral-panel",
  true
);
```

Append inspector panels in this order:

```ts
inspectorGrid.append(
  changesPanel.panel,
  behavioralPanel.panel,
  localsPanel.panel
);
```

In both the empty-step and normal `setStep()` branches, replace the behavioral panel body with `createBehavioralSignals(...)`.

Use `state?.step ?? currentIndex + 1` for normal active-step highlighting.

Do not change `currentIndex`, previous/next/play behavior, or displayed total steps.

- [ ] **Step 4: Add minimal CSS only for the new component**

Add `.trace-viewer__behavioral-signals`, `.trace-viewer__behavioral-signal`, `.is-active`, title, and detail rules. Match existing panel typography/spacing; do not redesign unrelated components.

- [ ] **Step 5: Extend the existing TraceVisualizer integration tests**

In `tests/sidepanel/trace-visualizer.test.ts`, assert:

```ts
expect(panelTitles).toContain("What Changed");
expect(panelTitles).toContain("Behavioral Signals");
```

Add a repeated trace fixture and assert the signal text appears. Step navigation must still display the original raw `Step N / total` count after next/previous clicks.

- [ ] **Step 6: Run Side Panel tests and commit**

```bash
npx vitest run tests/sidepanel/behavioral-signals.test.ts tests/sidepanel/trace-visualizer.test.ts tests/sidepanel/bootstrap.test.ts tests/core/trace-interpreter.test.ts
npm run typecheck
git add src/sidepanel/components/BehavioralSignals.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/behavioral-signals.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: show behavioral runtime signals"
```

---

### Task 8: Verify Failure-Prefix Behavior Without Adding Diagnosis

**Files:**
- Modify: `tests/execution/execution-controller.test.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `tests/core/trace-interpreter.test.ts`

**Interfaces:**
- No new production interface.
- Verifies existing timeout/runtime-error prefix behavior works with behavioral analysis.

- [ ] **Step 1: Add hard-timeout prefix retention to the existing controller timeout test suite**

In `tests/execution/execution-controller.test.ts`, create a test using `ControlledWorker` and fake timers:

```ts
it("retains streamed trace events when a running request reaches hard timeout", async () => {
  vi.useFakeTimers();
  try {
    const worker = new ControlledWorker();
    const controller = new ExecutionController({ workerFactory: () => worker });
    const pending = controller.execute(request("timeout-prefix", 20));

    worker.emit({ type: "ready" });
    await Promise.resolve();
    worker.emit({
      type: "trace_batch",
      sessionId: "timeout-prefix",
      events: [{
        step: 1,
        event: "line",
        frameId: 1,
        parentFrameId: null,
        function: "one",
        line: 2,
        callDepth: 1,
        locals: { value: { type: "int", value: "1" } },
        stdoutDelta: ""
      }]
    });

    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;

    expect(result).toEqual(expect.objectContaining({
      status: "timeout",
      terminationReason: "hard_timeout"
    }));
    expect(result.events).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
```

Use the controller's actual returned `TraceSession` field names; this test is expected to compile against the current interface without production changes.

- [ ] **Step 2: Add runtime-error-prefix behavioral interpretation**

In `tests/core/trace-interpreter.test.ts`, build at least three repeated motif cycles followed by an exception event. Assert behavioral evidence still exists and exception state remains reconstructed.

Do not assert that the repeated behavior caused the exception.

- [ ] **Step 3: Add a hard-timeout Side Panel fixture with captured repeated events**

In `tests/sidepanel/trace-visualizer.test.ts`, create a session by spreading the existing `session()` fixture and overriding:

```ts
status: "timeout",
terminationReason: "hard_timeout",
events: repeatedEvents
```

where `repeatedEvents` contain enough exact repeated anchor observations for a signal.

Assert:

```ts
expect(view.element.textContent).toContain("hard timeout");
expect(view.element.textContent).toContain("Behavioral Signals");
expect(view.element.textContent).toContain("No observable progress");
expect(view.element.textContent).not.toContain("LeetCode TLE");
```

- [ ] **Step 4: Reconfirm finite repetition is not treated as failure**

In the same Side Panel test file, render a completed finite counter-loop session that creates `RepeatedTransitionPattern` but no `NoProgressPattern`.

Assert:

```ts
expect(view.element.textContent).toContain("Repeated transition motif");
expect(view.element.textContent).not.toContain("No observable progress");
```

- [ ] **Step 5: Run failure-prefix regressions and commit**

```bash
npx vitest run tests/execution/execution-controller.test.ts tests/core/trace-interpreter.test.ts tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
git add tests/execution/execution-controller.test.ts tests/core/trace-interpreter.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "test: cover behavioral trace prefixes"
```

---

### Task 9: Remove Python Cache Artifacts and Add Minimal CI

**Files:**
- Modify: `.gitignore`
- Delete tracked: `src/worker/python/__pycache__/...`
- Delete tracked: `tests/fixtures/python/__pycache__/...`
- Create: `.github/workflows/ci.yml`

**Interfaces:** none.

- [ ] **Step 1: Ignore Python cache files**

Append without removing existing rules:

```gitignore
__pycache__/
*.py[cod]
.pytest_cache/
```

- [ ] **Step 2: Remove tracked bytecode/cache directories**

```bash
git rm -r src/worker/python/__pycache__ tests/fixtures/python/__pycache__
```

- [ ] **Step 3: Verify no tracked cache remains**

```bash
git ls-files | grep -E '(^|/)__pycache__/|\.py[co]$' && exit 1 || true
```

Expected: no matches.

- [ ] **Step 4: Add `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Test
        run: npm test

      - name: Typecheck
        run: npm run typecheck

      - name: Build
        run: npm run build
```

- [ ] **Step 5: Run local repository gates**

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .github/workflows/ci.yml
git add -u src/worker/python tests/fixtures/python
git commit -m "ci: add repository validation workflow"
```

---

### Task 10: Synchronize README Architecture and Run Final Acceptance

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`

**Interfaces:** documentation only.

- [ ] **Step 1: Update the English pipeline to the implemented architecture**

Use:

```text
Current Python code + selected testcase case
                ↓
Live scheduler (debounce + latest-wins)
                ↓
Warm bundled Pyodide Web Worker
                ↓
Ordered line-level execution trace
                ↓
RuntimeState + FrameDiff/ObjectDiff
                ↓
RuntimeMutation + BehavioralPattern
                ↓
Visual interpretation + Behavioral Signals
                ↓
Chrome Side Panel
```

- [ ] **Step 2: Document the new factual capability without overclaiming**

Add a feature bullet equivalent to:

```markdown
- factual behavioral signals for repeated observable state, no observable progress at a repeated execution anchor, and repeated execution/mutation motifs;
```

Keep the existing `completed != Accepted` and local timeout `!= LeetCode TLE` boundaries. Add one sentence that behavioral repetition is evidence and does not by itself diagnose an infinite loop.

- [ ] **Step 3: Add current project-document links**

Add:

```markdown
- [Linked List Visualization Design Spec](docs/superpowers/specs/2026-09-07-visualization-coverage-linked-list-design.md)
- [Linked List Visualization Implementation Plan](docs/superpowers/plans/2026-09-07-linked-list-visualization-implementation-plan.md)
- [Runtime Mutation Semantics Design Spec](docs/superpowers/specs/2026-09-08-runtime-mutation-semantics-design.md)
- [Runtime Mutation Semantics Implementation Plan](docs/superpowers/plans/2026-09-08-runtime-mutation-semantics-implementation-plan.md)
- [Behavioral Debugging Foundation Design Spec](docs/superpowers/specs/2026-09-08-behavioral-debugging-foundation-design.md)
- [Behavioral Debugging Foundation Implementation Plan](docs/superpowers/plans/2026-09-08-behavioral-debugging-foundation-implementation-plan.md)
```

- [ ] **Step 4: Mirror the same architecture and boundaries in `README.zh-TW.md`**

Keep code/type names in English. Use factual Traditional Chinese wording for:

```text
重複可觀察狀態
同一 execution anchor 沒有可觀察進展
重複 execution / mutation motif
```

Do not translate this into an infinite-loop diagnosis.

- [ ] **Step 5: Verify README links and claims**

```bash
for path in \
  docs/superpowers/specs/2026-09-07-visualization-coverage-linked-list-design.md \
  docs/superpowers/plans/2026-09-07-linked-list-visualization-implementation-plan.md \
  docs/superpowers/specs/2026-09-08-runtime-mutation-semantics-design.md \
  docs/superpowers/plans/2026-09-08-runtime-mutation-semantics-implementation-plan.md \
  docs/superpowers/specs/2026-09-08-behavioral-debugging-foundation-design.md \
  docs/superpowers/plans/2026-09-08-behavioral-debugging-foundation-implementation-plan.md; do
  test -f "$path" || exit 1
done

! grep -Ei 'infinite loop detected|LeetCode TLE detected|correctness detected' README.md README.zh-TW.md
```

Expected: success.

- [ ] **Step 6: Run final full verification**

```bash
python -m pytest tests/fixtures/python -q
npm test
npm run typecheck
npm run build
git ls-files | grep -E '(^|/)__pycache__/|\.py[co]$' && exit 1 || true
```

Required outcomes:

```text
Python topology/serializer/tracer fixtures PASS
Vitest PASS
TypeScript typecheck PASS
all Vite builds PASS
no tracked Python cache artifacts
RepeatedStatePattern requires 3 exact complete matches at one anchor
NoProgressPattern requires consecutive exact-equal visits at one anchor
finite changing repetition may produce RepeatedTransitionPattern without NoProgressPattern
truncated state cannot prove RepeatedStatePattern or NoProgressPattern
Behavioral Signals contain no infinite-loop/TLE diagnosis
raw trace navigation and existing visualizers remain intact
```

- [ ] **Step 7: Commit docs**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: document behavioral debugging architecture"
```

- [ ] **Step 8: Verify the pushed head through GitHub Actions**

After pushing the implementation head, inspect the Actions run for that commit and require the `validate` job to succeed before declaring this milestone complete.

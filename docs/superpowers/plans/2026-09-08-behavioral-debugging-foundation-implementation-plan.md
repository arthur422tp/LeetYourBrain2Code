# Behavioral Debugging Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, deterministic `RuntimeMutation[] -> BehavioralPattern[]` analysis layer with factual repeated-state / no-progress / repeated-transition signals, while fixing container-reachable topology capture and repository maintenance gaps.

**Architecture:** Keep runtime capture, raw diffs, and `RuntimeMutation` as the factual lower layers. Add focused TypeScript modules for behavioral contracts, observation construction, and bounded pattern analysis; expose one `BehavioralAnalysis` from `interpretTrace()` and render it through a dedicated Side Panel component. In parallel, repair Python topology traversal so supported built-in containers can expose reachable user objects without executing arbitrary iterators.

**Tech Stack:** TypeScript 5.8, Vitest 3, Vite 6, Chrome Manifest V3 Side Panel, Pyodide 0.29, Python runtime tracer/serializer fixtures, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-behavioral-debugging-foundation-design.md`

## Global Constraints

- Behavioral output is factual evidence, not diagnosis: do not emit infinite-loop, TLE, WA, bug-fix, or correctness claims.
- Source locations are observation anchors only; do not claim source-line causal attribution.
- Exact repeated-state and no-progress evidence require complete captured state and exact normalized equality after candidate fingerprint matching.
- `RepeatedTransitionPattern` operates on execution location plus normalized mutation shape and includes explicit no-mutation transitions.
- Initial-snapshot mutation events must not count as ordinary repeated runtime transitions.
- Analysis defaults: `behaviorWindowSteps = 256`, `minPatternRepeats = 3`, `maxPatternPeriod = 32`, `maxPatternsPerTrace = 64`.
- Behavioral analysis must be bounded; avoid unrestricted all-pairs full-trace comparison.
- Pattern analysis failure must not invalidate an otherwise renderable trace.
- Container topology traversal supports only exact built-in `list`, `tuple`, `dict`, `set`, and `frozenset`; do not execute arbitrary iterators or user methods.
- Topology traversal remains bounded by `maxContainerItems`, `maxObjectNodes`, `maxObjectAttributes`, `maxObjectDepth`, and existing session byte limits.
- Truncated/partial capture cannot prove exact repeated-state or no-progress patterns.
- Preserve existing List / Dict / Linked List behavior, mutation-driven candidate ranking, `What Changed`, call stack, stdout, exception, and trace-prefix behavior.
- Do not add Tree / Graph / DP visualizers, backend persistence, cross-execution object identity, or revision matching in this milestone.
- CI uses Node.js 22 and runs the repository's existing validation commands: `npm ci`, `npm test`, `npm run typecheck`, `npm run build`.

## File Structure

New focused TypeScript units:

```text
src/core/behavioral-pattern.ts
    BehavioralPattern contracts and BehavioralAnalysis result types.

src/core/behavioral-observation.ts
    RuntimeState + RuntimeMutationBatch -> BehavioralObservation normalization,
    completeness checks, canonical exact-state keys, candidate fingerprints,
    and transition-shape keys.

src/core/behavioral-analyzer.ts
    Bounded repeated-state, no-progress, and repeated-transition detection.

src/sidepanel/components/BehavioralSignals.ts
    Pure DOM rendering for factual BehavioralPattern summaries.
```

New tests:

```text
tests/core/behavioral-observation.test.ts
tests/core/behavioral-analyzer.test.ts
tests/sidepanel/behavioral-signals.test.ts
tests/fixtures/python/test_object_topology.py
```

Existing files modified by responsibility:

```text
src/worker/python/object_topology.py
    Traverse supported built-in containers while preserving topology bounds.

src/core/trace-interpreter.ts
    Build observations, analyze patterns, expose BehavioralAnalysis.

src/sidepanel/components/TraceVisualizer.ts
    Add Behavioral Signals panel without changing trace navigation semantics.

src/sidepanel/styles.css
    Minimal Behavioral Signals presentation.

.gitignore
    Ignore Python cache artifacts.

.github/workflows/ci.yml
    Run test/typecheck/build gates.

README.md
README.zh-TW.md
    Synchronize architecture and project-document links.
```

Implementation clarification for one spec ambiguity:

```text
RepeatedStatePattern
    may report recurrence of the same complete state at the same anchor even
    if different states occurred at that anchor between matching observations.

NoProgressPattern
    is stricter: it requires consecutive observations of that same anchor to
    remain exact-equal for the threshold run. A different exact state observed
    at that anchor resets the no-progress run.
```

This preserves the spec's intent that no-progress is stricter than recurrence and prevents every repeated-state cycle from becoming a no-progress claim.

---

### Task 1: Repair Container-Reachable Object Topology Capture

**Files:**
- Modify: `src/worker/python/object_topology.py`
- Create: `tests/fixtures/python/test_object_topology.py`
- Modify: `tests/execution/pyodide-runtime.test.ts`

**Interfaces:**
- Consumes: existing `ObjectTopologyCollector.capture(roots)` and trace limits.
- Produces: the same `{ "objects": [...], "truncated": bool }` schema, now discovering user objects reachable through exact built-in containers.
- Must not change: `TraceEvent.objects`, `TraceEvent.objectsTruncated`, object identity scope, or worker protocol.

- [ ] **Step 1: Add Python fixture helpers and failing direct-container reachability test**

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
        "max_object_nodes": 200,
        "max_object_attributes": 20,
        "max_object_depth": 32,
        "max_nesting_depth": 12,
        "max_snapshot_bytes": 256_000,
    }
    limits.update(overrides)
    return ObjectTopologyCollector(limits)


def object_values(topology):
    return sorted(
        int(obj["attributes"]["value"]["value"])
        for obj in topology["objects"]
    )


def test_list_root_discovers_user_objects_inside_container():
    first = Node(1)
    second = Node(2)

    topology = collector().capture([[first, second]])

    assert object_values(topology) == [1, 2]
    assert topology["truncated"] is False
```

- [ ] **Step 2: Run the focused Python test and verify current failure**

Run:

```bash
python -m pytest tests/fixtures/python/test_object_topology.py -q
```

Expected: FAIL because the current collector treats the list root as a traversal dead end and captures no nodes.

- [ ] **Step 3: Add exact-built-in container classification and bounded child extraction**

Modify `ObjectTopologyCollector.__init__()` to reuse the serializer's container-item limit:

```python
self.max_container_items = max(
    0, int(_limit(limits, "max_container_items", "maxContainerItems", 1000))
)
```

Add helpers:

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
            children.append(key)
            children.append(item)
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

Do not replace this with `iter(value)` for arbitrary values.

- [ ] **Step 4: Split traversal identities from captured object-node identities**

At the start of `capture()` use separate visited sets:

```python
visited_objects = set()
visited_containers = set()
```

Replace the current queue loop with this control flow:

```python
while queue:
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

    if not self._is_object_node(value):
        continue

    identity = id(value)
    if identity in visited_objects:
        continue
    visited_objects.add(identity)

    # keep the existing max_object_nodes / attribute capture path below
```

When object attributes are captured, enqueue both supported traversal containers and user-object nodes:

```python
if self._is_object_node(attribute_value) or self._is_traversal_container(attribute_value):
    queue.append((attribute_value, depth + 1))
```

- [ ] **Step 5: Add bounds, nested-container, dict/set, and cycle tests**

Append tests covering the spec's required cases:

```python
def test_nested_containers_discover_objects():
    node = Node(7)
    topology = collector().capture([{"nodes": ([node],)}])
    assert object_values(topology) == [7]


def test_dict_keys_and_values_are_traversed():
    key = Node(1)
    value = Node(2)
    topology = collector().capture([{key: value}])
    assert object_values(topology) == [1, 2]


def test_set_and_frozenset_are_traversed():
    left = Node(3)
    right = Node(4)
    topology = collector().capture([{left}, frozenset({right})])
    assert object_values(topology) == [3, 4]


def test_container_cycle_terminates():
    root = []
    root.append(root)
    topology = collector().capture([root])
    assert topology == {"objects": [], "truncated": False}


def test_container_item_bound_marks_topology_truncated():
    roots = [Node(1), Node(2), Node(3)]
    topology = collector(max_container_items=2).capture([roots])
    assert object_values(topology) == [1, 2]
    assert topology["truncated"] is True


def test_container_membership_consumes_topology_depth():
    node = Node(9)
    topology = collector(max_object_depth=0).capture([[node]])
    assert topology["objects"] == []
    assert topology["truncated"] is True
```

Also add object -> container -> object traversal:

```python
def test_object_attribute_container_can_reach_more_objects():
    parent = Node(1)
    child = Node(2)
    parent.children = [child]

    topology = collector().capture([parent])

    assert object_values(topology) == [1, 2]
```

- [ ] **Step 6: Run Python topology fixtures**

Run:

```bash
python -m pytest tests/fixtures/python/test_object_topology.py tests/fixtures/python/test_serializer.py tests/fixtures/python/test_trace_engine.py -q
```

Expected: PASS.

- [ ] **Step 7: Add one TypeScript runtime regression assertion**

In `tests/execution/pyodide-runtime.test.ts`, extend the existing `buildExecutionScript()` test so the embedded topology module proves the new bound is wired into the worker bundle:

```ts
expect(script).toContain("max_container_items");
expect(script).toContain("_is_traversal_container");
expect(script).toContain("_container_children");
```

This does not replace Python behavioral tests; it protects bundling of the changed source.

- [ ] **Step 8: Run focused TypeScript tests and typecheck**

Run:

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts tests/core/state-reconstructor.test.ts tests/core/linked-list-interpreter.test.ts
npm run typecheck
```

Expected: PASS with existing Linked List behavior unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/worker/python/object_topology.py tests/fixtures/python/test_object_topology.py tests/execution/pyodide-runtime.test.ts
git commit -m "fix: traverse containers in object topology"
```

---

### Task 2: Define Behavioral Contracts and Exact Observable-State Normalization

**Files:**
- Create: `src/core/behavioral-pattern.ts`
- Create: `src/core/behavioral-observation.ts`
- Create: `tests/core/behavioral-observation.test.ts`
- Modify: `src/core/value-snapshot.ts`
- Modify: `tests/core/value-snapshot.test.ts`

**Interfaces:**
- Consumes: `RuntimeState`, `RuntimeMutationBatch`, `ValueSnapshot`, `valueSnapshotKey()`.
- Produces:
  - `BehavioralObservation`
  - `ExecutionLocation`
  - `StateFingerprint`
  - `TransitionFingerprint`
  - `BehavioralPattern` union and `BehavioralAnalysis`
  - `buildBehavioralObservations(runtimeStates, mutationBatches)`
  - `isValueSnapshotComplete(snapshot)`
- Later tasks rely on the exact names below.

- [ ] **Step 1: Create the behavioral pattern contracts**

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

- [ ] **Step 2: Add recursive snapshot-completeness tests**

Extend `tests/core/value-snapshot.test.ts` with cases like:

```ts
import { isValueSnapshotComplete } from "../../src/core/value-snapshot";

it("treats recursively truncated snapshots as incomplete", () => {
  expect(isValueSnapshotComplete({
    type: "list",
    length: 1,
    truncated: false,
    items: [{ type: "str", value: "abc", length: 9, truncated: true }]
  })).toBe(false);
});

it("treats complete nested snapshots as complete", () => {
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

it("treats explicitly truncated unknown snapshots as incomplete", () => {
  expect(isValueSnapshotComplete({
    type: "unknown",
    className: "Thing",
    repr: "<snapshot truncated>",
    truncated: true
  })).toBe(false);
});
```

- [ ] **Step 3: Implement `isValueSnapshotComplete()`**

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
        isValueSnapshotComplete(entry.key) && isValueSnapshotComplete(entry.value)
      );
    case "unknown":
      return snapshot.truncated !== true;
    default:
      return true;
  }
}
```

Run:

```bash
npx vitest run tests/core/value-snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 4: Create observation contracts with exact-state evidence separated from candidate fingerprint**

Create `src/core/behavioral-observation.ts` with these exported types:

```ts
import type { RuntimeMutationBatch } from "./runtime-mutation";
import type { RuntimeState } from "./runtime-state";
import type { ExecutionLocation } from "./behavioral-pattern";

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

`normalizedStateKey` is the exact canonical equality evidence. `StateFingerprint.key` is only an indexing accelerator; analyzers must compare both.

- [ ] **Step 5: Write failing observation tests for exact state, stdout, frame identity, and truncation**

Create `tests/core/behavioral-observation.test.ts` with small builders:

```ts
import { describe, expect, it } from "vitest";
import { buildBehavioralObservations } from "../../src/core/behavioral-observation";
import type { RuntimeState } from "../../src/core/runtime-state";
import type { RuntimeMutationBatch } from "../../src/core/runtime-mutation";

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

Add assertions:

```ts
it("keeps exact equality evidence separate from the candidate fingerprint", () => {
  const observations = buildBehavioralObservations(
    [state({ step: 1 }), state({ step: 2 })],
    [batch(1), batch(2)]
  );

  expect(observations[0]!.stateFingerprint?.key)
    .toBe(observations[1]!.stateFingerprint?.key);
  expect(observations[0]!.normalizedStateKey)
    .toBe(observations[1]!.normalizedStateKey);
});

it("includes stdout progress in exact state evidence", () => {
  const observations = buildBehavioralObservations(
    [state({ step: 1, stdout: "" }), state({ step: 2, stdout: "x" })],
    [batch(1), batch(2)]
  );
  expect(observations[0]!.normalizedStateKey)
    .not.toBe(observations[1]!.normalizedStateKey);
});

it("keeps frame identity in the execution anchor", () => {
  const second = state({
    step: 2,
    activeFrameId: 2,
    frames: new Map([[2, {
      frameId: 2,
      parentFrameId: null,
      functionName: "solve",
      line: 5,
      locals: { left: { type: "int", value: "2" } }
    }]]),
    callStack: [2]
  });
  const observations = buildBehavioralObservations(
    [state({ step: 1 }), second],
    [batch(1), { ...batch(2), frameId: 2 }]
  );
  expect(observations[0]!.locationKey).not.toBe(observations[1]!.locationKey);
});

it("marks topology-truncated state incomplete", () => {
  const [observation] = buildBehavioralObservations([
    state({ objectTopology: { objects: new Map(), truncated: true } })
  ], [batch(1)]);
  expect(observation!.stateFingerprint?.complete).toBe(false);
});
```

- [ ] **Step 6: Implement canonical observable-state construction**

In `behavioral-observation.ts`, build a canonical normalized key containing all current call-stack frames, not only the active frame. This is stronger than the minimum spec requirement and avoids missing visible parent-frame state.

Use helpers with deterministic ordering:

```ts
import { isValueSnapshotComplete, valueSnapshotKey } from "./value-snapshot";
import type { ObjectSnapshot } from "../shared/trace-types";

function canonicalLocals(locals: Record<string, import("../shared/trace-types").ValueSnapshot>) {
  return Object.entries(locals)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, valueSnapshotKey(value)] as const);
}

function canonicalObject(object: ObjectSnapshot) {
  return {
    objectId: object.objectId,
    className: object.className,
    attributes: Object.entries(object.attributes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, valueSnapshotKey(value)] as const)
  };
}
```

Construct `normalizedStateKey` from:

```ts
JSON.stringify({
  activeFrameId: runtime.activeFrameId,
  callStack: runtime.callStack.map((frameId) => {
    const frame = runtime.frames.get(frameId);
    return frame ? {
      frameId: frame.frameId,
      parentFrameId: frame.parentFrameId,
      functionName: frame.functionName,
      line: frame.line,
      locals: canonicalLocals(frame.locals),
      returnValue: frame.returnValue ? valueSnapshotKey(frame.returnValue) : null,
      exception: frame.exception ?? null
    } : { frameId, missing: true };
  }),
  objects: [...runtime.objectTopology.objects.values()]
    .sort((left, right) => left.objectId.localeCompare(right.objectId))
    .map(canonicalObject),
  stdoutLength: runtime.stdout.length,
  exception: runtime.exception ?? null
});
```

Do not include `runtime.step` or the active line anchor in this exact state key; location equality is enforced separately by the analyzer.

- [ ] **Step 7: Implement completeness calculation and deterministic candidate fingerprint**

A runtime state is complete only when:

```ts
function runtimeStateIsComplete(runtime: RuntimeState): boolean {
  if (runtime.objectTopology.truncated) {
    return false;
  }
  for (const frameId of runtime.callStack) {
    const frame = runtime.frames.get(frameId);
    if (!frame) {
      return false;
    }
    if (!Object.values(frame.locals).every(isValueSnapshotComplete)) {
      return false;
    }
    if (frame.returnValue && !isValueSnapshotComplete(frame.returnValue)) {
      return false;
    }
  }
  return [...runtime.objectTopology.objects.values()].every((object) =>
    Object.values(object.attributes).every(isValueSnapshotComplete)
  );
}
```

Add a dependency-free stable FNV-1a helper for candidate indexing:

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
stateFingerprint: {
  key: fnv1a(normalizedStateKey),
  complete: runtimeStateIsComplete(runtime)
}
```

The later analyzer must still compare `normalizedStateKey` exactly.

- [ ] **Step 8: Run focused tests**

Run:

```bash
npx vitest run tests/core/value-snapshot.test.ts tests/core/behavioral-observation.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit contracts and exact-state normalization**

```bash
git add src/core/behavioral-pattern.ts src/core/behavioral-observation.ts src/core/value-snapshot.ts tests/core/behavioral-observation.test.ts tests/core/value-snapshot.test.ts
git commit -m "feat: normalize behavioral observations"
```

---

### Task 3: Normalize Transition Shapes from Runtime Mutations

**Files:**
- Modify: `src/core/behavioral-observation.ts`
- Modify: `tests/core/behavioral-observation.test.ts`

**Interfaces:**
- Consumes: ordered `RuntimeMutationBatch.mutations`.
- Produces: `BehavioralObservation.transitionFingerprint` with a deterministic `location + mutation-shape` key and `eligible` flag.
- Must ignore concrete changing values for repeated-transition matching while preserving semantic target shape.

- [ ] **Step 1: Add failing tests for value-insensitive mutation shapes**

Append to `tests/core/behavioral-observation.test.ts`:

```ts
it("normalizes changing scalar values to the same transition shape", () => {
  const runtimeStates = [state({ step: 1 }), state({ step: 2 })];
  const mutationBatches: RuntimeMutationBatch[] = [
    {
      step: 1,
      frameId: 1,
      currentLine: 5,
      mutations: [{
        kind: "variable",
        origin: "transition",
        frameId: 1,
        variableName: "i",
        action: "changed",
        before: { type: "int", value: "0" },
        after: { type: "int", value: "1" }
      }]
    },
    {
      step: 2,
      frameId: 1,
      currentLine: 5,
      mutations: [{
        kind: "variable",
        origin: "transition",
        frameId: 1,
        variableName: "i",
        action: "changed",
        before: { type: "int", value: "1" },
        after: { type: "int", value: "2" }
      }]
    }
  ];

  const observations = buildBehavioralObservations(runtimeStates, mutationBatches);
  expect(observations[0]!.transitionFingerprint.key)
    .toBe(observations[1]!.transitionFingerprint.key);
});
```

- [ ] **Step 2: Add tests for wildcard sequence/object targets and explicit empty transitions**

```ts
it("wildcards sequence indexes for transition-shape matching", () => {
  // nums[0] and nums[1] both become sequence:nums[*]:changed:int->int
});

it("wildcards object ids for object-attribute transition shapes", () => {
  // obj-1.next and obj-2.next redirects share an object_attribute:*.next shape
});

it("keeps no-mutation line observations in transition fingerprints", () => {
  const [observation] = buildBehavioralObservations([state()], [batch(1)]);
  expect(observation!.transitionFingerprint.key).toContain("|none");
  expect(observation!.transitionFingerprint.eligible).toBe(true);
});

it("marks initialization-only transitions ineligible", () => {
  const [observation] = buildBehavioralObservations([state()], [{
    step: 1,
    frameId: 1,
    currentLine: 5,
    mutations: [{
      kind: "variable",
      origin: "initial_snapshot",
      frameId: 1,
      variableName: "i",
      action: "added",
      after: { type: "int", value: "0" }
    }]
  }]);
  expect(observation!.transitionFingerprint.eligible).toBe(false);
});
```

- [ ] **Step 3: Implement semantic value-type and mutation-shape helpers**

Add helpers to `behavioral-observation.ts`:

```ts
import type { RuntimeMutation } from "./runtime-mutation";
import type { ValueSnapshot } from "../shared/trace-types";

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

Do not include concrete scalar values, concrete sequence indexes, object IDs, mapping keys, or set members in this shape key.

- [ ] **Step 4: Build location-aware transition fingerprints**

Use the current behavioral location:

```ts
function locationKey(location: ExecutionLocation): string {
  return `${location.frameId}:${location.functionName}:${location.line}`;
}
```

Build ordered shapes only from `origin === "transition"` mutations:

```ts
const transitionMutations = batch.mutations.filter((mutation) =>
  mutation.origin === "transition"
);
const hasInitialization = batch.mutations.some((mutation) =>
  mutation.origin === "initial_snapshot"
);
const eligible = !hasInitialization;
const shape = transitionMutations.length === 0
  ? "none"
  : transitionMutations.map(mutationShapeKey).join(";");
const key = location === null ? `no-location|${shape}` : `${locationKey(location)}|${shape}`;
```

If a batch somehow mixes `initial_snapshot` and transition mutations, keep it ineligible for motif matching in v0.1; that is the conservative policy required by the spec.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npx vitest run tests/core/behavioral-observation.test.ts tests/core/runtime-mutation-normalizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/behavioral-observation.ts tests/core/behavioral-observation.test.ts
git commit -m "feat: normalize behavioral transition shapes"
```

---

### Task 4: Detect Repeated State and Conservative No-Progress Runs

**Files:**
- Create: `src/core/behavioral-analyzer.ts`
- Create: `tests/core/behavioral-analyzer.test.ts`

**Interfaces:**
- Consumes: `BehavioralObservation[]`.
- Produces: `analyzeBehavioralPatterns(observations): BehavioralAnalysis`.
- Repeated-state candidate bucketing uses `locationKey + stateFingerprint.key`; factual equality additionally requires equal `normalizedStateKey` and `complete === true`.

- [ ] **Step 1: Create analyzer entry point returning an empty typed result**

Start `src/core/behavioral-analyzer.ts` with:

```ts
import {
  BEHAVIOR_WINDOW_STEPS,
  EMPTY_BEHAVIORAL_ANALYSIS,
  MAX_PATTERNS_PER_TRACE,
  MIN_PATTERN_REPEATS,
  type BehavioralAnalysis,
  type BehavioralPattern,
  type NoProgressPattern,
  type RepeatedStatePattern
} from "./behavioral-pattern";
import type { BehavioralObservation } from "./behavioral-observation";

export function analyzeBehavioralPatterns(
  observations: BehavioralObservation[]
): BehavioralAnalysis {
  if (observations.length === 0) {
    return EMPTY_BEHAVIORAL_ANALYSIS;
  }
  return { patterns: [], stepAnnotations: [] };
}
```

- [ ] **Step 2: Write failing repeated-state tests**

In `tests/core/behavioral-analyzer.test.ts`, use an observation builder that lets tests control location, candidate hash, exact key, completeness, and transition key:

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

Add:

```ts
it("emits repeated-state evidence after three exact complete matches", () => {
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

it("does not trust a fingerprint collision without exact-key equality", () => {
  const first = observation(1, "state-a");
  const second = observation(4, "state-b", {
    stateFingerprint: { key: first.stateFingerprint!.key, complete: true }
  });
  const third = observation(7, "state-c", {
    stateFingerprint: { key: first.stateFingerprint!.key, complete: true }
  });
  expect(analyzeBehavioralPatterns([first, second, third]).patterns)
    .not.toContainEqual(expect.objectContaining({ kind: "repeated_state" }));
});

it("suppresses exact-state claims for incomplete observations", () => {
  const values = [1, 4, 7].map((step) => observation(step, "same", {
    stateFingerprint: { key: "same", complete: false }
  }));
  expect(analyzeBehavioralPatterns(values).patterns)
    .not.toContainEqual(expect.objectContaining({ kind: "repeated_state" }));
});
```

Also add a different-frame test and a threshold-of-two test.

- [ ] **Step 3: Implement bounded repeated-state bucketing**

Analyze only the trailing configured window:

```ts
const window = observations.slice(-BEHAVIOR_WINDOW_STEPS);
```

Bucket only complete location/state observations:

```ts
const candidates = new Map<string, BehavioralObservation[]>();
for (const current of window) {
  if (
    current.locationKey === null ||
    current.stateFingerprint === null ||
    current.normalizedStateKey === null ||
    !current.stateFingerprint.complete
  ) {
    continue;
  }
  const bucketKey = `${current.locationKey}|${current.stateFingerprint.key}`;
  const bucket = candidates.get(bucketKey) ?? [];
  bucket.push(current);
  candidates.set(bucketKey, bucket);
}
```

Within each candidate bucket, group again by exact `normalizedStateKey`. Only exact groups with `length >= MIN_PATTERN_REPEATS` emit a `RepeatedStatePattern`.

Use deterministic IDs:

```ts
function patternId(kind: string, startStep: number, endStep: number, suffix: string): string {
  return `${kind}:${startStep}:${endStep}:${suffix}`;
}
```

- [ ] **Step 4: Write failing no-progress tests that distinguish recurrence from consecutive anchor stalls**

Add:

```ts
it("emits no-progress when consecutive visits to an anchor stay exact-equal", () => {
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

it("allows repeated-state recurrence without labeling an interrupted anchor run no-progress", () => {
  const analysis = analyzeBehavioralPatterns([
    observation(1, "same"),
    observation(3, "different"),
    observation(5, "same"),
    observation(7, "same")
  ]);
  expect(analysis.patterns).toContainEqual(expect.objectContaining({
    kind: "repeated_state"
  }));
  expect(analysis.patterns).not.toContainEqual(expect.objectContaining({
    kind: "no_progress",
    startStep: 1
  }));
});
```

Add a test proving empty mutation batches alone do not create no-progress when exact state changes.

- [ ] **Step 5: Implement no-progress run tracking per execution anchor**

For every complete observation at a location, compare it with the previous observation at that same `locationKey`:

```ts
interface ExactRun {
  normalizedStateKey: string;
  fingerprintKey: string;
  observations: BehavioralObservation[];
}

const runs = new Map<string, ExactRun>();
```

Rules:

```text
same location + complete state + same fingerprint + same exact key
    -> append to current run

same location but different/incomplete state
    -> finalize current run if threshold met, then reset
```

At end, finalize remaining runs.

For an emitted `NoProgressPattern`:

```ts
repeatCount = run.observations.length
revisitCount = run.observations.length - 1
```

Do not inspect mutation-count absence to prove no-progress.

- [ ] **Step 6: Add deterministic pattern sorting and cap helper**

Before returning core patterns, sort:

```ts
patterns.sort((left, right) =>
  left.startStep - right.startStep ||
  left.endStep - right.endStep ||
  left.kind.localeCompare(right.kind) ||
  left.patternId.localeCompare(right.patternId)
);
```

Then apply:

```ts
patterns.slice(0, MAX_PATTERNS_PER_TRACE)
```

Do not cap before deterministic sorting.

- [ ] **Step 7: Run focused analyzer tests**

Run:

```bash
npx vitest run tests/core/behavioral-analyzer.test.ts tests/core/behavioral-observation.test.ts
npm run typecheck
```

Expected: PASS for repeated-state and no-progress cases; repeated-transition tests do not exist yet.

- [ ] **Step 8: Commit**

```bash
git add src/core/behavioral-analyzer.ts tests/core/behavioral-analyzer.test.ts
git commit -m "feat: detect repeated runtime state"
```

---

### Task 5: Detect Bounded Repeated Transition Motifs in O(N × MaxPeriod)

**Files:**
- Modify: `src/core/behavioral-analyzer.ts`
- Modify: `tests/core/behavioral-analyzer.test.ts`

**Interfaces:**
- Consumes: `BehavioralObservation.transitionFingerprint`.
- Produces: `RepeatedTransitionPattern` merged into the same `BehavioralAnalysis.patterns` list.
- Complexity: scan each period independently using suffix match lengths; do not compare every possible pair/block in the window.

- [ ] **Step 1: Add failing single-step and multi-step motif tests**

Append tests:

```ts
it("detects a repeated one-step transition motif", () => {
  const values = [1, 2, 3].map((step) => observation(step, `state-${step}`, {
    transitionFingerprint: { key: "1:solve:5|variable:i:changed:int->int", eligible: true }
  }));
  expect(analyzeBehavioralPatterns(values).patterns).toContainEqual(
    expect.objectContaining({
      kind: "repeated_transition",
      periodSteps: 1,
      repeatCount: 3,
      evidenceSteps: [1, 2, 3]
    })
  );
});

it("detects a three-step execution motif repeated three times", () => {
  const keys = ["A", "B", "C", "A", "B", "C", "A", "B", "C"];
  const values = keys.map((key, index) => observation(index + 1, `state-${index}`, {
    transitionFingerprint: { key, eligible: true }
  }));
  expect(analyzeBehavioralPatterns(values).patterns).toContainEqual(
    expect.objectContaining({
      kind: "repeated_transition",
      periodSteps: 3,
      repeatCount: 3,
      motifKeys: ["A", "B", "C"]
    })
  );
});
```

- [ ] **Step 2: Add tests for ineligible initialization and empty transitions**

```ts
it("does not bridge repeated motifs through initialization observations", () => {
  // A, A, init, A, A must not become one 4-repeat run.
});

it("allows explicit no-mutation transitions inside a repeated motif", () => {
  // [condition:none, body:none, increment:changed] repeated 3x.
});
```

- [ ] **Step 3: Implement period-scan matcher with linear work per period**

Add a helper:

```ts
function repeatedTransitionPatterns(
  observations: BehavioralObservation[]
): RepeatedTransitionPattern[] {
  const window = observations.slice(-BEHAVIOR_WINDOW_STEPS);
  const patterns: RepeatedTransitionPattern[] = [];
  const maxPeriod = Math.min(MAX_PATTERN_PERIOD, Math.floor(window.length / MIN_PATTERN_REPEATS));

  for (let period = 1; period <= maxPeriod; period += 1) {
    let matchedSuffix = 0;

    for (let index = period; index < window.length; index += 1) {
      const current = window[index]!;
      const previousPeriod = window[index - period]!;
      const matches =
        current.transitionFingerprint.eligible &&
        previousPeriod.transitionFingerprint.eligible &&
        current.transitionFingerprint.key === previousPeriod.transitionFingerprint.key;

      matchedSuffix = matches ? matchedSuffix + 1 : 0;
      const requiredMatches = period * (MIN_PATTERN_REPEATS - 1);
      if (matchedSuffix < requiredMatches) {
        continue;
      }

      const totalLength = matchedSuffix + period;
      const repeatCount = Math.floor(totalLength / period);
      const startIndex = index - matchedSuffix - period + 1;
      const endIndex = startIndex + repeatCount * period - 1;
      const motif = window.slice(startIndex, startIndex + period);
      const evidence = window.slice(startIndex, endIndex + 1);

      patterns.push({
        kind: "repeated_transition",
        patternId: patternId(
          "repeated_transition",
          evidence[0]!.step,
          evidence[evidence.length - 1]!.step,
          `p${period}`
        ),
        startStep: evidence[0]!.step,
        endStep: evidence[evidence.length - 1]!.step,
        repeatCount,
        evidenceSteps: evidence.map((entry) => entry.step),
        periodSteps: period,
        motifKeys: motif.map((entry) => entry.transitionFingerprint.key)
      });
    }
  }

  return patterns;
}
```

This performs one constant-time transition-key comparison per `(period, index)` pair, approximately `O(N × maxPatternPeriod)`.

- [ ] **Step 4: De-duplicate extensions and prefer minimal equivalent period**

The raw scan can emit the same run multiple times as it extends. Normalize before merging into final patterns.

Use a map keyed by semantic run start + period + motif:

```ts
const byRun = new Map<string, RepeatedTransitionPattern>();
for (const pattern of rawPatterns) {
  const runKey = `${pattern.startStep}|${pattern.periodSteps}|${pattern.motifKeys.join("\u0001")}`;
  const current = byRun.get(runKey);
  if (!current || pattern.endStep > current.endStep) {
    byRun.set(runKey, pattern);
  }
}
```

Then suppress non-minimal periods that describe the exact same `[startStep, endStep]` span with an integer-multiple period and equivalent repeated token sequence.

Implement a helper:

```ts
function isRedundantMultiplePeriod(
  candidate: RepeatedTransitionPattern,
  accepted: RepeatedTransitionPattern
): boolean {
  return candidate.startStep === accepted.startStep &&
    candidate.endStep === accepted.endStep &&
    candidate.periodSteps % accepted.periodSteps === 0 &&
    candidate.evidenceSteps.length === accepted.evidenceSteps.length;
}
```

Process patterns sorted by `periodSteps` ascending before this suppression so the minimal period wins.

- [ ] **Step 5: Add a regression test for extension de-duplication**

```ts
it("extends one repeated-transition run instead of emitting one pattern per repeat", () => {
  const values = Array.from({ length: 6 }, (_, index) => observation(index + 1, `s${index}`, {
    transitionFingerprint: { key: "A", eligible: true }
  }));
  const repeated = analyzeBehavioralPatterns(values).patterns.filter((pattern) =>
    pattern.kind === "repeated_transition"
  );
  expect(repeated).toHaveLength(1);
  expect(repeated[0]).toEqual(expect.objectContaining({
    startStep: 1,
    endStep: 6,
    repeatCount: 6,
    periodSteps: 1
  }));
});
```

- [ ] **Step 6: Merge transition patterns with state/no-progress patterns and build step annotations**

After all pattern families are available, build annotations from final capped patterns:

```ts
function buildStepAnnotations(patterns: BehavioralPattern[]) {
  const patternIdsByStep = new Map<number, string[]>();
  for (const pattern of patterns) {
    for (const step of pattern.evidenceSteps) {
      const ids = patternIdsByStep.get(step) ?? [];
      ids.push(pattern.patternId);
      patternIdsByStep.set(step, ids);
    }
  }
  return [...patternIdsByStep.entries()]
    .sort(([left], [right]) => left - right)
    .map(([step, patternIds]) => ({
      step,
      patternIds: patternIds.sort()
    }));
}
```

Return:

```ts
return {
  patterns: finalPatterns,
  stepAnnotations: buildStepAnnotations(finalPatterns)
};
```

- [ ] **Step 7: Run analyzer tests and typecheck**

Run:

```bash
npx vitest run tests/core/behavioral-analyzer.test.ts tests/core/behavioral-observation.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/behavioral-analyzer.ts tests/core/behavioral-analyzer.test.ts
git commit -m "feat: detect repeated runtime transitions"
```

---

### Task 6: Integrate Behavioral Analysis into `interpretTrace()` and Trace-Prefix Cases

**Files:**
- Modify: `src/core/trace-interpreter.ts`
- Modify: `tests/core/trace-interpreter.test.ts`

**Interfaces:**
- Consumes:
  - `buildBehavioralObservations(runtimeStates, mutationBatches)`
  - `analyzeBehavioralPatterns(observations)`
- Produces: `TraceInterpretation.behavioralAnalysis: BehavioralAnalysis`.
- Must preserve one-to-one lengths for runtime states, diffs, mutation batches, and visual states.

- [ ] **Step 1: Add failing integration assertion for the new interpretation output**

Extend the existing integration-length test:

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

- [ ] **Step 2: Add a synthetic stalled-anchor trace test**

Construct trace events where the same frame returns to line 5 with identical locals three times. The exact event sequence can include intervening lines, but all line-5 anchor states must normalize identically.

Assert:

```ts
expect(result.behavioralAnalysis.patterns).toContainEqual(
  expect.objectContaining({ kind: "repeated_state" })
);
expect(result.behavioralAnalysis.patterns).toContainEqual(
  expect.objectContaining({ kind: "no_progress" })
);
```

Do not assert any `infinite_loop` type.

- [ ] **Step 3: Add a finite changing-loop trace test**

Construct three repeated line motifs where `i` changes on each iteration.

Assert:

```ts
expect(result.behavioralAnalysis.patterns).toContainEqual(
  expect.objectContaining({ kind: "repeated_transition" })
);
expect(result.behavioralAnalysis.patterns).not.toContainEqual(
  expect.objectContaining({ kind: "no_progress" })
);
```

- [ ] **Step 4: Add a truncated-topology regression test**

Use events with:

```ts
objectsTruncated: true
```

and otherwise repeated equal locals.

Assert exact-state/no-progress patterns are absent while transition patterns are still allowed.

- [ ] **Step 5: Integrate the new modules into `trace-interpreter.ts`**

Add imports:

```ts
import { buildBehavioralObservations } from "./behavioral-observation";
import { analyzeBehavioralPatterns } from "./behavioral-analyzer";
import type { BehavioralAnalysis } from "./behavioral-pattern";
```

Extend the interface:

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

After `mutationBatches` are built:

```ts
const behavioralObservations = buildBehavioralObservations(
  runtimeStates,
  mutationBatches
);
const behavioralAnalysis = analyzeBehavioralPatterns(
  behavioralObservations
);
```

Return it alongside the existing arrays.

- [ ] **Step 6: Make behavioral analysis fail-soft without hiding programmer-contract errors in tests**

Add a small wrapper in `behavioral-analyzer.ts` rather than swallowing errors inside individual detectors:

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

Use the safe wrapper only from `interpretTrace()`. Unit tests continue calling the strict `analyzeBehavioralPatterns()` so defects fail loudly during development.

Update import/call accordingly.

- [ ] **Step 7: Add fail-soft integration test**

Use `vi.spyOn()` on the analyzer module only if Vitest module structure allows it cleanly; otherwise export a small injectable helper is over-design and should be avoided. Preferred test is to feed malformed-but-type-coerced observation inputs directly to `analyzeBehavioralPatternsSafely()` and assert:

```ts
expect(analyzeBehavioralPatternsSafely(bad as never)).toEqual({
  patterns: [],
  stepAnnotations: []
});
```

Keep `interpretTrace()` itself deterministic for valid typed events.

- [ ] **Step 8: Run focused integration tests**

Run:

```bash
npx vitest run tests/core/trace-interpreter.test.ts tests/core/behavioral-analyzer.test.ts tests/core/visual-model.test.ts tests/core/linked-list-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/trace-interpreter.ts src/core/behavioral-analyzer.ts tests/core/trace-interpreter.test.ts tests/core/behavioral-analyzer.test.ts
git commit -m "feat: attach behavioral analysis to traces"
```

---

### Task 7: Add Factual `Behavioral Signals` Side Panel Rendering

**Files:**
- Create: `src/sidepanel/components/BehavioralSignals.ts`
- Create: `tests/sidepanel/behavioral-signals.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/trace-visualizer.test.ts` if present; otherwise extend the closest existing Side Panel trace rendering test file without creating a duplicate integration harness.

**Interfaces:**
- Consumes: `BehavioralAnalysis`, current trace step number.
- Produces: `createBehavioralSignals(analysis, currentStep): HTMLDivElement`.
- Rendering copy must remain factual and must not emit `infinite loop`, `TLE`, `bug`, or fix suggestions.

- [ ] **Step 1: Create renderer tests for all three pattern kinds**

Create `tests/sidepanel/behavioral-signals.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createBehavioralSignals } from "../../src/sidepanel/components/BehavioralSignals";
import type { BehavioralAnalysis } from "../../src/core/behavioral-pattern";

const analysis: BehavioralAnalysis = {
  patterns: [
    {
      kind: "repeated_state",
      patternId: "repeated_state:1:9:x",
      startStep: 1,
      endStep: 9,
      repeatCount: 3,
      evidenceSteps: [1, 5, 9],
      location: { frameId: 1, functionName: "solve", line: 5 },
      stateFingerprintKey: "abc"
    },
    {
      kind: "no_progress",
      patternId: "no_progress:1:9:x",
      startStep: 1,
      endStep: 9,
      repeatCount: 3,
      revisitCount: 2,
      evidenceSteps: [1, 5, 9],
      location: { frameId: 1, functionName: "solve", line: 5 }
    },
    {
      kind: "repeated_transition",
      patternId: "repeated_transition:20:28:p3",
      startStep: 20,
      endStep: 28,
      repeatCount: 3,
      evidenceSteps: [20, 21, 22, 23, 24, 25, 26, 27, 28],
      periodSteps: 3,
      motifKeys: ["A", "B", "C"]
    }
  ],
  stepAnnotations: []
};
```

Assert:

```ts
const element = createBehavioralSignals(analysis, 5);
expect(element.textContent).toContain("Repeated state × 3");
expect(element.textContent).toContain("solve · line 5");
expect(element.textContent).toContain("No observable progress");
expect(element.textContent).toContain("Repeated transition motif × 3");
expect(element.textContent).toContain("3-step pattern");
expect(element.textContent).not.toMatch(/infinite loop|TLE|bug|fix/i);
```

- [ ] **Step 2: Add empty-state and active-step tests**

```ts
it("renders a quiet empty state when no behavioral pattern exists", () => {
  const element = createBehavioralSignals({ patterns: [], stepAnnotations: [] }, 1);
  expect(element.textContent).toContain("No repeated behavioral signal in the captured trace.");
});

it("marks patterns that cover the current step", () => {
  const element = createBehavioralSignals(analysis, 5);
  expect(element.querySelector('[data-pattern-id="no_progress:1:9:x"]'))
    ?.classList.contains("is-active")).toBe(true);
});
```

- [ ] **Step 3: Implement pure DOM rendering**

Create `BehavioralSignals.ts`:

```ts
import type {
  BehavioralAnalysis,
  BehavioralPattern
} from "../../core/behavioral-pattern";

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

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

function detail(pattern: BehavioralPattern): string {
  switch (pattern.kind) {
    case "repeated_state":
      return `${pattern.location.functionName} · line ${pattern.location.line} revisited the same observable state.`;
    case "no_progress":
      return `Captured state stayed exact-equal across consecutive visits to ${pattern.location.functionName} · line ${pattern.location.line}.`;
    case "repeated_transition":
      return `${pattern.periodSteps}-step pattern across captured steps ${pattern.startStep}–${pattern.endStep}.`;
  }
}

export function createBehavioralSignals(
  analysis: BehavioralAnalysis,
  currentStep: number
): HTMLDivElement {
  const body = createElement("div", "trace-viewer__behavioral-signals");
  if (analysis.patterns.length === 0) {
    body.append(createElement(
      "div",
      "trace-viewer__empty",
      "No repeated behavioral signal in the captured trace."
    ));
    return body;
  }

  for (const pattern of analysis.patterns) {
    const row = createElement("div", "trace-viewer__behavioral-signal");
    row.dataset.patternId = pattern.patternId;
    row.dataset.patternKind = pattern.kind;
    row.classList.toggle("is-active", pattern.evidenceSteps.includes(currentStep));
    row.append(
      createElement("strong", "trace-viewer__behavioral-title", title(pattern)),
      createElement("span", "trace-viewer__behavioral-detail", detail(pattern))
    );
    body.append(row);
  }
  return body;
}
```

Do not include `motifKeys` in user-facing copy; those are internal evidence keys.

- [ ] **Step 4: Add the panel to `TraceVisualizer.ts`**

Import:

```ts
import { createBehavioralSignals } from "./BehavioralSignals";
```

Create the panel after `What Changed`:

```ts
const behavioralPanel = createPanel(
  "Behavioral Signals",
  "trace-viewer__behavioral-panel",
  true
);
```

Place it in the inspector area without replacing current panels. Preferred layout:

```ts
inspectorGrid.append(
  changesPanel.panel,
  behavioralPanel.panel,
  localsPanel.panel
);
```

In the no-step branch:

```ts
behavioralPanel.body.replaceChildren(
  createBehavioralSignals(interpretation.behavioralAnalysis, 0)
);
```

In `setStep()` after `state` selection:

```ts
behavioralPanel.body.replaceChildren(
  createBehavioralSignals(
    interpretation.behavioralAnalysis,
    state?.step ?? currentIndex + 1
  )
);
```

Do not change `currentIndex`, previous/next/play semantics, or total step count.

- [ ] **Step 5: Add minimal CSS**

Append focused rules to `src/sidepanel/styles.css`:

```css
.trace-viewer__behavioral-signals {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trace-viewer__behavioral-signal {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  padding: 8px;
}

.trace-viewer__behavioral-signal.is-active {
  outline: 2px solid currentColor;
  outline-offset: -2px;
}

.trace-viewer__behavioral-title {
  font-size: 12px;
}

.trace-viewer__behavioral-detail {
  font-size: 11px;
  line-height: 1.45;
}
```

Follow the repository's existing CSS conventions if the exact spacing differs; do not redesign unrelated panels.

- [ ] **Step 6: Add TraceVisualizer regression assertions**

Extend the current Side Panel trace test to assert:

```ts
expect(root.textContent).toContain("What Changed");
expect(root.textContent).toContain("Behavioral Signals");
```

For a repeated trace, assert factual pattern text appears. Also assert trace controls still expose the original raw step count.

- [ ] **Step 7: Run Side Panel and core tests**

Run:

```bash
npx vitest run tests/sidepanel/behavioral-signals.test.ts tests/sidepanel tests/core/trace-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/components/BehavioralSignals.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/behavioral-signals.test.ts tests/sidepanel
git commit -m "feat: show behavioral runtime signals"
```

---

### Task 8: Add End-to-End Behavioral Regression Scenarios

**Files:**
- Modify: `tests/core/trace-interpreter.test.ts`
- Modify: `tests/core/behavioral-analyzer.test.ts`
- Modify: `tests/core/linked-list-interpreter.test.ts` only if needed to verify compatibility; do not change production linked-list semantics in this task.
- Modify: `tests/sidepanel/behavioral-signals.test.ts`

**Interfaces:**
- No new public interface.
- This task closes spec acceptance gaps with realistic execution-shape regressions.

- [ ] **Step 1: Add stalled binary-search-style behavioral fixture**

Create a helper sequence corresponding to repeated anchor states such as:

```text
line 3: while left < right
line 4: mid = ...
line 5: if nums[mid] < target
line 6: left = mid
```

with repeated cycles where:

```text
left = 2
mid = 2
right = 5
```

returns unchanged at the same anchor.

Assert:

```ts
const kinds = result.behavioralAnalysis.patterns.map((pattern) => pattern.kind);
expect(kinds).toContain("repeated_state");
expect(kinds).toContain("no_progress");
expect(kinds).toContain("repeated_transition");
expect(kinds).not.toContain("infinite_loop" as never);
```

- [ ] **Step 2: Add finite counter-loop regression**

Use a repeated line motif with `i = 0 -> 1 -> 2 -> 3`.

Assert:

```ts
expect(kinds).toContain("repeated_transition");
expect(kinds).not.toContain("no_progress");
```

This protects the critical product rule `repetition != failure`.

- [ ] **Step 3: Add Linked List reverse transition-shape regression**

Construct or reuse linked-list runtime states/mutations where consecutive nodes perform the same semantic operations on different object IDs:

```text
reference:local:curr:redirected
reference:object:*.next:redirected
reference:local:prev:redirected
```

Assert the transition shape ignores concrete object IDs and can form repeated-transition evidence while the linked-list visual still reports concrete factual node/edge status.

- [ ] **Step 4: Add runtime-error-prefix rendering regression**

Build a `TraceSession` or interpretation fixture whose events contain repeated behavior followed by an exception event.

Assert:

```text
Behavioral Signals still render from the valid prefix
Output still renders the runtime exception
No diagnostic copy claims the repeated behavior caused the exception
```

- [ ] **Step 5: Add local-timeout-prefix regression if current test harness already models timeout sessions**

Use the existing timeout session fixture from execution/sidepanel tests; do not invent a new timeout execution mechanism.

If it contains enough events, assert behavioral signals are rendered alongside the existing local-timeout status. The text must not say `LeetCode TLE`.

If the current timeout fixture contains zero events, add a captured-prefix fixture to that existing test rather than changing runtime timeout semantics.

- [ ] **Step 6: Run the full focused regression set**

Run:

```bash
npx vitest run \
  tests/core/behavioral-observation.test.ts \
  tests/core/behavioral-analyzer.test.ts \
  tests/core/trace-interpreter.test.ts \
  tests/core/visual-model.test.ts \
  tests/core/linked-list-interpreter.test.ts \
  tests/sidepanel/behavioral-signals.test.ts \
  tests/sidepanel
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/core tests/sidepanel
git commit -m "test: cover behavioral debugging scenarios"
```

---

### Task 9: Clean Python Cache Artifacts and Add Minimal GitHub Actions CI

**Files:**
- Modify: `.gitignore`
- Delete tracked: `src/worker/python/__pycache__/...`
- Delete tracked: `tests/fixtures/python/__pycache__/...`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- No runtime interface changes.
- CI must execute the same repository validation commands developers run locally.

- [ ] **Step 1: Extend `.gitignore` with Python cache rules**

Append:

```gitignore
__pycache__/
*.py[cod]
.pytest_cache/
```

Do not remove the existing Node/dist/coverage ignore rules.

- [ ] **Step 2: Remove only tracked Python cache artifacts**

Run:

```bash
git rm -r src/worker/python/__pycache__ tests/fixtures/python/__pycache__
```

If one path is no longer tracked by implementation time, remove only the tracked path and continue. Do not remove Python source files.

- [ ] **Step 3: Verify no tracked cache files remain**

Run:

```bash
git ls-files | grep -E '(^|/)__pycache__/|\.py[co]$' && exit 1 || true
```

Expected: no matching tracked files.

- [ ] **Step 4: Create the minimal CI workflow**

Create `.github/workflows/ci.yml`:

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

No release/upload/publish steps.

- [ ] **Step 5: Validate workflow syntax structurally and run local gates**

Run:

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Expected: all PASS.

Do not require a local GitHub Actions emulator.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .github/workflows/ci.yml
git add -u src/worker/python tests/fixtures/python
git commit -m "ci: add repository validation workflow"
```

---

### Task 10: Synchronize README Architecture and Project Documents

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`

**Interfaces:**
- Documentation only.
- Copy must preserve the same product boundaries as runtime/UI behavior.

- [ ] **Step 1: Update the English architecture pipeline**

Replace the current compact pipeline with a version that reflects implemented semantic layers after this milestone:

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

- [ ] **Step 2: Add one concise behavioral-debugging capability bullet**

Use wording equivalent to:

```markdown
- factual behavioral signals for repeated observable state, no observable progress at a repeated execution anchor, and repeated execution/mutation motifs;
```

Immediately preserve the boundary that these signals do not equal official LeetCode verdicts or guaranteed infinite-loop diagnosis.

- [ ] **Step 3: Update README project-document links**

Add at least:

```markdown
- [Linked List Visualization Design Spec](docs/superpowers/specs/2026-09-07-visualization-coverage-linked-list-design.md)
- [Linked List Visualization Implementation Plan](docs/superpowers/plans/2026-09-07-linked-list-visualization-implementation-plan.md)
- [Runtime Mutation Semantics Design Spec](docs/superpowers/specs/2026-09-08-runtime-mutation-semantics-design.md)
- [Runtime Mutation Semantics Implementation Plan](docs/superpowers/plans/2026-09-08-runtime-mutation-semantics-implementation-plan.md)
- [Behavioral Debugging Foundation Design Spec](docs/superpowers/specs/2026-09-08-behavioral-debugging-foundation-design.md)
- [Behavioral Debugging Foundation Implementation Plan](docs/superpowers/plans/2026-09-08-behavioral-debugging-foundation-implementation-plan.md)
```

- [ ] **Step 4: Mirror the architecture/capability/boundary updates in Traditional Chinese**

The Traditional Chinese README should use equivalent meaning, for example:

```text
RuntimeState + FrameDiff/ObjectDiff
        ↓
RuntimeMutation + BehavioralPattern
        ↓
視覺語意解讀 + Behavioral Signals
```

Behavioral wording should explicitly remain factual:

```text
重複可觀察狀態
同一 execution anchor 上沒有可觀察進展
重複 execution / mutation motif
```

Do not translate established code/type names such as `RuntimeMutation`, `BehavioralPattern`, `FrameDiff`, or `ObjectDiff`.

- [ ] **Step 5: Verify links and wording**

Run:

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
```

Search README copy for accidental unsupported claims:

```bash
! grep -Ei 'infinite loop detected|LeetCode TLE detected|correctness detected' README.md README.zh-TW.md
```

Expected: both commands succeed.

- [ ] **Step 6: Run final full verification before the docs commit**

Run:

```bash
python -m pytest tests/fixtures/python -q
npm test
npm run typecheck
npm run build
git ls-files | grep -E '(^|/)__pycache__/|\.py[co]$' && exit 1 || true
```

Expected:

```text
Python fixtures PASS
Vitest PASS
tsc PASS
Vite builds PASS
no tracked Python bytecode/cache artifacts
```

- [ ] **Step 7: Commit README synchronization**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: document behavioral debugging architecture"
```

---

## Final Acceptance Verification

After all task commits exist, run the complete repository gates from a clean working tree:

```bash
python -m pytest tests/fixtures/python -q
npm ci
npm test
npm run typecheck
npm run build
git status --short
git ls-files | grep -E '(^|/)__pycache__/|\.py[co]$' && exit 1 || true
```

Expected:

```text
all Python fixture tests pass
all Vitest tests pass
TypeScript typecheck passes
all Vite builds pass
working tree is clean
no tracked Python cache files remain
```

Then verify the behavioral contract with focused tests:

```bash
npx vitest run \
  tests/core/behavioral-observation.test.ts \
  tests/core/behavioral-analyzer.test.ts \
  tests/core/trace-interpreter.test.ts \
  tests/sidepanel/behavioral-signals.test.ts
```

Required observable outcomes:

```text
RepeatedStatePattern requires 3 exact complete matches at the same anchor.
NoProgressPattern requires consecutive exact-equal visits to the same anchor.
RepeatedTransitionPattern can detect a finite changing loop without producing NoProgressPattern.
Truncated capture cannot prove RepeatedStatePattern or NoProgressPattern.
Behavioral Signals copy remains factual and contains no infinite-loop/TLE diagnosis.
Raw trace navigation and existing visualizers remain intact.
```

Finally, confirm the latest GitHub Actions run for the implementation head commit reports the `validate` job as successful before declaring the milestone complete.

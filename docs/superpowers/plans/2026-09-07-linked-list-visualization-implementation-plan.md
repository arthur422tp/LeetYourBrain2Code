# Linked List Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add end-to-end Linked List execution visualization while introducing reusable object-identity/topology, visual-candidate, and renderer-dispatch infrastructure for later Tree/Graph coverage.

**Architecture:** Extend trace schema to v2 with session-local object references and bounded object topology snapshots. Reconstruct/diff topology in core, interpret linked-list components and pointers into a `LinkedListVisualModel`, select structure-neutral visual candidates, and dispatch specialized renderers through a static typed registry. Preserve the existing live execution pipeline and existing List/Dict visualizers.

**Tech Stack:** TypeScript 5.8, Vitest 3, Vite 6, Chrome Manifest V3 Side Panel, Pyodide 0.29, bundled Python tracer/runtime.

**Spec:** `docs/superpowers/specs/2026-09-07-visualization-coverage-linked-list-design.md`

## Global Constraints

- First implementation scope is Linked List only; Tree, Graph, Stack/Queue, Heap, and DP Table renderers are excluded.
- Visualization must remain runtime-factual and must not infer algorithm intent from LeetCode title, problem number, or AI classification.
- Object identity is stable only within one `ExecutionRequest` / `TraceSession`; it never carries across live revisions.
- Object capture must be bounded and must never scan the whole Python heap.
- Object attribute capture must not invoke arbitrary properties/getters or user-defined methods; use safe instance state such as `__dict__`.
- Existing List/Dict visualization behavior, live scheduler latest-wins behavior, active-tab ownership, testcase selection, runtime-error trace prefix, and timeout trace prefix must not regress.
- Keep line-level debugger semantics: a `line` event means the source line is about to execute; do not add expression/post-line instrumentation.
- Use a static internal visualizer registry; do not build a dynamic third-party plugin system.
- Maximum visible visual models per step is 3.
- Default topology bounds from the spec: `maxObjectNodes = 200`, `maxObjectAttributes = 20`, `maxObjectDepth = 32`.
- Final verification requires `npm test`, `npm run typecheck`, and `npm run build` to pass.

---

## File Structure Map

### Shared contracts

- Modify `src/shared/trace-types.ts` — schema v2, object reference/object snapshot types, trace-event object topology fields.
- Modify `src/shared/execution-types.ts` — object capture limits and entrypoint parameter kinds.
- Modify `src/shared/worker-protocol.ts` only as needed to normalize/validate v2 event shapes without weakening existing terminal-message validation.

### Execution / worker

- Modify `src/execution/entrypoint-resolver.ts` — parse method parameter annotations into `parameterKinds`.
- Modify `src/execution/execution-request.ts` — preserve the enriched entrypoint and new limits.
- Create `src/worker/python/object_identity.py` — per-session `id(value) -> obj-N` registry.
- Create `src/worker/python/object_topology.py` — bounded, safe topology traversal from explicit roots.
- Modify `src/worker/python/serializer.py` — emit user-defined objects as references while preserving built-in container behavior.
- Modify `src/worker/python/tracer.py` — own the identity registry/topology collector and attach object snapshots to each event.
- Modify `src/worker/python/runner.py` — convert annotated linked-list testcase inputs and preserve return-root topology.
- Modify `src/worker/python/runtime_prelude.py` — provide LeetCode-compatible `ListNode` when user code has not defined one.
- Modify `src/worker/pyodide-runtime.ts` — bundle/load new Python modules and normalize `objects`/`objects_truncated`.

### Core interpretation

- Modify `src/core/value-snapshot.ts` — clone/key/compare `reference` snapshots.
- Modify `src/core/runtime-state.ts` — add `ObjectTopologyState`.
- Modify `src/core/state-reconstructor.ts` — reconstruct per-step topology.
- Create `src/core/object-diff.ts` — object/node/attribute topology diff.
- Create `src/core/linked-list-interpreter.ts` — detect linked-list components, payloads, roots/pointers, cycles, truncation.
- Create `src/core/visual-candidate.ts` — generic candidate contract.
- Create `src/core/visual-candidate-resolver.ts` — deterministic structure-neutral ordering.
- Modify `src/core/visual-model.ts` — `StructureVisualModel`, `LinkedListVisualModel`, `visuals`, `primaryVisualId`.
- Modify `src/core/trace-interpreter.ts` — compute object diffs and feed candidate/model building.
- Retire or reduce `src/core/primary-container-resolver.ts` once generic candidate selection becomes the sole source of ordering.

### Side panel

- Create `src/sidepanel/components/LinkedListVisualizer.ts` — linked-list DOM renderer.
- Create `src/sidepanel/components/visualizer-registry.ts` — static typed renderer dispatch.
- Modify `src/sidepanel/components/TraceVisualizer.ts` — consume `visuals` through registry instead of list/dict branching.
- Modify `src/sidepanel/components/value-format.ts` — readable reference formatting.
- Modify `src/sidepanel/styles.css` — linked-list/component/pointer/edge/cycle/truncation states.

### Tests

- Modify `tests/execution/entrypoint-resolver.test.ts`.
- Modify `tests/execution/execution-request.test.ts`.
- Modify `tests/execution/pyodide-runtime.test.ts`.
- Modify `tests/core/value-snapshot.test.ts`.
- Modify `tests/core/state-reconstructor.test.ts`.
- Modify `tests/core/state-diff.test.ts` only for regression coverage; object diff gets its own test.
- Create `tests/core/object-diff.test.ts`.
- Create `tests/core/linked-list-interpreter.test.ts`.
- Create `tests/core/visual-candidate-resolver.test.ts`.
- Modify `tests/core/visual-model.test.ts`.
- Create `tests/sidepanel/linked-list-visualizer.test.ts`.
- Modify `tests/sidepanel/trace-visualizer.test.ts`.
- Modify `tests/protocol/worker-protocol.test.ts`.

---

### Task 1: Introduce Trace Schema v2, Object References, and Object Capture Limits

**Files:**
- Modify: `src/shared/trace-types.ts`
- Modify: `src/shared/execution-types.ts`
- Modify: `src/core/value-snapshot.ts`
- Modify: `tests/core/value-snapshot.test.ts`
- Modify: `tests/protocol/worker-protocol.test.ts`

**Interfaces:**
- Produces: `ObjectId`, `ObjectReferenceSnapshot`, `ObjectSnapshot`, `TraceEvent.objects`, `TraceEvent.objectsTruncated`.
- Produces: `ExecutionLimits.maxObjectNodes`, `maxObjectAttributes`, `maxObjectDepth` with defaults `200`, `20`, `32`.
- Produces: `TRACE_SCHEMA_VERSION = 2`.
- Later tasks consume these exact names.

- [ ] **Step 1: Write failing schema/value tests**

Add to `tests/core/value-snapshot.test.ts`:

```ts
import { expect, it } from "vitest";
import { cloneValueSnapshot, valueSnapshotsEqual } from "../../src/core/value-snapshot";

it("clones and compares object references by stable object id and class", () => {
  const reference = { type: "reference", objectId: "obj-7", className: "ListNode" } as const;

  expect(cloneValueSnapshot(reference)).toEqual(reference);
  expect(valueSnapshotsEqual(reference, { ...reference })).toBe(true);
  expect(valueSnapshotsEqual(reference, { ...reference, objectId: "obj-8" })).toBe(false);
});
```

Add a protocol assertion in `tests/protocol/worker-protocol.test.ts` that a `trace_batch` containing:

```ts
{
  step: 1,
  event: "line",
  frameId: 1,
  parentFrameId: null,
  function: "reverseList",
  line: 4,
  callDepth: 1,
  locals: {
    head: { type: "reference", objectId: "obj-1", className: "ListNode" }
  },
  objects: [{
    objectId: "obj-1",
    className: "ListNode",
    attributes: {
      val: { type: "int", value: "1" },
      next: { type: "none", value: null }
    }
  }],
  objectsTruncated: false,
  stdoutDelta: ""
}
```

is accepted by the existing outbound message guard.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npx vitest run tests/core/value-snapshot.test.ts tests/protocol/worker-protocol.test.ts
```

Expected: FAIL because `reference` is not part of `ValueSnapshot` and object topology fields/types do not exist.

- [ ] **Step 3: Implement schema v2 and limit fields**

In `src/shared/trace-types.ts`, define:

```ts
export const TRACE_SCHEMA_VERSION = 2;
export type ObjectId = string;

export interface ObjectReferenceSnapshot {
  type: "reference";
  objectId: ObjectId;
  className: string;
}

export interface ObjectSnapshot {
  objectId: ObjectId;
  className: string;
  attributes: Record<string, ValueSnapshot>;
}
```

Add `ObjectReferenceSnapshot` to `ValueSnapshot`, and extend `TraceEvent`:

```ts
objects?: ObjectSnapshot[];
objectsTruncated?: boolean;
```

In `src/shared/execution-types.ts`, extend `ExecutionLimits` and defaults:

```ts
maxObjectNodes: number;
maxObjectAttributes: number;
maxObjectDepth: number;
```

```ts
maxObjectNodes: 200,
maxObjectAttributes: 20,
maxObjectDepth: 32,
```

In `src/core/value-snapshot.ts`, add the `reference` case to cloning/keying:

```ts
case "reference":
  return JSON.stringify([snapshot.type, snapshot.objectId, snapshot.className]);
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npx vitest run tests/core/value-snapshot.test.ts tests/protocol/worker-protocol.test.ts
npm run typecheck
```

Expected: PASS after all request fixtures that construct `ExecutionLimits` are updated to include the three new fields.

- [ ] **Step 5: Commit**

```bash
git add src/shared/trace-types.ts src/shared/execution-types.ts src/core/value-snapshot.ts tests/core/value-snapshot.test.ts tests/protocol/worker-protocol.test.ts tests

git commit -m "feat: add object topology trace schema"
```

---

### Task 2: Enrich Entrypoint Resolution with Linked-List Parameter Kinds

**Files:**
- Modify: `src/shared/execution-types.ts`
- Modify: `src/execution/entrypoint-resolver.ts`
- Modify: `src/execution/execution-request.ts`
- Modify: `tests/execution/entrypoint-resolver.test.ts`
- Modify: `tests/execution/execution-request.test.ts`

**Interfaces:**
- Produces: `type ParameterKind = "value" | "linked_list"`.
- Produces: `EntryPoint.parameterKinds: ParameterKind[]`, ordered exactly like non-`self`/`cls` method parameters.
- Recognition rule: `ListNode`, `Optional[ListNode]`, `ListNode | None`, and `None | ListNode` => `linked_list`; all other/absent annotations => `value`.
- Task 10 consumes `entrypoint.parameterKinds` to convert testcase arguments.

- [ ] **Step 1: Write failing resolver tests**

Add cases to `tests/execution/entrypoint-resolver.test.ts`:

```ts
it("classifies ListNode annotations without using the problem title", () => {
  const result = resolveEntrypoint(`class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        return head
`);

  expect(result).toEqual({
    ok: true,
    entrypoint: {
      className: "Solution",
      methodName: "reverseList",
      parameterCount: 1,
      parameterKinds: ["linked_list"]
    }
  });
});

it("keeps ordinary list annotations as value parameters", () => {
  const result = resolveEntrypoint(`class Solution:
    def twoSum(self, nums: list[int], target: int):
        return []
`);

  expect(result.ok && result.entrypoint.parameterKinds).toEqual(["value", "value"]);
});
```

- [ ] **Step 2: Run resolver/request tests and verify failure**

```bash
npx vitest run tests/execution/entrypoint-resolver.test.ts tests/execution/execution-request.test.ts
```

Expected: FAIL because `EntryPoint.parameterKinds` does not exist.

- [ ] **Step 3: Parse parameter annotations deterministically**

In `src/shared/execution-types.ts`:

```ts
export type ParameterKind = "value" | "linked_list";

export interface EntryPoint {
  className: string;
  methodName: string;
  parameterCount: number;
  parameterKinds: ParameterKind[];
}
```

In `entrypoint-resolver.ts`, replace count-only parameter parsing with a helper that returns parameter descriptors. Normalize whitespace before testing annotation text:

```ts
function parameterKind(annotation: string | null): ParameterKind {
  if (annotation === null) return "value";
  const normalized = annotation.replace(/\s+/g, "");
  return /^(?:ListNode|Optional\[ListNode\]|ListNode\|None|None\|ListNode)$/.test(normalized)
    ? "linked_list"
    : "value";
}
```

Return both `parameterCount` and `parameterKinds` from the same parsed parameter list so they cannot diverge.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
npx vitest run tests/execution/entrypoint-resolver.test.ts tests/execution/execution-request.test.ts
npm run typecheck
```

Expected: PASS after existing hand-built `EntryPoint` fixtures include `parameterKinds`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/execution-types.ts src/execution/entrypoint-resolver.ts src/execution/execution-request.ts tests/execution/entrypoint-resolver.test.ts tests/execution/execution-request.test.ts tests

git commit -m "feat: resolve linked list parameter kinds"
```

---

### Task 3: Add Session-Local Object Identity and Safe Bounded Topology Capture

**Files:**
- Create: `src/worker/python/object_identity.py`
- Create: `src/worker/python/object_topology.py`
- Modify: `src/worker/python/serializer.py`
- Modify: `src/worker/pyodide-runtime.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`

**Interfaces:**
- Produces Python `ObjectIdentityRegistry.object_id(value) -> str`.
- Produces Python `ObjectTopologyCollector.capture(roots) -> {"objects": [...], "truncated": bool}`.
- Produces `ValueSerializer(..., identity_registry=...)` that serializes ordinary user-defined objects as `{type:"reference", objectId, className}`.
- Built-in list/tuple/dict/set behavior remains unchanged.

- [ ] **Step 1: Write a failing runtime-script/loading test**

Extend the existing `buildExecutionScript()` test in `tests/execution/pyodide-runtime.test.ts`:

```ts
expect(script).toContain("leetcode-object-identity");
expect(script).toContain('sys.modules["object_identity"]');
expect(script).toContain("leetcode-object-topology");
expect(script).toContain('sys.modules["object_topology"]');
```

Add a normalization fixture containing a reference local and `objects` array and assert `normalizePythonTraceEvent()` preserves camel-cased topology fields.

- [ ] **Step 2: Run runtime tests and verify failure**

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts
```

Expected: FAIL because the new Python modules are not bundled and normalization ignores object topology.

- [ ] **Step 3: Implement identity registry and topology collector**

Create `object_identity.py`:

```python
class ObjectIdentityRegistry:
    def __init__(self):
        self._ids = {}
        self._next = 1

    def object_id(self, value):
        key = id(value)
        existing = self._ids.get(key)
        if existing is not None:
            return existing
        token = f"obj-{self._next}"
        self._next += 1
        self._ids[key] = token
        return token
```

Create `object_topology.py` with explicit-root breadth-first traversal. Treat `None`, scalars, strings, and built-in containers as non-object nodes; traverse user-defined objects via `vars(value)` / `value.__dict__` only. Cap traversal by `max_object_nodes`, `max_object_attributes`, and `max_object_depth`. For each object emit:

```python
{
    "objectId": registry.object_id(value),
    "className": type(value).__name__,
    "attributes": serialized_attributes,
}
```

Pass the same registry into `ValueSerializer`. In `serializer.py`, before the final unknown fallback, detect ordinary objects with safe instance state and return:

```python
{
    "type": "reference",
    "objectId": self.identity_registry.object_id(value),
    "className": self._safe_class_name(value),
}
```

Do not call properties; only `vars(value)`/`__dict__` is allowed for topology traversal.

In `pyodide-runtime.ts`, add both Python module source strings to the execution script before `serializer.py`/`tracer.py`, and normalize:

```ts
objects: raw.objects,
objectsTruncated: raw.objects_truncated,
```

when present.

- [ ] **Step 4: Run runtime tests and typecheck**

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/python/object_identity.py src/worker/python/object_topology.py src/worker/python/serializer.py src/worker/pyodide-runtime.ts tests/execution/pyodide-runtime.test.ts

git commit -m "feat: capture bounded object topology"
```

---

### Task 4: Attach Stable Object Topology to Trace Events and Return Events

**Files:**
- Modify: `src/worker/python/tracer.py`
- Modify: `src/worker/python/runner.py`
- Modify: `tests/execution/pyodide-runtime.test.ts`

**Interfaces:**
- `TraceCollector` owns one `ObjectIdentityRegistry` for its whole session.
- Every recorded user-code event emits `objects` and `objects_truncated` from explicit roots.
- Return events add the return argument to topology roots before serialization, so returned linked-list structures remain visible in the terminal trace step.
- Pointer identity must remain stable across steps in one run.

- [ ] **Step 1: Add failing end-to-end event fixtures**

In `tests/execution/pyodide-runtime.test.ts`, add a normalized Python result fixture with two events that both reference `obj-1`:

```ts
const rawEvents = [
  {
    step: 1,
    event: "line",
    frame_id: 1,
    parent_frame_id: null,
    function: "reverseList",
    line: 4,
    call_depth: 1,
    locals: { head: { type: "reference", objectId: "obj-1", className: "ListNode" } },
    objects: [{
      objectId: "obj-1",
      className: "ListNode",
      attributes: { val: { type: "int", value: "1" }, next: { type: "none", value: null } }
    }],
    objects_truncated: false,
    stdout_delta: ""
  },
  {
    step: 2,
    event: "return",
    frame_id: 1,
    parent_frame_id: null,
    function: "reverseList",
    line: 5,
    call_depth: 1,
    locals: {},
    objects: [{
      objectId: "obj-1",
      className: "ListNode",
      attributes: { val: { type: "int", value: "1" }, next: { type: "none", value: null } }
    }],
    objects_truncated: false,
    stdout_delta: "",
    event_payload: { return_value: { type: "reference", objectId: "obj-1", className: "ListNode" } }
  }
];
```

Assert both normalized events use the same object id and the return event still has the topology object.

- [ ] **Step 2: Run runtime tests and verify failure**

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts
```

Expected: FAIL until tracer/runner produce and preserve the fields consistently.

- [ ] **Step 3: Make `TraceCollector` own one capture context**

In `tracer.py`, initialize once:

```python
self.identity_registry = ObjectIdentityRegistry()
self.topology_collector = ObjectTopologyCollector(
    limits=self.limits,
    identity_registry=self.identity_registry,
)
```

Create all `ValueSerializer` instances with the same registry. In `_record()`, build roots from user-visible `frame.f_locals.values()` and, for a return event, append `argument`. Capture topology after locals are serialized:

```python
capture = self.topology_collector.capture(roots)
event["objects"] = capture["objects"]
event["objects_truncated"] = capture["truncated"]
```

Keep serialization failures best-effort: topology capture failure yields empty `objects` plus `objects_truncated=True`; it must not transform healthy user code into `runtime_exception`.

- [ ] **Step 4: Run runtime tests**

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts tests/execution/trace-session-collector.test.ts
```

Expected: PASS with stable IDs across the supplied event sequence and no regression in trace batching.

- [ ] **Step 5: Commit**

```bash
git add src/worker/python/tracer.py src/worker/python/runner.py tests/execution/pyodide-runtime.test.ts

git commit -m "feat: emit object topology with trace events"
```

---

### Task 5: Reconstruct Object Topology and Diff Object Attributes

**Files:**
- Modify: `src/core/runtime-state.ts`
- Modify: `src/core/state-reconstructor.ts`
- Create: `src/core/object-diff.ts`
- Modify: `src/core/trace-interpreter.ts`
- Modify: `tests/core/state-reconstructor.test.ts`
- Create: `tests/core/object-diff.test.ts`

**Interfaces:**
- Produces: `ObjectTopologyState { objects: Map<ObjectId, ObjectSnapshot>; truncated: boolean }`.
- Adds `RuntimeState.objectTopology`.
- Produces: `ObjectAttributeDiff`, `ObjectDiff`, `diffObjectTopology(previous, current)`.
- `ObjectDiff.removedObjectIds` means no longer observable in the bounded snapshot, not garbage-collected.

- [ ] **Step 1: Write failing reconstruction and diff tests**

In `tests/core/state-reconstructor.test.ts`, assert a trace event with `objects` reconstructs:

```ts
expect(states[0]!.objectTopology.objects.get("obj-1")).toEqual({
  objectId: "obj-1",
  className: "ListNode",
  attributes: {
    val: { type: "int", value: "1" },
    next: { type: "reference", objectId: "obj-2", className: "ListNode" }
  }
});
```

Create `tests/core/object-diff.test.ts`:

```ts
it("distinguishes next-edge mutation from local pointer movement", () => {
  const before = topology({
    "obj-1": node("obj-1", 1, "obj-2"),
    "obj-2": node("obj-2", 2, null)
  });
  const after = topology({
    "obj-1": node("obj-1", 1, null),
    "obj-2": node("obj-2", 2, null)
  });

  expect(diffObjectTopology(before, after).attributeChanges).toEqual([
    expect.objectContaining({ objectId: "obj-1", attribute: "next", kind: "changed" })
  ]);
});
```

Use small local test helpers `node()` and `topology()` defined in that test file.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npx vitest run tests/core/state-reconstructor.test.ts tests/core/object-diff.test.ts
```

Expected: FAIL because topology state/diff are undefined.

- [ ] **Step 3: Implement cloning/reconstruction and object diff**

In `runtime-state.ts`:

```ts
export interface ObjectTopologyState {
  objects: Map<ObjectId, ObjectSnapshot>;
  truncated: boolean;
}
```

and add `objectTopology` to `RuntimeState`.

In `state-reconstructor.ts`, each emitted state gets a fresh cloned map built from `event.objects ?? []`; never share mutable `attributes` objects across states.

In `object-diff.ts`, define:

```ts
export interface ObjectAttributeDiff {
  objectId: ObjectId;
  attribute: string;
  kind: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export interface ObjectDiff {
  addedObjectIds: ObjectId[];
  removedObjectIds: ObjectId[];
  attributeChanges: ObjectAttributeDiff[];
}
```

Compare attribute snapshots with `valueSnapshotsEqual()`. Sort object IDs and attribute names for deterministic output.

In `trace-interpreter.ts`, compute `objectDiffs[index]` from the previous runtime state's topology and expose it in `TraceInterpretation`.

- [ ] **Step 4: Run core tests**

```bash
npx vitest run tests/core/state-reconstructor.test.ts tests/core/object-diff.test.ts tests/core/trace-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/runtime-state.ts src/core/state-reconstructor.ts src/core/object-diff.ts src/core/trace-interpreter.ts tests/core/state-reconstructor.test.ts tests/core/object-diff.test.ts tests/core/trace-interpreter.test.ts

git commit -m "feat: reconstruct and diff object topology"
```

---

### Task 6: Interpret Linked-List Topology into Components, Pointers, and Mutations

**Files:**
- Create: `src/core/linked-list-interpreter.ts`
- Create: `tests/core/linked-list-interpreter.test.ts`

**Interfaces:**
- Produces `LinkedListNodeVisual`, `LinkedListPointerVisual`, `LinkedListComponent`, `LinkedListVisualModel`.
- Produces `buildLinkedListVisuals(runtime, frameDiff, objectDiff): LinkedListVisualModel[]`.
- Detection requires a safe `next` attribute whose value is `none` or a compatible `reference`; no class-name requirement.
- Payload label priority: `val`, `value`, `data`, then first primitive non-reference attribute.

- [ ] **Step 1: Write failing interpretation tests for the core cases**

Create tests covering at least standard chain, aliases, reverse split, and cycle. Representative assertion:

```ts
it("builds one structure with pointer aliases instead of duplicate visuals", () => {
  const runtime = runtimeWithLinkedList({
    locals: {
      head: ref("obj-1"),
      curr: ref("obj-2"),
      slow: ref("obj-2")
    },
    objects: [
      node("obj-1", 1, "obj-2"),
      node("obj-2", 2, "obj-3"),
      node("obj-3", 3, null)
    ]
  });

  const visuals = buildLinkedListVisuals(runtime, null, emptyObjectDiff());

  expect(visuals).toHaveLength(1);
  expect(visuals[0]!.pointers).toEqual(expect.arrayContaining([
    expect.objectContaining({ variableName: "head", objectId: "obj-1" }),
    expect.objectContaining({ variableName: "curr", objectId: "obj-2" }),
    expect.objectContaining({ variableName: "slow", objectId: "obj-2" })
  ]));
});
```

Add a cycle case `obj-1 -> obj-2 -> obj-1` and assert `cyclic === true` with finite `nodes.length === 2`.

- [ ] **Step 2: Run the new tests and verify failure**

```bash
npx vitest run tests/core/linked-list-interpreter.test.ts
```

Expected: FAIL because the interpreter/model do not exist.

- [ ] **Step 3: Implement deterministic linked-list interpretation**

Define model types in `linked-list-interpreter.ts`:

```ts
export interface LinkedListNodeVisual {
  objectId: ObjectId;
  className: string;
  label: ValueSnapshot | null;
  nextObjectId: ObjectId | null;
  status: "unchanged" | "added" | "changed" | "detached";
  nextStatus: "unchanged" | "changed" | "added" | "removed";
}

export interface LinkedListPointerVisual {
  variableName: string;
  objectId: ObjectId | null;
  status: "unchanged" | "moved" | "added" | "removed";
}

export interface LinkedListComponent {
  componentId: string;
  nodeIds: ObjectId[];
  entryNodeIds: ObjectId[];
}

export interface LinkedListVisualModel {
  kind: "linked_list";
  visualId: string;
  nodes: LinkedListNodeVisual[];
  components: LinkedListComponent[];
  pointers: LinkedListPointerVisual[];
  cyclic: boolean;
  truncated: boolean;
}
```

Algorithm requirements:

```text
1. collect objects with a structural `next` value of none/reference;
2. restrict next references to compatible candidate objects;
3. construct weakly connected components over next edges;
4. include all active-frame locals that reference component nodes as pointers;
5. canonical visualId = `linked_list:${lexicographically-smallest-objectId-in-component-set}`;
6. detect cycles with visited/visiting sets; never recursive-loop indefinitely;
7. map ObjectDiff attribute changes to node status / nextStatus;
8. map FrameDiff reference changes to pointer status;
9. sort components, nodes, and pointers deterministically.
```

For a temporarily detached node still referenced by a local, keep it as its own component.

- [ ] **Step 4: Run interpreter tests**

```bash
npx vitest run tests/core/linked-list-interpreter.test.ts
npm run typecheck
```

Expected: PASS for standard, custom-class, aliases, disconnected fragments, insertion state, detach state, cycle, and truncation cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/linked-list-interpreter.ts tests/core/linked-list-interpreter.test.ts

git commit -m "feat: interpret linked list runtime topology"
```

---

### Task 7: Replace Container-Only Selection with Generic Visual Candidates

**Files:**
- Create: `src/core/visual-candidate.ts`
- Create: `src/core/visual-candidate-resolver.ts`
- Modify: `src/core/visual-model.ts`
- Modify: `src/core/trace-interpreter.ts`
- Modify: `src/core/primary-container-resolver.ts`
- Create: `tests/core/visual-candidate-resolver.test.ts`
- Modify: `tests/core/visual-model.test.ts`
- Modify: `tests/core/primary-container-resolver.test.ts`

**Interfaces:**
- Produces `VisualCandidate`, `VisualSelection`, `resolveVisualCandidates()`.
- Produces `StructureVisualModel = ListVisualModel | DictVisualModel | LinkedListVisualModel`.
- Evolves `VisualState` to `visuals: StructureVisualModel[]`, `primaryVisualId: string | null`, `objectChanges: ObjectDiff | null`.
- Maximum visible visual models is 3.
- This task establishes one ordering source; legacy `primaryVisual`/`containerVisuals` must not remain the permanent source of truth.

- [ ] **Step 1: Write failing candidate-priority tests**

Create `tests/core/visual-candidate-resolver.test.ts` with explicit candidates:

```ts
it("prioritizes a mutated linked list over an unrelated unchanged list", () => {
  const selection = resolveVisualCandidates([
    candidate("list:nums", "list", [false, false, true, 1]),
    candidate("linked_list:obj-1", "linked_list", [false, true, true, 2])
  ]);

  expect(selection.primary?.visualId).toBe("linked_list:obj-1");
});

it("uses deterministic kind/id tie breakers", () => {
  const selection = resolveVisualCandidates([
    candidate("list:z", "list", [false, false, false, 1]),
    candidate("dict:a", "dict", [false, false, false, 1])
  ]);

  expect(selection.visible.map((item) => item.visualId)).toEqual(["dict:a", "list:z"]);
});
```

Represent priority as a typed tuple:

```ts
type VisualPriority = readonly [
  activeLineRelevant: boolean,
  mutated: boolean,
  pointerRelevant: boolean,
  rootReferenceCount: number
];
```

- [ ] **Step 2: Run candidate/model tests and verify failure**

```bash
npx vitest run tests/core/visual-candidate-resolver.test.ts tests/core/visual-model.test.ts
```

Expected: FAIL because generic candidate selection and new VisualState fields do not exist.

- [ ] **Step 3: Implement generic selection and migrate `buildVisualState()`**

In `visual-candidate.ts`:

```ts
export type VisualKind = "list" | "dict" | "linked_list";
export type VisualPriority = readonly [boolean, boolean, boolean, number];

export interface VisualCandidate {
  visualId: string;
  kind: VisualKind;
  priority: VisualPriority;
}

export interface VisualSelection {
  primary: VisualCandidate | null;
  visible: VisualCandidate[];
}
```

In `visual-candidate-resolver.ts`, sort each tuple descending field-by-field; for ties sort `kind` then `visualId`. Return at most 3 visible candidates.

In `visual-model.ts`:

```ts
export type StructureVisualModel =
  | ListVisualModel
  | DictVisualModel
  | LinkedListVisualModel;

export interface VisualState {
  step: number;
  currentLine: number | null;
  visuals: StructureVisualModel[];
  primaryVisualId: string | null;
  stateChanges: FrameDiff | null;
  objectChanges: ObjectDiff | null;
  locals: Record<string, ValueSnapshot>;
  callStack: CallStackEntry[];
  stdout: string;
  exception?: ExceptionInfo;
}
```

Adapt existing list/dict detection into candidates without rewriting their model builders. Feed linked-list candidates/models from Task 6. Remove permanent reliance on `primaryVisual` and `containerVisuals`; update tests in the same task.

- [ ] **Step 4: Run all core tests**

```bash
npx vitest run tests/core
npm run typecheck
```

Expected: PASS, including existing list/dict priority regressions.

- [ ] **Step 5: Commit**

```bash
git add src/core/visual-candidate.ts src/core/visual-candidate-resolver.ts src/core/visual-model.ts src/core/trace-interpreter.ts src/core/primary-container-resolver.ts tests/core

git commit -m "refactor: generalize visual candidate selection"
```

---

### Task 8: Add a Static Typed Visualizer Registry and Remove Renderer Branch Growth

**Files:**
- Create: `src/sidepanel/components/visualizer-registry.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

**Interfaces:**
- Produces `VisualHandle` with `{ element, update(model), dispose() }` semantics.
- Produces `createVisualizer(model: StructureVisualModel): VisualHandle` and `updateVisualizer(handle, model)` or an equivalent typed registry API.
- Registry keys: `list`, `dict`, `linked_list`.
- `TraceVisualizer` must key handles by `visual.visualId`, not by variable name.

- [ ] **Step 1: Write a failing orchestration test**

In `tests/sidepanel/trace-visualizer.test.ts`, construct a `TraceSession` whose interpreted visual step contains both a list and linked-list model, then assert the Visual State host renders one element for each distinct `visualId` and reuses those elements across `setStep()` when the ids remain stable.

Use DOM data markers expected from registry-created renderers:

```ts
expect(view.element.querySelectorAll("[data-visual-id]")).toHaveLength(2);
```

- [ ] **Step 2: Run trace visualizer tests and verify failure**

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts
```

Expected: FAIL because `TraceVisualizer` still dispatches list/dict directly and has no linked-list factory.

- [ ] **Step 3: Implement registry and generic handle lifecycle**

Create a static registry shaped like:

```ts
const registry = {
  list: createListVisualizer,
  dict: createDictVisualizer,
  linked_list: createLinkedListVisualizer
} satisfies VisualizerRegistry;
```

The registry wrapper must expose a common handle:

```ts
export interface VisualizerHandle {
  element: HTMLElement;
  kind: StructureVisualModel["kind"];
  update(model: StructureVisualModel): void;
  dispose(): void;
}
```

`TraceVisualizer` loop becomes conceptually:

```ts
for (const visual of state.visuals) {
  const existing = handles.get(visual.visualId);
  const handle = existing && existing.kind === visual.kind
    ? existing
    : createVisualizer(visual);
  handle.update(visual);
  handles.set(visual.visualId, handle);
}
```

Dispose handles whose ids are absent from the next step. Do not add another linked-list-specific branch in `TraceVisualizer.ts`.

- [ ] **Step 4: Run side-panel trace tests**

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts tests/sidepanel/list-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/components/visualizer-registry.ts src/sidepanel/components/TraceVisualizer.ts tests/sidepanel/trace-visualizer.test.ts

git commit -m "refactor: dispatch visualizers through registry"
```

---

### Task 9: Build the LinkedListVisualizer DOM Renderer

**Files:**
- Create: `src/sidepanel/components/LinkedListVisualizer.ts`
- Modify: `src/sidepanel/components/value-format.ts`
- Modify: `src/sidepanel/styles.css`
- Create: `tests/sidepanel/linked-list-visualizer.test.ts`

**Interfaces:**
- Produces `createLinkedListVisualizer(model: LinkedListVisualModel): LinkedListVisualizerHandle`.
- Handle API: `element`, `update(model)`, `dispose()`.
- Renders deterministic component rows, nodes, next connectors, pointers, cycle indicator, truncation indicator, and mutation state data attributes.

- [ ] **Step 1: Write failing renderer tests**

Create `tests/sidepanel/linked-list-visualizer.test.ts`:

```ts
it("renders nodes, pointer aliases, next links, and mutation markers", () => {
  const handle = createLinkedListVisualizer({
    kind: "linked_list",
    visualId: "linked_list:obj-1",
    nodes: [
      nodeVisual("obj-1", 1, "obj-2"),
      { ...nodeVisual("obj-2", 2, null), nextStatus: "changed" }
    ],
    components: [{
      componentId: "component:obj-1",
      nodeIds: ["obj-1", "obj-2"],
      entryNodeIds: ["obj-1"]
    }],
    pointers: [
      { variableName: "head", objectId: "obj-1", status: "unchanged" },
      { variableName: "curr", objectId: "obj-2", status: "moved" },
      { variableName: "slow", objectId: "obj-2", status: "unchanged" }
    ],
    cyclic: false,
    truncated: false
  });

  expect(handle.element.dataset.visualId).toBe("linked_list:obj-1");
  expect(handle.element.querySelectorAll("[data-node-id]")).toHaveLength(2);
  expect(handle.element.querySelector('[data-node-id="obj-2"]')?.textContent).toContain("curr");
  expect(handle.element.querySelector('[data-node-id="obj-2"]')?.textContent).toContain("slow");
  expect(handle.element.querySelector('[data-next-status="changed"]')).not.toBeNull();
});
```

Add separate tests for two disconnected components, cycle indicator, truncated indicator, and `update()` removing stale nodes.

- [ ] **Step 2: Run renderer tests and verify failure**

```bash
npx vitest run tests/sidepanel/linked-list-visualizer.test.ts
```

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement horizontal component-row rendering**

Create DOM structure with stable data markers:

```text
.linked-list-visualizer[data-visual-id]
  .linked-list-visualizer__component[data-component-id]
    .linked-list-visualizer__node[data-node-id]
      .linked-list-visualizer__pointers
      .linked-list-visualizer__value
      .linked-list-visualizer__next[data-next-status]
```

Pointers are grouped at their target node, sorted deterministically. Use text/line-style semantics in addition to CSS color:

```text
pointer moved -> data-pointer-status="moved" + textual arrow marker
next changed  -> data-next-status="changed" + changed connector class
node added    -> data-node-status="added"
detached      -> data-node-status="detached"
cycle         -> visible "cycle" marker/back-edge label
truncated     -> visible "Topology truncated" note
```

For cycle rendering, use finite linear node order plus a back-edge label such as `next -> obj-2 (cycle)` if a compact SVG connector is not needed. Do not introduce a graph-layout dependency.

Update `value-format.ts`:

```ts
case "reference":
  return `${snapshot.className}@${snapshot.objectId}`;
```

- [ ] **Step 4: Run renderer and regression tests**

```bash
npx vitest run tests/sidepanel/linked-list-visualizer.test.ts tests/sidepanel/list-visualizer.test.ts tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/components/LinkedListVisualizer.ts src/sidepanel/components/value-format.ts src/sidepanel/styles.css tests/sidepanel/linked-list-visualizer.test.ts

git commit -m "feat: render linked list execution state"
```

---

### Task 10: Convert Annotated LeetCode List Inputs into `ListNode` Chains

**Files:**
- Modify: `src/worker/python/runtime_prelude.py`
- Modify: `src/worker/python/runner.py`
- Modify: `src/worker/pyodide-runtime.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/execution/execution-request.test.ts`

**Interfaces:**
- Consumes `EntryPoint.parameterKinds` from Task 2.
- For `linked_list` parameters only, a literal list testcase like `[1,2,3]` becomes a `ListNode` chain.
- Ordinary `list[int]` parameters remain Python lists.
- User-defined `ListNode` in source takes precedence over the prelude fallback.

- [ ] **Step 1: Write failing request/runtime tests**

Add an execution-request test that an annotated linked-list method produces:

```ts
expect(result.ok && result.request.entrypoint.parameterKinds).toEqual(["linked_list"]);
```

Add a `buildExecutionScript()` assertion that runtime prelude source contains a compatibility `ListNode`, and runner receives `entrypoint.parameter_kinds` / camelCase-normalized equivalent.

Add a runtime-result fixture expectation for a reverse-list request whose terminal return value is:

```ts
{ type: "reference", objectId: expect.any(String), className: "ListNode" }
```

and whose trace includes linked topology objects.

- [ ] **Step 2: Run request/runtime tests and verify failure**

```bash
npx vitest run tests/execution/execution-request.test.ts tests/execution/pyodide-runtime.test.ts
```

Expected: FAIL because raw `[1,2,3]` is still passed as a Python list.

- [ ] **Step 3: Implement prelude and parameter-aware conversion**

In `runtime_prelude.py`, define a fallback compatible node:

```python
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
```

In `runner.py`, after `exec(user_code, namespace, namespace)`, choose the node class:

```python
node_class = namespace.get("ListNode", ListNode)
```

Add:

```python
def _build_linked_list(values, node_class):
    head = None
    tail = None
    for value in values:
        node = node_class(value)
        if head is None:
            head = node
        else:
            tail.next = node
        tail = node
    return head
```

For each parsed testcase argument, consult `parameter_kinds[index]`. Only when kind is `linked_list`:

- `None` remains `None`;
- a Python `list` converts through `_build_linked_list`;
- any other literal shape returns existing `input_error / unsupported_testcase_format` semantics.

Do not use problem title or method name.

- [ ] **Step 4: Run execution tests**

```bash
npx vitest run tests/execution/entrypoint-resolver.test.ts tests/execution/execution-request.test.ts tests/execution/pyodide-runtime.test.ts tests/execution/execution-controller.test.ts
npm run typecheck
```

Expected: PASS, including an ordinary list-parameter regression proving `[1,2,3]` remains a list for `list[int]`.

- [ ] **Step 5: Commit**

```bash
git add src/worker/python/runtime_prelude.py src/worker/python/runner.py src/worker/pyodide-runtime.ts tests/execution

git commit -m "feat: bind linked list testcase inputs"
```

---

### Task 11: Add End-to-End Linked-List Trace Fixtures and Preserve Failure Prefixes

**Files:**
- Modify: `tests/core/trace-interpreter.test.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `tests/execution/trace-session-collector.test.ts`
- Modify: `tests/execution/execution-controller.test.ts`
- Add fixture helpers under: `tests/fixtures/` if existing fixture conventions make the test data clearer.

**Interfaces:**
- Verifies the complete chain: normalized trace -> reconstructed topology -> object diff -> linked-list interpretation -> selected visual -> renderer.
- Covers Reverse Linked List, fast/slow aliases, insertion/splice, cycle, runtime exception prefix, timeout prefix.

- [ ] **Step 1: Add representative integration tests**

Add a trace interpreter fixture for partial reverse:

```text
Step A:
prev -> None
curr -> obj-1
obj-1.next -> obj-2
obj-2.next -> obj-3

Step B:
prev -> None
curr -> obj-1
obj-1.next -> None
obj-2.next -> obj-3
```

Assert Step B has:

```ts
expect(step.visuals.find((v) => v.kind === "linked_list")).toEqual(
  expect.objectContaining({
    components: expect.arrayContaining([
      expect.objectContaining({ nodeIds: expect.arrayContaining(["obj-1"]) }),
      expect.objectContaining({ nodeIds: expect.arrayContaining(["obj-2", "obj-3"]) })
    ])
  })
);
```

Add a cycle fixture and assert the trace visualizer can `setStep()` without hanging and contains a visible cycle marker.

Add a terminal `exception` session with valid linked-list trace prefix and assert the last visual remains rendered while Output shows the exception.

Add a timeout session with captured linked-list events and assert the prefix remains renderable.

- [ ] **Step 2: Run integration tests and verify any uncovered failures**

```bash
npx vitest run tests/core/trace-interpreter.test.ts tests/sidepanel/trace-visualizer.test.ts tests/execution/trace-session-collector.test.ts tests/execution/execution-controller.test.ts
```

Expected: any failure points to a missing integration handoff, not a new architecture requirement. Fix the exact handoff in the owning module before proceeding.

- [ ] **Step 3: Add defensive degradation for truncated/dangling topology**

Core interpreter rule:

```ts
const target = topology.objects.get(reference.objectId);
if (!target) {
  // bound/truncation can produce unresolved targets;
  // retain the source node and mark model.truncated rather than throwing.
}
```

Renderer rule: show a finite unresolved target label such as:

```text
next -> …
```

when topology is truncated and the target object is absent.

Do not convert this visualization limitation into `runtime_error`.

- [ ] **Step 4: Run all integration and side-panel tests**

```bash
npx vitest run tests/core tests/execution tests/sidepanel tests/protocol
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests src/core src/sidepanel src/execution src/shared src/worker

git commit -m "test: cover linked list visualization workflow"
```

---

### Task 12: Add Lightweight Performance Measurements and Complete Full Verification

**Files:**
- Modify: `src/core/trace-interpreter.ts` only if a pure timing hook is needed.
- Modify: `src/sidepanel/components/TraceVisualizer.ts` only if a pure render timing hook is needed.
- Create or modify: focused test files under `tests/core/` and `tests/sidepanel/` to verify bounded behavior, not wall-clock CI speed.
- Modify: `README.md`
- Modify: `README.zh-TW.md`

**Interfaces:**
- No production telemetry backend.
- Expose optional local timing measurements only through debug instrumentation or `performance.now()` guarded helpers; do not add network calls.
- Enforce structural bounds in tests; treat the spec's `<100 ms` interpretation/render budgets as manual profiling guardrails rather than flaky CI assertions.

- [ ] **Step 1: Add bounded-work tests instead of flaky time assertions**

Add a topology fixture containing more than `maxObjectNodes` reachable objects and assert:

```ts
expect(state.objectTopology.objects.size).toBeLessThanOrEqual(200);
expect(state.objectTopology.truncated).toBe(true);
```

Add a visual model fixture with more than three candidates and assert:

```ts
expect(state.visuals).toHaveLength(3);
```

Do not write `expect(duration).toBeLessThan(100)` in CI.

- [ ] **Step 2: Run focused bound tests**

```bash
npx vitest run tests/core tests/execution/pyodide-runtime.test.ts
```

Expected: PASS and no unbounded traversal.

- [ ] **Step 3: Update user-facing coverage documentation**

In both READMEs, update the support boundary from:

```text
Linked list: not in v0.1
```

to a factual statement that Linked List has dedicated visualization support for Python runtime objects with `next` topology, including pointer labels, edge mutation, disconnected fragments, and cycle-safe display.

Keep Tree, Graph, and DP dedicated visualizers listed as unsupported.

Document that `completed` still does not mean LeetCode Accepted and local timeout still does not mean LeetCode TLE.

- [ ] **Step 4: Run complete verification**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

Then manually smoke-test the unpacked `dist/` extension on these LeetCode-style source/testcase pairs:

```text
Reverse Linked List: [1,2,3,4,5]
Linked List Cycle-style custom source with a locally constructed cycle
Middle of the Linked List: [1,2,3,4,5]
```

Confirm: live sync still updates without Run/Submit, active-tab switching still follows the exact active LeetCode tab, and existing Two Sum/Binary Search visuals still render.

- [ ] **Step 5: Commit**

```bash
git add README.md README.zh-TW.md tests src

git commit -m "docs: document linked list visualization support"
```

---

## Final Review Checklist

Before declaring the implementation complete, verify each item against the spec:

- Trace schema is v2 and `reference` snapshots carry opaque session-local object IDs.
- Object IDs remain stable across steps within one execution and reset across executions.
- Object capture uses explicit roots and safe instance attributes only.
- `maxObjectNodes`, `maxObjectAttributes`, and `maxObjectDepth` are enforced.
- Return events include topology reachable from returned objects.
- `curr = curr.next` produces local pointer movement without a fake topology mutation.
- `curr.next = prev` produces an object attribute/edge mutation.
- Linked-list components support partially reversed/disconnected fragments.
- Multiple locals pointing at the same node become pointer aliases on one visual structure.
- Cycles are detected with finite traversal and a visible cycle indication.
- Truncated/dangling targets degrade to partial visualization instead of throwing.
- `visuals` / `primaryVisualId` are the single source of rendering order.
- Visible visual count is capped at 3.
- `TraceVisualizer.ts` dispatches through the registry rather than a growing `if/else` chain.
- List/Dict existing tests remain green.
- Annotated `ListNode` parameters convert literal list testcase input; ordinary list parameters do not.
- Runtime exception and timeout sessions preserve linked-list trace prefixes.
- Tree/Graph/DP implementation has not entered this change.
- `npm test`, `npm run typecheck`, and `npm run build` all pass.

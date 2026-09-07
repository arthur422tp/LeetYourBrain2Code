# Runtime Mutation Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a deterministic, structure-neutral `RuntimeMutation[]` intermediate representation above `FrameDiff` / `ObjectDiff`, migrate existing visualization change semantics to it, and replace the Side Panel's raw-diff `State Changes` presentation with a mutation-backed `What Changed` view.

**Architecture:** Keep `state-diff.ts` and `object-diff.ts` as low-level comparison engines. Add focused mutation contracts plus a pure normalizer, produce one `RuntimeMutationBatch` per reconstructed runtime step inside `interpretTrace()`, then make List / Dict / Linked List visual interpretation and visual-candidate mutation relevance consume mutation events instead of independently decoding raw diffs. Retain raw diffs on `TraceInterpretation` and temporarily retain `VisualState.stateChanges` / `objectChanges` for compatibility, but no new presentation or structure-change semantics may depend on them.

**Tech Stack:** TypeScript 5.8, Vitest 3, Vite 6, Chrome Manifest V3 Side Panel, Pyodide 0.29.

**Spec:** `docs/superpowers/specs/2026-09-08-runtime-mutation-semantics-design.md`

## Global Constraints

- `RuntimeMutation` describes an observed difference between consecutive reconstructable runtime states; it must not claim a source line caused the change.
- Preserve current line-event semantics: a `line` event means that source line is about to execute.
- Do not add no-progress detection, repeated-state detection, loop compression, hot-line analysis, cross-revision diff, Tree, Graph, DP, AI inference, or source-line causal attribution.
- Do not change the worker protocol or trace schema for this milestone.
- Normalize only from existing `FrameDiff` / `ObjectDiff` plus explicit origin metadata; do not re-scan runtime containers or traverse topology in the normalizer.
- Every mutation carries `origin: "initial_snapshot" | "transition"`.
- Unchanged variables emit no mutations.
- Same-kind container changes suppress the duplicate coarse `VariableMutation` when a granular container diff exists.
- Object appearance/disappearance means capture visibility only, never allocation/deallocation/GC.
- Local and object-attribute reference binding / unbinding / redirection use the same generic `ReferenceMutation` contract.
- Keep mutation ordering deterministic according to the spec's category ordering.
- List / Dict / Linked List change highlighting and visual-candidate mutation relevance must consume mutation events by the end of the plan.
- The Side Panel panel title becomes `What Changed`; it must not render the old unchanged-variable group.
- Preserve live editor sync, active-tab ownership, testcase handling, runtime-error/timeout/trace-limit prefixes, current visualizers, Locals, Call Stack, stdout, and exception output.
- Final verification requires `npm test`, `npm run typecheck`, and `npm run build` to pass.

---

## File Structure Map

### New core contracts / normalization

- Create `src/core/runtime-mutation.ts` — typed mutation union, origin and batch contracts, small type guards used by downstream consumers.
- Create `src/core/runtime-mutation-normalizer.ts` — pure `FrameDiff` / `ObjectDiff` → deterministically ordered `RuntimeMutation[]` conversion.
- Create `tests/core/runtime-mutation-normalizer.test.ts` — exhaustive normalizer behavior, duplicate suppression, ordering, cloning, and origin tests.

### Trace interpretation / visual model

- Modify `src/core/trace-interpreter.ts` — compute per-frame origin, per-step object origin, mutation batches, and pass mutations into visual-state construction.
- Modify `src/core/visual-model.ts` — expose `mutations`, migrate List / Dict statuses and changed indexes, then migrate mutation relevance for candidate priority.
- Modify `tests/core/trace-interpreter.test.ts` — one-to-one batch alignment and per-frame origin tests.
- Modify `tests/core/visual-model.test.ts` — List / Dict highlighting plus mutation-driven candidate priority regression tests.

### Linked List

- Modify `src/core/linked-list-interpreter.ts` — replace raw `FrameDiff` / `ObjectDiff` change-status decoding with `RuntimeMutation[]`, while retaining topology-based cycle/component/detachment interpretation.
- Modify `tests/core/linked-list-interpreter.test.ts` — pointer, next-edge, node status, detached-fragment regressions using mutation events.

### Side Panel

- Create `src/sidepanel/components/MutationList.ts` — focused generic `What Changed` renderer.
- Modify `src/sidepanel/components/TraceVisualizer.ts` — replace raw-diff change rendering with `MutationList`, rename the panel, and keep current step navigation behavior.
- Create `tests/sidepanel/mutation-list.test.ts` — rendering coverage for every mutation family and copy constraints.
- Modify `tests/sidepanel/trace-visualizer.test.ts` — panel integration, step updates, empty states, and no unchanged-variable group.
- Modify `src/sidepanel/styles.css` — mutation rows / initial-observation marker styling only as needed.

### Compatibility choice for this milestone

Keep these existing fields temporarily:

```ts
VisualState.stateChanges: FrameDiff | null
VisualState.objectChanges: ObjectDiff | null
```

They remain diagnostic compatibility data only. New rendering and structure-change interpretation must use `VisualState.mutations`.

---

### Task 1: Define Runtime Mutation Contracts and Normalize Local Variable / Reference Changes

**Files:**
- Create: `src/core/runtime-mutation.ts`
- Create: `src/core/runtime-mutation-normalizer.ts`
- Create: `tests/core/runtime-mutation-normalizer.test.ts`

**Interfaces:**
- Produces: `MutationOrigin`, `ReferenceOwner`, all seven `RuntimeMutation` variants, `RuntimeMutation`, `RuntimeMutationBatch`.
- Produces: `normalizeRuntimeMutations(input): RuntimeMutation[]` with the exact input shape below.
- Later tasks consume these exact exported names.

- [ ] **Step 1: Write failing contract/variable/reference normalizer tests**

Create `tests/core/runtime-mutation-normalizer.test.ts` with focused helpers and the first behavior set:

```ts
import { describe, expect, it } from "vitest";

import { normalizeRuntimeMutations } from "../../src/core/runtime-mutation-normalizer";
import type { FrameDiff } from "../../src/core/state-diff";
import type { ObjectDiff } from "../../src/core/object-diff";
import type { ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const none = (): ValueSnapshot => ({ type: "none", value: null });
const reference = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "ListNode"
});

const emptyObjects: ObjectDiff = {
  addedObjectIds: [],
  removedObjectIds: [],
  attributeChanges: []
};

function normalize(frameDiff: FrameDiff | null, origin: "initial_snapshot" | "transition" = "transition") {
  return normalizeRuntimeMutations({
    frameDiff,
    objectDiff: emptyObjects,
    frameOrigin: origin,
    objectOrigin: origin
  });
}

describe("normalizeRuntimeMutations local variables", () => {
  it("emits scalar add/remove/change but never unchanged", () => {
    const result = normalize({
      frameId: 4,
      variables: [
        { name: "left", kind: "changed", before: int(2), after: int(3) },
        { name: "count", kind: "added", after: int(0) },
        { name: "old", kind: "removed", before: int(9) },
        { name: "right", kind: "unchanged", before: int(5), after: int(5) }
      ],
      containerChanges: []
    });

    expect(result).toEqual([
      {
        kind: "variable",
        origin: "transition",
        frameId: 4,
        variableName: "count",
        action: "added",
        after: int(0)
      },
      {
        kind: "variable",
        origin: "transition",
        frameId: 4,
        variableName: "left",
        action: "changed",
        before: int(2),
        after: int(3)
      },
      {
        kind: "variable",
        origin: "transition",
        frameId: 4,
        variableName: "old",
        action: "removed",
        before: int(9)
      }
    ]);
  });

  it("normalizes local reference bind, redirect, and unbind", () => {
    const result = normalize({
      frameId: 7,
      variables: [
        { name: "a", kind: "added", after: reference("obj-1") },
        { name: "b", kind: "changed", before: reference("obj-1"), after: reference("obj-2") },
        { name: "c", kind: "changed", before: reference("obj-3"), after: none() }
      ],
      containerChanges: []
    });

    expect(result).toEqual([
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 7, variableName: "a" },
        action: "bound",
        beforeObjectId: null,
        afterObjectId: "obj-1"
      },
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 7, variableName: "b" },
        action: "redirected",
        beforeObjectId: "obj-1",
        afterObjectId: "obj-2"
      },
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 7, variableName: "c" },
        action: "unbound",
        beforeObjectId: "obj-3",
        afterObjectId: null
      }
    ]);
  });

  it("keeps reference-to-scalar transitions lossless as ordinary variable changes", () => {
    const result = normalize({
      frameId: 1,
      variables: [{ name: "x", kind: "changed", before: reference("obj-1"), after: int(5) }],
      containerChanges: []
    });

    expect(result).toEqual([{
      kind: "variable",
      origin: "transition",
      frameId: 1,
      variableName: "x",
      action: "changed",
      before: reference("obj-1"),
      after: int(5)
    }]);
  });

  it("preserves initial snapshot origin", () => {
    expect(normalize({
      frameId: 1,
      variables: [{ name: "head", kind: "added", after: reference("obj-1") }],
      containerChanges: []
    }, "initial_snapshot")[0]).toMatchObject({ origin: "initial_snapshot" });
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
npx vitest run tests/core/runtime-mutation-normalizer.test.ts
```

Expected: FAIL because `runtime-mutation.ts` / `runtime-mutation-normalizer.ts` do not exist.

- [ ] **Step 3: Define the mutation contracts**

Create `src/core/runtime-mutation.ts`:

```ts
import type { ObjectId, ValueSnapshot } from "../shared/trace-types";

export type MutationOrigin = "initial_snapshot" | "transition";

export interface VariableMutation {
  kind: "variable";
  origin: MutationOrigin;
  frameId: number;
  variableName: string;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export type ReferenceOwner =
  | { scope: "local"; frameId: number; variableName: string }
  | { scope: "object_attribute"; objectId: ObjectId; attribute: string };

export interface ReferenceMutation {
  kind: "reference";
  origin: MutationOrigin;
  owner: ReferenceOwner;
  action: "bound" | "unbound" | "redirected";
  beforeObjectId: ObjectId | null;
  afterObjectId: ObjectId | null;
}

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

export interface SetMembershipMutation {
  kind: "set_membership";
  origin: MutationOrigin;
  frameId: number;
  containerName: string;
  action: "added" | "removed";
  member: ValueSnapshot;
}

export interface ObjectAttributeMutation {
  kind: "object_attribute";
  origin: MutationOrigin;
  objectId: ObjectId;
  attribute: string;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export interface ObjectVisibilityMutation {
  kind: "object_visibility";
  origin: MutationOrigin;
  objectId: ObjectId;
  action: "appeared" | "disappeared";
}

export type RuntimeMutation =
  | VariableMutation
  | ReferenceMutation
  | SequenceElementMutation
  | MappingEntryMutation
  | SetMembershipMutation
  | ObjectAttributeMutation
  | ObjectVisibilityMutation;

export interface RuntimeMutationBatch {
  step: number;
  frameId: number | null;
  currentLine: number | null;
  mutations: RuntimeMutation[];
}
```

- [ ] **Step 4: Implement local scalar/reference normalization minimally**

Create `src/core/runtime-mutation-normalizer.ts` with exact public input contract and helper logic:

```ts
import type { ObjectDiff } from "./object-diff";
import type { FrameDiff, VariableDiff } from "./state-diff";
import type { MutationOrigin, RuntimeMutation } from "./runtime-mutation";
import type { ValueSnapshot } from "../shared/trace-types";
import { cloneValueSnapshot } from "./value-snapshot";

export interface RuntimeMutationNormalizationInput {
  frameDiff: FrameDiff | null;
  objectDiff: ObjectDiff;
  frameOrigin: MutationOrigin;
  objectOrigin: MutationOrigin;
}

function isReference(value: ValueSnapshot | undefined): value is Extract<ValueSnapshot, { type: "reference" }> {
  return value?.type === "reference";
}

function isNone(value: ValueSnapshot | undefined): boolean {
  return value?.type === "none";
}

function localVariableMutation(diff: VariableDiff, frameId: number, origin: MutationOrigin): RuntimeMutation | null {
  if (diff.kind === "unchanged") return null;

  const beforeRef = isReference(diff.before) ? diff.before.objectId : null;
  const afterRef = isReference(diff.after) ? diff.after.objectId : null;
  const beforeAbsentOrNone = diff.before === undefined || isNone(diff.before);
  const afterAbsentOrNone = diff.after === undefined || isNone(diff.after);

  if (afterRef !== null && beforeAbsentOrNone) {
    return {
      kind: "reference",
      origin,
      owner: { scope: "local", frameId, variableName: diff.name },
      action: "bound",
      beforeObjectId: null,
      afterObjectId: afterRef
    };
  }
  if (beforeRef !== null && afterAbsentOrNone) {
    return {
      kind: "reference",
      origin,
      owner: { scope: "local", frameId, variableName: diff.name },
      action: "unbound",
      beforeObjectId: beforeRef,
      afterObjectId: null
    };
  }
  if (beforeRef !== null && afterRef !== null && beforeRef !== afterRef) {
    return {
      kind: "reference",
      origin,
      owner: { scope: "local", frameId, variableName: diff.name },
      action: "redirected",
      beforeObjectId: beforeRef,
      afterObjectId: afterRef
    };
  }

  return {
    kind: "variable",
    origin,
    frameId,
    variableName: diff.name,
    action: diff.kind,
    ...(diff.before !== undefined ? { before: cloneValueSnapshot(diff.before) } : {}),
    ...(diff.after !== undefined ? { after: cloneValueSnapshot(diff.after) } : {})
  };
}

export function normalizeRuntimeMutations(input: RuntimeMutationNormalizationInput): RuntimeMutation[] {
  const mutations = input.frameDiff
    ? input.frameDiff.variables
        .map((diff) => localVariableMutation(diff, input.frameDiff!.frameId, input.frameOrigin))
        .filter((mutation): mutation is RuntimeMutation => mutation !== null)
    : [];
  return mutations.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
```

This temporary ordering is allowed only inside Task 1; Task 2 replaces it with the canonical category ordering required by the spec.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npx vitest run tests/core/runtime-mutation-normalizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/runtime-mutation.ts src/core/runtime-mutation-normalizer.ts tests/core/runtime-mutation-normalizer.test.ts
git commit -m "feat: add runtime mutation contracts"
```

---

### Task 2: Normalize Containers, Object Changes, Visibility, Duplicate Suppression, and Canonical Ordering

**Files:**
- Modify: `src/core/runtime-mutation-normalizer.ts`
- Modify: `tests/core/runtime-mutation-normalizer.test.ts`

**Interfaces:**
- Consumes: `RuntimeMutation` contracts and `normalizeRuntimeMutations()` from Task 1.
- Produces: complete normalizer required by the spec; later tasks must not decode raw diff semantics independently when an equivalent mutation is available.

- [ ] **Step 1: Add failing tests for granular container normalization and duplicate suppression**

Append tests like:

```ts
it("prefers granular list changes over duplicate coarse variable changes", () => {
  const before: ValueSnapshot = { type: "list", length: 3, items: [int(1), int(2), int(3)], truncated: false };
  const after: ValueSnapshot = { type: "list", length: 3, items: [int(1), int(9), int(3)], truncated: false };

  const result = normalizeRuntimeMutations({
    frameDiff: {
      frameId: 4,
      variables: [{ name: "nums", kind: "changed", before, after }],
      containerChanges: [{
        container: "nums",
        kind: "list",
        changes: [{ index: 1, kind: "changed", before: int(2), after: int(9) }]
      }]
    },
    objectDiff: emptyObjects,
    frameOrigin: "transition",
    objectOrigin: "transition"
  });

  expect(result).toEqual([{
    kind: "sequence_element",
    origin: "transition",
    frameId: 4,
    containerName: "nums",
    containerKind: "list",
    index: 1,
    action: "changed",
    before: int(2),
    after: int(9)
  }]);
});

it("normalizes dict and set changes", () => {
  const key: ValueSnapshot = { type: "str", value: "a", length: 1, truncated: false };
  const result = normalizeRuntimeMutations({
    frameDiff: {
      frameId: 2,
      variables: [],
      containerChanges: [
        { container: "mapping", kind: "dict", changes: [{ key, kind: "added", after: int(1) }] },
        { container: "seen", kind: "set", changes: [{ member: int(7), kind: "added" }] }
      ]
    },
    objectDiff: emptyObjects,
    frameOrigin: "transition",
    objectOrigin: "transition"
  });

  expect(result).toEqual([
    expect.objectContaining({ kind: "mapping_entry", containerName: "mapping", action: "added" }),
    expect.objectContaining({ kind: "set_membership", containerName: "seen", action: "added" })
  ]);
});
```

- [ ] **Step 2: Add failing object-reference / attribute / visibility tests**

Add:

```ts
it("normalizes object reference redirects and scalar attributes", () => {
  const result = normalizeRuntimeMutations({
    frameDiff: null,
    objectDiff: {
      addedObjectIds: [],
      removedObjectIds: [],
      attributeChanges: [
        {
          objectId: "obj-2",
          attribute: "next",
          kind: "changed",
          before: reference("obj-3"),
          after: reference("obj-1")
        },
        {
          objectId: "obj-2",
          attribute: "val",
          kind: "changed",
          before: int(2),
          after: int(4)
        }
      ]
    },
    frameOrigin: "transition",
    objectOrigin: "transition"
  });

  expect(result).toEqual([
    {
      kind: "reference",
      origin: "transition",
      owner: { scope: "object_attribute", objectId: "obj-2", attribute: "next" },
      action: "redirected",
      beforeObjectId: "obj-3",
      afterObjectId: "obj-1"
    },
    {
      kind: "object_attribute",
      origin: "transition",
      objectId: "obj-2",
      attribute: "val",
      action: "changed",
      before: int(2),
      after: int(4)
    }
  ]);
});

it("uses capture visibility copy semantics rather than allocation semantics", () => {
  const result = normalizeRuntimeMutations({
    frameDiff: null,
    objectDiff: {
      addedObjectIds: ["obj-4"],
      removedObjectIds: ["obj-7"],
      attributeChanges: []
    },
    frameOrigin: "transition",
    objectOrigin: "transition"
  });

  expect(result).toEqual([
    { kind: "object_visibility", origin: "transition", objectId: "obj-4", action: "appeared" },
    { kind: "object_visibility", origin: "transition", objectId: "obj-7", action: "disappeared" }
  ]);
});
```

- [ ] **Step 3: Add clone-safety and exact ordering tests**

Build one mixed input and assert canonical category order:

```text
local reference
ordinary variable
sequence
mapping
set
object visibility
object-attribute reference
ordinary object attribute
```

Mutate the source `ValueSnapshot` after normalization and assert emitted `before` / `after` / `key` / `member` snapshots do not change.

- [ ] **Step 4: Run tests and verify failure**

```bash
npx vitest run tests/core/runtime-mutation-normalizer.test.ts
```

Expected: FAIL because Task 1 only handles local variable/reference events and temporary JSON ordering.

- [ ] **Step 5: Implement complete granular normalization**

In `runtime-mutation-normalizer.ts`:

1. Build `granularContainers = new Set(frameDiff.containerChanges.map(change => change.container))`.
2. Skip only `VariableDiff.kind === "changed"` entries whose variable name is in `granularContainers`; keep added/removed containers as ordinary variable mutations.
3. Convert each `ContainerDiff` item into `sequence_element`, `mapping_entry`, or `set_membership` with cloned snapshots.
4. Convert `ObjectDiff.addedObjectIds` / `removedObjectIds` into `object_visibility`.
5. Convert object attribute reference transitions with the same factual rules as local references.
6. Keep mixed reference↔non-reference object changes losslessly as `object_attribute`.

Use a helper equivalent to:

```ts
function classifyReferenceTransition(
  before: ValueSnapshot | undefined,
  after: ValueSnapshot | undefined
): { action: "bound" | "unbound" | "redirected"; beforeObjectId: string | null; afterObjectId: string | null } | null {
  const beforeRef = isReference(before) ? before.objectId : null;
  const afterRef = isReference(after) ? after.objectId : null;
  const beforeAbsentOrNone = before === undefined || isNone(before);
  const afterAbsentOrNone = after === undefined || isNone(after);

  if (afterRef !== null && beforeAbsentOrNone) {
    return { action: "bound", beforeObjectId: null, afterObjectId: afterRef };
  }
  if (beforeRef !== null && afterAbsentOrNone) {
    return { action: "unbound", beforeObjectId: beforeRef, afterObjectId: null };
  }
  if (beforeRef !== null && afterRef !== null && beforeRef !== afterRef) {
    return { action: "redirected", beforeObjectId: beforeRef, afterObjectId: afterRef };
  }
  return null;
}
```

- [ ] **Step 6: Replace temporary JSON sorting with canonical ordering**

Implement an explicit category rank:

```ts
const CATEGORY_RANK: Record<RuntimeMutation["kind"], number> = {
  reference: 0,
  variable: 1,
  sequence_element: 2,
  mapping_entry: 3,
  set_membership: 4,
  object_visibility: 5,
  object_attribute: 7
};
```

Because `reference` contains both local and object-attribute reference events, use a refined helper:

```ts
function categoryRank(mutation: RuntimeMutation): number {
  if (mutation.kind === "reference") {
    return mutation.owner.scope === "local" ? 0 : 6;
  }
  return CATEGORY_RANK[mutation.kind];
}
```

Then compare the exact stable keys from the spec. Use `valueSnapshotKey()` for mapping keys and set members.

- [ ] **Step 7: Run focused tests and typecheck**

```bash
npx vitest run tests/core/runtime-mutation-normalizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/runtime-mutation-normalizer.ts tests/core/runtime-mutation-normalizer.test.ts
git commit -m "feat: normalize runtime mutations"
```

---

### Task 3: Produce One Mutation Batch Per Reconstructed Trace Step

**Files:**
- Modify: `src/core/trace-interpreter.ts`
- Modify: `src/core/visual-model.ts`
- Modify: `tests/core/trace-interpreter.test.ts`

**Interfaces:**
- Consumes: `normalizeRuntimeMutations()` and `RuntimeMutationBatch`.
- Produces: `TraceInterpretation.mutationBatches: RuntimeMutationBatch[]`.
- Produces: `VisualState.mutations: RuntimeMutation[]`.
- Keeps: existing `frameDiffs`, `objectDiffs`, `VisualState.stateChanges`, and `VisualState.objectChanges` for compatibility during this milestone.

- [ ] **Step 1: Write failing batch-alignment and frame-origin tests**

Add to `tests/core/trace-interpreter.test.ts`:

```ts
it("aligns one mutation batch with every reconstructed runtime state", () => {
  const result = interpretTrace([
    event(1, "solve", { left: int(0) }),
    event(2, "solve", { left: int(1) })
  ]);

  expect(result.mutationBatches).toHaveLength(result.runtimeStates.length);
  expect(result.mutationBatches.map((batch) => batch.step)).toEqual([1, 2]);
  expect(result.mutationBatches[0]?.mutations[0]).toMatchObject({ origin: "initial_snapshot" });
  expect(result.mutationBatches[1]?.mutations).toEqual([
    expect.objectContaining({
      kind: "variable",
      origin: "transition",
      variableName: "left",
      action: "changed"
    })
  ]);
});
```

Add a nested-frame test:

```ts
it("tracks initial snapshot origin independently for each frame", () => {
  const result = interpretTrace([
    event(1, "dfs", { node: int(3) }, { frameId: 1, event: "call", line: 1 }),
    event(2, "dfs", { node: int(2) }, { frameId: 2, parentFrameId: 1, callDepth: 2, event: "call", line: 1 }),
    event(3, "dfs", { node: int(2), child: int(1) }, { frameId: 2, parentFrameId: 1, callDepth: 2 })
  ]);

  expect(result.mutationBatches[0]?.mutations.every((m) => m.origin === "initial_snapshot")).toBe(true);
  expect(result.mutationBatches[1]?.mutations.every((m) => m.origin === "initial_snapshot")).toBe(true);
  expect(result.mutationBatches[2]?.mutations).toContainEqual(
    expect.objectContaining({ origin: "transition", kind: "variable", variableName: "child" })
  );
});
```

- [ ] **Step 2: Add object-origin test**

Use existing `objectNode()` fixtures and assert first-step `object_visibility appeared` is `initial_snapshot`, while an object first appearing at a later step is `transition`.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
npx vitest run tests/core/trace-interpreter.test.ts
```

Expected: FAIL because `mutationBatches` / `VisualState.mutations` do not exist.

- [ ] **Step 4: Compute frame origins before updating previous-frame state**

Refactor the current `frameDiffs` map into one pass that records both diff and origin:

```ts
const previousFrameStates = new Map<number, FrameState>();
const frameResults = runtimeStates.map((runtime) => {
  const currentFrame = activeFrame(runtime);
  if (!currentFrame) {
    return { diff: null, origin: "transition" as const };
  }
  const previousFrame = previousFrameStates.get(currentFrame.frameId);
  const origin = previousFrame ? "transition" as const : "initial_snapshot" as const;
  const diff = diffFrameState(previousFrame, currentFrame);
  previousFrameStates.set(currentFrame.frameId, currentFrame);
  return { diff, origin };
});
const frameDiffs = frameResults.map((result) => result.diff);
```

For frame-less runtime states, origin is irrelevant because `frameDiff` is `null`; use `transition` only as an internal placeholder and emit no frame mutations.

- [ ] **Step 5: Build mutation batches one-to-one with runtime states**

After `objectDiffs`:

```ts
const mutationBatches = runtimeStates.map((runtime, index) => ({
  step: runtime.step,
  frameId: runtime.activeFrameId,
  currentLine: runtime.currentLine,
  mutations: normalizeRuntimeMutations({
    frameDiff: frameDiffs[index] ?? null,
    objectDiff: objectDiffs[index]!,
    frameOrigin: frameResults[index]!.origin,
    objectOrigin: index === 0 ? "initial_snapshot" : "transition"
  })
}));
```

Add `mutationBatches` to `TraceInterpretation` and return it.

- [ ] **Step 6: Add `mutations` to `VisualState` without removing compatibility fields**

Change `buildVisualState()` signature to accept the current step's mutations:

```ts
export function buildVisualState(
  runtime: RuntimeState,
  diff: FrameDiff | null,
  relations: StaticRelation[],
  objectDiff: ObjectDiff | null = null,
  mutations: RuntimeMutation[] = []
): VisualState
```

and set:

```ts
mutations: mutations.map(cloneRuntimeMutation)
```

Add a focused `cloneRuntimeMutation()` export in `runtime-mutation.ts` or a local helper that deep-clones every embedded `ValueSnapshot`; do not expose shared mutable references from interpretation state.

Call `buildVisualState(..., mutationBatches[index]!.mutations)` from `interpretTrace()`.

- [ ] **Step 7: Run focused tests and typecheck**

```bash
npx vitest run tests/core/trace-interpreter.test.ts tests/core/visual-model.test.ts
npm run typecheck
```

Expected: PASS with existing visual behavior unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/core/runtime-mutation.ts src/core/trace-interpreter.ts src/core/visual-model.ts tests/core/trace-interpreter.test.ts
git commit -m "feat: attach mutation batches to traces"
```

---

### Task 4: Migrate List / Dict Highlighting to Runtime Mutations

**Files:**
- Modify: `src/core/visual-model.ts`
- Modify: `tests/core/visual-model.test.ts`
- Modify: `tests/core/trace-interpreter.test.ts`

**Interfaces:**
- Consumes: `RuntimeMutation[]` passed into `buildVisualState()`.
- Produces: List `changedIndexes` and Dict entry statuses derived from mutation events, not `FrameDiff.containerChanges`.
- Leaves AST-based pointer/probe bindings unchanged.

- [ ] **Step 1: Add tests proving List / Dict highlighting works even when raw diff is unavailable to the builder**

In `tests/core/visual-model.test.ts`, call `buildVisualState()` with `diff = null` but explicit mutations.

List example:

```ts
const mutations: RuntimeMutation[] = [{
  kind: "sequence_element",
  origin: "transition",
  frameId: 4,
  containerName: "nums",
  containerKind: "list",
  index: 1,
  action: "changed",
  before: int(7),
  after: int(9)
}];

const state = buildVisualState(runtime, null, [], null, mutations);
const visual = state.visuals.find((item) => item.visualId === "list:nums");
expect(visual).toMatchObject({ changedIndexes: [1] });
```

Dict example should assert an added or changed entry status from `mapping_entry` with `diff = null`.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npx vitest run tests/core/visual-model.test.ts
```

Expected: FAIL because `changedIndexes()` / Dict status logic still reads raw `FrameDiff`.

- [ ] **Step 3: Replace List raw-diff lookup with mutation lookup**

Replace `changedIndexes(diff, container)` with:

```ts
function changedIndexes(mutations: RuntimeMutation[], frameId: number, container: string): number[] {
  return mutations
    .filter((mutation): mutation is SequenceElementMutation =>
      mutation.kind === "sequence_element" &&
      mutation.frameId === frameId &&
      mutation.containerName === container
    )
    .map((mutation) => mutation.index)
    .filter((index, position, all) => all.indexOf(index) === position)
    .sort((a, b) => a - b);
}
```

Pass `mutations` into `buildListVisual()`.

- [ ] **Step 4: Replace Dict raw-diff lookup with mapping mutations**

Build `statusByKey` from:

```ts
mutations.filter((mutation) =>
  mutation.kind === "mapping_entry" &&
  mutation.frameId === frame.frameId &&
  mutation.containerName === container &&
  mutation.action !== "removed"
)
```

Map action `added` → `added`, `changed` → `changed`; unchanged current entries default to `unchanged`.

Keep AST probe logic exactly as-is.

- [ ] **Step 5: Remove now-unused `ContainerDiff` dependency from visual-model change highlighting**

Do not remove `FrameDiff` from `buildVisualState()` yet because compatibility `stateChanges` remains in `VisualState` during this milestone.

- [ ] **Step 6: Run focused tests**

```bash
npx vitest run tests/core/visual-model.test.ts tests/core/trace-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/visual-model.ts tests/core/visual-model.test.ts tests/core/trace-interpreter.test.ts
git commit -m "refactor: drive container visuals from mutations"
```

---

### Task 5: Migrate Linked List Pointer / Edge / Node Status Interpretation to Runtime Mutations

**Files:**
- Modify: `src/core/linked-list-interpreter.ts`
- Modify: `src/core/visual-model.ts`
- Modify: `tests/core/linked-list-interpreter.test.ts`
- Modify: `tests/core/trace-interpreter.test.ts`

**Interfaces:**
- Consumes: `RuntimeMutation[]`.
- Changes: `buildLinkedListVisuals(runtime, mutations): LinkedListVisualModel[]`.
- Retains: runtime topology inspection for nodes, labels, components, cycle, truncation, and detached-component derivation.

- [ ] **Step 1: Rewrite focused tests to construct mutations instead of raw diffs**

For pointer movement:

```ts
const mutations: RuntimeMutation[] = [{
  kind: "reference",
  origin: "transition",
  owner: { scope: "local", frameId: 4, variableName: "curr" },
  action: "redirected",
  beforeObjectId: "obj-1",
  afterObjectId: "obj-2"
}];

const visual = buildLinkedListVisuals(runtime, mutations)[0]!;
expect(visual.pointers).toContainEqual({
  variableName: "curr",
  objectId: "obj-2",
  status: "moved"
});
```

For a `next` redirect:

```ts
{
  kind: "reference",
  origin: "transition",
  owner: { scope: "object_attribute", objectId: "obj-2", attribute: "next" },
  action: "redirected",
  beforeObjectId: "obj-3",
  afterObjectId: "obj-1"
}
```

Assert `obj-2.nextStatus === "changed"`.

- [ ] **Step 2: Add node-status and detachment tests**

Cover:

- `object_visibility appeared` → node status `added`;
- ordinary `object_attribute` change on candidate → node status `changed`;
- `.next` redirection that leaves the old target with no incoming edge → old target status `detached` when topology justifies it;
- cycle and component results remain based on topology, not mutation event guesses.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
npx vitest run tests/core/linked-list-interpreter.test.ts tests/core/trace-interpreter.test.ts
```

Expected: FAIL because `buildLinkedListVisuals()` still expects `FrameDiff` / `ObjectDiff`.

- [ ] **Step 4: Replace pointer status decoding**

Implement local-reference lookup helpers:

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
```

Map:

```text
bound      → added
unbound    → removed
redirected → moved
```

For current local references without a matching mutation, status is `unchanged`.

For an `unbound` local no longer present in current locals, append a null pointer row exactly as the current implementation does for removed references.

- [ ] **Step 5: Replace object/node status decoding**

For each candidate object:

```text
object_visibility appeared
    → added

otherwise detached by topology-relative derivation
    → detached

otherwise any reference/object_attribute mutation owned by object
    → changed

otherwise
    → unchanged
```

For `nextStatus`, map object-attribute `ReferenceMutation` on attribute `next`:

```text
bound      → added
unbound    → removed
redirected → changed
```

If `.next` changes reference↔scalar and therefore normalized as `ObjectAttributeMutation`, map its raw action to `added` / `removed` / `changed` only if the attribute is `next`; this preserves lossless mixed-type behavior without forcing the mutation layer to misclassify it as a reference event.

- [ ] **Step 6: Rewrite detached-node derivation to consume mutations plus current topology**

Replace `ObjectDiff.attributeChanges` scanning with mutation scanning:

```ts
const previousTargets = mutations
  .filter((mutation): mutation is ReferenceMutation =>
    mutation.kind === "reference" &&
    mutation.owner.scope === "object_attribute" &&
    mutation.owner.attribute === "next" &&
    mutation.beforeObjectId !== null &&
    mutation.beforeObjectId !== mutation.afterObjectId
  )
  .map((mutation) => mutation.beforeObjectId!);
```

For each previous target, mark detached only when it is still a candidate and current topology has zero incoming `next` references. This preserves the existing factual topology rule.

- [ ] **Step 7: Change public signature and update visual-model caller**

Use:

```ts
export function buildLinkedListVisuals(
  runtime: RuntimeState,
  mutations: RuntimeMutation[]
): LinkedListVisualModel[]
```

Call it from `buildVisualState(runtime, ..., mutations)`.

- [ ] **Step 8: Run focused tests and typecheck**

```bash
npx vitest run tests/core/linked-list-interpreter.test.ts tests/core/visual-model.test.ts tests/core/trace-interpreter.test.ts
npm run typecheck
```

Expected: PASS with Linked List cycle/component/pointer/edge behavior unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/core/linked-list-interpreter.ts src/core/visual-model.ts tests/core/linked-list-interpreter.test.ts tests/core/trace-interpreter.test.ts
git commit -m "refactor: drive linked lists from mutations"
```

---

### Task 6: Drive Visual Candidate Mutation Relevance from Runtime Mutations

**Files:**
- Modify: `src/core/visual-model.ts`
- Modify: `tests/core/visual-model.test.ts`
- Modify: `tests/core/visual-candidate-resolver.test.ts` only if an existing assertion needs a compatibility update; do not change resolver ranking semantics.

**Interfaces:**
- Consumes: `RuntimeMutation[]`.
- Produces: candidate `mutated` boolean without consulting raw `FrameDiff` / `ObjectDiff`.
- Keeps: `resolveVisualCandidates()` unchanged.

- [ ] **Step 1: Add failing candidate-priority regression tests**

Construct a runtime with multiple visible visuals where only one receives a matching mutation, and assert it rises in visible/primary ordering exactly as before.

Cover at least:

```text
List + Dict: sequence/mapping mutation picks the changed visual
Linked List + List: linked-list-owned reference mutation marks linked list mutated
```

- [ ] **Step 2: Run focused test and verify failure**

```bash
npx vitest run tests/core/visual-model.test.ts tests/core/visual-candidate-resolver.test.ts
```

Expected: FAIL because candidate construction still calculates `changedContainers` from `FrameDiff` and uses any `ObjectDiff` change as linked-list mutation relevance.

- [ ] **Step 3: Add structure-specific mutation relevance helpers in `visual-model.ts`**

For container visuals:

```ts
function containerWasMutated(
  visual: ListVisualModel | DictVisualModel,
  frameId: number,
  mutations: RuntimeMutation[]
): boolean {
  return mutations.some((mutation) => {
    if (mutation.kind === "sequence_element") {
      return visual.kind === "list" && mutation.frameId === frameId && mutation.containerName === visual.variableName;
    }
    if (mutation.kind === "mapping_entry") {
      return visual.kind === "dict" && mutation.frameId === frameId && mutation.containerName === visual.variableName;
    }
    return false;
  });
}
```

For linked lists, compute candidate object IDs from `visual.nodes` and current pointer variable names from `visual.pointers`, then mark mutated only if a mutation touches:

- one of those local pointer variables;
- one of those object IDs via reference owner / object attribute / visibility.

Do not treat an unrelated object mutation elsewhere in topology as linked-list mutation relevance.

- [ ] **Step 4: Remove raw changed-container / any-object-diff mutation scoring**

Keep `activeLineContainers` AST relevance unchanged because it is independent source-expression relevance, not runtime mutation semantics.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
npx vitest run tests/core/visual-model.test.ts tests/core/visual-candidate-resolver.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/visual-model.ts tests/core/visual-model.test.ts tests/core/visual-candidate-resolver.test.ts
git commit -m "refactor: rank visuals from runtime mutations"
```

---

### Task 7: Add a Focused MutationList Renderer and Replace `State Changes` with `What Changed`

**Files:**
- Create: `src/sidepanel/components/MutationList.ts`
- Create: `tests/sidepanel/mutation-list.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Consumes: `RuntimeMutation[]` from `VisualState.mutations`.
- Produces: `createMutationList(mutations: RuntimeMutation[]): HTMLElement`.
- `TraceVisualizer` no longer uses `FrameDiff` / `VariableDiff` for change rendering.

- [ ] **Step 1: Write failing renderer tests for every mutation family**

Create `tests/sidepanel/mutation-list.test.ts` and test textual rows without coupling to decorative CSS.

Example:

```ts
import { describe, expect, it } from "vitest";
import { createMutationList } from "../../src/sidepanel/components/MutationList";
import type { RuntimeMutation } from "../../src/core/runtime-mutation";

const int = (value: number) => ({ type: "int", value: String(value) } as const);

it("renders factual scalar and sequence changes", () => {
  const mutations: RuntimeMutation[] = [
    {
      kind: "variable",
      origin: "transition",
      frameId: 1,
      variableName: "left",
      action: "changed",
      before: int(2),
      after: int(3)
    },
    {
      kind: "sequence_element",
      origin: "transition",
      frameId: 1,
      containerName: "nums",
      containerKind: "list",
      index: 4,
      action: "changed",
      before: int(7),
      after: int(9)
    }
  ];

  const element = createMutationList(mutations);
  expect(element.textContent).toContain("left");
  expect(element.textContent).toContain("2");
  expect(element.textContent).toContain("3");
  expect(element.textContent).toContain("nums[4]");
  expect(element.textContent).toContain("7");
  expect(element.textContent).toContain("9");
});
```

Add coverage for:

- mapping added/removed/changed;
- set membership added/removed;
- local reference bound/unbound/redirected;
- object-attribute reference mutation;
- scalar object-attribute mutation;
- object visibility appeared/disappeared;
- initial observation marker;
- empty mutation list.

- [ ] **Step 2: Add wording guard tests**

For visibility rows:

```ts
const text = createMutationList([
  { kind: "object_visibility", origin: "transition", objectId: "obj-7", action: "disappeared" }
]).textContent ?? "";

expect(text).toContain("disappeared from captured topology");
expect(text).not.toMatch(/allocated|deleted|freed|garbage/i);
```

For any mutation list:

```ts
expect(text).not.toMatch(/line \d+ (caused|changed|moved|wrote)/i);
```

The renderer does not receive `currentLine`, which structurally prevents causal source-line copy.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
npx vitest run tests/sidepanel/mutation-list.test.ts
```

Expected: FAIL because `MutationList.ts` does not exist.

- [ ] **Step 4: Implement `MutationList.ts` as a focused renderer**

Use the existing `formatValue()` helper. Keep DOM creation local to the component.

Public API:

```ts
export function createMutationList(mutations: RuntimeMutation[]): HTMLDivElement
```

Required label formatting:

```text
variable            → variableName
sequence_element    → containerName[index]
mapping_entry       → containerName[formatted key]
set_membership      → containerName · formatted member
local reference     → variableName
object reference    → objectId.attribute
object_attribute    → objectId.attribute
object_visibility   → objectId
```

Required value copy:

```text
changed / redirected → before → after
added / bound         → + after
removed / unbound     → − before
set added             → added
set removed           → removed
visibility appeared   → appeared in captured topology
visibility disappeared→ disappeared from captured topology
```

For `initial_snapshot`, add a small row marker text such as:

```text
initial observation
```

If all events are initial snapshot events, prepend a group label:

```text
Initial observations
```

If `mutations.length === 0`, render:

```text
No observed state change at this step.
```

- [ ] **Step 5: Run mutation-list tests**

```bash
npx vitest run tests/sidepanel/mutation-list.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write failing TraceVisualizer integration tests**

Update `tests/sidepanel/trace-visualizer.test.ts` to assert:

```text
panel title = What Changed
old title State Changes absent
old Changed / Unchanged groups absent
step navigation replaces mutation content for the current step
empty transition step shows neutral empty message
Locals / Call Stack / Output panels still exist
```

- [ ] **Step 7: Replace raw-diff rendering in `TraceVisualizer.ts`**

Remove:

```text
renderVariableDiff()
renderContainerChanges()
renderChanges()
```

and raw imports:

```ts
FrameDiff
VariableDiff
```

Import `createMutationList` and create:

```ts
const changesPanel = createPanel("What Changed", "trace-viewer__changes-panel");
```

At each step:

```ts
changesPanel.body.replaceChildren(createMutationList(state?.mutations ?? []));
```

For no captured steps use `createMutationList([])`.

- [ ] **Step 8: Add minimal mutation styling**

In `styles.css`, add only focused selectors needed by `MutationList`, reusing current typography/spacing tokens where possible. Do not redesign the rest of the trace UI.

- [ ] **Step 9: Run Side Panel tests and typecheck**

```bash
npx vitest run tests/sidepanel/mutation-list.test.ts tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/sidepanel/components/MutationList.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/mutation-list.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: show semantic runtime mutations"
```

---

### Task 8: Verify Downstream Raw-Diff Decoupling and Full Regression Suite

**Files:**
- Modify only files required by failing regression tests; do not perform unrelated cleanup.
- Inspect: `src/core/visual-model.ts`
- Inspect: `src/core/linked-list-interpreter.ts`
- Inspect: `src/sidepanel/components/TraceVisualizer.ts`
- Inspect: `tests/core/*`
- Inspect: `tests/sidepanel/*`

**Interfaces:**
- Validates the final architectural boundary.
- No new product feature is introduced in this task.

- [ ] **Step 1: Search for prohibited downstream raw-diff semantics**

Run:

```bash
grep -R "containerChanges\|attributeChanges\|addedObjectIds\|removedObjectIds" \
  src/core/visual-model.ts \
  src/core/linked-list-interpreter.ts \
  src/sidepanel/components/TraceVisualizer.ts
```

Expected final state:

- `visual-model.ts` may retain raw diff assignment for compatibility fields only; it must not use those members to derive List / Dict status or candidate mutation relevance.
- `linked-list-interpreter.ts` must not consume `FrameDiff` / `ObjectDiff` or their members.
- `TraceVisualizer.ts` must not consume raw diff members for `What Changed`.

If the grep finds semantic consumers, replace them with mutation-based logic before continuing.

- [ ] **Step 2: Add/confirm invariants in trace-interpreter tests**

Ensure one test asserts:

```ts
expect(result.runtimeStates.length).toBe(result.frameDiffs.length);
expect(result.runtimeStates.length).toBe(result.objectDiffs.length);
expect(result.runtimeStates.length).toBe(result.mutationBatches.length);
expect(result.runtimeStates.length).toBe(result.visualStates.length);
```

Also assert:

```ts
expect(result.visualStates[index]?.mutations).toEqual(result.mutationBatches[index]?.mutations);
```

- [ ] **Step 3: Run all core mutation / visualization tests**

```bash
npx vitest run \
  tests/core/runtime-mutation-normalizer.test.ts \
  tests/core/state-diff.test.ts \
  tests/core/object-diff.test.ts \
  tests/core/trace-interpreter.test.ts \
  tests/core/visual-model.test.ts \
  tests/core/linked-list-interpreter.test.ts \
  tests/core/visual-candidate-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run all relevant Side Panel tests**

```bash
npx vitest run \
  tests/sidepanel/mutation-list.test.ts \
  tests/sidepanel/trace-visualizer.test.ts \
  tests/sidepanel/list-visualizer.test.ts \
  tests/sidepanel/linked-list-visualizer.test.ts \
  tests/sidepanel/value-format.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full verification**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Inspect final scope for accidental Behavioral Signals work**

Run:

```bash
grep -R "no_progress\|repeated_state\|BehavioralSignal\|hot_line\|trace compression" src tests || true
```

Expected: no newly implemented behavior-analysis layer. Mentions in documentation/comments are acceptable only when clearly marked as future work.

- [ ] **Step 7: Commit final regression adjustments if any**

If Step 1–6 required code/test changes:

```bash
git add src tests
git commit -m "test: verify runtime mutation integration"
```

If no changes were required, do not create an empty commit.

---

## Completion Checklist

The implementation is complete only when all statements below are true:

- `RuntimeMutation` has exactly the seven first-version semantic families from the spec.
- Every mutation carries `initial_snapshot` or `transition` origin.
- `normalizeRuntimeMutations()` is pure, deterministic, clone-safe, and uses only raw diffs plus origin metadata.
- Same-kind container coarse diffs are suppressed when granular mutations exist.
- Reference↔scalar changes remain lossless ordinary value/attribute mutations.
- Object visibility is never described as allocation/deallocation/GC.
- `TraceInterpretation` exposes one mutation batch per runtime state.
- `VisualState` exposes current-step mutations.
- List changed indexes come from sequence mutations.
- Dict changed/added statuses come from mapping mutations.
- Linked List pointer / next-edge / node change status comes from mutation events; topology semantics remain structure-specific.
- Candidate mutation relevance uses mutation events.
- `What Changed` uses mutation events and contains no unchanged-variable group.
- No UI copy claims the current source line caused a mutation.
- Raw `FrameDiff` / `ObjectDiff` remain available as lower-level interpretation outputs.
- Worker protocol and trace schema are unchanged.
- No Behavioral Signals implementation is included.
- `npm test`, `npm run typecheck`, and `npm run build` all pass.

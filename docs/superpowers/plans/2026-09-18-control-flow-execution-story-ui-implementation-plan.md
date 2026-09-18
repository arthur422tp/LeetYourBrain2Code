# Control-Flow Execution Story UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Control-Flow Evidence foundation into an occurrence-scoped Execution Story UI that explains factual loop iterations, decisions, transfers, and loop exits while preserving the existing raw trace cursor and evidence-first product boundary.

**Architecture:** Keep worker/runtime evidence authoritative and build a pure TypeScript presentation projection between core interpretation and DOM rendering. Before UI work, remove the remaining gated `break/continue` instrumentation and derive concrete loop activation scope from existing `frameId + parent ExecutionContextRef + static loopId`; no worker protocol change is required. The Side Panel then renders one Execution Story panel, activation-scoped iteration history, contextual Decision chains, factual source badges, and optional Control-Flow grouping in Trace Outline while leaving Behavioral Timeline and Failure-First behavior unchanged.

**Tech Stack:** Python 3 AST instrumentation, Pyodide 0.29.3, TypeScript 5.8, DOM APIs, Vitest 3.2, existing Side Panel CSS, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-control-flow-execution-story-ui-design.md`

**Runtime correction dependency:** `docs/superpowers/specs/2026-09-18-control-flow-foundation-correction-design.md`

## Global Constraints

- Control-Flow UI is a projection of factual interpreted evidence; it must not own or recreate runtime state machines.
- No worker protocol or Trace schema change is required for loop activation scope.
- Concrete loop activation scope is derived from `frameId + parent ExecutionContextRef.loopStack + static loopId`.
- Activation-local display ordinals are projection metadata; do not rewrite worker iteration numbers.
- A `break` or `continue` observation probe must never gate whether Python executes the original transfer statement.
- Synthetic lifecycle/transfer probes must remain hidden from user-visible trace steps.
- The raw trace cursor remains authoritative; all Control-Flow navigation resolves to existing raw steps/indexes.
- Behavioral Timeline receives no generic Control-Flow lane.
- Failure-First selection logic remains unchanged.
- No UI text may imply correctness, expected path, root cause, or recommended fix.
- Preserve factual distinctions between `observed`, `committed`, `superseded`, and `interrupted`.
- Tracing `truncated` / `unavailable` states must preserve already captured evidence.
- No inferred loop exit, branch selection, or transfer commitment may be fabricated from missing evidence.
- Semantic states must have text/data attributes and must not rely on color alone.

---

### Task 0: UI Prerequisite Cleanup — Ungated Transfers and Concrete Loop Activation Scope

**Files:**
- Modify: `src/worker/python/control_flow_instrumenter.py`
- Modify: `tests/fixtures/python/test_control_flow_instrumenter.py`
- Create: `src/core/control-flow-scope.ts`
- Create: `tests/core/control-flow-scope.test.ts`
- Modify: `src/core/control-flow-interpreter.ts`
- Modify: `tests/core/control-flow-interpreter.test.ts`

**Interfaces:**
- Produces `controlFlowActivationKey(frameId: number, loopId: string, context: ExecutionContextRef): string`.
- Produces `iterationActivationKey(iteration: LoopIterationEvidence): string`.
- Extends `ControlFlowInterpretation` with `iterationsByActivation: Map<string, LoopIterationEvidence[]>`.
- Keeps all public worker messages and `ControlFlowRuntimeEvent` wire types unchanged.

- [ ] **Step 1: Add a failing instrumenter regression proving `break/continue` do not depend on observer truthiness**

Add to `tests/fixtures/python/test_control_flow_instrumenter.py`:

```python
def test_break_and_continue_are_not_gated_by_observer_return_value(self):
    break_source = """def solve(xs):
    for x in xs:
        break
    return 7
"""
    result = instrument_control_flow(
        break_source, ast.parse(break_source),
        "ib", "ic", "to", "ro", "ne", "after"
    )
    namespace = {
        "ib": lambda *_args: None,
        "ic": lambda *_args: None,
        "to": lambda *_args: False,
        "ro": lambda _site, value: value,
        "ne": lambda *_args: None,
        "after": lambda *_args: None,
    }
    exec(compile(result.instrumented_tree, "<test>", "exec"), namespace, namespace)
    self.assertEqual(namespace["solve"]([1, 2]), 7)
```

Add the same shape for `continue` with `to` returning `None` and assert `[1, 2]` becomes `[2]`.

Run:

```bash
python3 -m unittest \
  tests.fixtures.python.test_control_flow_instrumenter.ControlFlowInstrumenterTests.test_break_and_continue_are_not_gated_by_observer_return_value
```

Expected: FAIL with the current synthetic `if observer(): break/continue` rewrite.

- [ ] **Step 2: Rewrite `break/continue` as side-effect-only synthetic probe + original statement**

In `src/worker/python/control_flow_instrumenter.py`, replace the guarded rewrite with:

```python
probe = self._synthetic_expr(self.transfer_observed_name, args, node)
return [probe, node]
```

Do not change `return` wrapping.

Run:

```bash
python3 -m unittest tests.fixtures.python.test_control_flow_instrumenter
```

Expected: PASS.

- [ ] **Step 3: Add failing activation-scope tests**

Create `tests/core/control-flow-scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  controlFlowActivationKey,
  iterationActivationKey
} from "../../src/core/control-flow-scope";

describe("control-flow activation scope", () => {
  it("keeps one top-level activation across iterations", () => {
    expect(controlFlowActivationKey(3, "f1", {
      loopStack: [{ loopId: "f1", iteration: 1 }]
    })).toBe("3:root>f1");
    expect(controlFlowActivationKey(3, "f1", {
      loopStack: [{ loopId: "f1", iteration: 2 }]
    })).toBe("3:root>f1");
  });

  it("separates repeated inner-loop activations by parent occurrence", () => {
    expect(controlFlowActivationKey(3, "f2", {
      loopStack: [
        { loopId: "f1", iteration: 1 },
        { loopId: "f2", iteration: 1 }
      ]
    })).toBe("3:f1#1>f2");
    expect(controlFlowActivationKey(3, "f2", {
      loopStack: [
        { loopId: "f1", iteration: 2 },
        { loopId: "f2", iteration: 3 }
      ]
    })).toBe("3:f1#2>f2");
  });
});
```

Run:

```bash
npx vitest run tests/core/control-flow-scope.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement activation-key helpers**

Create `src/core/control-flow-scope.ts`:

```ts
import type {
  ExecutionContextRef,
  LoopIterationEvidence
} from "../shared/control-flow-types";

export function controlFlowActivationKey(
  frameId: number,
  loopId: string,
  context: ExecutionContextRef
): string {
  let ownIndex = -1;
  for (let index = context.loopStack.length - 1; index >= 0; index -= 1) {
    if (context.loopStack[index]!.loopId === loopId) {
      ownIndex = index;
      break;
    }
  }
  const parentStack = ownIndex >= 0
    ? context.loopStack.slice(0, ownIndex)
    : context.loopStack;
  const parent = parentStack.length === 0
    ? "root"
    : parentStack.map((item) => `${item.loopId}#${item.iteration}`).join("/");
  return `${frameId}:${parent}>${loopId}`;
}

export function iterationActivationKey(
  iteration: LoopIterationEvidence
): string {
  return controlFlowActivationKey(
    iteration.frameId,
    iteration.loopId,
    iteration.context
  );
}
```

- [ ] **Step 5: Extend `ControlFlowInterpretation` with activation-scoped history**

Add:

```ts
iterationsByActivation: Map<string, LoopIterationEvidence[]>;
```

Build the map from final `iterations` using `iterationActivationKey()` and sort each history by `anchorStepStart`.

Add a regression where the same static inner `f2` runs under outer `f1#1` and `f1#2`; assert keys `1:f1#1>f2` and `1:f1#2>f2` hold separate histories.

Run:

```bash
npx vitest run \
  tests/core/control-flow-scope.test.ts \
  tests/core/control-flow-interpreter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 0**

```bash
git add \
  src/worker/python/control_flow_instrumenter.py \
  tests/fixtures/python/test_control_flow_instrumenter.py \
  src/core/control-flow-scope.ts \
  tests/core/control-flow-scope.test.ts \
  src/core/control-flow-interpreter.ts \
  tests/core/control-flow-interpreter.test.ts
git commit -m "fix: prepare control flow evidence for execution story UI"
```

---

### Task 1: Build the Pure Execution Story Projection Model

**Files:**
- Create: `src/core/execution-story.ts`
- Create: `tests/core/execution-story.test.ts`
- Modify: `src/shared/decision-types.ts`
- Modify: `src/core/decision-interpreter.ts`
- Modify: `tests/core/decision-e2e.test.ts`

**Interfaces:**
- Adds `context: ExecutionContextRef` to interpreted `DecisionStepEvidence`; it comes from existing `DecisionBatch.context`, so no worker protocol change.
- Produces `ExecutionStoryItem`, `LoopActivationView`, `ControlFlowUiModel`.
- Produces `buildControlFlowUiModel(input): ControlFlowUiModel`.

- [ ] **Step 1: Carry runtime context into interpreted Decision evidence**

Extend `DecisionStepEvidence`:

```ts
context: ExecutionContextRef;
```

In `buildDecisionEvidence()` set:

```ts
context: batch.context ?? { loopStack: [] },
```

Update direct test fixtures constructing `DecisionStepEvidence`.

- [ ] **Step 2: Add failing projection tests**

Create `tests/core/execution-story.test.ts`.

Use an inner loop whose raw worker iterations are `3` and `4` under one activation. Assert:

```ts
expect(model.currentActivation?.activationKey).toBe("1:f1#2>f2");
expect(model.iterationHistory.map((item) => item.ordinal)).toEqual([1, 2]);
expect(model.iterationHistory.map((item) => item.iteration.iteration)).toEqual([3, 4]);
expect(model.currentIteration?.ordinal).toBe(2);
```

For an iteration containing a false decision then committed break, assert story items preserve factual order and include separate `transfer observed` and `transfer committed` rows.

- [ ] **Step 3: Define presentation types**

In `src/core/execution-story.ts` define:

```ts
export interface LoopActivationIterationView {
  ordinal: number;
  iteration: LoopIterationEvidence;
}

export interface LoopActivationView {
  activationKey: string;
  frameId: number;
  loopId: string;
  loopKind: LoopKind;
  line: number;
  parentContext: ExecutionContextRef;
  iterations: LoopActivationIterationView[];
}

export type ExecutionStoryItem =
  | { kind: "iteration_start"; anchorStep: number; ordinal: number; loopId: string; bindings: ControlFlowBindingSnapshot[] }
  | { kind: "decision"; anchorStep: number; siteId: string; source: string; status: "true" | "false" | "partial"; shortCircuited: boolean }
  | { kind: "transfer"; anchorStep: number; actionId: string; transferId: string; transferKind: TransferKind; phase: "observed" | "committed" | "superseded" | "interrupted"; source: string; supersededByActionId?: string }
  | { kind: "iteration_outcome"; anchorStep: number; status: IterationStatus }
  | { kind: "loop_exit"; anchorStep: number; loopId: string; reason: LoopExitReason }
  | { kind: "frame_exit"; anchorStep: number; actionId: string };

export interface ControlFlowUiModel {
  currentContext?: ExecutionContextRef;
  currentActivation?: LoopActivationView;
  currentIteration?: LoopActivationIterationView;
  currentActions: ControlActionEvidence[];
  currentLoopExit?: LoopExitEvidence;
  iterationHistory: LoopActivationIterationView[];
  decisionChainOccurrence?: DecisionChainOccurrence;
  storyItems: ExecutionStoryItem[];
  tracingState?: ControlFlowTracingState;
}
```

- [ ] **Step 4: Implement activation/current-iteration selection**

Use `controlFlow.contextByStep.get(step)` and the deepest loop entry.

Derive `activationKey` with `controlFlowActivationKey(frameId, deepest.loopId, currentContext)` and retrieve that history from `iterationsByActivation`.

Visible ordinal is history index + 1; raw worker iteration remains untouched.

- [ ] **Step 5: Project decisions and transfers only into the matching activation**

Decision matching uses:

```ts
controlFlowActivationKey(
  decision.frameId,
  currentActivation.loopId,
  decision.context
) === currentActivation.activationKey
```

plus the current iteration anchor range.

Use the same activation rule for `ControlActionEvidence.context`.

For every action emit:
1. observation row at `anchorStepObserved`;
2. resolved row at `anchorStepResolved` if status is no longer `observed`.

A committed return also emits `frame_exit`.

Use transfer source text from `ControlFlowPlan` span + `sourceCode`; fall back to transfer kind if unavailable.

- [ ] **Step 6: Project iteration outcome and loop exit conservatively**

Emit `iteration_outcome` from the selected iteration status.

Associate a loop exit only when matching `frameId + loopId` and temporal ordering unambiguously places it after the current activation and before the next activation of the same static loop. Otherwise omit it.

For zero-iteration loops, expose a loop exit only when the current raw step equals authoritative `LoopExitEvidence.anchorStep`; never fabricate an iteration.

- [ ] **Step 7: Project Decision chain occurrence contextually**

Select a `DecisionChainOccurrence` only when:
- frame matches;
- activation key matches;
- anchor range overlaps current iteration;
- current raw step falls inside the chain.

If multiple chains exist and none contains the current step, leave it undefined.

- [ ] **Step 8: Stable ordering**

Sort by `anchorStep`, then:

```text
iteration_start
decision
transfer observed
transfer resolved
iteration_outcome
loop_exit
frame_exit
```

Never move evidence across different raw anchors.

Run:

```bash
npx vitest run \
  tests/core/execution-story.test.ts \
  tests/core/decision-e2e.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add \
  src/core/execution-story.ts \
  tests/core/execution-story.test.ts \
  src/shared/decision-types.ts \
  src/core/decision-interpreter.ts \
  tests/core/decision-e2e.test.ts
git commit -m "feat: project control flow into execution story model"
```

---

### Task 2: Render the Execution Story Panel

**Files:**
- Create: `src/sidepanel/components/ExecutionStory.ts`
- Create: `tests/sidepanel/execution-story.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Consumes `ControlFlowUiModel`.
- Consumes `onNavigateStep(step: number): void`.
- Produces DOM only; it never owns a cursor.

- [ ] **Step 1: Add failing DOM tests**

Construct a model for:

```text
FOR · line 8
Iteration #2
x = 7
decision False
break Observed
break Committed
Broke loop
Loop exited · break
```

Assert required data attributes and click an item with anchor step `14`; expect `onNavigateStep(14)`.

- [ ] **Step 2: Add neutral/tracing-state tests**

Assert:
- `Control-flow tracing truncated · control_flow_event_limit`
- `Control-flow tracing unavailable · instrumentation_failed`
- `No control-flow evidence for this step.`

Captured story/history must remain visible below a truncation banner.

- [ ] **Step 3: Implement `createExecutionStory()`**

```ts
export interface ExecutionStoryOptions {
  model: ControlFlowUiModel;
  onNavigateStep(step: number): void;
}

export function createExecutionStory(
  options: ExecutionStoryOptions
): HTMLElement;
```

Render tracing state, loop context, story items, then iteration history.

- [ ] **Step 4: Render context and bindings**

Header:

```text
FOR · line 8
Iteration #2
```

Nested ancestry remains textual. Use `formatValue()` for compact captured bindings; do not duplicate Locals.

- [ ] **Step 5: Render factual row copy**

Required mappings:

```text
completed         -> Completed normally
continued         -> Continued
broke             -> Broke loop
function_returned -> Function returned
interrupted       -> Incomplete evidence

exhausted       -> Loop exited · iterable exhausted
condition_false -> Loop exited · condition False
break           -> Loop exited · break
function_return -> Loop exited · function returned
exception       -> Loop interrupted · exception
trace_ended     -> Loop evidence ended · trace ended
```

Transfer phases render `Observed`, `Committed`, `Superseded`, or `Confirmation unavailable`.

- [ ] **Step 6: Render activation-local history**

Visible rows use loca
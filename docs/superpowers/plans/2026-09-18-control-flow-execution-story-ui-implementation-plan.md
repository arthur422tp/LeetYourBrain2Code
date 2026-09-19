# Control-Flow Execution Story UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

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

- [x] **Step 1: Add a failing instrumenter regression proving `break/continue` do not depend on observer truthiness**

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

- [x] **Step 2: Rewrite `break/continue` as side-effect-only synthetic probe + original statement**

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

- [x] **Step 3: Add failing activation-scope tests**

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

- [x] **Step 4: Implement activation-key helpers**

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

- [x] **Step 5: Extend `ControlFlowInterpretation` with activation-scoped history**

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

- [x] **Step 6: Commit Task 0**

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
- Produces `buildControlFlowUiModel(input: BuildControlFlowUiModelInput): ControlFlowUiModel`.

Define the exact input contract:

```ts
export interface BuildControlFlowUiModelInput {
  step: number;
  frameId: number;
  sourceCode: string;
  plan: ControlFlowPlan | undefined;
  controlFlow: ControlFlowInterpretation;
  decisionEvidence: DecisionEvidenceByStep;
  decisionChains: DecisionChainOccurrence[];
  tracingState?: ControlFlowTracingState;
}
```

- [x] **Step 1: Carry runtime context into interpreted Decision evidence**

Extend `DecisionStepEvidence`:

```ts
context: ExecutionContextRef;
```

In `buildDecisionEvidence()` set:

```ts
context: batch.context ?? { loopStack: [] },
```

Update direct test fixtures constructing `DecisionStepEvidence`.

- [x] **Step 2: Add failing projection tests**

Create `tests/core/execution-story.test.ts`.

Use an inner loop whose raw worker iterations are `3` and `4` under one activation. Assert:

```ts
expect(model.currentActivation?.activationKey).toBe("1:f1#2>f2");
expect(model.iterationHistory.map((item) => item.ordinal)).toEqual([1, 2]);
expect(model.iterationHistory.map((item) => item.iteration.iteration)).toEqual([3, 4]);
expect(model.currentIteration?.ordinal).toBe(2);
```

For an iteration containing a false decision then committed break, assert story items preserve factual order and include separate `transfer observed` and `transfer committed` rows.

Also add two exit-boundary tests:

```ts
expect(buildControlFlowUiModel({ ...inputAtExhaustedStep }).currentLoopExit?.reason)
  .toBe("exhausted");
expect(buildControlFlowUiModel({ ...inputAtZeroIterationExit }).currentIteration)
  .toBeUndefined();
```

The first fixture must have an empty current `contextByStep` at the exit anchor to prove the exact-exit fallback works.

- [x] **Step 3: Define presentation types**

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

- [x] **Step 4: Implement activation/current-iteration selection, including exact loop-exit steps**

First use `controlFlow.contextByStep.get(step)` and the deepest loop entry. When a deepest loop exists, derive `activationKey` with `controlFlowActivationKey(frameId, deepest.loopId, currentContext)` and retrieve that history from `iterationsByActivation`.

When the current raw step has no active loop context, check for an authoritative exact-step exit:

```ts
const exactExit = input.controlFlow.loopExits.find((exit) =>
  exit.frameId === input.frameId && exit.anchorStep === input.step
);
```

For an exact exit with prior iterations, select the most recent activation of the same `frameId + loopId` whose final iteration ends at or before `exactExit.anchorStep`, and only if no later activation of that static loop starts before the exit. This lets the exit step project the activation that just closed even though its runtime loop stack is already empty.

For an authoritative zero-iteration exit, create an exit-only `LoopActivationView` from the static loop descriptor with `iterations: []`; do not fabricate `currentIteration` or an iteration-history row.

Visible iteration ordinal is history index + 1; raw worker iteration remains untouched.

- [x] **Step 5: Project decisions and transfers only into the matching activation**

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

- [x] **Step 6: Project iteration outcome and loop exit conservatively**

Emit `iteration_outcome` from the selected iteration status when a current iteration exists.

Prefer an exact-step `LoopExitEvidence` when `exit.anchorStep === input.step`. Otherwise associate an exit with the selected activation only when matching `frameId + loopId` and temporal ordering unambiguously places it after the activation and before the next activation of the same static loop. Otherwise omit it.

For zero-iteration loops, expose only the authoritative loop-exit item on the exact exit step; never fabricate an iteration, binding, or iteration outcome.

- [x] **Step 7: Project Decision chain occurrence contextually**

Select a `DecisionChainOccurrence` only when:
- frame matches;
- activation key matches;
- anchor range overlaps current iteration;
- current raw step falls inside the chain.

If multiple chains exist and none contains the current step, leave it undefined.

- [x] **Step 8: Stable ordering**

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

- [x] **Step 9: Commit Task 1**

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

- [x] **Step 1: Add failing DOM tests**

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

- [x] **Step 2: Add neutral/tracing-state tests**

Assert:
- `Control-flow tracing truncated · control_flow_event_limit`
- `Control-flow tracing unavailable · instrumentation_failed`
- `No control-flow evidence for this step.`

Captured story/history must remain visible below a truncation banner.

- [x] **Step 3: Implement `createExecutionStory()`**

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

- [x] **Step 4: Render context and bindings**

Header:

```text
FOR · line 8
Iteration #2
```

Nested ancestry remains textual. Use `formatValue()` for compact captured bindings; do not duplicate Locals.

- [x] **Step 5: Render factual row copy**

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

- [x] **Step 6: Render activation-local history**

Visible rows use local ordinals `#1`, `#2`, ... and keep raw worker iteration in `data-raw-iteration`.

History buttons navigate to `anchorStepStart`.

- [x] **Step 7: Add focused CSS**

Add `.execution-story*` rules using current Side Panel spacing/border/button conventions. No new global color system.

Run:

```bash
npx vitest run tests/sidepanel/execution-story.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit Task 2**

```bash
git add \
  src/sidepanel/components/ExecutionStory.ts \
  tests/sidepanel/execution-story.test.ts \
  src/sidepanel/styles.css
git commit -m "feat: render control flow execution story"
```

---

### Task 3: Integrate Execution Story With the Existing Raw Trace Cursor

**Files:**
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

**Interfaces:**
- `TraceVisualizer` remains the sole raw cursor owner.
- Story navigation is `anchorStep -> traceIndex.stepToIndex -> navigateDirect(index)`.

- [x] **Step 1: Add a failing Side Panel integration fixture**

Create a `TraceSession` fixture with `controlFlowPlan`, `controlFlowBatches`, and `controlFlowTracing`.

Assert the panel exists and shows `Iteration #1`.

Expected before implementation: FAIL because `TraceVisualizer` does not yet pass Control-Flow evidence into `interpretTrace()`.

- [x] **Step 2: Pass Control-Flow evidence into `interpretTrace()`**

Use:

```ts
const interpretation = interpretTrace(
  session.events,
  session.subscriptRelations ?? [],
  session.expressionPlan,
  session.expressionBatches ?? [],
  session.conditionPlan,
  session.decisionBatches ?? [],
  session.controlFlowPlan,
  session.controlFlowBatches ?? [],
  {
    status: session.status,
    terminationReason: session.terminationReason
  }
);
```

- [x] **Step 3: Create the panel conditionally**

Render it when Control-Flow plan/batches exist or tracing is non-complete.

Insert order:

```text
Code
Visual State
Execution Story
Decision Evidence
Expression Evidence
...
```

- [x] **Step 4: Rebuild only the body on `setStep()`**

Call `buildControlFlowUiModel()` for the current raw event and render `createExecutionStory()`.

Do not replace the outer `<details>` panel so collapsed/open state survives navigation.

- [x] **Step 5: Add cursor-navigation regression**

Click a story/history item and assert root `data-step-index` changes. Also verify Previous/Next/Play still use the same cursor.

- [x] **Step 6: Keep the panel absent for sessions with no Control-Flow evidence**

Existing fixtures must not gain an empty panel.

Run:

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit Task 3**

```bash
git add \
  src/sidepanel/components/TraceVisualizer.ts \
  tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: integrate execution story with trace navigation"
```

---

### Task 4: Make Decision Evidence Occurrence-Contextual in the UI

**Files:**
- Modify: `src/sidepanel/components/DecisionEvidence.ts`
- Modify: `tests/sidepanel/decision-evidence.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

**Interfaces:**
- `DecisionEvidenceOptions.chain` becomes `DecisionChainOccurrence | undefined`.

- [x] **Step 1: Change the Decision component input type**

Replace `DecisionChainEvidence` with `DecisionChainOccurrence`.

- [x] **Step 2: Render occurrence metadata**

Set:

```text
data-chain-id
data-chain-occurrence-id
data-frame-id
data-anchor-step-start
data-anchor-step-end
```

Use title `Branch chain · steps 12–14` instead of a static ID-centric label.

- [x] **Step 3: Add two-occurrence DOM regression**

Create two occurrences with the same static chain but different contexts/selected branches and assert no selection leaks.

- [x] **Step 4: Select exact current-step chain first, contextual chain second**

In `TraceVisualizer`:
1. exact current decision anchor lookup wins;
2. otherwise use `controlFlowUiModel.decisionChainOccurrence`.

- [x] **Step 5: Run and commit**

```bash
npx vitest run \
  tests/sidepanel/decision-evidence.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
```

Commit:

```bash
git add \
  src/sidepanel/components/DecisionEvidence.ts \
  tests/sidepanel/decision-evidence.test.ts \
  src/sidepanel/components/TraceVisualizer.ts \
  tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: render decision chains by runtime occurrence"
```

---

### Task 5: Add One Factual Source Badge

**Files:**
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- One primary badge only.
- Priority: committed transfer > observed transfer > iteration boundary > Decision badge.

- [x] **Step 1: Add failing priority tests**

Assert:
- committed break -> `break committed`
- observed continue -> `continue observed`
- iteration start -> `iteration #2`
- otherwise decision -> `condition False`

- [x] **Step 2: Generalize the existing code badge**

Use one element with:

```text
data-code-evidence-badge="true"
```

rather than independent Decision and Control-Flow badges.

- [x] **Step 3: Implement factual priority selection**

Only current-step evidence may produce a Control-Flow badge; do not infer from source text.

- [x] **Step 4: Run and commit**

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts
```

Commit:

```bash
git add \
  src/sidepanel/components/TraceVisualizer.ts \
  tests/sidepanel/trace-visualizer.test.ts \
  src/sidepanel/styles.css
git commit -m "feat: show factual control flow source badges"
```

---

### Task 6: Add Loop Activations to Trace Outline Without Replacing Behavioral Folding

**Files:**
- Modify: `src/core/execution-story.ts`
- Modify: `tests/core/execution-story.test.ts`
- Modify: `src/sidepanel/components/TraceOutline.ts`
- Modify: `tests/sidepanel/trace-outline.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Produces `ControlFlowOutlineGroup[]`.
- Existing `TraceFoldModel` and repeated-transition behavior remain unchanged.

- [x] **Step 1: Add outline projection types**

Add:

```ts
export interface ControlFlowOutlineIteration {
  ordinal: number;
  rawIteration: number;
  anchorStepStart: number;
  anchorStepEnd: number;
  status: IterationStatus;
}

export interface ControlFlowOutlineGroup {
  activationKey: string;
  frameId: number;
  loopId: string;
  loopKind: LoopKind;
  line: number;
  iterations: ControlFlowOutlineIteration[];
}
```

Implement `buildControlFlowOutlineGroups(plan, controlFlow)` from `iterationsByActivation`.

- [x] **Step 2: Test repeated inner activations stay separate**

Two outer iterations must produce two separate inner `f2` groups, with local ordinals restarting at 1.

- [x] **Step 3: Extend `TraceOutlineOptions`**

Add optional Control-Flow groups already converted to raw indexes:

```ts
controlFlowGroups?: Array<{
  activationKey: string;
  title: string;
  iterations: Array<{
    ordinal: number;
    rawIteration: number;
    startIndex: number;
    endIndex: number;
    status: IterationStatus;
  }>;
}>;
```

Render a collapsible `Loop iterations` section above existing fold segments.

- [x] **Step 4: Preserve behavioral folding unchanged**

Do not alter repeated-transition fold semantics, expansion state, or raw-range navigation.

- [x] **Step 5: Convert anchor steps to indexes in `TraceVisualizer`**

Use `traceIndex.stepToIndex`. If an anchor cannot resolve, omit that navigable row instead of inventing an index.

- [x] **Step 6: Add DOM/navigation regressions**

Assert:
- repeated inner activations are separate;
- local iteration `#2` navigates correctly;
- existing motif fold tests still pass.

Run:

```bash
npx vitest run \
  tests/core/execution-story.test.ts \
  tests/sidepanel/trace-outline.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
```

- [x] **Step 7: Commit Task 6**

```bash
git add \
  src/core/execution-story.ts \
  tests/core/execution-story.test.ts \
  src/sidepanel/components/TraceOutline.ts \
  tests/sidepanel/trace-outline.test.ts \
  src/sidepanel/components/TraceVisualizer.ts \
  tests/sidepanel/trace-visualizer.test.ts \
  src/sidepanel/styles.css
git commit -m "feat: group trace outline by loop activation"
```

---

### Task 7: Harden Partial Evidence, Accessibility, and Product Boundaries

**Files:**
- Modify: `src/sidepanel/components/ExecutionStory.ts`
- Modify: `tests/sidepanel/execution-story.test.ts`
- Modify: `tests/sidepanel/behavioral-timeline.test.ts`
- Modify: `tests/sidepanel/failure-first-entry.test.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

**Interfaces:**
- No new runtime interfaces.
- Locks neutral copy and unchanged neighboring features.

- [x] **Step 1: Test neutral partial states**

Cover:
- `No control-flow evidence for this step.`
- `Control-flow evidence incomplete.`
- `Transfer observed; confirmation unavailable.`
- `Iteration outcome unavailable.`
- `Loop exit evidence unavailable.`

Never turn absence into a negative factual claim.

- [x] **Step 2: Test truncation preserves captured evidence**

A truncation banner must coexist with already captured story/history.

- [x] **Step 3: Lock accessibility semantics**

Every navigable row must be keyboard-accessible and have a distinct `aria-label`, e.g. `Inspect break committed · step 14`.

- [x] **Step 4: Verify Behavioral Timeline stays Control-Flow-free**

Add regression assertions only; do not change `BehavioralTimeline.ts`.

- [x] **Step 5: Verify Failure-First stays unchanged**

Use a timeout session containing both Control-Flow evidence and an existing behavioral pattern. Failure-First must still navigate to the current behavioral selection.

Do not change `failure-first-selection.ts`.

- [x] **Step 6: Verify Decision and Expression panels stay independently usable**

Their existing controls must continue to navigate the same raw cursor.

- [x] **Step 7: Run and commit**

```bash
npx vitest run \
  tests/sidepanel/execution-story.test.ts \
  tests/sidepanel/behavioral-timeline.test.ts \
  tests/sidepanel/failure-first-entry.test.ts \
  tests/sidepanel/decision-evidence.test.ts \
  tests/sidepanel/expression-evidence.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
```

Commit:

```bash
git add \
  src/sidepanel/components/ExecutionStory.ts \
  tests/sidepanel/execution-story.test.ts \
  tests/sidepanel/behavioral-timeline.test.ts \
  tests/sidepanel/failure-first-entry.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
git commit -m "test: harden execution story evidence boundaries"
```

---

### Task 8: Full End-to-End Validation and CI Gate

**Files:**
- Modify tests only if a real uncovered regression is discovered.
- No unrelated refactors.

- [x] **Step 1: Add one realistic nested-loop runtime-to-UI regression**

Use source equivalent to:

```python
class Solution:
    def classify(self, matrix):
        for row in matrix:
            for value in row:
                if value < 0:
                    continue
                if value == 0:
                    break
        return 1
```

Generate or reuse real runtime evidence, construct the Side Panel session, and assert:
- outer + inner context;
- activation-local inner history;
- Decision summary;
- committed continue/break;
- iteration outcome;
- loop exit when captured;
- committed return;
- raw-step navigation.

- [x] **Step 2: Run Python fixtures**

```bash
python3 -m unittest discover -s tests/fixtures/python -p "test_*.py"
```

Expected: PASS.

- [x] **Step 3: Run complete Vitest**

```bash
npm test
```

Expected: PASS.

- [x] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: exit code 0.

- [x] **Step 5: Run production builds**

```bash
npm run build
```

Expected: Side Panel/worker, content script, and page bridge all build.

- [x] **Step 6: Verify Definition of Done**

Confirm tests protect:

```text
Execution Story visible only with evidence/tracing state
nested activations do not merge
activation-local ordinals restart at #1
safe bindings render compactly
story ordering follows raw anchors
Decision rows summarize only
Expression Evidence stays separate
observed/committed/superseded/interrupted stay distinct
superseded transfers stay visible
bare return can show committed None/function exit
loop exit reasons stay factual
Decision chain UI is occurrence-scoped
history navigates by anchor step
Trace Outline preserves raw navigation and behavioral folding
Behavioral Timeline has no generic Control-Flow lane
one factual source badge
truncation preserves captured evidence
partial evidence stays neutral
Failure-First remains unchanged
keyboard/data semantics exist
```

- [x] **Step 7: Commit final test-only adjustment if needed**

Do not create an empty commit.

- [ ] **Step 8: Push and confirm GitHub Actions is green**

Required CI steps:

```text
Python tests
Test
Typecheck
Build
```

Do not mark this phase complete until the pushed head SHA is green.

---

## Execution Handoff

Execute Tasks 0 → 8 in order.

Task 0 folds the two post-review prerequisites into this phase without reopening the worker protocol. Task 1 creates the pure activation-scoped projection. Tasks 2–6 add the UI while preserving the current cursor and neighboring debugger surfaces. Task 7 locks epistemic/accessibility boundaries. Task 8 validates the full runtime-to-UI path.


## Execution record — 2026-09-18

Implemented inline on `codex/execution-story-ui`. Each functional increment used failing tests before implementation; the full runtime-to-UI regression was then added as an integration gate.

- Task 0 uses a stronger false-observer regression than the illustrative `return 7` example: break must yield `[]`, continue must yield `[2]`. Both failed with the original guarded probe and passed after the side-effect-only rewrite.
- Activation map regressions live in `tests/core/control-flow-scope.test.ts`; additional interpreter coverage protects frame isolation and shared resolution/begin anchors.
- Shared test inputs live in `tests/fixtures/execution-story.ts`.
- Final boundary review added explicit occurrence checks for decisions/actions/chains sharing a raw anchor, and prevents another frame's context from creating an empty activation.
- Bare-return display adds optional presentation-only `bareReturn` metadata to a committed frame-exit item. Missing source text never implies `None`; worker/wire types are unchanged.
- Final local Vitest: 654 passing across 64 files. Python fixtures: 59 passing. Typecheck and all three production builds pass. Build emits Pyodide browser-externalization warnings.
- Independent review reproduced nested and zero-iteration inner exits being attached to the still-active parent. A real Pyodide RED→GREEN regression now protects both cases; exact exit anchors select the exited activation, extending the original no-active-context-only fallback to preserve factual scope.
- GitHub Actions validation is pending the push step above.

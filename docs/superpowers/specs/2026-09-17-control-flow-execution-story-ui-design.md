# Control-Flow Execution Story UI

## Design Spec v0.1

**Runtime dependency:** `docs/superpowers/specs/2026-09-17-control-flow-evidence-foundation-design.md`

---

# 1. Goal

This document defines the user-interface projection for Control-Flow Evidence.

The runtime foundation answers factual questions such as:

```text
which loop iteration is active
which transfer statement was observed
which transfer committed or was superseded
why a loop exited
which branch-chain occurrence belongs to this iteration
```

The UI must turn those facts into a readable **execution story** without duplicating the raw trace or introducing solver-style judgment.

The primary user question is:

> What happened during this concrete runtime occurrence, in execution order?

Representative presentation:

```text
Execution Story

FOR · line 8
Iteration #4
x = 7

1. iteration started
2. x < 0 → False
3. x == target → False
4. x > limit → True
5. break observed
6. break committed
7. loop exited by break
```

---

# 2. Product Boundary

The UI may show factual runtime labels such as:

```text
Iteration #4
Completed normally
Continued
Broke loop
Function returned
Interrupted
Observed
Committed
Superseded
Not reached
Selected
Rejected
```

The UI must not show or imply:

```text
correct branch
wrong branch
bad break
early return
should continue
should have exited
root cause
fix recommendation
expected path
```

The UI is a projection of evidence supplied by the runtime/core layers. It must not infer missing transfer status from visual position, source-line order, or algorithm shape.

---

# 3. Required Evidence Contract

The UI consumes already interpreted factual evidence. It does not own runtime state machines.

Required inputs conceptually include:

```ts
interface ControlFlowUiModel {
  currentContext?: ExecutionContextRef;
  currentIteration?: LoopIterationEvidence;
  currentActions: ControlActionEvidence[];
  currentLoopExit?: LoopExitEvidence;
  iterationHistory: LoopIterationEvidence[];
  decisionChainOccurrence?: DecisionChainOccurrence;
  storyItems: ExecutionStoryItem[];
  tracingState?: ControlFlowTracingState;
}
```

`ExecutionStoryItem` is an ordered presentation projection over existing evidence, not a new authoritative runtime channel.

Conceptually:

```ts
type ExecutionStoryItem =
  | { kind: "iteration_start"; anchorStep: number; ... }
  | { kind: "decision"; anchorStep: number; ... }
  | { kind: "transfer"; anchorStep: number; ... }
  | { kind: "iteration_outcome"; anchorStep: number; ... }
  | { kind: "loop_exit"; anchorStep: number; ... }
  | { kind: "frame_exit"; anchorStep: number; ... };
```

Every navigable UI item must retain an authoritative raw `anchorStep` where available.

---

# 4. Side-Panel Information Architecture

Recommended high-level order:

```text
Code
Visual State
Execution Story
Decision Evidence
Expression Evidence
What Changed | Behavioral Signals | Locals
Call Stack
Output
Trace Outline
Behavioral Timeline
Controls
```

Responsibilities remain separated:

```text
Visual State        → what exists now
Execution Story     → what happened in this runtime occurrence
Decision Evidence   → detailed condition / branch evidence
Expression Evidence → detailed computation evidence
What Changed        → mutation detail
Behavioral Signals  → repeated/stalled behavior
```

Execution Story is an overview layer and must not replace Decision or Expression Evidence.

---

# 5. Panel Visibility

The Execution Story panel is shown when the session contains Control-Flow Evidence.

Recommended behavior:

- no Control-Flow evidence in session → do not render the panel;
- session has Control-Flow evidence but current step is outside a supported occurrence → keep panel available but visually quiet;
- tracing unavailable/truncated → show factual tracing state without clearing already captured evidence;
- preserve user open/collapsed state during raw-step navigation;
- do not force-open the panel on every transfer.

The current raw cursor remains authoritative.

---

# 6. Loop Context Header

When the current step belongs to a loop occurrence, show the active execution context at the top of Execution Story.

Single loop:

```text
FOR · line 8
Iteration #4
x = 7
```

Nested loops:

```text
FOR · line 8 · iteration #2
└─ WHILE · line 11 · iteration #5
```

The UI projects `ExecutionContextRef.loopStack` directly.

It must not calculate iteration numbers from repeated source lines.

For safe `for` target bindings, show compact captured values:

```text
i = 3
value = 17
```

Do not duplicate the full Locals table here.

---

# 7. Execution Story Ordering

Story items are displayed in factual runtime order.

Example:

```python
for x in nums:
    if x < 0:
        continue
    if x == target:
        return x
```

Possible story:

```text
1  Iteration #4 started     x = 7
2  x < 0                    False
3  x == target              True
4  return x                 Observed
5  Function exited
6  return x                 Committed
```

Ordering comes from authoritative anchors / occurrence ordering supplied by core interpretation.

The UI must not reorder evidence to produce a nicer narrative when doing so changes execution order.

---

# 8. Story Item Density

Execution Story must remain compact.

Default visible content should prioritize:

```text
iteration boundary
decision summary
explicit transfer
iteration outcome
loop/frame exit
```

Do not duplicate complete operand trees or complete expression trees inside the story.

Instead, a decision story row may show:

```text
x < target → False
```

and provide navigation/expansion to the existing Decision Evidence panel for full operands and short-circuit detail.

Likewise a return story row may show:

```text
return mid + 1 · committed
```

while Expression Evidence remains responsible for showing how `mid + 1` became its value.

---

# 9. Decision Story Rows

Decision rows are projections of actual `DecisionEvidence` / `DecisionChainOccurrence` data.

Allowed compact labels:

```text
condition → True
condition → False
branch selected
branch rejected
condition partial
```

Short-circuit may be summarized as:

```text
A and B → False · short-circuit
```

The complete condition tree remains in Decision Evidence.

Clicking a decision row navigates to the decision's authoritative raw step.

---

# 10. Per-Occurrence Branch Chain UI

The old static `Branch chain chain1` presentation must be replaced by occurrence-contextual presentation.

Example:

```text
Iteration #4

Branch chain · line 12
① if x < 0
   Rejected

② elif x == 0
   Selected

③ else
   Not reached
```

A later loop iteration receives a distinct branch-chain occurrence:

```text
Iteration #5

① if x < 0      Rejected
② elif x == 0   Rejected
③ else          Selected
```

The UI must never reuse one static selected-branch result across multiple runtime occurrences.

---

# 11. Iteration Outcomes

A terminal loop iteration renders one factual outcome:

```text
Completed normally
Continued
Broke loop
Function returned
Interrupted
```

Recommended mapping:

```text
completed         → Completed normally
continued         → Continued
broke             → Broke loop
function_returned → Function returned
interrupted       → Incomplete evidence / Interrupted
```

For incomplete evidence, prefer neutral wording:

```text
Iteration outcome: Incomplete evidence
```

rather than guessing a transfer.

---

# 12. Transfer Status UI

A control action has runtime status independent from its source statement.

Normal committed transfer may be compressed:

```text
continue · committed
break · committed
return target · committed
```

When an observed transfer is superseded, both stages must remain visible.

Example:

```python
try:
    return 1
finally:
    return 2
```

UI:

```text
return 1 · line 4
Observed
Superseded

return 2 · line 6
Observed
Committed

Function exited with 2
```

The UI must not collapse the first return away because its supersession is relevant evidence explaining the final outcome.

---

# 13. Break / Continue Presentation

Ordinary continue:

```text
continue · line 14
Committed
Iteration outcome: Continued
```

Ordinary break:

```text
break · line 21
Committed
Iteration outcome: Broke loop
Loop exit: break
```

Pending/incomplete transfer:

```text
continue · line 14
Observed
Confirmation unavailable
```

Do not label such a transfer committed solely because Python source semantics normally imply it.

---

# 14. Return Presentation

Control-Flow UI and Expression Evidence must remain complementary.

For:

```python
return mid + 1
```

Execution Story may show:

```text
return mid + 1
Observed
Committed
Function exited
```

Expression Evidence separately explains:

```text
mid + 1 → 6
```

For bare `return`, show:

```text
return
Committed
Function exited with None
```

The UI must support bare `return` as a normal v0.1 case.

---

# 15. Loop Exit Presentation

Loop exit is shown as an explicit factual boundary.

Allowed labels:

```text
Loop exited · iterable exhausted
Loop exited · condition False
Loop exited · break
Loop exited · function returned
Loop interrupted · exception
Loop evidence ended · trace ended
```

Use wording matching the runtime reason rather than generic "loop finished".

For `trace_ended`, do not imply that Python itself completed the loop.

---

# 16. `for / while ... else` Presentation

Loop `else` does not need its own specialized visual structure in v0.1.

The story should surface the factual natural-exit boundary before any `else` body effects:

```text
Iterable exhausted
else suite entered
```

or:

```text
while condition became False
else suite entered
```

For a committed break:

```text
break committed
loop exited by break
else suite not reached
```

Only show `else suite not reached` when the evidence model explicitly supports that projection; do not infer it from missing raw lines in the UI layer.

---

# 17. Iteration History

Replace condition-check-oriented loop history with iteration-oriented history.

For `for`:

```text
Iteration History
#1  x=2   Completed
#2  x=4   Continued
#3  x=7   Completed
#4  x=9   Broke loop
```

For `while`:

```text
#1  condition=True   Completed
#2  condition=True   Continued
#3  condition=True   Completed
Exit condition=False
```

Each iteration entry stores `anchorStepStart`.

Clicking an entry navigates to that authoritative raw step.

The history must be scoped by `(frameId, loopId)` so recursive calls do not merge histories.

---

# 18. Nested Loop History

For nested loops, present current ancestry first and history for the innermost active/selected loop by default.

Example:

```text
FOR line 8 · #2
└─ FOR line 10 · #3

Inner loop history
#1 Completed
#2 Continued
#3 Broke loop
```

The UI may allow selecting an outer loop context to inspect its history, but v0.1 does not require a general tree navigator.

Avoid rendering all nested histories simultaneously by default.

---

# 19. Trace Outline Integration

Trace Outline may group raw execution by factual loop occurrence:

```text
FOR line 8
├─ Iteration #1 · completed
├─ Iteration #2 · continued
├─ Iteration #3 · completed
└─ Iteration #4 · broke
```

Expanded iteration:

```text
Iteration #4
├─ Decision: x < 0 → False
├─ Decision: x == target → False
├─ Decision: x > limit → True
└─ break · committed
```

Trace Outline is a structural projection.

Raw Previous / Next / Play navigation remains authoritative and unchanged.

Folding must never delete or replace raw events.

---

# 20. Behavioral Timeline Boundary

Do **not** add a generic Control-Flow lane to Behavioral Timeline in v0.1.

Reason:

```text
every iteration
+ every decision
+ every transfer
```

would turn the behavioral timeline into a raw execution timeline and obscure its current purpose: repeated/stalled behavioral evidence.

Control Flow is structural grouping, not automatically a behavioral anomaly.

---

# 21. Source-Code Panel Badges

The active source line may show a compact factual badge derived from current evidence.

Examples:

```text
iteration #4
continue observed
continue committed
break committed
return committed
```

Only one concise primary badge should be visible at once; richer state belongs in Execution Story.

Priority recommendation when multiple facts share a step:

```text
committed transfer
> observed transfer
> iteration boundary
```

Do not add inferred CFG arrows or source-span control-flow coloring in v0.1.

---

# 22. Visual State Integration

Execution context may be summarized near Visual State, but avoid duplicating full context in multiple panels.

Recommended rule:

- Execution Story owns full loop-context header and bindings;
- Visual State continues to render the actual structures/state;
- optional subtle active-iteration indication may be exposed through existing visual model metadata;
- do not introduce algorithm-specific loop overlays.

No automatic arrows such as "pointer moved because branch was true" are included.

---

# 23. Navigation Contract

All UI navigation flows through the existing raw trace cursor.

Components receive raw step anchors:

```ts
onNavigateStep(step: number): void
```

The Side Panel resolves raw `step -> index` through the existing trace index.

No Control-Flow component owns a second cursor.

Examples of navigable elements:

```text
iteration history entry
story decision row
transfer row
branch-chain branch with anchor
loop exit boundary
```

If an evidence item has no valid raw anchor because tracing ended, render it non-navigable rather than synthesizing one.

---

# 24. Tracing-State Presentation

Control-Flow tracing state is presented separately from iteration outcome.

Examples:

```text
Control-flow tracing truncated · control_flow_event_limit
Control-flow tracing unavailable · instrumentation_failed
```

Previously captured story/history remains visible.

Do not convert tracing truncation into:

```text
loop interrupted by Python
exception
return
break
```

unless runtime evidence separately proves that outcome.

---

# 25. Failure-First Boundary

Failure-First remains unchanged in v0.1.

Execution Story may help the user navigate factual transfers near termination, but Control-Flow Evidence must not automatically become the new `Start Here` source.

No heuristic such as:

```text
last break before failure
last continue before timeout
last return before exception
```

is treated as suspicious by default.

---

# 26. Empty / Partial States

Required neutral UI states include:

```text
No control-flow evidence for this step.
Control-flow evidence incomplete.
Transfer observed; confirmation unavailable.
Iteration outcome unavailable.
Loop exit evidence unavailable.
```

Avoid replacing absence with negative claims.

For example:

```text
no committed break evidence
```

is not equivalent to:

```text
break did not occur
```

unless core evidence proves that distinction.

---

# 27. Accessibility and Readability

Semantic states must not rely on color alone.

Each state requires text and stable DOM/data semantics.

Recommended attributes:

```text
data-control-flow-kind
data-control-flow-status
data-loop-id
data-iteration
data-anchor-step
data-transfer-id
```

Buttons for history/story navigation must remain keyboard accessible.

Nested loop indentation must retain textual loop labels so hierarchy remains understandable without visual connectors.

---

# 28. UI Testing Strategy

## 28.1 Execution Story DOM tests

Verify distinct presentation for:

```text
iteration start
completed
continued
broke
function_returned
interrupted
transfer observed
transfer committed
transfer superseded
loop exhausted
condition_false exit
trace_ended
```

## 28.2 `finally` supersession tests

Render evidence equivalent to:

```text
return 1 observed → superseded
return 2 observed → committed
```

and ensure both actions remain visible.

Likewise test break/continue override pairs.

## 28.3 Per-occurrence branch-chain tests

Given three occurrences of the same static chain, assert that selecting each iteration renders its own selected branch and anchor range.

## 28.4 Iteration-history navigation tests

Clicking iteration `#n` must invoke navigation with its `anchorStepStart`, not the list index.

## 28.5 Nested loop tests

Verify ordered context display and no accidental merging of histories across loop IDs or frames.

## 28.6 Trace Outline tests

Iteration grouping must preserve raw-step navigation and coexist with existing repeated-transition folding.

## 28.7 Regression tests

Verify:

```text
Decision Evidence remains independently usable
Expression Evidence remains independently usable
Behavioral Timeline gains no control-flow lane
Failure-First selection remains unchanged
raw Previous/Next/Play remain authoritative
```

---

# 29. UI Definition of Done

Control-Flow Execution Story UI v0.1 is complete when:

1. sessions with Control-Flow Evidence expose an Execution Story panel;
2. current loop context uses factual `frameId / loopId / iteration` evidence;
3. safe `for` bindings can be displayed compactly;
4. story items preserve factual runtime order;
5. Decision rows summarize rather than duplicate the full Decision tree;
6. Expression computation remains in Expression Evidence;
7. each terminal iteration renders a factual outcome or neutral incomplete state;
8. observed, committed, superseded, and interrupted transfers remain distinguishable;
9. superseded transfers remain visible when relevant;
10. bare `return` is represented as committed `None` when the runtime proves frame exit;
11. loop exit reason is shown explicitly when available;
12. branch-chain presentation is per runtime occurrence, not per static chain;
13. iteration history is scoped by frame/loop identity and navigates by raw anchor step;
14. nested loop context is readable without a second navigation cursor;
15. Trace Outline may group by iteration while raw navigation remains authoritative;
16. Behavioral Timeline receives no generic Control-Flow lane;
17. source badges remain concise and factual;
18. tracing unavailable/truncated states do not erase captured evidence;
19. partial evidence does not become fabricated control-flow outcomes;
20. Failure-First selection remains unchanged;
21. semantic status is accessible without relying on color alone;
22. focused DOM/integration tests, full test suite, typecheck, and production build pass.

---

# 30. Resulting UX Model

The final user-facing hierarchy becomes:

```text
Function Frame
└── Loop Iteration
    ├── Execution Story        ← overview of what happened
    ├── Visual State           ← what exists now
    ├── Decision Evidence      ← why this condition/path happened
    ├── Expression Evidence    ← how this value was computed
    ├── What Changed           ← mutations
    └── Behavioral Signals     ← repeated/stalled patterns
```

The UI therefore moves from a collection of debugger panels toward a runtime-structured inspection experience while preserving the product's evidence-first boundary.

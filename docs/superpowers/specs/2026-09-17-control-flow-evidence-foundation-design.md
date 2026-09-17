# Control-Flow Evidence Foundation

## Design Spec v0.1

---

# 1. Goal

LeetYourBrain2Code already captures factual runtime state, mutation semantics, expression evidence, decision evidence, behavioral patterns, and structure-specific visualizations.

The next milestone is **Control-Flow Evidence Foundation v0.1**.

The goal is to explain how execution moves through loop iterations and explicit transfer statements without turning the debugger into a solver, correctness engine, or static control-flow analyzer.

The existing evidence stack answers:

```text
Runtime State        → what exists now
Runtime Mutation     → what changed
Expression Evidence  → how a value was computed
Decision Evidence    → how a condition evaluated and which branch Python selected
Behavioral Evidence  → what repeated or stalled over time
```

Control-Flow Evidence adds:

```text
Control-Flow Evidence → which runtime occurrence execution is in,
                        which transfer statement was observed,
                        and which transfer actually committed
```

Representative example:

```python
for x in nums:
    if x < 0:
        continue
    if x == target:
        return x
    if x > limit:
        break
```

The debugger should be able to present factual evidence such as:

```text
FOR line 8 · iteration #4
x = 7

x < 0        → False
x == target  → False
x > limit    → True

break observed
break committed
loop exited by break
```

The product must not claim that the break, continue, return, or selected branch was correct.

Core acceptance statement:

> Given a supported `for`, `while`, `break`, `continue`, or `return`, LeetYourBrain2Code can preserve Python's native iterator and unwinding behavior, attach execution to concrete runtime occurrences, distinguish observed transfer statements from transfers that actually commit, and present the resulting execution story without inferring intended behavior or correctness.

---

# 2. Product Principle and Epistemic Boundary

The project keeps its central rule:

> Visualize what the program actually did.

Control-Flow Evidence may state:

- a loop iteration began;
- loop target bindings were captured after Python bound them;
- an iteration completed normally;
- a `continue`, `break`, or `return` statement was executed;
- a previously observed transfer was superseded by a later transfer;
- a transfer was confirmed by a factual runtime boundary;
- a loop ended because its iterable was exhausted;
- a `while` loop ended because its condition became false;
- a loop ended by a confirmed `break`;
- a function frame actually exited after a return statement;
- an iteration or loop became incomplete because tracing ended.

Control-Flow Evidence must never state or imply:

- that a transfer statement was correct or incorrect;
- that a loop should have exited earlier or later;
- that a return happened too early or too late;
- that another control-flow path should have been taken;
- the user's intended control flow;
- the expected path from a known-correct solution;
- root cause or bug diagnosis;
- a recommended fix;
- an algorithm classification used to fill missing evidence.

The factual boundary is:

```text
"break statement executed"               → yes
"break transfer committed"               → yes, if confirmed
"loop exited because break committed"     → yes, if confirmed
"this break is the bug"                   → no

"return statement observed"               → yes
"frame exited after that return"           → yes, if confirmed
"you returned too early"                  → no
```

---

# 3. Architectural Choice

Control-Flow Evidence is a **separate evidence layer** from Decision Evidence.

Decision Evidence answers:

```text
Why did this condition become True or False?
Which branch did Python select?
```

Control-Flow Evidence answers:

```text
Which runtime loop/frame occurrence are we in?
Did this iteration complete, continue, break, return, or become interrupted?
Was an observed transfer superseded or committed?
```

The architecture becomes:

```text
Original Python source
        │
        ├── ExpressionPlan
        ├── ConditionPlan
        └── ControlFlowPlan
               │
        semantic-preserving rewrites
               │
        ┌──────┼───────────────┐
        ▼      ▼               ▼
 Expression  Decision     ControlFlow
  Evidence   Evidence      Evidence
        └──────┼───────────────┘
               ▼
       Runtime occurrence model
               ▼
       synchronized debugger UI
```

Core invariant:

```text
TraceEvent
!= RuntimeMutation
!= ExpressionEvidence
!= DecisionEvidence
!= ControlFlowEvidence
```

No evidence layer substitutes for another.

---

# 4. Scope

Control-Flow Evidence Foundation v0.1 includes:

1. static `ControlFlowPlan` generation from original source;
2. supported loop sites for `for` and `while`;
3. supported explicit transfers for `break`, `continue`, and `return`;
4. post-binding observation of `for` iterations without debugger-driven `iter()` / `next()` calls;
5. loop-iteration occurrence identity;
6. nested loop-stack execution context;
7. explicit distinction between observed and committed transfers;
8. supersession handling for transfers replaced by later control flow, including `finally` cases;
9. natural loop-exit evidence for `for` exhaustion and `while` condition false;
10. confirmed loop exit by `break`;
11. `for ... else` and `while ... else` support;
12. frame-exit confirmation for `return`;
13. runtime iteration outcome states;
14. per-occurrence branch-chain evidence replacing the current static-chain aggregation behavior;
15. Decision Evidence context snapshots referencing the active loop stack;
16. execution-story UI over current runtime occurrence;
17. iteration history and iteration-based Trace Outline grouping;
18. source-code factual control-flow badges;
19. independent control-flow recording limits and tracing state;
20. synthetic instrumentation that does not produce user-visible raw trace lines;
21. semantic-preservation, protocol, interpreter, DOM, integration, and representative end-to-end tests.

---

# 5. Explicit Non-Goals

v0.1 does not implement:

- correctness judgment;
- expected-path comparison;
- automatic bug diagnosis;
- control-flow fix suggestions;
- static CFG construction;
- CFG visualization;
- async iteration;
- `yield` / `yield from` generator lifecycle;
- `async with` or `with` lifecycle visualization;
- exception-handler control-flow visualization;
- `raise` causality as a first-class transfer type;
- `match / case` control-flow evidence;
- comprehension/generator-expression iteration evidence;
- algorithm-specific branch/loop semantics;
- Failure-First weighting from Control-Flow Evidence;
- a dedicated Control-Flow lane in Behavioral Timeline.

`try/finally` is not visualized as its own structure in v0.1, but instrumentation must preserve and respect Python's actual `finally` transfer resolution.

---

# 6. Static Control-Flow Model

Conceptually:

```ts
interface ControlFlowPlan {
  version: 1;
  loops: LoopSiteDescriptor[];
  transfers: TransferSiteDescriptor[];
}

interface LoopSiteDescriptor {
  loopId: string;
  kind: "for" | "while";
  span: SourceSpan;
  target?: ForTargetDescriptor;
}

interface TransferSiteDescriptor {
  transferId: string;
  kind: "break" | "continue" | "return";
  span: SourceSpan;
  targetLoopId?: string;
}
```

For `break` and `continue`, `targetLoopId` is resolved statically from lexical nesting.

Example:

```python
for x in xs:          # f1
    while ready:      # w1
        break         # target = w1
```

The debugger must not infer transfer targets from later runtime line movement.

Static IDs must be deterministic for the same source and independent of source-text equality.

---

# 7. Runtime Occurrence Identity

Every control-flow claim must belong to a concrete runtime occurrence context.

Core invariant:

> Site tells us where, occurrence tells us when, context tells us inside which frame/loop execution, and outcome tells us what actually happened.

The runtime model uses three identity levels:

```text
Frame occurrence
Loop iteration occurrence
Decision-chain occurrence
```

A loop iteration is identified by:

```ts
interface LoopOccurrenceRef {
  frameId: number;
  loopId: string;
  iteration: number;
}
```

Nested execution uses:

```ts
interface ExecutionContextRef {
  loopStack: Array<{
    loopId: string;
    iteration: number;
  }>;
}
```

Example:

```text
frame 1
outer f1 iteration 2
inner f2 iteration 5
```

A decision occurring inside that nested loop must retain this context rather than only a global condition occurrence number.

---

# 8. Loop Iteration Model

Conceptually:

```ts
interface LoopIterationEvidence {
  frameId: number;
  loopId: string;
  iteration: number;
  anchorStepStart: number;
  anchorStepEnd?: number;
  bindings: Array<{
    name: string;
    value: ValueSnapshot;
  }>;
  status:
    | "completed"
    | "continued"
    | "broke"
    | "function_returned"
    | "interrupted";
  exitActionId?: string;
}
```

`active` may exist inside the recorder as internal state but is not required as an exported terminal status.

For:

```python
for i, value in pairs:
```

an iteration may produce:

```text
frame = 4
loop = f1
iteration = 3
bindings:
  i = 2
  value = 17
status = continued
```

Bindings are captured only after Python has already assigned/destructured the target.

---

# 9. Safe `for` Binding Capture

The debugger must not drive iteration.

It must never add its own calls to:

```text
iter()
next()
```

The native `for` statement remains authoritative.

Conceptually:

```python
for x in values:
    __lc_iteration_begin(loop_id, x)
    body()
    __lc_iteration_complete(loop_id)
```

Execution order remains:

```text
Python obtains next item
Python binds loop target
Debugger observes bound target
Original loop body executes
```

v0.1 captures values only for safe targets:

```text
Name
Tuple/List destructuring composed of Names
```

Examples:

```python
for x in values:
for i, value in pairs:
for (x, (y, z)) in triples:
```

For targets such as:

```python
for obj.attr in values:
for arr[i] in values:
```

iteration occurrence may still be recorded, but the debugger must not perform extra attribute/subscript reads solely to reconstruct the target value.

---

# 10. While-Loop Responsibility Boundary

Control-Flow instrumentation does not re-instrument `while` conditions.

Decision Evidence remains responsible for:

```text
condition True / False
short-circuit detail
branch/loop condition evaluation
```

Control-Flow Evidence is responsible for:

```text
iteration actually began
iteration completed / continued / broke / returned
loop finally exited
```

Conceptually:

```python
while <existing decision-instrumented condition>:
    __lc_iteration_begin(loop_id)
    body()
    __lc_iteration_complete(loop_id)
```

This separation prevents duplicate condition evaluation logic.

---

# 11. Explicit Transfer Model

Observed transfer statements are distinct from committed transfers.

Conceptually:

```ts
interface ControlActionEvidence {
  actionId: string;
  anchorStep: number;
  frameId: number;
  transferId: string;
  kind: "break" | "continue" | "return";
  loopId?: string;
  iteration?: number;
  status:
    | "observed"
    | "committed"
    | "superseded"
    | "interrupted";
}
```

Core invariant:

> A syntactic control statement being executed is not automatically equivalent to the intended transfer being committed.

This distinction is required for Python `finally` behavior.

---

# 12. Pending-Transfer State Machine

The recorder maintains at most the relevant pending transfer state for each frame/control-flow context.

For example:

```python
for x in xs:
    try:
        break
    finally:
        continue
```

Runtime evidence should become:

```text
break observed
continue observed
break superseded
next iteration begins
continue committed
```

The debugger does not simulate `finally`; it observes actual execution order and confirms the transfer only at factual runtime boundaries.

Similarly:

```python
try:
    return 1
finally:
    return 2
```

must produce:

```text
return 1 observed
return 1 superseded
return 2 observed
frame actually returns
return 2 committed
```

---

# 13. Break Instrumentation and Confirmation

`break` may be instrumented conceptually as:

```python
if __lc_transfer_observed(transfer_id, "break", target_loop_id):
    break
```

The helper must always return built-in `True`, even when recording is unavailable or truncated.

The observation means only:

```text
break statement executed
```

It does not yet mean:

```text
loop exited by break
```

Commit confirmation occurs only when the runtime reaches a factual post-loop boundary proving that the break transfer took effect.

If a later `finally` transfer supersedes the break, the break remains `superseded`.

---

# 14. Continue Instrumentation and Confirmation

`continue` is also observed first and committed later.

A pending continue may be confirmed by:

1. the next iteration beginning for the same loop; or
2. a natural loop exit being observed after the continued iteration.

Example:

```python
for x in [1]:
    continue
```

Evidence may be:

```text
iteration #1 started
continue observed
iterable exhausted
continue committed
iteration #1 → continued
loop exit → exhausted
```

If tracing ends before a confirmation boundary, v0.1 must not fabricate committed status.

---

# 15. Return Instrumentation and Frame-Exit Confirmation

Expression Evidence remains responsible for explaining how the return value was computed.

Control-Flow Evidence wraps the already instrumented return expression only to observe the transfer:

```python
return __lc_return_observed(return_site_id, expression)
```

The helper:

```text
records the return action
returns the exact same object/value
```

No expression is re-evaluated.

A return becomes `committed` only when the authoritative tracer receives the actual frame `return` event for that frame.

This is required to distinguish:

```python
try:
    return 1
finally:
    return 2
```

from an ordinary single return.

The final frame-return value remains sourced from the existing raw trace event.

---

# 16. Normal Iteration Completion

A synthetic iteration-complete probe is appended to the normal end of a loop body:

```python
for x in xs:
    __lc_iteration_begin(...)
    original_body()
    __lc_iteration_complete(...)
```

The completion probe is reached only on ordinary fallthrough.

Therefore:

```text
normal body fallthrough → completed
continue                → not completed normally
break                   → not completed normally
return                  → not completed normally
exception               → not completed normally
```

Iteration outcome is not inferred from the last visible source line.

---

# 17. Natural Loop Exit and Loop `else`

A single marker after the loop is not enough when a loop `else` contains `return` or `raise`.

For loops with `else`, instrumentation must add a natural-exit marker at the beginning of the `else` suite.

Conceptually:

```python
for x in xs:
    ...
else:
    __lc_loop_natural_exit(loop_id)
    original_else_body()

__lc_loop_after(loop_id)
```

Meaning:

```text
for + natural exit   → exhausted
while + natural exit → condition_false
```

A committed break skips loop `else` and is confirmed by the post-loop boundary.

If `return` or exception occurs inside the loop before natural exit, the debugger must not claim exhausted or condition_false.

---

# 18. Loop Exit Evidence

Conceptually:

```ts
interface LoopExitEvidence {
  frameId: number;
  loopId: string;
  anchorStep: number;
  reason:
    | "exhausted"
    | "condition_false"
    | "break"
    | "function_return"
    | "exception"
    | "trace_ended";
}
```

Interpretation rules:

```text
for natural completion     → exhausted
while natural completion   → condition_false
confirmed break            → break
frame returns from loop    → function_return
captured user exception    → exception
trace/timeout truncation   → trace_ended
```

`trace_ended` means evidence collection ended; it does not mean Python normally exited the loop.

---

# 19. Control-Flow Context and Decision Evidence

The Control-Flow recorder owns active loop-stack state.

Conceptually:

```ts
currentExecutionContext(frameId): ExecutionContextRef
```

Example:

```ts
{
  loopStack: [
    { loopId: "f1", iteration: 2 },
    { loopId: "w3", iteration: 5 }
  ]
}
```

DecisionRecorder may snapshot this context when a decision occurrence begins.

Decision Evidence does not own or mutate loop state.

Core relationship:

```text
ControlFlow owns execution context
Decision snapshots execution context
```

This allows a condition to be associated with the exact loop iteration in which it was evaluated.

---

# 20. Branch-Chain Occurrence Migration

The existing static-chain projection is insufficient when the same `if / elif / else` executes repeatedly inside loops.

v0.1 introduces per-occurrence chain evidence.

Conceptually:

```ts
interface DecisionChainOccurrence {
  chainId: string;
  occurrenceId: string;
  frameId: number;
  context: ExecutionContextRef;
  anchorStepStart: number;
  anchorStepEnd: number;
  branches: Array<...>;
  selectedBranchIndex: number | null;
}
```

Example:

```python
for x in [-1, 0, 3]:
    if x < 0:
        ...
    elif x == 0:
        ...
    else:
        ...
```

must produce three chain occurrences:

```text
iteration #1 → if selected
iteration #2 → elif selected
iteration #3 → else selected
```

It must not collapse them into one static chain result.

Occurrence grouping must use runtime ordering plus frame/context identity, not source text.

---

# 21. Runtime Occurrence Graph

v0.1 does not build a static CFG.

Instead it builds a factual runtime occurrence graph:

```text
Frame
└── Loop occurrence
    ├── Iteration #1
    │   ├── Decision occurrence
    │   ├── Expression evidence
    │   ├── Mutations
    │   └── continue action
    │
    ├── Iteration #2
    │   ├── Decision occurrence
    │   └── normal completion
    │
    └── Iteration #3
        ├── Decision occurrence
        └── break action
             ↓
          Loop exit
```

This structure is derived from observed runtime evidence, not inferred control-flow reachability.

---

# 22. Instrumentation Order

All static plans are generated from the original source.

Rewrites are applied in this order:

```text
Original source
    ↓
Expression instrumentation
    ↓
Decision instrumentation
    ↓
Control-Flow instrumentation
    ↓
compile
```

This allows Control-Flow instrumentation to wrap already instrumented expressions without re-evaluating them.

Example:

```python
return mid + 1
```

becomes conceptually:

```python
return __lc_return_observed(
    return_site_id,
    <already-expression-instrumented mid + 1>
)
```

---

# 23. Synthetic Probe Suppression

Control-Flow instrumentation must add statement-level probes, unlike current inline Expression/Decision probes.

Those synthetic statements must not appear as user-visible raw trace lines.

Instrumentation should assign synthetic probes to reserved source lines outside the original user-source range and return a mapping such as:

```python
synthetic_line_map = {
    synthetic_line: original_source_line,
}
```

Tracer behavior for synthetic `line` events:

```text
execute helper normally
but do not append user-visible TraceEvent
do not increment visible trace step
do not feed synthetic line into behavioral analysis
```

If a frame return/exception reports a synthetic line, it should be mapped back to the associated original user-source line when possible.

Hard invariant:

```text
Control-flow instrumentation != extra user-visible source execution
```

Synthetic helpers must also remain excluded from Locals and Call Stack.

---

# 24. Fail-Open Instrumentation

All control-flow probes are optional evidence collection around ordinary Python execution.

Failures must preserve semantic neutrality.

Examples:

```text
iteration_begin recorder failure → body still executes
iteration_complete failure       → program continues
transfer_observed failure         → break/continue still executes
return_observed failure           → exact return value still returned
loop boundary recording failure   → Python loop behavior unchanged
```

In particular, helper wrappers that gate `break` or `continue` must return built-in `True` even if Control-Flow tracing is truncated or unavailable.

Instrumentation construction failure must fall back to the previous successfully instrumented AST or original source execution.

---

# 25. Independent Limits and Tracing State

Control-Flow Evidence receives independent soft limits, conceptually:

```text
maxControlFlowEvents
maxControlFlowBytes
```

When exceeded:

```text
controlFlowTracing.status = "truncated"
```

Control-Flow recording stops or degrades safely, but:

- user execution continues;
- raw tracing continues;
- Expression Evidence continues independently;
- Decision Evidence continues independently;
- Behavioral Analysis continues from raw runtime evidence.

Control-Flow budgets must never terminate the program.

---

# 26. Execution Story UX

Control-Flow Evidence is presented primarily as an **Execution Story**, not a raw event log.

Recommended Side Panel hierarchy:

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

For a current loop iteration:

```text
Execution Story

FOR · line 8
Iteration #4
x = 7

1. iteration started
2. x < 0 → False
3. x == target → True
4. return x observed
5. function exited
6. return committed
```

Execution Story is an overview layer.

Decision Evidence and Expression Evidence remain detailed evidence layers.

---

# 27. Loop Context Header

When the current step is inside loops, Execution Story shows the active runtime context.

Single loop:

```text
FOR line 8 · iteration #4
x = 7
```

Nested loops:

```text
FOR line 8 · iteration #2
└─ WHILE line 11 · iteration #5
```

The UI projects `ExecutionContextRef`; it does not infer iteration numbers from raw line repetition.

---

# 28. Iteration Outcome UI

Every terminal iteration shows one factual outcome:

```text
Completed normally
Continued
Broke loop
Function returned
Interrupted
```

When evidence is incomplete, use a neutral incomplete state rather than guessing.

Examples:

```text
Iteration #3 → Continued
Iteration #5 → Broke loop
Iteration #7 → Function returned
Iteration #8 → Incomplete evidence
```

---

# 29. Transfer Status UI

Normal committed transfers may be shown compactly:

```text
return target · committed
break · committed
continue · committed
```

When supersession occurs, the UI must expose both stages:

```text
return 1 · observed · superseded
return 2 · observed · committed
Function exited with 2
```

The UI must not hide superseded transfers when they materially explain execution.

---

# 30. Iteration History

Loop history becomes iteration-centric rather than condition-check-centric.

Example:

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
exit condition=False
```

Selecting an iteration navigates to its authoritative `anchorStepStart`.

---

# 31. Trace Outline Integration

Trace Outline may group runtime steps by loop iteration:

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
└─ break
```

Raw Previous / Next / Play navigation remains authoritative.

Behavioral Timeline does not receive a new Control-Flow lane in v0.1.

---

# 32. Source-Code Panel Enhancement

The active source line may display compact factual badges such as:

```text
iteration #4
continue observed
break committed
return committed
```

The source panel must not claim correctness or display inferred CFG arrows.

---

# 33. Failure-First Boundary

Failure-First remains independent in v0.1.

Control-Flow Evidence must not automatically change `Start Here` selection merely because a break, continue, return, or loop exit occurred near a failure.

Future cross-evidence prioritization may be designed separately.

---

# 34. Semantic-Preservation Invariants

For every supported control-flow occurrence:

```text
1. The debugger never calls iter() or next() solely for tracing.
2. Loop targets are observed only after Python has bound them.
3. Original iterable consumption count is unchanged.
4. Original expression evaluation count is unchanged.
5. break / continue / return semantics remain Python-native.
6. finally unwinding remains Python-native.
7. A transfer being observed does not imply it committed.
8. break commits only after a factual loop-exit boundary proves it.
9. continue commits only after a factual next-iteration/natural-exit boundary proves it.
10. return commits only after the real frame return event proves it.
11. A later observed transfer may supersede an earlier pending transfer.
12. Normal iteration completion is recorded only on actual body fallthrough.
13. Missing evidence never becomes a fabricated loop/transfer outcome.
14. Synthetic instrumentation does not produce user-visible raw trace steps.
15. Synthetic helpers do not appear as user locals or call-stack frames.
16. Instrumentation failure cannot replace a user exception.
17. Control-Flow limits cannot terminate ordinary execution.
18. Decision/Expression tracing failure is independent from Control-Flow tracing.
```

---

# 35. Testing Strategy

Testing priority is:

```text
semantic preservation
    >
transfer confirmation correctness
    >
occurrence/context correctness
    >
UI rendering
```

## 35.1 Iterator semantic-preservation tests

Use custom iterators with side effects:

```python
class SideEffectIterator:
    def __iter__(self):
        calls.append("iter")
        return self

    def __next__(self):
        calls.append("next")
        ...
```

Instrumented and uninstrumented execution must produce identical `iter` and `next` counts.

Also test:

- destructuring targets;
- single-consumption iterables;
- custom iterables;
- iterator exceptions from `__next__`;
- nested loops.

## 35.2 Loop-else tests

Cover:

```text
for natural exhaustion → else entered → exhausted
for break              → else skipped → break
for return/exception   → else skipped; no fabricated exhaustion

while condition false  → else entered → condition_false
while break            → else skipped → break
while return/exception → else skipped; no fabricated condition_false
```

## 35.3 Transfer confirmation tests

Cover ordinary:

```text
continue
break
return
```

and `finally` override cases:

```python
try:
    break
finally:
    continue
```

Expected:

```text
break observed → superseded
continue observed → committed
iteration → continued
loop not exited by break
```

Reverse case:

```python
try:
    continue
finally:
    break
```

Expected:

```text
continue observed → superseded
break observed → committed
iteration → broke
loop exit → break
```

Return override:

```python
def f():
    try:
        return 1
    finally:
        return 2
```

Expected:

```text
return 1 observed → superseded
return 2 observed → committed
frame return value = 2
```

## 35.4 Exception and trace termination tests

Captured user exceptions may mark active iteration/loop as exception-interrupted only when raw trace evidence confirms the exception.

Trace limit / timeout / control-flow truncation must use incomplete evidence states such as:

```text
iteration → interrupted
loop exit → trace_ended
```

They must not fabricate Python exception or normal loop-exit semantics.

## 35.5 Synthetic-line suppression tests

Verify that statement-level probes do not add visible raw source lines.

At minimum:

```text
all user-visible TraceEvent.line values map to original source lines
synthetic helper names do not appear in Locals
synthetic helper frames do not appear in Call Stack
behavioral analysis does not receive synthetic steps
```

## 35.6 Occurrence/context tests

Nested loop:

```python
for i in rows:
    for j in cols:
        if grid[i][j]:
            ...
```

A decision must be associable with:

```text
frame 1
outer f1#2
inner f2#3
```

Recursion must keep loop occurrences separated by frame ID.

## 35.7 Branch-chain regression tests

For:

```python
for x in [-1, 0, 3]:
    if x < 0:
        ...
    elif x == 0:
        ...
    else:
        ...
```

assert three `DecisionChainOccurrence` records with independent context and selected branch.

## 35.8 Representative end-to-end flows

Use a compact representative set:

```text
Two Sum / simple for      → iteration bindings + normal completion
Binary Search             → while lifecycle + per-occurrence branch chains
Sliding Window            → nested while + continue
DFS / graph traversal     → nested loops + return
Matrix traversal          → nested for + Decision context
Early return search       → function_returned iteration
Loop with break           → confirmed break exit
for...else                → exhaustion vs break
try/finally override      → superseded vs committed
```

Acceptance is faithful replay, not LeetCode Accepted status.

---

# 36. Failure Modes

Supported degradation behavior:

### Static planning failure

```text
controlFlowTracing.status = unavailable
previous instrumentation / ordinary execution preserved
```

### Runtime recorder failure

```text
control-flow evidence dropped or partial
user execution preserved
```

### Control-flow budget exhaustion

```text
controlFlowTracing.status = truncated
ordinary trace continues
Expression Evidence continues
Decision Evidence continues
```

### Trace/timeout termination

```text
captured occurrence prefix preserved
active iteration → interrupted
unconfirmed pending transfer → observed/interrupted, not committed
loop exit → trace_ended where applicable
```

### User exception

```text
raw exception remains authoritative
active loop/iteration may be associated with exception only when raw evidence confirms it
```

No failure path may rewrite Python control flow solely to make tracing easier.

---

# 37. Definition of Done

Control-Flow Evidence Foundation v0.1 is complete when all of the following hold:

1. `for` iterations are observable without debugger-driven `iter()` or `next()` calls.
2. `while` iteration lifecycle aligns with existing Decision condition evidence.
3. Every loop iteration has stable `frameId + loopId + iteration` identity.
4. Nested loops expose ordered `loopStack` execution context.
5. Safe `for` target bindings are captured only after Python binds them.
6. `break`, `continue`, and `return` distinguish observed, committed, superseded, and interrupted states where applicable.
7. A break is declared committed only after a factual runtime boundary confirms it.
8. A continue is declared committed only after a factual next-iteration/natural-exit boundary confirms it.
9. A return is declared committed only after the actual frame return event confirms it.
10. `finally` can supersede pending break/continue/return without debugger-side simulation of unwinding.
11. `for ... else` distinguishes exhaustion, break, return, exception, and incomplete tracing.
12. `while ... else` distinguishes condition_false, break, return, exception, and incomplete tracing.
13. Normal body fallthrough yields `completed` iteration status.
14. break/continue/return/exception are never mislabeled as normal completion.
15. Decision batches can snapshot Control-Flow execution context.
16. Static branch-chain aggregation is replaced by per-occurrence chain evidence.
17. Repeated execution of the same branch chain inside loops produces independent occurrences.
18. Synthetic probes do not produce user-visible raw trace steps.
19. Synthetic helpers do not pollute Locals, Call Stack, Trace Outline, or Behavioral analysis.
20. Control-Flow tracing has independent soft event/byte budgets.
21. Control-Flow truncation does not affect ordinary execution, Expression Evidence, or Decision Evidence.
22. Expression/Decision tracing failures do not prevent Control-Flow evidence collection where possible.
23. Execution Story displays active loop context, iteration history, decision/transfer sequence, and transfer status.
24. Trace Outline can group by iteration without adding a Control-Flow lane to Behavioral Timeline.
25. Failure-First behavior remains unchanged.
26. Semantic-preservation, unit, integration, DOM, end-to-end, typecheck, and production build verification all pass.

---

# 38. Resulting Product Model

After this milestone, the debugger runtime model becomes:

```text
Frame
└── Loop occurrence
    └── Iteration
        ├── Runtime State
        ├── Runtime Mutation
        ├── Expression Evidence
        ├── Decision Evidence
        └── Control-Flow Evidence
            └── committed transfer / iteration outcome
```

The resulting product is no longer merely a line-by-line animation of Python state. It becomes a factual runtime evidence model that lets users inspect how execution moved through concrete frames, loop iterations, decisions, expressions, mutations, and confirmed control transfers while preserving Python semantics and avoiding solver-style judgment.

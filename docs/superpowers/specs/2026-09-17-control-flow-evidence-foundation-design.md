# Control-Flow Evidence Foundation

## Design Spec v0.1

**UI companion:** `docs/superpowers/specs/2026-09-17-control-flow-execution-story-ui-design.md`

---

# 1. Goal

LeetYourBrain2Code already captures factual runtime state, mutation semantics, expression evidence, decision evidence, behavioral patterns, and structure-specific visualizations.

The next milestone is **Control-Flow Evidence Foundation v0.1**.

This document defines the runtime, protocol, instrumentation, occurrence model, interpretation rules, and semantic-preservation requirements for explaining how execution moves through loop iterations and explicit transfer statements.

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

The runtime foundation must be able to establish factual evidence such as:

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

Core acceptance statement:

> Given a supported `for`, `while`, `break`, `continue`, or `return`, LeetYourBrain2Code can preserve Python's native iterator and unwinding behavior, attach execution to concrete runtime occurrences, distinguish observed transfer statements from transfers that actually commit, and expose enough factual evidence for a UI to reconstruct the execution story without inferring intended behavior or correctness.

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

---

# 3. Architectural Choice

Control-Flow Evidence is a separate evidence layer from Decision Evidence.

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

Architecture:

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
4. both expression-valued `return expr` and bare `return`;
5. post-binding observation of `for` iterations without debugger-driven `iter()` / `next()` calls;
6. loop-iteration occurrence identity;
7. nested loop-stack execution context;
8. explicit distinction between observed and committed transfers;
9. supersession handling for transfers replaced by later control flow, including `finally` cases;
10. natural loop-exit evidence for `for` exhaustion and `while` condition false;
11. confirmed loop exit by `break`;
12. `for ... else` and `while ... else` support;
13. frame-exit confirmation for `return`;
14. runtime iteration outcome states;
15. per-occurrence branch-chain evidence replacing the current static-chain aggregation behavior;
16. Decision Evidence context snapshots referencing the active loop stack;
17. an interpreted occurrence model sufficient for the separate Execution Story UI spec;
18. independent control-flow recording limits and tracing state;
19. synthetic instrumentation that does not produce user-visible raw trace lines;
20. semantic-preservation, protocol, interpreter, integration, and representative end-to-end tests.

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
- `async with` or `with` lifecycle evidence;
- exception-handler control-flow visualization;
- `raise` causality as a first-class transfer type;
- `match / case` control-flow evidence;
- comprehension/generator-expression iteration evidence;
- algorithm-specific branch/loop semantics;
- Failure-First weighting from Control-Flow Evidence.

`try/finally` is not modeled as its own first-class UI/runtime structure in v0.1, but instrumentation must preserve and respect Python's actual `finally` transfer resolution.

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

Static IDs must be deterministic for the same original source and independent of source-text equality.

---

# 7. Runtime Occurrence Identity

Every control-flow claim must belong to a concrete runtime occurrence context.

Core invariant:

> Site tells us where, occurrence tells us when, context tells us inside which frame/loop execution, and outcome tells us what actually happened.

Runtime identity levels:

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

A decision inside nested loops must retain this context rather than only a global condition occurrence number.

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

For targets such as:

```python
for obj.attr in values:
for arr[i] in values:
```

iteration occurrence may still be recorded, but the debugger must not perform extra attribute/subscript reads solely to reconstruct target values.

---

# 10. While-Loop Responsibility Boundary

Control-Flow instrumentation does not re-instrument `while` conditions.

Decision Evidence remains responsible for:

```text
condition True / False
short-circuit detail
loop-condition evaluation
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

---

# 12. Pending-Transfer State Machine

The recorder maintains the relevant pending transfer state for each frame/control-flow context.

Example:

```python
for x in xs:
    try:
        break
    finally:
        continue
```

Required evidence progression:

```text
break observed
continue observed
break superseded
next iteration begins
continue committed
```

The debugger does not simulate `finally`; actual execution order determines supersession and confirmation.

Similarly:

```python
try:
    return 1
finally:
    return 2
```

must support:

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

Observation proves only that the statement executed.

Commit confirmation occurs only when a factual post-loop boundary proves that the break transfer took effect.

If a later `finally` transfer supersedes the break, the break remains `superseded`.

---

# 14. Continue Instrumentation and Confirmation

A pending continue may be confirmed by:

1. the next iteration beginning for the same loop; or
2. a natural loop exit being observed after the continued iteration.

Example:

```python
for x in [1]:
    continue
```

may produce:

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

Expression Evidence remains responsible for explaining how an expression-valued return was computed.

For:

```python
return expression
```

Control-Flow instrumentation conceptually wraps the already instrumented expression:

```python
return __lc_return_observed(return_site_id, expression)
```

The helper records the action and returns the exact same object/value.

For bare:

```python
return
```

instrumentation must preserve ordinary `None` semantics while still observing the return site. Conceptually, this may be represented as an observed return whose runtime value is `None`; implementation must not convert it into a different user-visible expression evaluation.

A return becomes `committed` only when the authoritative tracer receives the actual frame `return` event for that frame.

The final return value remains sourced from the existing raw trace event.

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

If return or exception occurs inside the loop before natural exit, the debugger must not claim exhausted or condition_false.

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

DecisionRecorder may snapshot this context when a decision occurrence begins.

Core relationship:

```text
ControlFlow owns execution context
Decision snapshots execution context
```

Decision Evidence does not own or mutate loop state.

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

must produce:

```text
iteration #1 → if selected
iteration #2 → elif selected
iteration #3 → else selected
```

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

---

# 23. Synthetic Probe Suppression

Control-Flow instrumentation adds statement-level probes. Those synthetic statements must not appear as user-visible raw trace lines.

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

If a frame return/exception reports a synthetic line, map it back to the associated original user-source line when possible.

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

Helper wrappers that gate `break` or `continue` must return built-in `True` even if Control-Flow tracing is truncated or unavailable.

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

# 26. UI Contract Boundary

The runtime foundation must expose enough interpreted evidence for the separate UI companion spec to render:

```text
current execution context
current loop iteration
iteration history scoped by frame/loop
ordered control actions
loop exit evidence
per-occurrence decision chains
raw-step anchors for navigation
controlFlowTracing state
```

The runtime/core layer does **not** own:

```text
panel placement
Execution Story rendering
disclosure/open state
DOM structure
CSS/status styling
source badges
Trace Outline presentation
```

Those requirements are defined exclusively in:

`docs/superpowers/specs/2026-09-17-control-flow-execution-story-ui-design.md`

Failure-First prioritization remains unchanged by this foundation.

---

# 27. Semantic-Preservation Invariants

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
19. Bare return preserves native None semantics and is still observable as a return transfer.
```

---

# 28. Testing Strategy

Testing priority is:

```text
semantic preservation
    >
transfer confirmation correctness
    >
occurrence/context correctness
    >
UI rendering (owned by companion UI spec)
```

## 28.1 Iterator semantic-preservation tests

Use custom iterators with side effects and require instrumented/uninstrumented execution to produce identical `iter` and `next` counts.

Also test:

- destructuring targets;
- single-consumption iterables;
- custom iterables;
- iterator exceptions from `__next__`;
- nested loops.

## 28.2 Loop-else tests

Cover:

```text
for natural exhaustion → else entered → exhausted
for break              → else skipped → break
for return/exception   → else skipped; no fabricated exhaustion

while condition false  → else entered → condition_false
while break            → else skipped → break
while return/exception → else skipped; no fabricated condition_false
```

## 28.3 Transfer confirmation tests

Cover ordinary:

```text
continue
break
return expression
bare return
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

Bare return:

```python
def f():
    return
```

Expected:

```text
return observed → committed
frame return value = None
```

## 28.4 Exception and trace termination tests

Captured user exceptions may mark active iteration/loop as exception-interrupted only when raw trace evidence confirms the exception.

Trace limit / timeout / control-flow truncation must use incomplete evidence states such as:

```text
iteration → interrupted
loop exit → trace_ended
```

They must not fabricate Python exception or normal loop-exit semantics.

## 28.5 Synthetic-line suppression tests

Verify:

```text
all user-visible TraceEvent.line values map to original source lines
synthetic helper names do not appear in Locals
synthetic helper frames do not appear in Call Stack
behavioral analysis does not receive synthetic steps
```

## 28.6 Occurrence/context tests

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

## 28.7 Branch-chain regression tests

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

## 28.8 Representative end-to-end flows

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
bare return               → committed None frame exit
```

Acceptance is faithful replay, not LeetCode Accepted status.

---

# 29. Failure Modes

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

# 30. Definition of Done

Control-Flow Evidence Foundation v0.1 is complete when all of the following hold:

1. `for` iterations are observable without debugger-driven `iter()` or `next()` calls.
2. `while` iteration lifecycle aligns with existing Decision condition evidence.
3. Every loop iteration has stable `frameId + loopId + iteration` identity.
4. Nested loops expose ordered `loopStack` execution context.
5. Safe `for` target bindings are captured only after Python binds them.
6. `break`, `continue`, and `return` distinguish observed, committed, superseded, and interrupted states where applicable.
7. Expression-valued returns preserve existing Expression Evidence behavior.
8. Bare `return` preserves native `None` semantics and produces return Control-Flow Evidence.
9. A break is declared committed only after a factual runtime boundary confirms it.
10. A continue is declared committed only after a factual next-iteration/natural-exit boundary confirms it.
11. A return is declared committed only after the actual frame return event confirms it.
12. `finally` can supersede pending break/continue/return without debugger-side simulation of unwinding.
13. `for ... else` distinguishes exhaustion, break, return, exception, and incomplete tracing.
14. `while ... else` distinguishes condition_false, break, return, exception, and incomplete tracing.
15. Normal body fallthrough yields `completed` iteration status.
16. break/continue/return/exception are never mislabeled as normal completion.
17. Decision batches can snapshot Control-Flow execution context.
18. Static branch-chain aggregation is replaced by per-occurrence chain evidence.
19. Repeated execution of the same branch chain inside loops produces independent occurrences.
20. Synthetic probes do not produce user-visible raw trace steps.
21. Synthetic helpers do not pollute Locals, Call Stack, or Behavioral analysis.
22. Control-Flow tracing has independent soft event/byte budgets.
23. Control-Flow truncation does not affect ordinary execution, Expression Evidence, or Decision Evidence.
24. Expression/Decision tracing failures do not prevent Control-Flow evidence collection where possible.
25. The interpreted core model exposes all inputs required by the companion Execution Story UI spec.
26. Failure-First behavior remains unchanged.
27. Semantic-preservation, unit, integration, end-to-end, typecheck, and production build verification all pass.

---

# 31. Resulting Runtime Model

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

The runtime foundation supplies factual occurrence and transfer evidence. The separate UI companion defines how that evidence becomes an Execution Story, iteration history, per-occurrence branch-chain presentation, navigation, source badges, and Trace Outline grouping.

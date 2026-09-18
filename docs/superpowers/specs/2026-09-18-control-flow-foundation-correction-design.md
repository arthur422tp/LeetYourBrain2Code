# Control-Flow Foundation Correction

## Design Spec v0.1

**Parent foundation:** `docs/superpowers/specs/2026-09-17-control-flow-evidence-foundation-design.md`

---

# 1. Purpose

The Control-Flow Evidence Foundation is structurally complete, but post-implementation review found three correctness gaps that must be resolved before Execution Story UI work begins:

1. transfer state is currently modeled as one pending transfer per frame;
2. terminal fallback can re-finalize historical loop occurrences that already exited;
3. Python semantic regression fixtures exist but are not currently a CI gate.

This correction does not add new product capabilities. It hardens the existing evidence contract so UI labels such as `committed`, `superseded`, `interrupted`, `exhausted`, and `trace_ended` remain factual under Python `finally`, nested loops, exceptions, and partial traces.

Core acceptance statement:

> Control-flow actions are resolved only by compatible factual runtime boundaries, historical completed occurrences remain immutable, and all low-level semantic regressions are enforced in CI.

---

# 2. Scope

This correction includes:

- replacing per-frame single pending transfer state with an unresolved transfer ledger;
- boundary-driven transfer resolution for `break`, `continue`, and `return`;
- correct preservation of outer unresolved transfers while inner-loop transfers execute inside `finally`;
- correct supersession of transfers targeting the same or enclosing runtime scope;
- normal frame-return resolution using the existing validated return-opcode boundary;
- exception/trace termination interruption of unresolved transfers;
- separation of historical iteration storage from active runtime occurrences;
- explicit active-loop state for terminal fallback;
- terminal finalization of only currently active occurrences;
- regression tests for nested `finally` transfer cases;
- adding Python fixture tests to CI;
- Pyodide E2E coverage for cross-layer Python semantics.

---

# 3. Non-Goals

This correction does not add:

- first-class `try/finally` visualization;
- first-class `raise` control-flow actions;
- CFG reconstruction;
- exception-handler visualization;
- new UI surfaces;
- new Failure-First heuristics;
- changes to the product epistemic boundary;
- algorithm-specific reasoning.

The correction must use observed runtime boundaries rather than simulate Python unwinding.

---

# 4. Root Cause A — Per-Frame Single Pending Transfer

The current recorder effectively assumes:

```text
one frame = one pending transfer
```

This is not valid under Python `finally` semantics.

Example:

```python
def f():
    try:
        return 1
    finally:
        for _ in [1]:
            break
```

Python returns `1`.

The runtime sequence is:

```text
outer return observed
finally begins
inner break observed
inner break commits
inner loop exits
outer return resumes
frame returns
outer return commits
```

A later transfer observation therefore does not prove that an earlier unresolved transfer was superseded.

Hard invariant:

> A transfer observation creates unresolved evidence. Supersession is established only by a later factual runtime boundary.

---

# 5. Unresolved Transfer Ledger

Replace single pending state with a per-frame ordered ledger.

Conceptually:

```ts
interface UnresolvedTransfer {
  actionId: string;
  transferId: string;
  kind: "break" | "continue" | "return";
  frameId: number;
  observedOrder: number;
  observedContext: ExecutionContextRef;
  targetLoopId?: string;
}
```

Recorder state is conceptually:

```python
self.unresolved_transfers = {
    frame_id: [
        transfer_a1,
        transfer_a2,
        ...
    ]
}
```

New observations append to the ledger.

They do not immediately mutate older actions to `superseded`.

Resolved actions are removed from the unresolved ledger after emitting their terminal transfer status.

---

# 6. Boundary-Driven Resolution

Resolution must occur only when runtime reaches a factual boundary compatible with the transfer.

The recorder must use dedicated resolution paths conceptually equivalent to:

```text
resolve_loop_break(...)
resolve_loop_continue(...)
resolve_frame_return(...)
interrupt_frame(...)
```

A generic "commit current pending transfer" helper is insufficient because different boundaries prove different control-flow outcomes.

Compatibility is deterministic:

```text
loop_after(fN)
-> only unresolved break actions with targetLoopId == fN can win

next iteration_begin(fN)
-> only unresolved continue actions with targetLoopId == fN can win

natural loop exit for fN
-> may confirm an unresolved continue targeting fN
-> cannot commit a break targeting fN

normal frame RETURN_*
-> only unresolved return actions in that frame can win

exception / trace termination
-> no action wins; unresolved actions are interrupted
```

When several unresolved actions are compatible with the same boundary, the latest observed compatible action wins.

After a winner is established, an older unresolved action is superseded only when at least one of these is true:

```text
1. it targets the same loop boundary but represents an incompatible transfer kind; or
2. the committed loop transfer exits/continues a loop that was already present in the older action's observedContext; or
3. a normal frame return proves a non-return unresolved action did not take effect.
```

A transfer targeting a loop created only after an older action was observed does not supersede that older action merely because it resolves first.

---

# 7. Break Resolution

A `break` may commit only when the target loop's post-loop boundary is reached.

For a loop boundary targeting `f1`:

```text
loop_after(f1)
```

the resolver finds the latest unresolved compatible `break` whose:

```text
targetLoopId == f1
```

That action commits.

Older unresolved transfers are superseded only if the committed break proves that their intended control transfer cannot still occur.

Example:

```python
for x in xs:              # f1
    try:
        return 1          # a1
    finally:
        break             # a2 -> f1
```

The return was observed while `f1` was in its execution context.

When `break f1` commits, execution has left the scope from which the return was pending.

Required evidence:

```text
a2 break  -> committed
a1 return -> superseded by a2
```

---

# 8. Inner Break Must Not Destroy Outer Return

Example:

```python
def f():
    try:
        return 1          # a1
    finally:
        for _ in [1]:     # f2 created after a1
            break         # a2 -> f2
```

The inner loop is not part of `a1.observedContext`.

When `f2` exits:

```text
a2 break -> committed
a1 return -> remains unresolved
```

Later normal frame return:

```text
a1 return -> committed
```

Hard invariant:

> Resolving an inner-loop transfer must not automatically supersede an older transfer whose original runtime context does not depend on that inner loop.

---

# 9. Continue Resolution

A `continue` commits only when a boundary proves execution continued the target loop.

Supported confirmation boundaries remain:

1. next `iteration_begin(targetLoopId)`;
2. compatible natural loop exit after the continued iteration.

Example:

```python
for x in xs:              # f1
    try:
        return x          # a1
    finally:
        continue          # a2 -> f1
```

When the next `f1` iteration begins:

```text
a2 continue -> committed
a1 return   -> superseded
```

But an inner-loop continue created only inside `finally` must not supersede an outer return.

---

# 10. Competing Transfers for the Same Loop

When several unresolved transfers target the same loop, the observed boundary determines which action is compatible.

Example:

```python
for x in xs:
    try:
        break             # a1 -> f1
    finally:
        continue          # a2 -> f1
```

If the next iteration begins:

```text
a2 continue -> committed
a1 break    -> superseded
```

Reverse case:

```python
for x in xs:
    try:
        continue          # a1 -> f1
    finally:
        break             # a2 -> f1
```

If `loop_after(f1)` is reached:

```text
a2 break    -> committed
a1 continue -> superseded
```

Resolution rule:

> The winning action is the latest unresolved action compatible with the boundary that actually occurred, not simply the latest observed action.

---

# 11. Frame Return Resolution

Normal frame return remains authoritative only when the tracer confirms a real Python return opcode boundary such as:

```text
RETURN_VALUE
RETURN_CONST
```

At a confirmed normal frame return:

1. find unresolved return actions in that frame;
2. commit the latest unresolved return compatible with the frame exit;
3. supersede unresolved transfers whose intended outcome is incompatible with the observed frame return;
4. emit active loop `function_return` exits as already defined by the foundation;
5. clear resolved ledger state for the frame.

Example:

```python
for x in xs:
    try:
        break             # a1
    finally:
        return 2          # a2
```

Required evidence:

```text
a2 return -> committed
a1 break  -> superseded
```

---

# 12. Exception and Trace Termination

Exception unwind is not modeled as a first-class transfer winner.

Example:

```python
try:
    return 1
finally:
    raise ValueError()
```

Required evidence:

```text
return -> interrupted
terminal status -> exception
```

Not:

```text
return -> superseded by exception
```

because `raise` is outside v0.1's first-class transfer model.

For timeout / trace limit / internal termination, unresolved transfers become `interrupted`, never fabricated as committed or superseded.

---

# 13. Root Cause B — Historical Occurrences Used as Active State

The interpreter currently retains loop occurrences in one collection that is later used both as historical output and as terminal fallback input.

This permits already completed loops to receive a second fabricated terminal exit.

Example:

```python
for x in [1]:
    pass

raise ValueError()
```

Correct evidence:

```text
iteration #1 -> completed
loop f1 -> exhausted
later function exception
```

Invalid evidence:

```text
loop f1 -> exhausted
loop f1 -> exception
```

Hard invariant:

> Historical completed occurrences are immutable. Terminal fallback may finalize only occurrences still active when evidence collection terminates.

---

# 14. Historical and Active Iteration State

The interpreter must keep separate structures.

Conceptually:

```ts
const iterationsById = new Map<OccurrenceKey, MutableIteration>();
const activeIterations = new Map<OccurrenceKey, MutableIteration>();
```

Responsibilities:

```text
iterationsById
-> every observed iteration
-> output/history source

activeIterations
-> only unresolved runtime iterations
-> used for control-flow resolution and terminal fallback
```

On `iteration_begin`:

```text
create iteration
add to iterationsById
add to activeIterations
```

On terminal iteration outcome:

```text
completed
continued
broke
function_returned
interrupted
```

remove that occurrence from `activeIterations`, while preserving it in history.

---

# 15. Explicit Active Loop State

Iterations alone are insufficient because zero-iteration loops can still exit naturally.

Maintain explicit active loop state.

Conceptually:

```ts
interface ActiveLoopRuntime {
  frameId: number;
  loopId: string;
  loopKind: LoopKind;
  lastContext: ExecutionContextRef;
  lastAnchorStep: number;
}
```

with:

```ts
const activeLoops = new Map<FrameLoopKey, ActiveLoopRuntime>();
```

Only runtime evidence that proves a loop occurrence is currently active may create or refresh active-loop state. In v0.1 this is primarily `iteration_begin`; an already observed `loop_exit` closes/removes state rather than opening it.

The interpreter must not synthesize an active loop merely because a static `ControlFlowPlan` contains that loop. Therefore a timeout while evaluating a loop iterable/condition before any control-flow runtime event remains outside the evidence model rather than producing a guessed loop exit.

An authoritative `loop_exit` removes the loop from `activeLoops`.

---

# 16. Loop Exit Is an Authoritative Close Boundary

Any observed loop exit reason:

```text
exhausted
condition_false
break
function_return
exception
trace_ended
```

permanently closes that runtime loop occurrence for fallback purposes.

After a loop exit:

```text
activeLoops.delete(frameId + loopId)
```

and any still-open iteration belonging to that loop is finalized consistently with that exit reason.

Terminal fallback must never recreate another exit for the same already-closed runtime occurrence.

---

# 17. Terminal Fallback

Fallback executes only for terminal statuses where runtime evidence may end abruptly:

```text
timeout
trace_limit
internal_error
exception
```

It must iterate only over:

```text
activeIterations
activeLoops
unresolvedTransfers
```

not over complete historical collections.

For timeout / trace limits:

```text
active iteration -> interrupted
active loop      -> trace_ended
unresolved action -> interrupted
```

For terminal exception:

```text
active iteration -> interrupted
active loop      -> exception
unresolved action -> interrupted
```

---

# 18. Nested Finalization Order

When several nested loops remain active, finalization should process inner occurrences before outer occurrences.

Example:

```python
for row in rows:          # f1
    for value in row:     # f2
        explode()
```

Required terminal evidence order:

```text
f2 current iteration -> interrupted
f2 loop -> exception
f1 current iteration -> interrupted
f1 loop -> exception
```

Previously completed iterations remain unchanged.

---

# 19. Control-Flow Tracing Truncation Is Not Program Termination

```text
controlFlowTracing.status = truncated
```

means only that control-flow evidence stopped recording.

It does not prove Python execution ended.

Therefore tracing-budget truncation alone must not trigger:

```text
trace_ended
exception
interrupted terminal loop exits
```

Terminal fallback remains driven by the session's actual terminal status.

---

# 20. Duplicate Exit Protection

Serialized event de-duplication such as `loopExitKeys` may remain as defense in depth.

However, logical correctness must come from active state:

```text
active state prevents repeated logical finalization
+
dedupe protects against repeated serialized/streamed events
```

A dedupe key must not be the primary mechanism that hides stale active-state bugs.

---

# 21. Regression Test Architecture

Testing is split into three levels.

## 21.1 Python low-level tests

Python fixtures validate:

- AST lexical loop ownership;
- iterator semantics;
- unresolved transfer ledger state transitions;
- compatible-boundary resolution;
- return-opcode confirmation;
- exception unwind behavior.

Required ledger regressions include:

```text
return -> finally inner break -> return survives
return -> finally inner continue -> return survives
return -> finally outer break -> return superseded
return -> finally outer continue -> return superseded
break -> finally continue same loop
continue -> finally break same loop
break -> finally return
outer break -> finally inner break -> outer break survives
```

## 21.2 Core TypeScript interpreter tests

Direct batch/interpreter tests must cover:

```text
completed loop + later exception
-> only historical exhausted exit

active loop + exception
-> interrupted + exception exit

completed first loop + active second loop + timeout
-> first loop unchanged
-> second loop interrupted / trace_ended
```

## 21.3 Pyodide E2E

Cross-layer E2E must cover at least:

```text
return + finally inner break
return + finally outer break
break + finally continue
continue + finally break
completed loop followed by exception
completed first loop followed by timeout in second loop
```

E2E assertions must validate both user-visible Python result and control-flow evidence.

---

# 22. Mandatory Return/Unwind Regressions

The previous amendment tests remain mandatory:

```python
def f():
    return None
```

Expected normal return commit.

```python
def f():
    try:
        return None
    finally:
        raise ValueError("boom")
```

Expected interrupted return, never committed.

```python
def f():
    try:
        return None
    finally:
        try:
            1 / 0
        except ZeroDivisionError:
            pass
```

Expected original return survives and commits.

Add the newly discovered blocker:

```python
def f():
    try:
        return 1
    finally:
        for _ in [1]:
            break
```

Expected:

```text
inner break committed
return committed
return not superseded
final return value = 1
```

---

# 23. CI Gate

The Python fixture suite becomes an explicit CI step.

Recommended workflow order:

```yaml
- name: Python tests
  run: python3 -m unittest discover -s tests/fixtures/python -p "test_*.py"

- name: Test
  run: npm test

- name: Typecheck
  run: npm run typecheck

- name: Build
  run: npm run build
```

Do not hide the Python suite inside `npm test`; separate steps make failures attributable.

A local aggregate script may be added later, but it is not required by this correction.

---

# 24. Failure Behavior

If ledger resolution encounters malformed/inconsistent optional evidence:

- user execution remains unaffected;
- unresolved actions may remain `interrupted` rather than being guessed;
- no fallback may fabricate committed/superseded outcomes;
- historical completed evidence remains untouched.

If Control-Flow evidence truncates:

- existing recorded evidence remains valid;
- unresolved interpretation may become incomplete;
- no program-level terminal reason is inferred solely from tracing truncation.

---

# 25. Definition of Done

This correction is complete only when:

1. per-frame single pending-transfer state is removed;
2. multiple unresolved transfers can coexist per frame;
3. observing a later transfer never automatically supersedes an older one;
4. loop boundaries resolve only compatible target-loop transfers;
5. inner-loop break/continue cannot destroy an unrelated outer pending transfer;
6. same-loop competing transfers resolve according to the boundary that actually occurs;
7. confirmed normal frame return resolves the winning return action;
8. incompatible older transfers are superseded only after a factual winning boundary;
9. exception/trace termination interrupts unresolved transfers without inventing a winner;
10. historical iteration storage is separated from active iteration state;
11. explicit active-loop state exists for terminal finalization;
12. observed loop exits remove loops from active fallback state;
13. terminal fallback processes only active occurrences;
14. already exhausted/break-exited loops never receive a second terminal exit;
15. nested terminal finalization proceeds inner-to-outer;
16. control-flow tracing truncation alone does not imply program termination;
17. prior return/unwind regressions remain covered;
18. the new inner-loop-break/outer-return blocker has both Python and Pyodide E2E coverage;
19. Python fixture tests run as an explicit CI gate;
20. Vitest, Python tests, typecheck, production build, and representative E2E all pass;
21. no Execution Story UI implementation begins until this correction is green.

---

# 26. Result

After this correction, the foundation's control-flow semantics become:

```text
Observation
    ↓
Unresolved transfer ledger
    ↓
Actual Python execution continues
    ↓
Compatible factual runtime boundary
    ↓
Commit / supersede / interrupt
```

and occurrence finalization becomes:

```text
Historical occurrences      Active occurrences
        │                          │
        │ immutable                │ terminal fallback only
        ▼                          ▼
    UI history               interruption / exit
```

This restores the evidence-first contract required before the separate Execution Story UI consumes `committed`, `superseded`, `interrupted`, and loop-exit labels.

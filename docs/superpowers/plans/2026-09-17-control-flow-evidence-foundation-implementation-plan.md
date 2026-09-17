# Control-Flow Evidence Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a semantics-preserving runtime/control-flow evidence pipeline for `for`, `while`, `break`, `continue`, and `return`, including concrete loop-iteration identity, committed-vs-superseded transfer evidence, nested execution context, and per-occurrence decision chains.

**Architecture:** Parse every static plan from the original Python source, then apply rewrites in the existing order `Expression → Decision → Control Flow` to one final AST. Control-flow instrumentation emits an immutable event stream through a dedicated recorder and worker channel; TypeScript reconstructs iteration/action/loop-exit evidence from that stream plus authoritative raw trace termination. The runtime foundation exposes interpreted occurrence data but does not implement the Execution Story UI.

**Tech Stack:** TypeScript 5.8, Vitest 3.2, Python `ast`, `sys.settrace`, Pyodide 0.29.3, Chrome MV3 Web Worker.

**Spec:** `docs/superpowers/specs/2026-09-17-control-flow-evidence-foundation-design.md`

**UI companion (out of scope for this plan):** `docs/superpowers/specs/2026-09-17-control-flow-execution-story-ui-design.md`

## Global Constraints

- Preserve the product rule: **visualize what the program actually did**; never infer correctness, expected path, intended control flow, root cause, or fixes.
- v0.1 loop sites are exactly synchronous `for` and `while`.
- v0.1 explicit transfer sites are exactly `break`, `continue`, expression-valued `return`, and bare `return`.
- The debugger must never call `iter()` or `next()` solely for tracing.
- `for` target bindings are observed only after Python has already bound/destructured them.
- Safe binding capture is limited to `Name` and nested tuple/list destructuring composed only of `Name`; unsupported targets still get iteration evidence with no binding snapshots.
- Python remains authoritative for iterator behavior, loop dispatch, `break`, `continue`, return semantics, and `finally` unwinding.
- A syntactic transfer being observed is not equivalent to the transfer being committed.
- `break` commits only after a factual post-loop boundary confirms it.
- `continue` commits only after a next-iteration or natural-loop-exit boundary confirms it.
- `return` commits only after the authoritative raw frame `return` event confirms it.
- A later transfer observed in the same frame may supersede an earlier pending transfer.
- Normal iteration completion is recorded only on actual body fallthrough.
- Missing evidence never becomes a fabricated transfer or loop outcome.
- Synthetic statement probes must not create user-visible raw trace steps or feed Behavioral Analysis.
- Synthetic helper names/frames must not appear in user Locals or Call Stack.
- Control-Flow instrumentation is fail-open and cannot replace a user exception.
- Control-Flow evidence has independent soft limits. Use implementation defaults `maxControlFlowEvents = 20_000` and `maxControlFlowBytes = 2_000_000`, matching the current Expression/Decision evidence budget scale.
- Control-Flow truncation must not terminate user execution or stop raw tracing, Expression Evidence, or Decision Evidence.
- Static Decision chain aggregation is replaced by per-occurrence chain evidence while keeping current UI call sites source-compatible until the separate UI plan executes.
- Failure-First behavior and Behavioral Timeline lanes are unchanged in this foundation plan.
- Advance trace schema from v4 to **v5**. All new `TraceSession` fields remain optional so older decision-only traces are still structurally valid.
- Full regression gates remain `npm test`, `npm run typecheck`, and `npm run build`.

---

## File Structure

Create these focused units:

```text
src/shared/control-flow-types.ts
    Serializable static plan, runtime event stream, tracing-state, and
    interpreted evidence contracts shared across worker/core/UI boundaries.

src/worker/python/control_flow_instrumenter.py
    Original-source ControlFlowPlan plus source-span-driven AST rewrite over
    the already Expression/Decision-instrumented tree. Owns synthetic lines.

src/worker/python/control_flow_recorder.py
    Runtime loop-stack state, iteration counters, pending-transfer state
    machine, immutable event emission, soft limits, and context snapshots.

src/core/control-flow-interpreter.ts
    ControlFlowPlan + immutable runtime events + raw trace termination into
    LoopIterationEvidence, ControlActionEvidence, LoopExitEvidence, and
    execution-context-by-step projections.
```

Modify established integration seams only:

```text
src/worker/python/runner.py
src/worker/python/tracer.py
src/worker/python/decision_recorder.py
src/shared/decision-types.ts
src/shared/trace-types.ts
src/shared/execution-types.ts
src/shared/worker-protocol.ts
src/worker/pyodide-runtime.ts
src/worker/pyodide-worker.ts
src/execution/execution-controller.ts
src/execution/trace-session-collector.ts
src/core/decision-interpreter.ts
src/core/trace-interpreter.ts
```

Do **not** modify Side Panel components, CSS, Trace Outline rendering, or README user-facing feature claims in this plan. Those belong to the approved UI companion phase.

---

### Task 1: Define Trace Schema v5 and the Shared Control-Flow Protocol

**Files:**
- Create: `src/shared/control-flow-types.ts`
- Modify: `src/shared/decision-types.ts`
- Modify: `src/shared/trace-types.ts`
- Modify: `src/shared/execution-types.ts`
- Modify: `src/shared/worker-protocol.ts`
- Modify: `tests/protocol/worker-protocol.test.ts`
- Modify: `tests/execution/execution-request.test.ts`

**Interfaces:**
- Produces every serializable contract consumed by Tasks 2–7.
- Adds worker messages `control_flow_plan` and `control_flow_batch`.
- Adds optional `DecisionBatch.context` for runtime loop-stack snapshots.
- Keeps current `DecisionChainEvidence` source-compatible and adds `DecisionChainOccurrence extends DecisionChainEvidence` for Task 6.

- [ ] **Step 1: Write failing execution-limit and protocol tests**

Extend `tests/execution/execution-request.test.ts` so defaults/requests include:

```ts
maxControlFlowEvents: 20_000,
maxControlFlowBytes: 2_000_000
```

Extend `tests/protocol/worker-protocol.test.ts` with valid messages:

```ts
expect(isWorkerOutboundMessage({
  type: "control_flow_plan",
  sessionId: "s1",
  plan: {
    version: 1,
    loops: [{
      loopId: "f1",
      kind: "for",
      span: { line: 2, column: 4, endLine: 4, endColumn: 12 },
      target: {
        source: "x",
        span: { line: 2, column: 8, endLine: 2, endColumn: 9 },
        bindingNames: ["x"],
        capturable: true
      }
    }],
    transfers: []
  }
})).toBe(true);

expect(isWorkerOutboundMessage({
  type: "control_flow_batch",
  sessionId: "s1",
  batches: [{
    batchId: 1,
    events: [{
      eventId: 1,
      kind: "iteration_begin",
      anchorStep: 4,
      frameId: 2,
      context: { loopStack: [{ loopId: "f1", iteration: 1 }] },
      loopId: "f1",
      loopKind: "for",
      iteration: 1,
      bindings: [{ name: "x", value: { type: "int", value: "7" } }]
    }]
  }]
})).toBe(true);
```

Also add invalid protocol cases for:

```text
controlFlowPlan.version != 1
iteration <= 0
anchorStep <= 0
malformed loopStack entry
transfer_status status = observed
loop_exit reason outside the supported enum
batch with duplicate/non-increasing eventId inside the batch
DecisionBatch.context with malformed loopStack
```

Run:

```bash
npm test -- tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
```

Expected: FAIL because Control-Flow contracts do not exist.

- [ ] **Step 2: Create `src/shared/control-flow-types.ts`**

Define the static model:

```ts
import type { SourceSpan } from "./expression-types";
import type { ValueSnapshot } from "./trace-types";

export type LoopKind = "for" | "while";
export type TransferKind = "break" | "continue" | "return";

export interface ForTargetDescriptor {
  source: string;
  span: SourceSpan;
  bindingNames: string[];
  capturable: boolean;
}

export interface LoopSiteDescriptor {
  loopId: string;
  kind: LoopKind;
  span: SourceSpan;
  target?: ForTargetDescriptor;
}

export interface TransferSiteDescriptor {
  transferId: string;
  kind: TransferKind;
  span: SourceSpan;
  targetLoopId?: string;
}

export interface ControlFlowPlan {
  version: 1;
  loops: LoopSiteDescriptor[];
  transfers: TransferSiteDescriptor[];
}

export interface LoopOccurrenceRef {
  loopId: string;
  iteration: number;
}

export interface ExecutionContextRef {
  loopStack: LoopOccurrenceRef[];
}

export interface ControlFlowBindingSnapshot {
  name: string;
  value: ValueSnapshot;
}
```

Define the immutable runtime stream:

```ts
interface ControlFlowRuntimeEventBase {
  eventId: number;
  anchorStep: number;
  frameId: number;
  context: ExecutionContextRef;
}

export type ControlFlowRuntimeEvent =
  | (ControlFlowRuntimeEventBase & {
      kind: "iteration_begin";
      loopId: string;
      loopKind: LoopKind;
      iteration: number;
      bindings: ControlFlowBindingSnapshot[];
    })
  | (ControlFlowRuntimeEventBase & {
      kind: "iteration_complete";
      loopId: string;
      iteration: number;
    })
  | (ControlFlowRuntimeEventBase & {
      kind: "transfer_observed";
      actionId: string;
      transferId: string;
      transferKind: TransferKind;
      targetLoopId?: string;
    })
  | (ControlFlowRuntimeEventBase & {
      kind: "transfer_status";
      actionId: string;
      status: "committed" | "superseded" | "interrupted";
      supersededByActionId?: string;
    })
  | (ControlFlowRuntimeEventBase & {
      kind: "loop_exit";
      loopId: string;
      loopKind: LoopKind;
      reason: LoopExitReason;
    });

export interface ControlFlowBatch {
  batchId: number;
  events: ControlFlowRuntimeEvent[];
}

export interface ControlFlowTracingState {
  status: "complete" | "truncated" | "unavailable";
  reason?: string;
}
```

Define interpreted contracts used by Task 5 and later UI work:

```ts
export type IterationStatus =
  | "completed"
  | "continued"
  | "broke"
  | "function_returned"
  | "interrupted";

export type LoopExitReason =
  | "exhausted"
  | "condition_false"
  | "break"
  | "function_return"
  | "exception"
  | "trace_ended";

export interface LoopIterationEvidence {
  frameId: number;
  loopId: string;
  iteration: number;
  context: ExecutionContextRef;
  anchorStepStart: number;
  anchorStepEnd: number;
  bindings: ControlFlowBindingSnapshot[];
  status: IterationStatus;
  exitActionId?: string;
}

export interface ControlActionEvidence {
  actionId: string;
  transferId: string;
  kind: TransferKind;
  frameId: number;
  context: ExecutionContextRef;
  anchorStepObserved: number;
  anchorStepResolved?: number;
  targetLoopId?: string;
  status: "observed" | "committed" | "superseded" | "interrupted";
  supersededByActionId?: string;
}

export interface LoopExitEvidence {
  frameId: number;
  loopId: string;
  loopKind: LoopKind;
  context: ExecutionContextRef;
  anchorStep: number;
  reason: LoopExitReason;
}
```

- [ ] **Step 3: Extend Decision contracts for occurrence context without breaking current UI types**

In `src/shared/decision-types.ts`, import `ExecutionContextRef` and add:

```ts
export interface DecisionBatch {
  // existing fields unchanged
  context?: ExecutionContextRef;
}
```

Keep the existing `DecisionChainEvidence` and add:

```ts
export interface DecisionChainOccurrence extends DecisionChainEvidence {
  occurrenceId: string;
  frameId: number;
  context: ExecutionContextRef;
  anchorStepStart: number;
  anchorStepEnd: number;
}
```

This is intentionally structurally compatible with `DecisionChainEvidence` so current `DecisionEvidence.ts` can continue receiving an occurrence until the UI companion plan replaces the presentation.

- [ ] **Step 4: Advance schema and execution contracts**

In `src/shared/trace-types.ts`:

```ts
export const TRACE_SCHEMA_VERSION = 5;
```

Add optional `TraceSession` fields:

```ts
controlFlowPlan?: ControlFlowPlan;
controlFlowBatches?: ControlFlowBatch[];
controlFlowTracing?: ControlFlowTracingState;
```

In `src/shared/execution-types.ts`, extend `ExecutionLimits` and defaults:

```ts
maxControlFlowEvents: number;
maxControlFlowBytes: number;
```

```ts
maxControlFlowEvents: 20_000,
maxControlFlowBytes: 2_000_000
```

Extend `ExecutionTerminalResult` with the same three optional Control-Flow fields.

- [ ] **Step 5: Extend worker protocol types and structural validators**

Add outbound message variants:

```ts
| { type: "control_flow_plan"; sessionId: string; plan: ControlFlowPlan }
| { type: "control_flow_batch"; sessionId: string; batches: ControlFlowBatch[] }
```

Add validators for:

```text
ControlFlowPlan
ForTargetDescriptor
ExecutionContextRef
ControlFlowRuntimeEvent union
ControlFlowBatch
ControlFlowTracingState
```

For `transfer_status`, require:

```ts
status === "committed" || status === "superseded" || status === "interrupted"
```

and require `supersededByActionId` only when `status === "superseded"`.

Extend `isDecisionBatch(...)` so optional `context` must pass `isExecutionContextRef(...)`.

Extend `isExecutionTerminalResult(...)` with optional Control-Flow fields.

- [ ] **Step 6: Run focused verification**

```bash
npm test -- tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/control-flow-types.ts src/shared/decision-types.ts src/shared/trace-types.ts src/shared/execution-types.ts src/shared/worker-protocol.ts tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
git commit -m "feat: define control flow evidence protocol"
```

---

### Task 2: Build the Static Control-Flow Planner and Final AST Rewrite

**Files:**
- Create: `src/worker/python/control_flow_instrumenter.py`
- Create: `tests/fixtures/python/test_control_flow_instrumenter.py`
- Modify: `src/worker/python/runner.py`

**Interfaces:**

Python entrypoint:

```python
instrument_control_flow(
    source_code,
    base_tree,
    iteration_begin_name,
    iteration_complete_name,
    transfer_observed_name,
    return_observed_name,
    loop_natural_exit_name,
    loop_after_name,
) -> ControlFlowInstrumentationResult
```

Result:

```python
@dataclass
class ControlFlowInstrumentationResult:
    instrumented_tree: ast.AST | None
    plan_dict: dict
    synthetic_line_map: dict[int, int]
    available: bool
    reason: str | None = None
```

`plan_dict` is always planned from a fresh parse of the **original source**. `base_tree` is the already Expression/Decision-instrumented AST.

- [ ] **Step 1: Write failing planner tests for deterministic loop/transfer ownership**

Create `tests/fixtures/python/test_control_flow_instrumenter.py` with:

```python
def solve(xs, ready):
    for x in xs:
        while ready:
            break
        continue
    return x
```

Assert deterministic plan IDs across two runs:

```text
loops: f1(for), w2(while)
inner break.targetLoopId = w2
continue.targetLoopId = f1
return has no targetLoopId
```

Also test nested function boundaries:

```python
def outer(xs):
    for x in xs:
        def inner(ys):
            for y in ys:
                break
        continue
```

Assert the inner `break` targets only the inner loop and the outer `continue` targets only the outer loop.

Run:

```bash
python3 -m unittest tests/fixtures/python/test_control_flow_instrumenter.py
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement original-source planning**

Planner state:

```python
self.loop_ordinal = 0
self.transfer_ordinal = 0
self.loop_stack = []
```

For each `ast.For` / `ast.While`:

```text
allocate loopId
record kind/span
after planning its iterable/test metadata, push loopId while visiting body
visit orelse after popping body target scope only if needed by lexical semantics
```

For `break` / `continue`, require a non-empty lexical loop stack and record the top loop ID.

For `return`, record every explicit return, including `return` with `value is None`.

When entering `FunctionDef` / `AsyncFunctionDef`, save/replace the lexical loop stack so a transfer inside a nested function cannot target an outer function's loop. Do not add async-loop support; `AsyncFor` is not a planned loop site.

- [ ] **Step 3: Plan safe `for` target bindings**

Use:

```python
def _capturable_binding_names(target):
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        names = []
        for element in target.elts:
            child = _capturable_binding_names(element)
            if child is None:
                return None
            names.extend(child)
        return list(dict.fromkeys(names))
    return None
```

`ast.Starred`, attributes, and subscripts make the whole target non-capturable in v0.1.

For every `for`, record:

```python
{
    "source": ast.get_source_segment(source_code, node.target) or "",
    "span": _span(node.target),
    "bindingNames": names or [],
    "capturable": names is not None,
}
```

- [ ] **Step 4: Implement source-span-driven transfer rewrites**

Map original descriptors to transformed nodes by source span.

Rewrite `break` to an original-line `if` so the normal raw trace line is still the user's break line before the helper executes:

```python
if __lc_transfer_observed(transfer_id, "break", target_loop_id):
    break
```

Rewrite `continue` identically with `"continue"`.

Do **not** put these transfer probes on synthetic lines.

Rewrite expression-valued return:

```python
return __lc_return_observed(transfer_id, already_rewritten_value)
```

Rewrite bare return:

```python
return __lc_return_observed(transfer_id, None)
```

The original Expression planner never creates an Expression root for bare return, so this wrapper must not manufacture Expression Evidence.

- [ ] **Step 5: Inject loop lifecycle probes without touching iterator/test expressions**

For a `for` body, prepend a synthetic expression statement:

```python
__lc_iteration_begin(
    loop_id,
    "for",
    ("i", "value"),
    (i, value),
)
```

Use empty name/value tuples for unsupported targets.

For `while`, prepend:

```python
__lc_iteration_begin(loop_id, "while", (), ())
```

Append:

```python
__lc_iteration_complete(loop_id)
```

to the normal body tail.

Do not rewrite the original `for.iter` expression or the already Decision-instrumented `while.test`.

- [ ] **Step 6: Add natural-exit and post-loop probes**

If the loop has `orelse`, prepend to the existing else suite:

```python
__lc_loop_natural_exit(loop_id, loop_kind)
```

Always insert immediately after the loop statement:

```python
__lc_loop_after(loop_id, loop_kind)
```

The `loop_after` probe is responsible for no-else natural exit and confirmed-break exit; when an earlier natural-exit marker has already emitted the loop exit, it must later become a no-op in the recorder.

- [ ] **Step 7: Assign every inserted lifecycle statement a reserved synthetic source line**

Compute:

```python
synthetic_base = max_original_source_line + 1000
```

Allocate one unique synthetic line per inserted lifecycle statement. Set both `lineno/end_lineno` to that synthetic line, preserve valid columns, and return:

```python
synthetic_line_map[synthetic_line] = original_loop_line
```

Do not mark rewritten break/continue/return nodes synthetic; they remain attached to their original user source line.

- [ ] **Step 8: Prove transform composition with existing Expression + Decision ASTs**

Add a fixture:

```python
def solve(nums, target):
    for i, value in enumerate(nums):
        if value == target:
            return i + 1
    return
```

Build:

```python
expression = instrument_expression_roots(source)
condition = instrument_condition_sites(source, expression.instrumented_tree, ...)
control = instrument_control_flow(source, condition.instrumented_tree, ...)
```

Assert the final compiled AST contains:

```text
existing expression helper calls
existing decision helper calls
control-flow lifecycle helper calls
return-observed wrapper
```

and compiles successfully.

- [ ] **Step 9: Write semantic-preservation tests with inert helpers**

Execute plain and instrumented variants and compare observable results/call logs for:

```python
class SideEffectIterator:
    def __iter__(self):
        calls.append("iter")
        return self
    def __next__(self):
        calls.append("next")
        ...
```

Require identical `iter`/`next` counts.

Also compare:

```text
single-use iterator consumption
tuple/list Name destructuring
unsupported attribute/subscript targets without extra reads
for...else natural exhaustion
for...else break
while...else condition false
bare return → None
```

Use inert helper semantics:

```python
iteration_begin = lambda *_args: None
iteration_complete = lambda *_args: None
transfer_observed = lambda *_args: True
return_observed = lambda _site, value: value
loop_natural_exit = lambda *_args: None
loop_after = lambda *_args: None
```

- [ ] **Step 10: Run Python instrumentation verification**

```bash
python3 -m unittest tests/fixtures/python/test_control_flow_instrumenter.py tests/fixtures/python/test_condition_instrumenter.py tests/fixtures/python/test_expression_instrumenter.py
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/worker/python/control_flow_instrumenter.py src/worker/python/runner.py tests/fixtures/python/test_control_flow_instrumenter.py
git commit -m "feat: instrument Python control flow sites"
```

---

### Task 3: Implement Runtime Control-Flow Recording and Authoritative Trace Integration

**Files:**
- Create: `src/worker/python/control_flow_recorder.py`
- Create: `tests/fixtures/python/test_control_flow_recorder.py`
- Modify: `src/worker/python/decision_recorder.py`
- Modify: `src/worker/python/tracer.py`
- Modify: `src/worker/python/runner.py`
- Modify: `tests/fixtures/python/test_decision_recorder.py`

**Interfaces:**

Recorder methods bound into user bytecode:

```python
ControlFlowRecorder.iteration_begin(loop_id, loop_kind, binding_names, binding_values) -> None
ControlFlowRecorder.iteration_complete(loop_id) -> None
ControlFlowRecorder.transfer_observed(transfer_id, transfer_kind, target_loop_id=None) -> bool
ControlFlowRecorder.return_observed(transfer_id, value) -> value
ControlFlowRecorder.loop_natural_exit(loop_id, loop_kind) -> None
ControlFlowRecorder.loop_after(loop_id, loop_kind) -> None
```

Tracer/runner lifecycle hooks:

```python
ControlFlowRecorder.on_frame_return(frame_id, anchor_step) -> None
ControlFlowRecorder.finalize_exception() -> None
ControlFlowRecorder.finalize_trace_ended() -> None
ControlFlowRecorder.current_execution_context(frame_id) -> dict | None
ControlFlowRecorder.result_dict() -> dict
```

The recorder emits immutable `ControlFlowBatch` objects immediately enough to preserve a useful prefix before hard timeout.

- [ ] **Step 1: Write failing recorder tests for loop-stack and normal iteration lifecycle**

Create `tests/fixtures/python/test_control_flow_recorder.py` with a fake frame/anchor provider.

Drive:

```python
recorder.iteration_begin("f1", "for", ("x",), (7,))
recorder.iteration_complete("f1")
recorder.loop_after("f1", "for")
```

Assert emitted event order:

```text
iteration_begin f1#1 with x=7
iteration_complete f1#1
loop_exit f1 reason=exhausted
```

Assert `current_execution_context(frame_id)` contains `f1#1` only between begin and complete.

- [ ] **Step 2: Implement safe immutable event emission and soft limits**

Recorder state should include:

```python
self.next_batch_id = 1
self.next_event_id = 1
self.next_action_id = 1
self.iteration_counts = {}       # (frame_id, loop_id) -> int
self.active_loop_stacks = {}     # frame_id -> [{loop_id, loop_kind, iteration}]
self.pending_transfers = {}      # frame_id -> pending action dict
self.natural_exit_seen = set()   # transient (frame_id, loop_id) marker until loop_after
self.completed_batches = []
self.control_flow_event_count = 0
self.control_flow_bytes = 0
self.status = "complete"
self.reason = None
```

Use the same safe serializer entrypoint as the trace collector for bindings. If serialization fails for one binding, use:

```python
{
    "type": "unknown",
    "className": "unsupported",
    "repr": "<unsupported control-flow binding>",
}
```

without invoking arbitrary user `repr` solely for Control-Flow evidence.

`_emit(events)` must:

```text
assign batchId
enforce maxControlFlowEvents/maxControlFlowBytes
append terminal copy
stream JSON through emit_batch
never raise into user code
```

Once truncated, helper methods remain semantically neutral; `current_execution_context` returns `None` so Decision Evidence never receives stale/dangling context.

- [ ] **Step 3: Implement iteration begin/complete state transitions**

At `iteration_begin`:

1. resolve current frame ID;
2. if a pending `continue` targets this loop, emit `transfer_status=committed` for it and clear the previous active iteration for that loop;
3. increment `(frame_id, loop_id)` iteration count;
4. push `{loopId, loopKind, iteration}` onto the frame's active loop stack;
5. snapshot safe bindings;
6. emit `iteration_begin` with context **after** the new occurrence is pushed.

At `iteration_complete`:

1. require the active stack top to match the loop ID;
2. emit `iteration_complete` with current context;
3. pop the completed occurrence.

If state is inconsistent, drop Control-Flow evidence for that operation rather than changing user execution.

- [ ] **Step 4: Implement observed/superseded transfer state**

When observing any new transfer in a frame:

```python
previous = self.pending_transfers.get(frame_id)
```

If one exists, emit:

```text
transfer_status(previous.actionId, superseded, supersededByActionId=newActionId)
```

Then emit the new `transfer_observed` and store it pending.

`transfer_observed(...)` must always return built-in `True` even when recording is unavailable/truncated.

`return_observed(...)` must always return the exact supplied `value` object.

- [ ] **Step 5: Implement break/continue confirmation at loop boundaries**

`loop_natural_exit(loop_id, loop_kind)`:

```text
if pending continue targets loop:
    emit transfer_status committed
    clear pending continue
    pop that active iteration
emit loop_exit reason = exhausted(for) / condition_false(while)
mark natural_exit_seen(frame, loop)
```

A natural-exit helper must never commit a pending break; a break cannot legitimately enter loop `else`.

`loop_after(loop_id, loop_kind)`:

```text
if natural_exit_seen(frame, loop):
    clear transient marker
    return
if pending break targets loop:
    commit break
    pop active iteration
    emit loop_exit reason=break
    clear pending
elif pending continue targets loop:
    commit continue
    pop active iteration
    emit loop_exit natural reason
    clear pending
else:
    emit loop_exit natural reason
```

This handles the last-iteration `continue` of a loop without `else`.

- [ ] **Step 6: Implement frame-return confirmation**

`on_frame_return(frame_id, anchor_step)` commits a return **only if** that frame has a pending explicit `return` action.

When one exists:

```text
emit transfer_status(return, committed)
for every active loop occurrence in the frame, innermost to outermost:
    emit loop_exit reason=function_return
clear active loop stack and pending return
```

Do not infer explicit-return Control-Flow evidence for implicit function fallthrough.

- [ ] **Step 7: Implement terminal exception/trace-end finalization**

`finalize_exception()`:

```text
for every pending action:
    emit transfer_status interrupted
for every active loop occurrence:
    emit loop_exit reason=exception
clear pending/active state
```

`finalize_trace_ended()` does the same but emits `loop_exit reason=trace_ended`.

These methods operate only after the runner knows execution is terminal; ordinary caught exceptions must not call them.

- [ ] **Step 8: Add DecisionRecorder context snapshots**

In `src/worker/python/decision_recorder.py`, add:

```python
self.context_provider = None
```

During `begin(...)`, after resolving `frame_id`, snapshot:

```python
context = self.context_provider(frame_id) if self.context_provider is not None else None
```

Store it on the active occurrence and include:

```python
"context": context
```

in the final batch only when non-`None`.

Existing decision recording behavior must remain unchanged when no provider is configured.

Add/modify recorder tests for:

```text
context copied into batch
provider None preserves old batch shape
```

- [ ] **Step 9: Suppress synthetic `line` events in `TraceCollector`**

Extend constructor:

```python
def __init__(..., decision_recorder=None, control_flow_recorder=None, synthetic_line_map=None):
```

Track:

```python
self.synthetic_line_map = dict(synthetic_line_map or {})
self.last_visible_step_by_frame = {}
```

Before the current Expression/Decision flush block, detect:

```python
if event_name == "line" and frame.f_lineno in self.synthetic_line_map:
    return self.trace
```

This synthetic path must:

```text
not flush ExpressionRecorder
not flush DecisionRecorder
not increment raw step_count
not record TraceEvent
not update stdout or Behavioral inputs
```

For visible events, after `_record(...)` returns `step`:

```python
self.last_visible_step_by_frame[frame_id] = step
```

Expose:

```python
def control_flow_anchor_step(self, frame_id):
    return self.last_visible_step_by_frame.get(frame_id)
```

- [ ] **Step 10: Map synthetic return/exception line numbers and confirm real returns**

Allow `_record(...)` to receive a display-line override:

```python
display_line = self.synthetic_line_map.get(frame.f_lineno, frame.f_lineno)
```

Use `display_line` for the emitted raw event and exception metadata.

On a real `return` event:

```python
step = self._record(...)
self.last_visible_step_by_frame[frame_id] = step
self.control_flow_recorder?.on_frame_return(frame_id, step)
```

Call this hook **after** the authoritative raw return event is recorded.

Do not call Control-Flow terminal exception finalization from each raw `exception` trace event because Python may catch it later.

- [ ] **Step 11: Integrate Control Flow as the final runner rewrite**

In `runner.py`:

```python
from control_flow_instrumenter import instrument_control_flow
from control_flow_recorder import ControlFlowRecorder
```

Construct recorder and randomized helper names.

Build AST in this exact order:

```python
expression = instrument_expression_roots(source_code, ...)
expression_tree = expression.instrumented_tree if expression.available else ast.parse(source_code)
condition = instrument_condition_sites(source_code, expression_tree, ...)
decision_tree = condition.instrumented_tree if condition.available else expression_tree
control = instrument_control_flow(source_code, decision_tree, ...)
instrumented_tree = control.instrumented_tree if control.available else decision_tree
```

Add all Control-Flow helper capabilities to the existing capability-binding mechanism.

Pass:

```python
control_flow_recorder=control_recorder,
synthetic_line_map=control.synthetic_line_map if control.available else {},
```

to `TraceCollector`.

After collector construction:

```python
control_recorder.serializer_factory = lambda: collector.serialize_value
control_recorder.frame_id_for = collector.expression_frame_id
control_recorder.anchor_step_for = collector.control_flow_anchor_step
decision_recorder.context_provider = control_recorder.current_execution_context
```

- [ ] **Step 12: Add plan/batch callbacks and terminal finalization in `runner.py`**

Extend `run_request(...)`:

```python
emit_control_flow_plan=None,
emit_control_flow_batch=None,
```

Emit the plan with the same best-effort pattern as Expression/Condition plans.

On `TraceLimitExceeded`:

```python
control_recorder.finalize_trace_ended()
```

before building the terminal result.

On terminal user `Exception`:

```python
control_recorder.finalize_exception()
```

before building the terminal result.

On successful completion, the recorder should already have committed explicit returns from real frame-return hooks and natural/break loop exits from helpers.

Every terminal result includes when available:

```python
control_flow_plan=control.plan_dict
**control_recorder.result_dict()
```

- [ ] **Step 13: Add recorder semantics tests for `finally` override**

Drive recorder methods in factual runtime order and assert:

```text
break observed
continue observed
break superseded by continue
next iteration begins
continue committed
```

Reverse order:

```text
continue observed
break observed
continue superseded by break
loop_after
break committed
loop_exit break
```

Return override:

```text
return A observed
return B observed
A superseded by B
on_frame_return
B committed
```

Also test bare-return recorder behavior by passing `None` through `return_observed` and requiring the identical `None` result.

- [ ] **Step 14: Run Python runtime verification**

```bash
python3 -m unittest tests/fixtures/python/test_control_flow_recorder.py tests/fixtures/python/test_decision_recorder.py tests/fixtures/python/test_control_flow_instrumenter.py tests/fixtures/python/test_condition_instrumenter.py tests/fixtures/python/test_expression_instrumenter.py
```

Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add src/worker/python/control_flow_recorder.py src/worker/python/decision_recorder.py src/worker/python/tracer.py src/worker/python/runner.py tests/fixtures/python/test_control_flow_recorder.py tests/fixtures/python/test_decision_recorder.py
git commit -m "feat: record runtime control flow evidence"
```

---

### Task 4: Stream and Preserve Control-Flow Evidence Through Pyodide and Sessions

**Files:**
- Modify: `src/worker/pyodide-runtime.ts`
- Modify: `src/worker/pyodide-worker.ts`
- Modify: `src/execution/execution-controller.ts`
- Modify: `src/execution/trace-session-collector.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/execution/pyodide-worker.test.ts`
- Modify: `tests/execution/execution-controller.test.ts`
- Modify: `tests/execution/trace-session-collector.test.ts`

**Interfaces:**
- Pyodide callbacks: `onControlFlowPlan` / `onControlFlowBatch`.
- Python callback globals: `__lc_emit_control_flow_plan` / `__lc_emit_control_flow_batch`.
- `TraceSessionCollector` de-duplicates terminal copies by `batchId` and applies `maxControlFlowBytes` independently from raw trace/session bytes.

- [ ] **Step 1: Write failing collector tests for streamed-prefix preservation**

Add `TraceSessionCollector` tests that:

```ts
collector.setControlFlowPlan(plan);
collector.appendControlFlowBatches([batch1]);
collector.appendControlFlowBatches([batch1, batch2]);
```

produces exactly `batch1,batch2` once.

Add a byte-limit test where `maxControlFlowBytes` is exceeded and assert:

```ts
session.controlFlowTracing
// { status: "truncated", reason: "control_flow_byte_limit" }
```

without changing `session.status` to `trace_limit`.

Add timeout-prefix coverage:

```text
plan streamed
iteration_begin batch streamed
collector.forceTimeout()
final session still contains both
```

- [ ] **Step 2: Load Control-Flow Python modules and limits in `buildExecutionScript`**

Import raw sources:

```ts
import controlFlowInstrumenterSource from "./python/control_flow_instrumenter.py?raw";
import controlFlowRecorderSource from "./python/control_flow_recorder.py?raw";
```

Register modules before loading `runner.py`.

Pass limits:

```python
"max_control_flow_events": ${request.limits.maxControlFlowEvents},
"max_control_flow_bytes": ${request.limits.maxControlFlowBytes},
```

and callbacks:

```python
emit_control_flow_plan=globals().get("__lc_emit_control_flow_plan"),
emit_control_flow_batch=globals().get("__lc_emit_control_flow_batch"),
```

- [ ] **Step 3: Implement strict TS normalization**

Add exported normalizers:

```ts
normalizeControlFlowPlan(value: unknown): ControlFlowPlan | undefined
normalizeControlFlowBatch(value: unknown): ControlFlowBatch | null
normalizeControlFlowTracingState(value: unknown): ControlFlowTracingState | undefined
```

Support Python snake_case and TS camelCase where Python terminal fixtures require it.

Validation rules include:

```text
positive batchId/eventId/anchorStep/frameId/iteration
valid loop/transfer enums
loopStack iteration > 0
binding values are valid ValueSnapshot
superseded status requires supersededByActionId
non-superseded status rejects supersededByActionId
batch eventId sequence strictly increases
```

Extend Python terminal-result normalization to consume:

```text
control_flow_plan / controlFlowPlan
control_flow_batches / controlFlowBatches
control_flow_tracing / controlFlowTracing
```

- [ ] **Step 4: Add Pyodide runtime callbacks**

Extend `PyodideRuntimeOptions`:

```ts
onControlFlowPlan?: (sessionId: string, plan: ControlFlowPlan) => void;
onControlFlowBatch?: (sessionId: string, batches: ControlFlowBatch[]) => void;
```

Install best-effort callback globals:

```text
__lc_emit_control_flow_plan
__lc_emit_control_flow_batch
```

Parse JSON, normalize, and ignore malformed optional streams without interrupting Python execution.

Track `streamedControlFlowPlan` / `streamedControlFlowBatches` and fall back to terminal copies only when no streamed copy arrived, matching existing Expression/Decision behavior.

Always delete the two globals in `finally`.

- [ ] **Step 5: Forward Control-Flow worker messages**

In `pyodide-worker.ts` add:

```ts
onControlFlowPlan: (sessionId, plan) => {
  scope.postMessage({ type: "control_flow_plan", sessionId, plan });
},
onControlFlowBatch: (sessionId, batches) => {
  scope.postMessage({ type: "control_flow_batch", sessionId, batches });
},
```

Add worker tests verifying both messages and session IDs.

- [ ] **Step 6: Collect Control-Flow plan/batches independently**

In `TraceSessionCollector` add:

```ts
private controlFlowPlan: ControlFlowPlan | undefined;
private readonly controlFlowBatches: ControlFlowBatch[] = [];
private readonly controlFlowBatchIds = new Set<number>();
private controlFlowTracing: ControlFlowTracingState | undefined;
private controlFlowBytes = 0;
```

Methods:

```ts
setControlFlowPlan(plan: ControlFlowPlan): void
appendControlFlowBatches(batches: ControlFlowBatch[]): void
setControlFlowTracingState(state: ControlFlowTracingState): void
```

When batch bytes exceed `maxControlFlowBytes`:

```ts
this.controlFlowTracing = {
  status: "truncated",
  reason: "control_flow_byte_limit"
};
```

Do not set `resourceLimitReached`.

Include streamed Control-Flow data in `createSession(...)` just like Expression/Decision data.

- [ ] **Step 7: Route Control-Flow messages in `ExecutionController`**

Add optional-stream classifier:

```ts
function isControlFlowMessage(value: unknown): boolean {
  return isRecordLike(value) &&
    (value.type === "control_flow_plan" || value.type === "control_flow_batch");
}
```

Malformed optional Control-Flow streams should be ignored rather than invalidating a healthy run, matching existing Expression/Decision optional evidence behavior.

Handle:

```text
control_flow_plan  → collector.setControlFlowPlan
control_flow_batch → collector.appendControlFlowBatches
```

Before terminal `collector.finish(...)`, merge terminal plan/batches/tracing state with de-duplication.

- [ ] **Step 8: Run bridge/session verification**

```bash
npm test -- tests/execution/pyodide-runtime.test.ts tests/execution/pyodide-worker.test.ts tests/execution/execution-controller.test.ts tests/execution/trace-session-collector.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/worker/pyodide-runtime.ts src/worker/pyodide-worker.ts src/execution/execution-controller.ts src/execution/trace-session-collector.ts tests/execution/pyodide-runtime.test.ts tests/execution/pyodide-worker.test.ts tests/execution/execution-controller.test.ts tests/execution/trace-session-collector.test.ts
git commit -m "feat: stream control flow evidence"
```

---

### Task 5: Reconstruct Runtime Occurrences and Terminal Outcomes in Core

**Files:**
- Create: `src/core/control-flow-interpreter.ts`
- Create: `tests/core/control-flow-interpreter.test.ts`
- Modify: `src/core/trace-interpreter.ts`
- Modify: `tests/core/trace-interpreter.test.ts`

**Interfaces:**

Primary API:

```ts
export interface TraceTerminationContext {
  status: TraceSessionStatus;
  terminationReason: TerminationReason;
}

export interface ControlFlowInterpretation {
  iterations: LoopIterationEvidence[];
  actions: ControlActionEvidence[];
  loopExits: LoopExitEvidence[];
  contextByStep: Map<number, ExecutionContextRef>;
  iterationsByLoop: Map<string, LoopIterationEvidence[]>;
}

export function buildControlFlowEvidence(
  plan: ControlFlowPlan | undefined,
  batches: ControlFlowBatch[],
  runtimeStates: RuntimeState[],
  termination?: TraceTerminationContext
): ControlFlowInterpretation;

export function controlFlowLoopKey(frameId: number, loopId: string): string;
```

`TraceInterpretation` gains `controlFlow: ControlFlowInterpretation`.

- [ ] **Step 1: Write failing interpreter tests for ordinary iteration outcomes**

Create batches for:

```text
iteration_begin → iteration_complete
```

Assert:

```ts
{
  status: "completed",
  anchorStepStart: 3,
  anchorStepEnd: 8
}
```

Create:

```text
iteration_begin
transfer_observed continue
transfer_status continue committed
next iteration_begin
```

Assert previous iteration is `continued` with `exitActionId`.

Create break sequence and assert `broke` plus one `loop_exit reason=break`.

- [ ] **Step 2: Reconstruct action state from immutable events**

Sort all batches by `batchId`, flatten, then sort events by `eventId` while retaining stream order.

On `transfer_observed`, create:

```ts
{
  status: "observed",
  anchorStepObserved: event.anchorStep,
  context: event.context,
  ...
}
```

On `transfer_status`, update only the referenced action:

```text
committed  → status committed + anchorStepResolved
superseded → status superseded + supersededByActionId + anchorStepResolved
interrupted→ status interrupted + anchorStepResolved
```

If a status references an unknown action, ignore it rather than fabricate an action.

- [ ] **Step 3: Reconstruct loop iterations**

Index `iteration_begin` by:

```ts
`${frameId}:${loopId}:${iteration}`
```

Initialize status as internal/open.

Apply terminal signals in factual priority:

```text
iteration_complete                 → completed
committed continue targeting loop → continued
committed break targeting loop    → broke
committed return whose context contains occurrence → function_returned
loop_exit exception/trace_ended for still-open occurrence → interrupted
```

Export only terminal `LoopIterationEvidence`. If an occurrence remains open after event replay and there is no terminal context, conservatively export it as `interrupted` ending at the last captured runtime step rather than inventing normal completion.

- [ ] **Step 4: Synthesize hard-timeout/trace-prefix interruption only from terminal context**

When `termination` is supplied with:

```text
status = timeout
or status = trace_limit
or status = internal_error
```

then for every still-open iteration:

```text
status = interrupted
anchorStepEnd = last runtime step
```

For each active loop without an existing terminal loop-exit event, add a synthetic interpreted-only `LoopExitEvidence`:

```ts
reason: "trace_ended"
```

Do **not** append synthetic runtime batches to the session. This is an interpreter projection only.

For `status = exception`, use `reason: "exception"` only for still-open loops. If Python recorder already emitted exception exits, de-duplicate by `(frameId, loopId, anchorStep/reason)`.

For `status = completed`, never synthesize a normal loop exit from absence.

- [ ] **Step 5: Build `contextByStep` from iteration intervals**

For each raw `RuntimeState.step`, find interpreted iterations satisfying:

```ts
anchorStepStart <= step && step <= anchorStepEnd
```

When several nested occurrences match, choose the occurrence whose stored `context.loopStack` is deepest and set that full context as the current context for the step.

If none match:

```ts
{ loopStack: [] }
```

This map is a runtime-occurrence projection; it must not infer loops from repeated source lines.

- [ ] **Step 6: Build per-loop history maps**

Use:

```ts
controlFlowLoopKey(frameId, loopId) // `${frameId}:${loopId}`
```

Group/sort iteration evidence by `iteration`, then `anchorStepStart`.

Keep different recursion frames independent even when the static `loopId` is the same.

- [ ] **Step 7: Integrate Control Flow into `interpretTrace` without breaking current callers**

Extend the function only with optional trailing parameters:

```ts
export function interpretTrace(
  events: TraceEvent[],
  relations: StaticRelation[] = [],
  expressionPlan?: ExpressionPlan,
  expressionBatches: ExpressionBatch[] = [],
  conditionPlan?: ConditionPlan,
  decisionBatches: DecisionBatch[] = [],
  controlFlowPlan?: ControlFlowPlan,
  controlFlowBatches: ControlFlowBatch[] = [],
  termination?: TraceTerminationContext
): TraceInterpretation
```

Current six-argument UI/test call sites must continue compiling unchanged.

Call:

```ts
const controlFlow = buildControlFlowEvidence(
  controlFlowPlan,
  controlFlowBatches,
  runtimeStates,
  termination
);
```

and return it on `TraceInterpretation`.

Do not feed Control-Flow data into Behavioral Analysis or Failure-First.

- [ ] **Step 8: Run core occurrence verification**

```bash
npm test -- tests/core/control-flow-interpreter.test.ts tests/core/trace-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/control-flow-interpreter.ts src/core/trace-interpreter.ts tests/core/control-flow-interpreter.test.ts tests/core/trace-interpreter.test.ts
git commit -m "feat: interpret runtime control flow occurrences"
```

---

### Task 6: Replace Static Decision-Chain Aggregation With Per-Occurrence Chains

**Files:**
- Modify: `src/core/decision-interpreter.ts`
- Modify: `tests/core/decision-interpreter.test.ts`
- Modify: `tests/core/decision-e2e.test.ts`

**Interfaces:**
- Consumes optional `DecisionBatch.context` added in Task 1 and populated in Task 3.
- Produces `DecisionChainOccurrence[]` through the existing `DecisionInterpretation.chains` property so current UI code remains structurally compatible.

- [ ] **Step 1: Write failing regression test for one static chain across three loop iterations**

Build a plan for:

```python
for x in [-1, 0, 3]:
    if x < 0:
        pass
    elif x == 0:
        pass
    else:
        pass
```

Create decision batches with contexts:

```ts
{ loopStack: [{ loopId: "f1", iteration: 1 }] }
{ loopStack: [{ loopId: "f1", iteration: 2 }] }
{ loopStack: [{ loopId: "f1", iteration: 3 }] }
```

Assert:

```ts
result.chains.length === 3
result.chains.map((occurrence) => occurrence.selectedBranchIndex)
// [0, 1, 2]
```

and each occurrence has distinct `occurrenceId`, correct frame/context, and its own anchor range.

Expected before implementation: current interpreter returns one static aggregate chain.

- [ ] **Step 2: Change Decision interpretation type to occurrences**

Replace:

```ts
chains: DecisionChainEvidence[];
```

with:

```ts
chains: DecisionChainOccurrence[];
```

Keep branch objects structurally identical to the existing `DecisionChainEvidence.branches` contract.

- [ ] **Step 3: Group runtime branch batches by occurrence rather than static chain**

Process decision batches in `batchId` order.

Build lookup:

```ts
siteId -> { chain descriptor, branchIndex }
```

Maintain open occurrence state keyed by:

```ts
`${frameId}:${chainId}:${contextKey}`
```

where:

```ts
contextKey = JSON.stringify(batch.context?.loopStack ?? [])
```

Rules:

```text
branchIndex 0 starts a new occurrence
later elif branch batches with the same frame/context attach to the open occurrence
completed True closes occurrence with selectedBranchIndex
last conditional False + explicit else closes occurrence with else selected
partial batch closes conservatively with selectedBranchIndex = null
new branchIndex 0 closes any still-open prior occurrence conservatively before opening next
```

Assign deterministic runtime IDs:

```ts
`${chain.chainId}:${batch.frameId}:${sequence}`
```

where sequence is counted per `(frameId, chainId)` in runtime order.

- [ ] **Step 4: Preserve backward compatibility when DecisionBatch has no context**

Treat missing context as:

```ts
{ loopStack: [] }
```

and use repeated branch-index-0 boundaries to separate multiple occurrences in the same frame.

Do not reject old schema-v4 decision fixtures solely because they lack context.

- [ ] **Step 5: Preserve branch condition evidence and raw navigation anchors**

Each occurrence stores:

```text
anchorStepStart = first participating batch anchor
anchorStepEnd   = last participating batch anchor
```

Each runtime conditional branch keeps its own existing `branch.anchorStep` and `branch.condition`.

Later branches after a selected branch remain `not_reached` only inside that occurrence; never propagate status to another occurrence.

- [ ] **Step 6: Extend decision E2E coverage to prove runtime context snapshots**

In `tests/core/decision-e2e.test.ts`, add a looped branch-chain case and assert:

```text
three chain occurrences
three distinct loop iteration contexts
selected branches differ according to runtime values
```

Also assert a decision inside nested loops receives the full ordered outer→inner `loopStack`.

- [ ] **Step 7: Run Decision regression verification**

```bash
npm test -- tests/core/decision-interpreter.test.ts tests/core/decision-e2e.test.ts
npm run typecheck
```

Expected: PASS, including current short-circuit/partial semantics.

- [ ] **Step 8: Commit**

```bash
git add src/core/decision-interpreter.ts tests/core/decision-interpreter.test.ts tests/core/decision-e2e.test.ts
git commit -m "feat: scope decision chains by runtime occurrence"
```

---

### Task 7: Add Representative End-to-End Control-Flow Verification and Run Full Gates

**Files:**
- Create: `tests/core/control-flow-e2e.test.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/execution/trace-session-collector.test.ts`
- Modify: `tests/core/trace-interpreter.test.ts`

**Interfaces:**
- Exercises source → Expression/Decision/Control-Flow AST composition → Pyodide → worker normalization → streamed TraceSession → runtime occurrence interpretation.
- Does not render Execution Story UI; that is the companion UI implementation plan.

- [ ] **Step 1: Add a shared-runtime E2E harness**

Model it after `tests/core/decision-e2e.test.ts` and reuse one initialized Pyodide runtime for the suite.

Capture:

```ts
TraceEvent[]
ControlFlowPlan[]
ControlFlowBatch[]
ExecutionTerminalResult
```

Call `interpretTrace(...)` with:

```ts
result.controlFlowPlan ?? streamedPlan,
streamedBatches.length > 0 ? streamedBatches : result.controlFlowBatches ?? [],
{
  status: result.status,
  terminationReason: result.terminationReason
}
```

- [ ] **Step 2: Add simple `for` lifecycle/binding flow**

Use:

```python
class Solution:
    def total(self, nums):
        total = 0
        for x in nums:
            total += x
        return total
```

Assert:

```text
three input items → three iteration_begin events
all three interpreted iterations completed
bindings contain x values in order
loop exit reason = exhausted
explicit return committed
```

Do not assert LeetCode correctness beyond the local returned value already captured by the runtime.

- [ ] **Step 3: Add break/continue and `for...else` flows**

Case A:

```python
for x in nums:
    if x < 0:
        continue
    if x > limit:
        break
else:
    flag = 1
```

Use one testcase that reaches `continue` then `break` and assert:

```text
continued iteration
broke iteration
committed break
loop exit break
else-side effect absent
```

Use a second testcase with no break and assert:

```text
natural exhausted loop exit
else-side effect present
```

- [ ] **Step 4: Add `while...else` and condition alignment flow**

Use:

```python
while left < n:
    left += 1
else:
    done = True
```

Assert:

```text
while iterations correspond to actual body entries
natural loop exit reason = condition_false
existing Decision Evidence still captures final false condition
```

Do not require the final false condition to belong to a body iteration context.

- [ ] **Step 5: Add nested-loop context and per-occurrence branch-chain flow**

Use a matrix traversal with nested `for` and an `if/elif/else` inside the inner loop.

Assert one representative decision occurrence contains:

```ts
{
  loopStack: [
    { loopId: outerLoopId, iteration: 2 },
    { loopId: innerLoopId, iteration: 3 }
  ]
}
```

Assert the static branch chain produces multiple `DecisionChainOccurrence` records rather than one aggregate.

- [ ] **Step 6: Add expression-valued and bare return flows**

Expression return:

```python
return i + 1
```

Assert:

```text
Expression Evidence still exists for i + 1
Control Action return is committed
active loop iteration status = function_returned
loop exit reason = function_return
```

Bare return:

```python
return
```

Assert:

```text
Control Action return committed
terminal returnValue is None snapshot
no fabricated Expression root for the bare return
```

- [ ] **Step 7: Add actual `finally` transfer override coverage**

Use executable Python cases, not recorder-only simulation:

```python
for x in [1, 2]:
    try:
        break
    finally:
        continue
```

Assert:

```text
break action superseded
continue action committed
first iteration continued
loop eventually exits naturally, not by break
```

Reverse:

```python
for x in [1, 2]:
    try:
        continue
    finally:
        break
```

Assert:

```text
continue superseded
break committed
iteration broke
loop exit break
```

Return override:

```python
try:
    return 1
finally:
    return 2
```

Assert first return superseded, second committed, terminal value `2`.

- [ ] **Step 8: Add trace-limit and timeout-prefix preservation tests**

Actual trace-limit run:

```python
while True:
    i += 1
```

with low `maxTraceSteps`.

Assert:

```text
streamed iteration prefix exists
terminal status = trace_limit
open occurrence interpreted as interrupted
loop exit = trace_ended
```

For hard timeout, use the existing fake-worker/controller pattern:

```text
worker streams control_flow_plan
worker streams iteration_begin batch
worker never sends execution_finished
controller hard timeout fires
```

Assert the timed-out `TraceSession` retains plan/batch; then call `interpretTrace` with timeout termination and require interrupted/trace_ended projection.

- [ ] **Step 9: Assert synthetic probes never leak into raw evidence**

For representative `for`, `while`, and loop-else cases assert:

```ts
const sourceLineCount = source.split("\n").length;
expect(events.every((event) => event.line === null || event.line <= sourceLineCount)).toBe(true);
```

Also assert no visible local name begins with Control-Flow helper prefixes and no raw event function name is a synthetic helper.

Compare a representative instrumented raw source-line sequence against the expected user lines and explicitly assert lifecycle probes did not create extra synthetic line numbers.

- [ ] **Step 10: Run all focused foundation tests**

```bash
python3 -m unittest tests/fixtures/python/test_control_flow_instrumenter.py tests/fixtures/python/test_control_flow_recorder.py tests/fixtures/python/test_decision_recorder.py tests/fixtures/python/test_condition_instrumenter.py tests/fixtures/python/test_expression_instrumenter.py
npm test -- tests/core/control-flow-interpreter.test.ts tests/core/control-flow-e2e.test.ts tests/core/decision-interpreter.test.ts tests/core/decision-e2e.test.ts tests/core/trace-interpreter.test.ts tests/execution/pyodide-runtime.test.ts tests/execution/pyodide-worker.test.ts tests/execution/execution-controller.test.ts tests/execution/trace-session-collector.test.ts tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
```

Expected: PASS.

- [ ] **Step 11: Run complete regression gates**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all exit 0 with no regressions in live execution, Expression Evidence, Decision Evidence, Behavioral Signals, Failure-First, Matrix Paths, structure visualizers, or current Side Panel rendering.

- [ ] **Step 12: Inspect the final diff for foundation/UI scope separation**

Verify the implementation does **not** modify:

```text
src/sidepanel/components/TraceVisualizer.ts
src/sidepanel/components/DecisionEvidence.ts
src/sidepanel/components/TraceOutline.ts
src/sidepanel/styles.css
```

except if a compile-only type import adjustment is strictly required. If such an adjustment is required, it must preserve current DOM/output behavior and must not implement Execution Story UI.

Also verify no code adds:

```text
correct/incorrect control-flow labels
expected-path inference
Control-Flow Behavioral Timeline lane
Failure-First weighting from transfers
static CFG reconstruction
async/generator control-flow semantics
```

- [ ] **Step 13: Commit**

```bash
git add tests/core/control-flow-e2e.test.ts tests/execution/pyodide-runtime.test.ts tests/execution/trace-session-collector.test.ts tests/core/trace-interpreter.test.ts
git commit -m "test: validate control flow evidence foundation"
```

---

## Implementation Order and Review Gates

Execute tasks strictly in this order:

```text
1. Shared schema/protocol v5
2. Static planner + final AST rewrite
3. Runtime recorder + authoritative tracer integration
4. Pyodide/worker/session streaming
5. Core occurrence interpretation
6. Per-occurrence Decision chains
7. End-to-end semantics + full regression
```

Do not begin the separate Execution Story UI implementation until all seven foundation tasks are reviewed and passing.

Highest-risk review gates:

```text
Task 2 → AST rewrite preserves iterator/return semantics and does not re-run expressions
Task 3 → observed vs committed transfer state survives finally overrides correctly
Task 3 → synthetic lifecycle statements never become visible raw trace steps
Task 5 → incomplete evidence is never upgraded to normal completion/committed transfer
Task 6 → repeated branch chains are separated by runtime occurrence/context
Task 7 → real Pyodide execution confirms finally, loop-else, bare return, and timeout-prefix behavior
```

The foundation is ready for the UI companion plan only after these invariants are demonstrated by tests, typecheck, and production build.

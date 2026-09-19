# Recursion / Call-Frame Evidence Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make user-code function execution a first-class evidence layer by adding deterministic static function identity, concrete frame occurrences, factual parent/child call relationships, post-binding argument snapshots, authoritative normal-return vs exception-unwind classification, recursion ancestry, and frame-scoped cross-evidence indexing.

**Architecture:** Reuse the existing `sys.settrace` path as the runtime authority. Parse a `FunctionPlan` from the original source, then let the existing `TraceCollector` assign `frameId` / `parentFrameId` and authoritative raw steps. A focused `CallFrameRecorder` consumes those already-observed frame boundaries and emits bounded immutable frame updates; TypeScript merges/finalizes them into `FrameOccurrence` evidence and constructs a deterministic frame tree/index. No call expression is re-evaluated or wrapped solely to discover function structure.

**Tech Stack:** TypeScript 5.8, Vitest 3.2, Python `ast`, `sys.settrace`, `dis`, Pyodide 0.29.3, Chrome MV3 Web Worker.

**Spec:** `docs/superpowers/specs/2026-09-19-recursion-call-frame-evidence-foundation-design.md`

**UI companion (future / out of scope):** Recursion / Call-Frame Execution Story UI.

---

## Global Constraints

- Preserve the product rule: **visualize what the program actually did**; never infer correctness, intended recursion, expected call paths, missing base cases, root cause, or fixes.
- v0.1 first-class frames are user-source frames whose `f_code.co_filename === USER_CODE_FILENAME`.
- Do not instrument or wrap arbitrary call expressions to discover calls.
- Do not invoke any user function solely for tracing.
- Arguments are captured from the callee frame **after Python has already bound parameters**.
- Return values come only from authoritative raw `return` events.
- Exception exit classification must distinguish normal `return None` from CPython/Pyodide trace `return` events caused by exception unwinding.
- Reuse the existing bytecode-based `_is_normal_frame_return(frame)` test as the initial authoritative normal-return discriminator; add regression tests before relying on it for Call-Frame Evidence.
- A raw `exception` event does **not** immediately mean the frame exits: the exception may be handled inside the same frame.
- A user frame is classified `exception` only when a later non-normal frame-return boundary proves unwinding from that frame and a captured exception candidate exists.
- A later user `line` event in the same frame after an `exception` event proves that exception candidate did not unwind the frame and must clear/replace the pending exit candidate.
- Any frame still active when capture terminates becomes `trace_ended`; never fabricate a return or exception.
- Static function identity and runtime frame identity are separate: `functionId` answers **which definition**, `frameId` answers **which invocation**.
- Repeated sibling calls to the same function must remain distinct and must not be labeled recursive when the prior call has already returned.
- Recursion is ancestry-based, not name-based: use mapped `functionId` in the active parent chain.
- Direct recursion and mutual recursion are factual classifications only.
- Synthetic instrumentation/helper frames must never appear as user FrameOccurrence nodes.
- Library/runtime/harness frames are not first-class user frames.
- Call-Frame Evidence has independent soft limits. Use implementation defaults:
  - `maxCallFrameEvents = 20_000`
  - `maxCallFrameBytes = 2_000_000`
- Call-frame truncation must not terminate user execution or stop raw tracing, Expression Evidence, Decision Evidence, or Control-Flow Evidence.
- Missing/ambiguous static function mapping leaves `functionId` absent; do not invent identity from function name.
- Existing Side Panel Call Stack remains unchanged in this foundation plan.
- Do **not** modify recursion UI, Trace Outline presentation, Behavioral Timeline, Failure-First heuristics, or README user-facing feature claims in this plan.
- Advance trace schema from v5 to **v6**. New fields remain optional for backward compatibility.
- Full regression gates remain `npm test`, `npm run typecheck`, and `npm run build`.

---

## File Structure

Create these focused units:

```text
src/shared/call-frame-types.ts
    Serializable FunctionPlan, runtime frame-event/update contracts,
    tracing state, and interpreted FrameOccurrence contracts.

src/worker/python/function_planner.py
    Original-source static function identity and parameter metadata.

src/worker/python/call_frame_recorder.py
    Bounded immutable runtime frame-entry/exit updates and pending
    exception-unwind state. Does not own raw frame IDs or invoke user code.

src/core/call-frame-interpreter.ts
    FunctionPlan + frame updates + raw trace into deterministic
    FrameOccurrence tree, ancestry, recursion facts, and cursor context.

src/core/frame-evidence-index.ts
    Read-only frame-scoped projection over existing Decision / Control-Flow /
    Expression / Mutation evidence.
```

Modify established integration seams only:

```text
src/worker/python/tracer.py
src/worker/python/runner.py
src/shared/trace-types.ts
src/shared/execution-types.ts
src/shared/worker-protocol.ts
src/worker/pyodide-runtime.ts
src/worker/pyodide-worker.ts
src/execution/execution-controller.ts
src/execution/trace-session-collector.ts
src/core/trace-interpreter.ts
```

Testing additions:

```text
tests/fixtures/python/test_function_planner.py
tests/fixtures/python/test_call_frame_recorder.py
tests/core/call-frame-interpreter.test.ts
tests/core/frame-evidence-index.test.ts
tests/core/call-frame-e2e.test.ts
```

Existing protocol/execution tests are extended rather than duplicated.

---

## Task 1: Define Trace Schema v6 and Shared Call-Frame Contracts

**Files:**
- Create: `src/shared/call-frame-types.ts`
- Modify: `src/shared/trace-types.ts`
- Modify: `src/shared/execution-types.ts`
- Modify: `src/shared/worker-protocol.ts`
- Modify: `tests/protocol/worker-protocol.test.ts`
- Modify: `tests/execution/execution-request.test.ts`

**Interfaces:**
- Produces every serializable contract consumed by later tasks.
- Adds worker messages `function_plan` and `call_frame_batch`.
- Adds optional terminal/session fields.
- Adds independent event/byte limits.

- [ ] **Step 1: Write failing limit and protocol tests**

Extend `tests/execution/execution-request.test.ts` defaults/normalization assertions with:

```ts
maxCallFrameEvents: 20_000,
maxCallFrameBytes: 2_000_000
```

Extend `tests/protocol/worker-protocol.test.ts` with valid messages:

```ts
expect(isWorkerOutboundMessage({
  type: "function_plan",
  sessionId: "s1",
  plan: {
    version: 1,
    functions: [{
      functionId: "fn1",
      kind: "method",
      name: "maxDepth",
      qualifiedName: "Solution.maxDepth",
      span: { line: 2, column: 4, endLine: 6, endColumn: 20 },
      firstBodyLine: 3,
      parameterNames: ["self", "root"],
      parameterKinds: ["positional_or_keyword", "positional_or_keyword"],
      parentClassName: "Solution"
    }]
  }
})).toBe(true);

expect(isWorkerOutboundMessage({
  type: "call_frame_batch",
  sessionId: "s1",
  batches: [{
    batchId: 1,
    updates: [{
      updateId: 1,
      kind: "frame_enter",
      frameId: 2,
      parentFrameId: 1,
      functionName: "depth",
      functionId: "fn2",
      callStep: 7,
      depth: 2,
      arguments: [{
        name: "node",
        kind: "positional_or_keyword",
        value: { type: "none", value: null }
      }]
    }]
  }]
})).toBe(true);
```

Add negative cases for:

```text
FunctionPlan.version != 1
duplicate functionId in plan
frameId <= 0
parentFrameId === frameId
callStep <= 0
exitStep <= 0
unknown update kind
returned update without value
exception update without exception snapshot
trace_ended update without reason
duplicate/non-increasing updateId inside a batch
malformed BoundArgumentSnapshot
invalid recursionDepth if present
```

Run:

```bash
npm test -- tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
```

Expected: FAIL because Call-Frame contracts do not exist.

- [ ] **Step 2: Create `src/shared/call-frame-types.ts`**

Define static contracts:

```ts
import type { SourceSpan } from "./expression-types";
import type { ExceptionInfo } from "./execution-types";
import type { ValueSnapshot } from "./trace-types";

export type FunctionKind = "function" | "method" | "nested_function";

export type ParameterBindingKind =
  | "positional_only"
  | "positional_or_keyword"
  | "keyword_only"
  | "varargs"
  | "varkw"
  | "unknown";

export interface FunctionDescriptor {
  functionId: string;
  kind: FunctionKind;
  name: string;
  qualifiedName: string;
  span: SourceSpan;
  firstBodyLine: number | null;
  parameterNames: string[];
  parameterKinds: ParameterBindingKind[];
  parentFunctionId?: string;
  parentClassName?: string;
}

export interface FunctionPlan {
  version: 1;
  functions: FunctionDescriptor[];
}

export interface BoundArgumentSnapshot {
  name: string;
  kind: ParameterBindingKind;
  value: ValueSnapshot;
}
```

Define immutable runtime updates:

```ts
export type CallFrameRuntimeUpdate =
  | {
      updateId: number;
      kind: "frame_enter";
      frameId: number;
      parentFrameId: number | null;
      functionName: string;
      functionId?: string;
      callStep: number;
      depth: number;
      arguments: BoundArgumentSnapshot[];
    }
  | {
      updateId: number;
      kind: "frame_return";
      frameId: number;
      exitStep: number;
      value: ValueSnapshot;
    }
  | {
      updateId: number;
      kind: "frame_exception";
      frameId: number;
      exitStep: number;
      exception: ExceptionInfo;
    }
  | {
      updateId: number;
      kind: "frame_trace_ended";
      frameId: number;
      reason: string;
      exitStep?: number;
    };

export interface CallFrameBatch {
  batchId: number;
  updates: CallFrameRuntimeUpdate[];
}

export interface CallFrameTracingState {
  status: "complete" | "truncated" | "unavailable";
  reason?: string;
}
```

Define interpreted contracts:

```ts
export interface RecursionOccurrenceInfo {
  isRecursive: boolean;
  recursionDepth: number;
  repeatedAncestorFrameId?: number;
  cycleFunctionIds?: string[];
}

export type FrameExit =
  | { status: "active" }
  | { status: "returned"; step: number; value: ValueSnapshot }
  | { status: "exception"; step: number; exception: ExceptionInfo }
  | { status: "trace_ended"; step?: number; reason: string };

export interface FrameOccurrence {
  frameId: number;
  functionId?: string;
  functionName: string;
  parentFrameId: number | null;
  depth: number;
  callStep: number;
  firstUserLineStep?: number;
  arguments: BoundArgumentSnapshot[];
  childFrameIds: number[];
  recursion: RecursionOccurrenceInfo;
  exit: FrameExit;
}

export interface CallFrameModel {
  roots: number[];
  byFrameId: Map<number, FrameOccurrence>;
  tracingState: CallFrameTracingState;
}

export interface FrameCursorContext {
  currentFrameId?: number;
  ancestors: number[];
  activeChildPath: number[];
}
```

Do not put `Map`-containing interpreted contracts into worker protocol validators; only static plan, batches, tracing state, and terminal/session fields cross the serialization boundary.

- [ ] **Step 3: Advance trace/execution contracts**

In `src/shared/trace-types.ts`:

```ts
export const TRACE_SCHEMA_VERSION = 6;
```

Add optional `TraceSession` fields:

```ts
functionPlan?: FunctionPlan;
callFrameBatches?: CallFrameBatch[];
callFrameTracing?: CallFrameTracingState;
```

In `src/shared/execution-types.ts`, extend `ExecutionLimits` and defaults:

```ts
maxCallFrameEvents: number;
maxCallFrameBytes: number;
```

```ts
maxCallFrameEvents: 20_000,
maxCallFrameBytes: 2_000_000
```

Extend `ExecutionTerminalResult` with optional:

```ts
functionPlan?: FunctionPlan;
callFrameBatches?: CallFrameBatch[];
callFrameTracing?: CallFrameTracingState;
```

- [ ] **Step 4: Extend worker protocol**

Add outbound variants:

```ts
| { type: "function_plan"; sessionId: string; plan: FunctionPlan }
| { type: "call_frame_batch"; sessionId: string; batches: CallFrameBatch[] }
```

Add strict structural validators for:

```text
FunctionDescriptor
FunctionPlan
BoundArgumentSnapshot
CallFrameRuntimeUpdate
CallFrameBatch
CallFrameTracingState
```

Validation rules:

- `frame_enter.parentFrameId` may be null.
- `frame_return.value` is always a `ValueSnapshot`; normal bare return uses serialized `None`.
- `frame_exception.exception.frameId` may equal the update frameId.
- `frame_trace_ended.exitStep` is optional.
- `functionId` on frame entry is optional because static mapping may be unavailable.

- [ ] **Step 5: Focused verification**

```bash
npm test -- tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/call-frame-types.ts src/shared/trace-types.ts src/shared/execution-types.ts src/shared/worker-protocol.ts tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
git commit -m "feat: define call frame evidence protocol"
```

---

## Task 2: Build Deterministic Static Function Planning

**Files:**
- Create: `src/worker/python/function_planner.py`
- Create: `tests/fixtures/python/test_function_planner.py`
- Modify: `src/worker/python/runner.py`

**Interface:**

```python
plan_user_functions(source_code: str) -> FunctionPlanningResult
```

Conceptual result:

```python
@dataclass
class FunctionPlanningResult:
    plan_dict: dict
    available: bool
    reason: str | None = None
```

No AST rewriting occurs in this task.

- [ ] **Step 1: Write failing deterministic identity tests**

Create tests for:

```python
def solve(x):
    return x
```

```python
class Solution:
    def solve(self, x):
        return self.helper(x)

    def helper(self, x):
        return x
```

```python
def outer(x):
    def visit(y):
        return y
    return visit(x)

def other(x):
    def visit(y):
        return y + 1
    return visit(x)
```

Assert:

- same source planned twice produces byte-for-byte equal `plan_dict`;
- top-level function, method, and nested functions receive distinct deterministic IDs;
- same-name nested `visit` functions do not collide;
- methods retain `parentClassName`;
- nested functions retain `parentFunctionId`;
- `qualifiedName` is deterministic and human-readable;
- source spans use original source positions;
- `firstBodyLine` is the first original body statement line or null for an empty/pass-only edge case as chosen by implementation contract.

Run:

```bash
python3 -m unittest tests/fixtures/python/test_function_planner.py
```

Expected: FAIL.

- [ ] **Step 2: Implement parameter metadata**

Map Python AST parameter groups:

```text
posonlyargs -> positional_only
args        -> positional_or_keyword
vararg      -> varargs
kwonlyargs  -> keyword_only
kwarg       -> varkw
```

Preserve Python declaration order:

```text
positional-only
positional-or-keyword
*args
keyword-only
**kwargs
```

Store parallel:

```python
parameterNames
parameterKinds
```

The arrays must have equal length.

Do not evaluate default values or annotations.

- [ ] **Step 3: Implement lexical identity**

Planner maintains lexical stacks:

```python
class_stack = []
function_stack = []
function_ordinal = 0
```

Recommended stable ID basis:

```text
kind + original source span + lexical parent path + ordinal
```

The exact string format is internal, but must be deterministic and must not use random values or Python object IDs.

Classification:

- function directly under module -> `function`
- function directly under class -> `method`
- function under another function -> `nested_function`

For nested functions inside methods, preserve both lexical function parent and class context where useful.

Do not recurse into lambda as a first-class function descriptor in v0.1.

- [ ] **Step 4: Add runtime mapping key metadata**

The runtime tracer must be able to map `frame.f_code` back to a descriptor without using function name alone.

Add internal-only descriptor metadata in Python planning result as needed, for example:

```python
runtime_lookup = {
    (co_name_candidate, firstlineno): function_id
}
```

Do **not** serialize an implementation-specific map if TypeScript does not need it.

Preferred matching inputs:

```text
frame.f_code.co_name
frame.f_code.co_firstlineno
lexical/qualified name when available
original descriptor span
```

Because AST instrumentation can shift generated code metadata, add tests against the **fully instrumented compiled tree** in Task 4 before declaring mapping stable.

- [ ] **Step 5: Fail-open planning**

On unexpected planner failure:

```python
{
  "version": 1,
  "functions": []
}
```

with `available=False` and a reason.

A valid user program must still execute even if static function mapping is unavailable.

Syntax errors remain owned by the normal parse path, not hidden as planner unavailability.

- [ ] **Step 6: Focused verification**

```bash
python3 -m unittest tests/fixtures/python/test_function_planner.py
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worker/python/function_planner.py tests/fixtures/python/test_function_planner.py src/worker/python/runner.py
git commit -m "feat: plan user function identities"
```

---

## Task 3: Add the Bounded Call-Frame Recorder

**Files:**
- Create: `src/worker/python/call_frame_recorder.py`
- Create: `tests/fixtures/python/test_call_frame_recorder.py`

**Responsibility:**

The recorder owns **Call-Frame Evidence state and batching only**.

It does not:

- assign raw frame IDs;
- call `sys.settrace`;
- decide whether a raw return is normal;
- invoke user code;
- inspect future frames;
- reconstruct TypeScript tree models.

The tracer supplies factual boundaries.

- [ ] **Step 1: Write failing recorder state-machine tests**

Test entry:

```python
recorder.frame_enter(
    frame_id=2,
    parent_frame_id=1,
    function_name="depth",
    function_id="fn2",
    call_step=7,
    depth=2,
    arguments=[...],
)
```

Expected one `frame_enter` update.

Test normal return:

```python
recorder.frame_return(frame_id=2, exit_step=12, value_snapshot=...)
```

Expected one terminal update and no duplicate terminal update if called again.

Test exception candidate + handled exception:

```text
frame_exception_observed(frame 2, ValueError)
frame_resumed(frame 2)
frame_return(normal)
```

Expected final status = returned, not exception.

Test propagated exception:

```text
frame_exception_observed(frame 2, ValueError)
frame_unwind(frame 2)
```

Expected `frame_exception`.

Test truncation:

- exceeding max event count marks recorder truncated;
- no later updates emitted;
- user execution-facing methods remain no-throw/fail-open.

Test `trace_ended`:

- active frames receive one `frame_trace_ended` update at finalization;
- already returned/exception frames do not.

- [ ] **Step 2: Implement soft-limit helpers**

Follow Expression/Decision/Control-Flow recorder patterns.

Read both snake/camel request keys:

```python
max_call_frame_events / maxCallFrameEvents
max_call_frame_bytes / maxCallFrameBytes
```

State:

```python
self.status = "complete"
self.reason = None
self.next_update_id = 1
self.next_batch_id = 1
self.pending_updates = []
self.all_batches = []
self.active_frames = set()
self.terminal_frames = set()
self.pending_exception_by_frame = {}
```

Use JSON encoded byte accounting.

On event/byte exhaustion:

```text
status = truncated
reason = call_frame_event_limit | call_frame_byte_limit
```

Do not raise into user execution.

- [ ] **Step 3: Implement immutable update emission**

Recorder methods:

```python
frame_enter(...)
exception_observed(frame_id, exception_snapshot)
frame_resumed(frame_id)
frame_return(frame_id, exit_step, value_snapshot)
frame_unwind(frame_id, exit_step)
finalize_active(reason, exit_step_by_frame=None)
flush()
result_batches()
tracing_state()
```

Rules:

- `exception_observed` stores/replaces a candidate but does not emit terminal frame evidence.
- `frame_resumed` clears the pending exception candidate for that frame.
- `frame_unwind` emits `frame_exception` only if a candidate exists.
- If unwind classification occurs with no usable candidate, emit `frame_trace_ended` or leave unresolved according to the factual data available; do not fabricate an exception payload.
- A terminal frame cannot later return to active.
- Entry updates preserve supplied parent and call order exactly.

- [ ] **Step 4: Batch semantics**

Use deterministic monotonically increasing `batchId` and `updateId`.

Streaming is best effort:

```python
try:
    emit_batch(...)
except Exception:
    pass
```

Terminal result retains all successfully recorded batches for normal completion.

Avoid emitting one batch per frame when unnecessary; use the same bounded flush-size/latency style as existing evidence recorders where practical.

- [ ] **Step 5: Verify**

```bash
python3 -m unittest tests/fixtures/python/test_call_frame_recorder.py
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worker/python/call_frame_recorder.py tests/fixtures/python/test_call_frame_recorder.py
git commit -m "feat: record call frame evidence"
```

---

## Task 4: Integrate Frame Evidence with the Authoritative Tracer

**Files:**
- Modify: `src/worker/python/tracer.py`
- Modify: `tests/fixtures/python/test_trace_engine.py`
- Modify: `tests/fixtures/python/test_call_frame_recorder.py`

**Critical design decision:**

The existing `TraceCollector` remains authoritative for:

```text
frameId
parentFrameId
callDepth
raw step
normal-return bytecode classification
raw exception payload
active frame stack
```

`CallFrameRecorder` receives facts **after** the matching raw trace event has an authoritative step.

- [ ] **Step 1: Add failing tracer-order tests**

Cover:

1. user `call` event gets raw step N and Call-Frame entry `callStep === N`;
2. normal `return None` becomes `frame_return`, not exception;
3. exception event followed by a handler `line` in same frame clears pending exception;
4. uncaught exception produces:
   - raw `exception`,
   - non-normal raw `return`,
   - `frame_exception` at the unwind return step;
5. recursive calls preserve parentFrameId;
6. synthetic helper frames never enter because filename differs from `USER_CODE_FILENAME` or because existing capability binding keeps them outside the user source contract.

Run Python fixture tests and confirm they fail before integration.

- [ ] **Step 2: Add recorder dependency to `TraceCollector`**

Constructor:

```python
call_frame_recorder=None,
function_mapper=None,
```

Store per-frame exception candidates only through the recorder; do not introduce a second conflicting exception state machine inside tracer.

- [ ] **Step 3: Map runtime frame to static function identity**

Add a helper owned by the planning/runtime integration layer:

```python
function_id = function_mapper(frame) if function_mapper else None
```

Mapping must use deterministic compiled-code metadata, not `co_name` alone.

If mapping fails:

```python
function_id = None
```

Frame entry still records factual runtime evidence.

- [ ] **Step 4: Capture post-binding arguments at `call`**

At a user `call` event:

1. assign `frameId`, parent, depth using existing logic;
2. record the raw `call` event;
3. serialize only declared parameters from mapped `FunctionDescriptor`;
4. pass the snapshots to `CallFrameRecorder.frame_enter(...)`.

Important:

- use `frame.f_locals` after Python binding;
- do not serialize every local as an argument;
- if descriptor mapping is absent, arguments may be `[]`;
- if one parameter is missing/unserializable, use existing serializer fallback or omit only that binding according to ValueSerializer behavior; do not fail execution.

This intentionally reuses the same `ValueSerializer` / object identity registry as the raw trace.

- [ ] **Step 5: Wire exception observation/resume**

After recording a raw `exception` event:

```python
call_frame_recorder.exception_observed(
    frame_id,
    event["event_payload"]["exception"],
)
```

On the next raw `line` event in that same frame:

```python
call_frame_recorder.frame_resumed(frame_id)
```

This is the proof boundary that the observed exception did not immediately unwind the frame.

If another exception later occurs, it replaces the candidate.

- [ ] **Step 6: Wire return vs unwind**

On raw `return` event:

```python
if self._is_normal_frame_return(frame):
    call_frame_recorder.frame_return(
        frame_id,
        step,
        event["event_payload"]["return_value"],
    )
else:
    call_frame_recorder.frame_unwind(frame_id, step)
```

Keep existing Control-Flow rule:

```python
if normal_return:
    control_flow_recorder.on_frame_return(...)
```

Do not classify a non-normal return as a Control-Flow user `return`.

- [ ] **Step 7: Preserve existing frame stack teardown**

After evidence finalization, keep current:

```text
pop frame_stack
remove frame_objects
remove frame_info
```

Call-Frame recorder must not become the authority for raw stack management.

- [ ] **Step 8: Verify Python semantics and ordering**

```bash
python3 -m unittest tests/fixtures/python/test_trace_engine.py
python3 -m unittest tests/fixtures/python/test_call_frame_recorder.py
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/worker/python/tracer.py tests/fixtures/python/test_trace_engine.py tests/fixtures/python/test_call_frame_recorder.py
git commit -m "feat: connect frame evidence to tracer"
```

---

## Task 5: Wire Function Plan and Call-Frame Streaming Through Runner / Worker / Collector

**Files:**
- Modify: `src/worker/python/runner.py`
- Modify: `src/worker/pyodide-runtime.ts`
- Modify: `src/worker/pyodide-worker.ts`
- Modify: `src/execution/execution-controller.ts`
- Modify: `src/execution/trace-session-collector.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/execution/pyodide-worker.test.ts`
- Modify: `tests/execution/execution-controller.test.ts`
- Modify: `tests/execution/trace-session-collector.test.ts`
- Modify: `tests/protocol/worker-protocol.test.ts`

- [ ] **Step 1: Write failing collector streaming tests**

Add tests proving:

- streamed `function_plan` survives hard timeout;
- streamed frame batches survive hard timeout;
- terminal duplicate batches are de-duplicated by `batchId`;
- duplicate update batches do not create duplicate stored batches;
- exceeding `maxCallFrameBytes` marks only Call-Frame Evidence truncated;
- raw trace collection continues;
- `forceTimeout()` preserves already streamed call-frame data;
- sessions without any call-frame fields remain valid.

- [ ] **Step 2: Plan functions before execution**

In `run_request(...)`:

```python
function_planning = plan_user_functions(source_code)
function_plan = function_planning.plan_dict
```

Planning is from the original source before runtime execution.

Because existing Expression/Decision/Control-Flow AST rewrites may affect code metadata, build the runtime mapping **after final compile** from the plan plus compiled code objects. Add a focused helper such as:

```python
build_runtime_function_mapper(function_plan, user_code)
```

Do not alter the final AST solely for call-frame tracing unless Task 2 mapping tests prove metadata is insufficient.

- [ ] **Step 3: Instantiate recorder and tracer integration**

In `runner.py`:

```python
call_frame_recorder = CallFrameRecorder(
    limits,
    session_id=session_id,
    emit_batch=emit_call_frame_batch,
)
```

Pass into `TraceCollector` with the runtime function mapper.

Reuse collector serializer:

```python
call_frame_recorder.serializer_factory = lambda: collector.serialize_value
```

if needed by the chosen recorder API.

- [ ] **Step 4: Add plan/batch emitters**

Extend `run_request` parameters:

```python
emit_function_plan=None,
emit_call_frame_batch=None,
```

Emit the static plan before user execution whenever planning is available.

Add runtime bridge callbacks in `pyodide-runtime.ts` / Python globals following existing expression/decision/control-flow message patterns.

Worker messages:

```text
function_plan
call_frame_batch
```

- [ ] **Step 5: Finalize active frames on every terminal path**

Before producing terminal result, call:

```python
call_frame_recorder.finalize_active(
    reason=<factual termination reason>,
    exit_step_by_frame=collector.last_visible_step_by_frame,
)
```

Apply for at least:

```text
normal completion cleanup if an unexpected active frame remains
runtime exception
step_limit
trace_byte_limit
stdout_limit
hard-timeout prefix when worker-side finalization is available
internal tracing failure
```

For browser-side hard worker termination where Python cannot finalize, TypeScript interpreter must be able to project still-open `frame_enter` occurrences as `trace_ended` using the session termination reason. Do not rely exclusively on Python finalization for timeout correctness.

- [ ] **Step 6: Add terminal result fields**

Normal terminal result includes:

```python
function_plan=function_plan,
call_frame_batches=call_frame_recorder.result_batches(),
call_frame_tracing=call_frame_recorder.tracing_state(),
```

When static planning unavailable:

```text
functionPlan may still be empty/omitted
runtime frame batches may still exist with functionId absent
callFrameTracing.status may remain complete if runtime capture itself worked
```

Static mapping availability and runtime capture availability must not be conflated.

- [ ] **Step 7: Extend `TraceSessionCollector`**

Add state:

```ts
private functionPlan: FunctionPlan | undefined;
private readonly callFrameBatches: CallFrameBatch[] = [];
private readonly callFrameBatchIds = new Set<number>();
private callFrameTracing: CallFrameTracingState | undefined;
private callFrameBytes = 0;
```

Methods:

```ts
setFunctionPlan(...)
appendCallFrameBatches(...)
setCallFrameTracingState(...)
```

Apply independent byte limits.

Merge terminal copies before creating final session, exactly as existing Control-Flow fields do.

- [ ] **Step 8: Extend execution controller / worker message dispatch**

Route:

```text
function_plan -> collector.setFunctionPlan
call_frame_batch -> collector.appendCallFrameBatches
```

No UI notification is required yet.

- [ ] **Step 9: Focused verification**

```bash
npm test -- tests/execution/trace-session-collector.test.ts tests/execution/execution-controller.test.ts tests/execution/pyodide-runtime.test.ts tests/execution/pyodide-worker.test.ts tests/protocol/worker-protocol.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/worker/python/runner.py src/worker/pyodide-runtime.ts src/worker/pyodide-worker.ts src/execution/execution-controller.ts src/execution/trace-session-collector.ts tests/execution/pyodide-runtime.test.ts tests/execution/pyodide-worker.test.ts tests/execution/execution-controller.test.ts tests/execution/trace-session-collector.test.ts tests/protocol/worker-protocol.test.ts
git commit -m "feat: stream call frame evidence"
```

---

## Task 6: Build the TypeScript Call-Frame Interpreter

**Files:**
- Create: `src/core/call-frame-interpreter.ts`
- Create: `tests/core/call-frame-interpreter.test.ts`

**Interface:**

```ts
export function interpretCallFrames(input: {
  events: TraceEvent[];
  functionPlan?: FunctionPlan;
  batches?: CallFrameBatch[];
  tracingState?: CallFrameTracingState;
  terminationReason: TerminationReason;
}): CallFrameModel;
```

Also expose:

```ts
export function frameCursorContextAt(
  model: CallFrameModel,
  events: TraceEvent[],
  rawIndex: number
): FrameCursorContext;
```

- [ ] **Step 1: Write failing tree reconstruction tests**

Fixture:

```text
frame 1: solve
  frame 2: helper
  frame 3: helper
```

Assert:

- roots = [1];
- frame 1 children = [2, 3] in runtime order;
- frame 2/3 remain distinct;
- parent references are preserved;
- terminal return state is merged onto the matching enter record;
- duplicate terminal update for same frame does not overwrite first authoritative terminal evidence.

- [ ] **Step 2: Implement batch merge**

Rules:

- sort batches by `batchId` only for deterministic consumption;
- preserve update order by `updateId`;
- one `frame_enter` creates an occurrence;
- terminal update finalizes an existing frame;
- terminal update without an enter is ignored or retained as malformed diagnostic internally; do not fabricate a parentless frame;
- repeated `frame_enter` for same frameId keeps first authoritative entry;
- child attachment occurs only when both child enter and parent enter are known;
- if parent never appears because evidence truncated, child may become a root in the interpreted forest only if that is the least-fabricated representation; mark no invented parent.

- [ ] **Step 3: Derive recursion from ancestry**

After parent graph is stable:

For each frame with `functionId`:

1. walk factual parent chain;
2. collect ancestors with same `functionId`;
3. `isRecursive = matches.length > 0`;
4. `recursionDepth = matches.length + 1`;
5. `repeatedAncestorFrameId` = nearest matching ancestor.

For mutual recursion:

- if current functionId occurs anywhere earlier in ancestry, direct repeated-function recursion is factual;
- optionally compute `cycleFunctionIds` from nearest repeated occurrence to current frame;
- never mark recursion based on functionName when `functionId` absent.

Non-recursive frames get:

```ts
{ isRecursive: false, recursionDepth: 1 }
```

- [ ] **Step 4: Derive `firstUserLineStep` from raw events**

For each frame:

```ts
firstUserLineStep =
  first event where event.frameId === frameId && event.event === "line"
```

Do not mutate raw events.

- [ ] **Step 5: Project unclosed frames as trace-ended**

If a frame has `frame_enter` and no terminal update at session end:

```ts
exit = {
  status: "trace_ended",
  reason: terminationReason
}
```

This is required for browser hard-timeout sessions that terminate before Python can flush finalization.

If tracing itself is truncated while raw execution completed, use the Call-Frame tracing reason rather than claiming the Python frame actually remained active. Prefer neutral evidence:

- frames with authoritative terminal updates retain them;
- unfinalized recorded frames become `trace_ended` with the best factual capture reason.

- [ ] **Step 6: Implement raw-cursor frame context**

At a raw trace index:

- use `events[rawIndex]?.frameId`;
- if that frame exists in model, it is current;
- ancestors are factual parent chain root -> parent;
- `activeChildPath` is root -> current.

Do not derive current frame from line/function text.

If selected raw event belongs to a user frame not recorded because call-frame evidence truncated, `currentFrameId` may be absent rather than synthesizing a node.

- [ ] **Step 7: Add malformed/partial tests**

Cover:

```text
missing parent
truncated batches
unknown functionId
frame enter only
exception terminal
normal returned None
duplicate sibling names
direct recursion
mutual recursion
sequential repeated non-recursive calls
```

- [ ] **Step 8: Verify**

```bash
npm test -- tests/core/call-frame-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/call-frame-interpreter.ts tests/core/call-frame-interpreter.test.ts
git commit -m "feat: interpret call frame hierarchy"
```

---

## Task 7: Add Frame-Scoped Cross-Evidence Indexing

**Files:**
- Create: `src/core/frame-evidence-index.ts`
- Create: `tests/core/frame-evidence-index.test.ts`
- Modify: `src/core/trace-interpreter.ts`
- Modify: `tests/core/trace-interpreter.test.ts`

**Goal:**

Make `frameId` a structural query key without moving ownership of any existing evidence fact.

- [ ] **Step 1: Write failing index tests**

Use a fixture where frame 2 owns:

- two Decision occurrences;
- one Control-Flow loop occurrence;
- one Expression evidence step;
- several runtime mutations;
- child frame 3.

Frame 4 has separate evidence.

Assert zero cross-frame leakage.

- [ ] **Step 2: Define index contract**

```ts
export interface FrameEvidenceEntry {
  frameId: number;
  childFrameIds: number[];
  decisionAnchors: number[];
  controlFlowIterationRefs: Array<{
    loopId: string;
    iteration: number;
    anchorStepStart: number;
  }>;
  expressionAnchors: number[];
  mutationAnchors: number[];
}

export type FrameEvidenceIndex = Map<number, FrameEvidenceEntry>;
```

Prefer anchors/references over copying entire evidence objects.

- [ ] **Step 3: Build index from already interpreted evidence**

Function:

```ts
export function buildFrameEvidenceIndex(input: {
  callFrames: CallFrameModel;
  events: TraceEvent[];
  decisionEvidence: ...;
  controlFlow: ...;
  expressionEvidence: ...;
  visualStates: RuntimeState[];
}): FrameEvidenceIndex;
```

Use existing authoritative fields:

- Decision evidence `frameId`;
- Control-Flow evidence `frameId`;
- Expression batch/evidence `frameId`;
- raw/RuntimeState event `frameId`;
- CallFrameModel child IDs.

Do not infer ownership from source line.

- [ ] **Step 4: Integrate into `trace-interpreter.ts`**

Extend the interpretation return value with:

```ts
callFrames: CallFrameModel;
frameEvidenceIndex: FrameEvidenceIndex;
```

Interpretation order should be conceptually:

```text
raw states / mutations
expression
decision
control flow
call frames
frame evidence index
visual models / story projections
```

Call-frame interpretation itself may happen before other layers if necessary, but the index is constructed only after all required evidence exists.

- [ ] **Step 5: Preserve existing consumers**

Existing Side Panel components must compile unchanged.

No panel is added in this task.

If `trace-interpreter.ts` public result is widely destructured, add fields additively.

- [ ] **Step 6: Verify**

```bash
npm test -- tests/core/frame-evidence-index.test.ts tests/core/trace-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/frame-evidence-index.ts src/core/trace-interpreter.ts tests/core/frame-evidence-index.test.ts tests/core/trace-interpreter.test.ts
git commit -m "feat: index runtime evidence by frame"
```

---

## Task 8: Validate Runtime Function Mapping Against the Fully Instrumented Program

**Files:**
- Modify: `src/worker/python/function_planner.py`
- Modify: `src/worker/python/runner.py`
- Modify: `tests/fixtures/python/test_function_planner.py`
- Modify: `tests/core/call-frame-e2e.test.ts`

**Reason for a dedicated task:**

The user program is compiled only after Expression -> Decision -> Control-Flow rewriting. Static original-source spans are authoritative, but Python `co_firstlineno` / nested code-object layout must be proven stable enough for descriptor mapping under the final compiled program.

Do not assume this mapping works until tested end-to-end.

- [ ] **Step 1: Add mapping regression cases**

Include:

```python
class Solution:
    def solve(self, n):
        return self.helper(n)

    def helper(self, n):
        if n <= 0:
            return 0
        return self.helper(n - 1) + 1
```

and:

```python
class Solution:
    def solve(self, n):
        def helper(k):
            if k == 0:
                return 1
            return helper(k - 1)
        return helper(n)
```

Also same-name nested helpers in separate lexical parents.

Assert runtime frame entries map to the correct static `functionId`.

- [ ] **Step 2: Prefer compiled code-object registry over name heuristics**

After final compile, recursively walk `types.CodeType.co_consts` and build a registry.

Use stable code metadata such as:

```text
co_name
co_qualname (when available)
co_firstlineno
lexical code-object nesting
```

Match against FunctionDescriptor lexical qualified identity and original line metadata.

Do not use just:

```python
descriptor.name == frame.f_code.co_name
```

If exact mapping cannot be proven, return `None`.

- [ ] **Step 3: Handle LeetCode class methods**

Confirm code-object qualified names for:

```text
Solution.solve
Solution.helper
```

Map method frames without using the runtime `self.__class__` as the primary identity mechanism.

Dynamic monkey patching is out of scope.

- [ ] **Step 4: Handle nested functions**

Confirm nested code objects preserve enough lexical metadata.

Expected factual mapping:

```text
Solution.solve.<locals>.helper
```

or equivalent platform-specific `co_qualname`.

Normalize only known deterministic formatting differences.

Do not guess across multiple compatible descriptors.

- [ ] **Step 5: Fail closed on ambiguity**

If two descriptors still match:

```text
functionId = undefined
```

Runtime frame occurrence remains valid.

Add a regression test that deliberate ambiguity does not choose arbitrarily.

- [ ] **Step 6: Verify**

```bash
python3 -m unittest tests/fixtures/python/test_function_planner.py
npm test -- tests/core/call-frame-e2e.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worker/python/function_planner.py src/worker/python/runner.py tests/fixtures/python/test_function_planner.py tests/core/call-frame-e2e.test.ts
git commit -m "fix: map instrumented frames to static functions"
```

---

## Task 9: End-to-End Recursion / Frame Evidence Validation

**Files:**
- Create/Modify: `tests/core/call-frame-e2e.test.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/execution/trace-session-collector.test.ts`

**Goal:** Validate the entire source -> Pyodide -> tracer -> stream -> session -> interpreter pipeline.

- [ ] **Step 1: Direct recursion**

Use:

```python
class Solution:
    def solve(self, n):
        return self.depth(n)

    def depth(self, n):
        if n <= 0:
            return 0
        return self.depth(n - 1) + 1
```

Assert factual hierarchy:

```text
solve
└─ depth(3)
   └─ depth(2)
      └─ depth(1)
         └─ depth(0)
```

Assert:

- each occurrence has unique frameId;
- all depth calls map to one static functionId;
- recursive depth increases 1,2,3,4 for the depth-chain definition;
- return values are 0,1,2,3 as captured;
- raw events are unchanged in order.

- [ ] **Step 2: Binary-tree recursion**

Use a standard TreeNode max-depth style solution and LeetCode level-order testcase.

Assert:

- TreeNode argument snapshots survive through existing ValueSnapshot/reference serialization;
- parent/child call hierarchy is factual;
- Tree visualization-related existing tests remain unaffected;
- no DFS semantic label is introduced.

- [ ] **Step 3: Mutual recursion**

Use:

```python
def even(n):
    if n == 0:
        return True
    return odd(n - 1)

def odd(n):
    if n == 0:
        return False
    return even(n - 1)
```

Adapt through the LeetCode entrypoint wrapper as needed.

Assert repeated static identity in ancestry is detected and cycle identities are factual.

- [ ] **Step 4: Sequential same-function siblings**

Use two calls to the same helper after the first returns.

Assert:

- two separate child frames;
- neither second call nor first call is marked recursive solely because functionId repeats elsewhere in history.

- [ ] **Step 5: Handled exception**

Use:

```python
def helper(x):
    try:
        1 // x
    except ZeroDivisionError:
        return 7
```

Assert raw `exception` event exists but frame exit is `returned(7)`.

- [ ] **Step 6: Propagated exception**

Use nested helpers where deepest frame raises.

Assert every actually unwound user frame gets factual exception exit and the top session exception remains unchanged.

- [ ] **Step 7: Loop / Decision / Expression inside recursive frames**

Use recursive function containing:

```text
if condition
for loop
assignment expression
recursive child call
```

Assert each existing evidence item is indexed to the correct frame and nested loop occurrences do not leak between recursive invocations of the same static function.

- [ ] **Step 8: Trace-limit prefix**

Set small `maxTraceSteps`.

Assert:

- already entered frames exist;
- finalized frames keep factual exits;
- still-open frames become `trace_ended`;
- session status remains `trace_limit`;
- no fabricated return value.

- [ ] **Step 9: Hard timeout prefix**

Use a recursive/nonterminating executable case compatible with current hard-timeout test harness.

Assert:

- streamed frame prefix survives;
- interpreter marks open occurrences `trace_ended` using `hard_timeout`;
- no claim of infinite recursion or missing base case.

- [ ] **Step 10: Independent Call-Frame truncation**

Set very small `maxCallFrameEvents` while keeping raw trace limit large.

Assert:

- `callFrameTracing.status === "truncated"`;
- raw execution can complete;
- existing Expression/Decision/Control-Flow evidence continues;
- no unrecorded later frames are fabricated.

- [ ] **Step 11: Run focused E2E**

```bash
npm test -- tests/core/call-frame-e2e.test.ts tests/execution/pyodide-runtime.test.ts tests/execution/trace-session-collector.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add tests/core/call-frame-e2e.test.ts tests/execution/pyodide-runtime.test.ts tests/execution/trace-session-collector.test.ts
git commit -m "test: validate call frame evidence end to end"
```

---

## Task 10: Full Regression Gate and Foundation Documentation

**Files:**
- Modify only if needed: `docs/superpowers/specs/2026-09-19-recursion-call-frame-evidence-foundation-design.md`
- Modify only if actual implementation contract changed: this plan
- Do **not** add user-facing README feature claims yet.

- [ ] **Step 1: Run all Python fixture tests**

Use the repository's established Python fixture invocation. At minimum:

```bash
python3 -m unittest discover -s tests/fixtures/python -p 'test_*.py'
```

Expected: PASS.

- [ ] **Step 2: Run full TypeScript tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run production build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Verify no user-facing UI drift**

Manually / DOM-regression verify:

```text
existing Call Stack still renders
Execution Story still renders existing Control-Flow evidence
Decision Evidence unchanged
Expression Evidence unchanged
Visual State unchanged
Failure-First unchanged
Behavioral Timeline unchanged
raw Previous / Next / Play unchanged
```

No new call-tree panel is expected.

- [ ] **Step 6: Check evidence boundaries**

Search implementation/user-visible strings for prohibited claims such as:

```text
wrong recursive call
missing base case
should return
should recurse
infinite recursion
backtracking mistake
root cause
fix
expected call
```

The foundation may use internal test names like `nonterminating`, but exported evidence/UI copy must remain factual.

- [ ] **Step 7: Record implementation completion in docs**

If all gates pass, append a concise implementation status section to the spec:

```text
Implemented:
- static FunctionPlan
- runtime FrameOccurrence evidence
- return/exception/trace-ended exits
- direct/mutual recursion facts
- frame tree / cursor context
- frame-scoped evidence index
- Pyodide E2E validation

Deferred:
- call-tree UI
- recursion Execution Story
- backtracking semantic evidence
- cross-run call-tree diff
```

Only document contracts that actually landed.

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "docs: record call frame foundation completion"
```

Skip the commit if no documentation changed.

---

# Implementation Order Summary

The dependency order is intentional:

```text
Task 1  Shared protocol / schema v6
   ↓
Task 2  Static FunctionPlan
   ↓
Task 3  CallFrameRecorder
   ↓
Task 4  Authoritative tracer integration
   ↓
Task 5  Worker / session streaming
   ↓
Task 6  TypeScript FrameOccurrence interpreter
   ↓
Task 7  Frame-scoped evidence index
   ↓
Task 8  Final compiled-code identity hardening
   ↓
Task 9  End-to-end recursion validation
   ↓
Task 10 Full regression gate
```

Tasks 2 and 3 may be developed in parallel after Task 1, but Task 4 must not merge until both contracts are stable.

---

# Planned Commit Sequence

Recommended commits:

```text
feat: define call frame evidence protocol
feat: plan user function identities
feat: record call frame evidence
feat: connect frame evidence to tracer
feat: stream call frame evidence
feat: interpret call frame hierarchy
feat: index runtime evidence by frame
fix: map instrumented frames to static functions
test: validate call frame evidence end to end
docs: record call frame foundation completion
```

Each commit should pass the focused tests listed in its task.

---

# Foundation Definition of Done

The implementation is complete only when all of the following are true:

1. trace schema is v6 and older sessions remain structurally usable;
2. `FunctionPlan` deterministically distinguishes top-level functions, methods, and supported nested functions;
3. runtime user frames receive stable `frameId` occurrences from the existing tracer;
4. parent/child relationships preserve runtime order;
5. arguments are captured from callee post-binding locals without re-evaluation;
6. normal `return None` is distinguishable from exception unwinding;
7. handled exceptions do not incorrectly terminate a frame as exception;
8. propagated exceptions produce factual frame exception exits;
9. active frames at trace/timeout termination become `trace_ended`;
10. repeated sibling calls remain distinct and are not falsely classified as recursion;
11. direct recursion is detected from repeated static identity in active ancestry;
12. mutual recursion is supported when static function mapping is available;
13. function-name equality alone never establishes recursion;
14. synthetic/runtime frames do not pollute the user frame hierarchy;
15. Call-Frame Evidence truncates independently from raw execution and other evidence channels;
16. streamed frame prefixes survive hard timeout;
17. TypeScript builds deterministic frame roots, children, exits, ancestry, and cursor context;
18. existing Decision / Control-Flow / Expression / Mutation evidence can be queried by frame without changing evidence ownership;
19. recursive invocations of the same static function keep loop/decision/expression evidence separated by frameId;
20. no call-tree UI or backtracking semantic inference is introduced;
21. all Python fixture tests pass;
22. all Vitest tests pass;
23. `npm run typecheck` passes;
24. `npm run build` passes.

At that point, the runtime hierarchy is ready for the next separate milestone:

```text
Program Run
└─ Frame Occurrence
   ├─ Child Frame Occurrence
   ├─ Loop Occurrence
   │  ├─ Decision Occurrence
   │  └─ Transfer Evidence
   ├─ Expression Evidence
   ├─ Runtime Mutation
   └─ Behavioral Evidence
```

The next feature phase should consume this foundation rather than bypass it: **Recursion / Call-Frame Execution Story UI**.

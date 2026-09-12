# Expression Tracing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add factual expression-level runtime evidence for supported assignment RHS and return expressions, including nested operand/result trees, safe built-in `min` / `max` selection evidence, step-aligned streaming, and List / Matrix overlays without changing existing runtime-state or mutation authority.

**Architecture:** Keep `sys.settrace` as the authoritative line/state channel and add a separate AST-instrumented expression channel. Python captures static `ExpressionPlan` metadata plus runtime `ExpressionBatch` occurrences; the worker streams the plan once and batches incrementally, the session collector persists them into trace schema v3, and a TypeScript interpreter reconstructs renderer-ready evidence keyed by raw trace `step`. Existing structure visualizers only receive already-resolved expression references; they never infer expression semantics.

**Tech Stack:** TypeScript 5.8, Vitest 3.2, Pyodide 0.29.3, Python `ast`, Chrome MV3 Web Worker, JSDOM.

**Spec:** `docs/superpowers/specs/2026-09-12-expression-tracing-foundation-design.md`

## Global Constraints

- Preserve the product rule: **visualize what the program actually did**; do not infer correctness, intended recurrence, algorithm class, root cause, or fixes.
- v0.1 root boundary is exactly **assignment RHS + return expression**.
- v0.1 supports `Name`, literal, `Subscript`, `Attribute`, unary, binary arithmetic, and call-result evidence; comparison, boolean short-circuit, branch outcomes, comprehensions, generators, lambda bodies, and conditional expressions are out of scope.
- Every original user expression must execute at most once; never re-evaluate source text or replay side effects for tracing.
- `TraceEvent`, `RuntimeMutation`, and `ExpressionEvidence` remain separate evidence channels.
- Expression evidence aligns to the line execution that produced it with `anchorStep + frameId`.
- `min` / `max` selected-operand evidence is fail-closed: only actual built-ins, positional multi-candidate calls, and safely comparable primitive snapshots may resolve a selected candidate.
- Expression instrumentation is fail-open: unsupported or failed expression instrumentation must not prevent ordinary compile/execution/line tracing when the original source itself is valid.
- Expression budgets are soft limits: exhausting `maxExpressionEvents` or `maxExpressionBytes` marks expression tracing truncated but must not terminate ordinary tracing.
- Timeout / TLE-like worker termination must preserve any already streamed `ExpressionPlan` and `ExpressionBatch` data.
- Trace schema advances from v2 to **v3**; older traces without expression fields remain valid and render with no expression evidence.
- Full regression gates remain `npm test`, `npm run typecheck`, and `npm run build`.

---

## File Structure

Create focused files rather than folding the new subsystem into existing large modules:

```text
src/shared/expression-types.ts
    Shared static plan, runtime batch, tracing-status, renderer-evidence and
    structure-reference contracts.

src/worker/python/expression_instrumenter.py
    Parse original AST, choose supported roots, assign stable IDs/source spans,
    and produce an instrumented AST plus serializable ExpressionPlan.

src/worker/python/expression_recorder.py
    Runtime value recording, per-anchor batching, soft expression limits,
    built-in min/max selection evidence, and best-effort batch streaming.

src/core/expression-interpreter.ts
    Join ExpressionPlan + ExpressionBatch into per-step evidence trees.

src/core/expression-structure-projection.ts
    Resolve supported List / Matrix operand and assignment-target coordinates
    from expression evidence plus the anchored RuntimeState.

src/sidepanel/components/ExpressionEvidence.ts
    Render the persistent Expression Evidence panel for the current trace step.
```

Existing files change only at their established integration seams: shared protocol/types, runner/tracer, Pyodide bridge, session collector/controller, trace interpreter, visual models/renderers, and sidepanel styles.

---

### Task 1: Define Trace Schema v3 and Expression Protocol Contracts

**Files:**
- Create: `src/shared/expression-types.ts`
- Modify: `src/shared/trace-types.ts`
- Modify: `src/shared/execution-types.ts`
- Modify: `src/shared/worker-protocol.ts`
- Modify: `tests/protocol/worker-protocol.test.ts`
- Modify: `tests/execution/execution-request.test.ts`

**Interfaces:**
- Produces shared contracts used by every later task.
- `ExpressionBatch.batchId` is required so streamed and terminal copies can be de-duplicated deterministically.
- `expression_plan` is a separate streamed worker message because hard timeout may kill the worker before a terminal result exists.

- [ ] **Step 1: Write failing protocol tests for v3 messages and limits**

Add tests that require the worker validator to accept both expression message kinds and reject malformed payloads:

```ts
expect(isWorkerOutboundMessage({
  type: "expression_plan",
  sessionId: "s1",
  plan: {
    version: 1,
    roots: [],
    expressions: []
  }
})).toBe(true);

expect(isWorkerOutboundMessage({
  type: "expression_batch",
  sessionId: "s1",
  batches: [{
    batchId: 1,
    anchorStep: 4,
    frameId: 2,
    line: 9,
    roots: []
  }]
})).toBe(true);
```

Extend execution-limit expectations so request fixtures include:

```ts
maxExpressionEvents: 20_000,
maxExpressionBytes: 2_000_000
```

Run:

```bash
npm test -- tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
```

Expected: FAIL because expression message types and limits do not exist yet.

- [ ] **Step 2: Add shared expression contracts**

Create `src/shared/expression-types.ts` with the exact public shape below:

```ts
import type { ValueSnapshot } from "./trace-types";

export interface SourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export type ExpressionKind =
  | "name"
  | "literal"
  | "subscript"
  | "attribute"
  | "unary"
  | "binary"
  | "call";

export type StaticStructureHint =
  | {
      kind: "list_index";
      variableName: string;
      indexExprId: string;
    }
  | {
      kind: "matrix_cell";
      variableName: string;
      rowExprId: string;
      columnExprId: string;
    };

export interface ExpressionDescriptor {
  exprId: string;
  rootId: string;
  parentExprId: string | null;
  kind: ExpressionKind;
  span: SourceSpan;
  source: string;
  childExprIds: string[];
  structureHint?: StaticStructureHint;
}

export interface AssignmentTargetDescriptor {
  source: string;
  span: SourceSpan;
  structureHint?:
    | { kind: "list_index"; variableName: string; indexSource: string }
    | {
        kind: "matrix_cell";
        variableName: string;
        rowSource: string;
        columnSource: string;
      };
}

export type ExpressionRootDescriptor =
  | {
      rootId: string;
      kind: "assignment";
      expressionExprId: string;
      target: AssignmentTargetDescriptor;
      span: SourceSpan;
    }
  | {
      rootId: string;
      kind: "return";
      expressionExprId: string;
      span: SourceSpan;
    };

export interface ExpressionPlan {
  version: 1;
  roots: ExpressionRootDescriptor[];
  expressions: ExpressionDescriptor[];
}

export interface ExpressionEvaluation {
  evaluationId: number;
  exprId: string;
  order: number;
  value: ValueSnapshot;
}

export interface SelectionEvidence {
  callExprId: string;
  function: "min" | "max";
  candidateExprIds: string[];
  result: ValueSnapshot;
  selectedCandidateIndex: number | null;
  status:
    | "resolved"
    | "unsupported_call_shape"
    | "unsupported_value"
    | "ambiguous";
}

export interface ExpressionRootEvaluation {
  rootId: string;
  status: "completed" | "partial";
  evaluations: ExpressionEvaluation[];
  resultExprId?: string;
  selectionEvidence?: SelectionEvidence[];
}

export interface ExpressionBatch {
  batchId: number;
  anchorStep: number;
  frameId: number;
  line: number;
  roots: ExpressionRootEvaluation[];
}

export interface ExpressionTracingState {
  status: "complete" | "truncated" | "unavailable";
  reason?: string;
}

export type StructureOperandReference =
  | {
      exprId: string;
      variableName: string;
      kind: "list_index";
      index: number;
      rawIndex: number;
      role: "operand" | "selected_operand" | "assignment_target";
    }
  | {
      exprId: string;
      variableName: string;
      kind: "matrix_cell";
      row: number;
      column: number;
      rawRow: number;
      rawColumn: number;
      role: "operand" | "selected_operand" | "assignment_target";
    };
```

`StaticStructureHint` is static AST metadata only; it is not runtime truth.

- [ ] **Step 3: Advance trace and execution contracts**

In `src/shared/trace-types.ts`:

```ts
export const TRACE_SCHEMA_VERSION = 3;
```

Add optional v3 fields to `TraceSession`:

```ts
expressionPlan?: ExpressionPlan;
expressionBatches?: ExpressionBatch[];
expressionTracing?: ExpressionTracingState;
```

In `src/shared/execution-types.ts`, extend `ExecutionLimits` and defaults:

```ts
maxExpressionEvents: number;
maxExpressionBytes: number;
```

with defaults:

```ts
maxExpressionEvents: 20_000,
maxExpressionBytes: 2_000_000
```

Extend `ExecutionTerminalResult` with the same optional expression plan/batches/status fields so a normally completed Python run can provide a terminal copy.

- [ ] **Step 4: Add worker side-channel message types and validation**

Extend `WorkerOutboundMessage`:

```ts
| { type: "expression_plan"; sessionId: string; plan: ExpressionPlan }
| { type: "expression_batch"; sessionId: string; batches: ExpressionBatch[] }
```

Add structural validators that require integer `batchId`, `anchorStep`, `frameId`, `line`, arrays for roots/expressions, and `plan.version === 1`. Do not silently accept malformed expression messages.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npm test -- tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/expression-types.ts src/shared/trace-types.ts src/shared/execution-types.ts src/shared/worker-protocol.ts tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
git commit -m "feat: define expression tracing protocol"
```

---

### Task 2: Build the Static Expression Planner and Semantics-Preserving AST Instrumenter

**Files:**
- Create: `src/worker/python/expression_instrumenter.py`
- Modify: `src/worker/pyodide-runtime.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`

**Interfaces:**
- Produces Python function:

```python
instrument_expression_roots(source_code) -> InstrumentationResult
```

where `InstrumentationResult` exposes:

```python
.instrumented_tree
.plan_dict
.available
.reason
```

- Stable IDs use root ordinal + AST child path generated from the original AST before rewrite.
- Each supported `Subscript` descriptor may carry a static List/Matrix structure hint so the TypeScript projection layer never parses source text to discover a container.

- [ ] **Step 1: Write failing build-script and normalization tests**

Extend `tests/execution/pyodide-runtime.test.ts` so `buildExecutionScript(request)` must load a dedicated module before the runner:

```ts
expect(script).toContain("leetcode-expression-instrumenter");
expect(script).toContain('sys.modules["expression_instrumenter"]');
expect(script).toContain("max_expression_events");
expect(script).toContain("max_expression_bytes");
```

Run:

```bash
npm test -- tests/execution/pyodide-runtime.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement root discovery and fail-closed shape validation**

Create `src/worker/python/expression_instrumenter.py` using `ast.NodeTransformer` plus a separate original-tree metadata walk.

Root selection rules:

```python
# accepted roots
x = a + b
arr[i] = value
return dp[-1]

# rejected roots when unsupported nodes occur anywhere inside RHS/return
x = a < b
x = a and b
x = [n * 2 for n in nums]
return a if cond else b
```

Supported expression node classes for a root are exactly:

```python
ast.Name        # Load only
ast.Constant
ast.Subscript
ast.Attribute
ast.UnaryOp
ast.BinOp
ast.Call
```

Allow structural helper nodes needed by those expressions, such as `ast.Load`, operators, and call keyword containers, but do not emit expression descriptors for them.

- [ ] **Step 3: Generate stable metadata from the original AST**

For every supported expression node, capture:

```python
{
    "exprId": "r3.0.1",
    "rootId": "r3",
    "parentExprId": "r3.0",
    "kind": "subscript",
    "span": {
        "line": node.lineno,
        "column": node.col_offset,
        "endLine": node.end_lineno,
        "endColumn": node.end_col_offset,
    },
    "source": ast.get_source_segment(source_code, node),
    "childExprIds": [...],
}
```

Recognize static structure hints without evaluating expressions:

```python
arr[index_expr]
# -> {kind:"list_index", variableName:"arr", indexExprId:<id>}

dp[row_expr][column_expr]
# -> {kind:"matrix_cell", variableName:"dp", rowExprId:<id>, columnExprId:<id>}
```

For assignment targets, store source/span and only emit target hints for direct Name-rooted list/matrix subscripts.

- [ ] **Step 4: Rewrite supported Load expressions with value-preserving probes**

Wrap supported value expressions using a helper call that preserves source locations:

```python
__lc_expr_record(root_id, expr_id, original_expression)
```

Use `ast.copy_location` on replacement nodes and `ast.fix_missing_locations` after transformation.

Do not wrap Store-context target nodes as value expressions.

For direct positional `min(...)` / `max(...)` calls whose callee is an `ast.Name` and whose call contains no starred args and no keywords, route the call through:

```python
__lc_minmax_call(root_id, call_expr_id, function_object, candidate_expr_ids, candidate_values)
```

The helper receives the already evaluated runtime callable object and candidate values in Python evaluation order; it invokes the callable exactly once.

All other generic calls retain normal Python call semantics and are only wrapped at the final call-result level after their supported child expressions are instrumented.

- [ ] **Step 5: Make unsupported instrumentation fail open**

`instrument_expression_roots()` must return the original parsed tree plus:

```python
available = False
reason = "unsupported_expression_shape"  # or an internal instrumentation reason
plan_dict = {"version": 1, "roots": [], "expressions": []}
```

when no safe supported roots exist or instrumentation itself cannot be constructed. Original `SyntaxError` remains a parse error and is not converted into instrumentation unavailability.

- [ ] **Step 6: Load the instrumenter in the Pyodide execution script**

Import the raw module in `src/worker/pyodide-runtime.ts`, register it as `expression_instrumenter`, and pass the new expression limits into `run_request`:

```python
"max_expression_events": request.limits.maxExpressionEvents,
"max_expression_bytes": request.limits.maxExpressionBytes,
```

- [ ] **Step 7: Run focused tests and typecheck**

```bash
npm test -- tests/execution/pyodide-runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/worker/python/expression_instrumenter.py src/worker/pyodide-runtime.ts tests/execution/pyodide-runtime.test.ts
git commit -m "feat: instrument expression roots"
```

---

### Task 3: Capture Runtime Expression Evidence Without Changing User Semantics

**Files:**
- Create: `src/worker/python/expression_recorder.py`
- Modify: `src/worker/python/tracer.py`
- Modify: `src/worker/python/runner.py`
- Modify: `src/worker/pyodide-runtime.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`

**Interfaces:**
- `ExpressionRecorder` consumes `ValueSerializer`, soft limits, and an optional streaming callback.
- `TraceCollector` exposes line anchors to the recorder and flushes the previous anchor before a new user event closes that execution segment.
- Python helper functions injected into the user namespace are named with the existing `__lc_` prefix so Locals UI stays clean.

- [ ] **Step 1: Write failing runtime normalization tests for plan, batches, partial roots, and selection**

Extend `tests/execution/pyodide-runtime.test.ts` with a fake Python terminal result containing:

```ts
expression_plan: {
  version: 1,
  roots: [{
    rootId: "r1",
    kind: "assignment",
    expressionExprId: "r1.0",
    target: {
      source: "x",
      span: { line: 3, column: 8, endLine: 3, endColumn: 9 }
    },
    span: { line: 3, column: 8, endLine: 3, endColumn: 13 }
  }],
  expressions: []
},
expression_batches: [{
  batchId: 1,
  anchor_step: 4,
  frame_id: 2,
  line: 3,
  roots: [{
    root_id: "r1",
    status: "completed",
    evaluations: [{
      evaluation_id: 1,
      expr_id: "r1.0",
      order: 1,
      value: { type: "int", value: "11" }
    }],
    result_expr_id: "r1.0"
  }]
}],
expression_tracing: { status: "complete" }
```

Assert that `normalizePythonExecutionResult` produces camelCase typed equivalents.

Run:

```bash
npm test -- tests/execution/pyodide-runtime.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement `ExpressionRecorder` with soft limits**

Create `src/worker/python/expression_recorder.py` with state equivalent to:

```python
class ExpressionRecorder:
    def __init__(self, limits, serializer_factory, session_id="session", emit_batch=None):
        self.active_anchors = {}          # frame_id -> {step,line}
        self.pending_roots = {}           # (frame_id, step, root_id) -> root evidence
        self.completed_batches = []
        self.next_evaluation_id = 1
        self.next_batch_id = 1
        self.expression_event_count = 0
        self.expression_bytes = 0
        self.status = "complete"
        self.reason = None
```

Required methods:

```python
set_anchor(frame_id, step, line)
record_value(root_id, expr_id, value) -> value
record_minmax_call(root_id, call_expr_id, function_obj, candidate_expr_ids, candidate_values)
flush_frame(frame_id)
flush_all()
result_dict()
```

When either soft limit is exceeded, set:

```python
status = "truncated"
reason = "expression_event_limit"  # or expression_byte_limit
```

and make further recording a no-op while still returning original values/call results.

- [ ] **Step 3: Preserve ordinary expression semantics in runtime helpers**

`record_value()` must serialize/record and then return the exact original Python value object.

`record_minmax_call()` must:

```python
result = function_obj(*candidate_values)
```

exactly once, then record call result and optional selection evidence.

Selection eligibility requires:

```python
function_obj is builtins.min or function_obj is builtins.max
len(candidate_values) >= 2
all candidates + result serialize to eligible primitive snapshots
```

Eligible selection snapshots are:

```text
int
bool
str
finite float
```

`NaN`, infinities, custom objects, containers, unknown values, and unsupported call shape return `selectedCandidateIndex = null` with a non-`resolved` status.

Duplicate winners use the first matching positional candidate.

- [ ] **Step 4: Anchor expression batches to the existing user trace**

Modify `TraceCollector` so `_record()` returns the raw `step` it created.

In `trace()`:

1. before a new `line`, `return`, or `exception` event closes a previous execution segment for the frame, call `expression_recorder.flush_frame(frame_id)`;
2. record the trace event normally;
3. after a `line` event is recorded, call `expression_recorder.set_anchor(frame_id, step, frame.f_lineno)`.

This gives expression probes executed after the line event a stable `anchorStep` without creating fake trace steps.

- [ ] **Step 5: Wire instrumented compilation and helper injection in `runner.py`**

Replace direct compilation of `source_code` with:

```python
instrumentation = instrument_expression_roots(source_code)
code_tree = instrumentation.instrumented_tree if instrumentation.available else ast.parse(
    source_code,
    filename=USER_CODE_FILENAME,
    mode="exec",
)
user_code = compile(code_tree, USER_CODE_FILENAME, "exec")
```

Create one `ExpressionRecorder`, connect it to the `TraceCollector`, and inject:

```python
namespace["__lc_expr_record"] = recorder.record_value
namespace["__lc_minmax_call"] = recorder.record_minmax_call
```

before `exec(user_code, namespace, namespace)`.

Ensure the tracer's existing `__lc_*` local filter continues to hide helpers.

- [ ] **Step 6: Preserve partial evidence on exceptions**

On runtime exception, trace limit, normal completion, and runner teardown, call:

```python
recorder.flush_all()
```

before constructing the terminal result.

A root with child evaluations but no root result must serialize as:

```text
status = partial
resultExprId omitted
```

The original user exception remains unchanged in the terminal result.

- [ ] **Step 7: Normalize Python expression result fields in TypeScript**

In `src/worker/pyodide-runtime.ts`, add dedicated normalizers:

```ts
normalizeExpressionPlan(value: unknown): ExpressionPlan | undefined
normalizeExpressionBatch(value: unknown): ExpressionBatch | null
normalizeExpressionTracingState(value: unknown): ExpressionTracingState | undefined
```

Do not reuse loose object casts. Normalize snake_case Python fields to camelCase TypeScript fields exactly once at this boundary.

- [ ] **Step 8: Run focused tests and typecheck**

```bash
npm test -- tests/execution/pyodide-runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/worker/python/expression_recorder.py src/worker/python/tracer.py src/worker/python/runner.py src/worker/pyodide-runtime.ts tests/execution/pyodide-runtime.test.ts
git commit -m "feat: capture runtime expression evidence"
```

---

### Task 4: Stream Expression Plan and Batches Through the Worker and Preserve Them on Timeout

**Files:**
- Modify: `src/worker/python/runner.py`
- Modify: `src/worker/pyodide-runtime.ts`
- Modify: `src/worker/pyodide-worker.ts`
- Modify: `src/execution/trace-session-collector.ts`
- Modify: `src/execution/execution-controller.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/execution/pyodide-worker.test.ts`
- Modify: `tests/execution/trace-session-collector.test.ts`
- Modify: `tests/execution/execution-controller.test.ts`

**Interfaces:**
- Pyodide runtime options gain:

```ts
onExpressionPlan?: (sessionId: string, plan: ExpressionPlan) => void;
onExpressionBatch?: (sessionId: string, batches: ExpressionBatch[]) => void;
```

- `TraceSessionCollector` gains:

```ts
setExpressionPlan(plan: ExpressionPlan): void;
appendExpressionBatches(batches: ExpressionBatch[]): void;
setExpressionTracingState(state: ExpressionTracingState): void;
```

- Collector de-duplicates batches by `batchId`.

- [ ] **Step 1: Write failing timeout-survival tests**

In `tests/execution/trace-session-collector.test.ts`, construct a collector, call:

```ts
collector.setExpressionPlan(plan);
collector.appendExpressionBatches([batch]);
const session = collector.forceTimeout();
```

Assert:

```ts
expect(session.status).toBe("timeout");
expect(session.expressionPlan).toEqual(plan);
expect(session.expressionBatches).toEqual([batch]);
```

Also append the same `batchId` twice and assert it appears once.

In `tests/execution/execution-controller.test.ts`, emit `expression_plan` and `expression_batch` messages before advancing the fake timer to hard timeout; assert the resolved session retains both.

Run:

```bash
npm test -- tests/execution/trace-session-collector.test.ts tests/execution/execution-controller.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Stream the plan before user-code execution begins**

Add a Pyodide global callback:

```text
__lc_emit_expression_plan
```

`runner.py` emits the serializable plan immediately after successful instrumentation and before executing user code.

This callback is best effort. Failure to stream the plan must not stop execution.

- [ ] **Step 3: Stream completed expression batches incrementally**

Add a second callback:

```text
__lc_emit_expression_batch
```

`ExpressionRecorder.flush_frame()` serializes completed batches and calls the callback with compact JSON.

Keep expression streaming independent from the existing `TRACE_BATCH_MAX_BYTES` trace stream; malformed optional expression JSON must be ignored at the TS bridge rather than failing user execution.

- [ ] **Step 4: Install and remove both callbacks in `createPyodideRuntime()`**

Add runtime callbacks and globals only when corresponding options are present:

```ts
pyodide.globals.set("__lc_emit_expression_plan", emitExpressionPlan);
pyodide.globals.set("__lc_emit_expression_batch", emitExpressionBatch);
```

Remove them in `finally` exactly like `__lc_emit_trace_batch`.

If no expression batches streamed during the run but terminal normalized results contain batches, forward them once after completion as a fallback.

- [ ] **Step 5: Forward expression messages from `pyodide-worker.ts`**

Map runtime callbacks to protocol messages:

```ts
onExpressionPlan: (sessionId, plan) => {
  scope.postMessage({ type: "expression_plan", sessionId, plan });
},
onExpressionBatch: (sessionId, batches) => {
  scope.postMessage({ type: "expression_batch", sessionId, batches });
}
```

Add worker tests that verify plan arrives before batch and both arrive before `execution_finished` when the fake runtime emits them in that order.

- [ ] **Step 6: Persist expression stream in `TraceSessionCollector`**

Store:

```ts
private expressionPlan: ExpressionPlan | undefined;
private readonly expressionBatches: ExpressionBatch[] = [];
private readonly expressionBatchIds = new Set<number>();
private expressionTracing: ExpressionTracingState | undefined;
```

`appendExpressionBatches()` ignores duplicate batch IDs and respects `maxExpressionBytes` without setting the existing `resourceLimitReached` flag. If the expression budget is exceeded, set only:

```ts
{ status: "truncated", reason: "expression_byte_limit" }
```

and stop accepting further expression batches.

`createSession()` copies plan/batches/status into the v3 `TraceSession`.

- [ ] **Step 7: Route expression protocol messages in `ExecutionController`**

Add cases before terminal handling:

```ts
if (message.type === "expression_plan") {
  if (message.sessionId === request.sessionId) {
    collector.setExpressionPlan(message.plan);
  }
  return;
}

if (message.type === "expression_batch") {
  if (message.sessionId === request.sessionId) {
    collector.appendExpressionBatches(message.batches);
  }
  return;
}
```

On `execution_finished`, merge any terminal plan/batches/status into the collector before `finish()` so missing stream data is recovered and duplicate `batchId`s remain de-duplicated.

- [ ] **Step 8: Run focused execution tests**

```bash
npm test -- tests/execution/pyodide-runtime.test.ts tests/execution/pyodide-worker.test.ts tests/execution/trace-session-collector.test.ts tests/execution/execution-controller.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/worker/python/runner.py src/worker/pyodide-runtime.ts src/worker/pyodide-worker.ts src/execution/trace-session-collector.ts src/execution/execution-controller.ts tests/execution/pyodide-runtime.test.ts tests/execution/pyodide-worker.test.ts tests/execution/trace-session-collector.test.ts tests/execution/execution-controller.test.ts
git commit -m "feat: stream expression trace evidence"
```

---

### Task 5: Reconstruct Per-Step Expression Evidence Trees in TypeScript

**Files:**
- Create: `src/core/expression-interpreter.ts`
- Create: `tests/core/expression-interpreter.test.ts`
- Modify: `src/core/trace-interpreter.ts`
- Modify: `tests/core/trace-interpreter.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ExpressionEvidenceNode {
  exprId: string;
  kind: ExpressionKind;
  source: string;
  value?: ValueSnapshot;
  children: ExpressionEvidenceNode[];
}

export interface ExpressionEvidenceRoot {
  rootId: string;
  kind: "assignment" | "return";
  status: "completed" | "partial";
  target?: AssignmentTargetDescriptor;
  tree: ExpressionEvidenceNode;
  selections: SelectionEvidence[];
  structureReferences: StructureOperandReference[];
}

export interface ExpressionStepEvidence {
  anchorStep: number;
  frameId: number;
  roots: ExpressionEvidenceRoot[];
}

export type ExpressionEvidenceByStep = Map<number, ExpressionStepEvidence>;

export function buildExpressionEvidence(
  plan: ExpressionPlan | undefined,
  batches: ExpressionBatch[],
  runtimeStates: RuntimeState[]
): ExpressionEvidenceByStep;
```

- [ ] **Step 1: Write failing tree-reconstruction tests**

In `tests/core/expression-interpreter.test.ts`, build a static plan for:

```python
x = max(dp[i - 1], dp[i - 2] + nums[i])
```

and one completed batch. Assert:

```ts
expect(root.tree.source).toBe("max(dp[i - 1], dp[i - 2] + nums[i])");
expect(root.tree.children).toHaveLength(2);
expect(root.selections[0]?.selectedCandidateIndex).toBe(1);
```

Add a partial-root case with child evaluations but no root-result evaluation and assert `status === "partial"` with no fabricated root value.

Add two batches with the same static `exprId` but different `anchorStep` values and assert they remain separate runtime occurrences.

Run:

```bash
npm test -- tests/core/expression-interpreter.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Build deterministic descriptor indexes**

Inside `buildExpressionEvidence()` create maps once:

```ts
const expressionById = new Map(plan.expressions.map((expression) => [expression.exprId, expression]));
const rootById = new Map(plan.roots.map((root) => [root.rootId, root]));
const runtimeByStep = new Map(runtimeStates.map((state) => [state.step, state]));
```

Unknown `exprId`, unknown `rootId`, or a batch whose `anchorStep` does not exist in captured runtime states must be skipped fail-closed rather than throwing the whole interpretation.

- [ ] **Step 3: Rebuild the visual tree from static parent/child metadata**

For one root occurrence, index runtime evaluations by `exprId` using the last evaluation for that expr within the occurrence and recursively construct children in static `childExprIds` order.

The UI hierarchy comes from AST metadata; `ExpressionEvaluation.order` remains available as factual runtime order but does not reorder the tree.

- [ ] **Step 4: Attach selection evidence without inventing semantics**

Copy only selection evidence already captured by Python. Do not recompute `min` / `max` selection in TypeScript.

Mark selected structure references later by matching `callExprId + candidateExprIds[selectedCandidateIndex]`; if selected index is null, no selected role is produced.

- [ ] **Step 5: Integrate expression evidence into `interpretTrace()`**

Change the signature to accept optional expression inputs without breaking existing callers:

```ts
export function interpretTrace(
  events: TraceEvent[],
  relations: StaticRelation[] = [],
  expressionPlan?: ExpressionPlan,
  expressionBatches: ExpressionBatch[] = []
): TraceInterpretation
```

Add:

```ts
expressionEvidence: ExpressionEvidenceByStep;
```

to `TraceInterpretation`.

Existing tests that call `interpretTrace(events, relations)` must continue to pass with an empty map.

- [ ] **Step 6: Run focused core tests**

```bash
npm test -- tests/core/expression-interpreter.test.ts tests/core/trace-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/expression-interpreter.ts src/core/trace-interpreter.ts tests/core/expression-interpreter.test.ts tests/core/trace-interpreter.test.ts
git commit -m "feat: interpret expression evidence"
```

---

### Task 6: Resolve Safe List / Matrix Structure References and Feed Them Into Visual Models

**Files:**
- Create: `src/core/expression-structure-projection.ts`
- Create: `tests/core/expression-structure-projection.test.ts`
- Modify: `src/core/expression-interpreter.ts`
- Modify: `src/core/visual-model.ts`
- Modify: `src/core/matrix-interpreter.ts`
- Modify: `tests/core/trace-interpreter.test.ts`
- Modify: `tests/core/matrix-interpreter.test.ts`

**Interfaces:**
- Produces:

```ts
export function projectStructureReferences(
  plan: ExpressionPlan,
  root: ExpressionRootDescriptor,
  rootEvaluation: ExpressionRootEvaluation,
  runtime: RuntimeState
): StructureOperandReference[];
```

- `ListVisualModel` and `MatrixVisualModel` gain `expressionReferences: StructureOperandReference[]` filtered to their own `variableName` and structure kind.

- [ ] **Step 1: Write failing projection tests for List, Matrix, negative indices, selected operand, and target**

Cover:

```python
x = nums[i]
dp[i][j] = min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j]
return nums[-1]
```

Assert the projector emits factual coordinates such as:

```ts
{
  exprId: "r1.0.0",
  variableName: "dp",
  kind: "matrix_cell",
  row: 1,
  column: 3,
  rawRow: 1,
  rawColumn: 3,
  role: "operand"
}
```

and normalizes `-1` while preserving `rawIndex: -1`.

Add an unresolved/out-of-bounds case and assert no fake reference is emitted.

Run:

```bash
npm test -- tests/core/expression-structure-projection.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Resolve operand coordinates from captured expression evaluations**

For `StaticStructureHint`:

```text
list_index  → read index expression's captured ValueSnapshot
matrix_cell → read row + column expression snapshots
```

Accept an index only when the snapshot is an integer matching `/^-?\d+$/` and converts to a safe integer.

Use the anchored `RuntimeState` local snapshot to determine current sequence/matrix dimensions for Python negative-index normalization.

Do not parse descriptor `source` to recover coordinates.

- [ ] **Step 3: Mark selected operand roles from captured `SelectionEvidence`**

Start all safe read references as `operand`.

For each resolved selection:

```ts
const selectedExprId = selection.candidateExprIds[selection.selectedCandidateIndex!];
```

upgrade the reference for that expression to `selected_operand`.

If no structure reference corresponds to the selected candidate expression, do nothing rather than climbing descendants and guessing which nested read was causal.

- [ ] **Step 4: Resolve assignment-target coordinates conservatively**

Use only direct static assignment-target hints.

For target index source:

- integer literal: parse directly;
- simple variable name: resolve from the anchored active-frame local snapshot;
- any other target index expression: omit target structure reference in v0.1.

This safely covers the intended `dp[i][j]` and `arr[i]` cases without evaluating target source text.

Use a synthetic target `exprId`:

```text
<rootId>:target
```

for renderer identity.

- [ ] **Step 5: Feed references into existing visual-model construction**

Before building each `VisualState`, obtain:

```ts
const stepEvidence = expressionEvidence.get(runtime.step);
const references = stepEvidence?.roots.flatMap((root) => root.structureReferences) ?? [];
```

Extend `buildVisualState()` with a final optional parameter defaulting to `[]` so older callers/tests remain source-compatible.

Filter references into List and Matrix models by `variableName` and `kind`.

- [ ] **Step 6: Run focused projection and visual-model tests**

```bash
npm test -- tests/core/expression-structure-projection.test.ts tests/core/matrix-interpreter.test.ts tests/core/trace-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/expression-structure-projection.ts src/core/expression-interpreter.ts src/core/visual-model.ts src/core/matrix-interpreter.ts tests/core/expression-structure-projection.test.ts tests/core/matrix-interpreter.test.ts tests/core/trace-interpreter.test.ts
git commit -m "feat: project expression structure references"
```

---

### Task 7: Render a Persistent Expression Evidence Panel

**Files:**
- Create: `src/sidepanel/components/ExpressionEvidence.ts`
- Create: `tests/sidepanel/expression-evidence.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/trace-visualizer.test.ts` if present; otherwise extend the existing TraceVisualizer coverage file returned by `tests/sidepanel/` listing before implementation.

**Interfaces:**
- Produces:

```ts
export function createExpressionEvidence(
  evidence: ExpressionStepEvidence | undefined,
  tracingState: ExpressionTracingState | undefined
): HTMLElement;
```

- Panel remains mounted on every trace step; only body content changes.

- [ ] **Step 1: Write failing DOM tests for completed, partial, selected, empty, and truncated states**

Create `tests/sidepanel/expression-evidence.test.ts` with JSDOM assertions for:

```text
Target: dp[i][j]
Result: 7
selected
partial
No expression evidence for this step.
Expression tracing truncated
```

Use exact `data-*` hooks rather than fragile CSS text matching:

```ts
expect(element.querySelector('[data-expression-root="r1"]')).not.toBeNull();
expect(element.querySelector('[data-expression-selected="true"]')).not.toBeNull();
```

Run:

```bash
npm test -- tests/sidepanel/expression-evidence.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement recursive factual tree rendering**

Render every `ExpressionEvidenceNode` with:

```text
source
=
formatted value, when one exists
```

Use existing `formatValue()` for `ValueSnapshot` formatting.

A partial root with no root value must display an explicit `partial` status; do not show `undefined`, `null`, or a fabricated result.

Selected candidate marking comes only from `SelectionEvidence` already resolved in the interpreter.

- [ ] **Step 3: Integrate the panel into `TraceVisualizer`**

Change the interpretation call to:

```ts
interpretTrace(
  session.events,
  session.subscriptRelations ?? [],
  session.expressionPlan,
  session.expressionBatches ?? []
)
```

Create a persistent details panel:

```ts
const expressionPanel = createPanel(
  "Expression Evidence",
  "trace-viewer__expression-panel"
);
```

On `setStep`, look up by raw event step:

```ts
const evidence = event
  ? interpretation.expressionEvidence.get(event.step)
  : undefined;
```

and replace only the panel body with `createExpressionEvidence(...)`.

The panel must remain present even when `evidence` is undefined.

- [ ] **Step 4: Add restrained factual styles**

In `src/sidepanel/styles.css`, add styles for:

```text
.expression-evidence
.expression-evidence__root
.expression-evidence__node
.expression-evidence__children
.is-selected-operand
.is-partial
```

Do not introduce semantic heatmaps or success/error colors that imply correctness.

- [ ] **Step 5: Run panel tests and typecheck**

```bash
npm test -- tests/sidepanel/expression-evidence.test.ts
npm run typecheck
```

Also run the existing TraceVisualizer-sidepanel test file after locating it in `tests/sidepanel/` before implementation.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/components/ExpressionEvidence.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/expression-evidence.test.ts tests/sidepanel
git commit -m "feat: render expression evidence panel"
```

---

### Task 8: Add Expression Operand / Selected / Target Overlays to List and Matrix Visuals

**Files:**
- Modify: `src/sidepanel/components/ListVisualizer.ts`
- Modify: `src/sidepanel/components/MatrixVisualizer.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/list-visualizer.test.ts`
- Modify: `tests/sidepanel/matrix-visualizer.test.ts`

**Interfaces:**
- Both renderers consume `model.expressionReferences` only.
- They do not inspect `SelectionEvidence`, parse source strings, or infer recurrence semantics.

- [ ] **Step 1: Write failing List overlay tests**

Construct a `ListVisualModel` with references:

```ts
expressionReferences: [
  {
    exprId: "r1.0",
    variableName: "dp",
    kind: "list_index",
    index: 3,
    rawIndex: 3,
    role: "selected_operand"
  },
  {
    exprId: "r1:target",
    variableName: "dp",
    kind: "list_index",
    index: 4,
    rawIndex: 4,
    role: "assignment_target"
  }
]
```

Assert the corresponding list items expose:

```text
data-expression-operand
 data-expression-selected
 data-expression-target
```

only on matching indexes.

- [ ] **Step 2: Write failing Matrix overlay tests**

Construct a `MatrixVisualModel` with an operand at `(1, 3)`, selected operand at `(2, 2)`, and assignment target at `(2, 3)`.

Assert classes/data attributes coexist with existing focus/change state and do not alter cell text values.

Run:

```bash
npm test -- tests/sidepanel/list-visualizer.test.ts tests/sidepanel/matrix-visualizer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Render List reference roles as orthogonal UI state**

For each visible item index, collect matching references and toggle:

```text
is-expression-operand
is-expression-selected
is-expression-target
```

with matching `data-*` attributes.

Do not alter existing pointer, changed-index, inspector, or animation logic.

- [ ] **Step 4: Render Matrix reference roles without changing viewport semantics**

In `renderGrid()` and update paths, find references by row/column and apply the same three orthogonal roles.

Do not auto-pan to expression operands in v0.1. Existing Matrix focus auto-follow remains the only automatic viewport navigation rule.

If an expression reference falls outside the current viewport, it simply is not visible until the user pans/focus changes; do not synthesize a notice or move the viewport.

- [ ] **Step 5: Add visual styles that distinguish roles without implying correctness**

Use borders/markers/labels that visually distinguish:

```text
operand
selected operand
assignment target
```

while keeping `focus`, `changed`, and user inspector selection intact.

- [ ] **Step 6: Run focused visualizer tests**

```bash
npm test -- tests/sidepanel/list-visualizer.test.ts tests/sidepanel/matrix-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/components/ListVisualizer.ts src/sidepanel/components/MatrixVisualizer.ts src/sidepanel/styles.css tests/sidepanel/list-visualizer.test.ts tests/sidepanel/matrix-visualizer.test.ts
git commit -m "feat: overlay expression operands on structures"
```

---

### Task 9: Validate Real DP Execution, Fail-Open Behavior, Backward Compatibility, and Full Regression Gates

**Files:**
- Create: `tests/fixtures/expression-minimum-path-sum.ts` or use the repository's existing fixture convention discovered in `tests/fixtures/` before implementation; keep the fixture source equivalent to the code below.
- Modify: `tests/core/trace-interpreter.test.ts`
- Modify: `tests/execution/trace-session-collector.test.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/sidepanel/expression-evidence.test.ts`
- Modify: `README.md`

**Interfaces:**
- This task adds no new runtime API; it proves the complete protocol against the approved spec.

- [ ] **Step 1: Add the Minimum Path Sum acceptance fixture**

Use this exact runtime shape:

```python
class Solution:
    def minPathSum(self, grid):
        m, n = len(grid), len(grid[0])
        dp = [[0] * n for _ in range(m)]
        for i in range(m):
            for j in range(n):
                if i == 0 and j == 0:
                    dp[i][j] = grid[i][j]
                elif i == 0:
                    dp[i][j] = dp[i][j - 1] + grid[i][j]
                elif j == 0:
                    dp[i][j] = dp[i - 1][j] + grid[i][j]
                else:
                    dp[i][j] = min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j]
        return dp[-1][-1]
```

The integration assertion for an `else` iteration must prove all of these simultaneously:

```text
Expression root = assignment
min(...) has two candidate values
selectedCandidateIndex is factual and resolved for primitive ints
binary + result is captured
assignment target source is dp[i][j]
Matrix structure references contain operand / selected_operand / assignment_target
RuntimeMutation remains independently present for the resulting dp cell change
```

- [ ] **Step 2: Add semantic-preservation regression cases**

Add execution-level coverage for these exact source snippets:

```python
# side effects execute once
x = arr.pop() + arr.pop()

# duplicate min winner follows first positional result match
x = min(3, 3, 5)

# runtime exception preserves partial expression evidence
x = 10 / 0

# shadowed min must not claim built-in selection
min = lambda a, b: a
x = min(7, 2)
```

Assertions:

```text
arr mutates exactly twice, not four times
selectedCandidateIndex = 0 for min(3,3,5)
ZeroDivisionError remains the runtime exception; root is partial
shadowed min has no resolved built-in selection evidence
```

- [ ] **Step 3: Add fail-open unsupported-root regression**

Use:

```python
x = a < b
```

or another v0.1 unsupported root in a normally executable solution and assert:

```text
ordinary trace events still exist
execution completes normally
expression evidence for the unsupported root is absent
expression tracing is unavailable/empty rather than a user runtime error
```

- [ ] **Step 4: Add backward-compatibility coverage for v2-style sessions**

Construct a `TraceSession` object without `expressionPlan`, `expressionBatches`, or `expressionTracing` and verify:

```text
TraceVisualizer still renders
Expression Evidence panel says "No expression evidence for this step."
existing List/Matrix/Behavioral panels still work
```

Do not require rewriting stored v2 data to v3 before rendering.

- [ ] **Step 5: Document the new capability without presenting it as a solver**

Update `README.md` feature description with concise wording equivalent to:

```text
Expression Evidence — for supported assignment and return expressions, inspect
captured operand/intermediate/result values and factual min/max candidate
selection. This visualizes executed computation; it does not infer the correct
algorithm or solution.
```

Mention that comparison / branch evidence remains future work.

- [ ] **Step 6: Run all targeted expression tests**

```bash
npm test -- tests/core/expression-interpreter.test.ts tests/core/expression-structure-projection.test.ts tests/core/trace-interpreter.test.ts tests/execution/pyodide-runtime.test.ts tests/execution/pyodide-worker.test.ts tests/execution/trace-session-collector.test.ts tests/execution/execution-controller.test.ts tests/protocol/worker-protocol.test.ts tests/sidepanel/expression-evidence.test.ts tests/sidepanel/list-visualizer.test.ts tests/sidepanel/matrix-visualizer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run full repository gates**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 8: Review generated behavior against the spec invariants**

Manually inspect the #64-like fixture output and verify:

```text
line trace answers where execution is
runtime state shows the entry-state Matrix/List values
mutation evidence shows what changed
expression panel shows how the value was computed
structure overlays do not overwrite cell/list values
no text claims recurrence correctness or recommends a fix
```

- [ ] **Step 9: Commit**

```bash
git add tests README.md
git commit -m "test: validate expression tracing end to end"
```

---

## Implementation Order and Review Gates

Execute tasks strictly in order:

```text
1. Shared protocol + schema v3
2. Static AST plan + instrumentation
3. Runtime recorder + semantics
4. Streaming + timeout/session persistence
5. TypeScript expression interpretation
6. Structure-reference projection
7. Expression Evidence panel
8. List / Matrix overlays
9. End-to-end acceptance + regressions
```

Do not begin UI work before Task 5's evidence interpreter is stable. Do not add Condition / Decision Tracing (`Compare`, `BoolOp`, branch outcomes) while implementing this plan; that is the next architectural phase and should receive its own spec/plan.

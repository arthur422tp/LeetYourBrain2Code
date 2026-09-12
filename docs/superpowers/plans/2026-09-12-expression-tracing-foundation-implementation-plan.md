# Expression Tracing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add factual expression-level runtime evidence for supported assignment RHS and return expressions, including nested operand/result trees, safe built-in `min` / `max` selection evidence, step-aligned streaming, and List / Matrix overlays without changing existing runtime-state or mutation authority.

**Architecture:** Keep `sys.settrace` as the authoritative line/state channel and add a separate AST-instrumented expression channel. Python captures one static `ExpressionPlan` plus runtime `ExpressionBatch` occurrences; the worker streams the plan once and batches incrementally, the session collector persists them into trace schema v3, and a TypeScript interpreter reconstructs renderer-ready evidence keyed by raw trace `step`. Existing structure visualizers only render already-resolved expression references and never infer expression semantics.

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
- Trace schema advances from v2 to **v3**; older traces without expression fields remain usable.
- Full regression gates remain `npm test`, `npm run typecheck`, and `npm run build`.

---

## File Structure

Create these focused units:

```text
src/shared/expression-types.ts
    Shared static-plan, runtime-batch, tracing-status, interpreted-evidence,
    and structure-reference contracts.

src/worker/python/expression_instrumenter.py
    Original-AST root discovery, stable IDs/source spans, static structure hints,
    and semantics-preserving AST rewriting.

src/worker/python/expression_recorder.py
    Runtime value recording, per-anchor batching, soft limits, min/max selection
    evidence, and best-effort expression-batch streaming.

src/core/expression-interpreter.ts
    ExpressionPlan + ExpressionBatch -> per-trace-step evidence trees.

src/core/expression-structure-projection.ts
    Safe List / Matrix coordinate projection from captured expression evidence.

src/sidepanel/components/ExpressionEvidence.ts
    Persistent Expression Evidence panel for the selected trace step.
```

Existing files change only at established integration seams: shared protocol/types, Python runner/tracer, Pyodide bridge, worker protocol, execution session collection, trace interpretation, visual models/renderers, and sidepanel styles.

---

### Task 1: Define Trace Schema v3 and Shared Expression Contracts

**Files:**
- Create: `src/shared/expression-types.ts`
- Modify: `src/shared/trace-types.ts`
- Modify: `src/shared/execution-types.ts`
- Modify: `src/shared/worker-protocol.ts`
- Modify: `tests/protocol/worker-protocol.test.ts`
- Modify: `tests/execution/execution-request.test.ts`

**Interfaces:**
- Produces all shared contracts consumed by Tasks 2–8.
- `ExpressionBatch.batchId` is required for deterministic stream/terminal de-duplication.
- Worker protocol has separate `expression_plan` and `expression_batch` messages so a hard timeout can preserve both metadata and values.

- [ ] **Step 1: Write failing protocol tests**

Add worker-protocol assertions:

```ts
expect(isWorkerOutboundMessage({
  type: "expression_plan",
  sessionId: "s1",
  plan: { version: 1, roots: [], expressions: [] }
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

Add negative tests for missing `batchId`, non-integer `anchorStep`, and `plan.version !== 1`.

Extend request fixtures with:

```ts
maxExpressionEvents: 20_000,
maxExpressionBytes: 2_000_000
```

Run:

```bash
npm test -- tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
```

Expected: FAIL because the new protocol does not exist yet.

- [ ] **Step 2: Create `src/shared/expression-types.ts`**

Define:

```ts
import type { RuntimeState } from "../core/runtime-state";
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
```

Do **not** import `RuntimeState` here; shared protocol types must not depend on `src/core`. Remove that import if an editor auto-adds it.

- [ ] **Step 3: Extend trace/execution contracts**

In `src/shared/trace-types.ts`:

```ts
export const TRACE_SCHEMA_VERSION = 3;
```

Add optional fields to `TraceSession`:

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

```ts
maxExpressionEvents: 20_000,
maxExpressionBytes: 2_000_000
```

Extend `ExecutionTerminalResult` with optional `expressionPlan`, `expressionBatches`, and `expressionTracing` so normal completion can carry a terminal copy.

- [ ] **Step 4: Extend worker protocol validation**

Add:

```ts
| { type: "expression_plan"; sessionId: string; plan: ExpressionPlan }
| { type: "expression_batch"; sessionId: string; batches: ExpressionBatch[] }
```

Validate nested expression fields structurally rather than accepting untyped object casts.

- [ ] **Step 5: Run focused verification**

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

### Task 2: Build the Static Expression Planner and AST Instrumenter

**Files:**
- Create: `src/worker/python/expression_instrumenter.py`
- Create: `tests/fixtures/python/test_expression_instrumenter.py`
- Modify: `src/worker/pyodide-runtime.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`

**Interfaces:**

Python entrypoint:

```python
instrument_expression_roots(source_code) -> InstrumentationResult
```

`InstrumentationResult` contains:

```python
instrumented_tree
plan_dict
available
reason
```

Stable IDs are generated from the original AST before rewrite using root ordinal + expression-child path.

- [ ] **Step 1: Write failing Python planner tests**

Create `tests/fixtures/python/test_expression_instrumenter.py` using `unittest` and import the module through the same `src/worker/python` path setup used by the existing Python fixture tests.

Required cases:

```python
# accepted
x = a + b
return dp[-1]
dp[i][j] = min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j]

# unsupported root, omitted fail-closed
x = a < b
x = a and b
x = [n * 2 for n in nums]
return a if cond else b
```

Assert one accepted root has deterministic IDs across two calls to `instrument_expression_roots(source)` and that duplicate source text at two AST locations gets different `exprId`s.

Run:

```bash
python3 -m unittest tests/fixtures/python/test_expression_instrumenter.py
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement supported-root discovery**

A root is an assignment RHS or return value. A root is instrumentable only when its expression subtree is composed of:

```python
ast.Name       # Load only
ast.Constant
ast.Subscript
ast.Attribute
ast.UnaryOp
ast.BinOp
ast.Call
```

plus operator/context helper nodes needed by those AST expressions.

Reject roots containing `Compare`, `BoolOp`, comprehensions, generator expressions, `Lambda`, `IfExp`, or starred call expansion.

Unsupported roots are absent from `plan_dict`; they do not cause source execution to fail.

- [ ] **Step 3: Capture source metadata from the original AST**

Each descriptor includes:

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

Recognize static structure hints only from direct AST shape:

```python
arr[index_expr]
# list_index(variableName="arr", indexExprId=...)

dp[row_expr][column_expr]
# matrix_cell(variableName="dp", rowExprId=..., columnExprId=...)
```

Assignment targets capture source/span and direct Name-rooted list/matrix target hints. Do not evaluate target source.

- [ ] **Step 4: Rewrite Load expressions with value-preserving probes**

Wrap supported expressions as:

```python
__lc_expr_record(root_id, expr_id, original_expression)
```

Use `ast.copy_location` on replacements and `ast.fix_missing_locations` after transformation.

Do not wrap Store-context target nodes as ordinary value probes.

For direct positional `min(...)` / `max(...)` calls with an `ast.Name` callee, at least two positional arguments, no keywords, and no starred args, route the call through:

```python
__lc_minmax_call(root_id, call_expr_id, function_object, candidate_expr_ids, candidate_values)
```

The callee object is evaluated before candidate expressions, candidate expressions remain left-to-right, and the helper invokes the resolved callable exactly once.

Other calls retain ordinary call semantics and are wrapped only at the final call-result level.

- [ ] **Step 5: Verify AST semantics and source fidelity**

Add Python assertions that:

```text
compile(instrumented_tree, "<leetcode-user-code>", "exec") succeeds
original lineno / col_offset remain attached to instrumented roots
Store target source is not converted into a read probe
i - 1 and j - 1 remain normal binary expression nodes inside probes
```

Run:

```bash
python3 -m unittest tests/fixtures/python/test_expression_instrumenter.py
```

Expected: PASS.

- [ ] **Step 6: Load the module from the Pyodide runtime script**

Import the raw Python file in `src/worker/pyodide-runtime.ts`, register it as:

```python
sys.modules["expression_instrumenter"]
```

and pass:

```python
"max_expression_events": request.limits.maxExpressionEvents,
"max_expression_bytes": request.limits.maxExpressionBytes,
```

to `run_request`.

Extend `tests/execution/pyodide-runtime.test.ts`:

```ts
expect(script).toContain("leetcode-expression-instrumenter");
expect(script).toContain('sys.modules["expression_instrumenter"]');
expect(script).toContain("max_expression_events");
expect(script).toContain("max_expression_bytes");
```

- [ ] **Step 7: Run focused verification**

```bash
python3 -m unittest tests/fixtures/python/test_expression_instrumenter.py
npm test -- tests/execution/pyodide-runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/worker/python/expression_instrumenter.py tests/fixtures/python/test_expression_instrumenter.py src/worker/pyodide-runtime.ts tests/execution/pyodide-runtime.test.ts
git commit -m "feat: instrument expression roots"
```

---

### Task 3: Capture Runtime Expression Evidence and Preserve Python Semantics

**Files:**
- Create: `src/worker/python/expression_recorder.py`
- Modify: `src/worker/python/tracer.py`
- Modify: `src/worker/python/runner.py`
- Modify: `tests/fixtures/python/test_trace_engine.py`
- Modify: `src/worker/pyodide-runtime.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`

**Interfaces:**

`ExpressionRecorder` methods:

```python
set_anchor(frame_id, step, line)
record_value(root_id, expr_id, value) -> value
record_minmax_call(root_id, call_expr_id, function_obj, candidate_expr_ids, candidate_values)
flush_frame(frame_id)
flush_all()
result_dict()
```

`TraceCollector._record()` returns the created raw step so the recorder can anchor to it.

- [ ] **Step 1: Write failing Python semantic-preservation tests**

Extend `tests/fixtures/python/test_trace_engine.py` with runner-level cases for:

```python
# side effects must occur exactly once
class Solution:
    def solve(self, arr):
        x = arr.pop() + arr.pop()
        return [x, arr]

# duplicate winner
class Solution:
    def solve(self):
        x = min(3, 3, 5)
        return x

# partial evidence on exception
class Solution:
    def solve(self):
        x = 10 / 0
        return x

# shadowed builtin
class Solution:
    def solve(self):
        min = lambda a, b: a
        x = min(7, 2)
        return x
```

Required assertions:

```text
arr.pop() is executed exactly twice
min(3,3,5) resolves candidate index 0
ZeroDivisionError remains the user exception and the root is partial
shadowed min does not produce resolved built-in selection evidence
```

Run:

```bash
python3 -m unittest tests/fixtures/python/test_trace_engine.py
```

Expected: FAIL.

- [ ] **Step 2: Implement `ExpressionRecorder` soft-limit state**

Create state equivalent to:

```python
class ExpressionRecorder:
    def __init__(self, limits, serializer_factory, session_id="session", emit_batch=None):
        self.active_anchors = {}
        self.pending_roots = {}
        self.completed_batches = []
        self.next_evaluation_id = 1
        self.next_batch_id = 1
        self.expression_event_count = 0
        self.expression_bytes = 0
        self.status = "complete"
        self.reason = None
```

When `max_expression_events` or `max_expression_bytes` is exceeded, set:

```text
status = truncated
reason = expression_event_limit | expression_byte_limit
```

and make all later recording operations return original values without recording. Do not raise `TraceLimitExceeded` for expression-only exhaustion.

- [ ] **Step 3: Implement value-preserving probes**

`record_value()` must:

1. serialize the value for evidence;
2. append one evaluation to the active `(frameId, anchorStep, rootId)` occurrence;
3. return the exact original Python value object.

No extra comparison, coercion, copy, or user callback is allowed.

- [ ] **Step 4: Implement fail-closed built-in `min` / `max` selection**

`record_minmax_call()` invokes:

```python
result = function_obj(*candidate_values)
```

exactly once.

Resolve selection only when:

```text
function_obj is builtins.min or builtins.max
candidate count >= 2
candidate/result snapshots are int, bool, str, or finite float
```

NaN, infinities, containers, references, custom objects, and unknown values yield `selectedCandidateIndex = None` with non-`resolved` status.

Duplicate snapshot matches choose the first positional candidate.

- [ ] **Step 5: Anchor recorder batches from `TraceCollector`**

Modify `_record()` to return its `step_count`.

For a frame receiving a new `line`, `return`, or `exception` trace event:

```text
flush previous expression occurrence for that frame
record the new trace event
if the event is line: set recorder anchor to that new raw step + source line
```

This preserves the semantic distinction:

```text
TraceEvent(step=N) = entry state before source line executes
ExpressionBatch(anchorStep=N) = expression work performed by that line
```

- [ ] **Step 6: Compile instrumented AST and inject helpers in `runner.py`**

Parse/instrument the original source before compilation. When instrumentation is unavailable for internal reasons, compile original source and set expression tracing status to `unavailable`; ordinary tracing continues.

Inject only reserved names:

```python
namespace["__lc_expr_record"] = recorder.record_value
namespace["__lc_minmax_call"] = recorder.record_minmax_call
```

Existing `__lc_*` Locals filtering must continue hiding these helpers.

On normal return, user exception, trace limit, and teardown, call `recorder.flush_all()` before final result construction.

- [ ] **Step 7: Normalize terminal expression fields in TypeScript**

Add to `src/worker/pyodide-runtime.ts`:

```ts
normalizeExpressionPlan(value: unknown): ExpressionPlan | undefined
normalizeExpressionBatch(value: unknown): ExpressionBatch | null
normalizeExpressionTracingState(value: unknown): ExpressionTracingState | undefined
```

Normalize snake_case Python keys at this boundary only.

Extend `tests/execution/pyodide-runtime.test.ts` with one raw terminal result containing plan, completed batch, partial batch, selection evidence, and tracing state; assert exact camelCase output.

- [ ] **Step 8: Run focused verification**

```bash
python3 -m unittest tests/fixtures/python/test_expression_instrumenter.py tests/fixtures/python/test_trace_engine.py
npm test -- tests/execution/pyodide-runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/worker/python/expression_recorder.py src/worker/python/tracer.py src/worker/python/runner.py tests/fixtures/python/test_trace_engine.py src/worker/pyodide-runtime.ts tests/execution/pyodide-runtime.test.ts
git commit -m "feat: capture runtime expression evidence"
```

---

### Task 4: Stream Expression Metadata and Preserve It Through Hard Timeout

**Files:**
- Modify: `src/worker/python/runner.py`
- Modify: `src/worker/python/expression_recorder.py`
- Modify: `src/worker/pyodide-runtime.ts`
- Modify: `src/worker/pyodide-worker.ts`
- Modify: `src/execution/trace-session-collector.ts`
- Modify: `src/execution/execution-controller.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/execution/pyodide-worker.test.ts`
- Modify: `tests/execution/trace-session-collector.test.ts`
- Modify: `tests/execution/execution-controller.test.ts`

**Interfaces:**

`PyodideRuntimeOptions` gains:

```ts
onExpressionPlan?: (sessionId: string, plan: ExpressionPlan) => void;
onExpressionBatch?: (sessionId: string, batches: ExpressionBatch[]) => void;
```

`TraceSessionCollector` gains:

```ts
setExpressionPlan(plan: ExpressionPlan): void;
appendExpressionBatches(batches: ExpressionBatch[]): void;
setExpressionTracingState(state: ExpressionTracingState): void;
```

- [ ] **Step 1: Write failing timeout-survival tests**

In `tests/execution/trace-session-collector.test.ts`:

```ts
collector.setExpressionPlan(plan);
collector.appendExpressionBatches([batch, batch]);
const session = collector.forceTimeout();

expect(session.status).toBe("timeout");
expect(session.expressionPlan).toEqual(plan);
expect(session.expressionBatches).toEqual([batch]);
```

The duplicate is removed by `batchId`.

In `tests/execution/execution-controller.test.ts`, send `expression_plan` and `expression_batch` before advancing fake time to `hardTimeoutMs`; assert the timeout session retains both.

Run:

```bash
npm test -- tests/execution/trace-session-collector.test.ts tests/execution/execution-controller.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Stream the static plan before user code runs**

Expose one best-effort callback:

```text
__lc_emit_expression_plan
```

`runner.py` emits `plan_dict` after instrumentation succeeds and before `exec(user_code, ...)` begins.

- [ ] **Step 3: Stream completed batches from `ExpressionRecorder.flush_frame()`**

Expose:

```text
__lc_emit_expression_batch
```

Serialize batches as compact JSON. Stream failure is swallowed; execution continues.

- [ ] **Step 4: Install callbacks in `createPyodideRuntime()`**

Register callbacks only when supplied:

```ts
pyodide.globals.set("__lc_emit_expression_plan", emitExpressionPlan);
pyodide.globals.set("__lc_emit_expression_batch", emitExpressionBatch);
```

Remove both in `finally`.

If no stream copy was observed but terminal result contains plan/batches, forward the terminal copy once as fallback.

- [ ] **Step 5: Forward expression messages from `pyodide-worker.ts`**

```ts
onExpressionPlan: (sessionId, plan) => {
  scope.postMessage({ type: "expression_plan", sessionId, plan });
},
onExpressionBatch: (sessionId, batches) => {
  scope.postMessage({ type: "expression_batch", sessionId, batches });
}
```

Extend `tests/execution/pyodide-worker.test.ts` to verify order:

```text
expression_plan
expression_batch
execution_finished
```

for a fake runtime emitting in that order.

- [ ] **Step 6: Persist stream data in `TraceSessionCollector`**

Store:

```ts
private expressionPlan: ExpressionPlan | undefined;
private readonly expressionBatches: ExpressionBatch[] = [];
private readonly expressionBatchIds = new Set<number>();
private expressionTracing: ExpressionTracingState | undefined;
```

Expression bytes are counted separately. Crossing `maxExpressionBytes` sets only:

```ts
{ status: "truncated", reason: "expression_byte_limit" }
```

and stops accepting additional expression batches. It must **not** set the collector's existing `resourceLimitReached` flag.

`createSession()` copies plan, de-duplicated batches, and tracing status into schema v3.

- [ ] **Step 7: Route messages in `ExecutionController` and merge terminal fallback**

Handle:

```ts
case "expression_plan":
  if (message.sessionId === request.sessionId) {
    collector.setExpressionPlan(message.plan);
  }
  return;

case "expression_batch":
  if (message.sessionId === request.sessionId) {
    collector.appendExpressionBatches(message.batches);
  }
  return;
```

Before `collector.finish(message.result)`, merge terminal `expressionPlan`, `expressionBatches`, and `expressionTracing`; batch IDs keep terminal/stream copies from duplicating.

- [ ] **Step 8: Run focused verification**

```bash
npm test -- tests/execution/pyodide-runtime.test.ts tests/execution/pyodide-worker.test.ts tests/execution/trace-session-collector.test.ts tests/execution/execution-controller.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/worker/python/runner.py src/worker/python/expression_recorder.py src/worker/pyodide-runtime.ts src/worker/pyodide-worker.ts src/execution/trace-session-collector.ts src/execution/execution-controller.ts tests/execution/pyodide-runtime.test.ts tests/execution/pyodide-worker.test.ts tests/execution/trace-session-collector.test.ts tests/execution/execution-controller.test.ts
git commit -m "feat: stream expression trace evidence"
```

---

### Task 5: Interpret Expression Batches Into Per-Step Evidence Trees

**Files:**
- Create: `src/core/expression-interpreter.ts`
- Create: `tests/core/expression-interpreter.test.ts`
- Modify: `src/core/trace-interpreter.ts`
- Modify: `tests/core/trace-interpreter.test.ts`

**Interfaces:**

```ts
export function buildExpressionEvidence(
  plan: ExpressionPlan | undefined,
  batches: ExpressionBatch[],
  runtimeStates: RuntimeState[]
): ExpressionEvidenceByStep;
```

`TraceInterpretation` gains:

```ts
expressionEvidence: ExpressionEvidenceByStep;
```

- [ ] **Step 1: Write failing tree reconstruction tests**

Create a plan/batch for:

```python
x = max(dp[i - 1], dp[i - 2] + nums[i])
```

Assert:

```ts
expect(root.tree.source).toBe("max(dp[i - 1], dp[i - 2] + nums[i])");
expect(root.tree.children).toHaveLength(2);
expect(root.selections[0]?.selectedCandidateIndex).toBe(1);
```

Add:

- partial root with children but no root-result evaluation;
- same static `exprId` on two different `anchorStep`s;
- unknown root/expr IDs, which are skipped instead of crashing interpretation.

Run:

```bash
npm test -- tests/core/expression-interpreter.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Build static and runtime indexes once**

Use:

```ts
const expressionById = new Map(plan.expressions.map((item) => [item.exprId, item]));
const rootById = new Map(plan.roots.map((item) => [item.rootId, item]));
const runtimeByStep = new Map(runtimeStates.map((state) => [state.step, state]));
```

A batch whose `anchorStep` is absent from `runtimeByStep` is ignored fail-closed.

- [ ] **Step 3: Reconstruct visual hierarchy from static AST metadata**

Within one root occurrence, map runtime evaluations by `exprId` and recursively construct children in `childExprIds` order.

`ExpressionEvaluation.order` remains factual runtime-order metadata but does not reorder the AST tree.

Do not recompute `min` / `max` selection in TypeScript; copy captured `SelectionEvidence` only.

- [ ] **Step 4: Integrate with `interpretTrace()` without breaking old callers**

Change signature to:

```ts
export function interpretTrace(
  events: TraceEvent[],
  relations: StaticRelation[] = [],
  expressionPlan?: ExpressionPlan,
  expressionBatches: ExpressionBatch[] = []
): TraceInterpretation
```

Existing `interpretTrace(events, relations)` tests must continue to produce an empty expression-evidence map.

- [ ] **Step 5: Run focused verification**

```bash
npm test -- tests/core/expression-interpreter.test.ts tests/core/trace-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/expression-interpreter.ts src/core/trace-interpreter.ts tests/core/expression-interpreter.test.ts tests/core/trace-interpreter.test.ts
git commit -m "feat: interpret expression evidence"
```

---

### Task 6: Project Safe Expression References Into List and Matrix Models

**Files:**
- Create: `src/core/expression-structure-projection.ts`
- Create: `tests/core/expression-structure-projection.test.ts`
- Modify: `src/core/expression-interpreter.ts`
- Modify: `src/core/visual-model.ts`
- Modify: `src/core/matrix-interpreter.ts`
- Modify: `tests/core/trace-interpreter.test.ts`
- Modify: `tests/core/matrix-interpreter.test.ts`

**Interfaces:**

```ts
export function projectStructureReferences(
  plan: ExpressionPlan,
  root: ExpressionRootDescriptor,
  rootEvaluation: ExpressionRootEvaluation,
  runtime: RuntimeState
): StructureOperandReference[];
```

`ListVisualModel` and `MatrixVisualModel` gain:

```ts
expressionReferences: StructureOperandReference[];
```

filtered to their own `variableName` and matching structure kind.

- [ ] **Step 1: Write failing projection tests**

Cover:

```python
x = nums[i]
dp[i][j] = min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j]
return nums[-1]
```

Assert:

```text
list index resolves from captured integer expression
matrix row/column resolve from captured integer expressions
negative indices normalize but preserve raw index
selected min/max candidate upgrades matching reference to selected_operand
dp[i][j] assignment target resolves from anchored locals
out-of-bounds/unresolved expressions produce no fake reference
```

Run:

```bash
npm test -- tests/core/expression-structure-projection.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Resolve read coordinates only from captured facts**

For `StaticStructureHint`, read referenced index-expression snapshots from the root's evaluations.

Accept an index only when:

```ts
snapshot.type === "int" && /^-?\d+$/.test(snapshot.value)
```

and the converted number is a safe integer.

Use the anchored `RuntimeState` local snapshot only to obtain sequence dimensions for Python negative-index normalization.

Never parse descriptor `source` to infer runtime coordinates.

- [ ] **Step 3: Upgrade selected operand roles only from captured selection evidence**

Read:

```ts
const selectedExprId = selection.candidateExprIds[selection.selectedCandidateIndex!];
```

Only the structure reference whose own `exprId` equals `selectedExprId` becomes `selected_operand`. Do not recursively mark descendants of a selected arithmetic candidate as if one sub-read alone caused the choice.

- [ ] **Step 4: Resolve assignment targets conservatively**

For target hints, support only:

```text
integer literal index
simple local-variable index
```

at each dimension.

Use anchored active-frame locals for variable values. Complex target index source such as `i + 1` remains visible as target source text in the Expression panel but receives no structure coordinate in v0.1.

Use synthetic renderer identity:

```text
<rootId>:target
```

for target references.

- [ ] **Step 5: Feed references into `VisualState` construction**

After `buildExpressionEvidence()`, for each runtime state:

```ts
const refs = expressionEvidence.get(runtime.step)?.roots
  .flatMap((root) => root.structureReferences) ?? [];
```

Pass `refs` into `buildVisualState()` using a new final optional argument defaulting to `[]`.

Matrix/List models filter to their variable/kind. Other visual kinds ignore the references in v0.1.

- [ ] **Step 6: Run focused verification**

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

### Task 7: Render the Expression Evidence Panel and Structure Overlays

**Files:**
- Create: `src/sidepanel/components/ExpressionEvidence.ts`
- Create: `tests/sidepanel/expression-evidence.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `src/sidepanel/components/ListVisualizer.ts`
- Modify: `src/sidepanel/components/MatrixVisualizer.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `tests/sidepanel/list-visualizer.test.ts`
- Modify: `tests/sidepanel/matrix-visualizer.test.ts`

**Interfaces:**

```ts
export function createExpressionEvidence(
  evidence: ExpressionStepEvidence | undefined,
  tracingState: ExpressionTracingState | undefined
): HTMLElement;
```

Structure renderers consume `model.expressionReferences` only; they do not inspect raw selections or parse expression source.

- [ ] **Step 1: Write failing Expression panel tests**

Create DOM cases for:

```text
completed assignment root
return root
partial root
resolved selected operand
no evidence
truncated expression tracing
```

Use stable hooks:

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

Render node source + captured value via existing `formatValue()`.

A partial root without a root result explicitly displays `partial`; it must not render a fabricated `undefined`/`null` result.

Selected marking comes only from captured `SelectionEvidence`.

- [ ] **Step 3: Add a persistent panel to `TraceVisualizer`**

Interpret with:

```ts
interpretTrace(
  session.events,
  session.subscriptRelations ?? [],
  session.expressionPlan,
  session.expressionBatches ?? []
)
```

Create once:

```ts
const expressionPanel = createPanel(
  "Expression Evidence",
  "trace-viewer__expression-panel"
);
```

For current event:

```ts
const evidence = event
  ? interpretation.expressionEvidence.get(event.step)
  : undefined;
```

Replace the panel body with `createExpressionEvidence(evidence, session.expressionTracing)`.

The panel remains mounted on steps with no evidence and displays exactly:

```text
No expression evidence for this step.
```

- [ ] **Step 4: Write failing List / Matrix overlay tests**

For List, provide `selected_operand` at one index and `assignment_target` at another.

For Matrix, provide:

```text
operand at (1,3)
selected_operand at (2,2)
assignment_target at (2,3)
```

Assert the matching cells/items expose:

```text
data-expression-operand="true"
data-expression-selected="true"
data-expression-target="true"
```

and coexist with current `focus`, `changed`, pointer, viewport, and inspector state.

Run:

```bash
npm test -- tests/sidepanel/list-visualizer.test.ts tests/sidepanel/matrix-visualizer.test.ts
```

Expected: FAIL.

- [ ] **Step 5: Render overlay roles as orthogonal UI state**

Add classes:

```text
is-expression-operand
is-expression-selected
is-expression-target
```

Do not alter values, pointer movement, Matrix focus auto-follow, viewport position, change status, or inspector selection.

Expression references outside the Matrix viewport do not auto-pan the viewport and do not create synthetic notices.

- [ ] **Step 6: Add restrained factual styles**

Style panel hierarchy and overlay roles in `src/sidepanel/styles.css` using borders/markers/labels only. Do not introduce correctness colors, heatmaps, or success/failure semantics.

- [ ] **Step 7: Extend TraceVisualizer integration coverage**

In `tests/sidepanel/trace-visualizer.test.ts`, add one schema-v3 session with expression evidence at step 1 and none at step 2. Assert:

```text
panel exists at both steps
step 1 shows the expression tree
step 2 shows the no-evidence message
existing Visual State / What Changed / Behavioral panels remain present
```

- [ ] **Step 8: Run focused verification**

```bash
npm test -- tests/sidepanel/expression-evidence.test.ts tests/sidepanel/trace-visualizer.test.ts tests/sidepanel/list-visualizer.test.ts tests/sidepanel/matrix-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/sidepanel/components/ExpressionEvidence.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/components/ListVisualizer.ts src/sidepanel/components/MatrixVisualizer.ts src/sidepanel/styles.css tests/sidepanel/expression-evidence.test.ts tests/sidepanel/trace-visualizer.test.ts tests/sidepanel/list-visualizer.test.ts tests/sidepanel/matrix-visualizer.test.ts
git commit -m "feat: render expression evidence"
```

---

### Task 8: Validate #64-Like DP Execution, Fail-Open Behavior, Compatibility, and Full Gates

**Files:**
- Modify: `tests/fixtures/python/test_trace_engine.py`
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/core/trace-interpreter.test.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `README.md`
- Modify: `README.zh-TW.md`

**Interfaces:**
- Adds no runtime API. This task proves end-to-end behavior against the approved spec.

- [ ] **Step 1: Add representative Minimum Path Sum execution coverage**

Use exactly:

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

with input:

```text
[[1,3,1],[1,5,1],[4,2,1]]
```

At an `else` iteration, assert all channels independently:

```text
Expression root kind = assignment
min has two candidate values
selectedCandidateIndex is resolved for primitive ints
binary + result is captured
assignment target source = dp[i][j]
structure references include operand / selected_operand / assignment_target
RuntimeMutation independently reports the resulting dp cell change
```

- [ ] **Step 2: Add fail-open unsupported-root coverage**

Use a normally executable assignment containing comparison:

```python
flag = a < b
```

Assert:

```text
execution completes normally
ordinary TraceEvent data exists
unsupported expression root is absent from ExpressionPlan/evidence
no instrumentation error is reported as a user runtime error
```

- [ ] **Step 3: Add expression-soft-limit coverage**

Run a loop with enough supported assignments to exceed a deliberately tiny `maxExpressionEvents` while leaving `maxTraceSteps` large.

Assert:

```text
execution status is not trace_limit because of expression exhaustion
expressionTracing.status = truncated
ordinary trace events continue after expression recording stops
```

- [ ] **Step 4: Add backward-compatibility coverage**

In `tests/sidepanel/trace-visualizer.test.ts`, keep one v2-style session with no expression fields and assert:

```text
TraceVisualizer renders normally
Expression Evidence panel exists
panel says "No expression evidence for this step."
List/Matrix/Behavioral rendering remains unchanged
```

Do not require migration of stored v2 data before rendering.

- [ ] **Step 5: Document capability and explicit boundary in both READMEs**

Add wording equivalent to:

```text
Expression Evidence — inspect captured operand, intermediate, and result values
for supported assignment/return expressions, including factual min/max candidate
selection when it can be proven safely. This visualizes executed computation; it
does not infer the correct recurrence, algorithm, or fix.
```

Document that comparison / boolean / branch evidence remains future Condition / Decision Tracing work.

- [ ] **Step 6: Run all Python semantic tests**

```bash
python3 -m unittest \
  tests/fixtures/python/test_expression_instrumenter.py \
  tests/fixtures/python/test_trace_engine.py
```

Expected: PASS.

- [ ] **Step 7: Run all focused TypeScript tests**

```bash
npm test -- \
  tests/protocol/worker-protocol.test.ts \
  tests/execution/execution-request.test.ts \
  tests/execution/pyodide-runtime.test.ts \
  tests/execution/pyodide-worker.test.ts \
  tests/execution/trace-session-collector.test.ts \
  tests/execution/execution-controller.test.ts \
  tests/core/expression-interpreter.test.ts \
  tests/core/expression-structure-projection.test.ts \
  tests/core/trace-interpreter.test.ts \
  tests/core/matrix-interpreter.test.ts \
  tests/sidepanel/expression-evidence.test.ts \
  tests/sidepanel/trace-visualizer.test.ts \
  tests/sidepanel/list-visualizer.test.ts \
  tests/sidepanel/matrix-visualizer.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run full repository gates**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 9: Audit factual UI wording**

```bash
grep -RniE "correct recurrence|wrong recurrence|root cause|should use|fix by|optimal path" \
  src/core/expression-interpreter.ts \
  src/core/expression-structure-projection.ts \
  src/sidepanel/components/ExpressionEvidence.ts \
  src/sidepanel/components/ListVisualizer.ts \
  src/sidepanel/components/MatrixVisualizer.ts
```

Expected: no expression-tracing UI claim that infers correctness or recommends a solution.

- [ ] **Step 10: Commit**

```bash
git add tests/fixtures/python/test_trace_engine.py tests/execution/pyodide-runtime.test.ts tests/core/trace-interpreter.test.ts tests/sidepanel/trace-visualizer.test.ts README.md README.zh-TW.md
git commit -m "test: validate expression tracing end to end"
```

---

## Final Acceptance Checklist

- [ ] Trace schema is v3 and v2-style sessions still render.
- [ ] Assignment RHS and return expressions are the only v0.1 roots.
- [ ] Static expression IDs are deterministic and distinct from runtime occurrences.
- [ ] Original source spans/snippets come from the unmodified Python AST.
- [ ] Unsupported root shapes fail open to ordinary tracing.
- [ ] Supported user expressions execute at most once for tracing.
- [ ] Side-effecting expressions such as `arr.pop() + arr.pop()` preserve ordinary Python behavior.
- [ ] Expression batches align to the line execution using `anchorStep + frameId`.
- [ ] Exceptions preserve already captured partial expression evidence.
- [ ] Shadowed `min` / `max` names never receive false built-in selection semantics.
- [ ] Duplicate primitive min/max winners resolve to the first matching positional candidate.
- [ ] NaN/custom/container candidates fail closed with no selected candidate claim.
- [ ] Expression event/byte exhaustion truncates only expression evidence.
- [ ] ExpressionPlan is streamed before user execution so hard timeout retains interpretable metadata.
- [ ] Streamed and terminal batches de-duplicate by `batchId`.
- [ ] TypeScript builds expression hierarchy from static AST metadata, not probe order.
- [ ] List/Matrix coordinates are derived only from captured integer evidence or conservative target locals/literals.
- [ ] Expression overlays never overwrite entry-state structure values.
- [ ] Matrix expression references do not change existing focus auto-follow / viewport behavior.
- [ ] Expression Evidence panel remains mounted even on steps with no evidence.
- [ ] RuntimeMutation remains the sole mutation authority.
- [ ] Behavioral Analysis remains independent of expression evidence in v0.1.
- [ ] No UI text infers recurrence correctness, algorithm intent, root cause, or fixes.
- [ ] Python expression fixture tests pass.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.

---

## Execution Order

Execute strictly in this order:

```text
1. Shared protocol + schema v3
2. Static AST plan + instrumentation
3. Runtime recorder + semantic preservation
4. Streaming + timeout/session persistence
5. TypeScript evidence reconstruction
6. Structure-reference projection
7. Evidence panel + structure overlays
8. End-to-end DP/compatibility/regression gates
```

Do not add `Compare`, `BoolOp`, short-circuit behavior, `if` / `while` branch outcomes, or Behavioral Debugging v2 while executing this plan. Those belong to the next Condition / Decision Tracing design cycle.

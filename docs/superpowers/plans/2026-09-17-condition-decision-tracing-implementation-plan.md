# Condition / Decision Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add factual `if` / `elif` / `while` decision evidence, including short-circuit semantics, branch-chain outcomes, while-decision history, and safe List / Matrix condition overlays without changing Python program behavior or turning the debugger into a correctness engine.

**Architecture:** Keep the existing raw `sys.settrace` channel and Expression Evidence channel unchanged. Add a second AST-instrumented evidence channel: the original source produces a static `ConditionPlan`, the already expression-instrumented AST receives condition probes, Python records `DecisionBatch` occurrences keyed by `anchorStep + frameId`, TypeScript reconstructs `DecisionEvidence`, and the side panel renders the current decision plus history. Unsupported or semantically risky shapes fall back to opaque final-truth evidence rather than deeper decomposition.

**Tech Stack:** TypeScript 5.8, Vitest 3.2, Pyodide 0.29.3, Python `ast`, Chrome MV3 Web Worker, JSDOM.

**Spec:** `docs/superpowers/specs/2026-09-17-condition-decision-tracing-design.md`

## Global Constraints

- Preserve the product rule: **visualize what the program actually did**; never infer correctness, expected path, intended control flow, root cause, or fixes.
- v0.1 decision sites are exactly `if`, `elif`, and `while`.
- Supported factual condition semantics: bare truth tests, `not`, nested `and` / `or` in safe truth-test context, and `==`, `!=`, `<`, `<=`, `>`, `>=`, `is`, `is not`, `in`, `not in`.
- Chained comparisons are opaque in v0.1 unless decomposition is proven semantics-preserving; do not split `0 <= i < n` into two factual children.
- Every original operand is evaluated at most once; user-defined truth/comparison behavior must not run more often than ordinary Python execution.
- Python remains authoritative for comparison dispatch, membership semantics, and short-circuit behavior.
- A missing child may be labeled `short_circuited` only when a completed parent boolean result proves it was skipped.
- Partial decisions have no fabricated branch/loop outcome.
- `TraceEvent`, `RuntimeMutation`, `ExpressionEvidence`, and `DecisionEvidence` remain separate evidence channels.
- All Decision Evidence aligns to the authoritative raw trace through `anchorStep + frameId`; there is no second navigation cursor.
- Decision instrumentation is fail-open. Failure to plan, instrument, serialize, or stream decision evidence must not prevent ordinary execution or Expression Evidence collection.
- Decision budgets are soft limits. Use `maxDecisionEvents = 20_000` and `maxDecisionBytes = 2_000_000`; exhausting them marks Decision Tracing truncated but must not terminate user execution.
- Trace schema advances from v3 to **v4**; older sessions without decision fields remain valid.
- Failure-First behavior is unchanged in v0.1.
- Full regression gates remain `npm test`, `npm run typecheck`, and `npm run build`.

---

## File Structure

Create these focused units:

```text
src/shared/decision-types.ts
    Static condition-plan contracts, runtime decision batches, interpreted
    evidence, history, and safe structure-reference contracts.

src/worker/python/condition_instrumenter.py
    Original-source condition planning plus source-span-driven AST rewriting
    over the already expression-instrumented tree.

src/worker/python/decision_recorder.py
    Runtime decision occurrence lifecycle, safe operand snapshots, truth probes,
    completion/partial state, soft limits, and batch streaming.

src/core/decision-interpreter.ts
    ConditionPlan + DecisionBatch -> DecisionEvidenceByStep + branch-chain and
    while-history projections.

src/core/decision-structure-projection.ts
    Resolve captured condition operand evidence into safe List / Matrix refs.

src/sidepanel/components/DecisionEvidence.ts
    Current-step decision tree, branch-chain view, tracing state, and while
    history with raw-step navigation callbacks.
```

Modify only established integration seams for shared protocol, runner/tracer, Pyodide bridge, session collection, trace interpretation, visual models, sidepanel composition/styles, README, and tests.

---

### Task 1: Define Trace Schema v4 and Shared Decision Contracts

**Files:**
- Create: `src/shared/decision-types.ts`
- Modify: `src/shared/trace-types.ts`
- Modify: `src/shared/execution-types.ts`
- Modify: `src/shared/worker-protocol.ts`
- Modify: `tests/protocol/worker-protocol.test.ts`
- Modify: `tests/execution/execution-request.test.ts`

**Interfaces:**
- Produces all shared contracts consumed by Tasks 2–8.
- Worker protocol adds `condition_plan` and `decision_batch` messages.
- `DecisionBatch.outcome` is optional and exists only when `status === "completed"`.

- [ ] **Step 1: Write failing protocol and limit tests**

Add protocol cases equivalent to:

```ts
expect(isWorkerOutboundMessage({
  type: "condition_plan",
  sessionId: "s1",
  plan: { version: 1, sites: [], conditions: [], operands: [] }
})).toBe(true);

expect(isWorkerOutboundMessage({
  type: "decision_batch",
  sessionId: "s1",
  batches: [{
    batchId: 1,
    anchorStep: 4,
    frameId: 2,
    siteId: "d1",
    occurrence: 1,
    status: "completed",
    condition: {
      conditionId: "d1.c0",
      evaluations: [],
      truth: false
    },
    outcome: "branch_not_entered"
  }]
})).toBe(true);
```

Add a valid partial batch with no `outcome`, and invalid cases for:

```text
missing batchId
non-integer occurrence
partial + fabricated outcome
unknown decision status
conditionPlan.version != 1
```

Extend execution-limit fixtures with:

```ts
maxDecisionEvents: 20_000,
maxDecisionBytes: 2_000_000
```

Run:

```bash
npm test -- tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
```

Expected: FAIL because decision protocol fields do not exist.

- [ ] **Step 2: Create `src/shared/decision-types.ts`**

Define the static and runtime contracts:

```ts
import type { SourceSpan } from "./expression-types";
import type { ValueSnapshot } from "./trace-types";

export type DecisionSiteKind = "if" | "elif" | "while";
export type ConditionKind =
  | "truth_test"
  | "comparison"
  | "not"
  | "and"
  | "or"
  | "opaque";

export type ConditionStructureHint =
  | { kind: "list_index"; variableName: string; indexOperandId: string }
  | {
      kind: "matrix_cell";
      variableName: string;
      rowOperandId: string;
      columnOperandId: string;
    };

export interface ConditionOperandDescriptor {
  operandId: string;
  conditionId: string;
  source: string;
  span: SourceSpan;
  structureHint?: ConditionStructureHint;
}

export interface ConditionDescriptor {
  conditionId: string;
  siteId: string;
  kind: ConditionKind;
  source: string;
  span: SourceSpan;
  childConditionIds: string[];
  operandIds: string[];
}

export interface DecisionSiteDescriptor {
  siteId: string;
  kind: DecisionSiteKind;
  chainId?: string;
  branchIndex?: number;
  conditionId: string;
  span: SourceSpan;
}

export interface DecisionChainDescriptor {
  chainId: string;
  branches: Array<{
    branchIndex: number;
    kind: "if" | "elif" | "else";
    siteId?: string;
  }>;
}

export interface ConditionPlan {
  version: 1;
  sites: DecisionSiteDescriptor[];
  conditions: ConditionDescriptor[];
  operands: ConditionOperandDescriptor[];
  chains: DecisionChainDescriptor[];
}

export interface DecisionOperandEvaluation {
  operandId: string;
  order: number;
  value: ValueSnapshot;
}

export interface ConditionEvaluation {
  conditionId: string;
  evaluations: DecisionOperandEvaluation[];
  truth?: boolean;
  evaluatedConditionIds?: string[];
}

export type DecisionOutcome =
  | "branch_entered"
  | "branch_not_entered"
  | "loop_body_entered"
  | "loop_exited";

export interface DecisionBatch {
  batchId: number;
  anchorStep: number;
  frameId: number;
  siteId: string;
  occurrence: number;
  status: "completed" | "partial";
  condition: ConditionEvaluation;
  outcome?: DecisionOutcome;
}

export interface DecisionTracingState {
  status: "complete" | "truncated" | "unavailable";
  reason?: string;
}

export type DecisionStructureReference =
  | {
      operandId: string;
      variableName: string;
      kind: "list_index";
      index: number;
      rawIndex: number;
      role: "condition_operand";
    }
  | {
      operandId: string;
      variableName: string;
      kind: "matrix_cell";
      row: number;
      column: number;
      rawRow: number;
      rawColumn: number;
      role: "condition_operand";
    };

export interface ConditionEvidenceNode {
  conditionId: string;
  kind: ConditionKind;
  source: string;
  status: "evaluated" | "short_circuited" | "not_reached" | "partial";
  truth?: boolean;
  operands: Array<{
    operandId: string;
    source: string;
    value?: ValueSnapshot;
  }>;
  children: ConditionEvidenceNode[];
  skipReason?: "and_short_circuit" | "or_short_circuit" | "earlier_branch_selected";
}

export interface DecisionStepEvidence {
  anchorStep: number;
  frameId: number;
  siteId: string;
  occurrence: number;
  status: "completed" | "partial";
  outcome?: DecisionOutcome;
  condition: ConditionEvidenceNode;
  structureReferences: DecisionStructureReference[];
}

export interface DecisionChainEvidence {
  chainId: string;
  branches: Array<{
    branchIndex: number;
    kind: "if" | "elif" | "else";
    status: "selected" | "rejected" | "not_reached";
    siteId?: string;
    condition?: ConditionEvidenceNode;
    anchorStep?: number;
  }>;
  selectedBranchIndex: number | null;
}

export interface DecisionHistoryEntry {
  siteId: string;
  occurrence: number;
  anchorStep: number;
  frameId: number;
  status: "completed" | "partial";
  truth?: boolean;
  outcome?: DecisionOutcome;
  condition: ConditionEvidenceNode;
}

export type DecisionEvidenceByStep = Map<number, DecisionStepEvidence>;
export type DecisionHistoryBySite = Map<string, DecisionHistoryEntry[]>;
```

- [ ] **Step 3: Extend trace and execution contracts**

In `src/shared/trace-types.ts`:

```ts
export const TRACE_SCHEMA_VERSION = 4;
```

Add optional fields to `TraceSession`:

```ts
conditionPlan?: ConditionPlan;
decisionBatches?: DecisionBatch[];
decisionTracing?: DecisionTracingState;
```

In `src/shared/execution-types.ts`, extend `ExecutionLimits` and defaults:

```ts
maxDecisionEvents: number;
maxDecisionBytes: number;
```

```ts
maxDecisionEvents: 20_000,
maxDecisionBytes: 2_000_000
```

Extend `ExecutionTerminalResult` with optional `conditionPlan`, `decisionBatches`, and `decisionTracing`.

- [ ] **Step 4: Extend worker-protocol validation**

Add outbound messages:

```ts
| { type: "condition_plan"; sessionId: string; plan: ConditionPlan }
| { type: "decision_batch"; sessionId: string; batches: DecisionBatch[] }
```

Add structural validators for every nested decision type. Enforce:

```ts
if (batch.status === "partial" && batch.outcome !== undefined) return false;
if (batch.status === "completed" && batch.outcome === undefined) return false;
```

- [ ] **Step 5: Run focused verification**

```bash
npm test -- tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/decision-types.ts src/shared/trace-types.ts src/shared/execution-types.ts src/shared/worker-protocol.ts tests/protocol/worker-protocol.test.ts tests/execution/execution-request.test.ts
git commit -m "feat: define decision tracing protocol"
```

---

### Task 2: Build the Static Condition Planner and Semantics-Safe AST Rewriter

**Files:**
- Create: `src/worker/python/condition_instrumenter.py`
- Create: `tests/fixtures/python/test_condition_instrumenter.py`
- Modify: `src/worker/python/runner.py`

**Interfaces:**

Python entrypoint:

```python
instrument_condition_sites(
    source_code,
    base_tree,
    begin_name,
    truth_name,
    operand_name,
    complete_name,
) -> ConditionInstrumentationResult
```

`ConditionInstrumentationResult` contains:

```python
instrumented_tree
plan_dict
available
reason
```

The planner always derives metadata from a fresh parse of the **original source**. The transformer rewrites `base_tree`, which is the already expression-instrumented AST when Expression Tracing succeeded.

- [ ] **Step 1: Write failing planner tests**

Create `tests/fixtures/python/test_condition_instrumenter.py` with cases for:

```python
if node:
    pass

if left < right and nums[i] != target:
    pass

if x < 0:
    pass
elif x == 0:
    pass
else:
    pass

while left <= right:
    left += 1
```

Assert:

```text
if / elif / while get stable distinct siteId values
if/elif/else share one chainId with branchIndex 0/1/2
identical condition source text at different locations gets different conditionId values
nested and/or nodes have childConditionIds in Python evaluation order
```

Add opaque cases:

```python
if 0 <= i < n:
    pass

if (a and b) is sentinel:
    pass
```

Assert both plans retain source/span but do not decompose the semantically risky subtree.

Run:

```bash
python3 -m unittest tests/fixtures/python/test_condition_instrumenter.py
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement source-level planning and branch-chain normalization**

Use a planner that parses the original source and emits deterministic IDs from site ordinal + condition path:

```text
d1
d1.c0
d1.c0.0
d1.c0.1
```

Treat an `elif` only when an `If.orelse` contains exactly one `ast.If` that is the source-level continuation of the chain. Do not also emit that nested node as a separate top-level `if` chain.

Record an explicit `else` branch descriptor with no `siteId`.

- [ ] **Step 3: Plan supported atomic operands and structure hints**

For simple non-chained comparisons, create operand descriptors for the left/right values. Safe operand shapes for v0.1 are:

```python
ast.Name
ast.Constant
ast.Attribute
ast.Subscript
```

For direct structure shapes, emit static hints:

```python
nums[i]
# list_index(variableName="nums", indexOperandId=<operand for i>)

grid[r][c]
# matrix_cell(variableName="grid", rowOperandId=<r>, columnOperandId=<c>)
```

If an index expression is not a direct integer literal or separately capturable operand, omit the structure hint; do not evaluate source text later.

- [ ] **Step 4: Rewrite supported truth-context trees without simulating Python control flow**

The outer test must begin a runtime occurrence before evaluating the user condition:

```python
__lc_decision_complete(
    site_id,
    site_kind,
    root_condition_id,
    __lc_decision_begin(site_id, root_condition_id) and rewritten_test,
)
```

`__lc_decision_begin(...)` must always return the built-in `True` and must not inspect user values.

For atomic truth tests:

```python
__lc_condition_truth(site_id, condition_id, original_value)
```

For simple comparisons, preserve Python's operator node and wrap only operands transparently:

```python
__lc_condition_truth(
    site_id,
    condition_id,
    __lc_condition_operand(site_id, condition_id, left_operand_id, left)
    <
    __lc_condition_operand(site_id, condition_id, right_operand_id, right),
)
```

For `and` / `or` used in safe truth-test context, recursively produce built-in bool children and keep the original `ast.And` / `ast.Or` node. Do not implement custom thunk/callback short-circuiting.

For `not`, preserve `ast.Not` and wrap its child with a truth probe.

For opaque roots, evaluate the original test unchanged and apply only the outer truth probe:

```python
__lc_condition_truth(site_id, root_condition_id, original_test)
```

- [ ] **Step 5: Prove the second rewrite composes with Expression Tracing**

In `runner.py`, build the condition instrumenter over the current tree:

```python
expression = instrument_expression_roots(...)
base_tree = expression.instrumented_tree if expression.instrumented_tree is not None else ast.parse(source_code)
condition = instrument_condition_sites(
    source_code,
    base_tree=base_tree,
    begin_name=decision_begin_name,
    truth_name=condition_truth_name,
    operand_name=condition_operand_name,
    complete_name=decision_complete_name,
)
final_tree = condition.instrumented_tree if condition.available else base_tree
```

Do not yet bind runtime helpers in this task; use inert test helper functions when compiling fixture trees.

Add a fixture containing both:

```python
if i < len(nums):
    total = total + nums[i]
```

and assert the compiled tree contains both expression probes for the assignment and condition probes for the `if` without duplicate source evaluation.

- [ ] **Step 6: Run Python planner verification**

```bash
python3 -m unittest tests/fixtures/python/test_condition_instrumenter.py tests/fixtures/python/test_expression_instrumenter.py
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worker/python/condition_instrumenter.py src/worker/python/runner.py tests/fixtures/python/test_condition_instrumenter.py
git commit -m "feat: instrument Python decision sites"
```

---

### Task 3: Implement the Decision Recorder and Semantic-Preservation Tests

**Files:**
- Create: `src/worker/python/decision_recorder.py`
- Create: `tests/fixtures/python/test_decision_recorder.py`
- Modify: `src/worker/python/tracer.py`
- Modify: `src/worker/python/runner.py`

**Interfaces:**

Recorder methods bound into user bytecode:

```python
DecisionRecorder.begin(site_id, root_condition_id) -> bool
DecisionRecorder.record_operand(site_id, condition_id, operand_id, value) -> value
DecisionRecorder.record_truth(site_id, condition_id, value) -> bool
DecisionRecorder.complete(site_id, site_kind, root_condition_id, truth) -> bool
```

Tracer lifecycle methods:

```python
set_anchor(frame_id, step, line)
flush_frame(frame_id)
flush_all()
result_dict()
```

- [ ] **Step 1: Write failing recorder tests**

Test a completed `if` occurrence:

```python
assert recorder.begin("d1", "d1.c0") is True
assert recorder.record_truth("d1", "d1.c0", 0) is False
assert recorder.complete("d1", "if", "d1.c0", False) is False
```

After flush, assert:

```text
status = completed
occurrence = 1
outcome = branch_not_entered
condition.truth = false
```

Test `while` occurrences increment independently per `(frameId, siteId)` and reset across different frame IDs.

Test a begun-but-uncompleted occurrence becomes:

```text
status = partial
outcome absent
```

- [ ] **Step 2: Implement safe snapshot and soft limits**

Reuse the same built-in-only safety rule as `ExpressionRecorder`: primitives and recursively safe built-in containers may serialize; arbitrary objects become:

```python
{
    "type": "unknown",
    "className": "unsupported",
    "repr": "<unsupported decision value>",
}
```

Do not call arbitrary user `repr`, iteration, comparison, or coercion solely for Decision Evidence.

Apply:

```text
max_decision_events / maxDecisionEvents
max_decision_bytes / maxDecisionBytes
```

When exceeded, set:

```python
self.status = "truncated"
self.reason = "decision_event_limit"  # or decision_byte_limit
```

and return user values/results unchanged.

- [ ] **Step 3: Implement truth and completion semantics**

`record_truth` must do exactly one user-value truth test:

```python
def record_truth(self, site_id, condition_id, value):
    truth = bool(value)
    self._record_truth_event(site_id, condition_id, truth)
    return truth
```

`complete` receives a built-in bool from the rewritten condition and maps outcome only when complete:

```python
if site_kind in {"if", "elif"}:
    outcome = "branch_entered" if truth else "branch_not_entered"
elif site_kind == "while":
    outcome = "loop_body_entered" if truth else "loop_exited"
else:
    raise ValueError("unsupported decision site kind")
```

Do not swallow a user exception that occurs before `complete` is called.

- [ ] **Step 4: Integrate recorder anchoring into `TraceCollector`**

Extend constructor:

```python
def __init__(..., expression_recorder=None, decision_recorder=None):
    ...
```

On `line`, `return`, and `exception`, flush both recorders before recording the new raw event. After a `line` raw event receives its authoritative `step`, set both anchors:

```python
if self.expression_recorder is not None:
    self.expression_recorder.set_anchor(frame_id, step, frame.f_lineno)
if self.decision_recorder is not None:
    self.decision_recorder.set_anchor(frame_id, step, frame.f_lineno)
```

Expose the existing `expression_frame_id` resolver to both recorders rather than creating a second frame-ID registry.

- [ ] **Step 5: Bind decision helpers in `runner.py`**

Create randomized internal marker names just like Expression Tracing. Add them to the existing helper capability map so compiled user code resolves directly to bound callables.

Construct:

```python
decision_recorder = DecisionRecorder(
    limits,
    lambda: None,
    session_id=session_id,
    emit_batch=emit_decision_batch,
)
```

After `TraceCollector` exists:

```python
decision_recorder.serializer_factory = lambda: collector.serialize_value
decision_recorder.frame_id_for = collector.expression_frame_id
```

If condition instrumentation is unavailable:

```python
decision_recorder.status = "unavailable"
decision_recorder.reason = condition.reason
```

- [ ] **Step 6: Add semantic-preservation fixture tests**

Execute instrumented and uninstrumented variants and compare observable output for:

```python
class Flag:
    def __init__(self): self.calls = 0
    def __bool__(self):
        self.calls += 1
        return self.calls == 1
```

Require the same `Flag.calls` count.

Also test:

```python
False and explode()           # explode never called
True or explode()             # explode never called
left < right                  # custom __lt__ invocation count unchanged
x in container                # custom __contains__ invocation count unchanged
(a and b) is sentinel         # opaque path preserves operand identity semantics
```

Run:

```bash
python3 -m unittest tests/fixtures/python/test_condition_instrumenter.py tests/fixtures/python/test_decision_recorder.py
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worker/python/decision_recorder.py src/worker/python/tracer.py src/worker/python/runner.py tests/fixtures/python/test_decision_recorder.py tests/fixtures/python/test_condition_instrumenter.py
git commit -m "feat: record factual decision evidence"
```

---

### Task 4: Stream Decision Evidence Through Pyodide and Preserve It in Sessions

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
- Pyodide options add `onConditionPlan` and `onDecisionBatch` callbacks.
- Python `run_request` receives `emit_condition_plan` and `emit_decision_batch`.
- `TraceSessionCollector` de-duplicates `DecisionBatch.batchId` and enforces the JS-side decision-byte limit independently from ordinary session bytes.

- [ ] **Step 1: Write failing bridge and collector tests**

Add tests that a worker stream containing:

```ts
{ type: "condition_plan", sessionId: "s1", plan }
{ type: "decision_batch", sessionId: "s1", batches: [batch] }
```

survives into the final `TraceSession`.

Add timeout test:

```text
condition_plan streamed
decision_batch streamed
hard timeout occurs before execution_finished
final session still contains streamed plan/batch
```

Add duplicate terminal-copy test: a streamed `batchId = 4` plus terminal `batchId = 4` appears once.

- [ ] **Step 2: Load decision Python modules in `buildExecutionScript`**

Import raw sources:

```ts
import conditionInstrumenterSource from "./python/condition_instrumenter.py?raw";
import decisionRecorderSource from "./python/decision_recorder.py?raw";
```

Register modules in `sys.modules` before loading `runner.py`, then pass:

```python
"max_decision_events": ${request.limits.maxDecisionEvents},
"max_decision_bytes": ${request.limits.maxDecisionBytes},
```

and callbacks:

```python
emit_condition_plan=globals().get("__lc_emit_condition_plan"),
emit_decision_batch=globals().get("__lc_emit_decision_batch"),
```

- [ ] **Step 3: Add TS normalization for Python decision payloads**

Implement:

```ts
normalizeConditionPlan(value: unknown): ConditionPlan | undefined
normalizeDecisionBatch(value: unknown): DecisionBatch | null
normalizeDecisionTracingState(value: unknown): DecisionTracingState | undefined
```

Accept both snake_case and camelCase field spellings from Python/terminal fixtures.

Reject a partial batch that includes `outcome`, and reject a completed batch without one.

- [ ] **Step 4: Add streaming callbacks and worker messages**

Extend `PyodideRuntimeOptions`:

```ts
onConditionPlan?: (sessionId: string, plan: ConditionPlan) => void;
onDecisionBatch?: (sessionId: string, batches: DecisionBatch[]) => void;
```

Install/remove Pyodide globals exactly like expression callbacks:

```text
__lc_emit_condition_plan
__lc_emit_decision_batch
```

Extend `pyodide-worker.ts` to post `condition_plan` and `decision_batch` messages.

- [ ] **Step 5: Collect streamed/terminal decision data**

Add to `TraceSessionCollector`:

```ts
private conditionPlan: ConditionPlan | undefined;
private readonly decisionBatches: DecisionBatch[] = [];
private readonly decisionBatchIds = new Set<number>();
private decisionTracing: DecisionTracingState | undefined;
private decisionBytes = 0;
```

Add methods:

```ts
setConditionPlan(plan: ConditionPlan): void
appendDecisionBatches(batches: DecisionBatch[]): void
setDecisionTracingState(state: DecisionTracingState): void
```

When `decisionBytes + batchBytes > maxDecisionBytes`, set:

```ts
{ status: "truncated", reason: "decision_byte_limit" }
```

without changing `resourceLimitReached`.

- [ ] **Step 6: Route controller messages**

Handle decision messages before `execution_finished`. Merge terminal copies exactly as Expression Evidence does.

Malformed optional decision-stream messages must not invalidate an otherwise healthy execution; malformed ordinary worker protocol still follows existing controller rules.

- [ ] **Step 7: Run focused bridge verification**

```bash
npm test -- tests/execution/pyodide-runtime.test.ts tests/execution/pyodide-worker.test.ts tests/execution/execution-controller.test.ts tests/execution/trace-session-collector.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/worker/pyodide-runtime.ts src/worker/pyodide-worker.ts src/execution/execution-controller.ts src/execution/trace-session-collector.ts tests/execution/pyodide-runtime.test.ts tests/execution/pyodide-worker.test.ts tests/execution/execution-controller.test.ts tests/execution/trace-session-collector.test.ts
git commit -m "feat: stream decision evidence"
```

---

### Task 5: Interpret Short-Circuit, Partial, Branch-Chain, and While History Evidence

**Files:**
- Create: `src/core/decision-interpreter.ts`
- Create: `tests/core/decision-interpreter.test.ts`
- Modify: `src/core/trace-interpreter.ts`
- Modify: `tests/core/trace-interpreter.test.ts`

**Interfaces:**

Primary API:

```ts
buildDecisionEvidence(
  plan: ConditionPlan | undefined,
  batches: DecisionBatch[],
  runtimeStates: RuntimeState[]
): {
  byStep: DecisionEvidenceByStep;
  historyBySite: DecisionHistoryBySite;
  chains: DecisionChainEvidence[];
}
```

`TraceInterpretation` adds:

```ts
decisionEvidence: DecisionEvidenceByStep;
decisionHistory: DecisionHistoryBySite;
decisionChains: DecisionChainEvidence[];
```

- [ ] **Step 1: Write failing interpreter tests for semantic state separation**

Create static plan + runtime batch fixtures for:

```text
False AND B  → B short_circuited / and_short_circuit
True OR B    → B short_circuited / or_short_circuit
False OR B   → B evaluated
True AND B   → B evaluated
partial AND after first true child → next required child partial, not short_circuited
```

Assert that no absent child receives a truth value.

- [ ] **Step 2: Build evidence trees from descriptors and captured evaluations**

Index plan metadata:

```ts
const conditionsById = new Map(plan.conditions.map((item) => [item.conditionId, item]));
const operandsById = new Map(plan.operands.map((item) => [item.operandId, item]));
```

For every batch, construct the root recursively. An explicitly captured condition truth gets:

```ts
status: "evaluated"
truth: capturedTruth
```

For a completed `and`, children after the first captured `false` child become:

```ts
status: "short_circuited",
skipReason: "and_short_circuit"
```

For a completed `or`, children after the first captured `true` child become `or_short_circuit`.

For a partial root, never convert missing children to short-circuit solely from absence. Mark the next semantically required missing child `partial` when previous captured children prove Python would have advanced to it.

- [ ] **Step 3: Reconstruct branch-chain evidence**

For each chain occurrence in one frame, use actual decision batches in branch order.

Rules:

```text
completed True if/elif  → selected; all later chain branches not_reached
completed False         → rejected; advance to next branch
all conditional branches False + else → else selected
partial branch          → that branch partial at step level; do not fabricate a selected branch
```

`selectedBranchIndex` is `null` for partial/incomplete chains.

- [ ] **Step 4: Build while history**

Group by `(frameId, siteId)` and sort by `occurrence`, then `batchId`.

Each history entry keeps the authoritative `anchorStep`; never derive navigation from array position.

- [ ] **Step 5: Integrate into `interpretTrace`**

Extend signature:

```ts
interpretTrace(
  events,
  relations,
  expressionPlan,
  expressionBatches,
  conditionPlan,
  decisionBatches
)
```

Call `buildDecisionEvidence(...)` after runtime-state reconstruction so later structure projection can use the matching runtime state.

Return the three new decision projections without modifying existing behavioral analysis inputs.

- [ ] **Step 6: Run core verification**

```bash
npm test -- tests/core/decision-interpreter.test.ts tests/core/trace-interpreter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/decision-interpreter.ts src/core/trace-interpreter.ts tests/core/decision-interpreter.test.ts tests/core/trace-interpreter.test.ts
git commit -m "feat: interpret decision evidence"
```

---

### Task 6: Project Safe Condition Operands Into List and Matrix Visuals

**Files:**
- Create: `src/core/decision-structure-projection.ts`
- Create: `tests/core/decision-structure-projection.test.ts`
- Modify: `src/core/decision-interpreter.ts`
- Modify: `src/core/visual-model.ts`
- Modify: `src/core/matrix-interpreter.ts`
- Modify: `src/sidepanel/components/ListVisualizer.ts`
- Modify: `src/sidepanel/components/MatrixVisualizer.ts`
- Modify: `tests/sidepanel/list-visualizer.test.ts`
- Modify: `tests/sidepanel/matrix-visualizer.test.ts`

**Interfaces:**
- `DecisionStepEvidence.structureReferences` contains only runtime-resolved, in-bounds List / Matrix references.
- Visual models receive `decisionReferences` separately from existing `expressionReferences`; do not overload Expression Evidence roles.

- [ ] **Step 1: Write failing projection tests**

Cover:

```python
nums[left]
grid[r][c]
nums[-1]
```

Require negative-index normalization using actual runtime sequence length.

Reject:

```text
out-of-bounds indexes
non-int index snapshots
missing matrix row/column operands
truncated/non-rectangular matrix coordinates
```

- [ ] **Step 2: Implement decision structure projection**

Follow the safe mechanics already used by `expression-structure-projection.ts`: use captured operand snapshots plus current runtime locals; never evaluate `source` strings.

Primary function:

```ts
projectDecisionStructureReferences(
  plan: ConditionPlan,
  batch: DecisionBatch,
  runtime: RuntimeState
): DecisionStructureReference[]
```

Only emit references whose operand IDs actually appear in the captured batch.

- [ ] **Step 3: Attach references during decision interpretation**

When building each `DecisionStepEvidence`, resolve the runtime state whose `step === batch.anchorStep` and assign the projection result.

Missing runtime state yields `[]`, not guessed coordinates.

- [ ] **Step 4: Extend visual models with a separate decision overlay channel**

Add:

```ts
decisionReferences: DecisionStructureReference[];
```

to `ListVisualModel` and `MatrixVisualModel`.

Extend `buildVisualState(...)` with a decision-reference parameter after the existing expression-reference parameter. Filter references by `variableName` in `buildListVisual` / `buildMatrixVisuals`.

- [ ] **Step 5: Render condition operand focus without changing existing expression styling**

In `ListVisualizer.ts`, mark referenced cells with:

```text
data-decision-operand="true"
```

In `MatrixVisualizer.ts`, do the same for referenced cells.

Do not draw branch arrows or causal mutation labels.

If a cell is both an expression operand and a decision operand, render both semantic states through independent classes/data attributes rather than choosing one.

- [ ] **Step 6: Run projection/visualizer verification**

```bash
npm test -- tests/core/decision-structure-projection.test.ts tests/sidepanel/list-visualizer.test.ts tests/sidepanel/matrix-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/decision-structure-projection.ts src/core/decision-interpreter.ts src/core/visual-model.ts src/core/matrix-interpreter.ts src/sidepanel/components/ListVisualizer.ts src/sidepanel/components/MatrixVisualizer.ts tests/core/decision-structure-projection.test.ts tests/sidepanel/list-visualizer.test.ts tests/sidepanel/matrix-visualizer.test.ts
git commit -m "feat: project decision operands onto structures"
```

---

### Task 7: Render Decision Evidence, Branch Chains, and Navigable While History

**Files:**
- Create: `src/sidepanel/components/DecisionEvidence.ts`
- Create: `tests/sidepanel/decision-evidence.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

**Interfaces:**

Component API:

```ts
export interface DecisionEvidenceOptions {
  evidence: DecisionStepEvidence | undefined;
  tracingState: DecisionTracingState | undefined;
  chain: DecisionChainEvidence | undefined;
  history: readonly DecisionHistoryEntry[];
  onNavigateStep(step: number): void;
}

export function createDecisionEvidence(options: DecisionEvidenceOptions): HTMLElement;
```

- [ ] **Step 1: Write failing DOM tests for distinct semantic states**

Require separate DOM/data states for:

```text
evaluated true
evaluated false
short_circuited
not_reached
partial
selected branch
rejected branch
loop_body_entered
loop_exited
```

Test that `short_circuited` text never appears as `False`.

- [ ] **Step 2: Implement recursive condition rendering**

Render every node with stable attributes:

```text
data-condition-id
data-condition-status
data-condition-truth  # only when truth exists
```

Render operand source/value rows using the existing `formatValue` helper.

For skipped children, show factual reason text:

```text
AND short-circuited
OR short-circuited
Earlier branch selected
```

- [ ] **Step 3: Implement branch-chain and while-history sections**

Branch chain rows show:

```text
if / elif / else
Selected / Rejected / Not reached
```

While history buttons carry:

```ts
button.dataset.anchorStep = String(entry.anchorStep);
button.addEventListener("click", () => options.onNavigateStep(entry.anchorStep));
```

Use raw trace `step`, not visual array index, at the component boundary.

- [ ] **Step 4: Integrate Decision panel into `TraceVisualizer`**

Pass new decision inputs into `interpretTrace(...)`:

```ts
session.conditionPlan,
session.decisionBatches ?? []
```

Create `Decision Evidence` between `Visual State` and `Expression Evidence` only when the session has a condition plan or decision batches.

Build a `step -> raw index` map from the existing trace index and adapt history navigation:

```ts
const index = traceIndex.stepToIndex.get(step);
if (index !== undefined) navigateDirect(index);
```

Preserve the panel's `open` state across `setStep` renders.

- [ ] **Step 5: Add active-line factual badge**

When the current raw step has completed Decision Evidence, add one compact badge to the code metadata:

```text
condition True
condition False
```

If the evidence contains short-circuited descendants, append `· short-circuit`.

For partial evidence show `condition partial`; do not infer True/False.

- [ ] **Step 6: Style without adding a new timeline lane**

Add scoped classes under `.trace-viewer__decision-panel` and `.decision-evidence__*`.

Do not modify Behavioral Timeline lane kinds or Failure-First selection.

- [ ] **Step 7: Run sidepanel verification**

```bash
npm test -- tests/sidepanel/decision-evidence.test.ts tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/components/DecisionEvidence.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/decision-evidence.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: render decision evidence"
```

---

### Task 8: Add Representative End-to-End Decision Tracing Coverage

**Files:**
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/execution/trace-session-collector.test.ts`
- Create: `tests/core/decision-e2e.test.ts`
- Modify: `tests/sidepanel/bootstrap.test.ts`

**Interfaces:**
- Exercises the complete source -> Python instrumentation -> worker normalization -> TraceSession -> core interpretation path.
- These tests validate factual replay, not LeetCode Accepted status.

- [ ] **Step 1: Add Binary Search flow**

Use a small `Solution.search` fixture with:

```python
while left <= right:
    mid = (left + right) // 2
    if nums[mid] < target:
        left = mid + 1
    elif nums[mid] > target:
        right = mid - 1
    else:
        return mid
```

Assert:

```text
while has multiple ordered occurrences
one if/elif/else chain contains selected/rejected/not-reached statuses
nums[mid] decision operand resolves to a List reference when capturable
```

- [ ] **Step 2: Add short-circuit / side-effect flow**

Use:

```python
if i < len(nums) and nums[i] == target:
```

with `i == len(nums)` and assert:

```text
first child false
second child short_circuited
no out-of-range exception
```

- [ ] **Step 3: Add Sliding Window while flow**

Use nested `while` conditions and assert site IDs maintain independent occurrence histories.

- [ ] **Step 4: Add Linked List / Grid guard flows**

Linked list:

```python
while node is not None:
```

Grid:

```python
if grid[r][c] == 1:
```

Assert factual final truth and Matrix operand reference; do not assert algorithm semantics.

- [ ] **Step 5: Add timeout/exception prefix preservation**

For a loop that eventually times out or hits trace limit, assert already streamed Decision Batches remain in the forced terminal session.

For a condition that raises after an earlier boolean child, assert the final occurrence is `partial` with no `outcome`.

- [ ] **Step 6: Run end-to-end verification**

```bash
npm test -- tests/core/decision-e2e.test.ts tests/execution/pyodide-runtime.test.ts tests/execution/trace-session-collector.test.ts tests/sidepanel/bootstrap.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/core/decision-e2e.test.ts tests/execution/pyodide-runtime.test.ts tests/execution/trace-session-collector.test.ts tests/sidepanel/bootstrap.test.ts
git commit -m "test: validate decision tracing end to end"
```

---

### Task 9: Update Product Documentation and Run Full Regression Gates

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`

**Interfaces:**
- Documentation must preserve the factual-evidence boundary and describe unsupported semantics explicitly.

- [ ] **Step 1: Update the feature pipeline in both READMEs**

Add Decision Evidence after Expression Evidence:

```text
RuntimeState + FrameDiff/ObjectDiff
        ↓
RuntimeMutation
        ↓
Expression Evidence
        ↓
Decision Evidence
        ↓
Visual interpretation + Behavioral Evidence Navigation
```

- [ ] **Step 2: Add concise user-facing capability text**

Document:

```text
if / elif / while decision replay
nested and/or/not
short-circuit shown as not evaluated
while decision history
List / Matrix condition operand highlighting
```

State explicitly:

```text
Decision Evidence does not judge whether the selected branch was correct.
Chained-comparison decomposition, for-loop semantics, break/continue causality,
expected-path comparison, and automatic bug fixes are not part of v0.1.
```

- [ ] **Step 3: Run Python semantic-preservation fixtures**

```bash
python3 -m unittest tests/fixtures/python/test_condition_instrumenter.py tests/fixtures/python/test_decision_recorder.py tests/fixtures/python/test_expression_instrumenter.py
```

Expected: PASS.

- [ ] **Step 4: Run the complete project test suite**

```bash
npm test
```

Expected: PASS with no regressions in Expression Evidence, behavioral signals, Failure-First, or structure visualizers.

- [ ] **Step 5: Run typecheck and production build**

```bash
npm run typecheck
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 6: Inspect the final diff for scope violations**

Verify no production code adds:

```text
correct/incorrect branch labels
expected-path inference
Decision lane in Behavioral Timeline
Failure-First weighting from Decision Evidence
source-expression coloring
algorithm-specific decision heuristics
```

Also verify `TRACE_SCHEMA_VERSION === 4` and older decision-less trace fixtures remain accepted.

- [ ] **Step 7: Commit**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: document decision tracing"
```

---

## Implementation Order and Review Gates

Execute tasks strictly in this order:

```text
1. Shared protocol/schema
2. Static planner + AST rewrite
3. Runtime recorder + semantic preservation
4. Worker/session streaming
5. Core interpretation
6. Structure projection
7. Sidepanel UX
8. End-to-end coverage
9. Documentation + full regression
```

Do not start UI work before Tasks 1–5 are reviewed and passing. The highest-risk review gates are:

```text
Task 2 → AST rewrite preserves Python semantics and safely falls back to opaque evidence
Task 3 → user truth/comparison/side effects execute the same number of times
Task 5 → absent evidence is never mislabeled as False or short-circuited
Task 8 → timeout/exception still preserve factual evidence prefixes
```

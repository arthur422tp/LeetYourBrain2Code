# Expression Tracing Foundation

## Design Spec v0.1

---

# 1. Goal

LeetYourBrain2Code already captures factual Python runtime state through line-level tracing and renders specialized structures including List, Dict, Linked List, Tree, Graph, and Matrix / Grid views.

The next milestone is **Expression Tracing Foundation v0.1**.

The goal is to explain how a value was computed without turning the product into a solver or correctness engine.

The current runtime stack can answer:

```text
Where is execution?
What state exists?
What changed?
```

Expression Tracing adds:

```text
How was this value computed?
```

For example:

```python
dp[i] = max(dp[i - 1], dp[i - 2] + nums[i])
```

v0.1 should be able to present factual evidence such as:

```text
dp[i - 1]           = 8
dp[i - 2]           = 5
nums[i]              = 6
dp[i - 2] + nums[i] = 11
max(8, 11)           = 11
selected operand     = dp[i - 2] + nums[i]
assignment target    = dp[i]
```

This milestone is intentionally generic. It is motivated by dynamic-programming transitions, but the architecture must support future condition and decision tracing without being DP-specific.

Core acceptance statement:

> Given a supported assignment RHS or return expression, LeetYourBrain2Code can capture its runtime operand/result values exactly once, preserve original Python evaluation semantics, align the evidence with the line execution that produced it, render an expression evidence tree, and project safe structure references without inferring correctness or algorithm intent.

---

# 2. Product Principle

The project keeps its central rule:

> Visualize what the program actually did.

Expression Tracing introduces a new factual evidence channel alongside existing state and mutation evidence.

```text
Line trace          → where execution is
Runtime state       → what state exists
Runtime mutation    → what changed
Expression evidence → how a value was computed
```

A later phase may add:

```text
Decision evidence   → why control flow chose this path
```

v0.1 must not cross that boundary.

Expression evidence must never:

- infer the intended recurrence;
- classify an algorithm;
- compare against a known correct solution;
- diagnose a root cause;
- recommend a fix;
- re-evaluate user expressions to reconstruct missing evidence.

---

# 3. Scope

Expression Tracing Foundation v0.1 includes:

1. AST-based expression instrumentation before compilation;
2. stable expression identity derived from the original AST;
3. source-span and source-text metadata for supported expressions;
4. assignment RHS roots;
5. return-expression roots;
6. runtime value probes that return the original value unchanged;
7. supported expression kinds for Name, Literal, Subscript, Attribute, Unary, Binary, and Call;
8. nested expression evidence trees;
9. evaluation-order metadata;
10. line-step and frame alignment through `anchorStep + frameId`;
11. call-level `min(...)` / `max(...)` selection evidence when it can be proven safely;
12. fail-closed selection semantics;
13. fail-open instrumentation behavior;
14. partial evidence preservation when an expression raises;
15. expression-specific event / byte limits that cannot terminate ordinary tracing;
16. best-effort streaming so timeout / TLE-like termination can retain already captured expression evidence;
17. an `Expression Evidence` panel synchronized with the existing trace step;
18. safe structure-reference projection for List / Matrix overlays;
19. unit, integration, DOM, semantic-preservation, and regression tests.

---

# 4. Explicit Non-Goals

Expression Tracing v0.1 does not implement:

- comparison semantics;
- `and` / `or` short-circuit explanation;
- `if` / `elif` / `while` branch outcome evidence;
- conditional-expression (`a if cond else b`) decomposition;
- comprehension tracing;
- generator-expression tracing;
- lambda-body tracing;
- arbitrary `*args` / `**kwargs` call semantics;
- `min(iterable)` / `max(iterable)` selection explanation;
- `min(..., key=...)` / `max(..., key=...)` selection explanation;
- control-flow causality;
- DP recurrence detection;
- source-cell dependency arrows as an inference mechanism;
- cross-function expression trees;
- arbitrary alias/dataflow reconstruction;
- expected-vs-actual comparison;
- correctness diagnosis;
- automatic bug fixing;
- AI-generated explanations.

Comparison, boolean short-circuit, and branch evidence belong to a separate **Condition / Decision Tracing** phase built on this protocol.

---

# 5. Architectural Choice

Expression Tracing v0.1 uses **AST rewrite + transparent runtime probes + a side-channel evidence stream**.

The chosen architecture is:

```text
Original Python source
        │
        ├── parse original AST
        │      ├── ExpressionPlan
        │      └── source metadata
        │
        ▼
Expression Instrumenter
        │
        ▼
Instrumented AST
        │
        ▼
compile(<leetcode-user-code>)
        │
        ▼
Python execution
   ┌───────────────┴────────────────┐
   │                                │
   ▼                                ▼
sys.settrace                   expression probes
   │                                │
   ▼                                ▼
TraceEvent[]                    ExpressionBatch[]
line/state                      anchorStep + frameId
   │                                │
   └───────────────┬────────────────┘
                   ▼
          Expression Interpreter
                   │
                   ├── expression tree
                   ├── operand/result values
                   ├── min/max selection evidence
                   ├── assignment / return linkage
                   └── structure references
                   │
                   ▼
          Expression Evidence Panel
                   │
                   └── optional structure overlays
```

Core invariant:

```text
TraceEvent != RuntimeMutation != ExpressionEvidence
```

The three evidence types may be correlated, but none replaces the others.

---

# 6. Alternatives Considered

## 6.1 AST rewrite + runtime probes — selected

Advantages:

- captures intermediate values that line tracing cannot see;
- preserves a direct mapping back to the original AST;
- can preserve Python evaluation order;
- can avoid evaluating any user expression twice;
- provides a clean foundation for future comparison and branch evidence.

Primary cost:

- introduces an instrumentation layer that must be carefully constrained by semantic-preservation tests.

## 6.2 Bytecode / opcode tracing — rejected for v0.1

This could expose lower-level execution detail, but it would couple the product more tightly to Python bytecode details and runtime versions.

It also maps poorly to product-level concepts such as:

```text
this source expression
these candidate operands
this selected min/max operand
```

The project should reason in source-level execution concepts rather than CPython opcode structure.

## 6.3 Post-hoc reconstruction from locals / mutations — rejected

Intermediate expression values frequently disappear before the next line snapshot.

Re-evaluating or guessing them afterward would violate the factual-evidence principle and may execute side effects twice.

Therefore expression evidence must be captured during the original execution.

---

# 7. Root Boundary

v0.1 instruments exactly two expression-root categories:

```text
Assignment RHS
Return expression
```

Examples:

```python
x = a + b

dp[i] = max(dp[i - 1], dp[i - 2] + nums[i])

return dp[-1]
```

The following are not v0.1 roots by themselves:

```python
print(a + b)
foo(x * 2)
x + y
```

However, a supported call or arithmetic expression may appear inside an assignment or return root and participate in that root's expression tree.

This boundary keeps v0.1 focused on:

> how did this state/result value get computed?

---

# 8. Static Expression Plan

The original AST is analyzed before instrumentation.

Static metadata is captured once per execution request rather than repeated in every runtime event.

Conceptually:

```ts
interface ExpressionPlan {
  version: 1;
  roots: ExpressionRootDescriptor[];
  expressions: ExpressionDescriptor[];
}

interface SourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

type ExpressionKind =
  | "name"
  | "literal"
  | "subscript"
  | "attribute"
  | "unary"
  | "binary"
  | "call";

interface ExpressionDescriptor {
  exprId: string;
  rootId: string;
  parentExprId: string | null;
  kind: ExpressionKind;
  span: SourceSpan;
  source: string;
  childExprIds: string[];
}
```

`source` is captured in Python from the original source, for example with AST source-segment metadata, rather than reconstructed later in TypeScript from column offsets.

This is important because Python AST column offsets and JavaScript string indexing do not share identical character-offset semantics for every Unicode source string.

The static plan is derived from the unmodified user source.

---

# 9. Expression Identity

`exprId` represents a stable location in the original source AST.

It does not represent a runtime execution occurrence.

Recommended identity scheme:

```text
root ordinal + AST path
```

For example:

```text
r17
r17.0
r17.0.0
r17.1
```

Requirements:

- deterministic for the same original source;
- generated before AST rewriting;
- independent of expression text equality;
- duplicate source text at different locations must have different IDs;
- repeated loop execution reuses the same static `exprId`.

Example:

```python
for i in range(10):
    dp[i] = dp[i - 1] + 1
```

The `dp[i - 1]` expression has one static `exprId`, even though it may be evaluated many times.

Runtime occurrence identity is handled separately.

---

# 10. Root Metadata

Each root describes the computation destination.

Conceptually:

```ts
type ExpressionRootDescriptor =
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

interface AssignmentTargetDescriptor {
  source: string;
  span: SourceSpan;
}
```

The instrumentation layer does not interpret assignment targets as List or Matrix coordinates.

For example:

```python
dp[i][j] = ...
```

is statically described as target source:

```text
dp[i][j]
```

A later projection layer may safely resolve it to a concrete structure coordinate when enough runtime evidence exists.

Core invariant:

```text
instrumentation knows Python source
structure projection knows visual structure
```

The two responsibilities remain separate.

---

# 11. Supported Expression Shapes

Within a supported root, v0.1 recognizes these source-level kinds:

```text
Name read
Literal
Subscript read
Attribute read
Unary operation
Binary arithmetic operation
Call result
```

Representative examples:

```python
x
42
arr[i]
dp[i - 1][j]
node.val
-x
a + b
left + right * 2
min(a, b)
max(a, b, c)
foo(x)
```

Only `Load`-context reads are instrumented as expression operands.

Store-context assignment targets are metadata, not ordinary value probes.

## 11.1 Generic calls

A generic function call inside a supported root may contribute:

- supported argument-expression evidence;
- the call's final result value.

v0.1 does not merge the called function's internal trace into the caller's expression tree.

Existing call-stack and line-trace machinery remains responsible for user-function execution.

## 11.2 Unsupported root shapes

A root that requires unsupported expression semantics is omitted from expression tracing rather than partially reinterpreted in a misleading way.

Examples include roots containing:

```python
[x * 2 for x in nums]
(x for x in nums)
lambda x: x + 1
a if cond else b
a and b
a or b
a < b
foo(*args, **kwargs)
```

Ordinary Python execution and line/state tracing must continue.

---

# 12. Runtime Expression Batch

Runtime evidence is grouped separately from `TraceEvent`.

Conceptually:

```ts
interface ExpressionBatch {
  anchorStep: number;
  frameId: number;
  line: number;
  roots: ExpressionRootEvaluation[];
}

interface ExpressionRootEvaluation {
  rootId: string;
  status: "completed" | "partial";
  evaluations: ExpressionEvaluation[];
  resultExprId?: string;
  selectionEvidence?: SelectionEvidence[];
}

interface ExpressionEvaluation {
  evaluationId: number;
  exprId: string;
  order: number;
  value: ValueSnapshot;
}
```

`evaluationId` is runtime identity and may be session-monotonic.

`order` records the observed evaluation order inside the batch.

The static AST tree determines visual hierarchy; runtime order records actual execution order.

These are intentionally separate concepts.

---

# 13. Anchor Semantics

Expression probes execute after the line event that begins execution of that source line.

Therefore every runtime expression batch is anchored to:

```text
anchorStep + frameId
```

`anchorStep` is the raw trace step whose line event began the execution segment containing the expression.

Example:

```text
TraceEvent step 42
line = 17

→ line 17 executes
→ expression probes run
→ ExpressionBatch(anchorStep=42, frameId=3, line=17)
→ next line / return / exception trace event occurs
```

The UI interprets this as:

> expression evidence produced while executing the source line represented by step 42.

It must not pretend that each operand is a separate ordinary execution step.

The runtime bridge must maintain the latest active line-step anchor per user frame so probes can attach to the correct `anchorStep` and `frameId`.

---

# 14. Partial Evaluation and Exceptions

Expression evidence captured before an exception must not be discarded merely because the root never produced a final result.

Example:

```python
x = left + (10 / 0)
```

Possible factual evidence:

```text
left      → 5
10        → 10
0         → 0
10 / 0    → no result; exception interrupted evaluation
root      → partial
```

The root is represented with:

```text
status = partial
```

and no `resultExprId` if the root result probe never completed.

The original runtime exception remains authoritative and continues through the existing exception trace path.

Expression tracing must never replace it with an instrumentation exception.

---

# 15. Semantic Preservation Rules

Expression instrumentation is acceptable only if it preserves user-program behavior.

The design requires these invariants:

```text
1. Every original expression is evaluated at most once.
2. Python's original user-expression evaluation order is preserved.
3. Source text is never re-evaluated to reconstruct evidence.
4. Tracing must not introduce extra calls to user code.
5. Instrumentation failure must not replace a user exception.
6. Original source lines and spans remain the source of truth.
```

For an ordinary expression, the conceptual probe is:

```python
__lc_expr(expr_id, original_expression)
```

where the helper only:

```text
serialize / record value
return the exact same Python object/value
```

The helper must not coerce, copy, compare, or recompute the user value unless a separately defined evidence rule explicitly permits safe snapshot comparison.

---

# 16. Probe Namespace and Source Fidelity

Instrumentation helpers use a reserved internal prefix:

```text
__lc_
```

This matches the existing tracer convention that excludes `__lc_*` locals from the Locals UI.

Requirements:

- helpers are injected into the runtime namespace;
- users do not need to modify their source;
- instrumented code still compiles with `<leetcode-user-code>` as the filename;
- AST nodes retain original `lineno`, `col_offset`, `end_lineno`, and `end_col_offset` where applicable;
- parse errors originate from the original user source;
- the code panel always displays original source, never rewritten source.

---

# 17. `min` / `max` Selection Evidence

`min(...)` and `max(...)` are the only v0.1 calls with higher-level call evidence.

The goal is to show which candidate value the built-in selected when that fact can be proven without re-running the comparison.

Conceptually:

```ts
interface SelectionEvidence {
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
```

## 17.1 Runtime callable identity

Static source text alone is not enough to prove that a name `min` or `max` refers to the Python built-in.

User code may shadow it:

```python
min = custom_function
x = min(a, b)
```

Therefore instrumentation must preserve and observe the actual callable identity without evaluating it twice.

Conceptually the callee load may be wrapped by a value-preserving internal probe that records whether the runtime callable object is exactly the corresponding built-in while returning the same callable unchanged.

The original call still invokes the original resolved callable exactly once.

Selection evidence is eligible only when runtime identity proves that the callable is the actual built-in `min` or `max`.

## 17.2 Supported call shape

Selection resolution is limited to positional multi-candidate form:

```python
min(a, b)
min(a, b, c)
max(a, b)
max(a, b, c)
```

Not resolved in v0.1:

```python
min(items)
max(items)
min(a, b, key=f)
max(a, b, key=f)
min(*values)
```

These calls may still expose ordinary call-result evidence when safely instrumented, but `selectedCandidateIndex` remains null.

## 17.3 Fail-closed selected operand

The tracer must never call `min` / `max` a second time and must never replay candidate comparisons.

Selection is resolved only when:

- the call shape is supported;
- the runtime callable is proven to be the Python built-in;
- every candidate and result has a safely comparable serialized primitive representation;
- the returned result can be mapped back to candidate snapshots without executing user comparison code.

Safe selection primitives for v0.1 are restricted to simple immutable scalar snapshots such as:

```text
int
bool
str
finite float
```

NaN and unsupported/custom values fail closed.

When multiple candidate snapshots match the result, built-in Python `min` / `max` uses the first winning positional candidate, so the first matching eligible candidate may be selected.

Example:

```python
x = min(5, 3, 3)
```

may yield:

```text
candidate 0 = 5
candidate 1 = 3  ← selected
candidate 2 = 3
result      = 3
```

If this cannot be established safely:

```text
selectedCandidateIndex = null
```

The UI still shows factual candidates and result.

---

# 18. Runtime Order vs Visual Tree

The expression panel must not confuse raw probe order with AST structure.

For:

```python
dp[i - 2] + nums[i]
```

runtime probes may occur in an order corresponding to Python evaluation details, while the useful visual hierarchy is:

```text
dp[i - 2] + nums[i] = 11
├── dp[i - 2] = 5
└── nums[i] = 6
```

Rules:

```text
ExpressionPlan parent/child relationships → visual hierarchy
ExpressionEvaluation.order              → actual observed evaluation order
```

The UI may use the hierarchy by default and preserve runtime order as inspectable factual metadata.

It must not derive causality merely from visual tree position.

---

# 19. Interpreter Integration

Expression evidence does not become part of `RuntimeState`.

The current line/state/mutation pipeline remains intact.

Conceptually:

```text
TraceEvent[]
   ↓
reconstructStates()
   ↓
RuntimeState[] ───────────────────────┐
                                     │
ExpressionPlan + ExpressionBatch[]   │
   ↓                                 │
buildExpressionEvidence()            │
   ↓                                 │
ExpressionEvidenceByStep ────────────┤
                                     ▼
                            TraceInterpretation
```

`TraceInterpretation` gains an expression-evidence field conceptually like:

```ts
interface TraceInterpretation {
  runtimeStates: RuntimeState[];
  frameDiffs: Array<FrameDiff | null>;
  objectDiffs: ObjectDiff[];
  mutationBatches: RuntimeMutationBatch[];
  behavioralAnalysis: BehavioralAnalysis;
  visualStates: VisualState[];
  expressionEvidence: ExpressionEvidenceByStep;
}

type ExpressionEvidenceByStep = Map<number, ExpressionStepEvidence>;
```

The map is keyed by raw trace `step`, not array index.

This avoids assuming that step numbers and array offsets are permanently interchangeable.

---

# 20. Expression Evidence Model

The interpreter combines static descriptors with runtime evaluations into renderer-ready evidence.

Conceptually:

```ts
interface ExpressionStepEvidence {
  anchorStep: number;
  frameId: number;
  roots: ExpressionEvidenceRoot[];
}

interface ExpressionEvidenceRoot {
  rootId: string;
  kind: "assignment" | "return";
  status: "completed" | "partial";
  target?: AssignmentTargetDescriptor;
  tree: ExpressionEvidenceNode;
  selections: SelectionEvidence[];
  structureReferences: StructureOperandReference[];
}

interface ExpressionEvidenceNode {
  exprId: string;
  kind: ExpressionKind;
  source: string;
  value?: ValueSnapshot;
  children: ExpressionEvidenceNode[];
}
```

The exact TypeScript decomposition may vary during implementation, but these semantic responsibilities must remain distinct.

---

# 21. Structure Reference Projection

Expression tracing may safely project runtime operands onto existing structural visuals.

Conceptually:

```ts
interface StructureOperandReference {
  exprId: string;
  variableName: string;
  kind: "list_index" | "matrix_cell";
  index?: number;
  row?: number;
  column?: number;
  role:
    | "operand"
    | "selected_operand"
    | "assignment_target";
}
```

For:

```python
dp[i][j] = min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j]
```

safe projection may produce:

```text
dp[1][3]  operand
dp[2][2]  selected_operand
dp[2][3]  assignment_target
grid[2][3] operand
```

Core invariant:

> Structure visualizers render expression-derived references; they do not derive expression semantics.

Matrix must not know what `min()` means.

List must not infer a recurrence.

The Expression Interpreter owns the expression semantics; structure visualizers only render already-resolved factual references.

---

# 22. Safe Coordinate Resolution

Structure projection is fail-closed.

A List or Matrix coordinate is emitted only when the interpreter can resolve the executed subscript to an actual integer coordinate from factual runtime evidence.

Negative Python sequence indices are normalized using the relevant captured structure length while preserving the original raw index when useful for inspection.

Out-of-range or unresolved coordinates do not produce fake structure references.

Complex aliases or expressions that cannot be safely related to the visible structure remain only in the Expression Evidence panel.

Example:

```python
row = dp[i]
x = row[j]
```

v0.1 does not claim `row[j]` is `dp[i][j]` through alias analysis.

---

# 23. Step Semantics and Overlay Semantics

A trace `line` event represents the entry state immediately before the corresponding source line executes.

Expression evidence anchored to that step represents work performed during that line's execution segment.

Therefore the UI may simultaneously show:

```text
Visual State → entry state for the line
Expression Evidence → values computed while executing the line
```

This distinction must remain explicit.

Expression overlays may mark source operands and an assignment target coordinate on the entry-state structure, but they must not overwrite the visible structure cell value with the computed assignment result.

The actual state change remains represented by the subsequent authoritative runtime snapshot / mutation evidence.

This avoids creating a hybrid state that never existed as a captured `RuntimeState`.

---

# 24. Runtime Mutation Linkage

Expression evidence and RuntimeMutation are related factual channels but are not required to match one-to-one.

Example:

```python
x = obj.method()
```

The expression result may be one value while the call also mutates object state.

Therefore:

```text
ExpressionEvidence = what the computation produced
RuntimeMutation     = what captured runtime state changed
```

The UI may display an explicit linkage only when the target/result relationship can be proven safely.

If safe linkage is unavailable, both evidence streams remain visible independently.

Neither overwrites the other.

---

# 25. Expression Evidence Panel

The trace viewer gains a persistent panel:

```text
Expression Evidence
```

It follows the current raw trace step.

Example:

```text
Expression Evidence

Target: dp[i][j]
Result: 7

min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j] = 7
├── min(dp[i - 1][j], dp[i][j - 1]) = 3
│   ├── dp[i - 1][j] = 5
│   └── dp[i][j - 1] = 3  ← selected
└── grid[i][j] = 4
```

Return root example:

```text
return dp[-1] → 42
```

When the step has no expression evidence, the panel remains structurally present and displays:

```text
No expression evidence for this step.
```

The panel should not appear and disappear between steps, because that causes layout instability and weakens trace-step orientation.

---

# 26. Matrix / List Overlay

v0.1 may add visual roles to existing structure renderers:

```text
operand
selected operand
assignment target
```

These roles are independent of existing structure states such as:

```text
focus
changed
selected by user
```

A cell may therefore be both:

```text
selected_operand + focus
assignment_target + changed
```

if those facts coexist.

Expression-derived styling must remain factual and must not use semantic heatmaps or correctness colors.

The Expression Evidence panel remains the authoritative explanation surface; the overlay is a spatial projection aid.

---

# 27. Streaming and Timeout Resilience

The existing worker protocol streams `trace_batch` messages while execution is still running.

This is important for long-running or timeout/TLE-like executions because the worker may be terminated before a normal terminal result is produced.

Expression evidence must provide equivalent best-effort survivability.

v0.1 therefore introduces a separate worker side-channel rather than changing the payload semantics of existing `trace_batch` messages.

Conceptually:

```ts
type WorkerOutboundMessage =
  | { type: "trace_batch"; sessionId: string; events: TraceEvent[] }
  | {
      type: "expression_batch";
      sessionId: string;
      batches: ExpressionBatch[];
    }
  | ...;
```

Requirements:

- existing `trace_batch` consumers remain compatible;
- expression batches may stream independently;
- streamed expression batches use the same session ID;
- timeout handling preserves already received expression evidence;
- duplicate terminal/stream data is de-duplicated deterministically if both paths provide the same batch;
- streaming failure is best effort and must not stop user execution.

---

# 28. Trace Session Contract

The completed trace session may contain optional expression fields conceptually like:

```ts
interface TraceSession {
  // existing fields...
  expressionPlan?: ExpressionPlan;
  expressionBatches?: ExpressionBatch[];
  expressionTracing?: {
    status: "complete" | "truncated" | "unavailable";
    reason?: string;
  };
}
```

Because this extends the durable trace contract with a new evidence channel, the trace schema version should advance from v2 to v3.

Readers must remain tolerant of older traces that contain no expression fields.

Older traces continue to render with:

```text
No expression evidence for this step.
```

rather than failing validation.

---

# 29. Expression Limits

Expression tracing adds independent soft limits such as:

```text
maxExpressionEvents
maxExpressionBytes
```

Expression evidence is also bounded by the available overall session budget.

Critical rule:

> expression-budget exhaustion must not terminate ordinary execution or ordinary line/state tracing.

When the expression evidence budget is exhausted:

```text
expressionTracing.status = truncated
```

Further expression recording becomes a no-op or stops cleanly, while:

```text
TraceEvent[]
RuntimeState
RuntimeMutation
Behavioral Analysis
```

continue according to existing limits.

Expression evidence must be dropped before it can independently cause the session to terminate with `trace_byte_limit`.

The UI surfaces factual truncation state without implying missing evidence was semantically irrelevant.

---

# 30. Fail-Open Instrumentation

Expression tracing is an enhancement, not an execution prerequisite.

If instrumentation cannot safely support the source:

```text
expression tracing unavailable for affected root / request
             ↓
ordinary compile / execution / trace path continues
```

The instrumenter must distinguish:

```text
original source parse error
```

from:

```text
instrumentation unsupported/failure
```

An original parse error remains the existing user-facing syntax error.

An internal instrumentation failure must not be presented as if the user's Python program failed.

When practical, the runner falls back to compiling and executing the original uninstrumented AST/source for ordinary tracing.

---

# 31. Behavioral Analysis Boundary

Expression evidence v0.1 does not directly change Behavioral Pattern detection.

Existing patterns such as:

```text
Repeated State
No Progress
Repeated Transition
```

continue to operate on their established evidence.

This is deliberate.

A later Behavioral Debugging phase may consume expression / decision evidence after the expression protocol is stable.

v0.1 must not couple the new instrumentation layer to heuristic behavioral classification.

---

# 32. Example: Minimum Path Sum

For a line such as:

```python
dp[i][j] = min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j]
```

Expression v0.1 should be capable of factual evidence like:

```text
root kind: assignment
target: dp[i][j]

min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j] = 7
├── min(dp[i - 1][j], dp[i][j - 1]) = 3
│   ├── dp[i - 1][j] = 5
│   └── dp[i][j - 1] = 3  ← selected
└── grid[i][j] = 4
```

Possible structure references:

```text
dp[i - 1][j]  → operand
dp[i][j - 1]  → selected_operand
grid[i][j]     → operand
dp[i][j]       → assignment_target
```

It must not claim:

```text
this is the correct recurrence
left is the correct predecessor
this path is optimal
this update fixes the answer
```

---

# 33. Example: House Robber

For:

```python
dp[i] = max(dp[i - 1], dp[i - 2] + nums[i])
```

expected evidence may be:

```text
dp[i - 1] = 8

dp[i - 2] + nums[i] = 11
├── dp[i - 2] = 5
└── nums[i] = 6

max(8, 11) = 11
selected = candidate 1

target = dp[i]
```

This demonstrates why the architecture is not Matrix-specific.

The same expression evidence engine works with List-backed DP.

---

# 34. Example: Duplicate `min` Candidate

For:

```python
x = min(5, 3, 3)
```

if runtime identity proves the built-in and all values are eligible:

```text
5
3 ← selected
3
result = 3
```

No second `min()` invocation occurs.

No candidate comparison is replayed.

Selection is derived from the actual result snapshot and Python's first-winning positional rule.

---

# 35. Example: Side Effects Must Execute Once

For:

```python
x = arr.pop() + arr.pop()
```

instrumentation must preserve exactly two original `pop()` calls.

It must never do something equivalent to:

```python
original = arr.pop() + arr.pop()
record(arr.pop() + arr.pop())
```

or re-evaluate either call afterward.

Semantic-preservation tests for side-effecting calls are mandatory release gates.

---

# 36. Example: Runtime Exception

For:

```python
x = 10 / 0
```

possible evidence:

```text
10 → 10
0  → 0
root status → partial
```

There is no fabricated division result.

The existing runtime exception path remains authoritative:

```text
ZeroDivisionError
```

---

# 37. Testing Strategy

Expression Tracing requires layered tests because correctness includes both captured data and preserved program semantics.

## 37.1 AST / plan tests

Verify:

- assignment root detection;
- return root detection;
- stable root / expression IDs;
- parent-child structure;
- source spans;
- exact source snippets;
- supported expression kinds;
- unsupported root rejection;
- no instrumentation of Store contexts;
- original location metadata preservation.

## 37.2 Instrumentation semantic tests

Verify that instrumented and uninstrumented programs produce the same observable program behavior for supported cases:

- scalar arithmetic;
- nested arithmetic;
- negative values;
- subscript reads;
- attribute reads;
- function calls;
- side-effecting calls;
- exceptions;
- mutable object identity;
- user-shadowed `min` / `max`;
- evaluation order.

Particularly important:

```python
x = arr.pop() + arr.pop()
```

must mutate `arr` exactly as ordinary Python execution does.

## 37.3 Python runtime probe tests

Verify:

- values are serialized once captured;
- returned Python objects/values remain unchanged;
- batches attach to the correct `anchorStep` and `frameId`;
- repeated loop execution reuses static IDs but produces new runtime evaluations;
- partial batches survive exceptions;
- expression limits truncate only expression evidence;
- unsupported/instrumentation failure falls back to ordinary tracing.

## 37.4 `min` / `max` tests

Verify:

- built-in runtime identity;
- shadowed names do not receive built-in selection semantics;
- positional two-candidate calls;
- positional multi-candidate calls;
- duplicate winning values;
- unsupported iterable form;
- unsupported `key=` form;
- unsupported custom values;
- NaN fail-closed behavior;
- candidate evaluation occurs exactly once.

## 37.5 TypeScript interpreter tests

Verify:

- ExpressionPlan + ExpressionBatch reconstruct the expected tree;
- `anchorStep` lookup uses raw trace step;
- completed vs partial roots;
- selection evidence attachment;
- assignment metadata;
- return metadata;
- List structure reference projection;
- Matrix structure reference projection;
- unresolved references fail closed;
- negative index normalization;
- older traces without expression data remain valid.

## 37.6 Worker streaming tests

Verify:

- `trace_batch` behavior remains unchanged;
- new `expression_batch` messages validate correctly;
- session IDs remain isolated;
- streaming + terminal evidence de-duplicates correctly;
- already received expression evidence survives timeout termination;
- stream failures do not stop execution.

## 37.7 DOM / UI tests

Verify:

- Expression Evidence panel follows current trace step;
- no-evidence state remains stable;
- tree hierarchy renders correctly;
- selected candidate is marked only when resolved;
- partial root state is explicit;
- expression truncation is visible;
- Matrix / List overlays follow expression references;
- overlay state disappears when navigating to a step without matching evidence;
- existing visualizer lifecycles remain stable.

## 37.8 Full regression gates

The implementation plan must preserve the repository's existing gates:

```bash
npm test
npm run typecheck
npm run build
```

---

# 38. Compatibility and Migration

Expression Tracing extends rather than replaces existing tracing.

Required compatibility behavior:

```text
old trace without ExpressionPlan / ExpressionBatch
→ existing visualization still works
→ Expression panel shows no evidence
```

Existing:

- `TraceEvent` semantics;
- RuntimeState reconstruction;
- RuntimeMutation authority;
- Matrix interpretation;
- Behavioral Analysis;
- Trace Folding;
- Failure-First behavior;

must not depend on expression evidence being present.

Expression tracing may be disabled or unavailable while the rest of the debugger remains functional.

---

# 39. Acceptance Criteria

Expression Tracing Foundation v0.1 is complete when all of the following hold:

1. supported assignment RHS and return expressions are discovered from the original AST;
2. instrumentation runs before compilation while preserving original source positions;
3. supported operands and intermediate results are captured during original execution;
4. no captured user expression is deliberately evaluated twice for tracing;
5. side-effecting supported expressions preserve ordinary Python behavior;
6. runtime expression evidence is aligned to `anchorStep + frameId`;
7. repeated expression execution is distinguishable from static expression identity;
8. completed and partial expression roots are represented correctly;
9. positional built-in `min` / `max` can expose a selected candidate only under the fail-closed rules;
10. shadowed/custom `min` / `max` calls do not receive false built-in semantics;
11. expression evidence streams before terminal completion so timeout/TLE-like sessions can retain prior evidence;
12. expression limits cannot independently terminate ordinary tracing;
13. the Expression Evidence panel follows trace navigation;
14. List / Matrix overlays render only safe resolved references;
15. structure visualizers do not infer expression semantics;
16. older traces without expression evidence remain usable;
17. unsupported expression shapes fail open to ordinary tracing;
18. existing test/typecheck/build gates pass.

---

# 40. Future Extension Path

The protocol is intentionally designed so future phases can extend it rather than replace it.

Recommended progression:

```text
Expression Tracing Foundation v0.1
        ↓
Comparison evidence
        ↓
Boolean + short-circuit evidence
        ↓
Condition / branch outcome evidence
        ↓
Behavioral Debugging v2
```

Future expression kinds may include:

```text
compare
boolop
conditional
```

Future decision evidence may include:

```text
condition result
short-circuit point
executed branch
loop continuation / exit
```

Those phases should reuse:

```text
static source identity
runtime evaluation occurrence
anchorStep + frameId alignment
side-channel evidence
source-span metadata
structure-reference projection
```

rather than introducing a second tracing architecture.

---

# 41. Final Design Rule

Expression Tracing Foundation v0.1 is not a DP solver and not a correctness engine.

Its responsibility is narrower and more reusable:

> Capture and visualize the actual runtime computation that transforms operands into a value.

The architecture keeps four truths separate:

```text
Line trace          = where execution is
Runtime state       = what state exists
Runtime mutation    = what changed
Expression evidence = how a value was computed
```

That separation is the foundation for later answering a fifth question without inference-heavy shortcuts:

```text
Decision evidence = why control flow took this path
```

# Condition / Decision Tracing

## Design Spec v0.1

---

# 1. Goal

LeetYourBrain2Code already captures factual runtime state, mutations, expression evidence, behavioral patterns, and structure-specific visualizations.

The next milestone is **Condition / Decision Tracing v0.1**.

The goal is to explain why Python control flow followed a particular executed path without turning the product into a solver, correctness engine, or expected-path analyzer.

The current evidence stack can answer:

```text
Runtime state       → what state exists
Runtime mutation    → what changed
Expression evidence → how a value was computed
Behavioral evidence → what repeated or stalled over time
```

Condition / Decision Tracing adds:

```text
Decision evidence   → how a condition evaluated and which control-flow path Python selected
```

Representative example:

```python
if left < right and nums[i] != target:
    ...
```

v0.1 should be able to present factual evidence such as:

```text
left < right
3 < 3
→ False

nums[i] != target
→ not evaluated
  reason: AND short-circuited after the previous False operand

overall condition → False
decision          → branch not entered
```

Core acceptance statement:

> Given a supported `if`, `elif`, or `while` condition, LeetYourBrain2Code can capture the condition's factual runtime evaluation, preserve Python evaluation and short-circuit semantics, distinguish evaluated values from skipped operands, align each decision occurrence with the authoritative raw trace, reconstruct branch-chain outcomes, and render the evidence without judging correctness or intended behavior.

---

# 2. Product Principle and Epistemic Boundary

The project keeps its central rule:

> Visualize what the program actually did.

Decision evidence may state:

- an operand was evaluated;
- an operand produced a captured value;
- an atomic condition became true or false;
- a boolean child was short-circuited;
- a branch was selected, rejected, or not reached;
- a loop condition admitted another iteration or exited the loop;
- a condition evaluation was interrupted before completion.

Decision evidence must never state or imply:

- that the selected branch was correct or incorrect;
- that another branch should have been selected;
- that a condition was written incorrectly;
- that a loop should have terminated earlier or later;
- the user's intended control flow;
- the expected path from a known-correct solution;
- a root-cause diagnosis;
- a recommended fix;
- an algorithm classification used to fill missing evidence.

The factual boundary is:

```text
actual evaluation → yes
actual branch outcome → yes
expected evaluation → no
correct branch → no
bug diagnosis → no
```

---

# 3. Architectural Choice

Decision Tracing uses the existing source-level instrumentation foundation but introduces a **separate evidence channel** from Expression Tracing.

```text
Original Python AST
        │
        ├── ExpressionPlan
        │      └── assignment / return computation
        │
        └── ConditionPlan
               └── if / elif / while decision sites
                      │
             semantic-preserving probes
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
 ExpressionBatch             DecisionBatch
 "how value formed"          "why path chosen"
          │                       │
          ▼                       ▼
 ExpressionEvidence          DecisionEvidence
          └───────────┬───────────┘
                      ▼
             synchronized debugger UI
```

Core invariant:

```text
TraceEvent != RuntimeMutation != ExpressionEvidence != DecisionEvidence
```

The evidence channels may correlate through the same raw execution coordinate, but none replaces another.

Decision Tracing reuses the existing worker/runtime lifecycle, session anchoring, streaming, and limit patterns. It does not introduce a second tracing runtime.

---

# 4. Scope

Condition / Decision Tracing v0.1 includes:

1. static `ConditionPlan` generation from the original AST;
2. supported decision sites for `if`, `elif`, and `while`;
3. normalization of `if / elif / else` chains into one logical branch chain;
4. supported truth tests such as `if node:`;
5. comparisons using `==`, `!=`, `<`, `<=`, `>`, `>=`, `is`, `is not`, `in`, and `not in`;
6. unary `not`;
7. nested `and` / `or` condition trees in truth-test context;
8. factual short-circuit evidence;
9. explicit distinction between evaluated, short-circuited, not-reached, and partial states;
10. per-occurrence loop-condition history for `while`;
11. raw protocol fields for `conditionPlan`, `decisionBatches`, and `decisionTracing`;
12. core interpretation into `DecisionEvidenceByStep` and branch-chain projections;
13. a synchronized `Decision Evidence` side-panel view;
14. `Decision History` for repeated `while` checks;
15. safe List / Matrix operand-reference projection when runtime evidence resolves coordinates;
16. independent decision-event and decision-byte limits;
17. best-effort streaming so captured evidence can survive timeout or trace termination;
18. schema-version migration with backward-compatible reading of older traces;
19. semantic-preservation, protocol, interpreter, DOM, integration, and representative end-to-end tests.

---

# 5. Explicit Non-Goals

v0.1 does not implement:

- correctness judgment;
- expected-vs-actual branch comparison;
- control-flow root-cause diagnosis;
- bug-fix suggestions;
- branch recommendations;
- `for`-loop semantics;
- `break`, `continue`, or `return` causality;
- ternary-expression tracing (`a if cond else b`);
- `match / case`;
- `assert` decision tracing;
- comprehension filters;
- generator filters;
- `all()` / `any()` internal iteration tracing;
- source-level expression coloring or AST-span overlays in the code editor;
- control-flow arrows drawn over data structures;
- automatic causal linkage from a decision to a later mutation;
- algorithm-specific branch semantics;
- generic behavioral classification of decision sequences;
- Failure-First prioritization based on nearby Decision Evidence.

Chained comparison decomposition is excluded from v0.1. A condition such as:

```python
0 <= i < n
```

may be represented as an opaque condition with a captured final truth value, but v0.1 must not fabricate separate evidence for `0 <= i` and `i < n` unless the implementation can preserve Python's single-evaluation semantics for the shared middle operand.

---

# 6. Static Condition Model

Conceptually:

```ts
interface ConditionPlan {
  version: 1;
  sites: DecisionSiteDescriptor[];
  conditions: ConditionDescriptor[];
}

interface DecisionSiteDescriptor {
  siteId: string;
  kind: "if" | "elif" | "while";
  chainId?: string;
  branchIndex?: number;
  conditionId: string;
  span: SourceSpan;
}

interface ConditionDescriptor {
  conditionId: string;
  siteId: string;
  kind:
    | "truth_test"
    | "comparison"
    | "not"
    | "and"
    | "or"
    | "opaque";
  source: string;
  span: SourceSpan;
  childConditionIds: string[];
}
```

Static identities represent source locations, not runtime occurrences.

Requirements:

- deterministic for the same original source;
- derived before AST rewriting;
- independent of source-text equality;
- duplicate condition text at different source locations receives different IDs;
- repeated loop execution reuses the same static `siteId` and `conditionId`.

---

# 7. Branch-Chain Normalization

Python represents `elif` as nested `If` nodes. The static planner must normalize source-level chains such as:

```python
if A:
    ...
elif B:
    ...
elif C:
    ...
else:
    ...
```

into one logical branch chain:

```text
chain q4
├── branch 0: if   A
├── branch 1: elif B
├── branch 2: elif C
└── branch 3: else
```

The runtime must not rewrite or simulate the branch chain. Only the static metadata is normalized.

Core invariant:

```text
branch-chain semantics are a projection of actual execution,
not a replacement implementation of Python control flow.
```

---

# 8. Runtime Decision Model

Every actual condition evaluation is a runtime occurrence.

Conceptually:

```ts
type DecisionOutcome =
  | "branch_entered"
  | "branch_not_entered"
  | "loop_body_entered"
  | "loop_exited";

interface DecisionBatch {
  batchId: number;
  anchorStep: number;
  frameId: number;
  siteId: string;
  occurrence: number;
  status: "completed" | "partial";
  condition: ConditionEvaluation;
  outcome?: DecisionOutcome;
}
```

`outcome` exists only for a successfully completed decision occurrence. A condition interrupted by a user exception or termination remains `partial` and has no branch/loop outcome.

A `while` condition therefore has one static site but many runtime occurrences:

```text
site d7
occurrence 1 → True
occurrence 2 → True
occurrence 3 → True
occurrence 4 → False
```

Occurrence numbering must remain stable within a runtime frame/site pair. Recursion therefore produces separate occurrence sequences for separate frame IDs rather than merging logically distinct calls.

All decision evidence is anchored to the same authoritative execution coordinate already used by other evidence layers:

```text
anchorStep + frameId
```

There is no independent Decision cursor or Decision timeline coordinate system.

---

# 9. Condition Evidence Model

Conceptually:

```ts
interface ConditionEvidenceNode {
  conditionId: string;
  kind: ConditionKind;
  source: string;
  status:
    | "evaluated"
    | "short_circuited"
    | "not_reached"
    | "partial";
  value?: ValueSnapshot;
  truth?: boolean;
  children: ConditionEvidenceNode[];
  skipReason?:
    | "and_short_circuit"
    | "or_short_circuit"
    | "earlier_branch_selected";
}
```

The following states are semantically distinct:

```text
False            → evaluated and false
short_circuited  → Python did not evaluate this condition child
not_reached      → control flow never reached this branch condition
partial          → evaluation began but did not complete
```

No state may be collapsed into another for UI convenience.

A child may be labeled short-circuited only when a successfully completed parent boolean operation proves that Python skipped that child.

If condition evaluation is interrupted by an exception or tracing termination, absent child evidence must not automatically be classified as short-circuited.

---

# 10. Branch-Chain Evidence

The interpreter may project raw decision batches into a branch-chain view:

```ts
interface DecisionChainEvidence {
  chainId: string;
  branches: Array<{
    siteId?: string;
    kind: "if" | "elif" | "else";
    status: "selected" | "rejected" | "not_reached";
    condition?: ConditionEvidenceNode;
  }>;
  selectedBranchIndex: number | null;
}
```

Example:

```python
if x < 0:
    ...
elif x == 0:
    ...
else:
    ...
```

For `x = 4`:

```text
if x < 0      → rejected
elif x == 0   → rejected
else          → selected
```

For `x = -2`:

```text
if x < 0      → selected
elif x == 0   → not reached
else          → not reached
```

The terms `selected`, `rejected`, and `not reached` are factual runtime descriptions, not correctness judgments.

---

# 11. Semantic-Preserving Instrumentation

Condition instrumentation must preserve ordinary Python behavior.

The critical design choice is that a truth probe consumes the user-defined truth test that Python would otherwise need at that truth-test position and returns a built-in boolean.

For:

```python
if node:
    ...
```

conceptually:

```python
if __lc_truth(site_id, condition_id, node):
    ...
```

where the helper:

```text
1. performs the one user-value truth test required by the original condition;
2. records factual evidence;
3. returns the resulting built-in bool.
```

It must not truth-test the original object and then return that original object for Python to truth-test again.

This is required for values with user-defined `__bool__()` or `__len__()`.

The additional truth test that Python performs on the helper's returned built-in `bool` is semantically inert with respect to user code and must not invoke user-defined truth behavior.

---

# 12. Comparison Semantics

The instrumentation layer must not reimplement Python comparison operators.

For:

```python
if left < right:
```

conceptually:

```python
if __lc_truth(
    site_id,
    condition_id,
    __lc_value(left_id, left) < __lc_value(right_id, right)
):
```

`__lc_value` may capture a safe snapshot but returns the original value unchanged.

Python remains authoritative for:

- operator dispatch;
- custom comparison methods;
- `NotImplemented` fallback behavior;
- identity semantics;
- membership semantics;
- comparison exceptions.

The instrumentation must never recompute the comparison solely to obtain evidence.

Operand snapshotting must itself be fail-open and avoid invoking arbitrary user repr/iteration behavior solely for Decision Evidence.

---

# 13. Boolean Short-Circuit Semantics

Python itself must remain authoritative for `and` / `or` short-circuiting.

The implementation must not replace boolean evaluation with a custom thunk or callback engine.

For a boolean expression used directly in a **truth-test context**:

```python
if a < b and nums[i] != target:
```

conceptually:

```python
if __lc_decision(
    site_id,
    __lc_atomic(c1, a < b)
    and
    __lc_atomic(c2, nums[i] != target)
):
```

If `c1` becomes false, Python itself prevents evaluation of `c2`.

The recorder may then combine:

- the static condition tree;
- the captured runtime child events;
- a successfully completed parent boolean result;

and classify `c2` as:

```text
status = short_circuited
reason = and_short_circuit
```

The same principle applies to `or`.

`not` must preserve Python's logical semantics; the child may be instrumented, but the implementation must not create a second user-defined truth evaluation.

## 13.1 Truth-test-context restriction

Boolean operators in Python are also value-producing expressions. Instrumentation must not blindly replace every nested `and` / `or` operand with a built-in boolean when the expression's returned object identity or value may be observed by surrounding expression semantics.

For example:

```python
if (a and b) is sentinel:
    ...
```

`a and b` is an operand of `is`, so its actual returned object matters. v0.1 must either preserve the value-producing semantics exactly or treat the relevant condition subtree/root as opaque.

Therefore:

> bool-producing atomic probes are allowed only where the original Python construct is being consumed for truth control and replacing the user object's truth test with a built-in boolean does not alter a value observed by surrounding expression semantics.

When this cannot be proven from the AST context, v0.1 fails closed to coarser factual evidence.

---

# 14. Decision Completion and Outcome

The outer condition wrapper finalizes each successfully evaluated decision occurrence.

Conceptually:

```python
if __lc_decision(site_id, rewritten_condition):
    ...
```

The wrapper records the final truth and returns the same built-in boolean.

Outcome mapping:

```text
if / elif + True  → branch_entered
if / elif + False → branch_not_entered
while + True      → loop_body_entered
while + False     → loop_exited
```

The implementation must not infer these outcomes by observing the next source line.

If condition evaluation raises before the outer completion probe executes, the occurrence is partial and has no outcome.

---

# 15. Partial Evaluation and Exceptions

Captured evidence before a user exception must be preserved.

Example:

```python
if ready and values[i] > 0:
    ...
```

If `ready` evaluates true and `values[i]` raises `IndexError`, valid evidence may be:

```text
ready       → True
values[i]   → partial / interrupted
overall     → partial
outcome     → unavailable
```

The system must not produce:

```text
overall → False
branch  → rejected
```

because no completed condition result exists.

The original exception remains authoritative and continues through the normal trace path.

---

# 16. Fail-Open Instrumentation and Independent Limits

Decision instrumentation is optional evidence collection around ordinary execution.

If static instrumentation construction fails:

```text
decisionTracing.status = "unavailable"
reason = "instrumentation_failed"
```

and the original AST must still execute through ordinary tracing.

Decision evidence must have independent limits, conceptually:

```text
maxDecisionEvents
maxDecisionBytes
```

When a limit is exceeded:

```text
decisionTracing.status = "truncated"
```

Decision recording stops, but:

- user execution continues;
- ordinary tracing continues;
- Expression Evidence continues independently;
- Behavioral Analysis continues from available ordinary trace evidence.

Decision limits must never terminate the user's program.

---

# 17. Trace Schema

`TraceSession` gains optional decision fields:

```ts
interface TraceSession {
  // existing fields...
  conditionPlan?: ConditionPlan;
  decisionBatches?: DecisionBatch[];
  decisionTracing?: DecisionTracingState;
}
```

The trace schema version advances:

```text
TRACE_SCHEMA_VERSION = 4
```

Readers and collectors must remain backward-compatible with older traces that do not contain decision fields.

A schema-v3 trace without Decision Evidence remains valid.

---

# 18. Core Interpreter Responsibilities

The worker records factual runtime evidence. Core TypeScript interpretation owns presentation semantics.

Responsibilities include:

- building `DecisionEvidenceByStep`;
- resolving static descriptors to runtime occurrences;
- reconstructing short-circuited children only when proven;
- reconstructing `if / elif / else` chain status;
- preserving `partial` states and missing outcomes;
- constructing while-condition occurrence history;
- resolving safe List / Matrix structure references;
- never inventing missing truth values.

The worker must not emit UI-specific labels or structure-specific visual semantics.

---

# 19. Side-Panel UX

Decision Evidence appears as a dedicated panel between `Visual State` and `Expression Evidence`.

Recommended high-level order:

```text
Code
Visual State
Decision Evidence
Expression Evidence
What Changed | Behavioral Signals | Locals
Call Stack
Output
Trace Outline
Behavioral Timeline
Controls
```

For an ordinary condition:

```text
Decision Evidence

IF · line 12
Branch entered

left <= right                         True
├─ left                         2
└─ right                        8

nums[mid] < target                    True
├─ nums[mid]                    7
└─ target                       10

overall                               True
```

For short-circuit:

```text
left <= right                         False
nums[mid] < target                    not evaluated
                                      AND short-circuited
overall                               False
```

The UI must visibly distinguish:

```text
True / False
not evaluated
not reached
partial
```

---

# 20. Decision History

`while` conditions receive a compact, navigable history.

Example:

```text
while left <= right · line 8

#1   0 <= 7    True    body entered
#2   4 <= 7    True    body entered
#3   6 <= 7    True    body entered
#4   6 <= 5    False   loop exited
```

Selecting an occurrence navigates back to its authoritative raw trace anchor.

v0.1 does not add a dedicated Decision lane to the Behavioral Timeline. Repeated decision outcomes remain inspectable history, not behavioral diagnosis.

---

# 21. Structure Projection

v0.1 may project safe condition operand references into existing visualizers.

Examples:

```python
if nums[left] < nums[right]:
```

may highlight the two resolved List indexes.

```python
if grid[r][c] == 1:
```

may highlight the resolved Matrix cell.

The projection layer must reuse factual runtime values and supported coordinate-resolution rules.

v0.1 must not add:

- control-flow arrows over structures;
- causal claims such as "left moved because this was true";
- algorithm-specific overlays;
- inferred coordinates that are not safely resolved.

---

# 22. Source-Code Panel Enhancement

When a raw step has Decision Evidence, the active source line may display a compact factual badge such as:

```text
condition True
condition False
short-circuit
```

v0.1 does not implement source-span coloring or per-subexpression highlighting inside the code panel.

---

# 23. Panel Visibility

Decision Evidence should avoid adding noise to sessions without control-flow evidence.

Recommended behavior:

- if the session contains no Decision Evidence, do not create the panel;
- if the session contains Decision Evidence but the current step does not, keep the panel available but collapsed or otherwise visually quiet;
- preserve the user's panel open/collapsed state while navigating;
- do not force-open the panel on every decision step.

---

# 24. Failure-First Boundary

Failure-First remains independent in v0.1.

Decision Evidence must not automatically influence Start Here selection merely because a decision occurred near an exception, timeout, or trace limit.

This avoids implicitly treating a nearby condition as more suspicious than other evidence.

Future work may define cross-evidence prioritization separately.

---

# 25. Semantic-Preservation Invariants

For every supported decision occurrence:

```text
1. Every original operand is evaluated at most once.
2. Every user-defined truth operation is invoked no more often than ordinary Python execution would invoke it.
3. Python remains authoritative for comparison and short-circuit semantics.
4. Missing evidence is never assigned a truth value.
5. A child is labeled short-circuited only when a completed parent decision proves that Python skipped it.
6. A partial decision has no fabricated control-flow outcome.
7. Instrumentation failure cannot replace a user exception.
8. Decision evidence limits cannot terminate ordinary execution.
9. Original source spans remain authoritative.
10. Instrumented helpers remain hidden behind the reserved __lc_* namespace.
11. The debugger never re-evaluates source text to fill an evidence gap.
12. Truth-test instrumentation must not change value-producing `and` / `or` semantics observed by surrounding expressions.
```

---

# 26. Testing Strategy

## 26.1 Semantic-preservation tests

These are the highest-priority tests.

Compare instrumented and uninstrumented observable behavior for:

- custom `__bool__`;
- custom `__len__`;
- custom `__lt__`, `__eq__`, and related comparison behavior;
- membership operations;
- side-effecting condition functions;
- nested `and` / `or`;
- `not`;
- short-circuit suppression of side effects;
- exceptions during condition evaluation;
- value-producing boolean subexpressions such as `(a and b) is sentinel` to verify fail-closed handling or exact semantic preservation.

Example requirement:

```python
def explode():
    raise RuntimeError()

if False and explode():
    ...
```

`explode()` must remain uncalled with or without Decision Tracing.

Custom truth objects must also retain the same number of user-defined truth calls with and without instrumentation.

## 26.2 Protocol correctness tests

Directly assert raw `ConditionPlan` and `DecisionBatch` behavior for:

- `False and B`;
- `True or B`;
- `True and B`;
- `False or B`;
- nested boolean trees;
- `not`;
- truth tests;
- comparisons;
- `if / elif / else`;
- partial decisions with no outcome;
- while occurrence numbering;
- multiple frames;
- recursive calls;
- identical source text at different AST locations;
- multiple decision sites on one source line where supported;
- opaque fallback where detailed decomposition cannot be proven safe.

## 26.3 Interpreter and UI contract tests

Core tests must verify:

```text
DecisionBatch[] → DecisionEvidenceByStep
```

including:

- selected / rejected / not-reached branch states;
- evaluated / short-circuited / partial condition states;
- absence of outcome for partial decisions;
- anchor-step alignment;
- frame alignment;
- decision-history ordering;
- branch-chain reconstruction;
- safe structure-reference resolution.

Side-panel tests must verify that distinct semantic states remain distinct in the DOM and that Decision History navigation returns to the authoritative raw trace step.

## 26.4 Representative end-to-end flows

Use a small set of representative LeetCode-style programs rather than broad problem-count coverage:

```text
Binary Search         → if/elif/else + while
Two Sum               → membership / guards
Sliding Window        → nested while conditions
Linked List traversal → object truth / is not None
Grid traversal        → matrix operand references
DFS / BFS             → visited membership + compound guards
```

The acceptance target is faithful execution replay, not Accepted status.

---

# 27. Failure Modes

Supported degradation behavior:

### Unsupported detailed decomposition

For a condition that is safe only as an opaque root:

```text
source        → retained
overall truth → captured
children      → unavailable
```

### Instrumentation construction failure

```text
decisionTracing.status = unavailable
ordinary execution     = preserved
```

### Evidence budget exhaustion

```text
decisionTracing.status = truncated
ordinary execution     = preserved
```

### User exception during condition evaluation

```text
captured child evidence → preserved
overall decision         → partial
outcome                  → unavailable
original exception       → authoritative
```

### Timeout or trace termination

Already-streamed Decision Evidence is retained when feasible. Missing later evidence must not be reconstructed after termination.

---

# 28. Definition of Done

Condition / Decision Tracing v0.1 is complete when all of the following hold:

1. `if`, `elif`, and `while` decision sites can produce factual runtime evidence.
2. Truth tests, `not`, nested `and/or`, and the supported comparison operators are captured without duplicate user evaluation.
3. `and/or` evidence clearly distinguishes false from not-evaluated operands.
4. Truth-test rewriting does not alter value-producing boolean semantics; unsafe shapes fall back to opaque evidence.
5. Each `while` evaluation has a distinct occurrence and navigable history entry.
6. `if / elif / else` chains reconstruct selected, rejected, and not-reached branches.
7. Partial decisions preserve captured evidence and expose no fabricated outcome.
8. Decision Evidence aligns with the existing raw trace through `anchorStep + frameId`.
9. Safe List / Matrix operand projection works without algorithm-specific inference.
10. Decision Tracing never judges correctness, intended control flow, root cause, or fixes.
11. Instrumentation preserves ordinary Python evaluation counts, side effects, comparison dispatch, truth behavior, and exceptions.
12. Instrumentation, serialization, recorder, or budget failure cannot terminate or alter ordinary user execution.
13. Captured evidence before exception, timeout, or trace termination is preserved when feasible.
14. Existing Expression Evidence, Runtime Mutation, Behavioral Signals, structure visualizers, Failure-First behavior, and raw navigation do not regress.
15. Trace schema v4 remains backward-compatible with older sessions lacking decision fields.
16. Unit, integration, semantic-preservation, DOM, and representative end-to-end tests pass.

---

# 29. Resulting Product Model

After this milestone, the debugger evidence model becomes:

```text
Python runtime
      ↓
Raw execution trace
      ├── Runtime State        → what exists now
      ├── Runtime Mutation     → what changed
      ├── Expression Evidence  → how a value was computed
      └── Decision Evidence    → why Python followed this executed control path
                ↓
       Behavioral Interpretation
                ↓
       Structure Visualization
                ↓
       Evidence Navigation
```

This milestone moves LeetYourBrain2Code from state visualization toward **evidence-driven behavioral debugging** while preserving the project's central boundary: explain executed behavior without becoming a solver or correctness engine.

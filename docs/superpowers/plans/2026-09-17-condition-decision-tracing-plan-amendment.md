# Condition / Decision Tracing Plan Amendment

This amendment is **mandatory** and overrides the corresponding sections of `2026-09-17-condition-decision-tracing-implementation-plan.md`.

It was added during the implementation-plan self-review after finding three contract gaps that would otherwise make later tasks ambiguous or impossible to implement faithfully.

## Amendment 1: `ConditionEvaluation` Must Record Ordered Child Truth Results

Replace the original `ConditionEvaluation` contract:

```ts
export interface ConditionEvaluation {
  conditionId: string;
  evaluations: DecisionOperandEvaluation[];
  truth?: boolean;
  evaluatedConditionIds?: string[];
}
```

with:

```ts
export interface ConditionResult {
  conditionId: string;
  order: number;
  truth: boolean;
}

export interface ConditionEvaluation {
  conditionId: string;
  evaluations: DecisionOperandEvaluation[];
  conditionResults: ConditionResult[];
  truth?: boolean;
}
```

Reason: knowing only that a child condition ran is insufficient to reconstruct factual `and` / `or` short-circuit behavior. The interpreter must know the ordered truth result of every condition probe that actually executed.

### Protocol tests

The valid completed-batch fixture in Task 1 becomes:

```ts
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
      conditionResults: [{ conditionId: "d1.c0", order: 1, truth: false }],
      truth: false
    },
    outcome: "branch_not_entered"
  }]
})).toBe(true);
```

Validators must require:

```text
conditionResults is an array
conditionId is a string
order is a positive integer
truth is boolean
orders are strictly increasing within one batch
```

Do not infer child truth values from operand snapshots.

### Recorder behavior

`DecisionRecorder.record_truth(...)` appends exactly one ordered result after the original user-value truth test succeeds:

```python
def record_truth(self, site_id, condition_id, value):
    truth = bool(value)
    occurrence = self._active_occurrence(site_id)
    if occurrence is not None and self.status == "complete":
        occurrence["condition_results"].append({
            "condition_id": condition_id,
            "order": len(occurrence["condition_results"]) + 1,
            "truth": truth,
        })
    return truth
```

If `bool(value)` raises, no truth result is appended and the user exception propagates unchanged.

`complete(...)` may add the root result only if it is not already the final `conditionResults` entry. Do not duplicate the root condition result.

### Interpreter behavior

Task 5 must build:

```ts
const truthByConditionId = new Map(
  batch.condition.conditionResults.map((result) => [result.conditionId, result.truth])
);
```

For a completed `and`, short-circuit begins after the first child result whose `truth === false`.

For a completed `or`, short-circuit begins after the first child result whose `truth === true`.

For partial decisions, the ordered prefix identifies exactly how far Python progressed, but absence alone still does not prove short-circuit.

---

## Amendment 2: Empty `ConditionPlan` Fixtures Include `chains`

Every `ConditionPlan` is structurally complete, including an empty chains array.

Replace:

```ts
{ version: 1, sites: [], conditions: [], operands: [] }
```

with:

```ts
{ version: 1, sites: [], conditions: [], operands: [], chains: [] }
```

`worker-protocol.ts` must validate `chains` structurally rather than treating it as optional.

---

## Amendment 3: Structure Index Expressions Are First-Class Captured Operands

Task 2 must not create a structure hint that points at an operand ID which does not exist.

For:

```python
nums[i]
```

planning must create both:

```text
operand for nums[i]   → displayed comparison operand value
operand for i         → coordinate evidence
```

and the `nums[i]` operand's structure hint references the separately planned `i` operand:

```ts
{
  kind: "list_index",
  variableName: "nums",
  indexOperandId: "...index operand id..."
}
```

For:

```python
grid[r][c]
```

planning must create separately captured operand descriptors for `r` and `c`, and the matrix hint references them:

```ts
{
  kind: "matrix_cell",
  variableName: "grid",
  rowOperandId: "...r operand id...",
  columnOperandId: "...c operand id..."
}
```

The instrumenter must preserve evaluation counts. Coordinate probes wrap the **already existing index evaluation**, not a re-evaluation of index source text.

Conceptually:

```python
nums[
    __lc_condition_operand(site_id, condition_id, index_operand_id, i)
]
```

not:

```python
__lc_condition_operand(..., nums[i])
# followed later by evaluating i again for projection
```

For an index expression outside the safe v0.1 shape, omit the structure hint rather than creating a probe that changes semantics.

### Projection tests

Task 6 must explicitly assert that:

```text
nums[left] captures left exactly once
nums[-1] captures the literal index without source re-evaluation
grid[r][c] captures r and c exactly once each
missing coordinate operand evidence produces no overlay
```

---

## Self-Review Result

With these overrides, the plan has the runtime facts required to implement:

```text
captured operand values
+ ordered atomic condition truth results
+ completed root truth/outcome
+ static boolean tree
→ factual Decision Evidence
```

without deriving truth from snapshots, re-evaluating source, or inventing short-circuit evidence.

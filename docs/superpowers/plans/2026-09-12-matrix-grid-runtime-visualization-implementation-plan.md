# Matrix / Grid Runtime Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add factual, deterministic Matrix / Grid runtime visualization for complete rectangular 2D scalar Python sequences, including direct `matrix[row][column]` focus, cell-level mutation projection, bounded focus-aware viewport behavior, persistent inspection, and integration with the existing visual candidate/navigation pipeline.

**Architecture:** Keep the existing trace and `RuntimeMutation[]` contracts authoritative. Extend static relation extraction with a backward-compatible `matrix_subscript` relation, project valid active-frame 2D locals through a pure `matrix-interpreter.ts`, feed `MatrixVisualModel` into the existing candidate resolver, and render it through a stateful-but-runtime-truth-free `MatrixVisualizer` whose only persistent state is selection and viewport preference.

**Tech Stack:** TypeScript 5.8, Python AST analysis inside Pyodide 0.29, DOM APIs, Vitest 3.2, jsdom 26, Vite 6, existing `RuntimeState`, `RuntimeMutation`, visual candidate resolver, and `SelectionInspector` infrastructure.

**Spec:** `docs/superpowers/specs/2026-09-12-matrix-grid-runtime-visualization-design.md`

## Global Constraints

- Matrix v0.1 supports only complete, non-empty, rectangular 2D `list` / `tuple` values whose cells are `int`, `float`, `bool`, `str`, or `none` snapshots.
- Empty outer sequences, zero-column matrices, ragged rows, truncated outer/row snapshots, non-scalar cells, 3D structures, sparse dict matrices, and NumPy arrays fail closed.
- Direct Matrix focus supports only chained `matrix[row][column]` AST access where each operand is a local variable or integer literal, including unary `+` / `-` integer literals.
- Do not evaluate arbitrary Python index expressions such as `i + 1`, `j - 1`, or `len(matrix) - 1`.
- Do not perform alias/dataflow recovery for `row = matrix[i]; row[j] = value`.
- Preserve raw negative indices and normalize effective indices exactly with Python sequence semantics.
- Out-of-bounds focus remains explicit factual evidence and must not create fake cells.
- `RuntimeMutation[]` remains the sole mutation authority; do not diff previous/current Matrix visual models to invent mutation evidence.
- Cell-level change evidence is derived only from authoritative outer-container `sequence_element` mutations whose before/after row snapshots can be compared safely.
- Focus and changed-cell evidence are independent and may coexist on the same cell.
- A valid Matrix variable owns its structural interpretation for that step and must not simultaneously render as an ordinary List visual.
- If a Matrix becomes ragged, truncated, or otherwise unsupported, the Matrix visual disappears for that step; do not fall back to a giant nested List visual.
- Matrix uses the existing visual candidate resolver; do not create a Matrix-specific orchestration layer.
- Large matrices use a bounded viewport; UI clipping is presentation state and must not be described as runtime snapshot truncation.
- Auto-follow moves the viewport only when the navigation-anchor focus leaves the current viewport and auto-follow is enabled.
- Manual viewport navigation disables auto-follow until the user explicitly re-enables it.
- Renderer-persistent state is limited to selected cell, viewport position, and auto-follow preference; runtime values/focus/mutation facts always come from the latest model.
- UI copy must remain factual: no DP/recurrence classification, pathfinding semantics, dependency inference, correctness diagnosis, root-cause claims, or automatic fixes.
- Preserve existing List / Dict / Linked List / Tree / Graph behavior, stable visual ordering, Behavioral Timeline, Trace Folding, and Failure-First navigation.
- Existing regression suite must remain green.

---

## File Structure

- Modify `src/shared/trace-types.ts` — add `MatrixIndexOperand` and `MatrixSubscriptRelation` to `StaticRelation`.
- Modify `src/worker/python/ast_analyzer.py` — extract direct chained 2D subscript relations while preserving existing one-dimensional relations.
- Modify `src/core/ast-relations.ts` — validate/normalize the new relation variant.
- Modify `src/core/binding-resolver.ts` — explicitly ignore `matrix_subscript` in one-dimensional pointer binding.
- Modify `tests/execution/pyodide-runtime.test.ts` — prove real Python AST extraction reaches the trace result and add a real Matrix execution fixture.
- Modify `tests/core/binding-resolver.test.ts` — prove Matrix relations do not corrupt one-dimensional bindings.
- Create `src/core/matrix-interpreter.ts` — strict detection, focus resolution, negative/OOB semantics, and cell-change projection.
- Create `tests/core/matrix-interpreter.test.ts` — pure Matrix interpretation coverage.
- Modify `src/core/visual-candidate.ts` — add `matrix` to `VisualKind`.
- Modify `src/core/visual-model.ts` — build Matrix visuals, enforce exclusive Matrix ownership, and add Matrix candidate priority.
- Modify `tests/core/visual-model.test.ts` — Matrix ownership, coexistence, ranking, and regression coverage.
- Modify `tests/core/trace-interpreter.test.ts` — verify raw trace events plus Matrix relations produce Matrix `visualStates` and authoritative changed-cell evidence.
- Create `src/sidepanel/components/matrix-viewport.ts` — pure bounded viewport geometry and reveal/pan helpers.
- Create `tests/sidepanel/matrix-viewport.test.ts` — viewport determinism and minimum-shift tests.
- Modify `src/sidepanel/components/SelectionInspector.ts` — optional retention of a selected inspect key when its DOM target is temporarily outside a virtualized viewport.
- Modify `tests/sidepanel/selection-inspector.test.ts` — retained-missing-selection contract without changing default behavior.
- Create `src/sidepanel/components/MatrixVisualizer.ts` — grid rendering, focus/change states, inspector, requested-cell notices, viewport controls, and auto-follow state.
- Create `tests/sidepanel/matrix-visualizer.test.ts` — DOM, inspector, lifecycle, viewport, and auto-follow tests.
- Modify `src/sidepanel/components/visualizer-registry.ts` — register Matrix.
- Modify `tests/sidepanel/visualizer-registry.test.ts` — Matrix create/update/mismatched-kind contract.
- Modify `src/sidepanel/styles.css` — Matrix grid, headers, focus/change states, viewport controls, requested-cell notices.
- Modify `tests/sidepanel/trace-visualizer.test.ts` — Matrix synchronization through ordinary and alternate navigation paths.
- Modify `README.md` and `README.zh-TW.md` — document Matrix / Grid v0.1 coverage and limitations.

---

### Task 1: Matrix Static Relation Protocol and AST Extraction

**Files:**
- Modify: `src/shared/trace-types.ts`
- Modify: `src/worker/python/ast_analyzer.py`
- Modify: `src/core/ast-relations.ts`
- Modify: `src/core/binding-resolver.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/core/binding-resolver.test.ts`

**Interfaces:**
- Consumes: Python user source code and existing `TraceSession.subscriptRelations?: StaticRelation[]` transport.
- Produces: `MatrixIndexOperand`, `MatrixSubscriptRelation`, and `StaticRelation` values with `kind: "matrix_subscript"`; existing 1D pointer resolver skips this relation kind.

- [ ] **Step 1: Write failing AST relation coverage**

Add a real Pyodide case containing:

```python
class Solution:
    def inspect(self, matrix: list[list[int]], i: int, j: int):
        a = matrix[i][j]
        b = matrix[0][-1]
        c = matrix[i + 1][j]
        return a + b + c
```

Assert `subscriptRelations` contains:

```ts
{
  kind: "matrix_subscript",
  container: "matrix",
  rowIndex: { kind: "variable", name: "i" },
  columnIndex: { kind: "variable", name: "j" }
}
```

and:

```ts
{
  kind: "matrix_subscript",
  container: "matrix",
  rowIndex: { kind: "literal", value: 0 },
  columnIndex: { kind: "literal", value: -1 }
}
```

Assert no Matrix relation is emitted for `matrix[i + 1][j]`.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts
```

Expected: FAIL because `matrix_subscript` does not exist.

- [ ] **Step 3: Add the TypeScript relation contract**

In `src/shared/trace-types.ts` add:

```ts
export type MatrixIndexOperand =
  | { kind: "variable"; name: string }
  | { kind: "literal"; value: number };

export interface MatrixSubscriptRelation {
  kind: "matrix_subscript";
  scope: string;
  line: number;
  container: string;
  rowIndex: MatrixIndexOperand;
  columnIndex: MatrixIndexOperand;
}
```

Extend `StaticRelation` with `MatrixSubscriptRelation`. Keep the existing `subscriptRelations` transport field name.

- [ ] **Step 4: Implement strict chained-subscript extraction**

In `src/worker/python/ast_analyzer.py` add Matrix operand/relation dataclasses and:

```python
def _matrix_index_operand(node):
    if isinstance(node, ast.Name):
        return MatrixIndexOperand(kind="variable", name=node.id)
    if isinstance(node, ast.Constant) and type(node.value) is int:
        return MatrixIndexOperand(kind="literal", value=node.value)
    if (
        isinstance(node, ast.UnaryOp)
        and isinstance(node.op, (ast.USub, ast.UAdd))
        and isinstance(node.operand, ast.Constant)
        and type(node.operand.value) is int
    ):
        sign = -1 if isinstance(node.op, ast.USub) else 1
        return MatrixIndexOperand(kind="literal", value=sign * node.operand.value)
    return None
```

Inside `visit_Subscript`, emit `matrix_subscript` only for `Subscript(Subscript(Name(...), row), column)` when both operands parse. Continue `generic_visit(node)` so legacy inner 1D relations remain available.

- [ ] **Step 5: Update TypeScript validation and 1D binding protection**

In `src/core/ast-relations.ts`, split base-field validation from legacy `.index` validation. `kind === "matrix_subscript"` must validate `rowIndex` and `columnIndex`; legacy relations still require a string `.index`.

In `src/core/binding-resolver.ts`, skip before reading `.index`:

```ts
if (relation.kind === "membership" || relation.kind === "matrix_subscript") {
  continue;
}
```

Add a binding-resolver regression proving Matrix relations return no 1D pointer bindings while existing List bindings still work.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts tests/core/binding-resolver.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/shared/trace-types.ts src/worker/python/ast_analyzer.py src/core/ast-relations.ts src/core/binding-resolver.ts tests/execution/pyodide-runtime.test.ts tests/core/binding-resolver.test.ts
git commit -m "feat: capture matrix subscript relations"
```

---

### Task 2: Pure Matrix Interpreter

**Files:**
- Create: `src/core/matrix-interpreter.ts`
- Create: `tests/core/matrix-interpreter.test.ts`

**Interfaces:**
- Consumes: `RuntimeState`, `StaticRelation[]`, `RuntimeMutation[]`.
- Produces: `buildMatrixVisuals(runtime, relations, mutations): MatrixVisualModel[]`; exports `MatrixVisualModel`, `MatrixFocus`, and `MatrixCellChange`.

- [ ] **Step 1: Write failing strict-detection tests**

Cover valid rectangular list/tuple row combinations and reject:

```text
[]
[[], []]
[[1, 2], [3]]
outer.truncated = true
row.truncated = true
outer.length !== outer.items.length
row.length !== row.items.length
non-scalar cell types
```

Assert valid `dp` produces:

```ts
expect.objectContaining({
  kind: "matrix",
  visualId: "matrix:dp",
  variableName: "dp",
  rowCount: 2,
  columnCount: 2
})
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/core/matrix-interpreter.test.ts
```

- [ ] **Step 3: Implement strict detection and model types**

Define:

```ts
export interface MatrixCellChange {
  row: number;
  column: number;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export interface MatrixFocus {
  rawRow: number;
  rawColumn: number;
  effectiveRow: number | null;
  effectiveColumn: number | null;
  rowOutOfBounds: boolean;
  columnOutOfBounds: boolean;
  rowSource: "variable" | "literal";
  columnSource: "variable" | "literal";
  rowVariable?: string;
  columnVariable?: string;
}

export interface MatrixVisualModel {
  kind: "matrix";
  visualId: string;
  variableName: string;
  rowCount: number;
  columnCount: number;
  cells: ValueSnapshot[][];
  focuses: MatrixFocus[];
  changedCells: MatrixCellChange[];
}
```

Detection accepts only scalar cell types `int | float | bool | str | none`, positive row/column counts, and complete non-truncated snapshots. Sort emitted Matrix variables lexicographically.

- [ ] **Step 4: Write failing focus tests**

Cover variable/literal operands, multiple same-line focuses, wrong line/scope, non-int local operands, negative normalization, and OOB semantics.

For shape `5×4`, `i=-1`, literal column `2`, assert:

```ts
{
  rawRow: -1,
  rawColumn: 2,
  effectiveRow: 4,
  effectiveColumn: 2,
  rowOutOfBounds: false,
  columnOutOfBounds: false,
  rowSource: "variable",
  columnSource: "literal",
  rowVariable: "i"
}
```

- [ ] **Step 5: Implement focus resolution**

Use only `matrix_subscript` relations matching current line, active-frame scope, and variable name. Variable operands must be integer snapshots whose numeric value is a safe integer. Normalize each axis independently:

```ts
const candidate = raw < 0 ? length + raw : raw;
const effective = candidate >= 0 && candidate < length ? candidate : null;
```

- [ ] **Step 6: Write failing mutation-projection tests**

Given authoritative outer-row mutation:

```ts
before: row([1, 2, 3])
after: row([1, 4, 5])
```

assert exactly two `changedCells` at columns 1 and 2. Also cover one-cell change, added/removed row entries, unrelated frame/container mutations, and invalid current Matrix suppression.

- [ ] **Step 7: Implement authoritative row→cell projection**

Only consume matching active-frame `sequence_element` mutations. Compare before/after row snapshots by index using `valueSnapshotsEqual()`, clone before/after values, classify `added | removed | changed`, and sort by row then column. Never diff previous/current Matrix models.

- [ ] **Step 8: Run and verify GREEN**

```bash
npx vitest run tests/core/matrix-interpreter.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add src/core/matrix-interpreter.ts tests/core/matrix-interpreter.test.ts
git commit -m "feat: interpret matrix runtime state"
```

---

### Task 3: Visual Model Ownership and Candidate Ranking

**Files:**
- Modify: `src/core/visual-candidate.ts`
- Modify: `src/core/visual-model.ts`
- Modify: `tests/core/visual-model.test.ts`

**Interfaces:**
- Consumes: `buildMatrixVisuals(...)`.
- Produces: `StructureVisualModel` includes Matrix; valid Matrix variables suppress same-variable List construction; Matrix uses existing `VisualPriority`.

- [ ] **Step 1: Write failing integration tests**

With locals `dp=[[0,0],[0,0]]`, `nums=[4,2,7]`, `i=1`, `j=0`, and current-line `dp[i][j]`, assert `matrix:dp` and `list:nums` are visible, `list:dp` is absent, and `matrix:dp` is primary.

Add ragged `dp` and assert neither Matrix nor List fallback appears. Add mutation-without-focus coverage.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/core/visual-model.test.ts
```

- [ ] **Step 3: Add Matrix kind/model integration**

Extend:

```ts
export type VisualKind = "list" | "dict" | "linked_list" | "tree" | "graph" | "matrix";
```

Import `MatrixVisualModel` and extend `StructureVisualModel`.

Build Matrix visuals first, collect `matrixVariables`, and exclude those variables from ordinary container visual construction. Keep the existing nested-list candidate guard for unsupported nested sequences.

- [ ] **Step 4: Add Matrix priority**

Use:

```ts
priority: [
  activeLineMatrices.has(visual.variableName),
  visual.changedCells.length > 0,
  visual.focuses.some((focus) => !focus.rowOutOfBounds && !focus.columnOutOfBounds),
  visual.focuses.length
]
```

`activeLineMatrices` must come only from `matrix_subscript` relations on the current line/scope.

- [ ] **Step 5: Run and verify GREEN**

```bash
npx vitest run tests/core/visual-model.test.ts tests/core/binding-resolver.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/core/visual-candidate.ts src/core/visual-model.ts tests/core/visual-model.test.ts
git commit -m "feat: integrate matrix visual candidates"
```

---

### Task 4: Pure Matrix Viewport Geometry

**Files:**
- Create: `src/sidepanel/components/matrix-viewport.ts`
- Create: `tests/sidepanel/matrix-viewport.test.ts`

**Interfaces:**
- Produces: `MatrixViewport`, `initialMatrixViewport`, `matrixViewportContains`, `revealMatrixCell`, `panMatrixViewport`.

- [ ] **Step 1: Write failing viewport tests**

Assert a `5×6` Matrix yields a full viewport and a `30×40` Matrix yields `12×12`. Verify visible focus causes no movement; focus just below/right shifts the minimum amount; pan clamps at all boundaries.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/sidepanel/matrix-viewport.test.ts
```

- [ ] **Step 3: Implement pure viewport helpers**

Define:

```ts
export const MATRIX_VIEWPORT_ROWS = 12;
export const MATRIX_VIEWPORT_COLUMNS = 12;

export interface MatrixViewport {
  rowStart: number;
  columnStart: number;
  rowCount: number;
  columnCount: number;
}
```

`revealMatrixCell()` must preserve the exact viewport when the target is already visible and otherwise move only far enough to reveal the target. `panMatrixViewport()` clamps starts to `0..max(0,total-visible)`.

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/sidepanel/matrix-viewport.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/components/matrix-viewport.ts tests/sidepanel/matrix-viewport.test.ts
git commit -m "feat: add matrix viewport geometry"
```

---

### Task 5: Matrix Visualizer, Inspector, and Auto-Follow

**Files:**
- Modify: `src/sidepanel/components/SelectionInspector.ts`
- Modify: `tests/sidepanel/selection-inspector.test.ts`
- Create: `src/sidepanel/components/MatrixVisualizer.ts`
- Create: `tests/sidepanel/matrix-visualizer.test.ts`

**Interfaces:**
- Consumes: `MatrixVisualModel` and viewport helpers.
- Produces: `createMatrixVisualizer(initialModel): MatrixVisualizerHandle`; shared inspector gains opt-in `retainMissingSelection` while default behavior is unchanged.

- [ ] **Step 1: Write failing inspector-retention tests**

Add:

```ts
createSelectionInspector(section, getDetails, {
  retainMissingSelection: (key) => key === "cell:4:7"
});
```

Select `cell:4:7`, remove its DOM target, refresh, and assert the key/details remain. Also prove default behavior still falls back when no retention option is supplied.

- [ ] **Step 2: Implement opt-in retention**

Extend options with:

```ts
retainMissingSelection?: (key: string) => boolean;
```

Fallback only when the selected target is absent and the predicate does not approve the current key.

- [ ] **Step 3: Write failing Matrix DOM tests**

Create a 2×3 model where `(1,1)` is both focus and changed. Assert six cells render, `(1,1)` has both classes, and inspector contains current value, row/column, focus status, changed status, before/after, and `i/j` bindings. A focus-only cell must not show fake before/after data. OOB focus must show requested coordinate/status/shape without fake cells.

- [ ] **Step 4: Implement basic Matrix rendering**

Define:

```ts
export interface MatrixVisualizerHandle {
  element: HTMLElement;
  update(model: MatrixVisualModel): void;
  dispose(): void;
}
```

Use inspect keys `cell:<row>:<column>`, `formatValue()`, row/column labels, and separate `is-focus` / `is-changed` classes. Persist only:

```ts
let viewport: MatrixViewport;
let autoFollowEnabled = true;
```

plus SelectionInspector's selected key.

Retain missing cell selection only while its coordinate remains within the current Matrix shape; clear selection when the shape invalidates the coordinate.

- [ ] **Step 5: Write failing viewport/auto-follow tests**

For 30×30, assert only 12×12 cells mount. Moving focus `(3,3)→(3,4)` does not move viewport; moving to `(3,12)` shifts one column. Manual pan disables auto-follow. `Follow current cell` re-enables it and reveals the first in-bounds focus in `model.focuses`. OOB focuses never drive auto-follow. A selected valid offscreen cell remains inspectable.

- [ ] **Step 6: Implement bounded viewport controls**

Render only the viewport slice. Provide factual controls:

```text
Pan up
Pan down
Pan left
Pan right
Follow current cell
```

Manual pan sets `autoFollowEnabled=false`. On update, clamp viewport to shape, optionally reveal the first in-bounds focus, rerender, and refresh inspector. If changed cells are offscreen, show only `N changed cells outside current view`.

- [ ] **Step 7: Run and verify GREEN**

```bash
npx vitest run tests/sidepanel/selection-inspector.test.ts tests/sidepanel/matrix-viewport.test.ts tests/sidepanel/matrix-visualizer.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/components/SelectionInspector.ts tests/sidepanel/selection-inspector.test.ts src/sidepanel/components/MatrixVisualizer.ts tests/sidepanel/matrix-visualizer.test.ts
git commit -m "feat: render matrix runtime state"
```

---

### Task 6: Registry, Styling, and Trace Navigation Integration

**Files:**
- Modify: `src/sidepanel/components/visualizer-registry.ts`
- Modify: `tests/sidepanel/visualizer-registry.test.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

**Interfaces:**
- Consumes: Matrix kind/model and `createMatrixVisualizer()`.
- Produces: Matrix participates in the generic create/update/dispose path and remains synchronized across existing navigation paths.

- [ ] **Step 1: Write failing registry tests**

Create Matrix through `createVisualizer()`, assert `kind === "matrix"` and `data-visual-id="matrix:dp"`; update it in place; assert updating the Matrix handle with a List model throws `Cannot update matrix visualizer with list`.

- [ ] **Step 2: Register Matrix**

Import `createMatrixVisualizer` and add:

```ts
matrix: (model: ModelOf<"matrix">) =>
  withVisualId(model, createMatrixVisualizer(model), "matrix")
```

Run:

```bash
npx vitest run tests/sidepanel/visualizer-registry.test.ts
```

- [ ] **Step 3: Add Matrix CSS**

Add selectors for Matrix container/header/viewport/grid/row labels/column labels/cells/focus/change/combined state/controls/notices. Reuse existing theme variables; do not add value heatmaps. Keep the viewport bounded inside the side panel.

- [ ] **Step 4: Write failing TraceVisualizer lifecycle tests**

Model sequence:

```text
A: matrix:dp exists
B: same matrix:dp updated
C: matrix:dp absent
D: matrix:dp returns
```

Assert A→B reuses the same DOM root and removes stale focus/change state; C disposes/removes it; D starts a fresh renderer lifetime. Verify the same update works through direct-step navigation and one existing alternate navigation path already exercised in this file (use the existing Behavioral Timeline path rather than adding Matrix-specific navigation logic).

- [ ] **Step 5: Run and verify GREEN**

```bash
npx vitest run tests/sidepanel/visualizer-registry.test.ts tests/sidepanel/matrix-visualizer.test.ts tests/sidepanel/trace-visualizer.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/components/visualizer-registry.ts tests/sidepanel/visualizer-registry.test.ts src/sidepanel/styles.css tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: integrate matrix visualizer navigation"
```

---

### Task 7: Real Trace Integration, Documentation, and Full Gates

**Files:**
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/core/trace-interpreter.test.ts`
- Modify: `README.md`
- Modify: `README.zh-TW.md`

**Interfaces:**
- Consumes: complete Tasks 1–6 implementation.
- Produces: real execution proof that Matrix relations flow through `interpretTrace(...)` into `visualStates`, plus documented coverage/limitations.

- [ ] **Step 1: Add representative real-execution coverage**

Use:

```python
class Solution:
    def minPathSum(self, grid):
        m, n = len(grid), len(grid[0])
        dp = [[0] * n for _ in range(m)]
        for i in range(m):
            for j in range(n):
                dp[i][j] = grid[i][j]
        return dp[-1][-1]
```

with:

```text
[[1,3,1],[1,5,1],[4,2,1]]
```

In `tests/execution/pyodide-runtime.test.ts`, assert execution completes and the trace result includes the direct `dp[i][j]` Matrix relation.

- [ ] **Step 2: Add raw-trace→VisualState integration in `trace-interpreter.test.ts`**

Add a helper for nested list snapshots and call:

```ts
const result = interpretTrace(events, [matrixRelation]);
```

Use two consecutive events where `dp` changes from:

```text
[[0,0],[0,0]]
```

to:

```text
[[0,0],[7,0]]
```

and the active locals contain integer `i=1`, `j=0` on the relevant current line.

Assert the second `visualState` contains:

```ts
expect.objectContaining({
  kind: "matrix",
  visualId: "matrix:dp",
  focuses: [expect.objectContaining({ effectiveRow: 1, effectiveColumn: 0 })],
  changedCells: [expect.objectContaining({ row: 1, column: 0, action: "changed" })]
})
```

This test proves the established `interpretTrace(...) → visualStates` bridge; do not create another integration harness.

- [ ] **Step 3: Run focused integration tests**

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts tests/core/trace-interpreter.test.ts tests/core/visual-model.test.ts
```

Expected: PASS.

- [ ] **Step 4: Document Matrix / Grid v0.1**

Update both READMEs with supported behavior:

```text
- rectangular 2D list / tuple scalar state
- direct matrix[i][j] focus
- negative-index normalization and OOB requested-cell evidence
- actual cell changes derived from runtime mutation evidence
- bounded focus-aware viewport
- persistent cell inspection
```

Document limitations:

```text
- no ragged/3D/sparse/NumPy visualization
- no alias recovery
- no i+1 / j-1 expression focus
- no DP recurrence/algorithm inference
- no expected-vs-actual correctness diagnosis
```

- [ ] **Step 5: Run all focused Matrix tests**

```bash
npx vitest run \
  tests/core/binding-resolver.test.ts \
  tests/core/matrix-interpreter.test.ts \
  tests/core/visual-model.test.ts \
  tests/core/trace-interpreter.test.ts \
  tests/sidepanel/matrix-viewport.test.ts \
  tests/sidepanel/selection-inspector.test.ts \
  tests/sidepanel/matrix-visualizer.test.ts \
  tests/sidepanel/visualizer-registry.test.ts \
  tests/sidepanel/trace-visualizer.test.ts \
  tests/execution/pyodide-runtime.test.ts
```

- [ ] **Step 6: Run full verification**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all tests pass; typecheck/build exit 0. Any existing List / Dict / Linked List / Tree / Graph / behavioral-debugging failure is a regression.

- [ ] **Step 7: Audit Matrix UI wording**

```bash
grep -RniE "wrong|root cause|shortest path|BFS|DFS|dependency|caused" \
  src/core/matrix-interpreter.ts \
  src/sidepanel/components/MatrixVisualizer.ts
```

Expected: no matches in Matrix runtime UI code.

- [ ] **Step 8: Commit**

```bash
git add tests/execution/pyodide-runtime.test.ts tests/core/trace-interpreter.test.ts README.md README.zh-TW.md
git commit -m "test: validate matrix visualization end to end"
```

---

## Final Acceptance Checklist

- [ ] Direct `matrix[row][column]` with variable/integer-literal operands emits `matrix_subscript` relations.
- [ ] `i + 1`, `j - 1`, arbitrary expressions, and aliases do not become Matrix focus relations.
- [ ] Complete positive-size rectangular 2D list/tuple scalar values become Matrix models.
- [ ] Empty, zero-column, ragged, truncated, or non-scalar nested sequences fail closed.
- [ ] Raw and effective negative indices are both preserved correctly.
- [ ] Out-of-bounds focus is explicit and never creates fake cells.
- [ ] Cell changes are derived only from authoritative `RuntimeMutation[]` row mutations.
- [ ] Focus and changed-cell states remain independently inspectable.
- [ ] Valid Matrix variables never simultaneously render as same-variable List visuals.
- [ ] Unsupported nested sequences do not fall back to giant List visuals.
- [ ] Matrix candidate ranking uses direct current-line relation → mutation → valid focus → focus count through the existing resolver.
- [ ] Small matrices render fully and large matrices render a bounded 12×12-or-smaller viewport.
- [ ] Visible focus movement does not move the viewport.
- [ ] Offscreen focus moves the minimum distance necessary only while auto-follow is enabled.
- [ ] Manual pan disables auto-follow and explicit Follow current cell restores it.
- [ ] Selected valid cells can remain inspectable when temporarily outside the rendered viewport.
- [ ] Matrix disappearance ends the visualizer lifetime; reappearance starts a fresh one.
- [ ] No Matrix-specific navigation path bypasses the existing visualizer registry/TraceVisualizer architecture.
- [ ] UI wording remains factual and does not infer DP recurrence, algorithm intent, dependencies, correctness, or root cause.
- [ ] Existing List / Dict / Linked List / Tree / Graph and behavioral-debugging tests remain green.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.

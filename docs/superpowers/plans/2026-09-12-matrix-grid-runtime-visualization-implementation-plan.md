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
- Modify `tests/execution/pyodide-runtime.test.ts` — prove real Python AST extraction reaches the trace result.
- Modify `tests/core/binding-resolver.test.ts` — prove Matrix relations do not corrupt one-dimensional bindings.
- Create `src/core/matrix-interpreter.ts` — strict detection, focus resolution, negative/OOB semantics, and cell-change projection.
- Create `tests/core/matrix-interpreter.test.ts` — pure Matrix interpretation coverage.
- Modify `src/core/visual-candidate.ts` — add `matrix` to `VisualKind`.
- Modify `src/core/visual-model.ts` — build Matrix visuals, enforce exclusive Matrix ownership, and add Matrix candidate priority.
- Modify `tests/core/visual-model.test.ts` — Matrix ownership, coexistence, ranking, and regression coverage.
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

- [ ] **Step 1: Write a failing end-to-end AST relation test**

Add a case to `tests/execution/pyodide-runtime.test.ts` that executes a minimal solution containing direct 2D access:

```python
class Solution:
    def inspect(self, matrix: list[list[int]], i: int, j: int):
        value = matrix[i][j]
        edge = matrix[0][-1]
        ignored = matrix[i + 1][j]
        return value + edge + ignored
```

Use the existing runtime helper in that test file, then assert the terminal result/session relation payload includes exactly the supported Matrix relations:

```ts
expect(result.subscriptRelations).toEqual(expect.arrayContaining([
  {
    kind: "matrix_subscript",
    scope: "Solution.inspect",
    line: expect.any(Number),
    container: "matrix",
    rowIndex: { kind: "variable", name: "i" },
    columnIndex: { kind: "variable", name: "j" }
  },
  {
    kind: "matrix_subscript",
    scope: "Solution.inspect",
    line: expect.any(Number),
    container: "matrix",
    rowIndex: { kind: "literal", value: 0 },
    columnIndex: { kind: "literal", value: -1 }
  }
]));
expect(result.subscriptRelations).not.toEqual(expect.arrayContaining([
  expect.objectContaining({
    kind: "matrix_subscript",
    rowIndex: expect.objectContaining({ name: "i + 1" })
  })
]));
```

Keep existing one-dimensional relation expectations in the same file unchanged.

- [ ] **Step 2: Run the focused runtime test and verify RED**

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts
```

Expected: FAIL because no `matrix_subscript` relation variant exists or is emitted.

- [ ] **Step 3: Add the TypeScript relation contract**

In `src/shared/trace-types.ts`, add:

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

and extend:

```ts
export type StaticRelation =
  | SubscriptRelation
  | IterationRelation
  | MembershipRelation
  | MatrixSubscriptRelation;
```

Do not rename `TraceSession.subscriptRelations`; it remains the backward-compatible transport field for static access relations.

- [ ] **Step 4: Implement direct chained-subscript extraction in Python**

In `src/worker/python/ast_analyzer.py`, add dataclasses:

```python
@dataclass(frozen=True)
class MatrixIndexOperand:
    kind: str
    name: str | None = None
    value: int | None = None


@dataclass(frozen=True)
class MatrixSubscriptRelation:
    kind: str
    scope: str
    line: int
    container: str
    rowIndex: MatrixIndexOperand
    columnIndex: MatrixIndexOperand
```

Add a strict operand parser:

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

At the start of `visit_Subscript`, detect only the exact nested shape:

```python
inner = node.value
if isinstance(inner, ast.Subscript) and isinstance(inner.value, ast.Name):
    row_operand = _matrix_index_operand(inner.slice)
    column_operand = _matrix_index_operand(node.slice)
    if row_operand is not None and column_operand is not None:
        self.relations.append(
            MatrixSubscriptRelation(
                kind="matrix_subscript",
                scope=self._scope_name(),
                line=node.lineno,
                container=inner.value.id,
                rowIndex=row_operand,
                columnIndex=column_operand,
            )
        )
```

Then continue the existing `generic_visit(node)` behavior so the established inner one-dimensional `matrix[i]` relation remains backward compatible.

- [ ] **Step 5: Validate the new relation variant in `ast-relations.ts`**

Refactor the validator so Matrix relations are not forced through the legacy `.index` contract:

```ts
function hasBaseRelationFields(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.scope === "string" &&
    Number.isInteger(candidate.line) &&
    typeof candidate.container === "string";
}

function isMatrixIndexOperand(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === "variable"
    ? typeof candidate.name === "string"
    : candidate.kind === "literal" && Number.isInteger(candidate.value);
}
```

Update `isStaticRelation()` so `kind === "matrix_subscript"` validates `rowIndex` and `columnIndex`; legacy kinds still require a string `.index`.

Update `normalizeSubscriptRelation()` to return a cloned valid `StaticRelation` without discarding the nested Matrix operands. Keep the exported function name for compatibility.

- [ ] **Step 6: Protect the one-dimensional binding resolver**

In `src/core/binding-resolver.ts`, skip Matrix relations before reading `.index`:

```ts
for (const relation of relations) {
  if (relation.kind === "membership" || relation.kind === "matrix_subscript") {
    continue;
  }
  // existing 1D binding logic
}
```

Add a regression to `tests/core/binding-resolver.test.ts`:

```ts
const matrixRelation: StaticRelation = {
  kind: "matrix_subscript",
  scope: "solve",
  line: 8,
  container: "dp",
  rowIndex: { kind: "variable", name: "i" },
  columnIndex: { kind: "variable", name: "j" }
};

expect(resolvePointerBindings([matrixRelation], runtime)).toEqual([]);
```

Also retain one existing List pointer assertion in the same test to prove ordinary bindings still work.

- [ ] **Step 7: Run focused tests and verify GREEN**

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts tests/core/binding-resolver.test.ts
```

Expected: PASS, with existing 1D relation/binding coverage unchanged.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/shared/trace-types.ts src/worker/python/ast_analyzer.py src/core/ast-relations.ts src/core/binding-resolver.ts tests/execution/pyodide-runtime.test.ts tests/core/binding-resolver.test.ts
git commit -m "feat: capture matrix subscript relations"
```

---

### Task 2: Pure Matrix Interpreter — Detection, Focus, and Cell Changes

**Files:**
- Create: `src/core/matrix-interpreter.ts`
- Create: `tests/core/matrix-interpreter.test.ts`

**Interfaces:**
- Consumes: `RuntimeState`, `StaticRelation[]`, `RuntimeMutation[]`.
- Produces: `MatrixVisualModel[]` via `buildMatrixVisuals(runtime, relations, mutations)`; exports `MatrixVisualModel`, `MatrixFocus`, and `MatrixCellChange` for visual-model/renderer consumers.

- [ ] **Step 1: Write failing strict-detection tests**

Create `tests/core/matrix-interpreter.test.ts` using the same small RuntimeState fixture style as existing `graph-interpreter.test.ts` / `tree-interpreter.test.ts`.

Cover valid values:

```ts
[
  [1, 2],
  [3, 4]
]
```

and mixed row sequence kinds:

```text
outer list
row 0 tuple
row 1 list
```

Assert:

```ts
expect(buildMatrixVisuals(runtime, [], [])).toEqual([
  expect.objectContaining({
    kind: "matrix",
    visualId: "matrix:dp",
    variableName: "dp",
    rowCount: 2,
    columnCount: 2
  })
]);
```

Add fail-closed cases for:

```text
[]
[[], []]
[[1, 2], [3]]
outer.truncated = true
row.truncated = true
row.length !== row.items.length
outer.length !== outer.items.length
cell type = dict / list / tuple / set / reference / unknown / cycle
```

- [ ] **Step 2: Run the new interpreter test and verify RED**

```bash
npx vitest run tests/core/matrix-interpreter.test.ts
```

Expected: FAIL because `matrix-interpreter.ts` does not exist.

- [ ] **Step 3: Implement strict Matrix detection and model cloning**

Create `src/core/matrix-interpreter.ts` with these public types:

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

Implement a private detector that accepts only complete positive-size sequence-of-sequences with scalar cells:

```ts
const MATRIX_SCALAR_TYPES = new Set(["int", "float", "bool", "str", "none"]);

function matrixRows(snapshot: ValueSnapshot | undefined): ValueSnapshot[][] | null {
  if (snapshot?.type !== "list" && snapshot?.type !== "tuple") return null;
  if (snapshot.truncated || snapshot.length === 0 || snapshot.items.length !== snapshot.length) return null;

  const rows: ValueSnapshot[][] = [];
  let columnCount: number | null = null;
  for (const row of snapshot.items) {
    if (row.type !== "list" && row.type !== "tuple") return null;
    if (row.truncated || row.length === 0 || row.items.length !== row.length) return null;
    if (columnCount === null) columnCount = row.length;
    if (row.length !== columnCount) return null;
    if (!row.items.every((cell) => MATRIX_SCALAR_TYPES.has(cell.type))) return null;
    rows.push(row.items.map(cloneValueSnapshot));
  }
  return rows;
}
```

Build visuals only from active-frame locals and sort variable names lexicographically before emitting models for deterministic ordering.

- [ ] **Step 4: Write failing focus-semantic tests**

Add Matrix relations and active-frame locals for `i`, `j`.

Assert:

```ts
expect(model.focuses).toEqual([
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
]);
```

for a `5 × 4` Matrix with `i = -1` and literal column `2`.

Add tests for:

```text
row raw = 8 → rowOutOfBounds true, effectiveRow null
column raw = -5 on width 4 → columnOutOfBounds true, effectiveColumn null
wrong source line → no focus
wrong scope → no focus
non-int local operand → no focus
multiple same-line Matrix relations → all resolvable focuses preserved in relation order
```

- [ ] **Step 5: Implement focus resolution**

Resolve operands without expression evaluation:

```ts
function resolveOperand(
  operand: MatrixIndexOperand,
  locals: Record<string, ValueSnapshot>
): { raw: number; source: "variable" | "literal"; variable?: string } | null {
  if (operand.kind === "literal") {
    return { raw: operand.value, source: "literal" };
  }
  const snapshot = locals[operand.name];
  if (snapshot?.type !== "int" || !/^-?\d+$/.test(snapshot.value)) return null;
  const raw = Number(snapshot.value);
  if (!Number.isSafeInteger(raw)) return null;
  return { raw, source: "variable", variable: operand.name };
}
```

Normalize each axis independently:

```ts
function effectiveIndex(raw: number, length: number): number | null {
  const candidate = raw < 0 ? length + raw : raw;
  return candidate >= 0 && candidate < length ? candidate : null;
}
```

Only consume `matrix_subscript` relations whose line equals `runtime.currentLine`, scope matches the active frame, and container equals the Matrix variable.

- [ ] **Step 6: Write failing mutation-projection tests**

Construct authoritative outer-row `SequenceElementMutation` fixtures:

```ts
{
  kind: "sequence_element",
  origin,
  frameId,
  containerName: "dp",
  containerKind: "list",
  index: 1,
  action: "changed",
  before: row([1, 2, 3]),
  after: row([1, 4, 5])
}
```

Assert exactly:

```ts
expect(model.changedCells).toEqual([
  expect.objectContaining({ row: 1, column: 1, action: "changed" }),
  expect.objectContaining({ row: 1, column: 2, action: "changed" })
]);
```

Also test:

- one changed cell;
- added final cell in a before/after row length transition when current Matrix is valid;
- removed cell evidence when safe to compare;
- mutation for another frame or container ignored;
- plain `variable` mutation ignored;
- invalid/ragged current Matrix emits no Matrix model even if mutation evidence exists.

- [ ] **Step 7: Implement authoritative cell-change projection**

Add a row-diff helper that accepts only before/after list/tuple snapshots and compares by cell index with `valueSnapshotsEqual()`:

```ts
function projectRowChanges(
  mutation: SequenceElementMutation
): MatrixCellChange[] {
  const before = sequenceItems(mutation.before);
  const after = sequenceItems(mutation.after);
  if (before === null && after === null) return [];

  const changes: MatrixCellChange[] = [];
  const count = Math.max(before?.length ?? 0, after?.length ?? 0);
  for (let column = 0; column < count; column += 1) {
    const left = before?.[column];
    const right = after?.[column];
    if (valueSnapshotsEqual(left, right)) continue;
    changes.push({
      row: mutation.index,
      column,
      action: left === undefined ? "added" : right === undefined ? "removed" : "changed",
      ...(left !== undefined ? { before: cloneValueSnapshot(left) } : {}),
      ...(right !== undefined ? { after: cloneValueSnapshot(right) } : {})
    });
  }
  return changes;
}
```

Only project mutations whose `frameId` is the active frame, `containerName` matches the Matrix variable, and row index is non-negative/currently meaningful evidence. Sort cell changes by row then column for deterministic output.

- [ ] **Step 8: Run interpreter tests and verify GREEN**

```bash
npx vitest run tests/core/matrix-interpreter.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

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
- Consumes: `buildMatrixVisuals(runtime, relations, mutations)` from Task 2.
- Produces: `StructureVisualModel` includes `MatrixVisualModel`; Matrix variables suppress same-variable List construction; Matrix candidates use the existing `VisualPriority` tuple.

- [ ] **Step 1: Write failing Matrix visual-model integration tests**

Add tests to `tests/core/visual-model.test.ts` for an active frame containing:

```text
dp = [[0, 0], [0, 0]]
nums = [4, 2, 7]
i = 1
j = 0
```

with a current-line `matrix_subscript` relation for `dp[i][j]`.

Assert:

```ts
expect(state.visuals).toEqual(expect.arrayContaining([
  expect.objectContaining({ kind: "matrix", visualId: "matrix:dp" }),
  expect.objectContaining({ kind: "list", visualId: "list:nums" })
]));
expect(state.visuals).not.toEqual(expect.arrayContaining([
  expect.objectContaining({ kind: "list", visualId: "list:dp" })
]));
expect(state.primaryVisualId).toBe("matrix:dp");
```

Add a ragged `dp` case and assert neither `matrix:dp` nor `list:dp` is visible.

Add a Matrix mutation case with no current-line focus and assert Matrix still receives the second-priority mutation signal without changing unrelated List/Graph behavior.

- [ ] **Step 2: Run the visual-model tests and verify RED**

```bash
npx vitest run tests/core/visual-model.test.ts
```

Expected: FAIL because Matrix is not a `VisualKind` or `StructureVisualModel` member.

- [ ] **Step 3: Add Matrix to the visual kind/model unions**

In `src/core/visual-candidate.ts`:

```ts
export type VisualKind = "list" | "dict" | "linked_list" | "tree" | "graph" | "matrix";
```

In `src/core/visual-model.ts` import:

```ts
import { buildMatrixVisuals, type MatrixVisualModel } from "./matrix-interpreter";
```

and extend:

```ts
export type StructureVisualModel =
  | ContainerVisualModel
  | LinkedListVisualModel
  | TreeVisualModel
  | GraphVisualModel
  | MatrixVisualModel;
```

- [ ] **Step 4: Enforce exclusive Matrix ownership before List construction**

In `buildVisualState(...)`:

```ts
const matrixVisuals = buildMatrixVisuals(runtime, relations, mutations);
const matrixVariables = new Set(matrixVisuals.map((visual) => visual.variableName));

const containerVisuals = containerNames
  .filter((container) => !matrixVariables.has(container))
  .map((container) => buildContainerVisual(runtime, bindings, container, relations, mutations))
  .filter((visual): visual is ContainerVisualModel => visual !== null);
```

Keep the existing nested-List candidate guard. This preserves the approved fail-closed behavior: unsupported nested sequences do not suddenly become ordinary List visuals.

Add Matrix visuals into `allVisuals` without changing existing visual order semantics beyond the new kind:

```ts
const allVisuals: StructureVisualModel[] = [
  ...containerVisuals,
  ...matrixVisuals,
  ...linkedListVisuals,
  ...treeVisuals,
  ...graphVisuals
];
```

- [ ] **Step 5: Add Matrix-specific current-line relevance and priority**

Build a direct Matrix relation set:

```ts
const activeLineMatrices = new Set(
  relations
    .filter((relation) =>
      relation.kind === "matrix_subscript" &&
      relation.line === runtime.currentLine &&
      frame !== undefined &&
      relationMatchesFrameScope(relation, frame.functionName)
    )
    .map((relation) => relation.container)
);
```

Before the generic container branch, add:

```ts
if (visual.kind === "matrix") {
  return {
    visualId: visual.visualId,
    kind: visual.kind,
    priority: [
      activeLineMatrices.has(visual.variableName),
      visual.changedCells.length > 0,
      visual.focuses.some((focus) =>
        !focus.rowOutOfBounds && !focus.columnOutOfBounds
      ),
      visual.focuses.length
    ] as const
  };
}
```

Do not make generic `matrix[i]` one-dimensional relations count as direct Matrix current-line relevance.

- [ ] **Step 6: Run Matrix + existing visual-model regressions and verify GREEN**

```bash
npx vitest run tests/core/visual-model.test.ts tests/core/binding-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

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
- Consumes: Matrix shape, viewport shape, and an in-bounds cell coordinate.
- Produces: deterministic `MatrixViewport` values through `initialMatrixViewport`, `matrixViewportContains`, `revealMatrixCell`, and `panMatrixViewport`.

- [ ] **Step 1: Write failing viewport tests**

Create tests for:

```ts
expect(initialMatrixViewport(5, 6)).toEqual({
  rowStart: 0,
  columnStart: 0,
  rowCount: 5,
  columnCount: 6
});

expect(initialMatrixViewport(30, 40)).toEqual({
  rowStart: 0,
  columnStart: 0,
  rowCount: 12,
  columnCount: 12
});
```

Then verify no movement when focus is already visible:

```ts
const viewport = { rowStart: 10, columnStart: 20, rowCount: 12, columnCount: 12 };
expect(revealMatrixCell(viewport, 15, 24, 30, 40)).toEqual(viewport);
```

Verify minimum movement when focus leaves an edge:

```ts
expect(revealMatrixCell(viewport, 22, 24, 30, 40)).toEqual({
  rowStart: 11,
  columnStart: 20,
  rowCount: 12,
  columnCount: 12
});
```

Also cover negative pan clamping, bottom/right clamping, and matrices smaller than the 12×12 window.

- [ ] **Step 2: Run viewport tests and verify RED**

```bash
npx vitest run tests/sidepanel/matrix-viewport.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the pure viewport helper**

Create:

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

Implement bounded initial state:

```ts
export function initialMatrixViewport(rowCount: number, columnCount: number): MatrixViewport {
  return {
    rowStart: 0,
    columnStart: 0,
    rowCount: Math.min(rowCount, MATRIX_VIEWPORT_ROWS),
    columnCount: Math.min(columnCount, MATRIX_VIEWPORT_COLUMNS)
  };
}
```

Implement containment and minimum-shift reveal. When a target is below/right of the viewport, set the start only far enough that the cell becomes the final visible row/column. Clamp starts to:

```ts
0 .. max(0, total - visibleCount)
```

Implement:

```ts
export function panMatrixViewport(
  viewport: MatrixViewport,
  deltaRows: number,
  deltaColumns: number,
  totalRows: number,
  totalColumns: number
): MatrixViewport
```

with the same clamping rules.

- [ ] **Step 4: Run viewport tests and verify GREEN**

```bash
npx vitest run tests/sidepanel/matrix-viewport.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/sidepanel/components/matrix-viewport.ts tests/sidepanel/matrix-viewport.test.ts
git commit -m "feat: add matrix viewport geometry"
```

---

### Task 5: Matrix Visualizer, Persistent Inspection, and Auto-Follow

**Files:**
- Modify: `src/sidepanel/components/SelectionInspector.ts`
- Modify: `tests/sidepanel/selection-inspector.test.ts`
- Create: `src/sidepanel/components/MatrixVisualizer.ts`
- Create: `tests/sidepanel/matrix-visualizer.test.ts`

**Interfaces:**
- Consumes: `MatrixVisualModel` and pure viewport helpers from Tasks 2/4.
- Produces: `createMatrixVisualizer(initialModel): MatrixVisualizerHandle`; shared inspector gains an opt-in `retainMissingSelection` predicate while default behavior remains unchanged.

- [ ] **Step 1: Write a failing shared-inspector retention test**

In `tests/sidepanel/selection-inspector.test.ts`, add a case where an inspected target is selected, then removed from the DOM while the key remains semantically valid:

```ts
const inspector = createSelectionInspector(section, getDetails, {
  retainMissingSelection: (key) => key === "cell:4:7"
});

inspector.select("cell:4:7");
target.remove();
inspector.refresh();

expect(inspector.selectedKey()).toBe("cell:4:7");
expect(section.textContent).toContain("dp[4][7]");
```

Add a default-behavior regression proving that without the option, a missing target still falls back exactly as today.

- [ ] **Step 2: Implement opt-in missing-target retention**

Extend the existing options type:

```ts
options: {
  preferredFallbackKey?: () => string | undefined;
  retainMissingSelection?: (key: string) => boolean;
} = {}
```

In `refresh()`, only fall back when the selected target is absent **and** the retention predicate does not approve the current key:

```ts
const targetExists = targets.some((target) => target.dataset.inspectKey === selectedKey);
const retainMissing = selectedKey !== undefined &&
  options.retainMissingSelection?.(selectedKey) === true;

if (!targetExists && !retainMissing) {
  // existing preferred/default fallback logic
}
```

Keep all existing consumers unchanged.

- [ ] **Step 3: Run shared inspector tests and verify GREEN**

```bash
npx vitest run tests/sidepanel/selection-inspector.test.ts
```

Expected: PASS with previous behavior unchanged by default.

- [ ] **Step 4: Write failing Matrix DOM/inspector tests**

Create `tests/sidepanel/matrix-visualizer.test.ts` with a small model:

```ts
const model: MatrixVisualModel = {
  kind: "matrix",
  visualId: "matrix:dp",
  variableName: "dp",
  rowCount: 2,
  columnCount: 3,
  cells: [
    [int("1"), int("2"), int("3")],
    [int("4"), int("7"), int("6")]
  ],
  focuses: [{
    rawRow: 1,
    rawColumn: 1,
    effectiveRow: 1,
    effectiveColumn: 1,
    rowOutOfBounds: false,
    columnOutOfBounds: false,
    rowSource: "variable",
    columnSource: "variable",
    rowVariable: "i",
    columnVariable: "j"
  }],
  changedCells: [{
    row: 1,
    column: 1,
    action: "changed",
    before: int("0"),
    after: int("7")
  }]
};
```

Assert:

```ts
const handle = createMatrixVisualizer(model);
expect(handle.element.querySelectorAll("[data-matrix-cell]")).toHaveLength(6);
expect(handle.element.querySelector('[data-row="1"][data-column="1"]')).toHaveClass("is-focus");
expect(handle.element.querySelector('[data-row="1"][data-column="1"]')).toHaveClass("is-changed");
```

Click `cell:1:1` and assert inspector text includes:

```text
dp[1][1]
value
7
changed
yes
before
0
after
7
row binding
i = 1
column binding
j = 1
```

Add a focus-only cell and assert no fake before/after fields appear.

Add an out-of-bounds focus and assert the UI shows:

```text
requested: dp[8][1]
row out of bounds
shape: 2×3
```

without rendering a fake row 8 cell.

- [ ] **Step 5: Implement the basic Matrix visualizer**

Create `MatrixVisualizer.ts` with:

```ts
export interface MatrixVisualizerHandle {
  element: HTMLElement;
  update(model: MatrixVisualModel): void;
  dispose(): void;
}
```

Use inspection keys:

```text
cell:<row>:<column>
```

Render row and column labels separately from inspectable cells. Use `formatValue()` for scalar values and `inspectionButton()` for each visible cell.

Maintain:

```ts
let currentModel = initialModel;
let viewport = initialMatrixViewport(initialModel.rowCount, initialModel.columnCount);
let autoFollowEnabled = true;
```

Use `createSelectionInspector(..., { retainMissingSelection })`, where retention parses `cell:r:c` and returns true only while `r/c` remain within `currentModel.rowCount/columnCount`.

Before each inspector refresh, if the selected key parses to a coordinate outside the **current shape**, call:

```ts
inspector.select(undefined);
```

so shape changes do not preserve stale coordinates.

- [ ] **Step 6: Write failing large-viewport/auto-follow tests**

Use a `30 × 30` Matrix fixture and assert only `12 × 12` cells render initially.

Test update with focus moving from `(3,3)` to `(3,4)` while both remain visible:

```ts
expect(currentViewport(handle.element)).toEqual(beforeViewport);
```

Then move focus to `(3,12)` and assert the viewport shifts exactly one column so column 12 becomes visible.

Add manual pan test:

```text
click "Pan right"
→ columnStart increments and auto-follow becomes disabled

update model with focus elsewhere
→ viewport does not move

click "Follow current cell"
→ auto-follow enabled and viewport reveals navigation-anchor focus
```

Use the **first in-bounds focus in `model.focuses`** as the deterministic navigation anchor. Out-of-bounds focuses never drive auto-follow.

Add a selection persistence case where a selected valid cell leaves the rendered viewport after auto-follow; assert the inspector retains the selected key/details even though its cell button is no longer mounted.

- [ ] **Step 7: Implement bounded viewport controls and conservative auto-follow**

Render viewport cells by slicing:

```ts
for (let row = viewport.rowStart; row < viewport.rowStart + viewport.rowCount; row += 1) {
  for (let column = viewport.columnStart; column < viewport.columnStart + viewport.columnCount; column += 1) {
    // render currentModel.cells[row][column]
  }
}
```

For large matrices, render controls with factual labels:

```text
Pan up
Pan down
Pan left
Pan right
Follow current cell
```

Each pan uses `panMatrixViewport(...)` and sets:

```ts
autoFollowEnabled = false;
```

On `update(model)`:

1. assign `currentModel`;
2. clamp/reinitialize viewport if shape shrank beyond current bounds;
3. find the first in-bounds focus;
4. if `autoFollowEnabled`, call `revealMatrixCell(...)`;
5. rerender only the bounded window;
6. refresh the inspector.

Do not recenter a visible focus.

If changed cells exist outside the visible viewport, render only factual summary text:

```text
N changed cells outside current view
```

No semantic coloring or dependency wording.

- [ ] **Step 8: Run Matrix visualizer and shared inspector tests**

```bash
npx vitest run tests/sidepanel/selection-inspector.test.ts tests/sidepanel/matrix-viewport.test.ts tests/sidepanel/matrix-visualizer.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

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
- Consumes: `StructureVisualModel` with `kind: "matrix"` and `createMatrixVisualizer()`.
- Produces: Matrix visualizer participates in the same create/update/dispose path and remains synchronized under direct-step, autoplay, timeline, failure-first, and folded navigation.

- [ ] **Step 1: Write failing registry tests**

In `tests/sidepanel/visualizer-registry.test.ts`, add a Matrix factory case:

```ts
const handle = createVisualizer(matrixModel);
expect(handle.kind).toBe("matrix");
expect(handle.element.dataset.visualId).toBe("matrix:dp");
```

Update with another `matrix:dp` model and assert cell contents change in place.

Retain the generic mismatched-kind assertion:

```ts
expect(() => updateVisualizer(handle, listModel)).toThrow(
  "Cannot update matrix visualizer with list"
);
```

- [ ] **Step 2: Register Matrix and verify registry tests GREEN**

In `visualizer-registry.ts`:

```ts
import { createMatrixVisualizer } from "./MatrixVisualizer";
```

Add:

```ts
matrix: (model: ModelOf<"matrix">) =>
  withVisualId(model, createMatrixVisualizer(model), "matrix")
```

Run:

```bash
npx vitest run tests/sidepanel/visualizer-registry.test.ts
```

Expected: PASS.

- [ ] **Step 3: Add Matrix CSS without semantic color coding**

In `src/sidepanel/styles.css`, add focused selectors for:

```text
.matrix-visualizer
.matrix-visualizer__header
.matrix-visualizer__viewport
.matrix-visualizer__grid
.matrix-visualizer__row-label
.matrix-visualizer__column-label
.matrix-visualizer__cell
.matrix-visualizer__cell.is-focus
.matrix-visualizer__cell.is-changed
.matrix-visualizer__cell.is-focus.is-changed
.matrix-visualizer__controls
.matrix-visualizer__notice
```

Use existing theme variables/current sidepanel visual language. Do not introduce value-based heatmaps. Focus and changed states must remain visually distinguishable when combined.

Ensure the grid is horizontally/vertically bounded inside the side panel and does not expand the whole page width.

- [ ] **Step 4: Write failing TraceVisualizer synchronization coverage**

Add a Matrix visual sequence to `tests/sidepanel/trace-visualizer.test.ts` using the same fixture helpers already used for Graph/Tree visual transitions.

Cover:

```text
step A: matrix:dp focus (0,0), value 0
step B: matrix:dp focus (0,1), changed (0,0), value updated
step C: matrix disappears because visuals no longer contain matrix:dp
step D: matrix:dp returns as a fresh visual lifetime
```

Assert:

- A→B reuses the same Matrix visualizer DOM root because `visualId` and kind are stable;
- B displays new runtime truth without stale focus/change classes;
- C disposes/removes Matrix DOM;
- D creates a new visualizer root rather than preserving the old viewport/selection lifetime.

Add or extend navigation assertions so the Matrix updates correctly through the existing direct-step and at least one alternate path already covered in this test file (Behavioral Timeline, Failure-First, folded navigation, or autoplay). Do not add Matrix-specific navigation code to `TraceVisualizer` unless a failing test proves the generic registry path is insufficient.

- [ ] **Step 5: Run sidepanel integration tests and verify GREEN**

```bash
npx vitest run tests/sidepanel/visualizer-registry.test.ts tests/sidepanel/matrix-visualizer.test.ts tests/sidepanel/trace-visualizer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/sidepanel/components/visualizer-registry.ts tests/sidepanel/visualizer-registry.test.ts src/sidepanel/styles.css tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: integrate matrix visualizer navigation"
```

---

### Task 7: Real Trace Fixture, Documentation, and Full Regression Gates

**Files:**
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify: `tests/core/trace-interpreter.test.ts` only if this file is the established end-to-end bridge from `TraceSession` to `VisualState`; otherwise keep the real trace assertion in the existing execution/visual-model integration path and do not create a parallel harness.
- Modify: `README.md`
- Modify: `README.zh-TW.md`

**Interfaces:**
- Consumes: complete implementation from Tasks 1–6.
- Produces: documented Matrix v0.1 behavior and evidence that a real LeetCode-style execution produces Matrix relation/runtime state that reaches the visual interpretation pipeline without DP-specific inference.

- [ ] **Step 1: Add a representative real-execution fixture**

Use this source in the established real Pyodide test path:

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

Use a testcase such as:

```text
[[1,3,1],[1,5,1],[4,2,1]]
```

Assert the trace completes and includes a `matrix_subscript` relation for `dp[i][j]`.

In the existing trace→visual-state test path, reconstruct a step after `dp` exists and assert:

```ts
expect(visualState.visuals).toEqual(expect.arrayContaining([
  expect.objectContaining({
    kind: "matrix",
    visualId: "matrix:dp"
  })
]));
```

Choose a step with an authoritative row mutation and assert Matrix evidence contains at least one changed cell. Assertions must remain factual; do not assert "DP" semantics.

- [ ] **Step 2: Run the focused real-trace/integration tests**

```bash
npx vitest run tests/execution/pyodide-runtime.test.ts tests/core/trace-interpreter.test.ts tests/core/visual-model.test.ts
```

Expected: PASS. If `trace-interpreter.test.ts` is not the current trace→visual bridge, run the actual existing bridge test instead and update this plan checkbox with the concrete command before committing implementation.

- [ ] **Step 3: Document Matrix / Grid v0.1**

Update both README files with supported factual behavior:

```text
Matrix / Grid v0.1
- rectangular 2D list / tuple scalar state
- direct matrix[i][j] focus
- negative-index normalization and out-of-bounds requested-cell evidence
- actual cell changes derived from runtime mutation evidence
- bounded focus-aware viewport for large matrices
- persistent cell inspection
```

Document explicit limitations:

```text
- no ragged/3D/sparse/NumPy visualization
- no alias recovery
- no i+1 / j-1 expression focus yet
- no DP recurrence or algorithm inference
- no expected-vs-actual correctness diagnosis
```

Do not market the feature as a solver or as automatic DP understanding.

- [ ] **Step 4: Run all focused Matrix tests together**

```bash
npx vitest run \
  tests/core/binding-resolver.test.ts \
  tests/core/matrix-interpreter.test.ts \
  tests/core/visual-model.test.ts \
  tests/sidepanel/matrix-viewport.test.ts \
  tests/sidepanel/selection-inspector.test.ts \
  tests/sidepanel/matrix-visualizer.test.ts \
  tests/sidepanel/visualizer-registry.test.ts \
  tests/sidepanel/trace-visualizer.test.ts \
  tests/execution/pyodide-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full project verification**

```bash
npm test
npm run typecheck
npm run build
```

Expected:

```text
all tests pass
typecheck exits 0
production build exits 0
```

Any failure in existing List / Dict / Linked List / Tree / Graph / Behavioral / Failure-First tests is a regression and must be fixed before completion.

- [ ] **Step 6: Review factual UI copy**

Search the new implementation/docs for prohibited semantic claims:

```bash
grep -RniE "dynamic programming|DP recurrence|wrong|bug|root cause|shortest path|BFS|DFS|dependency|caused" \
  src/core/matrix-interpreter.ts \
  src/sidepanel/components/MatrixVisualizer.ts \
  README.md README.zh-TW.md
```

Expected: no unsupported diagnostic/algorithm claims in Matrix UI copy. Documentation may mention unsupported features only in clearly labeled limitations/non-goals.

- [ ] **Step 7: Commit Task 7**

```bash
git add tests/execution/pyodide-runtime.test.ts tests/core/trace-interpreter.test.ts README.md README.zh-TW.md
git commit -m "test: validate matrix visualization end to end"
```

If `tests/core/trace-interpreter.test.ts` was not modified because another existing integration file is the correct bridge, stage that actual file instead.

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

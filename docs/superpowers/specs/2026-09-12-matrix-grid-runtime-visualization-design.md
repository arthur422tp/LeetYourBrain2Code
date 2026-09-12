# Matrix / Grid Runtime Visualization

## Design Spec v0.1

---

# 1. Goal

LeetYourBrain2Code already provides a factual runtime-debugging pipeline with live LeetCode editor synchronization, selected-testcase execution, Pyodide tracing, runtime-state reconstruction, Runtime Mutation Semantics, List / Dict / Linked List / Tree / Graph visualization, Behavioral Evidence Navigation, Trace Folding, and Failure-First entry.

The next visualization milestone is **Matrix / Grid Runtime Visualization v0.1**.

The goal is to recognize runtime values that can be proven to be rectangular two-dimensional scalar sequences and render them as a step-by-step Matrix visual with direct source focus and actual cell mutation evidence.

This milestone is intentionally broader than "DP visualization". It should cover runtime structures used by:

- dynamic-programming tables;
- grid traversal;
- board / backtracking problems;
- visited matrices;
- image-like integer / boolean grids;
- other rectangular 2D list / tuple state.

It must not infer that a matrix is a DP table, identify a recurrence, classify the algorithm, or diagnose correctness.

Core acceptance statement:

> Given a complete captured rectangular 2D scalar Python sequence, each raw trace step can deterministically render its current cells, direct `matrix[row][column]` focus, and cell-level mutation evidence derived from authoritative RuntimeMutation data, without inferring algorithm intent or correctness.

---

# 2. Product Principle

The project keeps its existing rule:

> Visualize what the program actually did.

Matrix v0.1 distinguishes three kinds of facts:

```text
runtime structure
source focus
runtime mutation
```

They are related but not interchangeable.

For example, for:

```python
dp[i][j] = min(dp[i - 1][j], dp[i][j - 1]) + 1
```

Matrix v0.1 may show:

```text
focus:   dp[i][j]
changed: dp[2][3]
before:  0
after:   7
```

It must not claim:

```text
This is a DP recurrence
These two source cells caused the update
Your recurrence is incorrect
This cell caused the bug
```

Operand-level dependency interpretation belongs to a later Expression / Condition Tracing phase.

---

# 3. Scope

Matrix / Grid Runtime Visualization v0.1 includes:

1. strict rectangular 2D list / tuple detection;
2. scalar-cell validation;
3. direct chained-subscript AST relations for `matrix[row][column]`;
4. variable and integer-literal row / column operands;
5. current-line row / column focus resolution;
6. Python negative-index normalization;
7. explicit out-of-bounds requested-cell evidence;
8. cell-level change projection from existing RuntimeMutation events;
9. a dedicated `MatrixVisualModel`;
10. exclusive specialized ownership over supported nested sequences;
11. integration with the existing visual candidate resolver;
12. focus-aware viewport behavior for large matrices;
13. persistent cell selection and inspector interaction;
14. manual viewport navigation;
15. conservative auto-follow behavior;
16. deterministic update / dispose lifecycle;
17. unit, DOM, integration, and regression tests.

---

# 4. Explicit Non-Goals

Matrix v0.1 does not implement:

- DP recurrence detection;
- algorithm classification;
- BFS / DFS / shortest-path semantics;
- source-cell dependency arrows;
- expression evaluation for indices such as `i + 1` or `j - 1`;
- operand tracing for expressions such as `dp[i - 1][j]`;
- local alias dataflow such as `row = matrix[i]; row[j] = value`;
- ragged-matrix visualization;
- 3D tensors or arbitrary nested-container visualization;
- dict-based sparse matrices;
- NumPy arrays;
- non-scalar cells;
- expected-vs-actual matrix comparison;
- correctness diagnosis;
- root-cause analysis;
- automatic fix suggestions;
- semantic heatmaps or value-dependent coloring;
- user-configurable matrix semantics.

---

# 5. Architectural Choice

Matrix v0.1 uses an **interpretation-layer architecture**.

Existing trace and RuntimeMutation contracts remain authoritative and unchanged.

```text
Python source
    │
    └── MatrixSubscriptRelation
              │
              ▼
Runtime trace ──→ RuntimeState
              │
              └── RuntimeMutation[]
                     │
                     ▼
              Matrix Interpreter
              ├── structure validation
              ├── focus resolution
              └── cell-change projection
                     │
                     ▼
              MatrixVisualModel
                     │
                     ▼
            existing candidate resolver
                     │
                     ▼
              MatrixVisualizer
```

Core invariant:

```text
runtime truth ≠ matrix interpretation ≠ renderer UI state
```

Matrix-specific cell changes are **derived visual evidence**, not a new core RuntimeMutation primitive.

This avoids changing the established Behavioral Pattern, Trace Folding, and mutation contracts for a presentation-specific 2D interpretation.

---

# 6. Matrix Source Relation

## 6.1 New relation kind

The AST analyzer adds a relation for direct chained subscripts:

```ts
interface MatrixSubscriptRelation {
  kind: "matrix_subscript";
  scope: string;
  line: number;
  container: string;
  rowIndex: MatrixIndexOperand;
  columnIndex: MatrixIndexOperand;
}

type MatrixIndexOperand =
  | { kind: "variable"; name: string }
  | { kind: "literal"; value: number };
```

The relation is emitted only when the AST directly represents:

```text
Subscript(
  value = Subscript(
    value = Name(container),
    slice = supported row operand
  ),
  slice = supported column operand
)
```

## 6.2 Supported forms

Examples that produce a Matrix relation:

```python
matrix[i][j]
matrix[0][j]
matrix[i][-1]
matrix[-1][-2]
```

An integer literal includes ordinary integer constants and unary `+` / `-` applied directly to an integer constant, because Python parses `-1` as a unary operation rather than a negative Constant node.

## 6.3 Unsupported focus expressions

These do not produce a Matrix focus relation in v0.1:

```python
matrix[i + 1][j]
matrix[i][j - 1]
matrix[len(matrix) - 1][j]
row = matrix[i]
row[j]
```

The code still executes normally, and actual runtime mutations may still be visible as cell changes when they can be derived from authoritative RuntimeMutation data.

The analyzer must not serialize arbitrary Python expressions and evaluate them later.

## 6.4 Existing relation compatibility

Existing one-dimensional Subscript, Iteration, and Membership relation extraction must retain its current behavior.

Adding `matrix_subscript` must not change the trace interpretation of existing List or Dict visuals.

---

# 7. Matrix Detection Contract

Matrix detection is strict and fail-closed.

A local snapshot is a valid Matrix candidate only when all of the following are true:

```text
outer snapshot type ∈ {list, tuple}
outer length > 0
outer snapshot is not truncated
every captured outer item is a list or tuple
every row is not truncated
every row has the same positive length
every cell is an allowed scalar snapshot
```

Allowed scalar cell types are:

```text
int
float
bool
str
none
```

The following are not scalar Matrix cells in v0.1:

```text
reference
list
tuple
dict
set
unknown
cycle
```

Examples:

```python
[[1, 2], [3, 4]]       # valid
((1, 2), [3, 4])       # valid
[[True, False], [False, True]]  # valid

[]                     # not Matrix
[[], []]               # not Matrix
[[1, 2], [3]]          # ragged, not Matrix
[[1, {"x": 2}], [3, 4]]  # non-scalar cell, not Matrix
```

## 7.1 Truncation rule

Matrix v0.1 requires enough runtime evidence to prove rectangular shape.

Therefore:

```text
outer truncated → no MatrixVisualModel
any row truncated → no MatrixVisualModel
```

Matrix v0.1 does not render a speculative partial matrix from a truncated runtime snapshot.

Because truncated snapshots fail detection, `MatrixVisualModel` does not need a runtime-truncation flag. UI viewport clipping is a separate presentation concern and must not be described as runtime capture truncation.

## 7.2 Ragged transition

If a runtime value was a valid Matrix on one step but becomes ragged on the next step, Matrix interpretation ends for that step.

Example:

```python
grid[0].append(9)
```

may transition:

```text
3×3 rectangular
→ row lengths [4,3,3]
```

The current step produces no Matrix visual.

If later runtime state becomes rectangular again, Matrix interpretation may resume.

The interpreter must never assume current Matrix validity from previous-step validity.

---

# 8. Matrix Visual Model

The renderer receives an interpreted presentation model rather than RuntimeState or AST data directly.

Conceptually:

```ts
interface MatrixCellChange {
  row: number;
  column: number;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

interface MatrixFocus {
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

interface MatrixVisualModel {
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

`visualId` is:

```text
matrix:<variableName>
```

for example:

```text
matrix:dp
matrix:grid
matrix:visited
```

`rowCount` and `columnCount` represent the validated complete runtime shape.

The model contains runtime facts only. It does not contain viewport position, selected DOM element, animation state, or auto-follow preference.

---

# 9. Focus Semantics

Focus and mutation are separate evidence channels.

A Matrix focus is produced only when all of these conditions hold:

```text
relation.kind === "matrix_subscript"
relation.line === runtime.currentLine
relation scope matches the active frame
relation.container matches a currently valid Matrix local
both row and column operands resolve to integers
```

Variable operands resolve from active-frame locals and must be integer snapshots.

Literal operands use their AST integer value directly.

## 9.1 Negative indexing

Matrix focus follows Python sequence indexing semantics.

Given shape `R × C`:

```text
effectiveRow = rawRow < 0 ? R + rawRow : rawRow
effectiveColumn = rawColumn < 0 ? C + rawColumn : rawColumn
```

Example:

```text
shape = 5×4
raw focus = (-1, 2)
effective focus = (4, 2)
```

The model preserves both raw and effective indices.

## 9.2 Out-of-bounds focus

Out-of-bounds requests are retained as evidence rather than silently dropped.

Example:

```text
shape = 5×6
requested = dp[8][3]
rowOutOfBounds = true
effectiveRow = null
```

The renderer must not synthesize a fake cell outside the Matrix.

It may present factual requested-cell information in the Matrix header or inspector.

## 9.3 Multiple focus relations

A single source line may contain multiple direct Matrix relations.

All resolvable current-line relations for a valid Matrix may be represented in `focuses`.

Matrix v0.1 does not assign read/write or dependency semantics to those focuses.

---

# 10. Cell Mutation Projection

`RuntimeMutation[]` remains the sole mutation authority.

Matrix v0.1 must not compare previous and current `MatrixVisualModel` instances as an independent mutation engine.

The expected flow is:

```text
FrameDiff
  ↓
RuntimeMutation(sequence_element on outer matrix row)
  ↓
Matrix Interpreter
  ↓
row before / after sequence diff
  ↓
MatrixCellChange[]
```

For example, authoritative mutation evidence may contain:

```text
kind = sequence_element
containerName = "dp"
index = 2
before = [0, 0, 0, 0]
after  = [0, 0, 7, 0]
```

The Matrix interpreter may project:

```text
row = 2
column = 2
action = changed
before = 0
after = 7
```

If multiple cells differ in the row snapshots, each difference becomes a separate `MatrixCellChange`.

Example:

```text
before = [1, 2, 3]
after  = [1, 4, 5]
```

projects exactly two changed cells.

## 10.1 Projection eligibility

Cell-level changes are projected only when:

- the mutation is an authoritative outer-container `sequence_element` mutation for the Matrix variable;
- the mutation's before / after row values are sequence snapshots that can be compared safely;
- the current runtime local still passes Matrix detection.

If current state is ragged or otherwise invalid, no Matrix visual and no Matrix cell-change presentation are produced for that step.

## 10.2 Added / removed cells

`MatrixCellChange` keeps `added` and `removed` actions because a row-level authoritative mutation may expose length changes in before / after evidence.

However, current Matrix state must still pass the rectangular detection contract before any Matrix visual is emitted.

The interpreter does not invent missing cells to preserve rectangularity.

---

# 11. Specialized Visual Ownership

A valid Matrix local is owned by Matrix interpretation for that step.

The same runtime variable must not simultaneously produce both:

```text
ListVisualModel(variableName = "dp")
MatrixVisualModel(variableName = "dp")
```

Rule:

```text
one runtime variable
→ one structural interpretation at a time
```

This extends the current policy that nested container Lists are excluded from ordinary List candidate selection.

If a Matrix becomes unsupported or ragged, Matrix visual ownership ends. Matrix v0.1 does not fall back to rendering the nested value as a giant one-dimensional List visual.

---

# 12. Candidate Resolver Integration

Matrix joins the existing `StructureVisualModel` union and existing visual-candidate pipeline.

No Matrix-specific orchestration or second candidate resolver is introduced.

Conceptual Matrix candidate priority is:

```text
[
  activeLineReferencesMatrix,
  hasDerivedCellChange,
  hasValidFocus,
  focusCount
]
```

Meaning:

1. a Matrix directly referenced on the current source line receives the strongest contextual signal;
2. actual cell mutation evidence is next;
3. valid row / column focus contributes pointer-like relevance;
4. the number of focus relations is a final relevance signal.

Existing candidate resolution still decides primary versus secondary visible visuals.

A Matrix must not remain primary merely because its runtime shape looks Matrix-like when current execution context is unrelated.

---

# 13. Matrix Visualizer

The Matrix renderer follows the same lifecycle style as existing specialized visualizers.

Conceptually:

```ts
interface MatrixVisualizerHandle {
  element: HTMLElement;
  update(model: MatrixVisualModel): void;
  dispose(): void;
}
```

For a continuous valid Matrix lifetime, a stable `visualId` should update the existing visualizer instance rather than rebuild the entire DOM every trace step.

The renderer may persist only user viewing state:

```text
selected cell
viewport position
auto-follow enabled / disabled
```

The renderer must not persist runtime truth such as:

```text
focus
changed-cell status
matrix values
matrix shape
```

Those are rebuilt from each new `MatrixVisualModel`.

If the Matrix visual disappears because current state is invalid, the visualizer handle is disposed. If Matrix interpretation later resumes, a new handle is created; v0.1 does not preserve UI state across an interval where no Matrix exists.

---

# 14. Cell Presentation and Inspector

Each visible cell presents its current factual value.

A cell may independently have:

```text
normal
focus
changed
```

`focus` and `changed` are orthogonal and may coexist on the same cell.

The UI must not collapse them into one generic highlight because they answer different questions:

```text
focus   = current source line directly addresses this cell
changed = authoritative runtime evidence says this cell changed this step
```

Selecting a cell opens the existing inspector pattern with factual details such as:

```text
dp[2][3]

value: 7
type: int
row: 2
column: 3
focus: yes
changed: yes
before: 0
after: 7
row binding: i = 2
column binding: j = 3
```

Before / after fields appear only when an actual MatrixCellChange exists.

For out-of-bounds focus, the UI presents requested-index evidence rather than a fake selectable cell:

```text
requested: dp[8][3]
status: row out of bounds
shape: 5×6
```

---

# 15. Viewport Behavior

Matrix v0.1 supports two presentation modes.

## 15.1 Small Matrix mode

Small matrices render the full validated Matrix.

A practical initial threshold may be approximately:

```text
12 rows × 12 columns
```

The exact threshold is an implementation constant, not part of the trace or model contract.

## 15.2 Windowed mode

Larger matrices render a bounded rectangular viewport, initially approximately:

```text
12 × 12 cells
```

Conceptual UI state:

```ts
interface MatrixViewport {
  rowStart: number;
  columnStart: number;
  rowCount: number;
  columnCount: number;
}
```

The viewport is presentation-only state.

## 15.3 Auto-follow

Auto-follow is deliberately conservative.

```text
focus remains visible
→ keep viewport unchanged

focus leaves viewport
AND auto-follow is enabled
→ shift the minimum distance required to reveal focus
```

The renderer must not recenter the Matrix on every loop iteration.

For a typical nested loop, moving `j` from 3 to 4 while both cells are visible must not move the viewport.

## 15.4 Manual navigation

Once the user manually changes the viewport, automatic focus movement is disabled for that visualizer instance.

The UI provides an explicit action such as:

```text
Follow current cell
```

to re-enable auto-follow.

## 15.5 Focus versus changed-cell viewport priority

If current focus and a changed cell cannot both fit in the viewport, focus is the navigation anchor.

Changed-cell evidence outside the viewport may be summarized factually, for example:

```text
1 changed cell outside current view
```

and may provide a direct navigation action.

The viewport should not expand arbitrarily to include every changed cell.

---

# 16. Failure and Unsupported-State Behavior

Matrix interpretation is evidence-driven and fail-closed.

## 16.1 AST relation without valid runtime Matrix

A `matrix_subscript` relation does not create Matrix semantics by itself.

Example:

```python
matrix[i][j]
```

with runtime state:

```python
matrix = None
```

or:

```python
matrix = [[1], [2, 3]]
```

produces no Matrix visual.

Source relation can only annotate a runtime structure that independently passes Matrix validation.

## 16.2 Invalid index operand at runtime

If a variable index operand exists in the AST relation but the active-frame local is not an integer snapshot, that relation produces no Matrix focus.

The Matrix itself may still render if its structure remains valid.

## 16.3 Runtime capture insufficient to prove shape

Any required outer / row truncation causes Matrix detection to fail.

The renderer must not display unknown uncaptured cells as empty, zero, or `None`.

---

# 17. Testing Strategy

Matrix v0.1 requires tests at AST, interpreter, renderer, integration, and full-regression levels.

## 17.1 AST relation tests

Must cover:

```python
matrix[i][j]
matrix[0][j]
matrix[i][-1]
matrix[-1][-2]
```

and reject Matrix focus extraction for:

```python
matrix[i + 1][j]
matrix[i][j - 1]
matrix[len(matrix) - 1][j]
row = matrix[i]
row[j]
```

Also verify:

- same-line multiple Matrix relations;
- class / function scope handling;
- existing Subscript / Iteration / Membership extraction regression coverage.

## 17.2 Detector / interpreter tests

Must cover:

- rectangular list-of-lists;
- tuple / list row combinations;
- integer / float / bool / str / none scalar cells;
- empty outer sequence rejection;
- zero-column rejection;
- ragged rejection;
- non-scalar cell rejection;
- outer truncation rejection;
- row truncation rejection;
- negative row normalization;
- negative column normalization;
- row out-of-bounds;
- column out-of-bounds;
- scope filtering;
- line filtering;
- multiple focuses;
- literal and variable operands;
- row mutation projecting exactly one cell change;
- row mutation projecting multiple cell changes;
- invalid current Matrix state suppressing Matrix visual and derived cell presentation.

## 17.3 Candidate integration tests

Must verify:

- valid Matrix suppresses same-variable one-dimensional List visualization;
- Matrix participates in the existing candidate resolver;
- current-line Matrix relevance can make the expected Matrix primary;
- unrelated Matrix locals do not permanently dominate the visual surface;
- existing List / Dict / Linked List / Tree / Graph candidate behavior does not regress.

## 17.4 DOM / interaction tests

Must verify:

- scalar cell rendering;
- row and column labels;
- focus styling;
- changed styling;
- focus + changed coexistence;
- cell inspector contents;
- out-of-bounds requested-cell evidence;
- full rendering for small Matrix mode;
- bounded rendering for windowed mode;
- focus inside viewport does not move viewport;
- focus outside viewport auto-follows when enabled;
- manual viewport movement disables auto-follow;
- explicit follow action re-enables auto-follow;
- cell selection persists across ordinary `update()` calls while the selected coordinate remains valid;
- renderer does not retain stale focus / mutation facts across trace navigation.

## 17.5 End-to-end fixtures

At least one representative fixture should exercise a normal LeetCode-style Matrix local through the real trace pipeline.

Example:

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

The integration test should confirm that trace navigation produces a `matrix:dp` visual and that focus / changed-cell evidence updates without introducing DP-specific claims.

---

# 18. Regression Gates

The milestone is complete only when the full project gates remain green:

```bash
npm test
npm run typecheck
npm run build
```

Regression coverage must include existing behavior for:

- List visualization;
- Dict visualization;
- Linked List visualization;
- Tree visualization;
- Graph visualization;
- visual candidate selection;
- stable visual ordering;
- Runtime Mutation Semantics;
- Behavioral Timeline;
- Trace Folding;
- Failure-First entry.

Matrix support must not require changing the factual semantics of those existing subsystems.

---

# 19. Acceptance Criteria

Matrix / Grid Runtime Visualization v0.1 is accepted when all of the following are true:

1. Direct supported `matrix[row][column]` source expressions generate deterministic Matrix relations.
2. Only complete, rectangular, non-empty 2D list / tuple values with scalar cells become Matrix visuals.
3. Ragged, truncated, empty, zero-column, and non-scalar nested sequences fail closed.
4. Negative indices follow Python effective-index semantics while preserving raw index evidence.
5. Out-of-bounds focus is explicit and does not create fake cells.
6. Matrix cell changes are derived only from authoritative RuntimeMutation evidence.
7. Focus and changed-cell evidence remain semantically separate.
8. A supported Matrix variable does not simultaneously render as an ordinary List visual.
9. Matrix uses the existing visual candidate resolver and stable visual lifecycle.
10. Small matrices render fully; large matrices use a bounded viewport.
11. Auto-follow does not move the viewport while current focus remains visible.
12. Manual viewport navigation can suspend auto-follow and an explicit action can restore it.
13. Cell selection and inspection remain stable across ordinary trace-step updates.
14. Matrix UI makes no DP, traversal, correctness, root-cause, or dependency inference.
15. Existing visualization and behavioral-debugging regression gates remain green.

---

# 20. Future Extensions

Possible follow-up phases, explicitly outside v0.1:

```text
Expression / Condition Tracing
→ matrix[i - 1][j] operand evidence
→ condition evaluation
→ expression-level value flow

Matrix / Grid v0.2
→ optional ragged visualization
→ richer viewport navigation
→ explicit row / column selection

Behavioral Debugging v2
→ use richer factual evidence without introducing unsupported correctness claims
```

No future extension should retroactively change the v0.1 invariant that Matrix visualization represents observed runtime state rather than inferred algorithm intent.

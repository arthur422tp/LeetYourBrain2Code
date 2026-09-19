# Recursion / Call-Frame Execution Story UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the completed Call-Frame / Recursion Evidence foundation into a compact, frame-aware Execution Story UI that lets users visually follow concrete user-function calls, recursion ancestry, arguments, exits, exceptions, and current-frame context while preserving the existing raw trace cursor and evidence-first product boundary.

**Architecture:** Keep `CallFrameModel`, `FrameEvidenceIndex`, raw `TraceEvent.frameId`, and the existing Decision / Control-Flow / Expression / Mutation layers authoritative. Add a pure TypeScript `call-frame-story` projection that resolves qualified labels, current-path ancestry, cursor-relative frame status, evidence counts, and bounded tree presentation. Render that projection in a focused `CallFrameStory` component composed into the existing **Execution Story** panel. Refactor the Execution Story rendering path into a persistent handle so user-expanded/collapsed frame nodes survive raw-step navigation. All frame navigation resolves back into the existing raw trace cursor; no worker protocol, trace schema, runtime recorder, or second execution cursor is introduced.

**Tech Stack:** TypeScript 5.8, DOM APIs, Vitest 3.2, existing Side Panel CSS, existing Call-Frame Evidence schema v6, Pyodide runtime unchanged, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-20-recursion-call-frame-execution-story-ui-design.md`

**Runtime dependency:** `docs/superpowers/specs/2026-09-19-recursion-call-frame-evidence-foundation-design.md`

**Correction dependency:** `docs/superpowers/specs/2026-09-20-call-frame-foundation-correction-design.md`

---

## Global Constraints

- The Call Tree is a projection of factual `FrameOccurrence` evidence; it must never reconstruct missing frames from function names, source indentation, stack text, or source call expressions.
- The raw trace cursor remains authoritative. Every frame navigation action resolves to an existing raw step and then to the existing trace index.
- No worker protocol, trace schema, Python tracer, CallFrameRecorder, or runtime instrumentation change is required for this UI milestone.
- `FrameOccurrence.exit` is a **session-final observed outcome**, not automatically the frame state at the current raw cursor.
- The UI must preserve the temporal distinction between:
  - frame active at the current step; and
  - frame observed later to return / raise / trace-end in the captured run.
- General call-stack depth and recursive depth remain distinct.
- A repeated function name is not recursion. Recursion presentation uses existing `RecursionOccurrenceInfo` derived from static `functionId` ancestry.
- Repeated sibling calls remain distinct concrete frame rows.
- Mutual recursion may show factual cycle metadata but must not be described as pathological.
- `self` / `cls` may be visually de-emphasized in compact argument labels but must remain in underlying evidence.
- Existing Decision, Control-Flow, Expression, Mutation, Behavioral, Failure-First, Call Stack, and Visual State surfaces retain ownership of their details.
- Call Tree must not infer:
  - expected call structure;
  - missing base case;
  - correctness;
  - root cause;
  - fix;
  - backtracking semantics;
  - algorithm identity;
  - recursion complexity;
  - excessive depth.
- Existing Control-Flow Execution Story remains valid and must be composed **inside the same Execution Story panel**, not replaced by a competing panel.
- The full Call Tree is canonical in Execution Story. Trace Outline should not gain a duplicate full hierarchy in v0.1.
- Call-frame tracing `truncated` / `unavailable` states preserve already captured nodes.
- UI presentation folding is independent from evidence truncation.
- Semantic states must be expressed through text and DOM/data attributes, not color alone.
- Full test suite, Python fixture suite, typecheck, and production build must remain green.

---

# Task 0: Wire Existing Call-Frame Session Evidence Into TraceVisualizer

**Why first:** The core foundation is complete, but the current `TraceVisualizer` call to `interpretTrace()` stops at Control-Flow termination context and does not pass the already available `session.functionPlan`, `session.callFrameBatches`, or `session.callFrameTracing`. A Call Tree UI built before fixing this seam would render an empty model in the actual product path.

**Files:**
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

**No changes:**
- `src/shared/worker-protocol.ts`
- `src/shared/trace-types.ts`
- Python runtime / tracer / recorder

- [ ] **Step 1: Add a failing TraceVisualizer regression proving session Call-Frame evidence reaches core interpretation**

Add a focused fixture to `tests/sidepanel/trace-visualizer.test.ts`:

```ts
function callFrameSession(): TraceSession {
  const fixture = session();
  fixture.functionPlan = {
    version: 1,
    functions: [{
      functionId: "method:Solution.solve",
      kind: "method",
      name: "solve",
      qualifiedName: "Solution.solve",
      span: { line: 2, column: 4, endLine: 4, endColumn: 16 },
      firstBodyLine: 3,
      parameterNames: ["self", "n"],
      parameterKinds: ["positional_or_keyword", "positional_or_keyword"]
    }]
  };
  fixture.callFrameBatches = [{
    batchId: 1,
    updates: [{
      updateId: 1,
      kind: "frame_enter",
      frameId: 1,
      parentFrameId: null,
      functionName: "solve",
      functionId: "method:Solution.solve",
      callStep: fixture.events[0]!.step,
      depth: 1,
      arguments: [
        { name: "n", kind: "positional_or_keyword", value: { type: "int", value: "3" } }
      ]
    }]
  }];
  fixture.callFrameTracing = { status: "complete" };
  return fixture;
}
```

At this prerequisite stage, assert a test-only integration observable from the future frame-aware story seam or, if the story model is not yet present, temporarily assert through a small exported helper that `interpretTrace` receives a non-empty `callFrames.byFrameId`.

Preferred path: add the regression alongside Task 1 and keep this step red until the minimal wiring is added.

- [ ] **Step 2: Pass all optional Call-Frame fields into `interpretTrace()`**

Update:

```ts
const interpretation = interpretTrace(
  session.events,
  session.subscriptRelations ?? [],
  session.expressionPlan,
  session.expressionBatches ?? [],
  session.conditionPlan,
  session.decisionBatches ?? [],
  session.controlFlowPlan,
  session.controlFlowBatches ?? [],
  { status: session.status, terminationReason: session.terminationReason },
  session.functionPlan,
  session.callFrameBatches ?? [],
  session.callFrameTracing
);
```

No other behavior changes yet.

- [ ] **Step 3: Add backward-compatibility coverage**

Create a session with no Call-Frame fields and verify existing `TraceVisualizer` behavior remains unchanged.

Expected:

```text
no crash
no fabricated Call Tree
existing panels still render
```

- [ ] **Step 4: Run focused tests**

```bash
npx vitest run   tests/sidepanel/trace-visualizer.test.ts   tests/core/call-frame-interpreter.test.ts   tests/core/frame-evidence-index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 0**

```bash
git add   src/sidepanel/components/TraceVisualizer.ts   tests/sidepanel/trace-visualizer.test.ts
git commit -m "fix: expose call frame evidence to trace visualizer"
```

---

# Task 1: Build the Pure Call-Frame Story Projection

**Files:**
- Create: `src/core/call-frame-story.ts`
- Create: `tests/core/call-frame-story.test.ts`

**Consumes:**
- `CallFrameModel`
- `FrameEvidenceIndex`
- `FunctionPlan`
- `TraceEvent[]`
- current raw index

**Produces:**
- display-safe frame nodes;
- current frame;
- current ancestry;
- cursor-relative temporal status;
- compact evidence counts;
- deterministic runtime tree/forest;
- no DOM.

## Exact interfaces

Define:

```ts
export type FrameAtCursorStatus =
  | "not_started"
  | "active"
  | "exited"
  | "unknown";

export interface CallFrameEvidenceCounts {
  decisions: number;
  loopIterations: number;
  expressions: number;
  mutations: number;
}

export interface CallFrameStoryNode {
  frameId: number;
  functionId?: string;
  functionName: string;
  qualifiedName?: string;
  displayName: string;
  arguments: BoundArgumentSnapshot[];
  callStep: number;
  firstUserLineStep?: number;
  exit: FrameExit;
  atCursor: FrameAtCursorStatus;
  recursion: RecursionOccurrenceInfo;
  childFrameIds: number[];
  evidenceCounts: CallFrameEvidenceCounts;
}

export interface CallFrameStoryModel {
  roots: number[];
  byFrameId: Map<number, CallFrameStoryNode>;
  currentFrameId?: number;
  currentPath: number[];
  tracingState: CallFrameTracingState;
}

export interface BuildCallFrameStoryInput {
  callFrames: CallFrameModel;
  frameEvidenceIndex: FrameEvidenceIndex;
  functionPlan?: FunctionPlan;
  events: TraceEvent[];
  currentRawIndex: number;
}
```

- [ ] **Step 1: Add failing projection tests for labels, ordering, and evidence counts**

Build a model:

```text
Solution.solve frame 1
├─ helper frame 2
└─ helper frame 3
```

Assert:

```ts
expect(model.roots).toEqual([1]);
expect(model.byFrameId.get(1)?.childFrameIds).toEqual([2, 3]);
expect(model.byFrameId.get(2)?.qualifiedName).toBe("Solution.helper");
expect(model.byFrameId.get(2)?.evidenceCounts).toEqual({
  decisions: 2,
  loopIterations: 1,
  expressions: 3,
  mutations: 4
});
```

Child order must exactly match `FrameOccurrence.childFrameIds`.

- [ ] **Step 2: Resolve static descriptors without changing runtime identity**

Build:

```ts
const descriptorById = new Map(
  input.functionPlan?.functions.map(item => [item.functionId, item])
);
```

For each frame:

```text
qualifiedName = descriptor?.qualifiedName
displayName = qualifiedName ?? functionName ?? "user function"
```

Do not use function name to retroactively assign a `functionId`.

- [ ] **Step 3: Attach evidence counts from FrameEvidenceIndex**

Map:

```ts
decisions      = entry?.decisionAnchors.length ?? 0
loopIterations = entry?.controlFlowIterationRefs.length ?? 0
expressions    = entry?.expressionAnchors.length ?? 0
mutations      = entry?.mutationAnchors.length ?? 0
```

Do not rescan Decision / Control-Flow / Expression / Mutation evidence per node.

- [ ] **Step 4: Resolve current frame from the authoritative raw cursor**

Use existing:

```ts
frameCursorContextAt(callFrames, events, currentRawIndex)
```

Current path:

```text
ancestors + currentFrameId
```

If current raw event has no corresponding Call-Frame occurrence:

```text
currentFrameId = undefined
currentPath = []
```

Do not fall back to event.function.

- [ ] **Step 5: Implement cursor-relative frame temporal status**

Use the **raw step value**, not array index.

Conceptually:

```ts
function statusAtStep(
  frame: FrameOccurrence,
  currentStep: number | undefined
): FrameAtCursorStatus
```

Rules:

1. no current step -> `unknown`;
2. currentStep < frame.callStep -> `not_started`;
3. terminal exit with authoritative `exit.step`:
   - currentStep < exit.step -> `active`;
   - currentStep >= exit.step -> `exited`;
4. `trace_ended` without `step`:
   - if currentStep >= frame.callStep and frame is current/ancestor in the current raw event path -> `active`;
   - otherwise `unknown`;
5. never invent an exit moment from tree position.

Add explicit tests for:

```text
before call
at call
before return
at return
after return
trace_ended without exit step
```

- [ ] **Step 6: Add direct- and mutual-recursion projection tests**

Direct:

```text
f(3)
└─ f(2)
   └─ f(1)
```

Assert existing recursion metadata is copied unchanged.

Mutual:

```text
even
└─ odd
   └─ even
```

Assert `cycleFunctionIds` is preserved as evidence metadata.

Do not recompute recursion in this module.

- [ ] **Step 7: Add same-name lexical-function test**

Use static descriptors:

```text
outer.visit
other.visit
```

with the same runtime `functionName = "visit"`.

Assert the story model keeps distinct qualified labels.

- [ ] **Step 8: Run focused core tests**

```bash
npx vitest run   tests/core/call-frame-story.test.ts   tests/core/call-frame-interpreter.test.ts   tests/core/frame-evidence-index.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add   src/core/call-frame-story.ts   tests/core/call-frame-story.test.ts
git commit -m "feat: project call frames into execution story model"
```

---

# Task 2: Add Compact Frame Formatting Helpers

**Why separate:** Argument labels and exit labels will be reused by Current Frame, Call Path, and Call Tree. Keep value-density logic out of DOM traversal.

**Files:**
- Create: `src/sidepanel/call-frame-format.ts`
- Create: `tests/sidepanel/call-frame-format.test.ts`

**Consumes existing:** `formatValue()`

- [ ] **Step 1: Add failing compact argument tests**

Required behavior:

```text
["self", "n"]            -> n=3
["cls", "value"]         -> value=7
["a", "b", "c"]          -> a=1, b=2, c=3
["a", "b", "c", "d"]     -> a=1, b=2, c=3, …
long container snapshot  -> bounded existing formatted representation
```

Underlying argument array must remain unchanged.

- [ ] **Step 2: Implement display-only self/cls suppression**

Conceptually:

```ts
export function visibleFrameArguments(
  args: BoundArgumentSnapshot[],
  maxVisible = 3
): {
  visible: BoundArgumentSnapshot[];
  hiddenCount: number;
}
```

Suppress `self` and `cls` only from compact presentation.

- [ ] **Step 3: Implement frame signature formatter**

```ts
export function frameSignature(
  node: CallFrameStoryNode,
  options?: { preferShortName?: boolean }
): string;
```

Examples:

```text
Solution.maxDepth(root=TreeNode#...)
maxDepth(root=None)
helper(index=2, target=7)
```

Use existing `formatValue`; do not invoke user code or custom `repr`.

- [ ] **Step 4: Implement exit summary formatter**

```ts
export function frameExitSummary(exit: FrameExit): string
```

Mappings:

```text
returned      -> Returned <value>
exception     -> Raised <type>
trace_ended   -> Trace ended · <reason>
active        -> Active
```

For compact tree suffix:

```ts
export function compactFrameExitSuffix(exit: FrameExit): string
```

Examples:

```text
→ 0
→ None
⚠ ValueError
… trace ended
```

No bug/correctness vocabulary.

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/sidepanel/call-frame-format.test.ts
```

- [ ] **Step 6: Commit Task 2**

```bash
git add   src/sidepanel/call-frame-format.ts   tests/sidepanel/call-frame-format.test.ts
git commit -m "feat: format call frame story labels"
```

---

# Task 3: Render Current Frame and Call Path

**Files:**
- Create: `src/sidepanel/components/CallFrameStory.ts`
- Create: `tests/sidepanel/call-frame-story.test.ts`
- Modify: `src/sidepanel/styles.css`

**Initial scope:** Current Frame + Call Path only. Call Tree lands in Task 4.

## Component contract

Use a persistent handle from the start:

```ts
export interface CallFrameStoryViewModel {
  model: CallFrameStoryModel;
  currentStep?: number;
}

export interface CallFrameStoryOptions {
  model: CallFrameStoryModel;
  onNavigateStep(step: number): void;
}

export interface CallFrameStoryHandle {
  element: HTMLElement;
  update(model: CallFrameStoryModel): void;
  dispose(): void;
}

export function createCallFrameStory(
  options: CallFrameStoryOptions
): CallFrameStoryHandle;
```

- [ ] **Step 1: Add failing DOM test for Current Frame**

Given current frame `Solution.maxDepth(root=20)`:

Assert text includes:

```text
Current frame
maxDepth(root=20)
Frame 5
depth 2
recursive depth 2
At this step: active
```

If the frame later returns 2 but the cursor is before the exit, also assert:

```text
Observed later: returned 2
```

or equivalent factual copy.

- [ ] **Step 2: Render temporal status separately from final outcome**

Required copy rules:

```text
atCursor === active
  -> At this step: active

atCursor === exited
  -> At this step: exited

atCursor === not_started
  -> Not entered at this step

session-final return while atCursor === active
  -> Observed later: returned <value>
```

Do not show a compact final suffix as if it already happened at the current cursor.

- [ ] **Step 3: Render stack depth and recursion depth distinctly**

Non-recursive:

```text
Frame 8 · depth 3
```

Recursive:

```text
Frame 8 · depth 5 · recursive depth 3
```

Only show recursive depth badge when `recursion.isRecursive === true`.

- [ ] **Step 4: Render Call Path**

For current path:

```text
frame 1 -> frame 4 -> frame 7 -> frame 9
```

render clickable function signatures in root-to-current order.

Each segment click:

```text
node.callStep -> onNavigateStep(callStep)
```

Current segment gets:

```text
aria-current="step"
data-current-frame="true"
```

- [ ] **Step 5: Add deep-path compaction**

For paths over a small presentation threshold, e.g. 7:

Show:

```text
root → second → … 4 frames … → parent → current
```

Hidden frames remain in the model.

The ellipsis is non-navigable unless a future expansion control is added.

Add tests that beginning/end order remains factual.

- [ ] **Step 6: Add tracing-state banner**

When `model.tracingState.status !== "complete"`:

```text
Call-frame tracing truncated · call_frame_event_limit
Call-frame tracing unavailable · <reason>
```

Captured Current Frame / Call Path remain visible below the banner.

- [ ] **Step 7: Add semantic DOM attributes**

Current frame container:

```text
data-frame-id
data-function-id
data-frame-depth
data-recursion-depth
data-frame-exit-status
data-call-step
data-current-frame
```

Path buttons include:

```text
data-frame-id
data-call-step
```

- [ ] **Step 8: Add focused CSS**

Use current panel typography/spacing.

Do not introduce a new global palette.

- [ ] **Step 9: Run DOM tests**

```bash
npx vitest run tests/sidepanel/call-frame-story.test.ts
```

- [ ] **Step 10: Commit Task 3**

```bash
git add   src/sidepanel/components/CallFrameStory.ts   tests/sidepanel/call-frame-story.test.ts   src/sidepanel/styles.css
git commit -m "feat: render current frame and call path"
```

---

# Task 4: Render the Runtime Call Tree With Persistent Expansion State

**Files:**
- Modify: `src/sidepanel/components/CallFrameStory.ts`
- Modify: `tests/sidepanel/call-frame-story.test.ts`
- Modify: `src/sidepanel/styles.css`

**Critical requirement:** Expansion state must survive raw-step navigation. Do not render a brand-new stateless tree on every step.

- [ ] **Step 1: Add failing tree-structure tests**

Fixture:

```text
solve frame 1
├─ helper frame 2
│  └─ helper frame 3
└─ helper frame 4
```

Assert nested DOM preserves runtime child order:

```ts
expect(frameRows()).toEqual([1, 2, 3, 4]);
```

Do not sort by label or frame ID unless that matches the authoritative child list.

- [ ] **Step 2: Render one concrete row per FrameOccurrence**

Each row should contain:

```text
function(args)
compact final exit suffix
optional recursion badge
expand/collapse button when children exist
```

Examples:

```text
dfs(i=2) → 4
inner() ⚠ ValueError
visit(930) … trace ended
```

Repeated same-function calls remain distinct rows by `frameId`.

- [ ] **Step 3: Implement expansion-state storage**

Inside the persistent handle:

```ts
const userExpanded = new Set<number>();
const userCollapsed = new Set<number>();
```

Rules:

- roots visible;
- current ancestry auto-expanded;
- explicit user collapse/expand preserved across `update()`;
- current ancestry overrides collapse enough to remain visible;
- when a frame stops being current ancestry, prior user preference resumes;
- new session creates a new handle and therefore resets state.

Do not persist frame IDs outside the session.

- [ ] **Step 4: Auto-expand current ancestry**

On every `update(model)`:

```text
for frameId in model.currentPath:
  ensure ancestors render expanded
```

Current frame row:

```text
aria-current="step"
data-current-frame="true"
```

Ancestor rows:

```text
data-current-path="true"
```

Unrelated siblings remain neutral.

- [ ] **Step 5: Frame-row navigation**

Primary row click:

```text
frame.callStep
```

If `exit.step` exists, render a compact secondary exit affordance:

```text
Return / exception suffix click -> exit.step
```

Use `stopPropagation()` so exit navigation does not also navigate to call entry.

If no authoritative exit step exists, render the suffix non-navigable.

- [ ] **Step 6: Preserve factual current-step semantics**

Whole-run tree rows may show final suffixes for scanability.

But the Current Frame section from Task 3 remains the authoritative temporal explanation and must continue to say:

```text
At this step: active
Observed later: returned 4
```

Add a regression where tree row displays `→ 4` while Current Frame still says `active` at an earlier raw step.

- [ ] **Step 7: Render recursion badges only from existing metadata**

For:

```ts
node.recursion.isRecursive === true
```

show:

```text
recursive · depth N
```

For first invocation with recursionDepth 1 / isRecursive false: no recursion badge.

For mutual recursion, optional expanded detail:

```text
cycle: even → odd → even
```

Resolve cycle IDs through `FunctionPlan` descriptor names when available.

- [ ] **Step 8: Render evidence-count detail only when useful**

For selected/current or expanded detail rows, allow:

```text
2 decisions · 1 loop · 3 expressions · 4 mutations
```

Do not clutter every collapsed row.

Tests should assert counts derive from the projection model, not raw DOM scanning.

- [ ] **Step 9: Use semantic nested lists**

Prefer:

```html
<ul>
  <li>...</li>
</ul>
```

over incomplete `role="tree"` semantics.

Expand buttons require:

```text
aria-expanded
aria-label
```

- [ ] **Step 10: Run tests**

```bash
npx vitest run tests/sidepanel/call-frame-story.test.ts
```

- [ ] **Step 11: Commit Task 4**

```bash
git add   src/sidepanel/components/CallFrameStory.ts   tests/sidepanel/call-frame-story.test.ts   src/sidepanel/styles.css
git commit -m "feat: render navigable runtime call tree"
```

---

# Task 5: Add Bounded Large-Tree Presentation

**Files:**
- Modify: `src/core/call-frame-story.ts`
- Modify: `tests/core/call-frame-story.test.ts`
- Modify: `src/sidepanel/components/CallFrameStory.ts`
- Modify: `tests/sidepanel/call-frame-story.test.ts`

**Goal:** Prevent deep recursion from generating an unbounded fully expanded Side Panel DOM while keeping current ancestry inspectable.

## Presentation constants

Start with:

```ts
export const CALL_TREE_VISIBLE_ROW_LIMIT = 120;
export const CALL_TREE_CONTEXT_SIBLING_LIMIT = 8;
```

Exact constants may be adjusted during implementation, but must be explicit and tested.

- [ ] **Step 1: Add a deep-recursion fixture**

Generate ~300 `FrameOccurrence` nodes in one chain.

Current frame near depth 250.

Assert:

- current path is not lost;
- root and current context remain renderable;
- visible DOM rows remain bounded;
- model itself still contains all recorded frames.

- [ ] **Step 2: Keep evidence model complete**

Do **not** truncate `CallFrameStoryModel.byFrameId` for UI limits.

Presentation bounding belongs in the component/helper layer.

The distinction must remain:

```text
model = all recorded frame evidence
DOM = bounded visible projection
```

- [ ] **Step 3: Implement visible-node budgeting**

Priority:

1. current ancestry;
2. roots;
3. direct siblings around current path;
4. user-expanded nodes;
5. shallow unrelated nodes;
6. remaining nodes folded into summary.

Do not silently omit the current path.

- [ ] **Step 4: Render factual folded summaries**

Examples:

```text
+ 184 additional recorded frames
Show more
```

or subtree-local:

```text
▶ 37 additional child calls
```

This is presentation folding.

Never label:

```text
evidence truncated
missing calls
trace lost
```

unless `CallFrameTracingState` separately says so.

- [ ] **Step 5: Add a Show more path**

The user may expand additional recorded nodes incrementally.

Avoid a single action that dumps thousands of rows.

A simple page increment is sufficient:

```text
+100 visible row budget
```

per action.

- [ ] **Step 6: Verify tracing truncation and UI folding can coexist**

Fixture:

```text
callFrameTracing = truncated
recorded frames = 200
visible rows = bounded
```

UI should show both:

```text
Call-frame tracing truncated · ...
+ N additional recorded frames
```

These are distinct facts.

- [ ] **Step 7: Run focused tests**

```bash
npx vitest run   tests/core/call-frame-story.test.ts   tests/sidepanel/call-frame-story.test.ts
```

- [ ] **Step 8: Commit Task 5**

```bash
git add   src/core/call-frame-story.ts   tests/core/call-frame-story.test.ts   src/sidepanel/components/CallFrameStory.ts   tests/sidepanel/call-frame-story.test.ts
git commit -m "feat: bound large call tree presentation"
```

---

# Task 6: Refactor Execution Story Into a Persistent Composite Handle

**Why required:** The current `TraceVisualizer.setStep()` does:

```ts
storyPanel?.body.replaceChildren(
  createExecutionStory({ model, onNavigateStep })
);
```

on every raw step. That destroys subtree expansion state. The frame-aware Execution Story needs a stable component instance across navigation.

**Files:**
- Modify: `src/sidepanel/components/ExecutionStory.ts`
- Modify: `tests/sidepanel/execution-story.test.ts`
- Modify: `src/sidepanel/components/CallFrameStory.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

## New composite contract

Replace the one-shot HTMLElement return with a handle:

```ts
export interface ExecutionStoryModel {
  callFrame?: CallFrameStoryModel;
  controlFlow?: ControlFlowUiModel;
}

export interface ExecutionStoryOptions {
  model: ExecutionStoryModel;
  onNavigateStep(step: number): void;
}

export interface ExecutionStoryHandle {
  element: HTMLElement;
  update(model: ExecutionStoryModel): void;
  dispose(): void;
}

export function createExecutionStory(
  options: ExecutionStoryOptions
): ExecutionStoryHandle;
```

- [ ] **Step 1: Preserve existing Control-Flow DOM tests**

Update tests to access:

```ts
const handle = createExecutionStory(...);
handle.element
```

Do not weaken existing assertions for:

- iteration story;
- transfer status;
- tracing state;
- history navigation;
- incomplete states.

- [ ] **Step 2: Compose CallFrameStory above the existing Control-Flow story**

Structure:

```text
.execution-story
  .call-frame-story
  .execution-story__control-flow
```

If only call-frame evidence exists:

```text
render frame story
omit empty control-flow section
```

If only control-flow evidence exists:

```text
preserve old behavior
```

If both exist:

```text
frame story first
control-flow "Inside this frame" section second
```

- [ ] **Step 3: Add "Inside this frame" boundary**

When current Control-Flow occurrence exists under a current frame:

```text
Inside this frame
FOR · line 8
Iteration #2
...
```

Do not duplicate Current Frame information in the loop header.

- [ ] **Step 4: Preserve Call Tree expansion on `update()`**

The composite handle must reuse the same `CallFrameStoryHandle`.

Do not replace it with a fresh instance every step.

Control-Flow story rows may be re-rendered because they do not own persistent tree expansion state.

- [ ] **Step 5: Preserve outer `<details>` disclosure state**

`TraceVisualizer` keeps owning the `details.trace-viewer__execution-story-panel`.

Updating the handle must not modify `.open`.

Add a regression:

1. open panel;
2. collapse one call subtree;
3. navigate raw step;
4. assert panel is still open;
5. assert user-collapsed subtree preference remains.

- [ ] **Step 6: Run focused tests**

```bash
npx vitest run   tests/sidepanel/execution-story.test.ts   tests/sidepanel/call-frame-story.test.ts   tests/sidepanel/trace-visualizer.test.ts
```

- [ ] **Step 7: Commit Task 6**

```bash
git add   src/sidepanel/components/ExecutionStory.ts   tests/sidepanel/execution-story.test.ts   src/sidepanel/components/CallFrameStory.ts   src/sidepanel/components/TraceVisualizer.ts   tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: compose frame-aware execution story"
```

---

# Task 7: Integrate Frame-Aware Story With TraceVisualizer Navigation and Visibility

**Files:**
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

## Required product behavior

Execution Story panel exists when **either** Call-Frame or Control-Flow evidence/tracing state exists.

- [ ] **Step 1: Expand panel creation condition**

Current condition is Control-Flow only.

Change conceptually to:

```ts
const hasCallFrameSurface =
  interpretation.callFrames.byFrameId.size > 0 ||
  (session.callFrameTracing && session.callFrameTracing.status !== "complete");

const hasControlFlowSurface =
  !!session.controlFlowPlan ||
  (session.controlFlowBatches?.length ?? 0) > 0 ||
  (session.controlFlowTracing && session.controlFlowTracing.status !== "complete");

const storyPanel = hasCallFrameSurface || hasControlFlowSurface
  ? createPanel("Execution Story", "trace-viewer__execution-story-panel", false)
  : null;
```

- [ ] **Step 2: Build both story models per raw step**

Add:

```ts
const callFrameStoryAt = (rawIndex: number) =>
  buildCallFrameStoryModel({
    callFrames: interpretation.callFrames,
    frameEvidenceIndex: interpretation.frameEvidenceIndex,
    functionPlan: session.functionPlan,
    events: session.events,
    currentRawIndex: rawIndex
  });
```

Existing Control-Flow projection remains:

```ts
storyModelAt(step, frameId)
```

Composite update:

```ts
executionStoryHandle?.update({
  callFrame: callFrameStoryAt(currentIndex),
  controlFlow: controlFlowUiModel
});
```

- [ ] **Step 3: Resolve all Call-Frame navigation through existing step index**

Existing:

```ts
const onNavigateStep = (step: number): void => {
  const index = traceIndex.stepToIndex.get(step);
  if (index !== undefined) navigateDirect(index);
};
```

Reuse exactly this callback.

No frame component receives `setStep(index)` directly.

- [ ] **Step 4: Handle call steps missing from raw trace index conservatively**

If `frame.callStep` has no entry in `stepToIndex`:

- row remains visible;
- navigation control is disabled/non-interactive;
- no nearest-step guessing.

Add a test.

- [ ] **Step 5: Update panel title contextually but compactly**

Recommended:

```text
Execution Story · maxDepth
```

when a current frame exists.

When current loop context is also active, do not create an excessively long title.

Allowed:

```text
Execution Story · maxDepth
```

Keep loop details inside panel body.

Tracing suffix may continue to use existing incomplete-state conventions.

- [ ] **Step 6: Preserve trivial-session compactness**

Exactly one frame, no child calls, no recursion:

- Current Frame summary renders;
- Call Tree block may be omitted/collapsed;
- panel remains useful only if Call-Frame evidence is present;
- no unnecessary multi-row tree.

Multiple frames or any recursion:

- Call Tree visible.

- [ ] **Step 7: Add current-step integration test**

Create a recursive session where a frame's final return is known.

Navigate to an earlier line inside that frame.

Assert:

```text
Current Frame says active
Call Tree row may show final return
```

Then navigate to the exit step and assert Current Frame says exited.

- [ ] **Step 8: Add call-tree navigation tests with sparse raw steps**

Use steps:

```text
10, 20, 40, 80
```

Frame callStep = 40.

Click row and assert:

```text
data-step-index = 2
```

Do not assume `step - 1 === index`.

- [ ] **Step 9: Run integration tests**

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts
```

- [ ] **Step 10: Commit Task 7**

```bash
git add   src/sidepanel/components/TraceVisualizer.ts   tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: navigate call frames through raw trace cursor"
```

---

# Task 8: Validate Representative Recursive and Non-Recursive Product Scenarios

**Files:**
- Create: `tests/sidepanel/call-frame-story-integration.test.ts`
- Modify as needed: `tests/core/call-frame-e2e.test.ts`
- Modify as needed: `tests/sidepanel/trace-visualizer.test.ts`

**Important:** Reuse the completed runtime evidence foundation. Do not add UI-only Python instrumentation.

- [ ] **Step 1: Direct recursion**

Model:

```text
f(3)
└─ f(2)
   └─ f(1)
      └─ f(0) → 0
      → 1
   → 2
→ 3
```

Verify:

- each frame distinct;
- factual current ancestry;
- recursion badges only after repeated identity appears;
- row clicks navigate to each callStep;
- earlier cursor shows active vs later return outcome.

- [ ] **Step 2: Binary-tree max-depth recursion**

Use the existing E2E runtime fixture or equivalent normalized session:

```python
class Solution:
    def maxDepth(self, root):
        if root is None:
            return 0
        return max(self.maxDepth(root.left), self.maxDepth(root.right)) + 1
```

Verify:

- arguments show compact TreeNode / None snapshots;
- current ancestry updates across left/right runtime calls without naming them semantically;
- Decision Evidence and tree visualizer continue to render independently;
- no `DFS`, `left subtree`, or correctness inference added by CallFrameStory.

- [ ] **Step 3: Recursive frame with Control-Flow Story**

Use a recursive helper that contains a `for` loop.

Verify composite panel:

```text
Current frame
Call path
Call Tree
Inside this frame
FOR ...
Iteration ...
```

Loop history remains scoped by frame and does not merge across recursive invocations.

- [ ] **Step 4: Mutual recursion**

```text
even(4)
└─ odd(3)
   └─ even(2)
```

Verify:

- cycle metadata is factual;
- no warning vocabulary;
- current path uses concrete frame IDs.

- [ ] **Step 5: Sequential non-recursive sibling helpers**

```text
solve
├─ helper(1)
└─ helper(2)
```

Verify:

- two separate rows;
- no recursion badge;
- runtime order retained.

- [ ] **Step 6: Exception handled by parent**

Required factual shape:

```text
parent() → 7
└─ child() ⚠ ValueError
```

No `root cause` label.

- [ ] **Step 7: Propagated exception**

```text
solve() ⚠ ValueError
└─ middle() ⚠ ValueError
   └─ inner() ⚠ ValueError
```

Verify each frame's factual exit.

- [ ] **Step 8: Trace limit / hard-timeout prefix**

Verify:

- recorded tree prefix visible;
- incomplete affected frames show trace-ended state;
- tracing/session reason visible;
- no invented return values;
- no `infinite recursion` text.

- [ ] **Step 9: Independent call-frame evidence truncation**

Raw trace continues while Call-Frame channel is truncated.

Verify:

- captured frame tree remains;
- tracing banner shown;
- current raw event without frame occurrence does not fabricate one from `event.function`.

- [ ] **Step 10: Run scenario tests**

```bash
npx vitest run   tests/core/call-frame-e2e.test.ts   tests/sidepanel/call-frame-story-integration.test.ts   tests/sidepanel/trace-visualizer.test.ts
```

- [ ] **Step 11: Commit Task 8**

```bash
git add   tests/sidepanel/call-frame-story-integration.test.ts   tests/core/call-frame-e2e.test.ts   tests/sidepanel/trace-visualizer.test.ts
git commit -m "test: validate call frame execution story scenarios"
```

---

# Task 9: Accessibility, Copy, and Product-Boundary Audit

**Files:**
- Modify as needed:
  - `src/sidepanel/components/CallFrameStory.ts`
  - `src/sidepanel/components/ExecutionStory.ts`
  - `src/sidepanel/styles.css`
  - corresponding tests

- [ ] **Step 1: Verify keyboard-accessible controls**

All interactive elements:

- frame row navigation;
- path navigation;
- subtree expand/collapse;
- Show more;
- exit-step navigation;

must be real buttons.

- [ ] **Step 2: Verify ARIA states**

Required:

```text
aria-current="step" on current frame/path item
aria-expanded on subtree toggles
descriptive aria-label on frame navigation
```

Avoid incomplete `role=tree` keyboard semantics; semantic nested lists are preferred.

- [ ] **Step 3: Verify non-color semantics**

Returned / exception / trace-ended / current path / recursion depth must all have textual labels.

- [ ] **Step 4: Search prohibited diagnostic wording**

Run:

```bash
grep -RniE   "wrong recursive|correct recursive|missing base case|should recurse|should have|root cause|fix this|infinite recursion|bad recursion|unnecessary call|backtrack|prune|dead end|DFS|BFS"   src/sidepanel src/core/call-frame-story.ts tests/sidepanel
```

Review every hit.

Do not blindly reject identifiers copied from user fixtures; reject product copy that introduces inference.

- [ ] **Step 5: Verify Call Stack remains unchanged**

Regression test:

```text
Call Stack still represents current active stack
Call Tree represents all recorded frame occurrences
```

Do not remove or replace existing Call Stack.

- [ ] **Step 6: Verify Failure-First remains unchanged**

Create the same timeout/exception fixture with and without call-frame story inputs.

Failure-First selected raw index must remain identical.

- [ ] **Step 7: Verify Behavioral Timeline has no new generic recursion lane**

Existing timeline kinds must remain unchanged.

- [ ] **Step 8: Commit Task 9**

```bash
git add   src/sidepanel/components/CallFrameStory.ts   src/sidepanel/components/ExecutionStory.ts   src/sidepanel/styles.css   tests/sidepanel
git commit -m "test: harden call frame story boundaries"
```

---

# Task 10: Full Regression, Build Gates, and Completion Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-recursion-call-frame-execution-story-ui-design.md`
- Optional modify: `README.md`
- Optional modify: `README.zh-TW.md`

**README rule:** Only update README after implementation is fully green. Do not advertise Call Tree before the feature is actually complete.

- [ ] **Step 1: Run Python semantic fixtures**

```bash
python3 -m unittest discover -s tests/fixtures/python -p "test_*.py"
```

Expected: PASS.

Call-Frame UI must not require any Python runtime change; this gate proves no accidental regression landed elsewhere.

- [ ] **Step 2: Run full Vitest suite**

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

- [ ] **Step 5: Manual Side Panel smoke cases**

Load unpacked extension and verify at least:

1. simple non-recursive helper call;
2. direct recursion;
3. binary-tree recursion;
4. exception recursion;
5. trace-limit or timeout prefix.

For each verify:

```text
no panel overlap
no horizontal overflow from deep indentation
Call Tree navigation changes raw cursor
Visual State updates with navigation
Execution Story disclosure state remains stable
current ancestry remains visible
Call Stack still works
```

- [ ] **Step 6: Record implementation status in the spec**

Append:

```markdown
# Implementation Status

Implemented:
- frame-aware Execution Story composition;
- Current Frame summary and cursor-relative temporal status;
- factual Call Path;
- runtime Call Tree with persistent expansion state;
- bounded large-tree presentation;
- call/exit navigation through the raw trace cursor;
- recursion / mutual-recursion factual metadata;
- frame evidence-count summaries;
- Control-Flow story composition inside the selected frame context;
- exception, timeout, and tracing-truncation presentation.

Deferred:
- semantic backtracking labels;
- expected-vs-actual recursion comparison;
- recursion-aware Failure-First;
- algorithm classification;
- cross-run call-tree diff.
```

- [ ] **Step 7: Update README only if the implementation is complete**

Recommended concise capability line:

```text
- **Call Tree / recursion execution story:** visualizes concrete user-function invocations, arguments, parent/child call structure, recursion depth, returns, exceptions, and incomplete timeout/trace prefixes while staying synchronized with the raw trace cursor.
```

Do not claim backtracking semantics.

- [ ] **Step 8: Commit completion docs**

```bash
git add   docs/superpowers/specs/2026-09-20-recursion-call-frame-execution-story-ui-design.md   README.md   README.zh-TW.md
git commit -m "docs: record call frame execution story completion"
```

If README was intentionally not modified, omit it from `git add`.

---

# Dependency Order

```text
Task 0  TraceVisualizer call-frame wiring
   ↓
Task 1  pure call-frame story projection
   ↓
Task 2  compact formatters
   ↓
Task 3  Current Frame + Call Path
   ↓
Task 4  Call Tree + persistent expansion
   ↓
Task 5  bounded large-tree presentation
   ↓
Task 6  persistent composite Execution Story
   ↓
Task 7  full TraceVisualizer navigation/visibility integration
   ↓
Task 8  representative runtime/product scenarios
   ↓
Task 9  accessibility + evidence-boundary audit
   ↓
Task 10 full regression + docs
```

Tasks 1 and 2 can be implemented in parallel after Task 0 if desired.

Tasks 3 and 4 should use the Task 1 projection contract rather than reading `CallFrameModel` ad hoc.

Task 6 must land before relying on expansion-state persistence in end-to-end navigation tests.

---

# Planned Commit Sequence

Recommended commits:

```text
fix: expose call frame evidence to trace visualizer
feat: project call frames into execution story model
feat: format call frame story labels
feat: render current frame and call path
feat: render navigable runtime call tree
feat: bound large call tree presentation
feat: compose frame-aware execution story
feat: navigate call frames through raw trace cursor
test: validate call frame execution story scenarios
test: harden call frame story boundaries
docs: record call frame execution story completion
```

Keep runtime/Python changes out of these commits unless a new factual runtime bug is independently discovered and documented as a separate correction.

---

# Definition of Done

The implementation is complete only when all of the following are true:

1. `TraceVisualizer` passes `FunctionPlan`, `CallFrameBatch[]`, and `CallFrameTracingState` into `interpretTrace()`.
2. Sessions without Call-Frame fields remain backward compatible.
3. A pure `call-frame-story` core projection exists and does not contain DOM logic.
4. Story projection resolves current frame only from authoritative raw `frameId`.
5. Static qualified labels are attached only through factual `functionId -> FunctionDescriptor` mapping.
6. Same-name functions in different lexical parents remain distinct.
7. Root order preserves `CallFrameModel.roots`.
8. Child order preserves `FrameOccurrence.childFrameIds`.
9. Evidence counts come from `FrameEvidenceIndex`, not rescanning unrelated layers per node.
10. Cursor-relative frame status distinguishes `not_started`, `active`, and `exited` when authoritative step boundaries allow it.
11. Session-final `FrameOccurrence.exit` is not misrepresented as already having occurred at an earlier raw cursor.
12. Compact argument labels preserve declaration order.
13. `self` / `cls` are only presentation-suppressed, never deleted from evidence.
14. Current Frame summary displays factual function, arguments, stack depth, and exit/tracing context.
15. Recursive depth appears only when factual recursion metadata marks the occurrence recursive.
16. General stack depth and recursive depth remain distinct.
17. Call Path renders factual root-to-current ancestry.
18. Call Path navigation uses frame `callStep` and the existing raw trace cursor.
19. Call Tree renders concrete runtime frame occurrences, not static call expressions.
20. Repeated calls to the same function remain distinct frame rows.
21. Sequential sibling helper calls are not marked recursive.
22. Direct recursion renders factual recursion depth.
23. Mutual recursion may render factual cycle metadata without diagnostic wording.
24. Frame rows show factual returned / exception / trace-ended session outcomes.
25. Current ancestry is visibly marked and auto-expanded.
26. User expansion/collapse state survives raw-step navigation within the same session.
27. New sessions reset frame-local expansion state.
28. Large call trees use bounded visible rendering.
29. UI folding is clearly distinct from Call-Frame evidence truncation.
30. Captured tree prefixes remain visible when `callFrameTracing` is truncated.
31. Missing frame evidence is not synthesized from `TraceEvent.function`.
32. Primary frame-row click navigates to authoritative `callStep`.
33. Exit navigation occurs only when an authoritative `exit.step` exists.
34. Sparse raw step numbering navigates correctly through `traceIndex.stepToIndex`.
35. Existing Control-Flow Execution Story remains functional.
36. Frame story and Control-Flow story render inside one canonical Execution Story panel.
37. Recursive loop histories remain scoped by concrete frame and do not merge across calls.
38. Decision Evidence remains the owner of full condition details.
39. Expression Evidence remains the owner of computation details.
40. What Changed remains the owner of mutation details.
41. Visual State updates naturally when frame navigation changes raw cursor.
42. Existing Call Stack remains unchanged and continues to represent the active stack at the current step.
43. Failure-First selection remains unchanged.
44. Behavioral Timeline gains no generic recursion lane.
45. Recursion depth by itself does not create a behavioral warning.
46. No semantic backtracking labels are inferred.
47. No expected call tree is inferred.
48. No correctness, root-cause, or fix language is introduced.
49. Exception presentation does not automatically designate the deepest/first frame as root cause.
50. Timeout/trace-limit prefixes do not produce an `infinite recursion` diagnosis.
51. Semantic states have text/DOM semantics and do not rely on color alone.
52. Expand/collapse controls are keyboard accessible and expose `aria-expanded`.
53. Current frame exposes `aria-current="step"`.
54. Representative direct-recursion tests pass.
55. Representative binary-tree recursion tests pass.
56. Representative mutual-recursion tests pass.
57. Exception-handled-by-parent tests pass.
58. Propagated-exception tests pass.
59. Trace-limit/hard-timeout prefix tests pass.
60. Call-frame truncation tests pass.
61. Full Python fixture suite passes.
62. Full Vitest suite passes.
63. `npm run typecheck` passes.
64. `npm run build` passes.

---

# Resulting Architecture After This Plan

```text
Python runtime
   ↓
Call-Frame Evidence Foundation
   ↓
CallFrameModel + FrameEvidenceIndex
   ↓
call-frame-story.ts
   ├─ qualified frame labels
   ├─ current frame / path
   ├─ cursor-relative temporal state
   ├─ evidence counts
   └─ deterministic runtime tree
   ↓
CallFrameStory persistent UI
   ├─ Current Frame
   ├─ Call Path
   └─ Call Tree
   ↓
ExecutionStory composite
   ├─ Call-Frame structure
   └─ existing Control-Flow occurrence story
   ↓
TraceVisualizer
   └─ one authoritative raw trace cursor
```

This preserves the project's evidence hierarchy:

```text
Program Run
└─ Frame Occurrence
   ├─ Child Frame Occurrence
   ├─ Loop Occurrence
   │  ├─ Decision
   │  └─ Transfer
   ├─ Expression Evidence
   ├─ Runtime Mutation
   └─ Behavioral Evidence
```

The user-facing product transition is:

```text
before:
raw call stack + hidden historical frame evidence

after:
a navigable visual history of the concrete function calls Python actually executed
```

without turning the extension into a solver or correctness engine.

---

# Recommended Next Major Milestone

After this plan is implemented and stable:

**Cross-Run Behavioral Diff**

The Call-Frame hierarchy gives future run alignment a better structure:

```text
same frame/call prefix
→ first argument divergence
→ first decision divergence
→ first mutation divergence
→ different child call
→ different frame exit
```

Potential comparison modes:

```text
previous code vs current code
Case 1 vs Case 2
pinned baseline vs current run
```

Do not combine Cross-Run Diff into this UI implementation.

# Failure-First Entry Point Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, non-diagnostic `Start Here` entry point that recommends one validated behavioral evidence location near abnormal execution termination without changing the initial raw cursor.

**Architecture:** Introduce a pure `failure-first-selection.ts` projection over existing `BehavioralPattern[]` and `ResolvedBehavioralEvidence`, then render the resulting discriminated `FailureFirstSelection` through a small `FailureFirstEntry` component. `TraceVisualizer` computes the selection once, mounts the card only when non-null, and routes `Inspect` through the existing `navigateDirect → stopPlaying → setStep` path.

**Tech Stack:** TypeScript, DOM APIs, Vitest, existing Side Panel renderer and behavioral evidence contracts.

**Spec:** `docs/superpowers/specs/2026-09-10-failure-first-entry-point-design.md`

## Global Constraints

- `FAILURE_FIRST_TERMINAL_WINDOW_STEPS = 32`.
- Evaluate only `exception`, `trace_limit`, and `timeout`; all other statuses return `null`.
- Selection ranking is exactly: smaller termination distance → larger evidence span → larger `repeatCount` → lexicographically smaller `patternId`.
- No pattern-kind severity priority.
- Recommendation evidence must resolve completely; malformed, stale, duplicate-derived, partial, reordered, or out-of-bounds evidence fails closed.
- `RepeatedTransitionPattern` additionally requires contiguous resolved indexes and `evidenceIndexes.length === periodSteps * repeatCount`.
- Repeated transition lands on the first raw index of the final complete motif; repeated state and no progress land on the final evidence index.
- The `FailureFirstSelection` discriminated union carries only factual UI metadata: `periodSteps` for repeated transition and `revisitCount` for no progress.
- Rendering `Start Here` must not move the raw cursor or keyboard focus.
- `Inspect` must reuse `navigateDirect → stopPlaying → setStep`.
- Do not add confidence, severity, diagnosis, root-cause, correctness, infinite-loop, or local-timeout-to-LeetCode-TLE semantics.
- Do not modify the behavioral analyzer, trace schema, Trace Folding selection policy, Timeline lane semantics, or raw Previous/Next/Play behavior.

---

## File Structure

- Create `src/sidepanel/failure-first-selection.ts` — owns validation, candidate construction, deterministic ranking, landing-index derivation, and the public discriminated selection type.
- Create `tests/sidepanel/failure-first-selection.test.ts` — pure selector contract and defensive-validation tests.
- Create `src/sidepanel/components/FailureFirstEntry.ts` — presentation-only Start Here card; accepts a validated selection and emits a raw-index navigation intent.
- Create `tests/sidepanel/failure-first-entry.test.ts` — component copy, accessibility, and click-contract tests.
- Modify `src/sidepanel/components/TraceVisualizer.ts` — compute selection once, create the component after `navigateDirect` exists, mount it between summary and Code, preserve navigation ownership.
- Modify `tests/sidepanel/trace-visualizer.test.ts` — abnormal/completed rendering, no-auto-jump, autoplay stop, synchronized raw navigation regression tests.
- Modify `src/sidepanel/styles.css` — minimal Start Here card layout following existing `trace-viewer__*` conventions; no semantic meaning by color alone.
- Modify `README.md` and `README.zh-TW.md` — document Failure-First as an inspection-priority projection, not diagnosis.

---

### Task 1: Pure Failure-First Selection Model

**Files:**
- Create: `src/sidepanel/failure-first-selection.ts`
- Create: `tests/sidepanel/failure-first-selection.test.ts`
- Reference: `src/core/behavioral-pattern.ts`
- Reference: `src/sidepanel/behavioral-navigation.ts`
- Reference: `src/shared/execution-types.ts`

**Interfaces:**
- Consumes: `TraceSessionStatus`, `BehavioralPattern`, `ResolvedBehavioralEvidence`.
- Produces:

```ts
export const FAILURE_FIRST_TERMINAL_WINDOW_STEPS = 32;

interface FailureFirstSelectionBase {
  patternId: string;
  inspectIndex: number;
  evidenceStartIndex: number;
  evidenceEndIndex: number;
  distanceFromTermination: number;
  repeatCount: number;
  reason: "nearest_terminal_evidence";
}

export interface RepeatedTransitionFailureFirstSelection
  extends FailureFirstSelectionBase {
  kind: "repeated_transition";
  periodSteps: number;
}

export interface RepeatedStateFailureFirstSelection
  extends FailureFirstSelectionBase {
  kind: "repeated_state";
}

export interface NoProgressFailureFirstSelection
  extends FailureFirstSelectionBase {
  kind: "no_progress";
  revisitCount: number;
}

export type FailureFirstSelection =
  | RepeatedTransitionFailureFirstSelection
  | RepeatedStateFailureFirstSelection
  | NoProgressFailureFirstSelection;

export function selectFailureFirstEvidence(
  status: TraceSessionStatus,
  rawTraceLength: number,
  patterns: readonly BehavioralPattern[],
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>
): FailureFirstSelection | null;
```

- [ ] **Step 1: Write failing status/window/ranking tests**

Create helpers that construct each `BehavioralPattern` kind and exact `ResolvedBehavioralEvidence`, then add tests equivalent to:

```ts
it.each(["running", "completed", "parse_error", "input_error", "internal_error"] as const)(
  "%s does not produce a Failure-First selection",
  (status) => {
    const pattern = repeatedStatePattern({ patternId: "state-a", repeatCount: 3, evidenceSteps: [7, 8, 9] });
    const evidence = resolvedEvidence(pattern, [6, 7, 8]);
    expect(selectFailureFirstEvidence(status, 10, [pattern], new Map([[pattern.patternId, evidence]]))).toBeNull();
  }
);

it.each(["exception", "trace_limit", "timeout"] as const)(
  "%s evaluates eligible candidates",
  (status) => {
    const pattern = repeatedStatePattern({ patternId: "state-a", repeatCount: 3, evidenceSteps: [7, 8, 9] });
    const evidence = resolvedEvidence(pattern, [6, 7, 8]);
    expect(selectFailureFirstEvidence(status, 10, [pattern], new Map([[pattern.patternId, evidence]])))
      .toMatchObject({ patternId: "state-a", inspectIndex: 8, distanceFromTermination: 1 });
  }
);

it("accepts distance 32 and rejects distance 33", () => {
  const near = repeatedStatePattern({ patternId: "near", repeatCount: 3, evidenceSteps: [67] });
  const far = repeatedStatePattern({ patternId: "far", repeatCount: 3, evidenceSteps: [66] });
  expect(selectionFor("timeout", 100, near, [66])).not.toBeNull();
  expect(selectionFor("timeout", 100, far, [65])).toBeNull();
});

it("ranks proximity then span then repeat count then pattern id", () => {
  // Build isolated two-candidate cases for each tie-break dimension so a failure identifies exactly one rule.
});

it("is independent of input pattern order", () => {
  const forward = selectFailureFirstEvidence("timeout", rawLength, candidates, evidenceMap);
  const reverse = selectFailureFirstEvidence("timeout", rawLength, [...candidates].reverse(), evidenceMap);
  expect(reverse).toEqual(forward);
});
```

Use raw indexes directly in assertions. Do not infer indexes with `event.step - 1`.

- [ ] **Step 2: Run selector tests and verify RED**

Run:

```bash
npx vitest run tests/sidepanel/failure-first-selection.test.ts
```

Expected: FAIL because `src/sidepanel/failure-first-selection.ts` and exported selector types/functions do not exist.

- [ ] **Step 3: Implement the public types, status gate, common validation, candidate ranking**

Implement the minimal pure module with these internal rules:

```ts
const ELIGIBLE_STATUSES: ReadonlySet<TraceSessionStatus> = new Set([
  "exception",
  "trace_limit",
  "timeout"
]);

function compareSelections(left: FailureFirstSelection, right: FailureFirstSelection): number {
  const distance = left.distanceFromTermination - right.distanceFromTermination;
  if (distance !== 0) return distance;

  const leftSpan = left.evidenceEndIndex - left.evidenceStartIndex + 1;
  const rightSpan = right.evidenceEndIndex - right.evidenceStartIndex + 1;
  if (leftSpan !== rightSpan) return rightSpan - leftSpan;

  if (left.repeatCount !== right.repeatCount) return right.repeatCount - left.repeatCount;
  return left.patternId.localeCompare(right.patternId);
}
```

Common validation must explicitly reject invalid raw length, repeat count `< 3`, missing/mismatched evidence, duplicate original evidence step identities, length mismatches, reordered identity arrays, non-integer indexes/endpoints, non-strictly-increasing indexes, out-of-bounds indexes, endpoint mismatch, and distance outside `0..32`.

Construct all valid candidates first, then sort with `compareSelections` and return the first or `null`. Never select by object iteration order.

- [ ] **Step 4: Run status/window/ranking tests and verify GREEN**

Run:

```bash
npx vitest run tests/sidepanel/failure-first-selection.test.ts
```

Expected: current tests PASS.

- [ ] **Step 5: Add failing defensive evidence tests**

Add explicit tests for:

```ts
it("rejects partial resolution", () => { /* evidenceSteps/evidenceIndexes shorter than pattern.evidenceSteps */ });
it("rejects duplicate pattern evidence step identities", () => { /* [7, 7, 8] */ });
it("rejects reordered resolved identities", () => { /* pattern [7,8,9], resolved [7,9,8] */ });
it("rejects malformed endpoints", () => { /* firstIndex/lastIndex disagree with arrays */ });
it("rejects non-integer or out-of-bounds raw indexes", () => { /* fractional, negative, >= rawTraceLength */ });
it("returns null for empty trace or no patterns", () => { /* rawTraceLength 0 and [] */ });
```

- [ ] **Step 6: Run defensive tests and verify RED where validation is still missing**

Run:

```bash
npx vitest run tests/sidepanel/failure-first-selection.test.ts
```

Expected: newly added malformed-evidence cases FAIL until each fail-closed condition is implemented.

- [ ] **Step 7: Complete common validation and repeated-transition landing validation**

For `repeated_transition`, require exactly:

```ts
Number.isInteger(pattern.periodSteps) && pattern.periodSteps > 0
resolved.evidenceIndexes.length === pattern.periodSteps * pattern.repeatCount
resolved.evidenceIndexes.every((index, offset) => index === resolved.firstIndex! + offset)
```

Then compute:

```ts
const inspectIndex = resolved.lastIndex - pattern.periodSteps + 1;
const lastChunkStart = resolved.evidenceIndexes.length - pattern.periodSteps;
if (resolved.evidenceIndexes[lastChunkStart] !== inspectIndex) return null;
```

For `repeated_state`, use `inspectIndex = resolved.lastIndex`.

For `no_progress`, use `inspectIndex = resolved.lastIndex` and copy `pattern.revisitCount` into the selection.

Copy `pattern.periodSteps` into repeated-transition selections. Do not return the original pattern object.

- [ ] **Step 8: Add and pass landing/metadata tests for all pattern kinds**

Add assertions equivalent to:

```ts
expect(transitionSelection).toEqual(expect.objectContaining({
  kind: "repeated_transition",
  periodSteps: 4,
  inspectIndex: finalEvidenceIndex - 3
}));

expect(stateSelection).toEqual(expect.objectContaining({
  kind: "repeated_state",
  inspectIndex: stateEvidence.lastIndex
}));

expect(noProgressSelection).toEqual(expect.objectContaining({
  kind: "no_progress",
  revisitCount: pattern.revisitCount,
  inspectIndex: noProgressEvidence.lastIndex
}));
```

Also test malformed `periodSteps`, `periodSteps * repeatCount` length mismatch, gapped transition indexes, and an incomplete final motif all return `null`.

Run:

```bash
npx vitest run tests/sidepanel/failure-first-selection.test.ts
```

Expected: PASS.

- [ ] **Step 9: Typecheck the selector contract**

Run:

```bash
npm run typecheck
```

Expected: PASS; pattern-specific fields narrow correctly by `selection.kind`.

- [ ] **Step 10: Commit Task 1**

```bash
git add src/sidepanel/failure-first-selection.ts tests/sidepanel/failure-first-selection.test.ts
git commit -m "feat: select failure-first behavioral evidence"
```

---

### Task 2: Start Here Presentation Component

**Files:**
- Create: `src/sidepanel/components/FailureFirstEntry.ts`
- Create: `tests/sidepanel/failure-first-entry.test.ts`
- Modify: `src/sidepanel/styles.css`
- Reference: `src/sidepanel/components/BehavioralSignals.ts`

**Interfaces:**
- Consumes: `FailureFirstSelection` from Task 1.
- Produces:

```ts
export interface FailureFirstEntryOptions {
  selection: FailureFirstSelection;
  onNavigate(index: number): void;
}

export function createFailureFirstEntry(
  options: FailureFirstEntryOptions
): HTMLDivElement;
```

- [ ] **Step 1: Write failing component tests for copy, accessibility, and navigation intent**

Add tests that construct each discriminated selection directly and assert:

```ts
it("renders repeated-transition factual copy", () => {
  const entry = createFailureFirstEntry({
    selection: transitionSelection({ periodSteps: 4, repeatCount: 12 }),
    onNavigate: vi.fn()
  });
  expect(entry.textContent).toContain("Start Here");
  expect(entry.textContent).toContain("Repeated 4-step behavior × 12");
});

it("renders no-progress revisit count without diagnostic wording", () => {
  const entry = createFailureFirstEntry({ selection: noProgressSelection({ revisitCount: 6 }), onNavigate: vi.fn() });
  expect(entry.textContent).toContain("No observable progress across 6 revisits");
});

it("shows raw evidence range and terminal distance as 1-based display text", () => {
  const entry = createFailureFirstEntry({
    selection: stateSelection({ evidenceStartIndex: 180, evidenceEndIndex: 251, distanceFromTermination: 4 }),
    onNavigate: vi.fn()
  });
  expect(entry.textContent).toContain("within 4 captured steps of execution termination");
  expect(entry.textContent).toContain("Evidence: Steps 181–252");
});

it("does not navigate on render and emits inspectIndex only on click", () => {
  const onNavigate = vi.fn();
  const entry = createFailureFirstEntry({ selection: stateSelection({ inspectIndex: 64 }), onNavigate });
  expect(onNavigate).not.toHaveBeenCalled();
  const button = entry.querySelector("button")!;
  expect(button.type).toBe("button");
  button.click();
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(onNavigate).toHaveBeenCalledWith(64);
});
```

Add a forbidden-copy test that lowercases `textContent` and verifies absence of: `root cause`, `bug location`, `likely cause`, `failure source`, `problem detected`, `suspicious loop`, `infinite loop`, `caused timeout`, `caused failure`, `likely failure`.

- [ ] **Step 2: Run component tests and verify RED**

Run:

```bash
npx vitest run tests/sidepanel/failure-first-entry.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement presentation-only `FailureFirstEntry`**

Use the existing DOM style of `BehavioralSignals.ts`: a small local `createElement` helper is acceptable. Keep title formatting exhaustive on `selection.kind`:

```ts
function title(selection: FailureFirstSelection): string {
  switch (selection.kind) {
    case "repeated_transition":
      return `Repeated ${selection.periodSteps}-step behavior × ${selection.repeatCount}`;
    case "repeated_state":
      return `Repeated observable state × ${selection.repeatCount}`;
    case "no_progress":
      return `No observable progress across ${selection.revisitCount} revisits`;
  }
}
```

Render a root such as:

```text
.trace-viewer__failure-first
  .trace-viewer__failure-first-heading  "Start Here"
  .trace-viewer__failure-first-title
  .trace-viewer__failure-first-detail   "Observed within N captured steps of execution termination."
  .trace-viewer__failure-first-range    "Evidence: Steps A–B"
  button.trace-viewer__failure-first-inspect
```

Set `button.type = "button"`. Give it an accessible label including the 1-based destination, e.g. `Inspect recommended evidence at Step ${inspectIndex + 1}`. Do not focus the button during construction.

- [ ] **Step 4: Add minimal CSS without semantic color dependence**

In `src/sidepanel/styles.css`, add only layout/spacing/border/typography rules needed to distinguish the card. Follow existing `trace-viewer__*` naming and existing design tokens/properties already used in the file. Do not add animation, severity coloring, warning icons, or alert styling.

- [ ] **Step 5: Run component tests and typecheck**

Run:

```bash
npx vitest run tests/sidepanel/failure-first-entry.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/sidepanel/components/FailureFirstEntry.ts tests/sidepanel/failure-first-entry.test.ts src/sidepanel/styles.css
git commit -m "feat: render failure-first start here entry"
```

---

### Task 3: TraceVisualizer Integration and Navigation Preservation

**Files:**
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Reference: `src/sidepanel/failure-first-selection.ts`
- Reference: `src/sidepanel/components/FailureFirstEntry.ts`

**Interfaces:**
- Consumes: `selectFailureFirstEvidence(...)`, `createFailureFirstEntry(...)`.
- Preserves: `navigateDirect(index)`, `stopPlaying()`, `setStep(index)`, raw Previous/Next/Play semantics, `TraceOutlineHandle`, and `BehavioralTimelineHandle` synchronization.
- Produces: conditional Start Here DOM mounted between summary and Code.

- [ ] **Step 1: Add failing integration fixtures for abnormal execution with eligible repeated behavior**

Extend the existing `repeatedTransitionFoldSession()` fixture pattern rather than building an unrelated mock viewer. Add a helper that clones it into abnormal statuses with matching termination reasons:

```ts
function failureFirstSession(
  status: "timeout" | "trace_limit" | "exception"
): TraceSession {
  const base = repeatedTransitionFoldSession();
  return {
    ...base,
    status,
    terminationReason:
      status === "timeout" ? "hard_timeout" :
      status === "trace_limit" ? "step_limit" :
      "runtime_exception",
    ...(status === "exception" ? {
      exception: { type: "RuntimeError", message: "boom", line: 5, stack: [], frameId: 1 }
    } : {})
  };
}
```

Add tests asserting timeout, trace-limit, and exception sessions render exactly one `.trace-viewer__failure-first`, while the same repeated behavior under `completed` renders none.

- [ ] **Step 2: Add failing no-auto-jump and Inspect-navigation tests**

Assert immediately after `createTraceVisualizer(...)`:

```ts
expect(viewer.element.dataset.stepIndex).toBe("0");
expect(viewer.element.querySelector(".trace-viewer__step-label")?.textContent).toContain("Step 1");
```

Then click the Failure-First Inspect button and assert the viewer's `dataset.stepIndex` equals the selector's expected raw landing index, not the first pattern index or final evidence index.

- [ ] **Step 3: Run focused TraceVisualizer tests and verify RED**

Run:

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts
```

Expected: new Start Here assertions FAIL because `TraceVisualizer` does not yet compute or mount Failure-First selection.

- [ ] **Step 4: Compute the selection once during viewer creation**

Add imports for the selector and component. Immediately after `evidenceByPatternId` / `traceFoldModel` construction, compute:

```ts
const failureFirstSelection = selectFailureFirstEvidence(
  session.status,
  session.events.length,
  interpretation.behavioralAnalysis.patterns,
  evidenceByPatternId
);
```

Do not place this inside `setStep()`.

- [ ] **Step 5: Create the component only after `navigateDirect` is initialized**

After:

```ts
navigateDirect = (index: number): void => {
  stopPlaying();
  setStep(index);
};
```

create:

```ts
const failureFirstEntry = failureFirstSelection
  ? createFailureFirstEntry({
      selection: failureFirstSelection,
      onNavigate: navigateDirect
    })
  : null;
```

Keep the component stateless after creation; no `setCurrentIndex` API is needed.

- [ ] **Step 6: Mount Start Here between summary and Code without changing initial cursor order**

Replace the fixed append sequence with an explicit conditional sequence that preserves `setStep(0)` at the end:

```ts
root.append(summary);
if (failureFirstEntry) {
  root.append(failureFirstEntry);
}
root.append(
  codePanel.panel,
  visualPanel.panel,
  inspectorGrid,
  callStackPanel,
  outputPanel.panel,
  debugPanel.panel,
  outlineHandle.element,
  timelineHandle.element,
  controls
);
setStep(0);
```

Do not call `navigateDirect` or `setStep(selection.inspectIndex)` while mounting.

- [ ] **Step 7: Add autoplay-stop regression test for Failure-First Inspect**

Use fake timers consistent with existing autoplay tests. Start Play, confirm `root.dataset.playing === "true"`, click Failure-First Inspect, then assert:

```ts
expect(root.dataset.playing).toBe("false");
expect(play.textContent).toBe("▶ Play");
```

Advance timers after the click and assert the raw cursor does not continue moving.

- [ ] **Step 8: Add synchronization assertions after Failure-First navigation**

Reuse existing TraceVisualizer assertions rather than inventing new state ownership. After Inspect, verify the target raw step updates:

```text
step label
active code line / aria-current
visual state
What Changed
Behavioral Signals active evidence
Locals
Call Stack
Output
Trace Outline active owner
Behavioral Timeline current/raw scrub state
```

The exact assertions should use the existing fixture DOM selectors already used elsewhere in `trace-visualizer.test.ts`.

- [ ] **Step 9: Add out-of-window rendering regression**

Create an abnormal trace where a valid behavioral pattern ends 33 raw indexes before the terminal raw index. Assert `.trace-viewer__failure-first` is absent while existing Behavioral Signals remain present. This confirms Failure-First filtering does not delete analyzer output.

- [ ] **Step 10: Run focused integration tests, selector/component tests, and typecheck**

Run:

```bash
npx vitest run tests/sidepanel/failure-first-selection.test.ts tests/sidepanel/failure-first-entry.test.ts tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit Task 3**

```bash
git add src/sidepanel/components/TraceVisualizer.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: integrate failure-first trace entry"
```

---

### Task 4: Documentation and Full Regression Gates

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`
- Reference: `docs/superpowers/specs/2026-09-10-failure-first-entry-point-design.md`

**Interfaces:**
- Consumes: completed selector/component/integration behavior from Tasks 1–3.
- Produces: user-facing description consistent with product boundaries.

- [ ] **Step 1: Update the English README pipeline and feature description**

Add Failure-First after resolved behavioral evidence / behavioral projections, using factual wording equivalent to:

```text
Failure-First Entry Point — for local exception, trace-limit, or timeout captures, deterministically surfaces one validated behavioral evidence location near termination as an optional Start Here inspection point. It does not move the trace cursor automatically and does not identify a root cause.
```

State explicitly that local timeout is not LeetCode TLE and Start Here is inspection priority, not diagnosis.

- [ ] **Step 2: Update the Traditional Chinese README with the same semantic boundary**

Use equivalent wording, preserving English feature names where the README already does so. Include that only `exception / trace_limit / timeout` are eligible in v0.1 and that `Inspect` is user-triggered.

- [ ] **Step 3: Run targeted forbidden-word review in the new UI source and README copy**

Run:

```bash
grep -RniE "root cause|bug location|likely cause|failure source|problem detected|suspicious loop|infinite loop|caused timeout|caused failure|likely failure" \
  src/sidepanel/components/FailureFirstEntry.ts \
  README.md README.zh-TW.md
```

Expected: no forbidden wording inside the `FailureFirstEntry` UI implementation. README may contain explicit negations such as “does not identify a root cause”; manually confirm every match is a boundary statement, not a diagnostic claim.

- [ ] **Step 4: Run the full repository test suite**

Run:

```bash
npm test
```

Expected: all Vitest files/tests PASS, including existing live sync, visualizers, behavioral navigation, timeline, folding, and new Failure-First tests.

- [ ] **Step 5: Run full typecheck and production build**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both PASS. Existing dependency or Vite/Pyodide warnings may remain, but no new errors or Failure-First-specific warnings are acceptable.

- [ ] **Step 6: Review the final diff against architectural boundaries**

Run:

```bash
git diff --check
git status --short
git diff -- src/core src/shared
```

Expected:

```text
git diff --check → no whitespace errors
src/core / src/shared → no Failure-First analyzer or trace-schema modifications
```

Then inspect the complete diff and verify:

```text
one selector projection only
one optional Start Here card only
no automatic cursor movement
no second navigation owner
no pattern-kind severity ranking
no analyzer/schema changes
no folding/timeline policy changes
```

- [ ] **Step 7: Commit documentation and final milestone state**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: document failure-first trace entry"
```

- [ ] **Step 8: Record final verification evidence before claiming completion**

Capture the exact outputs/summary for:

```bash
npm test
npm run typecheck
npm run build
git status --short
```

Completion claim requires all three gates to succeed and the working tree to contain no unintended changes.

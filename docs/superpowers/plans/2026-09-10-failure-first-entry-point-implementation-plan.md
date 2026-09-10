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

- Create `src/sidepanel/failure-first-selection.ts` — validation, candidate construction, deterministic ranking, landing-index derivation, public discriminated selection type.
- Create `tests/sidepanel/failure-first-selection.test.ts` — pure selector and defensive-validation tests.
- Create `src/sidepanel/components/FailureFirstEntry.ts` — presentation-only Start Here card.
- Create `tests/sidepanel/failure-first-entry.test.ts` — copy, accessibility, and click-contract tests.
- Modify `src/sidepanel/components/TraceVisualizer.ts` — compute selection once and mount it between summary and Code.
- Modify `tests/sidepanel/trace-visualizer.test.ts` — rendering/no-auto-jump/autoplay/synchronization regressions.
- Modify `src/sidepanel/styles.css` — minimal card layout following existing `trace-viewer__*` conventions.
- Modify `README.md` and `README.zh-TW.md` — document Failure-First as inspection priority, not diagnosis.

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

export interface RepeatedTransitionFailureFirstSelection extends FailureFirstSelectionBase {
  kind: "repeated_transition";
  periodSteps: number;
}

export interface RepeatedStateFailureFirstSelection extends FailureFirstSelectionBase {
  kind: "repeated_state";
}

export interface NoProgressFailureFirstSelection extends FailureFirstSelectionBase {
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

- [ ] **Step 1: Write failing status and terminal-window tests**

Create concrete helpers in the test file:

```ts
function repeatedStatePattern(
  patternId: string,
  repeatCount: number,
  evidenceSteps: number[]
): RepeatedStatePattern {
  return {
    kind: "repeated_state",
    patternId,
    startStep: evidenceSteps[0]!,
    endStep: evidenceSteps.at(-1)!,
    repeatCount,
    evidenceSteps,
    location: { frameId: 1, functionName: "solve", line: 3 },
    stateFingerprintKey: patternId
  };
}

function resolvedEvidence(
  patternId: string,
  evidenceSteps: number[],
  evidenceIndexes: number[]
): ResolvedBehavioralEvidence {
  return {
    patternId,
    evidenceSteps,
    evidenceIndexes,
    firstIndex: evidenceIndexes[0] ?? null,
    lastIndex: evidenceIndexes.at(-1) ?? null
  };
}
```

Then write:

```ts
it.each(["running", "completed", "parse_error", "input_error", "internal_error"] as const)(
  "%s returns null",
  (status) => {
    const pattern = repeatedStatePattern("state-a", 3, [7, 8, 9]);
    const evidence = resolvedEvidence("state-a", [7, 8, 9], [6, 7, 8]);
    expect(selectFailureFirstEvidence(status, 10, [pattern], new Map([["state-a", evidence]]))).toBeNull();
  }
);

it.each(["exception", "trace_limit", "timeout"] as const)(
  "%s evaluates eligible candidates",
  (status) => {
    const pattern = repeatedStatePattern("state-a", 3, [7, 8, 9]);
    const evidence = resolvedEvidence("state-a", [7, 8, 9], [6, 7, 8]);
    expect(selectFailureFirstEvidence(status, 10, [pattern], new Map([["state-a", evidence]])))
      .toMatchObject({ patternId: "state-a", inspectIndex: 8, distanceFromTermination: 1 });
  }
);

it("accepts distance 32", () => {
  const pattern = repeatedStatePattern("near", 3, [68]);
  const evidence = resolvedEvidence("near", [68], [67]);
  expect(selectFailureFirstEvidence("timeout", 100, [pattern], new Map([["near", evidence]])))
    .toMatchObject({ distanceFromTermination: 32 });
});

it("rejects distance 33", () => {
  const pattern = repeatedStatePattern("far", 3, [67]);
  const evidence = resolvedEvidence("far", [67], [66]);
  expect(selectFailureFirstEvidence("timeout", 100, [pattern], new Map([["far", evidence]]))).toBeNull();
});
```

- [ ] **Step 2: Run selector tests and verify RED**

```bash
npx vitest run tests/sidepanel/failure-first-selection.test.ts
```

Expected: FAIL because the selector module does not exist.

- [ ] **Step 3: Implement public types, status gate, common validation, and terminal window**

Use:

```ts
const ELIGIBLE_STATUSES: ReadonlySet<TraceSessionStatus> = new Set([
  "exception",
  "trace_limit",
  "timeout"
]);
```

Reject before candidate construction when `rawTraceLength` is not a positive integer or status is ineligible. Per candidate reject: `repeatCount < 3` or non-integer, missing/mismatched evidence, duplicate original evidence step identities, identity/length mismatch, non-integer indexes/endpoints, non-strictly-increasing indexes, out-of-bounds indexes, endpoint mismatch, negative terminal distance, or distance greater than 32.

- [ ] **Step 4: Run status/window tests and verify GREEN**

```bash
npx vitest run tests/sidepanel/failure-first-selection.test.ts
```

Expected: current tests PASS.

- [ ] **Step 5: Add exact deterministic ranking tests**

Add four isolated cases so each tie-break is independently observable:

```ts
it("prefers smaller terminal distance before every other ranking field", () => {
  expect(selectTwo(nearCandidate, farButLongerCandidate)?.patternId).toBe("near");
});

it("prefers larger evidence span when terminal distance ties", () => {
  expect(selectTwo(longSpanCandidate, shortSpanCandidate)?.patternId).toBe("long-span");
});

it("prefers larger repeatCount when distance and span tie", () => {
  expect(selectTwo(highRepeatCandidate, lowRepeatCandidate)?.patternId).toBe("high-repeat");
});

it("prefers lexicographically smaller patternId on a complete tie", () => {
  expect(selectTwo(candidateB, candidateA)?.patternId).toBe("a-pattern");
});
```

Build the fixtures so only the named ranking field differs in each test. Add a permutation test using `[a,b,c]` and `[c,b,a]` and assert equal selections.

- [ ] **Step 6: Implement deterministic comparator and candidate sorting**

```ts
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

Construct all valid candidates, sort with this comparator, return the first or `null`. Never select by map/pattern iteration order.

- [ ] **Step 7: Add exact defensive evidence tests**

Use explicit objects for each malformed condition:

```ts
it("rejects partial resolution", () => {
  const pattern = repeatedStatePattern("p", 3, [7, 8, 9]);
  const evidence = resolvedEvidence("p", [7, 8], [6, 7]);
  expect(selectFailureFirstEvidence("timeout", 10, [pattern], new Map([["p", evidence]]))).toBeNull();
});

it("rejects duplicate pattern evidence step identities", () => {
  const pattern = repeatedStatePattern("p", 3, [7, 7, 8]);
  const evidence = resolvedEvidence("p", [7, 8], [6, 7]);
  expect(selectFailureFirstEvidence("timeout", 10, [pattern], new Map([["p", evidence]]))).toBeNull();
});

it("rejects reordered resolved identities", () => {
  const pattern = repeatedStatePattern("p", 3, [7, 8, 9]);
  const evidence = resolvedEvidence("p", [7, 9, 8], [6, 7, 8]);
  expect(selectFailureFirstEvidence("timeout", 10, [pattern], new Map([["p", evidence]]))).toBeNull();
});

it("rejects malformed endpoints", () => {
  const pattern = repeatedStatePattern("p", 3, [7, 8, 9]);
  const evidence = { ...resolvedEvidence("p", [7, 8, 9], [6, 7, 8]), firstIndex: 5 };
  expect(selectFailureFirstEvidence("timeout", 10, [pattern], new Map([["p", evidence]]))).toBeNull();
});

it.each([[6.5, 7, 8], [-1, 7, 8], [6, 7, 10]])("rejects malformed raw indexes %j", (indexes) => {
  const pattern = repeatedStatePattern("p", 3, [7, 8, 9]);
  const evidence = resolvedEvidence("p", [7, 8, 9], indexes);
  expect(selectFailureFirstEvidence("timeout", 10, [pattern], new Map([["p", evidence]]))).toBeNull();
});

it("returns null for an empty trace or no patterns", () => {
  expect(selectFailureFirstEvidence("timeout", 0, [], new Map())).toBeNull();
  expect(selectFailureFirstEvidence("timeout", 10, [], new Map())).toBeNull();
});
```

- [ ] **Step 8: Add landing tests for every pattern kind**

Add concrete constructors for `RepeatedTransitionPattern` and `NoProgressPattern`, then verify:

```ts
expect(transitionSelection).toEqual(expect.objectContaining({
  kind: "repeated_transition",
  periodSteps: 2,
  repeatCount: 3,
  inspectIndex: 5
}));

expect(stateSelection).toEqual(expect.objectContaining({
  kind: "repeated_state",
  inspectIndex: stateEvidence.lastIndex
}));

expect(noProgressSelection).toEqual(expect.objectContaining({
  kind: "no_progress",
  revisitCount: 4,
  inspectIndex: noProgressEvidence.lastIndex
}));
```

For a transition with indexes `[0,1,2,3,4,5]`, `periodSteps=2`, `repeatCount=3`, assert `inspectIndex === 4` (0-based raw index). Also assert rejection for `periodSteps=0`, length mismatch, gapped indexes `[0,1,3,4,5,6]`, and evidence length not equal to `periodSteps * repeatCount`.

- [ ] **Step 9: Implement repeated-transition strict landing and pattern-specific metadata copying**

Require:

```ts
Number.isInteger(pattern.periodSteps) && pattern.periodSteps > 0
resolved.evidenceIndexes.length === pattern.periodSteps * pattern.repeatCount
resolved.evidenceIndexes.every((index, offset) => index === resolved.firstIndex! + offset)
```

Then:

```ts
const inspectIndex = resolved.lastIndex - pattern.periodSteps + 1;
const lastChunkStart = resolved.evidenceIndexes.length - pattern.periodSteps;
if (resolved.evidenceIndexes[lastChunkStart] !== inspectIndex) return null;
```

For repeated state and no progress, use `inspectIndex = resolved.lastIndex`. Copy `periodSteps` only for transition and `revisitCount` only for no-progress. Do not return the source pattern object.

- [ ] **Step 10: Run selector tests and typecheck**

```bash
npx vitest run tests/sidepanel/failure-first-selection.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

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

export function createFailureFirstEntry(options: FailureFirstEntryOptions): HTMLDivElement;
```

- [ ] **Step 1: Write failing component tests**

Construct each selection kind directly and assert:

```ts
it("renders repeated-transition factual copy", () => {
  const entry = createFailureFirstEntry({ selection: transitionSelection, onNavigate: vi.fn() });
  expect(entry.textContent).toContain("Start Here");
  expect(entry.textContent).toContain("Repeated 4-step behavior × 12");
});

it("renders repeated-state factual copy", () => {
  const entry = createFailureFirstEntry({ selection: stateSelection, onNavigate: vi.fn() });
  expect(entry.textContent).toContain("Repeated observable state × 7");
});

it("renders no-progress factual copy", () => {
  const entry = createFailureFirstEntry({ selection: noProgressSelection, onNavigate: vi.fn() });
  expect(entry.textContent).toContain("No observable progress across 6 revisits");
});

it("renders proximity and 1-based evidence range", () => {
  const entry = createFailureFirstEntry({
    selection: { ...stateSelection, evidenceStartIndex: 180, evidenceEndIndex: 251, distanceFromTermination: 4 },
    onNavigate: vi.fn()
  });
  expect(entry.textContent).toContain("Observed within 4 captured steps of execution termination.");
  expect(entry.textContent).toContain("Evidence: Steps 181–252");
});

it("does not navigate on render and emits only inspectIndex on click", () => {
  const onNavigate = vi.fn();
  const entry = createFailureFirstEntry({ selection: { ...stateSelection, inspectIndex: 64 }, onNavigate });
  expect(onNavigate).not.toHaveBeenCalled();
  const button = entry.querySelector("button")!;
  expect(button.type).toBe("button");
  expect(button.getAttribute("aria-label")).toContain("Step 65");
  button.click();
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(onNavigate).toHaveBeenCalledWith(64);
});
```

Add a test that lowercases all rendered text and asserts absence of every forbidden phrase from the spec.

- [ ] **Step 2: Run component tests and verify RED**

```bash
npx vitest run tests/sidepanel/failure-first-entry.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement presentation-only `FailureFirstEntry`**

Use exhaustive title formatting:

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

Render:

```text
.trace-viewer__failure-first
  .trace-viewer__failure-first-heading  Start Here
  .trace-viewer__failure-first-title
  .trace-viewer__failure-first-detail   Observed within N captured steps of execution termination.
  .trace-viewer__failure-first-range    Evidence: Steps A–B
  button.trace-viewer__failure-first-inspect
```

Set `button.type = "button"` and `aria-label = "Inspect recommended evidence at Step ${inspectIndex + 1}"`. The constructor must not call `focus()` or `onNavigate()`.

- [ ] **Step 4: Add minimal CSS**

Add only spacing, border, typography, and button alignment under `trace-viewer__failure-first*`, using existing properties/tokens already present in `styles.css`. Do not add severity colors, warning icons, animation, or meaning that depends on color.

- [ ] **Step 5: Run component tests and typecheck**

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

**Interfaces:**
- Consumes: `selectFailureFirstEvidence(...)`, `createFailureFirstEntry(...)`.
- Preserves: `navigateDirect(index)`, `stopPlaying()`, `setStep(index)`, raw Previous/Next/Play, Trace Outline and Behavioral Timeline synchronization.
- Produces: optional Start Here DOM mounted between summary and Code.

- [ ] **Step 1: Add failing abnormal/completed rendering tests**

Reuse the existing repeated-transition fixture. Add:

```ts
function failureFirstSession(status: "timeout" | "trace_limit" | "exception"): TraceSession {
  const base = repeatedTransitionFoldSession();
  return {
    ...base,
    status,
    terminationReason:
      status === "timeout" ? "hard_timeout" :
      status === "trace_limit" ? "step_limit" :
      "runtime_exception",
    ...(status === "exception"
      ? { exception: { type: "RuntimeError", message: "boom", line: 5, stack: [], frameId: 1 } }
      : {})
  };
}
```

For each abnormal status, create the viewer and assert exactly one `.trace-viewer__failure-first`. For `repeatedTransitionFoldSession()` unchanged as `completed`, assert none.

- [ ] **Step 2: Add failing no-auto-jump and exact landing tests**

Immediately after viewer creation:

```ts
expect(viewer.element.dataset.stepIndex).toBe("0");
expect(viewer.element.querySelector(".trace-viewer__step-label")?.textContent).toContain("Step 1");
```

For the existing six-event 2-step repeated motif fixture, calculate the expected final motif start from the analyzer output/selector contract and assert clicking Start Here `Inspect` lands on that exact raw index, not on the first pattern index or final evidence index.

- [ ] **Step 3: Run focused integration tests and verify RED**

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts
```

Expected: new Start Here assertions FAIL.

- [ ] **Step 4: Compute Failure-First selection once**

After `evidenceByPatternId` is constructed, add:

```ts
const failureFirstSelection = selectFailureFirstEvidence(
  session.status,
  session.events.length,
  interpretation.behavioralAnalysis.patterns,
  evidenceByPatternId
);
```

Do not compute it in `setStep()`.

- [ ] **Step 5: Create component after `navigateDirect` exists**

Immediately after:

```ts
navigateDirect = (index: number): void => {
  stopPlaying();
  setStep(index);
};
```

add:

```ts
const failureFirstEntry = failureFirstSelection
  ? createFailureFirstEntry({ selection: failureFirstSelection, onNavigate: navigateDirect })
  : null;
```

No `setCurrentIndex` API is needed.

- [ ] **Step 6: Mount Start Here without changing initialization semantics**

Use:

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

Do not call `navigateDirect` or `setStep(failureFirstSelection.inspectIndex)` during construction.

- [ ] **Step 7: Add autoplay-stop regression test**

Use the existing fake-timer pattern in `trace-visualizer.test.ts`: start Play, assert `root.dataset.playing === "true"`, click Failure-First Inspect, assert `root.dataset.playing === "false"` and Play text is `▶ Play`, advance timers, and assert the raw cursor remains at the inspected index.

- [ ] **Step 8: Add synchronized-view assertions after Inspect**

Reuse existing selectors/assertions in this test file to verify the inspected raw step updates all current-owner views:

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

Do not introduce a special Failure-First state field to make these tests pass; synchronization must come from existing `setStep()`.

- [ ] **Step 9: Add out-of-window regression**

Create an abnormal session with at least 40 trailing unique raw events after the last repeated behavior. Assert `.trace-viewer__failure-first` is absent while the existing Behavioral Signals panel still contains the repeated signal. This proves Failure-First filtering does not delete analyzer output.

- [ ] **Step 10: Run focused tests and typecheck**

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

**Interfaces:**
- Consumes: completed behavior from Tasks 1–3.
- Produces: user-facing documentation consistent with product boundaries.

- [ ] **Step 1: Update English README**

Add wording equivalent to:

```text
Failure-First Entry Point — for local exception, trace-limit, or timeout captures, deterministically surfaces one validated behavioral evidence location near termination as an optional Start Here inspection point. It does not move the trace cursor automatically and does not identify a root cause.
```

State explicitly that local timeout is not LeetCode TLE and Start Here is inspection priority, not diagnosis.

- [ ] **Step 2: Update Traditional Chinese README**

Document the same contract: only `exception / trace_limit / timeout` are eligible in v0.1, `Inspect` is user-triggered, and the recommendation does not claim cause/correctness/TLE.

- [ ] **Step 3: Review forbidden diagnostic phrases**

```bash
grep -RniE "root cause|bug location|likely cause|failure source|problem detected|suspicious loop|infinite loop|caused timeout|caused failure|likely failure" \
  src/sidepanel/components/FailureFirstEntry.ts README.md README.zh-TW.md
```

Expected: no forbidden wording in the UI source. README matches are allowed only when explicitly negating a diagnostic claim.

- [ ] **Step 4: Run full repository tests**

```bash
npm test
```

Expected: all test files PASS, including existing live sync, visualizers, behavioral navigation, timeline, folding, and Failure-First tests.

- [ ] **Step 5: Run typecheck and production build**

```bash
npm run typecheck
npm run build
```

Expected: PASS. Existing dependency or Pyodide/Vite warnings may remain; no new Failure-First error/warning is acceptable.

- [ ] **Step 6: Review final architectural diff**

```bash
git diff --check
git status --short
git diff -- src/core src/shared
```

Expected: no whitespace errors; no Failure-First modifications under `src/core` or `src/shared`.

Inspect the complete diff and confirm exactly:

```text
one selector projection
one optional Start Here card
no automatic cursor movement
no second navigation owner
no pattern-kind severity ranking
no analyzer/schema changes
no folding/timeline policy changes
```

- [ ] **Step 7: Commit documentation**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: document failure-first trace entry"
```

- [ ] **Step 8: Record final verification evidence before completion claim**

Run again from the final commit state:

```bash
npm test
npm run typecheck
npm run build
git status --short
```

Completion requires all three gates to succeed and no unintended working-tree changes.

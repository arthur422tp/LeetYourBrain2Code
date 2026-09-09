# Behavioral Trace Folding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic folded trace projection for eligible `RepeatedTransitionPattern` regions, expose it through a navigable `Trace Outline`, and make Behavioral Timeline bands collision-safe without changing raw trace or analyzer semantics.

**Architecture:** Keep behavioral detection and trace capture unchanged. Build a pure `TraceFoldModel` in the Side Panel from raw trace length + `RepeatedTransitionPattern` + already-resolved behavioral evidence, render that model in a persistent `TraceOutline`, and route every outline navigation action through the existing `navigateDirect(index) -> stopPlaying() -> setStep(index)` path. Separately, compute deterministic timeline subtracks so same-kind overlapping bands remain independently visible.

**Tech Stack:** TypeScript 5.8, Vitest 3, jsdom 26, Vite 6, Chrome Manifest V3 Side Panel, existing `trace-viewer__*` CSS system.

**Spec:** `docs/superpowers/specs/2026-09-09-behavioral-trace-folding-design.md`

## Global Constraints

- Only `RepeatedTransitionPattern` is foldable in v0.1.
- Do not modify `src/core/behavioral-pattern.ts`, `src/core/behavioral-analyzer.ts`, `src/core/trace-interpreter.ts`, or `src/shared/trace-types.ts` for folding.
- A fold is presentation-only. Raw `TraceEvent[]` remains authoritative and unchanged.
- A pattern may fold only when every original evidence step resolves exactly once and the resolved raw indexes form one complete contiguous interval.
- Fold evidence length must equal `periodSteps * repeatCount`.
- Fold model segments must partition every raw index exactly once with no overlap or omission.
- Overlapping eligible fold candidates must resolve to a deterministic non-overlapping set maximizing total folded raw-index coverage.
- Raw `Previous`, `Next`, and `Play` remain one-raw-step controls.
- `TraceVisualizer.setStep(index)` remains the only raw trace state-transition owner.
- All direct outline navigation must use the existing direct-navigation path that stops autoplay before calling `setStep(index)`.
- Expanding/collapsing a fold is presentation state only and must not navigate or stop autoplay.
- Behavioral Signals keep exact evidence-membership active semantics.
- Behavioral Timeline keeps exact evidence-membership active semantics.
- Timeline collision stacking must not drop patterns or alter their evidence semantics.
- Same-kind timeline bands must use deterministic subtracks based on resolved `[firstIndex, lastIndex]` intervals.
- UI wording must not claim infinite loop, LeetCode TLE, correctness failure, root cause, causal bug location, or a fix.
- Preserve live sync, active-tab ownership, latest-wins execution, Pyodide worker execution, List/Dict/Linked List visualization, What Changed, Locals, Call Stack, Output, raw Debug details, exception/trace-limit/timeout-prefix behavior, Behavioral Signals, and Behavioral Timeline navigation.
- Do not add folded autoplay, folded Previous/Next, failure-first ranking, Tree, Graph, DP, persistence, backend code, chart libraries, or a generic fold-plugin framework.

## File Map

Create:

```text
src/sidepanel/trace-folding.ts
src/sidepanel/components/TraceOutline.ts

tests/sidepanel/trace-folding.test.ts
tests/sidepanel/trace-outline.test.ts
```

Modify:

```text
src/sidepanel/components/BehavioralTimeline.ts
src/sidepanel/components/TraceVisualizer.ts
src/sidepanel/styles.css

tests/sidepanel/behavioral-timeline.test.ts
tests/sidepanel/trace-visualizer.test.ts

README.md
README.zh-TW.md
```

Do not modify:

```text
src/core/behavioral-pattern.ts
src/core/behavioral-analyzer.ts
src/core/behavioral-observation.ts
src/core/trace-interpreter.ts
src/shared/trace-types.ts
```

---

### Task 1: Build the Pure Trace Fold Model

**Files:**
- Create: `src/sidepanel/trace-folding.ts`
- Create: `tests/sidepanel/trace-folding.test.ts`

**Interfaces:**
- Consumes: raw trace length, `BehavioralPattern[]`, and Task-previous existing `ResolvedBehavioralEvidence` values from `src/sidepanel/behavioral-navigation.ts`.
- Produces:

```ts
export interface RawTraceRangeSegment {
  kind: "raw_range";
  segmentId: string;
  startIndex: number;
  endIndex: number;
}

export interface RepeatedTransitionIteration {
  iteration: number;
  startIndex: number;
  endIndex: number;
}

export interface RepeatedTransitionFoldSegment {
  kind: "repeated_transition_fold";
  segmentId: string;
  patternId: string;
  startIndex: number;
  endIndex: number;
  periodSteps: number;
  repeatCount: number;
  iterations: RepeatedTransitionIteration[];
}

export type TracePresentationSegment =
  | RawTraceRangeSegment
  | RepeatedTransitionFoldSegment;

export interface TraceFoldModel {
  segments: TracePresentationSegment[];
  foldedPatternIds: readonly string[];
}

export function buildTraceFoldModel(
  rawTraceLength: number,
  patterns: readonly BehavioralPattern[],
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>
): TraceFoldModel;
```

Internal helper responsibilities:

```ts
interface FoldCandidate {
  patternId: string;
  startIndex: number;
  endIndex: number;
  periodSteps: number;
  repeatCount: number;
  iterations: RepeatedTransitionIteration[];
}

function candidateFromPattern(...): FoldCandidate | null;
function selectNonOverlappingCandidates(candidates: readonly FoldCandidate[]): FoldCandidate[];
function compareCandidateSets(left: readonly FoldCandidate[], right: readonly FoldCandidate[]): number;
```

- [ ] **Step 1: Write failing eligibility and partition tests**

Create `tests/sidepanel/trace-folding.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { BehavioralPattern } from "../../src/core/behavioral-pattern";
import type { ResolvedBehavioralEvidence } from "../../src/sidepanel/behavioral-navigation";
import { buildTraceFoldModel } from "../../src/sidepanel/trace-folding";

function transitionPattern(
  patternId: string,
  evidenceSteps: number[],
  periodSteps: number,
  repeatCount: number
): BehavioralPattern {
  return {
    kind: "repeated_transition",
    patternId,
    startStep: evidenceSteps[0] ?? 0,
    endStep: evidenceSteps.at(-1) ?? 0,
    repeatCount,
    evidenceSteps,
    periodSteps,
    motifKeys: Array.from({ length: periodSteps }, (_, index) => `m${index}`)
  };
}

function evidence(
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

describe("buildTraceFoldModel", () => {
  it("folds only complete contiguous repeated-transition evidence", () => {
    const pattern = transitionPattern("p", [10, 11, 12, 13, 14, 15], 2, 3);
    const model = buildTraceFoldModel(
      10,
      [pattern],
      new Map([["p", evidence("p", [10, 11, 12, 13, 14, 15], [2, 3, 4, 5, 6, 7])]])
    );

    expect(model.segments).toEqual([
      { kind: "raw_range", segmentId: "raw:0:1", startIndex: 0, endIndex: 1 },
      {
        kind: "repeated_transition_fold",
        segmentId: "fold:p",
        patternId: "p",
        startIndex: 2,
        endIndex: 7,
        periodSteps: 2,
        repeatCount: 3,
        iterations: [
          { iteration: 1, startIndex: 2, endIndex: 3 },
          { iteration: 2, startIndex: 4, endIndex: 5 },
          { iteration: 3, startIndex: 6, endIndex: 7 }
        ]
      },
      { kind: "raw_range", segmentId: "raw:8:9", startIndex: 8, endIndex: 9 }
    ]);
    expect(model.foldedPatternIds).toEqual(["p"]);
  });

  it("does not fold repeated-state or no-progress patterns", () => {
    const repeatedState: BehavioralPattern = {
      kind: "repeated_state",
      patternId: "state",
      startStep: 1,
      endStep: 5,
      repeatCount: 3,
      evidenceSteps: [1, 3, 5],
      location: { frameId: 1, functionName: "solve", line: 4 },
      stateFingerprintKey: "x"
    };
    const noProgress: BehavioralPattern = {
      kind: "no_progress",
      patternId: "progress",
      startStep: 1,
      endStep: 3,
      repeatCount: 3,
      revisitCount: 2,
      evidenceSteps: [1, 2, 3],
      location: { frameId: 1, functionName: "solve", line: 4 }
    };

    const model = buildTraceFoldModel(5, [repeatedState, noProgress], new Map());

    expect(model.segments).toEqual([
      { kind: "raw_range", segmentId: "raw:0:4", startIndex: 0, endIndex: 4 }
    ]);
    expect(model.foldedPatternIds).toEqual([]);
  });

  it("rejects partially unresolved or gapped evidence", () => {
    const pattern = transitionPattern("p", [1, 2, 3, 4, 5, 6], 2, 3);
    const unresolved = buildTraceFoldModel(
      8,
      [pattern],
      new Map([["p", evidence("p", [1, 2, 3, 4, 5], [1, 2, 3, 4, 5])]])
    );
    const gapped = buildTraceFoldModel(
      8,
      [pattern],
      new Map([["p", evidence("p", [1, 2, 3, 4, 5, 6], [1, 2, 3, 5, 6, 7])]])
    );

    expect(unresolved.foldedPatternIds).toEqual([]);
    expect(gapped.foldedPatternIds).toEqual([]);
  });

  it("rejects evidence length that does not equal periodSteps times repeatCount", () => {
    const pattern = transitionPattern("p", [1, 2, 3, 4, 5], 2, 3);
    const model = buildTraceFoldModel(
      6,
      [pattern],
      new Map([["p", evidence("p", [1, 2, 3, 4, 5], [1, 2, 3, 4, 5])]])
    );

    expect(model.foldedPatternIds).toEqual([]);
  });

  it("returns one full raw range when no candidate is eligible", () => {
    expect(buildTraceFoldModel(4, [], new Map()).segments).toEqual([
      { kind: "raw_range", segmentId: "raw:0:3", startIndex: 0, endIndex: 3 }
    ]);
  });

  it("returns no segments for an empty trace", () => {
    expect(buildTraceFoldModel(0, [], new Map())).toEqual({
      segments: [],
      foldedPatternIds: []
    });
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

```bash
npx vitest run tests/sidepanel/trace-folding.test.ts
```

Expected: FAIL because `src/sidepanel/trace-folding.ts` does not exist.

- [ ] **Step 3: Implement fold eligibility and exact iteration partitioning**

Create `src/sidepanel/trace-folding.ts` with the public interfaces above and these eligibility rules:

```ts
import type {
  BehavioralPattern,
  RepeatedTransitionPattern
} from "../core/behavioral-pattern";
import type { ResolvedBehavioralEvidence } from "./behavioral-navigation";

function isRepeatedTransition(
  pattern: BehavioralPattern
): pattern is RepeatedTransitionPattern {
  return pattern.kind === "repeated_transition";
}

function isContiguous(indexes: readonly number[]): boolean {
  if (indexes.length === 0) {
    return false;
  }
  const first = indexes[0]!;
  return indexes.every((index, offset) => index === first + offset);
}

function candidateFromPattern(
  rawTraceLength: number,
  pattern: RepeatedTransitionPattern,
  resolved: ResolvedBehavioralEvidence | undefined
): FoldCandidate | null {
  if (!resolved ||
      !Number.isInteger(pattern.periodSteps) || pattern.periodSteps <= 0 ||
      !Number.isInteger(pattern.repeatCount) || pattern.repeatCount < 3 ||
      resolved.firstIndex === null || resolved.lastIndex === null ||
      resolved.evidenceSteps.length !== pattern.evidenceSteps.length ||
      resolved.evidenceIndexes.length !== pattern.evidenceSteps.length ||
      resolved.evidenceIndexes.length !== pattern.periodSteps * pattern.repeatCount ||
      !isContiguous(resolved.evidenceIndexes) ||
      resolved.firstIndex < 0 || resolved.lastIndex >= rawTraceLength) {
    return null;
  }

  const iterations = Array.from({ length: pattern.repeatCount }, (_, zeroBased) => {
    const startIndex = resolved.firstIndex! + zeroBased * pattern.periodSteps;
    return {
      iteration: zeroBased + 1,
      startIndex,
      endIndex: startIndex + pattern.periodSteps - 1
    };
  });

  return {
    patternId: pattern.patternId,
    startIndex: resolved.firstIndex,
    endIndex: resolved.lastIndex,
    periodSteps: pattern.periodSteps,
    repeatCount: pattern.repeatCount,
    iterations
  };
}
```

Also require exact evidence identity preservation, not only equal lengths:

```ts
if (!resolved.evidenceSteps.every((step, index) => step === pattern.evidenceSteps[index])) {
  return null;
}
```

- [ ] **Step 4: Add failing overlap-selection tests**

Append to `tests/sidepanel/trace-folding.test.ts`:

```ts
it("chooses the non-overlapping candidate set with maximum total folded coverage", () => {
  const left = transitionPattern("left", [1, 2, 3, 4, 5, 6], 2, 3);
  const middle = transitionPattern("middle", [3, 4, 5, 6, 7, 8], 2, 3);
  const right = transitionPattern("right", [7, 8, 9, 10, 11, 12], 2, 3);
  const map = new Map<string, ResolvedBehavioralEvidence>([
    ["left", evidence("left", left.evidenceSteps, [0, 1, 2, 3, 4, 5])],
    ["middle", evidence("middle", middle.evidenceSteps, [2, 3, 4, 5, 6, 7])],
    ["right", evidence("right", right.evidenceSteps, [6, 7, 8, 9, 10, 11])]
  ]);

  const model = buildTraceFoldModel(12, [left, middle, right], map);

  expect(model.foldedPatternIds).toEqual(["left", "right"]);
});

it("uses deterministic tie-breaking for equal-coverage fold sets", () => {
  const earlier = transitionPattern("earlier", [1, 2, 3, 4, 5, 6], 2, 3);
  const later = transitionPattern("later", [2, 3, 4, 5, 6, 7], 2, 3);
  const map = new Map<string, ResolvedBehavioralEvidence>([
    ["earlier", evidence("earlier", earlier.evidenceSteps, [0, 1, 2, 3, 4, 5])],
    ["later", evidence("later", later.evidenceSteps, [1, 2, 3, 4, 5, 6])]
  ]);

  expect(buildTraceFoldModel(7, [later, earlier], map).foldedPatternIds)
    .toEqual(["earlier"]);
});

it("partitions every raw index exactly once after fold selection", () => {
  const pattern = transitionPattern("p", [1, 2, 3, 4, 5, 6], 2, 3);
  const model = buildTraceFoldModel(
    10,
    [pattern],
    new Map([["p", evidence("p", pattern.evidenceSteps, [2, 3, 4, 5, 6, 7])]])
  );

  const owned: number[] = [];
  for (const segment of model.segments) {
    for (let index = segment.startIndex; index <= segment.endIndex; index += 1) {
      owned.push(index);
    }
  }

  expect(owned).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(new Set(owned).size).toBe(10);
});
```

- [ ] **Step 5: Run the overlap tests to verify selection is not implemented yet**

```bash
npx vitest run tests/sidepanel/trace-folding.test.ts
```

Expected: FAIL on overlap/tie-break tests.

- [ ] **Step 6: Implement deterministic weighted interval selection and final segment partitioning**

Use an exhaustive bounded dynamic-programming state over candidates sorted by end index. With at most `MAX_PATTERNS_PER_TRACE = 64`, the DP array remains small.

Add:

```ts
function span(candidate: FoldCandidate): number {
  return candidate.endIndex - candidate.startIndex + 1;
}

function compareFoldLists(
  left: readonly FoldCandidate[],
  right: readonly FoldCandidate[]
): number {
  const leftCoverage = left.reduce((sum, item) => sum + span(item), 0);
  const rightCoverage = right.reduce((sum, item) => sum + span(item), 0);
  if (leftCoverage !== rightCoverage) {
    return leftCoverage > rightCoverage ? 1 : -1;
  }
  if (left.length !== right.length) {
    return left.length < right.length ? 1 : -1;
  }

  const normalize = (items: readonly FoldCandidate[]) => [...items].sort((a, b) =>
    a.startIndex - b.startIndex ||
    (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex) ||
    a.periodSteps - b.periodSteps ||
    a.patternId.localeCompare(b.patternId)
  );
  const a = normalize(left);
  const b = normalize(right);
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index]!;
    const y = b[index]!;
    if (x.startIndex !== y.startIndex) {
      return x.startIndex < y.startIndex ? 1 : -1;
    }
    const xSpan = span(x);
    const ySpan = span(y);
    if (xSpan !== ySpan) {
      return xSpan > ySpan ? 1 : -1;
    }
    if (x.periodSteps !== y.periodSteps) {
      return x.periodSteps < y.periodSteps ? 1 : -1;
    }
    const idOrder = x.patternId.localeCompare(y.patternId);
    if (idOrder !== 0) {
      return idOrder < 0 ? 1 : -1;
    }
  }
  return 0;
}
```

Implement `selectNonOverlappingCandidates()` with candidates sorted by:

```ts
endIndex ascending,
startIndex ascending,
patternId ascending
```

For candidate `i`, find the greatest `j < i` with:

```ts
sorted[j].endIndex < sorted[i].startIndex
```

Then choose between:

```text
exclude = best[i - 1]
include = best[previousNonOverlap] + current
```

using `compareFoldLists(include, exclude)`.

Finally sort the selected folds by `startIndex` and partition the full raw trace:

```ts
const segments: TracePresentationSegment[] = [];
let cursor = 0;
for (const fold of selected) {
  if (cursor < fold.startIndex) {
    segments.push({
      kind: "raw_range",
      segmentId: `raw:${cursor}:${fold.startIndex - 1}`,
      startIndex: cursor,
      endIndex: fold.startIndex - 1
    });
  }
  segments.push({
    kind: "repeated_transition_fold",
    segmentId: `fold:${fold.patternId}`,
    ...fold
  });
  cursor = fold.endIndex + 1;
}
if (cursor < rawTraceLength) {
  segments.push({
    kind: "raw_range",
    segmentId: `raw:${cursor}:${rawTraceLength - 1}`,
    startIndex: cursor,
    endIndex: rawTraceLength - 1
  });
}
```

- [ ] **Step 7: Run fold-model tests and typecheck**

```bash
npx vitest run tests/sidepanel/trace-folding.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/trace-folding.ts tests/sidepanel/trace-folding.test.ts
git commit -m "feat: build repeated-transition trace folds"
```

---

### Task 2: Add the Persistent Trace Outline Component

**Files:**
- Create: `src/sidepanel/components/TraceOutline.ts`
- Create: `tests/sidepanel/trace-outline.test.ts`

**Interfaces:**
- Consumes: `TraceFoldModel`, current raw index, and one `onNavigate(index)` callback.
- Produces:

```ts
export interface TraceOutlineOptions {
  model: TraceFoldModel;
  currentIndex: number;
  onNavigate(index: number): void;
}

export interface TraceOutlineHandle {
  element: HTMLDivElement;
  setCurrentIndex(index: number): void;
}

export function createTraceOutline(
  options: TraceOutlineOptions
): TraceOutlineHandle;
```

- Expansion state remains private to the mounted outline:

```ts
const expandedPatternIds = new Set<string>();
```

- `setCurrentIndex()` updates active/current state without rebuilding the entire outline or changing expansion state.

- [ ] **Step 1: Write failing collapsed/expanded outline tests**

Create `tests/sidepanel/trace-outline.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import type { TraceFoldModel } from "../../src/sidepanel/trace-folding";
import { createTraceOutline } from "../../src/sidepanel/components/TraceOutline";

const model: TraceFoldModel = {
  foldedPatternIds: ["p"],
  segments: [
    { kind: "raw_range", segmentId: "raw:0:1", startIndex: 0, endIndex: 1 },
    {
      kind: "repeated_transition_fold",
      segmentId: "fold:p",
      patternId: "p",
      startIndex: 2,
      endIndex: 7,
      periodSteps: 2,
      repeatCount: 3,
      iterations: [
        { iteration: 1, startIndex: 2, endIndex: 3 },
        { iteration: 2, startIndex: 4, endIndex: 5 },
        { iteration: 3, startIndex: 6, endIndex: 7 }
      ]
    },
    { kind: "raw_range", segmentId: "raw:8:9", startIndex: 8, endIndex: 9 }
  ]
};

describe("createTraceOutline", () => {
  it("renders folds collapsed by default with factual summary text", () => {
    const handle = createTraceOutline({ model, currentIndex: 0, onNavigate: vi.fn() });
    const fold = handle.element.querySelector('[data-segment-kind="repeated_transition_fold"]')!;

    expect(fold.textContent).toContain("Repeated 2-step behavior × 3");
    expect(fold.textContent).toContain("Steps 3–8");
    expect(fold.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(0);
    expect(fold.querySelector<HTMLButtonElement>('[data-outline-action="toggle"]')?.getAttribute("aria-expanded"))
      .toBe("false");
  });

  it("expands into exactly one row per motif repetition without navigating", () => {
    const onNavigate = vi.fn();
    const handle = createTraceOutline({ model, currentIndex: 0, onNavigate });
    const toggle = handle.element.querySelector<HTMLButtonElement>('[data-outline-action="toggle"]')!;

    toggle.click();

    expect(onNavigate).not.toHaveBeenCalled();
    expect(handle.element.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(3);
    expect(handle.element.textContent).toContain("Motif repetition 1 · Steps 3–4");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("navigates raw ranges, folds, and repetitions to their first raw index", () => {
    const onNavigate = vi.fn();
    const handle = createTraceOutline({ model, currentIndex: 0, onNavigate });

    handle.element.querySelector<HTMLButtonElement>('[data-segment-id="raw:0:1"] [data-outline-action="inspect"]')!.click();
    handle.element.querySelector<HTMLButtonElement>('[data-segment-id="fold:p"] [data-outline-action="inspect"]')!.click();
    handle.element.querySelector<HTMLButtonElement>('[data-outline-action="toggle"]')!.click();
    handle.element.querySelector<HTMLButtonElement>('[data-iteration="2"] [data-outline-action="inspect"]')!.click();

    expect(onNavigate.mock.calls.map(([index]) => index)).toEqual([0, 2, 4]);
  });

  it("keeps expansion state while current raw index changes", () => {
    const handle = createTraceOutline({ model, currentIndex: 0, onNavigate: vi.fn() });
    handle.element.querySelector<HTMLButtonElement>('[data-outline-action="toggle"]')!.click();

    handle.setCurrentIndex(5);

    expect(handle.element.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(3);
    expect(handle.element.querySelector('[data-segment-id="fold:p"]')?.classList.contains("is-active"))
      .toBe(true);
    expect(handle.element.querySelector('[data-iteration="2"]')?.classList.contains("is-active"))
      .toBe(true);
  });

  it("marks exactly one owning segment current", () => {
    const handle = createTraceOutline({ model, currentIndex: 9, onNavigate: vi.fn() });

    expect(handle.element.querySelectorAll(".trace-viewer__outline-segment.is-active"))
      .toHaveLength(1);
    expect(handle.element.querySelector('[data-segment-id="raw:8:9"]')?.getAttribute("aria-current"))
      .toBe("step");
  });

  it("renders a neutral empty state for an empty trace model", () => {
    const handle = createTraceOutline({
      model: { segments: [], foldedPatternIds: [] },
      currentIndex: 0,
      onNavigate: vi.fn()
    });

    expect(handle.element.textContent).toContain("No execution steps were captured.");
    expect(handle.element.querySelector("button")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the new outline tests to verify they fail**

```bash
npx vitest run tests/sidepanel/trace-outline.test.ts
```

Expected: FAIL because `TraceOutline.ts` does not exist.

- [ ] **Step 3: Implement the outline with persistent DOM nodes and local expansion state**

Create `src/sidepanel/components/TraceOutline.ts` and import:

```ts
import type {
  RepeatedTransitionFoldSegment,
  TraceFoldModel,
  TracePresentationSegment
} from "../trace-folding";
```

Use these formatting helpers:

```ts
function displayRange(startIndex: number, endIndex: number): string {
  return startIndex === endIndex
    ? `Step ${startIndex + 1}`
    : `Steps ${startIndex + 1}–${endIndex + 1}`;
}

function rawCount(startIndex: number, endIndex: number): number {
  return endIndex - startIndex + 1;
}
```

For a raw range, render:

```text
Steps A–B · N raw steps        [Inspect]
```

with:

```ts
row.dataset.segmentId = segment.segmentId;
row.dataset.segmentKind = segment.kind;
```

For a fold, render:

```text
▶ Repeated {periodSteps}-step behavior × {repeatCount}
  Steps A–B · N captured steps              [Inspect first]
```

and separate buttons:

```ts
const toggle = button("▶", "toggle");
toggle.setAttribute("aria-expanded", "false");
const inspect = button("Inspect first", "inspect");
inspect.addEventListener("click", () => options.onNavigate(segment.startIndex));
```

On toggle, update only that fold's iteration container:

```ts
if (expandedPatternIds.has(segment.patternId)) {
  expandedPatternIds.delete(segment.patternId);
  toggle.textContent = "▶";
  toggle.setAttribute("aria-expanded", "false");
  iterations.replaceChildren();
} else {
  expandedPatternIds.add(segment.patternId);
  toggle.textContent = "▼";
  toggle.setAttribute("aria-expanded", "true");
  iterations.replaceChildren(...segment.iterations.map(renderIteration));
  syncCurrentClasses(currentIndex);
}
```

Iteration row text:

```text
Motif repetition {iteration} · Steps A–B        [Inspect]
```

with `data-iteration` equal to the 1-based motif repetition number.

- [ ] **Step 4: Implement `setCurrentIndex()` without rebuilding expansion state**

Maintain references:

```ts
const segmentRows: Array<{ segment: TracePresentationSegment; row: HTMLDivElement }> = [];
const iterationRows = new Map<string, Array<{ startIndex: number; endIndex: number; row: HTMLDivElement }>>();
let currentIndex = options.currentIndex;
```

Implement:

```ts
const syncCurrentClasses = (index: number): void => {
  currentIndex = index;
  for (const { segment, row } of segmentRows) {
    const active = segment.startIndex <= index && index <= segment.endIndex;
    row.classList.toggle("is-active", active);
    if (active) {
      row.setAttribute("aria-current", "step");
    } else {
      row.removeAttribute("aria-current");
    }
  }
  for (const rows of iterationRows.values()) {
    for (const entry of rows) {
      entry.row.classList.toggle(
        "is-active",
        entry.startIndex <= index && index <= entry.endIndex
      );
    }
  }
};
```

Return:

```ts
return {
  element: root,
  setCurrentIndex: syncCurrentClasses
};
```

- [ ] **Step 5: Add accessibility assertions**

Append to `tests/sidepanel/trace-outline.test.ts`:

```ts
it("keeps fold toggle and navigation as distinct native controls", () => {
  const handle = createTraceOutline({ model, currentIndex: 0, onNavigate: vi.fn() });
  const fold = handle.element.querySelector('[data-segment-id="fold:p"]')!;

  const toggle = fold.querySelector<HTMLButtonElement>('[data-outline-action="toggle"]')!;
  const inspect = fold.querySelector<HTMLButtonElement>('[data-outline-action="inspect"]')!;

  expect(toggle.tagName).toBe("BUTTON");
  expect(inspect.tagName).toBe("BUTTON");
  expect(toggle).not.toBe(inspect);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
```

- [ ] **Step 6: Run outline tests and typecheck**

```bash
npx vitest run \
  tests/sidepanel/trace-folding.test.ts \
  tests/sidepanel/trace-outline.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/components/TraceOutline.ts tests/sidepanel/trace-outline.test.ts
git commit -m "feat: add folded trace outline"
```

---

### Task 3: Make Behavioral Timeline Bands Collision-Safe

**Files:**
- Modify: `src/sidepanel/components/BehavioralTimeline.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/behavioral-timeline.test.ts`

**Interfaces:**
- Consumes: the existing valid resolved band intervals `[firstIndex, lastIndex]`.
- Produces an internal deterministic layout:

```ts
interface TimelineBandLayout {
  pattern: BehavioralPattern;
  evidence: ResolvedBehavioralEvidence;
  subtrack: number;
}

interface TimelineLaneLayout {
  kind: BehavioralPattern["kind"];
  subtrackCount: number;
  bands: TimelineBandLayout[];
}
```

Recommended pure helper inside `BehavioralTimeline.ts`:

```ts
function layoutTimelineLane(
  kind: BehavioralPattern["kind"],
  entries: readonly {
    pattern: BehavioralPattern;
    evidence: ResolvedBehavioralEvidence;
  }[]
): TimelineLaneLayout;
```

- [ ] **Step 1: Add failing same-kind collision tests**

Extend `tests/sidepanel/behavioral-timeline.test.ts` with a fixture containing overlapping repeated-state patterns:

```ts
it("stacks overlapping same-kind bands onto different deterministic subtracks", () => {
  const overlapping: BehavioralAnalysis = {
    patterns: [
      {
        kind: "repeated_state",
        patternId: "a",
        startStep: 10,
        endStep: 50,
        repeatCount: 3,
        evidenceSteps: [10, 30, 50],
        location: { frameId: 1, functionName: "solve", line: 5 },
        stateFingerprintKey: "a"
      },
      {
        kind: "repeated_state",
        patternId: "b",
        startStep: 30,
        endStep: 70,
        repeatCount: 3,
        evidenceSteps: [30, 50, 70],
        location: { frameId: 1, functionName: "solve", line: 8 },
        stateFingerprintKey: "b"
      }
    ],
    stepAnnotations: []
  };
  const traceIndex = buildTraceStepIndex([10, 30, 50, 70]);
  const handle = createBehavioralTimeline({
    analysis: overlapping,
    traceIndex,
    evidenceByPatternId: resolveBehavioralEvidenceMap(overlapping.patterns, traceIndex),
    currentIndex: 0,
    onNavigate: vi.fn()
  });

  const bands = [...handle.element.querySelectorAll<HTMLButtonElement>(
    '[data-timeline-kind="repeated_state"] .trace-viewer__timeline-band'
  )];

  expect(bands).toHaveLength(2);
  expect(bands.map((band) => band.dataset.subtrack)).toEqual(["0", "1"]);
  expect(handle.element.querySelector('[data-timeline-kind="repeated_state"]')?.getAttribute("data-subtrack-count"))
    .toBe("2");
});
```

Add reuse behavior:

```ts
it("reuses the lowest available subtrack for non-overlapping same-kind bands", () => {
  const spaced: BehavioralAnalysis = {
    patterns: [
      {
        kind: "repeated_state",
        patternId: "a",
        startStep: 10,
        endStep: 30,
        repeatCount: 2,
        evidenceSteps: [10, 30],
        location: { frameId: 1, functionName: "solve", line: 5 },
        stateFingerprintKey: "a"
      },
      {
        kind: "repeated_state",
        patternId: "b",
        startStep: 50,
        endStep: 70,
        repeatCount: 2,
        evidenceSteps: [50, 70],
        location: { frameId: 1, functionName: "solve", line: 8 },
        stateFingerprintKey: "b"
      }
    ],
    stepAnnotations: []
  };
  const traceIndex = buildTraceStepIndex([10, 30, 50, 70]);
  const handle = createBehavioralTimeline({
    analysis: spaced,
    traceIndex,
    evidenceByPatternId: resolveBehavioralEvidenceMap(spaced.patterns, traceIndex),
    currentIndex: 0,
    onNavigate: vi.fn()
  });

  expect([...handle.element.querySelectorAll<HTMLButtonElement>(".trace-viewer__timeline-band")]
    .map((band) => band.dataset.subtrack)).toEqual(["0", "0"]);
});
```

Add stable DOM order + active semantics:

```ts
it("keeps deterministic DOM order and exact evidence active state after stacking", () => {
  // reuse the overlapping fixture above, but set currentIndex to raw index 1 (step 30)
  // assert pattern-id order is ["a", "b"] and both are active because step 30 is exact evidence for both.
});
```

Use the actual fixture in the test body rather than a comment when implementing.

- [ ] **Step 2: Run the timeline tests to verify current one-track layout fails**

```bash
npx vitest run tests/sidepanel/behavioral-timeline.test.ts
```

Expected: FAIL because bands do not expose subtracks and overlap visually.

- [ ] **Step 3: Implement deterministic subtrack packing**

Inside `BehavioralTimeline.ts`, before DOM rendering, sort entries:

```ts
const sorted = [...entries].sort((left, right) =>
  left.evidence.firstIndex! - right.evidence.firstIndex! ||
  left.evidence.lastIndex! - right.evidence.lastIndex! ||
  left.pattern.patternId.localeCompare(right.pattern.patternId)
);
```

Assign each entry to the first track with:

```ts
trackLastIndex < entry.evidence.firstIndex!
```

Implementation shape:

```ts
const lastIndexByTrack: number[] = [];
const bands = sorted.map((entry) => {
  let subtrack = 0;
  while (
    subtrack < lastIndexByTrack.length &&
    lastIndexByTrack[subtrack]! >= entry.evidence.firstIndex!
  ) {
    subtrack += 1;
  }
  lastIndexByTrack[subtrack] = entry.evidence.lastIndex!;
  return { ...entry, subtrack };
});

return {
  kind,
  subtrackCount: Math.max(lastIndexByTrack.length, 1),
  bands
};
```

Closed intervals overlap when `lastIndex >= next.firstIndex`, so only `<` permits reuse.

- [ ] **Step 4: Render one positioned subtrack row per computed track**

Change each kind lane to contain:

```text
lane label
track stack
  subtrack 0
  subtrack 1
  ...
```

Create:

```ts
const stack = createElement("div", "trace-viewer__timeline-track-stack");
lane.dataset.subtrackCount = String(layout.subtrackCount);

for (let subtrack = 0; subtrack < layout.subtrackCount; subtrack += 1) {
  const track = createElement("div", "trace-viewer__timeline-track trace-viewer__timeline-subtrack");
  track.dataset.subtrack = String(subtrack);
  stack.append(track);
}
```

For each band:

```ts
band.dataset.subtrack = String(entry.subtrack);
trackElements[entry.subtrack]!.append(band);
```

Keep band DOM creation order driven by sorted pattern order. Do not sort by subtrack when creating buttons; instead create all subtrack containers first, then append bands in deterministic sorted order to their target container.

- [ ] **Step 5: Add collision-safe CSS**

Replace the single-track assumption with:

```css
.trace-viewer__timeline-track-stack {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.trace-viewer__timeline-subtrack {
  position: relative;
  height: 18px;
}
```

Keep existing `.trace-viewer__timeline-track` border/background styling on each subtrack. The lane naturally grows vertically with subtrack count.

Do not encode subtrack identity by color.

- [ ] **Step 6: Run timeline tests and typecheck**

```bash
npx vitest run tests/sidepanel/behavioral-timeline.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  src/sidepanel/components/BehavioralTimeline.ts \
  src/sidepanel/styles.css \
  tests/sidepanel/behavioral-timeline.test.ts
git commit -m "fix: stack overlapping behavioral timeline bands"
```

---

### Task 4: Integrate Trace Outline Into the Single Raw Navigation Owner

**Files:**
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

**Interfaces:**
- Consumes:

```ts
buildTraceFoldModel(...)
createTraceOutline(...)
TraceOutlineHandle
```

- Produces one persistent outline instance per trace visualization:

```ts
let outlineHandle: TraceOutlineHandle | null = null;
```

- All outline Inspect actions receive the same existing `navigateDirect` callback already used by Behavioral Signals and Timeline.

- [ ] **Step 1: Add an integration fixture that deterministically creates a repeated-transition fold**

In `tests/sidepanel/trace-visualizer.test.ts`, add a helper based on the existing session fixture:

```ts
function repeatedTransitionFoldSession(): TraceSession {
  const base = session();
  const values = [0, 1, 0, 1, 0, 1];
  const events = values.map((value, index) => ({
    ...base.events[0]!,
    step: index + 1,
    line: index % 2 === 0 ? 5 : 6,
    locals: {
      nums: list([2, 7]),
      left: int(value),
      right: int(1 - value),
      target: int(9),
      total: int(9)
    }
  }));
  return { ...base, events };
}
```

If this fixture does not produce a deterministic `RepeatedTransitionPattern` under the current behavioral analyzer, use the smallest existing finite-changing-loop fixture that does. Do not mock `interpretTrace()` or inject fake behavioral analysis into `TraceVisualizer`; the integration test should exercise the real pipeline.

- [ ] **Step 2: Add failing Trace Outline integration tests**

Add:

```ts
it("mounts a Trace Outline for a non-empty captured trace", () => {
  const view = createTraceVisualizer(repeatedTransitionFoldSession());

  expect(view.element.querySelector(".trace-viewer__outline")).not.toBeNull();
});

it("routes fold Inspect through the same raw setStep path", () => {
  const view = createTraceVisualizer(repeatedTransitionFoldSession());
  const foldInspect = view.element.querySelector<HTMLButtonElement>(
    '[data-segment-kind="repeated_transition_fold"] [data-outline-action="inspect"]'
  )!;

  foldInspect.click();

  const activeSegment = view.element.querySelector(
    '.trace-viewer__outline-segment.is-active[data-segment-kind="repeated_transition_fold"]'
  );
  expect(activeSegment).not.toBeNull();
  expect(view.element.querySelector(".trace-viewer__code-line.is-active")).not.toBeNull();
  expect(view.element.querySelector(".trace-viewer__locals")?.textContent).toContain("left");
});

it("navigates a motif repetition and synchronizes all raw-step surfaces", () => {
  const view = createTraceVisualizer(repeatedTransitionFoldSession());
  const toggle = view.element.querySelector<HTMLButtonElement>(
    '[data-segment-kind="repeated_transition_fold"] [data-outline-action="toggle"]'
  )!;
  toggle.click();
  const repetition = view.element.querySelector<HTMLElement>('[data-iteration="2"]')!;
  repetition.querySelector<HTMLButtonElement>('[data-outline-action="inspect"]')!.click();

  expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
    .toMatch(/^Step \d+ \/ \d+$/);
  expect(view.element.querySelector(".trace-viewer__code-line.is-active")).not.toBeNull();
  expect(view.element.querySelector(".trace-viewer__timeline-current")?.textContent)
    .toMatch(/^Step \d+ \/ \d+$/);
  expect(repetition.classList.contains("is-active")).toBe(true);
});

it("stops autoplay on outline navigation but not on fold expansion", () => {
  vi.useFakeTimers();
  const view = createTraceVisualizer(repeatedTransitionFoldSession());
  const play = view.element.querySelector<HTMLButtonElement>("#trace-play")!;
  play.click();
  expect(view.element.dataset.playing).toBe("true");

  const toggle = view.element.querySelector<HTMLButtonElement>(
    '[data-segment-kind="repeated_transition_fold"] [data-outline-action="toggle"]'
  )!;
  toggle.click();
  expect(view.element.dataset.playing).toBe("true");

  view.element.querySelector<HTMLButtonElement>(
    '[data-segment-kind="repeated_transition_fold"] [data-outline-action="inspect"]'
  )!.click();
  expect(view.element.dataset.playing).toBe("false");
  vi.useRealTimers();
});
```

Also preserve/add explicit raw semantics:

```ts
it("keeps raw Previous and Next one-step navigation when folds exist", () => {
  const view = createTraceVisualizer(repeatedTransitionFoldSession());
  view.setStep(2);
  view.element.querySelector<HTMLButtonElement>("#trace-next")!.click();
  expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
    .toContain("Step 4 /");
  view.element.querySelector<HTMLButtonElement>("#trace-previous")!.click();
  expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
    .toContain("Step 3 /");
});
```

- [ ] **Step 3: Run integration tests to verify the outline is not mounted yet**

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts
```

Expected: FAIL on new outline tests.

- [ ] **Step 4: Build the fold model once in `TraceVisualizer.ts`**

Add imports:

```ts
import { buildTraceFoldModel } from "../trace-folding";
import {
  createTraceOutline,
  type TraceOutlineHandle
} from "./TraceOutline";
```

Immediately after existing `evidenceByPatternId` creation:

```ts
const traceFoldModel = buildTraceFoldModel(
  session.events.length,
  interpretation.behavioralAnalysis.patterns,
  evidenceByPatternId
);
```

Near existing timeline state:

```ts
let outlineHandle: TraceOutlineHandle | null = null;
```

Do not put folding logic inside `setStep()`.

- [ ] **Step 5: Instantiate one outline with the existing direct-navigation callback**

After `navigateDirect` is assigned and before initial `setStep(0)`:

```ts
outlineHandle = createTraceOutline({
  model: traceFoldModel,
  currentIndex,
  onNavigate: navigateDirect
});
```

Inside the non-empty branch of `setStep()` add:

```ts
outlineHandle?.setCurrentIndex(currentIndex);
```

Do not call `stopPlaying()` from the outline component itself; only `navigateDirect` owns that behavior.

- [ ] **Step 6: Place Trace Outline before Behavioral Timeline**

Use this order near the bottom of `TraceVisualizer`:

```text
Summary
Code
Visual State
Inspector grid
Call Stack
Output
Debug details
Trace Outline
Behavioral Timeline
Raw Previous / Next / Play controls
```

The relevant append sequence should become:

```ts
root.append(
  summary,
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
```

Keep all earlier product panels in their existing relative order.

- [ ] **Step 7: Add Trace Outline styles**

In `src/sidepanel/styles.css`, add:

```css
.trace-viewer__outline {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid #dfe5ee;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  padding: 10px 12px 12px;
}

.trace-viewer__outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #334155;
  font-size: 11px;
}

.trace-viewer__outline-segments {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trace-viewer__outline-segment {
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  background: #f8fafc;
  padding: 7px 8px;
}

.trace-viewer__outline-segment.is-active {
  border-color: #7aa7ef;
  box-shadow: inset 3px 0 #1d67ed;
}

.trace-viewer__outline-fold {
  background: #faf9ff;
}

.trace-viewer__outline-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
}

.trace-viewer__outline-title {
  color: #334155;
  font-size: 10px;
  font-weight: 750;
}

.trace-viewer__outline-meta {
  color: #64748b;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 9px;
}

.trace-viewer__outline-actions {
  display: flex;
  gap: 5px;
}

.trace-viewer__outline-actions button,
.trace-viewer__outline-fold-toggle {
  padding: 5px 7px;
  font-size: 9px;
}

.trace-viewer__outline-iterations {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  padding-left: 22px;
}

.trace-viewer__outline-iteration {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid #edf1f6;
  padding-top: 5px;
  color: #64748b;
  font-size: 9px;
}

.trace-viewer__outline-iteration.is-active {
  color: #1d4ed8;
  font-weight: 750;
}
```

Inside the existing mobile media query:

```css
.trace-viewer__outline-row {
  grid-template-columns: auto minmax(0, 1fr);
}

.trace-viewer__outline-actions {
  grid-column: 1 / -1;
  justify-content: flex-end;
}
```

- [ ] **Step 8: Add no-fold and termination-prefix regression cases**

Extend `tests/sidepanel/trace-visualizer.test.ts`:

```ts
it("keeps a raw-only Trace Outline when no fold is eligible", () => {
  const view = createTraceVisualizer(session());
  expect(view.element.querySelectorAll('[data-segment-kind="raw_range"]')).toHaveLength(1);
  expect(view.element.querySelector('[data-segment-kind="repeated_transition_fold"]')).toBeNull();
});

it("does not describe folded timeout-prefix evidence as LeetCode TLE or root cause", () => {
  const timedOut = {
    ...repeatedTransitionFoldSession(),
    status: "timeout",
    terminationReason: "hard_timeout"
  } satisfies TraceSession;
  const text = createTraceVisualizer(timedOut).element.textContent ?? "";

  expect(text).not.toMatch(/LeetCode TLE|root cause|caused the timeout|infinite loop/i);
});
```

If the exact `TraceSession` status/termination reason union uses a different literal already present in existing tests, copy that exact existing literal rather than introducing a new one.

- [ ] **Step 9: Run all Side Panel folding/navigation tests and typecheck**

```bash
npx vitest run \
  tests/sidepanel/trace-folding.test.ts \
  tests/sidepanel/trace-outline.test.ts \
  tests/sidepanel/behavioral-navigation.test.ts \
  tests/sidepanel/behavioral-signals.test.ts \
  tests/sidepanel/behavioral-timeline.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add \
  src/sidepanel/components/TraceVisualizer.ts \
  src/sidepanel/styles.css \
  tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: integrate folded trace outline"
```

---

### Task 5: Synchronize Documentation and Run Full Regression Gates

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`

**Interfaces:**
- Consumes: completed fold model, Trace Outline, and timeline stacking from Tasks 1-4.
- Produces public documentation that advertises only implemented folding behavior.

- [ ] **Step 1: Update the English architecture pipeline**

In `README.md`, change the Side Panel end of the architecture diagram from:

```text
Visual interpretation + Behavioral Evidence Navigation
                ↓
Behavioral Timeline + Chrome Side Panel visualization
```

into:

```text
Visual interpretation + Behavioral Evidence Navigation
                ↓
Repeated-transition Trace Folding
                ↓
Trace Outline + Behavioral Timeline + Chrome Side Panel visualization
```

- [ ] **Step 2: Update the English feature list and boundaries**

Add bullets:

```markdown
- a folded Trace Outline for eligible contiguous `RepeatedTransitionPattern` regions, with collapsed summaries and expandable motif-repetition ranges;
- collision-safe Behavioral Timeline subtracks so overlapping same-kind evidence bands remain independently visible;
- raw Previous / Next / Play navigation remains authoritative even when folded presentation is available;
```

Keep/add boundary wording:

```markdown
- Trace folding is a deterministic presentation projection over captured raw steps. It does not delete raw events or diagnose why execution failed.
```

Append project document links:

```markdown
- [Behavioral Trace Folding Design Spec](docs/superpowers/specs/2026-09-09-behavioral-trace-folding-design.md)
- [Behavioral Trace Folding Implementation Plan](docs/superpowers/plans/2026-09-09-behavioral-trace-folding-implementation-plan.md)
```

Do not advertise folded Previous/Next, failure-first navigation, infinite-loop detection, TLE diagnosis, or Tree/Graph/DP.

- [ ] **Step 3: Update the Traditional Chinese README equivalently**

In `README.zh-TW.md`, update the architecture tail to:

```text
Visual interpretation + Behavioral Evidence Navigation
                    ↓
Repeated-transition Trace Folding
                    ↓
Trace Outline + Behavioral Timeline + Chrome Side Panel 視覺化
```

Add bullets:

```markdown
- 對符合完整、連續 evidence 條件的 `RepeatedTransitionPattern` 提供 folded Trace Outline，可先以摘要檢視，再展開成 motif repetition ranges；
- Behavioral Timeline 支援 collision-safe subtracks，同 kind 的重疊 evidence bands 不再互相遮蓋；
- 即使有 folded presentation，原本的 raw Previous／Next／Play 仍維持 authoritative raw-step navigation；
```

Add boundary wording:

```markdown
- Trace folding 只是 captured raw steps 上的 deterministic presentation projection，不會刪除 raw events，也不會診斷 execution failure 的原因。
```

Append the same spec/plan links.

- [ ] **Step 4: Run focused milestone tests**

```bash
npx vitest run \
  tests/sidepanel/trace-folding.test.ts \
  tests/sidepanel/trace-outline.test.ts \
  tests/sidepanel/behavioral-timeline.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full repository validation**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 6: Run wording regression scans**

```bash
grep -RniE "LeetCode TLE|root cause|caused the timeout|infinite loop detected|go to bug|problem step|fix this" \
  src/sidepanel README.md README.zh-TW.md || true
```

Expected: no new diagnostic or causal claims. Existing boundary text is acceptable only when explicitly negated.

Also verify future-scope terms are not advertised as implemented:

```bash
grep -RniE "folded Previous|folded Next|failure-first|Tree visualization supported|Graph visualization supported|DP visualization supported" \
  README.md README.zh-TW.md || true
```

Expected: no false implementation claims.

- [ ] **Step 7: Commit documentation**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: document behavioral trace folding"
```

---

## Final Verification Checklist

Before declaring the milestone complete, verify all of these against the approved spec:

- [ ] Only `RepeatedTransitionPattern` can fold.
- [ ] Fold eligibility requires complete resolved evidence identity, not merely matching span endpoints.
- [ ] `evidenceIndexes.length === periodSteps * repeatCount` is enforced.
- [ ] Fold evidence must be strictly contiguous in raw-index space.
- [ ] Missing, stale, duplicate-lost, or gapped evidence falls back to raw presentation without hiding steps.
- [ ] Fold iteration boundaries are exact `periodSteps` chunks and are described as motif repetitions, not source-loop iterations.
- [ ] Fold selection maximizes total folded raw-index coverage.
- [ ] Equal-coverage overlap selection uses deterministic tie-breaking from the spec.
- [ ] Final segments partition `0..N-1` exactly once.
- [ ] Adjacent uncovered indexes merge into one `raw_range` segment.
- [ ] Trace Outline starts folds collapsed.
- [ ] Expand/collapse changes only presentation state and does not navigate or stop autoplay.
- [ ] Raw range Inspect, fold Inspect first, and motif repetition Inspect emit raw indexes only.
- [ ] Outline current state marks exactly one owning segment active.
- [ ] Expanded folds mark exactly one owning motif repetition active.
- [ ] Outline expansion state survives `setStep()` changes in the same mounted trace view.
- [ ] A new `TraceVisualizer` resets expansion state.
- [ ] All outline navigation converges through `navigateDirect(index) -> stopPlaying() -> setStep(index)`.
- [ ] Raw Previous / Next / Play remain raw-step controls.
- [ ] Behavioral Signals semantics are unchanged.
- [ ] Behavioral Timeline navigation semantics are unchanged.
- [ ] Same-kind overlapping timeline bands are assigned to deterministic non-overlapping visual subtracks.
- [ ] Non-overlapping timeline bands reuse the lowest available subtrack.
- [ ] Timeline active state remains exact evidence membership.
- [ ] Timeline buttons remain native keyboard-operable controls with existing accessible labels.
- [ ] List / Dict / Linked List / What Changed / Locals / Call Stack / Output remain synchronized after outline jumps.
- [ ] Completed / exception / trace-limit / timeout-prefix traces remain factual and navigable.
- [ ] No analyzer contract or trace schema changes were introduced.
- [ ] No folded autoplay, folded Previous/Next, failure-first ranking, Tree, Graph, DP, persistence, backend, or chart dependency was added.
- [ ] UI copy does not claim infinite loop, LeetCode TLE, correctness failure, root cause, causal bug location, or a fix.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.

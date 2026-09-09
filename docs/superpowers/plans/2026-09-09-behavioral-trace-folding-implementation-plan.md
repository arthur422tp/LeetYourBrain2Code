# Behavioral Trace Folding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic repeated-transition trace folding, a persistent navigable Trace Outline, and collision-safe Behavioral Timeline subtracks without changing raw trace or behavioral analyzer semantics.

**Architecture:** Build one pure Side Panel projection (`TraceFoldModel`) from raw trace length, `BehavioralPattern[]`, and already-resolved behavioral evidence. Render that projection with a persistent `TraceOutline` that emits raw indexes only; `TraceVisualizer` keeps the single `navigateDirect(index) -> stopPlaying() -> setStep(index)` state transition path. Timeline overlap handling is a separate presentation-only interval-packing change.

**Tech Stack:** TypeScript 5.8, Vitest 3, jsdom 26, Vite 6, Chrome Manifest V3 Side Panel, existing `trace-viewer__*` CSS conventions.

**Spec:** `docs/superpowers/specs/2026-09-09-behavioral-trace-folding-design.md`

## Global Constraints

- Fold only `RepeatedTransitionPattern` in v0.1.
- Do not change `src/core/behavioral-pattern.ts`, `src/core/behavioral-analyzer.ts`, `src/core/trace-interpreter.ts`, or trace schemas.
- Raw `TraceEvent[]` remains authoritative and untouched.
- Fold eligibility requires complete evidence identity, contiguous raw indexes, and `evidenceIndexes.length === periodSteps * repeatCount`.
- Fold model segments must partition `0..N-1` exactly once.
- Overlapping candidates must resolve deterministically to a non-overlapping set maximizing total folded raw-index coverage.
- Raw Previous / Next / Play remain one-raw-step controls.
- All direct outline navigation must call the existing `navigateDirect(index)` path.
- Fold expand/collapse must not navigate and must not stop autoplay.
- Behavioral Signals exact-evidence semantics stay unchanged.
- Behavioral Timeline exact-evidence semantics stay unchanged.
- Same-kind timeline bands may move vertically onto subtracks but may not be dropped or semantically reinterpreted.
- No UI copy may claim infinite loop, LeetCode TLE, correctness failure, root cause, causal bug location, or a fix.
- Preserve existing live sync, active-tab ownership, latest-wins scheduling, Pyodide worker execution, List/Dict/Linked List visualization, What Changed, Locals, Call Stack, Output, Debug details, exception/trace-limit/timeout-prefix behavior, Behavioral Signals, Behavioral Timeline, and current trace controls.

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

---

### Task 1: Build the Pure `TraceFoldModel`

**Files:**
- Create: `src/sidepanel/trace-folding.ts`
- Create: `tests/sidepanel/trace-folding.test.ts`

**Interfaces:**

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

- [ ] **Step 1: Write failing eligibility tests**

Create `tests/sidepanel/trace-folding.test.ts` with these helpers and first cases:

```ts
import { describe, expect, it } from "vitest";
import type { BehavioralPattern } from "../../src/core/behavioral-pattern";
import type { ResolvedBehavioralEvidence } from "../../src/sidepanel/behavioral-navigation";
import { buildTraceFoldModel } from "../../src/sidepanel/trace-folding";

function transition(
  id: string,
  evidenceSteps: number[],
  periodSteps: number,
  repeatCount: number
): BehavioralPattern {
  return {
    kind: "repeated_transition",
    patternId: id,
    startStep: evidenceSteps[0] ?? 0,
    endStep: evidenceSteps.at(-1) ?? 0,
    repeatCount,
    evidenceSteps,
    periodSteps,
    motifKeys: Array.from({ length: periodSteps }, (_, i) => `m${i}`)
  };
}

function resolved(
  id: string,
  evidenceSteps: number[],
  evidenceIndexes: number[]
): ResolvedBehavioralEvidence {
  return {
    patternId: id,
    evidenceSteps,
    evidenceIndexes,
    firstIndex: evidenceIndexes[0] ?? null,
    lastIndex: evidenceIndexes.at(-1) ?? null
  };
}

it("folds one complete contiguous repeated-transition interval", () => {
  const pattern = transition("p", [10, 11, 12, 13, 14, 15], 2, 3);
  const model = buildTraceFoldModel(
    10,
    [pattern],
    new Map([["p", resolved("p", pattern.evidenceSteps, [2, 3, 4, 5, 6, 7])]])
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
});

it("rejects gapped or partially resolved evidence", () => {
  const pattern = transition("p", [1, 2, 3, 4, 5, 6], 2, 3);
  const partial = buildTraceFoldModel(
    8,
    [pattern],
    new Map([["p", resolved("p", [1, 2, 3, 4, 5], [1, 2, 3, 4, 5])]])
  );
  const gapped = buildTraceFoldModel(
    8,
    [pattern],
    new Map([["p", resolved("p", pattern.evidenceSteps, [1, 2, 3, 5, 6, 7])]])
  );

  expect(partial.foldedPatternIds).toEqual([]);
  expect(gapped.foldedPatternIds).toEqual([]);
});

it("rejects evidence whose length differs from periodSteps times repeatCount", () => {
  const pattern = transition("p", [1, 2, 3, 4, 5], 2, 3);
  const model = buildTraceFoldModel(
    6,
    [pattern],
    new Map([["p", resolved("p", pattern.evidenceSteps, [1, 2, 3, 4, 5])]])
  );
  expect(model.foldedPatternIds).toEqual([]);
});

it("returns one raw range when no fold is eligible", () => {
  expect(buildTraceFoldModel(4, [], new Map()).segments).toEqual([
    { kind: "raw_range", segmentId: "raw:0:3", startIndex: 0, endIndex: 3 }
  ]);
});

it("returns an empty model for an empty trace", () => {
  expect(buildTraceFoldModel(0, [], new Map())).toEqual({
    segments: [],
    foldedPatternIds: []
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing module failure**

```bash
npx vitest run tests/sidepanel/trace-folding.test.ts
```

Expected: FAIL because `src/sidepanel/trace-folding.ts` does not exist.

- [ ] **Step 3: Implement fold eligibility and iteration partitioning**

Create `src/sidepanel/trace-folding.ts` with:

```ts
import type {
  BehavioralPattern,
  RepeatedTransitionPattern
} from "../core/behavioral-pattern";
import type { ResolvedBehavioralEvidence } from "./behavioral-navigation";

interface FoldCandidate {
  patternId: string;
  startIndex: number;
  endIndex: number;
  periodSteps: number;
  repeatCount: number;
  iterations: RepeatedTransitionIteration[];
}

function contiguous(indexes: readonly number[]): boolean {
  if (indexes.length === 0) return false;
  const first = indexes[0]!;
  return indexes.every((value, offset) => value === first + offset);
}

function candidateFromPattern(
  rawTraceLength: number,
  pattern: RepeatedTransitionPattern,
  evidence: ResolvedBehavioralEvidence | undefined
): FoldCandidate | null {
  if (!evidence) return null;
  if (!Number.isInteger(pattern.periodSteps) || pattern.periodSteps <= 0) return null;
  if (!Number.isInteger(pattern.repeatCount) || pattern.repeatCount < 3) return null;
  if (evidence.firstIndex === null || evidence.lastIndex === null) return null;
  if (evidence.evidenceSteps.length !== pattern.evidenceSteps.length) return null;
  if (!evidence.evidenceSteps.every((step, i) => step === pattern.evidenceSteps[i])) return null;
  if (evidence.evidenceIndexes.length !== pattern.periodSteps * pattern.repeatCount) return null;
  if (!contiguous(evidence.evidenceIndexes)) return null;
  if (evidence.firstIndex < 0 || evidence.lastIndex >= rawTraceLength) return null;

  const iterations = Array.from({ length: pattern.repeatCount }, (_, zeroBased) => {
    const startIndex = evidence.firstIndex! + zeroBased * pattern.periodSteps;
    return {
      iteration: zeroBased + 1,
      startIndex,
      endIndex: startIndex + pattern.periodSteps - 1
    };
  });

  return {
    patternId: pattern.patternId,
    startIndex: evidence.firstIndex,
    endIndex: evidence.lastIndex,
    periodSteps: pattern.periodSteps,
    repeatCount: pattern.repeatCount,
    iterations
  };
}
```

- [ ] **Step 4: Add overlap-selection tests**

Append:

```ts
it("maximizes total folded raw coverage for overlapping candidates", () => {
  const left = transition("left", [1,2,3,4,5,6], 2, 3);
  const middle = transition("middle", [3,4,5,6,7,8], 2, 3);
  const right = transition("right", [7,8,9,10,11,12], 2, 3);
  const map = new Map<string, ResolvedBehavioralEvidence>([
    ["left", resolved("left", left.evidenceSteps, [0,1,2,3,4,5])],
    ["middle", resolved("middle", middle.evidenceSteps, [2,3,4,5,6,7])],
    ["right", resolved("right", right.evidenceSteps, [6,7,8,9,10,11])]
  ]);

  expect(buildTraceFoldModel(12, [left, middle, right], map).foldedPatternIds)
    .toEqual(["left", "right"]);
});

it("uses the earlier-starting candidate for equal-coverage ties", () => {
  const earlier = transition("earlier", [1,2,3,4,5,6], 2, 3);
  const later = transition("later", [2,3,4,5,6,7], 2, 3);
  const map = new Map<string, ResolvedBehavioralEvidence>([
    ["earlier", resolved("earlier", earlier.evidenceSteps, [0,1,2,3,4,5])],
    ["later", resolved("later", later.evidenceSteps, [1,2,3,4,5,6])]
  ]);

  expect(buildTraceFoldModel(7, [later, earlier], map).foldedPatternIds)
    .toEqual(["earlier"]);
});

it("partitions every raw index exactly once", () => {
  const pattern = transition("p", [1,2,3,4,5,6], 2, 3);
  const model = buildTraceFoldModel(
    10,
    [pattern],
    new Map([["p", resolved("p", pattern.evidenceSteps, [2,3,4,5,6,7])]])
  );

  const owned = model.segments.flatMap((segment) =>
    Array.from(
      { length: segment.endIndex - segment.startIndex + 1 },
      (_, offset) => segment.startIndex + offset
    )
  );

  expect(owned).toEqual([0,1,2,3,4,5,6,7,8,9]);
  expect(new Set(owned).size).toBe(10);
});
```

- [ ] **Step 5: Run tests and confirm overlap selection still fails**

```bash
npx vitest run tests/sidepanel/trace-folding.test.ts
```

Expected: FAIL on overlap-selection cases.

- [ ] **Step 6: Implement deterministic weighted interval selection**

Add:

```ts
function candidateSpan(candidate: FoldCandidate): number {
  return candidate.endIndex - candidate.startIndex + 1;
}

function normalizeSet(items: readonly FoldCandidate[]): FoldCandidate[] {
  return [...items].sort((a, b) =>
    a.startIndex - b.startIndex ||
    candidateSpan(b) - candidateSpan(a) ||
    a.periodSteps - b.periodSteps ||
    a.patternId.localeCompare(b.patternId)
  );
}

function compareSets(left: readonly FoldCandidate[], right: readonly FoldCandidate[]): number {
  const leftCoverage = left.reduce((sum, item) => sum + candidateSpan(item), 0);
  const rightCoverage = right.reduce((sum, item) => sum + candidateSpan(item), 0);
  if (leftCoverage !== rightCoverage) return leftCoverage > rightCoverage ? 1 : -1;
  if (left.length !== right.length) return left.length < right.length ? 1 : -1;

  const a = normalizeSet(left);
  const b = normalizeSet(right);
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.startIndex !== y.startIndex) return x.startIndex < y.startIndex ? 1 : -1;
    if (candidateSpan(x) !== candidateSpan(y)) return candidateSpan(x) > candidateSpan(y) ? 1 : -1;
    if (x.periodSteps !== y.periodSteps) return x.periodSteps < y.periodSteps ? 1 : -1;
    const idOrder = x.patternId.localeCompare(y.patternId);
    if (idOrder !== 0) return idOrder < 0 ? 1 : -1;
  }
  return 0;
}

function selectNonOverlappingCandidates(candidates: readonly FoldCandidate[]): FoldCandidate[] {
  const sorted = [...candidates].sort((a, b) =>
    a.endIndex - b.endIndex ||
    a.startIndex - b.startIndex ||
    a.patternId.localeCompare(b.patternId)
  );
  const best: FoldCandidate[][] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    let previous = -1;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (sorted[j]!.endIndex < current.startIndex) {
        previous = j;
        break;
      }
    }
    const include = [...(previous >= 0 ? best[previous]! : []), current];
    const exclude = i > 0 ? best[i - 1]! : [];
    best[i] = compareSets(include, exclude) >= 0 ? include : exclude;
  }

  return normalizeSet(best.at(-1) ?? []);
}
```

Complete `buildTraceFoldModel()` by creating candidates only from `pattern.kind === "repeated_transition"`, selecting them, and emitting raw gaps plus fold segments in ascending raw-index order.

- [ ] **Step 7: Run Task 1 gates**

```bash
npx vitest run tests/sidepanel/trace-folding.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/sidepanel/trace-folding.ts tests/sidepanel/trace-folding.test.ts
git commit -m "feat: build repeated-transition trace folds"
```

---

### Task 2: Add `TraceOutline`

**Files:**
- Create: `src/sidepanel/components/TraceOutline.ts`
- Create: `tests/sidepanel/trace-outline.test.ts`

**Interfaces:**

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

export function createTraceOutline(options: TraceOutlineOptions): TraceOutlineHandle;
```

- [ ] **Step 1: Write failing outline tests**

Create `tests/sidepanel/trace-outline.test.ts` with a fixed model:

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

it("starts folds collapsed", () => {
  const handle = createTraceOutline({ model, currentIndex: 0, onNavigate: vi.fn() });
  const fold = handle.element.querySelector('[data-segment-id="fold:p"]')!;
  expect(fold.textContent).toContain("Repeated 2-step behavior × 3");
  expect(fold.textContent).toContain("Steps 3–8");
  expect(fold.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(0);
  expect(fold.querySelector('[data-outline-action="toggle"]')?.getAttribute("aria-expanded"))
    .toBe("false");
});

it("expands into motif repetitions without navigating", () => {
  const onNavigate = vi.fn();
  const handle = createTraceOutline({ model, currentIndex: 0, onNavigate });
  const toggle = handle.element.querySelector<HTMLButtonElement>('[data-outline-action="toggle"]')!;
  toggle.click();

  expect(onNavigate).not.toHaveBeenCalled();
  expect(handle.element.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(3);
  expect(handle.element.textContent).toContain("Motif repetition 2 · Steps 5–6");
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
});

it("navigates ranges, folds, and repetitions to raw indexes", () => {
  const onNavigate = vi.fn();
  const handle = createTraceOutline({ model, currentIndex: 0, onNavigate });
  handle.element.querySelector<HTMLButtonElement>('[data-segment-id="raw:0:1"] [data-outline-action="inspect"]')!.click();
  handle.element.querySelector<HTMLButtonElement>('[data-segment-id="fold:p"] [data-outline-action="inspect"]')!.click();
  handle.element.querySelector<HTMLButtonElement>('[data-outline-action="toggle"]')!.click();
  handle.element.querySelector<HTMLButtonElement>('[data-iteration="2"] [data-outline-action="inspect"]')!.click();

  expect(onNavigate.mock.calls.map(([index]) => index)).toEqual([0, 2, 4]);
});

it("preserves expansion while currentIndex changes", () => {
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
  expect(handle.element.querySelectorAll(".trace-viewer__outline-segment.is-active")).toHaveLength(1);
  expect(handle.element.querySelector('[data-segment-id="raw:8:9"]')?.getAttribute("aria-current"))
    .toBe("step");
});

it("renders an empty neutral state", () => {
  const handle = createTraceOutline({
    model: { segments: [], foldedPatternIds: [] },
    currentIndex: 0,
    onNavigate: vi.fn()
  });
  expect(handle.element.textContent).toContain("No execution steps were captured.");
  expect(handle.element.querySelector("button")).toBeNull();
});
```

- [ ] **Step 2: Run tests and confirm the missing component failure**

```bash
npx vitest run tests/sidepanel/trace-outline.test.ts
```

Expected: FAIL because `TraceOutline.ts` does not exist.

- [ ] **Step 3: Implement persistent outline DOM and local expansion state**

Use:

```ts
const expandedPatternIds = new Set<string>();
const segmentRows: Array<{ segment: TracePresentationSegment; row: HTMLDivElement }> = [];
const iterationRows = new Map<string, Array<{
  startIndex: number;
  endIndex: number;
  row: HTMLDivElement;
}>>();
let currentIndex = options.currentIndex;
```

Formatting helpers:

```ts
function displayRange(startIndex: number, endIndex: number): string {
  return startIndex === endIndex
    ? `Step ${startIndex + 1}`
    : `Steps ${startIndex + 1}–${endIndex + 1}`;
}
```

Fold title/meta:

```text
Repeated {periodSteps}-step behavior × {repeatCount}
Steps A–B · N captured steps
```

Iteration text:

```text
Motif repetition {iteration} · Steps A–B
```

Toggle rules:

```ts
if (expandedPatternIds.has(segment.patternId)) {
  expandedPatternIds.delete(segment.patternId);
  toggle.textContent = "▶";
  toggle.setAttribute("aria-expanded", "false");
  iterationHost.replaceChildren();
  iterationRows.delete(segment.patternId);
} else {
  expandedPatternIds.add(segment.patternId);
  toggle.textContent = "▼";
  toggle.setAttribute("aria-expanded", "true");
  const rows = segment.iterations.map((iteration) => renderIteration(segment, iteration));
  iterationHost.replaceChildren(...rows.map((entry) => entry.row));
  iterationRows.set(segment.patternId, rows);
  syncCurrentClasses(currentIndex);
}
```

`Inspect` buttons call `options.onNavigate(startIndex)` only.

- [ ] **Step 4: Implement exact current-index ownership updates**

```ts
const syncCurrentClasses = (index: number): void => {
  currentIndex = index;
  for (const { segment, row } of segmentRows) {
    const active = segment.startIndex <= index && index <= segment.endIndex;
    row.classList.toggle("is-active", active);
    active ? row.setAttribute("aria-current", "step") : row.removeAttribute("aria-current");
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

Return the persistent handle:

```ts
syncCurrentClasses(currentIndex);
return { element: root, setCurrentIndex: syncCurrentClasses };
```

- [ ] **Step 5: Run Task 2 gates**

```bash
npx vitest run tests/sidepanel/trace-folding.test.ts tests/sidepanel/trace-outline.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/sidepanel/components/TraceOutline.ts tests/sidepanel/trace-outline.test.ts
git commit -m "feat: add folded trace outline"
```

---

### Task 3: Stack Overlapping Behavioral Timeline Bands

**Files:**
- Modify: `src/sidepanel/components/BehavioralTimeline.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/behavioral-timeline.test.ts`

**Interfaces:**

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

- [ ] **Step 1: Add a concrete overlapping-lane fixture and failing tests**

Append this helper to `tests/sidepanel/behavioral-timeline.test.ts`:

```ts
function overlappingRepeatedStateAnalysis(): BehavioralAnalysis {
  return {
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
}
```

Add:

```ts
it("puts overlapping same-kind bands on separate subtracks", () => {
  const analysis = overlappingRepeatedStateAnalysis();
  const traceIndex = buildTraceStepIndex([10, 30, 50, 70]);
  const handle = createBehavioralTimeline({
    analysis,
    traceIndex,
    evidenceByPatternId: resolveBehavioralEvidenceMap(analysis.patterns, traceIndex),
    currentIndex: 0,
    onNavigate: vi.fn()
  });

  const bands = [...handle.element.querySelectorAll<HTMLButtonElement>(
    '[data-timeline-kind="repeated_state"] .trace-viewer__timeline-band'
  )];
  expect(bands.map((band) => band.dataset.subtrack)).toEqual(["0", "1"]);
  expect(handle.element.querySelector('[data-timeline-kind="repeated_state"]')?.getAttribute("data-subtrack-count"))
    .toBe("2");
});

it("keeps deterministic pattern order and exact evidence active state", () => {
  const analysis = overlappingRepeatedStateAnalysis();
  const traceIndex = buildTraceStepIndex([10, 30, 50, 70]);
  const handle = createBehavioralTimeline({
    analysis,
    traceIndex,
    evidenceByPatternId: resolveBehavioralEvidenceMap(analysis.patterns, traceIndex),
    currentIndex: 1,
    onNavigate: vi.fn()
  });

  const bands = [...handle.element.querySelectorAll<HTMLButtonElement>(
    '[data-timeline-kind="repeated_state"] .trace-viewer__timeline-band'
  )];
  expect(bands.map((band) => band.dataset.patternId)).toEqual(["a", "b"]);
  expect(bands.filter((band) => band.classList.contains("is-active"))).toHaveLength(2);
});
```

Add a non-overlap reuse case with patterns `[10,30]` and `[50,70]`, asserting both `data-subtrack="0"`.

- [ ] **Step 2: Run tests and confirm current one-track behavior fails**

```bash
npx vitest run tests/sidepanel/behavioral-timeline.test.ts
```

Expected: FAIL on `data-subtrack` / subtrack count assertions.

- [ ] **Step 3: Implement deterministic closed-interval packing**

Add:

```ts
function layoutTimelineLane(
  kind: BehavioralPattern["kind"],
  entries: readonly {
    pattern: BehavioralPattern;
    evidence: ResolvedBehavioralEvidence;
  }[]
): TimelineLaneLayout {
  const sorted = [...entries].sort((a, b) =>
    a.evidence.firstIndex! - b.evidence.firstIndex! ||
    a.evidence.lastIndex! - b.evidence.lastIndex! ||
    a.pattern.patternId.localeCompare(b.pattern.patternId)
  );
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
  return { kind, subtrackCount: Math.max(lastIndexByTrack.length, 1), bands };
}
```

Render a `.trace-viewer__timeline-track-stack` with one `.trace-viewer__timeline-subtrack` per track, set `lane.dataset.subtrackCount`, and set `band.dataset.subtrack` before appending each band to its assigned subtrack.

- [ ] **Step 4: Update CSS for stacked tracks**

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

Keep existing band labels and active-state logic unchanged.

- [ ] **Step 5: Run Task 3 gates**

```bash
npx vitest run tests/sidepanel/behavioral-timeline.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/sidepanel/components/BehavioralTimeline.ts src/sidepanel/styles.css tests/sidepanel/behavioral-timeline.test.ts
git commit -m "fix: stack overlapping behavioral timeline bands"
```

---

### Task 4: Integrate `TraceOutline` Into `TraceVisualizer`

**Files:**
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

**Interfaces:**

```ts
const traceFoldModel = buildTraceFoldModel(...);
let outlineHandle: TraceOutlineHandle | null = null;
```

The outline receives the existing `navigateDirect` callback.

- [ ] **Step 1: Add one deterministic real-pipeline repeated-transition fixture**

Use the already-proven finite-changing-loop shape from the current test suite, extended to six events so the 2-step motif repeats three times:

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
      right: int(1),
      target: int(9),
      total: int(9)
    }
  }));
  return { ...base, events };
}
```

Add a fixture guard test before outline assertions:

```ts
it("fixture exposes a repeated-transition fold candidate", () => {
  const view = createTraceVisualizer(repeatedTransitionFoldSession());
  expect(view.element.querySelector('[data-pattern-kind="repeated_transition"]')).not.toBeNull();
});
```

- [ ] **Step 2: Add failing outline integration tests**

```ts
it("mounts Trace Outline for non-empty traces", () => {
  const view = createTraceVisualizer(repeatedTransitionFoldSession());
  expect(view.element.querySelector(".trace-viewer__outline")).not.toBeNull();
});

it("routes fold Inspect through the existing raw step owner", () => {
  const view = createTraceVisualizer(repeatedTransitionFoldSession());
  const inspect = view.element.querySelector<HTMLButtonElement>(
    '[data-segment-kind="repeated_transition_fold"] [data-outline-action="inspect"]'
  )!;
  inspect.click();

  expect(view.element.querySelector('.trace-viewer__outline-segment.is-active[data-segment-kind="repeated_transition_fold"]'))
    .not.toBeNull();
  expect(view.element.querySelector(".trace-viewer__code-line.is-active")).not.toBeNull();
  expect(view.element.querySelector(".trace-viewer__locals")?.textContent).toContain("left");
});

it("keeps fold expansion presentation-only while direct Inspect stops autoplay", () => {
  vi.useFakeTimers();
  try {
    const view = createTraceVisualizer(repeatedTransitionFoldSession());
    view.element.querySelector<HTMLButtonElement>("#trace-play")!.click();
    expect(view.element.dataset.playing).toBe("true");

    view.element.querySelector<HTMLButtonElement>(
      '[data-segment-kind="repeated_transition_fold"] [data-outline-action="toggle"]'
    )!.click();
    expect(view.element.dataset.playing).toBe("true");

    view.element.querySelector<HTMLButtonElement>(
      '[data-segment-kind="repeated_transition_fold"] [data-outline-action="inspect"]'
    )!.click();
    expect(view.element.dataset.playing).toBe("false");
    view.dispose();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps raw Previous and Next one-step navigation when folds exist", () => {
  const view = createTraceVisualizer(repeatedTransitionFoldSession());
  view.setStep(2);
  view.element.querySelector<HTMLButtonElement>("#trace-next")!.click();
  expect(view.element.querySelector(".trace-viewer__step-label")?.textContent).toContain("Step 4 /");
  view.element.querySelector<HTMLButtonElement>("#trace-previous")!.click();
  expect(view.element.querySelector(".trace-viewer__step-label")?.textContent).toContain("Step 3 /");
});
```

Add one expanded motif repetition navigation assertion that clicks `[data-iteration="2"] [data-outline-action="inspect"]` and verifies the step label, timeline current label, active code line, and iteration active class all update to the same raw step.

- [ ] **Step 3: Run integration tests and confirm the outline is missing**

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts
```

Expected: FAIL on `.trace-viewer__outline` assertions.

- [ ] **Step 4: Wire the fold model and persistent outline once**

Add imports:

```ts
import { buildTraceFoldModel } from "../trace-folding";
import {
  createTraceOutline,
  type TraceOutlineHandle
} from "./TraceOutline";
```

After existing `evidenceByPatternId` creation:

```ts
const traceFoldModel = buildTraceFoldModel(
  session.events.length,
  interpretation.behavioralAnalysis.patterns,
  evidenceByPatternId
);
```

Near timeline state:

```ts
let outlineHandle: TraceOutlineHandle | null = null;
```

After `navigateDirect` is assigned:

```ts
outlineHandle = createTraceOutline({
  model: traceFoldModel,
  currentIndex,
  onNavigate: navigateDirect
});
```

Inside the non-empty `setStep()` branch:

```ts
outlineHandle?.setCurrentIndex(currentIndex);
```

- [ ] **Step 5: Place the outline before the Behavioral Timeline**

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

- [ ] **Step 6: Add outline CSS**

```css
.trace-viewer__outline {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid #dfe5ee;
  border-radius: 10px;
  background: #fff;
  padding: 10px 12px 12px;
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

.trace-viewer__outline-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
}

.trace-viewer__outline-title { font-size: 10px; font-weight: 750; }
.trace-viewer__outline-meta { color: #64748b; font-size: 9px; }
.trace-viewer__outline-iterations { margin-top: 6px; padding-left: 22px; }
.trace-viewer__outline-iteration { padding-top: 5px; font-size: 9px; }
.trace-viewer__outline-iteration.is-active { color: #1d4ed8; font-weight: 750; }
```

Inside the existing mobile media query:

```css
.trace-viewer__outline-row {
  grid-template-columns: auto minmax(0, 1fr);
}
```

- [ ] **Step 7: Add raw-only and timeout-prefix regressions**

```ts
it("renders one raw-only outline when no fold is eligible", () => {
  const view = createTraceVisualizer(session());
  expect(view.element.querySelectorAll('[data-segment-kind="raw_range"]')).toHaveLength(1);
  expect(view.element.querySelector('[data-segment-kind="repeated_transition_fold"]')).toBeNull();
});

it("keeps timeout-prefix fold wording factual", () => {
  const timedOut: TraceSession = {
    ...repeatedTransitionFoldSession(),
    status: "timeout",
    terminationReason: "hard_timeout"
  };
  const text = createTraceVisualizer(timedOut).element.textContent ?? "";
  expect(text).not.toMatch(/LeetCode TLE|root cause|caused the timeout|infinite loop/i);
});
```

- [ ] **Step 8: Run Task 4 gates**

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

- [ ] **Step 9: Commit Task 4**

```bash
git add src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: integrate folded trace outline"
```

---

### Task 5: Documentation and Full Regression Gates

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`

- [ ] **Step 1: Update English architecture and feature bullets**

Architecture tail:

```text
Visual interpretation + Behavioral Evidence Navigation
                ↓
Repeated-transition Trace Folding
                ↓
Trace Outline + Behavioral Timeline + Chrome Side Panel visualization
```

Add bullets:

```markdown
- a folded Trace Outline for eligible contiguous `RepeatedTransitionPattern` regions, with collapsed summaries and expandable motif-repetition ranges;
- collision-safe Behavioral Timeline subtracks so overlapping same-kind evidence bands remain independently visible;
- raw Previous / Next / Play navigation remains authoritative even when folded presentation is available;
```

Add boundary:

```markdown
- Trace folding is a deterministic presentation projection over captured raw steps. It does not delete raw events or diagnose why execution failed.
```

Append:

```markdown
- [Behavioral Trace Folding Design Spec](docs/superpowers/specs/2026-09-09-behavioral-trace-folding-design.md)
- [Behavioral Trace Folding Implementation Plan](docs/superpowers/plans/2026-09-09-behavioral-trace-folding-implementation-plan.md)
```

- [ ] **Step 2: Update Traditional Chinese README equivalently**

Architecture tail:

```text
Visual interpretation + Behavioral Evidence Navigation
                    ↓
Repeated-transition Trace Folding
                    ↓
Trace Outline + Behavioral Timeline + Chrome Side Panel 視覺化
```

Add bullets:

```markdown
- 對符合完整、連續 evidence 條件的 `RepeatedTransitionPattern` 提供 folded Trace Outline，可先看摘要，再展開成 motif repetition ranges；
- Behavioral Timeline 支援 collision-safe subtracks，同 kind 的重疊 evidence bands 不再互相遮蓋；
- 即使有 folded presentation，原本的 raw Previous／Next／Play 仍維持 authoritative raw-step navigation；
```

Add boundary:

```markdown
- Trace folding 只是 captured raw steps 上的 deterministic presentation projection，不會刪除 raw events，也不會診斷 execution failure 的原因。
```

Append the same design/plan links.

- [ ] **Step 3: Run focused milestone tests**

```bash
npx vitest run \
  tests/sidepanel/trace-folding.test.ts \
  tests/sidepanel/trace-outline.test.ts \
  tests/sidepanel/behavioral-timeline.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full repository gates**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 5: Run wording regression scan**

```bash
grep -RniE "LeetCode TLE|root cause|caused the timeout|infinite loop detected|go to bug|problem step|fix this" \
  src/sidepanel README.md README.zh-TW.md || true
```

Expected: no new diagnostic/causal claims; boundary text is acceptable only when explicitly negated.

- [ ] **Step 6: Commit docs**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: document behavioral trace folding"
```

---

## Final Verification Checklist

- [ ] Only `RepeatedTransitionPattern` folds.
- [ ] Complete evidence identity is checked before folding.
- [ ] Fold evidence length equals `periodSteps * repeatCount`.
- [ ] Fold raw indexes are contiguous.
- [ ] Missing/stale/gapped evidence falls back to raw presentation.
- [ ] Fold iteration boundaries are exact motif repetitions.
- [ ] Fold candidate selection maximizes folded raw coverage and follows deterministic tie-breaks.
- [ ] Fold model partitions every raw index exactly once.
- [ ] Trace Outline starts collapsed and preserves expansion through raw step changes.
- [ ] Expand/collapse does not navigate or stop autoplay.
- [ ] Outline Inspect actions emit raw indexes only.
- [ ] Outline navigation converges through `navigateDirect(index) -> stopPlaying() -> setStep(index)`.
- [ ] Raw Previous / Next / Play remain raw-step controls.
- [ ] Behavioral Signals semantics remain unchanged.
- [ ] Behavioral Timeline semantics remain unchanged.
- [ ] Overlapping same-kind timeline bands are placed on deterministic subtracks.
- [ ] Non-overlapping bands reuse the lowest available subtrack.
- [ ] Timeline accessibility and keyboard operation remain intact.
- [ ] Code / Visual State / What Changed / Locals / Call Stack / Output stay synchronized after outline jumps.
- [ ] Completed / exception / trace-limit / timeout-prefix traces remain factual and navigable.
- [ ] No analyzer contract or trace schema change was introduced.
- [ ] No folded autoplay, folded Previous/Next, failure-first ranking, Tree, Graph, DP, persistence, backend, or chart dependency was added.
- [ ] UI copy does not claim infinite loop, LeetCode TLE, correctness failure, root cause, causal bug location, or a fix.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.

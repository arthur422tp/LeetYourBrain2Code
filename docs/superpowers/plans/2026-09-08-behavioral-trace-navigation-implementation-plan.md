# Behavioral Trace Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn existing `BehavioralPattern` evidence into direct Side Panel navigation and a compact behavioral timeline without changing analyzer semantics or raw trace ownership.

**Architecture:** Keep `behavioral-analyzer.ts` and `BehavioralPattern` unchanged. Add a pure Side Panel step/index resolution unit, make `BehavioralSignals` callback-driven, add a dedicated `BehavioralTimeline` component, and route every new navigation path through the existing `TraceVisualizer.setStep(index)` state owner. Resolve behavioral evidence once per trace instance and never infer UI indexes with `event.step - 1`.

**Tech Stack:** TypeScript 5.8, Vitest 3, jsdom 26, Vite 6, Chrome Manifest V3 Side Panel, existing `trace-viewer__*` CSS system.

**Spec:** `docs/superpowers/specs/2026-09-08-behavioral-trace-navigation-design.md`

## Global Constraints

- Do not change `src/core/behavioral-pattern.ts` or behavioral detection semantics for UI convenience.
- `TraceEvent.step` is evidence identity; `TraceVisualizer.setStep()` consumes array indexes. Always resolve through an explicit mapping.
- First occurrence wins if duplicate trace step ids appear.
- Missing or stale behavioral evidence steps are ignored; navigation must not throw.
- Pattern active state means exact resolved evidence membership, not merely being inside `startStep -> endStep`.
- A timeline band is an overview span from first valid evidence index to last valid evidence index; it does not claim every intermediate step is evidence.
- All direct behavioral navigation and timeline scrubbing must converge on the existing `TraceVisualizer.setStep(index)` update path.
- Behavioral direct navigation and timeline scrubbing stop autoplay before moving.
- Preserve existing Previous / Next / Play controls and raw trace access.
- Preserve List, Dict, Linked List, visual candidate ranking, `What Changed`, Locals, Call Stack, stdout/exception, raw debug events, timeout-prefix, trace-limit, and exception rendering.
- Do not add trace folding, failure-first positioning, Tree, Graph, DP, diagnosis, root-cause wording, fixes, ranking, persistence, backend code, or chart libraries.
- New controls must use native keyboard-operable elements and must not rely on color alone.
- UI wording must remain evidence-oriented and must not claim infinite loop, LeetCode TLE, correctness failure, causal bug location, or a fix.

## File Map

Create:

```text
src/sidepanel/behavioral-navigation.ts
src/sidepanel/components/BehavioralTimeline.ts

tests/sidepanel/behavioral-navigation.test.ts
tests/sidepanel/behavioral-timeline.test.ts
```

Modify:

```text
src/sidepanel/components/BehavioralSignals.ts
src/sidepanel/components/TraceVisualizer.ts
src/sidepanel/styles.css

tests/sidepanel/behavioral-signals.test.ts
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

### Task 1: Add Pure Behavioral Evidence Resolution

**Files:**
- Create: `src/sidepanel/behavioral-navigation.ts`
- Create: `tests/sidepanel/behavioral-navigation.test.ts`

**Interfaces:**
- Consumes: `BehavioralPattern[]` and raw trace step ids in display order.
- Produces:

```ts
export interface TraceStepIndex {
  stepToIndex: ReadonlyMap<number, number>;
  indexToStep: readonly number[];
}

export interface ResolvedBehavioralEvidence {
  patternId: string;
  evidenceSteps: number[];
  evidenceIndexes: number[];
  firstIndex: number | null;
  lastIndex: number | null;
}

export function buildTraceStepIndex(steps: readonly number[]): TraceStepIndex;
export function resolveBehavioralEvidence(
  pattern: BehavioralPattern,
  traceIndex: TraceStepIndex
): ResolvedBehavioralEvidence;
export function resolveBehavioralEvidenceMap(
  patterns: readonly BehavioralPattern[],
  traceIndex: TraceStepIndex
): ReadonlyMap<string, ResolvedBehavioralEvidence>;
export function previousEvidenceIndex(
  evidence: ResolvedBehavioralEvidence,
  currentIndex: number
): number | null;
export function nextEvidenceIndex(
  evidence: ResolvedBehavioralEvidence,
  currentIndex: number
): number | null;
```

- [ ] **Step 1: Write failing mapping and normalization tests**

Create `tests/sidepanel/behavioral-navigation.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { BehavioralPattern } from "../../src/core/behavioral-pattern";
import {
  buildTraceStepIndex,
  nextEvidenceIndex,
  previousEvidenceIndex,
  resolveBehavioralEvidence,
  resolveBehavioralEvidenceMap
} from "../../src/sidepanel/behavioral-navigation";

const pattern: BehavioralPattern = {
  kind: "repeated_state",
  patternId: "repeated_state:10:70:hash",
  startStep: 10,
  endStep: 70,
  repeatCount: 4,
  evidenceSteps: [70, 10, 30, 30, 999],
  location: { frameId: 1, functionName: "solve", line: 8 },
  stateFingerprintKey: "hash"
};

describe("behavioral navigation", () => {
  it("maps non-contiguous trace step ids to display indexes without step-minus-one assumptions", () => {
    const index = buildTraceStepIndex([10, 30, 50, 70]);

    expect(index.stepToIndex.get(10)).toBe(0);
    expect(index.stepToIndex.get(30)).toBe(1);
    expect(index.stepToIndex.get(70)).toBe(3);
    expect(index.indexToStep).toEqual([10, 30, 50, 70]);
  });

  it("keeps the first index for duplicate trace step ids", () => {
    const index = buildTraceStepIndex([10, 30, 30, 70]);

    expect(index.stepToIndex.get(30)).toBe(1);
    expect(index.indexToStep).toEqual([10, 30, 30, 70]);
  });

  it("drops missing evidence, deduplicates resolved indexes, and sorts in trace order", () => {
    const resolved = resolveBehavioralEvidence(
      pattern,
      buildTraceStepIndex([10, 30, 50, 70])
    );

    expect(resolved).toEqual({
      patternId: pattern.patternId,
      evidenceSteps: [10, 30, 70],
      evidenceIndexes: [0, 1, 3],
      firstIndex: 0,
      lastIndex: 3
    });
  });

  it("returns nearest strict previous and next evidence without wrapping", () => {
    const evidence = resolveBehavioralEvidence(
      pattern,
      buildTraceStepIndex([10, 30, 50, 70])
    );

    expect(previousEvidenceIndex(evidence, 0)).toBeNull();
    expect(previousEvidenceIndex(evidence, 2)).toBe(1);
    expect(previousEvidenceIndex(evidence, 3)).toBe(1);
    expect(nextEvidenceIndex(evidence, 0)).toBe(1);
    expect(nextEvidenceIndex(evidence, 2)).toBe(3);
    expect(nextEvidenceIndex(evidence, 3)).toBeNull();
  });

  it("returns a disabled shape when every evidence step is unresolved", () => {
    const unresolved: BehavioralPattern = {
      ...pattern,
      patternId: "unresolved",
      evidenceSteps: [901, 902]
    };
    const resolved = resolveBehavioralEvidence(
      unresolved,
      buildTraceStepIndex([10, 30, 50, 70])
    );

    expect(resolved.evidenceSteps).toEqual([]);
    expect(resolved.evidenceIndexes).toEqual([]);
    expect(resolved.firstIndex).toBeNull();
    expect(resolved.lastIndex).toBeNull();
  });

  it("resolves all patterns once into a pattern-id map", () => {
    const map = resolveBehavioralEvidenceMap(
      [pattern],
      buildTraceStepIndex([10, 30, 50, 70])
    );

    expect(map.get(pattern.patternId)?.evidenceIndexes).toEqual([0, 1, 3]);
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
npx vitest run tests/sidepanel/behavioral-navigation.test.ts
```

Expected: FAIL because `src/sidepanel/behavioral-navigation.ts` does not exist.

- [ ] **Step 3: Implement the pure step/index resolver**

Create `src/sidepanel/behavioral-navigation.ts`:

```ts
import type { BehavioralPattern } from "../core/behavioral-pattern";

export interface TraceStepIndex {
  stepToIndex: ReadonlyMap<number, number>;
  indexToStep: readonly number[];
}

export interface ResolvedBehavioralEvidence {
  patternId: string;
  evidenceSteps: number[];
  evidenceIndexes: number[];
  firstIndex: number | null;
  lastIndex: number | null;
}

export function buildTraceStepIndex(steps: readonly number[]): TraceStepIndex {
  const stepToIndex = new Map<number, number>();
  const indexToStep = [...steps];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (!Number.isFinite(step) || !Number.isInteger(step) || stepToIndex.has(step)) {
      continue;
    }
    stepToIndex.set(step, index);
  }

  return { stepToIndex, indexToStep };
}

export function resolveBehavioralEvidence(
  pattern: BehavioralPattern,
  traceIndex: TraceStepIndex
): ResolvedBehavioralEvidence {
  const byIndex = new Map<number, number>();

  for (const step of pattern.evidenceSteps) {
    const index = traceIndex.stepToIndex.get(step);
    if (index === undefined || byIndex.has(index)) {
      continue;
    }
    byIndex.set(index, step);
  }

  const entries = [...byIndex.entries()].sort(([left], [right]) => left - right);
  const evidenceIndexes = entries.map(([index]) => index);
  const evidenceSteps = entries.map(([, step]) => step);

  return {
    patternId: pattern.patternId,
    evidenceSteps,
    evidenceIndexes,
    firstIndex: evidenceIndexes[0] ?? null,
    lastIndex: evidenceIndexes.at(-1) ?? null
  };
}

export function resolveBehavioralEvidenceMap(
  patterns: readonly BehavioralPattern[],
  traceIndex: TraceStepIndex
): ReadonlyMap<string, ResolvedBehavioralEvidence> {
  return new Map(patterns.map((pattern) => [
    pattern.patternId,
    resolveBehavioralEvidence(pattern, traceIndex)
  ]));
}

export function previousEvidenceIndex(
  evidence: ResolvedBehavioralEvidence,
  currentIndex: number
): number | null {
  for (let index = evidence.evidenceIndexes.length - 1; index >= 0; index -= 1) {
    const candidate = evidence.evidenceIndexes[index]!;
    if (candidate < currentIndex) {
      return candidate;
    }
  }
  return null;
}

export function nextEvidenceIndex(
  evidence: ResolvedBehavioralEvidence,
  currentIndex: number
): number | null {
  for (const candidate of evidence.evidenceIndexes) {
    if (candidate > currentIndex) {
      return candidate;
    }
  }
  return null;
}
```

Do not import trace interpreter, DOM, or worker code here.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
npx vitest run tests/sidepanel/behavioral-navigation.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/behavioral-navigation.ts tests/sidepanel/behavioral-navigation.test.ts
git commit -m "feat: resolve behavioral evidence navigation"
```

---

### Task 2: Make Behavioral Signals Navigable Through the Existing Step Owner

**Files:**
- Modify: `src/sidepanel/components/BehavioralSignals.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/behavioral-signals.test.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

**Interfaces:**
- Consumes: Task 1 evidence resolver, `BehavioralAnalysis`, current raw index, and `TraceVisualizer.setStep(index)`.
- Produces:

```ts
export interface BehavioralSignalsOptions {
  analysis: BehavioralAnalysis;
  currentIndex: number;
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>;
  onNavigate(index: number): void;
}

export function createBehavioralSignals(
  options: BehavioralSignalsOptions
): HTMLDivElement;
```

- `TraceVisualizer` resolves step/index mappings once per trace and passes a direct navigation callback that stops autoplay then calls the existing `setStep(index)`.
- This task must end with the repository compiling; do not leave the old `createBehavioralSignals(analysis, currentStep)` call site behind.

- [ ] **Step 1: Update signal unit tests for callback-driven evidence navigation**

In `tests/sidepanel/behavioral-signals.test.ts`, change imports to:

```ts
import { describe, expect, it, vi } from "vitest";

import type { BehavioralAnalysis } from "../../src/core/behavioral-pattern";
import {
  buildTraceStepIndex,
  resolveBehavioralEvidenceMap
} from "../../src/sidepanel/behavioral-navigation";
import { createBehavioralSignals } from "../../src/sidepanel/components/BehavioralSignals";
```

Keep the current three-pattern `analysis` fixture and add:

```ts
function render(currentIndex: number, onNavigate = vi.fn()) {
  const traceIndex = buildTraceStepIndex([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const evidenceByPatternId = resolveBehavioralEvidenceMap(
    analysis.patterns,
    traceIndex
  );
  return {
    element: createBehavioralSignals({
      analysis,
      currentIndex,
      evidenceByPatternId,
      onNavigate
    }),
    onNavigate
  };
}
```

Add/replace tests with:

```ts
it("renders every factual pattern kind and marks exact current evidence", () => {
  const { element } = render(3); // raw index 3 = trace step 4
  const text = element.textContent ?? "";

  expect(text).toContain("Repeated state × 3");
  expect(text).toContain("solve · line 5");
  expect(text).toContain("No observable progress");
  expect(text).toContain("Repeated transition motif × 3");
  expect(element.querySelectorAll(".trace-viewer__behavioral-signal.is-active"))
    .toHaveLength(3);
  expect(text).not.toMatch(/infinite loop|TLE|bug|fix/i);
});

it("navigates to the next exact evidence index rather than current plus one", () => {
  const { element, onNavigate } = render(0);
  const row = element.querySelector('[data-pattern-kind="repeated_state"]')!;

  row.querySelector<HTMLButtonElement>('[data-behavior-action="next"]')!.click();

  expect(onNavigate).toHaveBeenCalledWith(3); // evidence steps [1,4,7]
});

it("disables first/previous at first evidence and next/last at last evidence", () => {
  const first = render(0).element.querySelector('[data-pattern-kind="repeated_state"]')!;
  expect(first.querySelector<HTMLButtonElement>('[data-behavior-action="first"]')?.disabled)
    .toBe(true);
  expect(first.querySelector<HTMLButtonElement>('[data-behavior-action="previous"]')?.disabled)
    .toBe(true);

  const last = render(6).element.querySelector('[data-pattern-kind="repeated_state"]')!;
  expect(last.querySelector<HTMLButtonElement>('[data-behavior-action="next"]')?.disabled)
    .toBe(true);
  expect(last.querySelector<HTMLButtonElement>('[data-behavior-action="last"]')?.disabled)
    .toBe(true);
});

it("keeps factual text but disables navigation when evidence cannot resolve", () => {
  const unresolved = {
    patterns: [{ ...analysis.patterns[0]!, patternId: "stale", evidenceSteps: [999] }],
    stepAnnotations: []
  } satisfies BehavioralAnalysis;
  const evidenceByPatternId = resolveBehavioralEvidenceMap(
    unresolved.patterns,
    buildTraceStepIndex([1, 2, 3])
  );
  const element = createBehavioralSignals({
    analysis: unresolved,
    currentIndex: 0,
    evidenceByPatternId,
    onNavigate: vi.fn()
  });

  expect(element.textContent).toContain("Repeated state × 3");
  expect([...element.querySelectorAll<HTMLButtonElement>("button")]
    .every((button) => button.disabled)).toBe(true);
});

it("renders a neutral empty state when no patterns are available", () => {
  expect(createBehavioralSignals({
    analysis: { patterns: [], stepAnnotations: [] },
    currentIndex: 0,
    evidenceByPatternId: new Map(),
    onNavigate: vi.fn()
  }).textContent).toBe("No repeated behavioral signal in the captured trace.");
});
```

- [ ] **Step 2: Add an integration fixture with non-adjacent repeated evidence**

In `tests/sidepanel/trace-visualizer.test.ts`, add:

```ts
function alternatingRepeatedStateSession(): TraceSession {
  const base = session();
  const events = [0, 1, 0, 1, 0].map((left, index) => ({
    ...base.events[0]!,
    step: index + 1,
    line: index % 2 === 0 ? 5 : 6,
    locals: {
      nums: list([2, 7]),
      left: int(left),
      right: int(1),
      target: int(9),
      total: int(9)
    }
  }));
  return { ...base, events };
}
```

Add:

```ts
it("routes Next evidence through the same raw step state owner", () => {
  const view = createTraceVisualizer(alternatingRepeatedStateSession());
  const row = view.element.querySelector('[data-pattern-kind="repeated_state"]')!;

  row.querySelector<HTMLButtonElement>('[data-behavior-action="next"]')!.click();

  expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
    .toBe("Step 3 / 5");
  expect(view.element.querySelector(".trace-viewer__code-line.is-active")?.textContent)
    .toContain("total = nums[left] + nums[right]");
  expect(view.element.querySelector(".trace-viewer__locals")?.textContent)
    .toContain("left");
});

it("stops autoplay when the user directly navigates behavioral evidence", () => {
  vi.useFakeTimers();
  const view = createTraceVisualizer(alternatingRepeatedStateSession());
  const play = view.element.querySelector<HTMLButtonElement>("#trace-play")!;

  view.setStep(1);
  play.click();
  expect(view.element.dataset.playing).toBe("true");

  const row = view.element.querySelector('[data-pattern-kind="repeated_state"]')!;
  row.querySelector<HTMLButtonElement>('[data-behavior-action="previous"]')!.click();

  expect(view.element.dataset.playing).toBe("false");
  expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
    .toBe("Step 1 / 5");
  vi.useRealTimers();
});
```

Keep the existing raw Previous/Next/Play and timeout-prefix tests.

- [ ] **Step 3: Run the focused tests to verify they fail against the passive component**

```bash
npx vitest run \
  tests/sidepanel/behavioral-signals.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
```

Expected: FAIL because signals have no navigation controls and the old call signature remains passive.

- [ ] **Step 4: Refactor `BehavioralSignals.ts` to emit navigation intent only**

Add:

```ts
import {
  nextEvidenceIndex,
  previousEvidenceIndex,
  type ResolvedBehavioralEvidence
} from "../behavioral-navigation";

export interface BehavioralSignalsOptions {
  analysis: BehavioralAnalysis;
  currentIndex: number;
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>;
  onNavigate(index: number): void;
}
```

Add:

```ts
function navigationButton(
  label: string,
  action: "first" | "previous" | "next" | "last",
  targetIndex: number | null,
  onNavigate: (index: number) => void,
  disabledWhenCurrent: boolean
): HTMLButtonElement {
  const button = createElement("button", "trace-viewer__behavioral-nav-button", label);
  button.type = "button";
  button.dataset.behaviorAction = action;
  button.disabled = targetIndex === null || disabledWhenCurrent;
  button.addEventListener("click", () => {
    if (targetIndex !== null) {
      onNavigate(targetIndex);
    }
  });
  return button;
}
```

Replace `renderPattern(...)` with a resolved-index version:

```ts
function renderPattern(
  pattern: BehavioralPattern,
  currentIndex: number,
  evidence: ResolvedBehavioralEvidence | undefined,
  onNavigate: (index: number) => void
): HTMLDivElement {
  const row = createElement("div", "trace-viewer__behavioral-signal");
  row.dataset.patternId = pattern.patternId;
  row.dataset.patternKind = pattern.kind;

  const valid: ResolvedBehavioralEvidence = evidence ?? {
    patternId: pattern.patternId,
    evidenceSteps: [],
    evidenceIndexes: [],
    firstIndex: null,
    lastIndex: null
  };
  const previous = previousEvidenceIndex(valid, currentIndex);
  const next = nextEvidenceIndex(valid, currentIndex);

  if (valid.evidenceIndexes.includes(currentIndex)) {
    row.classList.add("is-active");
  }

  const meta = valid.evidenceIndexes.length > 0
    ? `Evidence: steps ${valid.evidenceSteps[0]}–${valid.evidenceSteps.at(-1)} · ${valid.evidenceIndexes.length} observations`
    : "Navigation unavailable for this signal.";

  const actions = createElement("div", "trace-viewer__behavioral-nav-actions");
  actions.append(
    navigationButton("First", "first", valid.firstIndex, onNavigate, currentIndex === valid.firstIndex),
    navigationButton("Previous", "previous", previous, onNavigate, false),
    navigationButton("Next", "next", next, onNavigate, false),
    navigationButton("Last", "last", valid.lastIndex, onNavigate, currentIndex === valid.lastIndex)
  );

  row.append(
    createElement("strong", "trace-viewer__behavioral-signal-title", title(pattern)),
    createElement("span", "trace-viewer__behavioral-signal-detail", detail(pattern)),
    createElement("span", "trace-viewer__behavioral-nav-meta", meta),
    actions
  );
  return row;
}
```

Replace the public function with:

```ts
export function createBehavioralSignals(
  options: BehavioralSignalsOptions
): HTMLDivElement {
  const body = createElement("div", "trace-viewer__behavioral-signals");
  if (options.analysis.patterns.length === 0) {
    body.append(createElement(
      "div",
      "trace-viewer__empty",
      "No repeated behavioral signal in the captured trace."
    ));
    return body;
  }

  body.append(...options.analysis.patterns.map((pattern) => renderPattern(
    pattern,
    options.currentIndex,
    options.evidenceByPatternId.get(pattern.patternId),
    options.onNavigate
  )));
  return body;
}
```

Do not import `TraceVisualizer` or maintain an independent cursor.

- [ ] **Step 5: Wire the new signal contract into `TraceVisualizer.ts` immediately**

Add:

```ts
import {
  buildTraceStepIndex,
  resolveBehavioralEvidenceMap
} from "../behavioral-navigation";
```

Immediately after `interpretTrace(...)`:

```ts
const traceIndex = buildTraceStepIndex(session.events.map((event) => event.step));
const evidenceByPatternId = resolveBehavioralEvidenceMap(
  interpretation.behavioralAnalysis.patterns,
  traceIndex
);
```

Near the existing cursor/timer state:

```ts
let currentIndex = 0;
let timer: number | null = null;
let navigateDirect: (index: number) => void;
```

Keep the existing `stopPlaying()` function.

Inside both branches of `setStep()`, replace old `createBehavioralSignals(...)` calls with:

```ts
createBehavioralSignals({
  analysis: interpretation.behavioralAnalysis,
  currentIndex,
  evidenceByPatternId,
  onNavigate: navigateDirect
})
```

After the complete `setStep` function definition, assign:

```ts
navigateDirect = (index: number): void => {
  stopPlaying();
  setStep(index);
};
```

The existing initial `setStep(0)` call must remain after this assignment.

- [ ] **Step 6: Add compact signal-navigation styles**

Near the existing behavioral signal rules in `src/sidepanel/styles.css`, add:

```css
.trace-viewer__behavioral-nav-meta {
  color: #94a3b8;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 9px;
}

.trace-viewer__behavioral-nav-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
  margin-top: 2px;
}

.trace-viewer__behavioral-nav-button {
  padding: 5px 6px;
  font-size: 9px;
}
```

Inside the existing `@media (max-width: 430px)` block add:

```css
.trace-viewer__behavioral-nav-actions {
  grid-template-columns: 1fr 1fr;
}
```

- [ ] **Step 7: Run signal integration tests and typecheck**

```bash
npx vitest run \
  tests/sidepanel/behavioral-navigation.test.ts \
  tests/sidepanel/behavioral-signals.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add \
  src/sidepanel/components/BehavioralSignals.ts \
  src/sidepanel/components/TraceVisualizer.ts \
  src/sidepanel/styles.css \
  tests/sidepanel/behavioral-signals.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: navigate behavioral signal evidence"
```

---

### Task 3: Add the Behavioral Timeline Component

**Files:**
- Create: `src/sidepanel/components/BehavioralTimeline.ts`
- Create: `tests/sidepanel/behavioral-timeline.test.ts`

**Interfaces:**
- Consumes: `BehavioralAnalysis`, `TraceStepIndex`, resolved evidence map, current raw index, and `onNavigate(index)`.
- Produces:

```ts
export interface BehavioralTimelineOptions {
  analysis: BehavioralAnalysis;
  traceIndex: TraceStepIndex;
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>;
  currentIndex: number;
  onNavigate(index: number): void;
}

export interface BehavioralTimelineHandle {
  element: HTMLDivElement;
  setCurrentIndex(index: number): void;
}

export function createBehavioralTimeline(
  options: BehavioralTimelineOptions
): BehavioralTimelineHandle;
```

- The component renders exactly one raw range input and at most one band per valid `BehavioralPattern`.
- Lane kinds are fixed to `repeated_state`, `no_progress`, and `repeated_transition`.
- This component has no knowledge of autoplay or `TraceVisualizer`; it emits raw index navigation intent only.

- [ ] **Step 1: Write failing timeline component tests**

Create `tests/sidepanel/behavioral-timeline.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import type { BehavioralAnalysis } from "../../src/core/behavioral-pattern";
import {
  buildTraceStepIndex,
  resolveBehavioralEvidenceMap
} from "../../src/sidepanel/behavioral-navigation";
import { createBehavioralTimeline } from "../../src/sidepanel/components/BehavioralTimeline";

const analysis: BehavioralAnalysis = {
  patterns: [
    {
      kind: "repeated_state",
      patternId: "state",
      startStep: 10,
      endStep: 70,
      repeatCount: 3,
      evidenceSteps: [10, 30, 70],
      location: { frameId: 1, functionName: "solve", line: 5 },
      stateFingerprintKey: "hash"
    },
    {
      kind: "no_progress",
      patternId: "progress",
      startStep: 30,
      endStep: 70,
      repeatCount: 3,
      revisitCount: 2,
      evidenceSteps: [30, 50, 70],
      location: { frameId: 1, functionName: "solve", line: 5 }
    },
    {
      kind: "repeated_transition",
      patternId: "transition",
      startStep: 10,
      endStep: 70,
      repeatCount: 3,
      evidenceSteps: [10, 30, 50, 70],
      periodSteps: 2,
      motifKeys: ["A", "B"]
    }
  ],
  stepAnnotations: []
};

function render(currentIndex = 0, onNavigate = vi.fn()) {
  const traceIndex = buildTraceStepIndex([10, 30, 50, 70]);
  const evidenceByPatternId = resolveBehavioralEvidenceMap(analysis.patterns, traceIndex);
  return {
    handle: createBehavioralTimeline({
      analysis,
      traceIndex,
      evidenceByPatternId,
      currentIndex,
      onNavigate
    }),
    onNavigate
  };
}

describe("createBehavioralTimeline", () => {
  it("renders a raw trace range and current position", () => {
    const { handle } = render(1);
    const range = handle.element.querySelector<HTMLInputElement>('[data-role="trace-range"]')!;

    expect(range.min).toBe("0");
    expect(range.max).toBe("3");
    expect(range.value).toBe("1");
    expect(handle.element.textContent).toContain("Step 2 / 4");
  });

  it("emits the requested raw index when the range changes", () => {
    const { handle, onNavigate } = render();
    const range = handle.element.querySelector<HTMLInputElement>('[data-role="trace-range"]')!;
    range.value = "2";

    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onNavigate).toHaveBeenCalledWith(2);
  });

  it("renders one lane for every pattern kind present", () => {
    const { handle } = render();

    expect(handle.element.querySelectorAll('[data-timeline-kind="repeated_state"]')).toHaveLength(1);
    expect(handle.element.querySelectorAll('[data-timeline-kind="no_progress"]')).toHaveLength(1);
    expect(handle.element.querySelectorAll('[data-timeline-kind="repeated_transition"]')).toHaveLength(1);
  });

  it("positions a band from first valid evidence to last valid evidence", () => {
    const { handle } = render();
    const band = handle.element.querySelector<HTMLButtonElement>('[data-pattern-id="state"]')!;

    expect(band.style.left).toBe("0%");
    expect(band.style.width).toBe("100%");
  });

  it("navigates a band to its first valid evidence index", () => {
    const { handle, onNavigate } = render(3);

    handle.element.querySelector<HTMLButtonElement>('[data-pattern-id="state"]')!.click();

    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it("updates current position and exact active-band evidence without rebuilding", () => {
    const { handle } = render(0);
    const stateBand = handle.element.querySelector<HTMLButtonElement>('[data-pattern-id="state"]')!;

    handle.setCurrentIndex(2); // step 50 is not repeated-state evidence
    expect(handle.element.textContent).toContain("Step 3 / 4");
    expect(stateBand.classList.contains("is-active")).toBe(false);

    handle.setCurrentIndex(3); // step 70 is repeated-state evidence
    expect(stateBand.classList.contains("is-active")).toBe(true);
  });

  it("renders raw scrubbing but a neutral behavioral message when no patterns exist", () => {
    const traceIndex = buildTraceStepIndex([1, 2]);
    const handle = createBehavioralTimeline({
      analysis: { patterns: [], stepAnnotations: [] },
      traceIndex,
      evidenceByPatternId: new Map(),
      currentIndex: 0,
      onNavigate: vi.fn()
    });

    expect(handle.element.querySelector('[data-role="trace-range"]')).not.toBeNull();
    expect(handle.element.textContent).toContain("No repeated behavioral regions in the captured trace.");
  });

  it("renders no invalid range for an empty trace", () => {
    const handle = createBehavioralTimeline({
      analysis: { patterns: [], stepAnnotations: [] },
      traceIndex: buildTraceStepIndex([]),
      evidenceByPatternId: new Map(),
      currentIndex: 0,
      onNavigate: vi.fn()
    });

    expect(handle.element.querySelector('[data-role="trace-range"]')).toBeNull();
    expect(handle.element.textContent).toContain("No execution steps were captured.");
  });

  it("gives every band an accessible evidence label", () => {
    const { handle } = render();
    const labels = [...handle.element.querySelectorAll<HTMLButtonElement>(".trace-viewer__timeline-band")]
      .map((button) => button.getAttribute("aria-label"));

    expect(labels.every((label) => label?.includes("evidence span"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new timeline test to verify it fails**

```bash
npx vitest run tests/sidepanel/behavioral-timeline.test.ts
```

Expected: FAIL because `BehavioralTimeline.ts` does not exist.

- [ ] **Step 3: Implement the timeline component with one persistent handle**

Create `src/sidepanel/components/BehavioralTimeline.ts`:

```ts
import type {
  BehavioralAnalysis,
  BehavioralPattern
} from "../../core/behavioral-pattern";
import type {
  ResolvedBehavioralEvidence,
  TraceStepIndex
} from "../behavioral-navigation";

export interface BehavioralTimelineOptions {
  analysis: BehavioralAnalysis;
  traceIndex: TraceStepIndex;
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>;
  currentIndex: number;
  onNavigate(index: number): void;
}

export interface BehavioralTimelineHandle {
  element: HTMLDivElement;
  setCurrentIndex(index: number): void;
}

const KIND_ORDER: BehavioralPattern["kind"][] = [
  "repeated_state",
  "no_progress",
  "repeated_transition"
];

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function kindLabel(kind: BehavioralPattern["kind"]): string {
  switch (kind) {
    case "repeated_state":
      return "Repeated state";
    case "no_progress":
      return "No progress";
    case "repeated_transition":
      return "Repeated transition";
  }
}

function clampIndex(index: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(Math.trunc(index), total - 1));
}

export function createBehavioralTimeline(
  options: BehavioralTimelineOptions
): BehavioralTimelineHandle {
  const root = createElement("div", "trace-viewer__timeline");
  const total = options.traceIndex.indexToStep.length;

  if (total === 0) {
    root.append(createElement(
      "div",
      "trace-viewer__empty",
      "No execution steps were captured."
    ));
    return { element: root, setCurrentIndex: () => {} };
  }

  const header = createElement("div", "trace-viewer__timeline-header");
  header.append(createElement("strong", undefined, "Behavioral Timeline"));
  const position = createElement("span", "trace-viewer__timeline-current");
  header.append(position);

  const range = document.createElement("input");
  range.type = "range";
  range.className = "trace-viewer__timeline-range";
  range.dataset.role = "trace-range";
  range.min = "0";
  range.max = String(Math.max(total - 1, 0));
  range.step = "1";
  range.disabled = total === 1;
  range.setAttribute("aria-label", "Captured trace position");
  range.addEventListener("input", () => {
    options.onNavigate(clampIndex(Number(range.value), total));
  });

  const lanes = createElement("div", "trace-viewer__timeline-lanes");
  const activeBands: Array<{
    button: HTMLButtonElement;
    evidence: ResolvedBehavioralEvidence;
  }> = [];

  let renderedBands = 0;
  for (const kind of KIND_ORDER) {
    const valid: Array<{
      pattern: BehavioralPattern;
      evidence: ResolvedBehavioralEvidence;
    }> = [];

    for (const pattern of options.analysis.patterns) {
      if (pattern.kind !== kind) {
        continue;
      }
      const evidence = options.evidenceByPatternId.get(pattern.patternId);
      if (!evidence || evidence.firstIndex === null || evidence.lastIndex === null) {
        continue;
      }
      valid.push({ pattern, evidence });
    }

    if (valid.length === 0) {
      continue;
    }

    const lane = createElement("div", "trace-viewer__timeline-lane");
    lane.dataset.timelineKind = kind;
    lane.append(createElement("span", "trace-viewer__timeline-lane-label", kindLabel(kind)));
    const track = createElement("div", "trace-viewer__timeline-track");

    for (const { pattern, evidence } of valid) {
      const firstIndex = evidence.firstIndex!;
      const lastIndex = evidence.lastIndex!;
      const denominator = Math.max(total - 1, 1);
      const left = firstIndex / denominator * 100;
      const width = Math.max((lastIndex - firstIndex) / denominator * 100, 1.5);
      const firstStep = evidence.evidenceSteps[0]!;
      const lastStep = evidence.evidenceSteps.at(-1)!;
      const band = createElement("button", "trace-viewer__timeline-band") as HTMLButtonElement;
      band.type = "button";
      band.dataset.patternId = pattern.patternId;
      band.dataset.patternKind = pattern.kind;
      band.style.left = `${left}%`;
      band.style.width = `${Math.min(width, 100 - left)}%`;
      band.setAttribute(
        "aria-label",
        `${kindLabel(pattern.kind)} evidence span steps ${firstStep} to ${lastStep}; ${evidence.evidenceIndexes.length} evidence steps`
      );
      band.addEventListener("click", () => options.onNavigate(firstIndex));
      track.append(band);
      activeBands.push({ button: band, evidence });
      renderedBands += 1;
    }

    lane.append(track);
    lanes.append(lane);
  }

  if (renderedBands === 0) {
    lanes.append(createElement(
      "div",
      "trace-viewer__empty",
      "No repeated behavioral regions in the captured trace."
    ));
  }

  root.append(header, range, lanes);

  const setCurrentIndex = (requestedIndex: number): void => {
    const index = clampIndex(requestedIndex, total);
    range.value = String(index);
    position.textContent = `Step ${index + 1} / ${total}`;
    for (const entry of activeBands) {
      entry.button.classList.toggle(
        "is-active",
        entry.evidence.evidenceIndexes.includes(index)
      );
    }
  };

  setCurrentIndex(options.currentIndex);
  return { element: root, setCurrentIndex };
}
```

Do not render one DOM marker per evidence step. Each pattern gets at most one band.

- [ ] **Step 4: Run timeline tests and typecheck**

```bash
npx vitest run \
  tests/sidepanel/behavioral-navigation.test.ts \
  tests/sidepanel/behavioral-timeline.test.ts
npm run typecheck
```

Expected: PASS. The timeline is not integrated yet, so existing Side Panel behavior remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/components/BehavioralTimeline.ts tests/sidepanel/behavioral-timeline.test.ts
git commit -m "feat: add behavioral trace timeline"
```

---

### Task 4: Integrate the Timeline With `TraceVisualizer.setStep()`

**Files:**
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

**Interfaces:**
- Consumes: `traceIndex`, `evidenceByPatternId`, and `navigateDirect` already established by Task 2 plus the `BehavioralTimelineHandle` from Task 3.
- Produces: one persistent timeline instance whose range and bands update from `setStep(index)` and whose navigation intent calls the same `navigateDirect` path as signal buttons.

- [ ] **Step 1: Write failing integrated timeline navigation tests**

Using `alternatingRepeatedStateSession()` from Task 2, add to `tests/sidepanel/trace-visualizer.test.ts`:

```ts
it("scrubs the raw timeline through setStep", () => {
  const view = createTraceVisualizer(alternatingRepeatedStateSession());
  const range = view.element.querySelector<HTMLInputElement>('[data-role="trace-range"]')!;
  range.value = "4";

  range.dispatchEvent(new Event("input", { bubbles: true }));

  expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
    .toBe("Step 5 / 5");
});

it("navigates a behavioral timeline band to its first evidence", () => {
  const view = createTraceVisualizer(alternatingRepeatedStateSession());
  view.setStep(4);
  const band = view.element.querySelector<HTMLButtonElement>(
    '.trace-viewer__timeline-band[data-pattern-kind="repeated_state"]'
  )!;

  band.click();

  expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
    .toBe("Step 1 / 5");
});

it("keeps timeline position synchronized with raw Previous and Next navigation", () => {
  const view = createTraceVisualizer(alternatingRepeatedStateSession());
  const range = view.element.querySelector<HTMLInputElement>('[data-role="trace-range"]')!;

  view.element.querySelector<HTMLButtonElement>("#trace-next")!.click();

  expect(range.value).toBe("1");
  expect(view.element.querySelector(".trace-viewer__timeline-current")?.textContent)
    .toBe("Step 2 / 5");
});

it("keeps a raw scrubber when no behavioral pattern exists", () => {
  const view = createTraceVisualizer(session());

  expect(view.element.querySelector('[data-role="trace-range"]')).not.toBeNull();
});
```

The existing Task 2 autoplay-stop test already covers `navigateDirect`; because the timeline also receives `navigateDirect`, no second timer-specific implementation path is allowed.

- [ ] **Step 2: Run the integration test to verify the timeline is not wired yet**

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts
```

Expected: FAIL because no timeline is mounted.

- [ ] **Step 3: Import and instantiate the timeline once**

In `TraceVisualizer.ts`, add:

```ts
import {
  createBehavioralTimeline,
  type BehavioralTimelineHandle
} from "./BehavioralTimeline";
```

Near `currentIndex` / `timer` / `navigateDirect`, add:

```ts
let timelineHandle: BehavioralTimelineHandle | null = null;
```

After `navigateDirect` is assigned, create one timeline:

```ts
timelineHandle = createBehavioralTimeline({
  analysis: interpretation.behavioralAnalysis,
  traceIndex,
  evidenceByPatternId,
  currentIndex,
  onNavigate: navigateDirect
});
```

Inside the non-empty branch of `setStep()`, after updating raw button state, add:

```ts
timelineHandle?.setCurrentIndex(currentIndex);
```

The empty trace timeline has its own neutral state and needs no index update.

- [ ] **Step 4: Place the timeline immediately before existing raw controls**

Use:

```ts
root.append(
  summary,
  codePanel.panel,
  visualPanel.panel,
  inspectorGrid,
  callStackPanel,
  outputPanel.panel,
  debugPanel.panel,
  timelineHandle.element,
  controls
);
setStep(0);
```

Do not move `Code`, `Visual State`, or the inspector panels above/below their existing product hierarchy.

- [ ] **Step 5: Add timeline styles**

Near the behavioral styles in `src/sidepanel/styles.css`, add:

```css
.trace-viewer__timeline {
  display: flex;
  flex-direction: column;
  gap: 9px;
  border: 1px solid #dfe5ee;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  padding: 10px 12px 12px;
}

.trace-viewer__timeline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #334155;
  font-size: 11px;
}

.trace-viewer__timeline-current {
  color: #64748b;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 9px;
}

.trace-viewer__timeline-range {
  width: 100%;
}

.trace-viewer__timeline-lanes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trace-viewer__timeline-lane {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
}

.trace-viewer__timeline-lane-label {
  color: #64748b;
  font-size: 9px;
  font-weight: 700;
}

.trace-viewer__timeline-track {
  position: relative;
  height: 18px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #f8fafc;
}

.trace-viewer__timeline-band {
  position: absolute;
  top: 3px;
  height: 10px;
  min-width: 6px;
  border: 1px solid #94a3b8;
  border-radius: 999px;
  background: #e2e8f0;
  padding: 0;
}

.trace-viewer__timeline-band[data-pattern-kind="repeated_state"] {
  border-color: #7aa7ef;
  background: #dbeafe;
}

.trace-viewer__timeline-band[data-pattern-kind="no_progress"] {
  border-color: #f59e0b;
  background: #fef3c7;
}

.trace-viewer__timeline-band[data-pattern-kind="repeated_transition"] {
  border-color: #8b5cf6;
  background: #ede9fe;
}

.trace-viewer__timeline-band.is-active {
  box-shadow: 0 0 0 2px rgba(29, 103, 237, 0.22);
}
```

Inside `@media (max-width: 430px)` add:

```css
.trace-viewer__timeline-lane {
  grid-template-columns: 1fr;
  gap: 3px;
}
```

Lane headings remain text, so pattern kinds are not encoded by color alone.

- [ ] **Step 6: Run all Side Panel navigation tests and typecheck**

```bash
npx vitest run \
  tests/sidepanel/behavioral-navigation.test.ts \
  tests/sidepanel/behavioral-signals.test.ts \
  tests/sidepanel/behavioral-timeline.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  src/sidepanel/components/TraceVisualizer.ts \
  src/sidepanel/styles.css \
  tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: integrate behavioral trace timeline"
```

---

### Task 5: Synchronize Documentation and Run Full Regression Gates

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`

**Interfaces:**
- Consumes: completed Side Panel behavior from Tasks 1-4.
- Produces: public documentation that advertises navigation and timeline only, not future folding/failure-first features.

- [ ] **Step 1: Update the English architecture pipeline and feature list**

In `README.md`, replace:

```text
RuntimeMutation + BehavioralPattern
                ↓
Visual interpretation + Behavioral Signals
                ↓
Chrome Side Panel visualization
```

with:

```text
RuntimeMutation + BehavioralPattern
                ↓
Visual interpretation + Behavioral Evidence Navigation
                ↓
Behavioral Timeline + Chrome Side Panel visualization
```

Replace the behavioral feature bullet with:

```markdown
- factual behavioral signals for repeated observable state, no observable progress at a repeated execution anchor, and repeated execution/mutation motifs, with direct first/previous/next/last evidence navigation;
- a behavioral trace timeline with raw scrubbing and compact evidence-span bands while preserving raw Previous/Next/Play navigation;
```

Keep the Important Boundaries wording that Behavioral Signals do not diagnose an infinite loop, correctness failure, bug, or fix.

Append:

```markdown
- [Behavioral Trace Navigation Design Spec](docs/superpowers/specs/2026-09-08-behavioral-trace-navigation-design.md)
- [Behavioral Trace Navigation Implementation Plan](docs/superpowers/plans/2026-09-08-behavioral-trace-navigation-implementation-plan.md)
```

- [ ] **Step 2: Update the Traditional Chinese README with equivalent scope**

In `README.zh-TW.md`, replace:

```text
RuntimeMutation + BehavioralPattern
                    ↓
Visual interpretation + Behavioral Signals
                    ↓
Chrome Side Panel 視覺化
```

with:

```text
RuntimeMutation + BehavioralPattern
                    ↓
Visual interpretation + Behavioral Evidence Navigation
                    ↓
Behavioral Timeline + Chrome Side Panel 視覺化
```

Replace the behavioral feature bullet with:

```markdown
- 基於事實的 behavioral signals：重複可觀察狀態、同一 execution anchor 沒有可觀察進展，以及重複 execution / mutation motif，並可直接在 first／previous／next／last evidence 之間導航；
- behavioral trace timeline，支援 raw trace scrub 與 compact evidence-span bands，同時保留原本的 Previous／Next／Play raw navigation；
```

Append:

```markdown
- [Behavioral Trace Navigation Design Spec](docs/superpowers/specs/2026-09-08-behavioral-trace-navigation-design.md)
- [Behavioral Trace Navigation Implementation Plan](docs/superpowers/plans/2026-09-08-behavioral-trace-navigation-implementation-plan.md)
```

Do not mention trace folding, automatic failure-first entry, Tree, Graph, or DP as implemented.

- [ ] **Step 3: Run focused Side Panel tests**

```bash
npx vitest run \
  tests/sidepanel/behavioral-navigation.test.ts \
  tests/sidepanel/behavioral-signals.test.ts \
  tests/sidepanel/behavioral-timeline.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the complete repository validation gates**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 5: Perform the required wording regression scan**

Run:

```bash
grep -RniE "infinite loop detected|LeetCode TLE|root cause|go to bug|problem step|fix this" \
  src/sidepanel README.md README.zh-TW.md || true
```

Expected: no new diagnostic/fix claims from this milestone. Existing explanatory boundary text is acceptable only when it explicitly says those claims are not made.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: document behavioral trace navigation"
```

---

## Final Verification Checklist

Before declaring the milestone complete, verify all of these against the approved spec:

- [ ] `BehavioralPattern` and analyzer contracts are unchanged.
- [ ] Non-contiguous `TraceEvent.step` values resolve through an explicit map.
- [ ] Missing evidence cannot crash navigation.
- [ ] First / Previous / Next / Last navigate exact valid evidence points and do not wrap.
- [ ] Active signal/band state means exact evidence membership.
- [ ] Timeline bands render first-valid -> last-valid evidence overview spans only.
- [ ] Raw range scrubbing works even when no behavioral patterns exist.
- [ ] No invalid range renders for an empty trace.
- [ ] Signal buttons, range input, and bands are keyboard-operable native controls.
- [ ] All new navigation routes through `TraceVisualizer.setStep(index)`.
- [ ] Direct behavioral/timeline navigation stops autoplay.
- [ ] Previous / Next / Play continue to work.
- [ ] List / Dict / Linked List / What Changed / Locals / Call Stack / Output stay synchronized after jumps.
- [ ] Timeout, trace-limit, and exception prefixes remain navigable and factual.
- [ ] No trace folding, failure-first ranking, Tree, Graph, DP, diagnosis, causal claims, or fix suggestions were added.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.

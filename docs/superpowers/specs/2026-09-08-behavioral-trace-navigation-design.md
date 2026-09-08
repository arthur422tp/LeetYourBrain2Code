# Behavioral Trace Navigation

## Design Spec v0.1

---

# 1. Goal

LeetYourBrain2Code now has a deterministic behavioral-analysis layer that can identify factual repetition in a captured execution trace:

```text
TraceEvent[]
    ↓
RuntimeState[]
    ↓
FrameDiff[] + ObjectDiff[]
    ↓
RuntimeMutationBatch[]
    ↓
BehavioralObservation[]
    ↓
BehavioralPattern[]
```

The current Side Panel renders those patterns as passive `Behavioral Signals`, while trace navigation remains raw `Previous / Next / Play` stepping.

This milestone turns behavioral evidence into a navigation primitive.

The user should be able to answer:

> Where in the captured trace did this repeated behavior occur, and how can I move directly between its evidence points?

The target product flow becomes:

```text
BehavioralPattern
    ↓
Behavioral Signals
    ├── first evidence
    ├── previous evidence
    ├── next evidence
    └── last evidence
    ↓
Behavioral Timeline
    ├── raw trace position
    └── behavioral evidence regions
    ↓
Existing TraceVisualizer step state
```

This is a UI/navigation milestone. It does not change behavioral detection semantics and does not diagnose bugs.

---

# 2. Product Principle

The project keeps the existing evidence boundary:

> Visualize what the program actually did, and describe only behavior supported by captured runtime evidence.

This milestone adds a navigation rule:

> Behavioral evidence may guide the user to relevant captured steps, but must not silently reinterpret those steps as the cause of a failure.

Therefore the UI may say:

```text
No observable progress · 8 revisits
Steps 31–62

[First evidence] [Previous] [Next] [Last evidence]
```

and may visually mark steps `31–62` on a timeline.

It must not say:

```text
This is the bug.
```

or:

```text
Line 8 caused the timeout.
```

or automatically skip all other trace steps.

Raw trace navigation remains authoritative and always available.

---

# 3. Why This Layer Now

The behavioral foundation already provides the data needed for navigation:

```ts
interface BehavioralPatternBase {
  patternId: string;
  startStep: number;
  endStep: number;
  repeatCount: number;
  evidenceSteps: number[];
}
```

`TraceVisualizer` already owns the current raw trace index and the single `setStep()` path that updates:

- active source line;
- visual state;
- `What Changed`;
- `Behavioral Signals`;
- locals;
- call stack;
- stdout/exception;
- Previous / Next / Play controls.

The correct next step is therefore not a new analyzer. It is a controlled bridge from behavioral evidence back into the existing `setStep()` state transition.

No behavioral component should independently mutate visual state.

---

# 4. Scope

This spec includes:

1. evidence-step-to-trace-index resolution;
2. first/previous/next/last behavioral evidence navigation;
3. behavioral navigation controls inside each signal row;
4. current-step-aware enable/disable state for those controls;
5. a behavioral timeline showing the current raw trace position;
6. timeline bands for behavioral evidence spans;
7. direct navigation from a timeline pattern band to its first evidence step;
8. raw timeline scrubbing across captured trace steps;
9. current-step highlighting for behavioral patterns whose evidence includes the current step;
10. preserving `Previous`, `Next`, and `Play` semantics;
11. handling stale or invalid evidence steps defensively;
12. accessibility labels and keyboard-operable controls;
13. focused unit/UI tests;
14. README architecture wording synchronization after implementation.

---

# 5. Explicit Non-Goals

This milestone does **not** implement:

- trace folding;
- trace compression;
- hiding repeated raw steps;
- automatic skipping over repeated regions;
- failure-first initial positioning;
- automatic selection of a "most relevant" pattern;
- infinite-loop diagnosis;
- TLE diagnosis;
- WA/correctness diagnosis;
- causal source-line attribution;
- code fixes or solution suggestions;
- hot-line scoring;
- profiling;
- complexity analysis;
- cross-execution comparison;
- revision-to-revision behavioral diff;
- Tree visualization;
- Graph visualization;
- DP-table visualization;
- analyzer changes solely for UI convenience;
- persistence or backend storage.

A later trace-folding milestone may consume the same behavioral navigation model, but folded playback is intentionally excluded here.

---

# 6. Existing Baseline

The relevant existing interfaces are:

```ts
export interface BehavioralPatternBase {
  patternId: string;
  startStep: number;
  endStep: number;
  repeatCount: number;
  evidenceSteps: number[];
}

export interface BehavioralAnalysis {
  patterns: BehavioralPattern[];
  stepAnnotations: BehavioralStepAnnotation[];
}
```

and:

```ts
export interface TraceVisualizerHandle {
  element: HTMLElement;
  setStep(index: number): void;
  dispose(): void;
}
```

`TraceVisualizer` currently stores:

```ts
let currentIndex = 0;
```

and uses:

```ts
const setStep = (requestedIndex: number): void => {
  // clamp raw index
  // update all panels
};
```

This milestone must preserve `setStep()` as the single state-transition boundary.

---

# 7. Architectural Decision: Do Not Change the Behavioral Analyzer Contract

`BehavioralPattern` already contains sufficient navigation evidence.

The UI must consume:

```text
pattern.startStep
pattern.endStep
pattern.evidenceSteps
```

without adding UI-oriented fields such as:

```text
firstEvidenceIndex
nextEvidenceIndex
selected
color
lane
```

to `src/core/behavioral-pattern.ts`.

Those concepts belong to Side Panel presentation/navigation.

The core behavioral layer remains renderer-neutral.

---

# 8. Trace Step Identity vs Array Index

The Side Panel must not assume:

```text
trace array index = event.step - 1
```

Even though current traces are normally contiguous, `TraceEvent.step` is the evidence identity exposed by behavioral analysis, while `TraceVisualizer.setStep()` accepts an array index.

The navigation layer therefore builds an explicit lookup:

```ts
Map<number, number> // trace step -> visual-state/event array index
```

Conceptually:

```ts
export interface TraceStepIndex {
  stepToIndex: ReadonlyMap<number, number>;
  indexToStep: readonly number[];
}
```

Construction rules:

1. derive entries from the interpreted trace/raw events in display order;
2. first occurrence wins if duplicate step ids are ever encountered;
3. invalid/nonexistent behavioral evidence steps are ignored by navigation;
4. no navigation action may throw because a pattern references a missing step.

This keeps behavioral evidence factual while making the UI robust to malformed or future trace prefixes.

---

# 9. Behavioral Navigation Model

Create one pure Side Panel navigation unit, separate from DOM rendering.

Recommended file:

```text
src/sidepanel/behavioral-navigation.ts
```

Conceptually:

```ts
export interface ResolvedBehavioralEvidence {
  patternId: string;
  evidenceSteps: number[];
  evidenceIndexes: number[];
  firstIndex: number | null;
  lastIndex: number | null;
}
```

Required helpers should cover:

```ts
buildTraceStepIndex(...)
resolveBehavioralEvidence(...)
previousEvidenceIndex(...)
nextEvidenceIndex(...)
```

Exact exported names may be adjusted during implementation, but responsibilities must remain separate from DOM code.

## 9.1 Evidence normalization

For one pattern:

1. map each `evidenceStep` through `stepToIndex`;
2. discard unresolved steps;
3. deduplicate by resolved index;
4. sort by raw trace index ascending.

The original `BehavioralPattern` is never mutated.

## 9.2 Previous evidence

Given current raw index `i`, previous evidence means:

```text
max { e | e < i }
```

If none exists, the control is disabled.

Do not wrap to the last occurrence.

## 9.3 Next evidence

Given current raw index `i`, next evidence means:

```text
min { e | e > i }
```

If none exists, the control is disabled.

Do not wrap to the first occurrence.

## 9.4 First/last evidence

First and last controls resolve directly to the smallest/largest valid evidence index.

If no valid evidence remains after resolution, all behavioral navigation controls for that pattern are disabled.

---

# 10. Behavioral Signals Interaction

`BehavioralSignals.ts` currently renders static pattern rows.

The component should become callback-driven rather than importing or owning `TraceVisualizer` state.

Conceptually:

```ts
interface BehavioralSignalsOptions {
  analysis: BehavioralAnalysis;
  currentStep: number | null;
  currentIndex: number;
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>;
  onNavigate(index: number): void;
}
```

The exact signature may use individual arguments, but the direction of dependency is fixed:

```text
TraceVisualizer
    owns currentIndex + setStep()
        ↓
BehavioralSignals
    emits navigation intent
        ↓
TraceVisualizer.setStep(index)
```

`BehavioralSignals` must not maintain an independent step cursor.

---

# 11. Signal Row UX

Each pattern row keeps its factual title/detail and adds a compact evidence-navigation area.

Example:

```text
┌──────────────────────────────────────────┐
│ No observable progress · 7 revisits     │
│ solve · line 8                           │
│ Evidence: steps 31–59 · 8 observations  │
│                                          │
│ [First] [Previous] [Next] [Last]         │
└──────────────────────────────────────────┘
```

For a repeated transition:

```text
┌──────────────────────────────────────────┐
│ Repeated transition motif × 12           │
│ 4-step pattern across steps 25–72        │
│ Evidence: 48 captured steps              │
│                                          │
│ [First] [Previous] [Next] [Last]         │
└──────────────────────────────────────────┘
```

Wording must remain evidence-oriented.

Avoid labels such as:

```text
Go to bug
Problem step
Root cause
Bad loop
```

---

# 12. Active Pattern Semantics

A pattern row is `is-active` when:

```ts
pattern.evidenceSteps.includes(currentStep)
```

subject to the current trace-step resolution.

This preserves the existing meaning: the current step itself is one of the pattern's evidence steps.

Do not broaden `is-active` merely because the current step lies numerically between `startStep` and `endStep`.

This distinction matters for repeated-state patterns where nonmatching states may occur between matching observations.

Timeline span rendering may still cover `startStep → endStep`; active row semantics remain evidence-membership based.

---

# 13. Behavioral Timeline

Add a dedicated component:

```text
src/sidepanel/components/BehavioralTimeline.ts
```

It has two responsibilities:

1. raw trace positioning/scrubbing;
2. compact behavioral evidence overview.

It does not render code, locals, mutations, or diagnostic text.

---

# 14. Timeline Layout

The first version uses one raw trace rail plus three behavioral lanes:

```text
Current trace
1 ───────────────────────●────────────────── 100

Repeated state      ─────[=======]────────────────
No progress         ─────────[==========]──────────
Repeated transition ──[===================]────────
```

The lanes correspond exactly to the current three pattern kinds:

```text
repeated_state
no_progress
repeated_transition
```

Do not create a generic plugin/lane registry in this milestone.

If a lane has no patterns, it may be omitted to reduce vertical space.

---

# 15. Raw Trace Rail

Use a native keyboard-operable range control for the raw trace position.

Conceptually:

```html
<input type="range" min="0" max="N-1" step="1">
```

Rules:

- `value = currentIndex`;
- `input` or `change` routes through `onNavigate(index)`;
- for zero captured steps, render a neutral empty state rather than an invalid range;
- for one captured step, the rail may render disabled;
- the rail does not replace Previous/Next controls.

The timeline should display a compact current position label such as:

```text
Step 36 / 170
```

using raw display order.

---

# 16. Behavioral Timeline Bands

Each behavioral pattern renders one compact band from its first valid evidence index to its last valid evidence index.

Position is normalized against trace length:

```text
left  = firstIndex / max(N - 1, 1)
right = lastIndex  / max(N - 1, 1)
```

Implementation may convert this to percentage-based `left` and `width` CSS.

The band is an interactive button or otherwise keyboard-operable element.

Activating a band navigates to that pattern's first valid evidence index.

A band must expose an accessible label containing:

- pattern kind/title;
- evidence start/end display steps;
- repeat/evidence count where relevant.

Do not rely on color alone to distinguish pattern kind.

Text labels or lane headings must remain present.

---

# 17. Timeline Span Is an Overview, Not an Exact Evidence Mask

For compactness, the timeline band covers:

```text
first valid evidence → last valid evidence
```

It does **not** claim every intermediate trace step is evidence.

This is particularly important for `RepeatedStatePattern`.

The exact evidence set remains:

```text
pattern.evidenceSteps
```

and is used by:

```text
First / Previous / Next / Last evidence
```

The UI should use wording such as `evidence span` or rely on the visual band without saying every step inside the band matches.

---

# 18. Timeline Placement

Place the behavioral timeline near the existing raw playback controls, after the main visualization/inspection content and before or immediately adjacent to the `Previous / Next / Play` controls.

The intended reading order is:

```text
Trace summary
Code
Visual State
What Changed / Behavioral Signals / Locals
Call Stack / Output
Behavioral Timeline
Raw playback controls
```

Do not move the timeline above `Code` or `Visual State` in this milestone.

The timeline is navigation support, not the primary visualization.

---

# 19. Single Navigation State Owner

All navigation paths must converge on the same `TraceVisualizer.setStep()` logic:

```text
Previous ───────────────┐
Next ───────────────────┤
Play timer ─────────────┤
Timeline scrub ─────────┤
Timeline pattern band ──┤──→ setStep(index)
Signal First ───────────┤
Signal Previous ────────┤
Signal Next ────────────┤
Signal Last ────────────┘
```

This is a hard architecture constraint.

Do not duplicate panel-update logic inside timeline or signal components.

---

# 20. Playback Interaction

Behavioral navigation is a direct user navigation action.

When the user clicks:

- a behavioral evidence navigation button;
- a timeline pattern band;
- the timeline range control;

active autoplay should stop before/when moving to the requested step.

This prevents the UI from immediately advancing away from the evidence the user explicitly selected.

Existing Previous/Next behavior should also remain deterministic; implementation may preserve their current autoplay behavior if already defined, but behavioral direct navigation must stop playback.

---

# 21. Empty and Partial States

## 21.1 No trace events

Render:

```text
No execution steps were captured.
```

No interactive timeline is shown.

Behavioral Signals retains its existing neutral empty message.

## 21.2 Trace exists, no behavioral patterns

Render the raw trace rail so the user can scrub the trace.

Behavioral lanes show a concise neutral state such as:

```text
No repeated behavioral regions in the captured trace.
```

Do not hide raw timeline navigation merely because no pattern exists.

## 21.3 Pattern with partially unresolved evidence

Use all valid resolved evidence points.

Do not surface an error unless all evidence is unresolved.

If all evidence is unresolved, keep the signal factual text but disable its navigation controls and omit its timeline band.

## 21.4 Timeout / trace-limit / exception prefix

Timeline and behavioral navigation operate on the captured prefix exactly like completed traces.

Do not relabel a timeout prefix as LeetCode TLE.

---

# 22. Defensive Validation

The navigation layer is presentation safety, not a second behavioral analyzer.

It may validate structural assumptions:

- evidence step exists in the current trace;
- index is finite/integer/in range;
- duplicate evidence steps are deduplicated;
- first index <= last index.

It must not independently decide whether a behavioral pattern is semantically valid.

That remains the responsibility of `behavioral-analyzer.ts`.

---

# 23. Accessibility

All new controls must be keyboard operable.

Required semantics:

- native `<button>` for evidence navigation;
- native range input for raw timeline position;
- keyboard-operable pattern bands, preferably `<button>` elements positioned on the lane;
- `aria-label` on icon/compact controls if visible text is insufficient;
- disabled state via native `disabled` where applicable;
- active current evidence should not be communicated only through color;
- lane headings remain text.

No custom drag-only timeline interaction is required.

---

# 24. Styling Constraints

Use the existing Side Panel visual language and `trace-viewer__*` class namespace.

Recommended class family:

```text
trace-viewer__behavioral-nav
trace-viewer__behavioral-nav-meta
trace-viewer__behavioral-nav-actions
trace-viewer__timeline
trace-viewer__timeline-header
trace-viewer__timeline-range
trace-viewer__timeline-lanes
trace-viewer__timeline-lane
trace-viewer__timeline-band
trace-viewer__timeline-current
```

Exact class names may change during implementation, but avoid adding a new styling system or dependency.

Do not introduce chart libraries.

---

# 25. Component Boundaries

Recommended responsibility split:

```text
src/sidepanel/behavioral-navigation.ts
    pure step/index resolution + previous/next helpers

src/sidepanel/components/BehavioralSignals.ts
    factual pattern rows + navigation intent buttons

src/sidepanel/components/BehavioralTimeline.ts
    raw range + behavioral lanes/bands

src/sidepanel/components/TraceVisualizer.ts
    owns currentIndex, autoplay lifecycle, setStep(), wiring

src/sidepanel/styles.css
    presentation only
```

No component should import the Pyodide worker, execution scheduler, or LeetCode integration layer.

---

# 26. Proposed Data Flow

At trace-view creation:

```text
TraceSession.events
    ↓
interpretTrace()
    ├── visualStates[]
    └── behavioralAnalysis

TraceSession.events / visualStates
    ↓
buildTraceStepIndex()

behavioralAnalysis.patterns
    + TraceStepIndex
    ↓
ResolvedBehavioralEvidence[]
```

At every `setStep(index)`:

```text
currentIndex
    ↓
current VisualState / TraceEvent
    ↓
Code + Visual State + What Changed + Locals + Call Stack + Output
    ↓
Behavioral Signals(currentIndex/currentStep)
    ↓
Behavioral Timeline(currentIndex)
```

All child navigation callbacks return an index to `TraceVisualizer`.

---

# 27. Testing Strategy

## 27.1 Pure navigation tests

Create:

```text
tests/sidepanel/behavioral-navigation.test.ts
```

Cover at least:

1. trace step ids map explicitly to raw indexes;
2. non-contiguous step ids do not use `step - 1` assumptions;
3. missing evidence steps are ignored;
4. duplicate evidence resolves once;
5. previous evidence chooses the largest evidence index `< current`;
6. next evidence chooses the smallest evidence index `> current`;
7. previous/next do not wrap;
8. first/last are correct;
9. empty valid evidence produces null/disabled navigation.

## 27.2 Behavioral Signals tests

Extend/create:

```text
tests/sidepanel/behavioral-signals.test.ts
```

Cover:

1. each pattern renders evidence-navigation controls;
2. clicking First emits first evidence index;
3. Previous/Next disabled state follows current index;
4. clicking Next emits the next exact evidence index, not `current + 1`;
5. Last emits last evidence index;
6. active styling remains exact evidence-membership based;
7. unresolved evidence disables navigation without removing factual pattern text.

## 27.3 Behavioral Timeline tests

Create:

```text
tests/sidepanel/behavioral-timeline.test.ts
```

Cover:

1. raw range renders for a non-empty trace;
2. range value follows current index;
3. changing range emits requested raw index;
4. one lane/band renders for each pattern kind present;
5. band span derives from first/last valid evidence indexes;
6. activating a band emits first evidence index;
7. no-pattern trace still renders raw scrub control;
8. empty trace renders no invalid range;
9. pattern bands have accessible labels.

## 27.4 TraceVisualizer integration tests

Extend:

```text
tests/sidepanel/trace-visualizer.test.ts
```

Cover:

1. clicking `Next evidence` changes the same step label/source line/visual state as raw `setStep()`;
2. behavioral navigation updates `What Changed`, Locals, Call Stack, and Output through the existing path;
3. timeline scrub changes the raw trace step;
4. pattern-band navigation jumps to first evidence;
5. direct behavioral navigation stops autoplay;
6. Previous/Next raw controls continue to work;
7. hard-timeout trace prefix remains navigable without TLE wording;
8. non-behavioral traces remain fully usable.

---

# 28. Compatibility Requirements

Implementation must preserve:

- live LeetCode editor synchronization;
- active-tab ownership;
- latest-wins execution scheduling;
- Pyodide worker isolation;
- trace capture limits;
- RuntimeState reconstruction;
- FrameDiff/ObjectDiff;
- RuntimeMutation semantics;
- List visualization;
- Dict visualization;
- Linked List visualization;
- visual candidate ranking;
- `What Changed`;
- BehavioralPattern detection semantics;
- Locals;
- Call Stack;
- stdout/exception rendering;
- raw event debug details;
- Previous/Next/Play controls;
- completed, exception, trace-limit, and timeout-prefix rendering.

No existing trace schema version change is required.

---

# 29. Performance Boundaries

Timeline/navigation work must be bounded by existing trace/pattern sizes.

Rules:

1. build step-index lookup once per `TraceVisualizer` instance;
2. resolve each pattern's evidence once at initialization where practical;
3. do not scan the entire trace on every button click;
4. previous/next may use a small binary search or pre-resolved array scan; because pattern counts are already bounded, either is acceptable if deterministic;
5. render one timeline band per behavioral pattern, not one DOM node per evidence step;
6. do not add canvas/chart dependencies.

This avoids turning long repeated traces into thousands of timeline marker elements.

---

# 30. README Update After Implementation

After implementation, update English and Traditional Chinese README wording to reflect that Behavioral Signals are navigable evidence rather than passive summaries.

Suggested architecture description:

```text
RuntimeMutation + BehavioralPattern
                    ↓
Visual interpretation + Behavioral Evidence Navigation
                    ↓
Behavioral Timeline + Chrome Side Panel visualization
```

Feature bullets should mention:

- direct navigation between repeated behavioral evidence points;
- a trace timeline that marks repeated behavioral spans;
- raw trace navigation remains available.

Do not advertise trace folding or failure-first navigation until those milestones exist.

---

# 31. Acceptance Criteria

This milestone is complete when all of the following are true:

1. A rendered behavioral signal can navigate to its first, previous, next, and last valid evidence occurrence.
2. Behavioral navigation goes through the same `TraceVisualizer.setStep()` path as raw navigation.
3. The Side Panel contains a raw trace timeline/scrubber for non-empty traces.
4. Behavioral patterns appear as compact timeline bands grouped by current pattern kind.
5. Clicking a timeline band navigates to the pattern's first valid evidence step.
6. Current pattern highlighting means exact evidence membership, not merely being inside the span.
7. Behavioral direct navigation stops active autoplay.
8. Missing/stale evidence steps cannot crash rendering or navigation.
9. No analyzer contract or trace schema change is required.
10. Existing List/Dict/Linked List, mutations, locals, call stack, output, timeout-prefix, and raw controls continue to work.
11. New controls are keyboard operable and have accessible labels.
12. No UI text claims infinite loop, LeetCode TLE, correctness failure, causal bug location, or a fix.
13. `npm test`, `npm run typecheck`, and `npm run build` pass.

---

# 32. Future Milestones Enabled by This Design

This milestone deliberately creates reusable navigation primitives for later work.

## 32.1 Trace Folding / Compression

A future folded view can replace a repeated span with a collapsed presentation while preserving raw steps underneath:

```text
Raw trace
    + BehavioralPattern
        ↓
Folded presentation
```

The evidence resolver created here can remain the bridge back to raw trace indexes.

## 32.2 Failure-First Entry Point

A later milestone may rank factual evidence near exception/timeout/trace-limit termination and offer:

```text
Inspect behavioral region
Start from beginning
```

That milestone must define relevance/ranking separately. This spec does not.

## 32.3 Revision-to-Revision Behavioral Diff

Future live-revision comparison can align behavioral regions across executions, but it will require a new cross-execution semantic-location contract. Session-local `frameId` identity remains unchanged here.

---

# 33. Final Architecture After This Milestone

```text
LeetCode live editor + testcase
            ↓
Execution scheduler
            ↓
Pyodide worker
            ↓
TraceEvent[]
            ↓
RuntimeState[]
            ↓
FrameDiff[] + ObjectDiff[]
            ↓
RuntimeMutationBatch[]
            ↓
BehavioralObservation[]
            ↓
BehavioralPattern[]
            ↓
┌───────────────────────────────┐
│ Behavioral navigation model   │
│ step id ↔ raw trace index     │
└───────────────────────────────┘
            ↓
┌────────────────────────────────────────────┐
│ TraceVisualizer                            │
│ single currentIndex + setStep() owner      │
├────────────────────────────────────────────┤
│ Visual State                               │
│ What Changed                               │
│ Behavioral Signals + evidence navigation  │
│ Locals / Call Stack / Output               │
│ Behavioral Timeline + raw scrub            │
│ Previous / Next / Play                     │
└────────────────────────────────────────────┘
```

The important boundary remains:

```text
Behavioral analysis
    = factual repeated execution evidence

Behavioral navigation
    = efficient movement through that evidence

Future diagnostics
    = separate layer, not implemented here
```

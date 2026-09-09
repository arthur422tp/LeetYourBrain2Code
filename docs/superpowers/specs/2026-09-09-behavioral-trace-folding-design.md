# Behavioral Trace Folding

## Design Spec v0.1

---

# 1. Goal

LeetYourBrain2Code now has three layers of factual execution evidence in the Side Panel:

```text
Raw TraceEvent[]
    ↓
RuntimeState / RuntimeMutation
    ↓
BehavioralPattern[]
    ↓
Behavioral Evidence Navigation
    ↓
Behavioral Timeline
```

The remaining usability problem is long traces with a repeated transition motif. The system can identify the repeated behavior and navigate to its evidence, but the user still has to reason about the trace as a long sequence of raw steps.

This milestone adds a deterministic folded presentation over the raw trace.

The user should be able to see:

```text
Steps 1–20

▶ Repeated 4-step behavior × 12
  Captured steps 21–68

Steps 69–70
```

and expand the repeated region into iteration boundaries without deleting, rewriting, or renumbering any raw step.

The core rule is:

```text
Folded Trace = presentation projection of Raw Trace + validated repeated-transition evidence
```

not:

```text
Folded Trace = replacement trace
```

---

# 2. Product Principle

The project keeps its existing evidence boundary:

> Visualize what the program actually did, and describe only behavior supported by captured runtime evidence.

Trace folding adds one presentation rule:

> A repeated-transition pattern may compress how a contiguous captured region is presented, but must never alter the authoritative raw execution sequence.

Therefore the UI may say:

```text
Repeated 4-step behavior × 12
Captured steps 21–68
```

It must not say:

```text
Infinite loop
Bad loop
Root cause
This caused the timeout
```

The user can always return to the same raw indexes with the existing Previous / Next / Play controls, timeline scrubber, Behavioral Signals, and Debug details.

---

# 3. Scope Decision

The first folding milestone supports **only**:

```ts
RepeatedTransitionPattern
```

It does not fold:

```ts
RepeatedStatePattern
NoProgressPattern
```

Reason:

- `RepeatedTransitionPattern.evidenceSteps` is emitted from one contiguous observation slice;
- `periodSteps` defines a repeatable motif width;
- `repeatCount` defines complete repeated motif occurrences;
- the pattern naturally partitions into iterations when its resolved evidence remains complete.

By contrast, a repeated-state span may contain intermediate states that are not evidence for the repeated state. Treating the entire span as a fold would risk hiding unrelated captured behavior.

This is a hard v0.1 boundary.

---

# 4. In Scope

This spec includes:

1. a pure folded-trace presentation model;
2. eligibility validation for repeated-transition folds;
3. exact partitioning of a valid repeated-transition region into motif iterations;
4. deterministic selection when repeated-transition candidates overlap;
5. raw-range segments filling every part of the trace not owned by a fold;
6. a new `Trace Outline` Side Panel component;
7. collapsed repeated-transition summary rows;
8. user-controlled expansion into iteration boundaries;
9. direct navigation from outline ranges/folds/iterations to raw indexes;
10. exact current-index highlighting in the outline;
11. preserving raw Previous / Next / Play behavior;
12. preserving Behavioral Signals and Behavioral Timeline behavior;
13. defensive behavior for stale or partially resolved behavioral evidence;
14. support for completed, exception, trace-limit, and timeout-prefix traces;
15. fixing same-lane timeline-band overlap by stacking colliding bands into deterministic subtracks;
16. focused pure-model, component, integration, and regression tests;
17. README synchronization after implementation.

---

# 5. Explicit Non-Goals

This milestone does **not** implement:

- folding `RepeatedStatePattern`;
- folding `NoProgressPattern`;
- automatic skipping in Previous / Next;
- folded autoplay;
- replacing the raw timeline scrubber with folded coordinates;
- changing `TraceVisualizer.setStep(index)` semantics;
- hiding raw Debug details;
- deleting raw events;
- changing trace schema;
- changing behavioral analyzer semantics;
- changing the definition of `RepeatedTransitionPattern`;
- failure-first initial positioning;
- behavioral relevance ranking for failures;
- infinite-loop diagnosis;
- LeetCode TLE diagnosis;
- correctness diagnosis;
- source-line causal attribution;
- fix suggestions;
- profiling or complexity analysis;
- cross-execution diff;
- Tree visualization;
- Graph visualization;
- DP-table visualization;
- persistent fold-open state across executions;
- a generic plugin architecture for future fold kinds.

---

# 6. Existing Baseline

The behavioral core currently exposes:

```ts
export interface RepeatedTransitionPattern extends BehavioralPatternBase {
  kind: "repeated_transition";
  periodSteps: number;
  motifKeys: string[];
}
```

with base fields:

```ts
interface BehavioralPatternBase {
  patternId: string;
  startStep: number;
  endStep: number;
  repeatCount: number;
  evidenceSteps: number[];
}
```

The Side Panel already resolves evidence identity to raw indexes through:

```ts
interface ResolvedBehavioralEvidence {
  patternId: string;
  evidenceSteps: number[];
  evidenceIndexes: number[];
  firstIndex: number | null;
  lastIndex: number | null;
}
```

The current navigation architecture is:

```text
Signals ───────────┐
Timeline scrub ────┤
Timeline bands ────┤──→ navigateDirect(index)
                   │       ↓
Previous / Next ───┤    setStep(index)
Play ──────────────┘
```

This milestone must preserve `setStep(index)` as the only raw trace state-transition owner.

---

# 7. Architectural Decision: Folding Is a Side Panel Projection

Do not add folding fields to:

```text
src/core/behavioral-pattern.ts
src/core/behavioral-analyzer.ts
src/core/trace-interpreter.ts
src/shared/trace-types.ts
```

The folding layer consumes already-derived evidence and creates presentation-only segments.

Recommended file:

```text
src/sidepanel/trace-folding.ts
```

Conceptually:

```ts
Raw Trace indexes
    +
RepeatedTransitionPattern[]
    +
ResolvedBehavioralEvidence
        ↓
TraceFoldModel
        ↓
Trace Outline UI
```

The core analyzer remains renderer-neutral and unaware of folding.

---

# 8. Fold Eligibility

A `RepeatedTransitionPattern` is foldable only when all of these are true after Side Panel evidence resolution:

1. `periodSteps` is a positive integer;
2. `repeatCount` is an integer >= 3;
3. `firstIndex` and `lastIndex` are both resolved;
4. every original `evidenceStep` resolves exactly once;
5. `evidenceIndexes.length === periodSteps * repeatCount`;
6. `evidenceIndexes` are strictly increasing;
7. `evidenceIndexes` cover one contiguous raw-index interval with no gaps;
8. the interval is within the current raw trace bounds.

The critical contiguity condition is:

```ts
for every offset k:
  evidenceIndexes[k] === firstIndex + k
```

This prevents the folded UI from hiding raw steps that were not part of the repeated-transition evidence.

If any condition fails, the pattern remains visible in Behavioral Signals/Timeline but is **not** used for trace folding.

The folding layer must not attempt to repair or reinterpret incomplete evidence.

---

# 9. Fold Iteration Semantics

For an eligible fold:

```text
evidence length = periodSteps × repeatCount
```

Partition the resolved evidence in display order into `repeatCount` chunks of exactly `periodSteps` raw indexes.

Example:

```text
periodSteps = 4
repeatCount = 3
evidenceIndexes = [20..31]
```

produces:

```text
Iteration 1 → raw indexes 20–23
Iteration 2 → raw indexes 24–27
Iteration 3 → raw indexes 28–31
```

The UI uses human-facing trace positions:

```text
Steps 21–24
Steps 25–28
Steps 29–32
```

Raw array indexes remain zero-based internally.

An iteration boundary is a presentation fact derived from `periodSteps`; it is not a claim about source-level loop iterations.

Use the word `iteration` only inside the folded repeated-pattern presentation, where it means one motif repetition. Do not claim it corresponds to a Python `for`/`while` iteration.

---

# 10. Folded Trace Model

Create a presentation model that fully partitions the raw trace.

Recommended interfaces:

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
```

Exact exported names may change during implementation, but these responsibilities must remain explicit.

---

# 11. Full Raw-Trace Coverage Invariant

`TraceFoldModel.segments` must partition every raw trace index exactly once.

For a trace of length `N`:

```text
union(segment indexes) = {0, 1, ..., N-1}
```

and:

```text
intersection(any two segment index sets) = empty
```

Segments are sorted by `startIndex`.

Adjacent raw indexes not owned by a fold are merged into one `raw_range` segment.

Example:

```text
Raw trace: 0..19
Fold owns: 5..12

segments:
raw_range 0..4
fold      5..12
raw_range 13..19
```

This invariant makes the outline a trustworthy projection rather than an arbitrary list of behavioral signals.

---

# 12. Overlapping Fold Candidates

Different `RepeatedTransitionPattern` instances may resolve to overlapping raw-index intervals. A raw index cannot belong to two folded segments.

The folding layer must therefore choose one deterministic non-overlapping candidate set.

## 12.1 Selection objective

Choose the set of eligible, non-overlapping folds that maximizes total raw indexes covered by folds:

```text
maximize Σ (endIndex - startIndex + 1)
```

This is a presentation-compression objective only. It is not behavioral relevance ranking.

## 12.2 Deterministic tie-break

If multiple candidate sets cover the same number of raw indexes, prefer in order:

1. fewer fold segments;
2. the set whose sorted fold list has the earlier `startIndex` at the first difference;
3. then larger span at that difference;
4. then smaller `periodSteps`;
5. then lexicographically smaller `patternId`.

Because behavioral patterns are already bounded, a small weighted interval scheduling implementation is acceptable.

Do not make selection depend on DOM order, object insertion order, or color/lane layout.

---

# 13. Trace Outline Component

Add a dedicated Side Panel component:

```text
src/sidepanel/components/TraceOutline.ts
```

Responsibilities:

1. render `TraceFoldModel.segments` in raw execution order;
2. render raw ranges compactly;
3. render repeated-transition folds collapsed by default;
4. expand/collapse one fold without changing the raw trace step;
5. expose direct raw-index navigation intent;
6. highlight the segment containing the current raw index;
7. when expanded, highlight the motif iteration containing the current raw index.

It must not:

- call the behavioral analyzer;
- own the raw step cursor;
- own autoplay;
- call Pyodide;
- mutate the fold model.

---

# 14. Trace Outline UX

Default collapsed view:

```text
Trace Outline

Steps 1–20 · 20 raw steps                 [Inspect]

▶ Repeated 4-step behavior × 12            [Inspect first]
  Steps 21–68 · 48 captured steps

Steps 69–70 · 2 raw steps                  [Inspect]
```

Expanded repeated fold:

```text
▼ Repeated 4-step behavior × 12            [Inspect first]
  Steps 21–68 · 48 captured steps

  Motif repetition 1 · Steps 21–24         [Inspect]
  Motif repetition 2 · Steps 25–28         [Inspect]
  Motif repetition 3 · Steps 29–32         [Inspect]
  ...
  Motif repetition 12 · Steps 65–68        [Inspect]
```

Use `Motif repetition` rather than `Loop iteration` to avoid implying a source-code loop construct.

`Inspect` navigates to the first raw index of that range/repetition.

Expansion itself is presentation state and does not navigate.

---

# 15. Outline Expansion State

Fold expansion state is local to one mounted `TraceOutline` instance.

Recommended state:

```ts
Set<string> // expanded patternIds
```

Rules:

- folds start collapsed;
- toggling one fold does not affect others;
- navigating raw steps does not automatically expand a fold;
- expansion state survives raw step changes within the same trace view;
- a new execution/new `TraceVisualizer` instance resets all folds to collapsed;
- no `localStorage`, Chrome storage, or cross-session persistence.

---

# 16. Outline Current-Step Semantics

A segment is active when:

```text
startIndex <= currentIndex <= endIndex
```

This is safe because folded segments and raw-range segments are exact non-overlapping partitions of raw indexes.

For an expanded fold, exactly one motif repetition is active when the current raw index lies inside its exact iteration range.

This is different from Behavioral Signal active semantics:

```text
Behavioral Signal active = exact evidence membership
Trace Outline segment active = exact ownership of raw index in the fold partition
```

Both meanings are valid and must remain separate.

---

# 17. Single Raw Navigation Owner

All outline navigation actions converge on the existing direct navigation path:

```text
Raw range Inspect ───────┐
Fold Inspect first ──────┤
Motif repetition Inspect ┤
Signals navigation ──────┤
Timeline scrub/bands ────┤──→ navigateDirect(index)
                         │       ↓
                         │    stopPlaying()
                         │       ↓
                         └──→ setStep(index)
```

The outline must never call panel update functions directly.

Raw `Previous`, `Next`, and `Play` continue operating one raw step at a time.

This milestone does **not** redefine those controls in folded coordinates.

---

# 18. Why Raw Playback Is Not Folded Yet

Automatically making `Next` jump over folded spans would change the meaning of the project's primary debugger controls.

That would create two competing notions of `next step`:

```text
raw next step
folded next presentation segment
```

This milestone avoids that ambiguity.

The compressed outline is an overview/navigation surface; raw playback remains authoritative.

A later milestone could add explicit folded-navigation controls if there is a demonstrated need, but it must use different UI labels and semantics.

---

# 19. Empty and Partial States

## 19.1 No raw trace

Render:

```text
No execution steps were captured.
```

No folded controls are shown.

## 19.2 Raw trace with no eligible repeated-transition fold

Render one raw-range segment covering the entire captured trace:

```text
Steps 1–N · N raw steps
```

The Trace Outline remains useful as a compact entry point but makes no behavioral compression claim.

## 19.3 Repeated-transition pattern with stale/missing evidence

Do not fold it.

Behavioral Signals/Timeline may still render their existing defensive state. The Outline treats the corresponding raw region normally.

## 19.4 Timeout / trace-limit / exception prefix

Fold only evidence contained in the captured prefix.

The outline may show:

```text
Repeated 3-step behavior × 18
```

but must not say that the repeated behavior caused the termination.

---

# 20. Timeline Band Collision Fix

The current Behavioral Timeline places every pattern of the same kind at the same vertical position. Overlapping spans in one kind can visually cover each other.

This milestone fixes that presentation defect for **all existing pattern kinds**:

```text
repeated_state
no_progress
repeated_transition
```

The fix does not alter pattern semantics or folding eligibility.

---

# 21. Timeline Subtrack Layout

Within each pattern-kind lane, assign every valid band to the lowest-numbered subtrack that does not overlap an already assigned interval.

Intervals use resolved raw indexes:

```text
[firstIndex, lastIndex]
```

Two bands collide when their closed intervals intersect.

Example:

```text
Repeated state
track 0: [========]        [====]
track 1:      [=========]
```

Deterministic ordering before placement:

1. `firstIndex` ascending;
2. `lastIndex` ascending;
3. `patternId` ascending.

For each band in that order, choose the smallest track index whose previous `lastIndex < band.firstIndex`.

The lane height grows with the number of required subtracks.

This is interval packing for presentation only; it does not select or discard patterns.

---

# 22. Timeline Accessibility After Stacking

Stacking must preserve:

- native button semantics for bands;
- existing accessible labels;
- textual lane headings;
- exact active-band evidence membership;
- keyboard access to every band;
- no reliance on color alone.

DOM tab order should remain the deterministic pattern order, independent of visual subtrack index.

---

# 23. Component Boundaries

Recommended responsibility split:

```text
src/sidepanel/behavioral-navigation.ts
    existing step-id ↔ raw-index resolution

src/sidepanel/trace-folding.ts
    pure fold eligibility, candidate selection, segment partitioning

src/sidepanel/components/TraceOutline.ts
    folded/raw segment presentation + expansion + navigation intent

src/sidepanel/components/BehavioralTimeline.ts
    existing timeline + collision-safe subtrack layout

src/sidepanel/components/TraceVisualizer.ts
    currentIndex + autoplay + navigateDirect + setStep ownership

src/sidepanel/styles.css
    presentation only
```

Do not move fold logic into `TraceVisualizer.ts`.

---

# 24. Proposed Data Flow

At trace-view creation:

```text
TraceSession.events
    ↓
interpretTrace()
    ├── visualStates[]
    └── behavioralAnalysis

TraceSession.events
    ↓
buildTraceStepIndex()

behavioralAnalysis.patterns
    + TraceStepIndex
    ↓
ResolvedBehavioralEvidence map

RepeatedTransitionPattern[]
    + ResolvedBehavioralEvidence
    + raw trace length
    ↓
buildTraceFoldModel()
    ↓
TraceOutline
```

At every raw `setStep(index)`:

```text
currentIndex
    ├── Code / Visual State / What Changed
    ├── Behavioral Signals
    ├── Locals / Call Stack / Output
    ├── Trace Outline.setCurrentIndex(currentIndex)
    └── Behavioral Timeline.setCurrentIndex(currentIndex)
```

All direct navigation callbacks still return one raw index to `TraceVisualizer`.

---

# 25. Performance Boundaries

Current behavioral analysis is already bounded by:

```text
BEHAVIOR_WINDOW_STEPS = 256
MAX_PATTERNS_PER_TRACE = 64
```

Folding must remain bounded accordingly.

Rules:

1. resolve fold candidates once per `TraceVisualizer` instance;
2. build the fold model once per trace;
3. do not rebuild the full outline on every raw step;
4. `setCurrentIndex()` updates active classes only;
5. collapsed folds render one summary node each;
6. expanded folds render one row per motif repetition, not one row per raw step;
7. timeline collision layout is computed once per timeline instance;
8. do not add chart libraries or virtual-list dependencies in v0.1.

If expanded repetition count becomes a practical DOM problem later, virtualization is a separate optimization milestone.

---

# 26. Styling Constraints

Use the existing `trace-viewer__*` visual language.

Recommended class family:

```text
trace-viewer__outline
trace-viewer__outline-header
trace-viewer__outline-segments
trace-viewer__outline-segment
trace-viewer__outline-raw
trace-viewer__outline-fold
trace-viewer__outline-fold-toggle
trace-viewer__outline-meta
trace-viewer__outline-actions
trace-viewer__outline-iterations
trace-viewer__outline-iteration
trace-viewer__timeline-track-stack
trace-viewer__timeline-subtrack
```

Do not add a new component library or styling framework.

---

# 27. Accessibility

Required controls:

- native `<button>` for fold expand/collapse;
- `aria-expanded` on fold toggle;
- native `<button>` for all Inspect actions;
- readable labels that include raw display-step ranges;
- active segment conveyed with more than color alone, e.g. `aria-current="step"` or visible `Current` text;
- existing timeline buttons remain keyboard-operable after subtrack stacking;
- fold toggle and Inspect are separate actions so one button does not have two meanings.

---

# 28. Testing Strategy

## 28.1 Pure folding-model tests

Create:

```text
tests/sidepanel/trace-folding.test.ts
```

Cover at least:

1. only `RepeatedTransitionPattern` is considered foldable;
2. a complete contiguous repeated-transition evidence set folds;
3. missing evidence disables folding;
4. a gap in resolved raw indexes disables folding;
5. `evidenceIndexes.length !== periodSteps * repeatCount` disables folding;
6. iteration ranges partition the fold exactly by `periodSteps`;
7. one fold plus surrounding raw ranges partitions the full trace exactly once;
8. adjacent uncovered raw indexes merge into raw ranges;
9. overlapping candidates produce a deterministic non-overlapping optimal coverage set;
10. tie-breaking is stable;
11. zero-length trace produces an empty segment list;
12. no eligible patterns produces one full raw range.

## 28.2 Trace Outline tests

Create:

```text
tests/sidepanel/trace-outline.test.ts
```

Cover:

1. folds render collapsed by default;
2. collapsed summary contains period, repeat count, and display-step span;
3. expanding a fold renders exactly `repeatCount` motif repetition rows;
4. expansion does not call `onNavigate`;
5. raw-range Inspect emits its `startIndex`;
6. fold Inspect first emits fold `startIndex`;
7. motif repetition Inspect emits iteration `startIndex`;
8. `setCurrentIndex()` marks exactly one owning segment active;
9. expanded fold marks exactly one motif repetition active;
10. expansion state survives `setCurrentIndex()` calls;
11. empty trace is neutral and non-interactive;
12. accessibility attributes are present.

## 28.3 Behavioral Timeline collision tests

Extend:

```text
tests/sidepanel/behavioral-timeline.test.ts
```

Cover:

1. two overlapping patterns of one kind render on different subtracks;
2. non-overlapping patterns reuse the same lowest subtrack;
3. lane height/track count reflects required subtracks;
4. all pattern buttons remain present;
5. DOM/tab order remains deterministic;
6. active state remains exact evidence membership after stacking.

## 28.4 TraceVisualizer integration tests

Extend:

```text
tests/sidepanel/trace-visualizer.test.ts
```

Cover:

1. Trace Outline is mounted for a non-empty trace;
2. fold Inspect navigates through the existing `setStep()` path;
3. motif repetition Inspect updates Code, Visual State, What Changed, Locals, Call Stack, Output, Timeline, and raw step label together;
4. direct outline navigation stops autoplay;
5. fold expansion does not stop autoplay because it does not navigate;
6. raw Previous/Next still move exactly one raw step;
7. raw Play still advances raw steps;
8. no-fold trace remains fully usable;
9. timeout/trace-limit/exception prefixes can show folds without causal/TLE wording;
10. existing Behavioral Signals and Timeline navigation continue to work.

---

# 29. Compatibility Requirements

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
- Behavioral Signals navigation;
- Behavioral Timeline raw scrubbing and band navigation;
- Locals;
- Call Stack;
- stdout/exception rendering;
- raw event Debug details;
- Previous / Next / Play controls;
- completed, exception, trace-limit, and timeout-prefix rendering.

No trace schema version change is required.

---

# 30. README Update After Implementation

After implementation, update English and Traditional Chinese README wording to add:

- repeated-transition regions can be shown as a folded Trace Outline;
- folds expand into motif-repetition boundaries;
- raw trace navigation remains authoritative and available;
- timeline bands stack when same-kind spans overlap.

Do not advertise:

- folded Previous/Next;
- failure-first navigation;
- infinite-loop detection;
- automatic TLE diagnosis;
- Tree/Graph/DP support.

---

# 31. Acceptance Criteria

This milestone is complete when all of the following are true:

1. Only eligible `RepeatedTransitionPattern` evidence can become a fold.
2. A fold is created only when its resolved evidence covers one complete contiguous raw-index interval.
3. Fold iteration boundaries are derived exactly from `periodSteps` and `repeatCount`.
4. The fold model partitions every raw index exactly once into raw ranges or selected folds.
5. Overlapping fold candidates resolve to one deterministic non-overlapping set maximizing total folded raw coverage.
6. `Trace Outline` renders folds collapsed by default.
7. Users can expand a fold into motif-repetition ranges without changing the current raw step.
8. Users can navigate from raw ranges, folds, and motif repetitions to raw indexes.
9. All outline navigation goes through `navigateDirect()` → `stopPlaying()` → `setStep(index)`.
10. Raw Previous / Next / Play semantics remain unchanged.
11. Behavioral Signals and Behavioral Timeline semantics remain unchanged.
12. Missing/stale/incomplete repeated-transition evidence cannot cause raw steps to be hidden.
13. Same-kind overlapping timeline bands remain independently visible through collision-safe subtracks.
14. Timeline band keyboard/accessibility behavior is preserved.
15. Completed, exception, trace-limit, and timeout-prefix traces remain factual and navigable.
16. No UI text claims infinite loop, LeetCode TLE, correctness failure, causal bug location, or a fix.
17. No behavioral analyzer or trace schema change is required.
18. `npm test`, `npm run typecheck`, and `npm run build` pass.

---

# 32. Future Milestones Enabled by This Design

## 32.1 Failure-First Entry Point

A later layer may use termination type plus behavioral evidence to choose an initial inspection region:

```text
Captured trace
    + termination
    + behavioral evidence
        ↓
Failure-first inspection recommendation
```

That future milestone requires its own relevance model. Fold selection here is only a non-overlapping compression problem and must not be reused as a claim of failure relevance.

## 32.2 Fold-Aware Navigation

A future explicit control could navigate presentation segments rather than raw steps:

```text
Previous segment / Next segment
```

It must not silently replace the current raw `Previous / Next` controls.

## 32.3 Additional Fold Kinds

Future evidence types could gain folding only if they can prove an exact raw-index ownership interval without hiding unrelated evidence.

`RepeatedStatePattern` and `NoProgressPattern` are intentionally not assumed safe for that purpose in v0.1.

---

# 33. Final Architecture After This Milestone

```text
LeetCode live editor + testcase
            ↓
Execution scheduler
            ↓
Pyodide worker
            ↓
TraceEvent[]                         ← authoritative raw trace
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
Resolved behavioral evidence
            ↓
┌─────────────────────────────────────┐
│ Side Panel presentation models      │
│                                     │
│ Behavioral navigation               │
│ Behavioral timeline layout          │
│ Repeated-transition fold projection │
└─────────────────────────────────────┘
            ↓
┌────────────────────────────────────────────┐
│ TraceVisualizer                            │
│ single currentIndex + setStep() owner      │
├────────────────────────────────────────────┤
│ Code / Visual State / What Changed         │
│ Behavioral Signals                         │
│ Locals / Call Stack / Output               │
│ Trace Outline                              │
│ Behavioral Timeline                        │
│ Raw Previous / Next / Play                 │
└────────────────────────────────────────────┘
```

The boundary remains:

```text
Raw trace
    = authoritative execution evidence

Behavioral patterns
    = factual repeated execution evidence

Trace folding
    = deterministic presentation compression

Failure diagnosis
    = separate future layer
```

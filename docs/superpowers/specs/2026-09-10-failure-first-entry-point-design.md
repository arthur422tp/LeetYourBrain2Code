# Failure-First Entry Point — Design Spec v0.1

## 1. Goal

Add a deterministic `Start Here` entry point for captured executions that terminate abnormally and contain behavioral evidence near termination.

The feature does **not** diagnose the cause of failure. It only selects one already-observed behavioral pattern as the first inspection point.

Core invariant:

```text
Start Here = deterministic inspection priority over validated captured evidence
```

It is not root-cause detection, bug localization, failure attribution, correctness diagnosis, infinite-loop detection, or LeetCode TLE diagnosis. The raw trace remains authoritative.

---

## 2. Product Behavior

### 2.1 No automatic navigation

When an eligible recommendation exists, the Side Panel renders a `Start Here` card. The raw cursor is **not** moved automatically. The user must explicitly select `Inspect` before navigation occurs.

### 2.2 Eligible execution outcomes

Failure-First evaluation runs only for:

```text
exception
trace_limit
timeout
```

The selector returns `null` for:

```text
running
completed
parse_error
input_error
internal_error
```

The selector uses `TraceSession.status` rather than enumerating `terminationReason` values.

### 2.3 One recommendation only

v0.1 renders at most one `Start Here` entry. If no candidate satisfies validation and the terminal-window rule, the component is not rendered. Do not render a `No recommendation` placeholder.

---

## 3. Architecture

The feature introduces a pure selection layer between resolved behavioral evidence and presentation:

```text
TraceSession.events
        ↓
interpretTrace()
        ↓
BehavioralPattern[]
        ↓
resolveBehavioralEvidenceMap()
        ↓
ResolvedBehavioralEvidence
        ├──────────────→ Behavioral Signals
        ├──────────────→ Behavioral Timeline
        ├──────────────→ Trace Folding
        └──────────────→ Failure-First Selection
                              ↓
                           Start Here
                              ↓
                        navigateDirect()
                              ↓
                           setStep()
```

The behavioral analyzer remains unchanged. The selector consumes existing pattern/evidence contracts and does not mutate or reinterpret them.

Recommended files:

```text
src/sidepanel/failure-first-selection.ts
src/sidepanel/components/FailureFirstEntry.ts
```

Existing integration point:

```text
src/sidepanel/components/TraceVisualizer.ts
```

---

## 4. Failure-First Selection Model

The selection is a discriminated union so `FailureFirstEntry` can render factual pattern-specific copy without querying the analyzer or receiving a second pattern object.

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

The model deliberately excludes confidence, severity, root cause, bug score, failure probability, and diagnosis fields.

---

## 5. Candidate Validation

Failure-First is stricter than ordinary evidence navigation. A recommendation must be based on **complete resolved evidence**.

For each pattern, a candidate is valid only when all of the following are true:

1. execution status is `exception`, `trace_limit`, or `timeout`;
2. `rawTraceLength` is a positive integer;
3. `pattern.repeatCount` is an integer greater than or equal to the behavioral analyzer minimum (`3` in v0.1);
4. an evidence-map entry exists for the pattern;
5. `evidence.patternId === pattern.patternId`;
6. `firstIndex` and `lastIndex` are non-null integers;
7. every original `pattern.evidenceSteps` entry resolves exactly once;
8. resolved `evidenceSteps` preserve the same identities and order as `pattern.evidenceSteps`;
9. duplicate step identities are rejected;
10. `evidenceSteps.length === evidenceIndexes.length`;
11. resolved indexes are integers and strictly increasing;
12. all resolved indexes are within `0..rawTraceLength - 1`;
13. `firstIndex === evidenceIndexes[0]`;
14. `lastIndex === evidenceIndexes[evidenceIndexes.length - 1]`;
15. `distanceFromTermination <= FAILURE_FIRST_TERMINAL_WINDOW_STEPS`.

Invalid, stale, partial, duplicate-derived, reordered, or out-of-bounds evidence makes that candidate ineligible. Do not repair, interpolate, or guess missing evidence.

---

## 6. Terminal Proximity

Define:

```ts
const terminalIndex = rawTraceLength - 1;
const distanceFromTermination = terminalIndex - evidence.lastIndex;
```

For v0.1:

```ts
FAILURE_FIRST_TERMINAL_WINDOW_STEPS = 32;
```

A candidate is eligible only when `distanceFromTermination <= 32`. A nearest pattern farther than 32 captured raw steps from termination is not recommended.

---

## 7. Ranking

Among eligible candidates, choose exactly one using this deterministic ordering:

1. smaller `distanceFromTermination`;
2. larger evidence span (`evidenceEndIndex - evidenceStartIndex + 1`);
3. larger `repeatCount`;
4. lexicographically smaller `patternId`.

There is **no pattern-kind priority**. Do not encode `repeated_transition > no_progress > repeated_state` or any other semantic severity ordering.

The selected result copies only factual metadata needed by presentation: `periodSteps` for repeated transition and `revisitCount` for no progress.

---

## 8. Inspect Landing Semantics

Ranking endpoint and inspection landing point are deliberately separate.

### 8.1 `RepeatedTransitionPattern`

Navigate to the beginning of the **last complete motif repetition**. A transition candidate has additional fail-closed requirements:

- `periodSteps` is a positive integer;
- `repeatCount` is an integer greater than or equal to `3`;
- `evidenceIndexes.length === periodSteps * repeatCount`;
- resolved evidence indexes are contiguous: for every offset `k`, `evidenceIndexes[k] === firstIndex + k`;
- the final motif repetition fits entirely inside the resolved evidence.

Then:

```ts
inspectIndex = evidenceEndIndex - periodSteps + 1;
```

The calculated `inspectIndex` must equal the first raw index of the final `periodSteps`-wide chunk of `evidenceIndexes`.

Example:

```text
Repeated 4-step behavior × 12
Evidence: Steps 21–68
Execution termination: Step 70

Inspect → Step 65
```

These requirements make transition Failure-First eligibility at least as strict about evidence completeness as Trace Folding, while remaining independent of fold overlap selection.

### 8.2 `RepeatedStatePattern`

```ts
inspectIndex = evidenceEndIndex;
```

Sparse evidence is allowed if the common completeness and ordering requirements hold.

### 8.3 `NoProgressPattern`

```ts
inspectIndex = evidenceEndIndex;
```

Sparse evidence is allowed if the common completeness and ordering requirements hold.

### 8.4 Defensive fallback

If the required landing point cannot be established exactly, reject the candidate. Do not substitute another nearby raw index.

---

## 9. `Start Here` Component

Recommended interface:

```ts
export interface FailureFirstEntryOptions {
  selection: FailureFirstSelection;
  onNavigate(index: number): void;
}

export function createFailureFirstEntry(
  options: FailureFirstEntryOptions
): HTMLDivElement;
```

The component must not rank candidates, call the analyzer, resolve evidence, own the raw cursor/autoplay state, call Pyodide, mutate the selection, or look up the original `BehavioralPattern`. It renders the discriminated selection and emits a raw-index navigation intent.

---

## 10. UI Placement

Render `Start Here` immediately below the Trace summary and before the Code panel:

```text
Trace
trace_limit · 256 captured steps

Start Here
Repeated 4-step behavior × 18
Observed within 4 captured steps of execution termination.
Evidence: Steps 181–252
[Inspect]

Code
Visual State
What Changed
Behavioral Signals
...
```

The component is an entry point, not another inspector panel.

---

## 11. UI Copy

Copy must remain factual and observation-based.

Pattern titles:

```text
RepeatedTransition → Repeated {periodSteps}-step behavior × {repeatCount}
RepeatedState      → Repeated observable state × {repeatCount}
NoProgress         → No observable progress across {revisitCount} revisits
```

Supporting text:

```text
Observed within {distanceFromTermination} captured steps of execution termination.
Evidence: Steps {evidenceStartIndex + 1}–{evidenceEndIndex + 1}
```

For `distanceFromTermination === 0`, use the same numeric factual wording (`within 0 captured steps`) rather than inventing stronger semantics.

Forbidden wording includes `root cause`, `bug location`, `likely cause`, `failure source`, `problem detected`, `suspicious loop`, `infinite loop`, `caused timeout`, `caused failure`, and `likely failure`.

---

## 12. Navigation Contract

`Inspect` must reuse the existing direct-navigation path:

```text
FailureFirstEntry
      ↓
onNavigate(selection.inspectIndex)
      ↓
navigateDirect(index)
      ↓
stopPlaying()
      ↓
setStep(index)
```

Rendering `Start Here` does not move the current raw step. Clicking `Inspect` stops autoplay. `setStep()` remains the sole owner of synchronized raw-step state across Code, Visual State, What Changed, Behavioral Signals, Locals, Call Stack, Output, Trace Outline, and Behavioral Timeline.

Do not create a second cursor or Failure-First navigation mode.

---

## 13. TraceVisualizer Integration

During viewer creation, compute once:

```ts
const failureFirstSelection = selectFailureFirstEvidence(
  session.status,
  session.events.length,
  interpretation.behavioralAnalysis.patterns,
  evidenceByPatternId
);
```

Do not recompute it in `setStep()`.

After `navigateDirect` is available:

```ts
const failureFirstEntry = failureFirstSelection
  ? createFailureFirstEntry({
      selection: failureFirstSelection,
      onNavigate: navigateDirect
    })
  : null;
```

Insert the element after Trace summary and before Code. No new cursor ownership is introduced.

---

## 14. Relationship to Existing Behavioral Features

Behavioral Signals continue to list all supported patterns and expose exact evidence navigation. Behavioral Timeline continues to show all resolvable evidence bands. Trace Folding continues to fold only eligible contiguous `RepeatedTransitionPattern` regions.

Failure-First selection does not require the chosen pattern to be selected as a fold segment. Fold overlap resolution and Failure-First ranking are separate policies. `RepeatedStatePattern` and `NoProgressPattern` can be selected despite being non-foldable. `Inspect` does not automatically expand Trace Outline.

---

## 15. Empty and Partial States

```text
empty trace                         → selection = null
no behavioral patterns             → selection = null
all evidence farther than 32 steps → selection = null
partial/stale candidate            → reject that candidate; evaluate others
unsupported execution status       → selection = null
```

All are silent states; existing Trace UI remains unchanged.

---

## 16. Performance

The behavioral analyzer is already bounded to at most 64 patterns. Selection is therefore a small bounded operation, expected `O(P log P)` or simpler for `P <= MAX_PATTERNS_PER_TRACE`.

No extra trace replay, state reconstruction, per-step DOM rebuild, or Pyodide execution is introduced. Selection is computed once per `TraceVisualizer` instance.

---

## 17. Accessibility

- `Inspect` is a native `button` with `type="button"`.
- Its accessible name identifies the raw destination.
- Recommendation meaning does not depend on color.
- Evidence range and proximity are visible text.
- Rendering does not move keyboard focus automatically.
- Do not use alert/live-region roles.

---

## 18. Testing Strategy

### 18.1 Pure selector tests

Create `tests/sidepanel/failure-first-selection.test.ts` covering:

- unsupported statuses return `null`;
- `exception`, `trace_limit`, and `timeout` evaluate candidates;
- invalid `rawTraceLength` or `repeatCount` rejects selection;
- distance 32 is eligible and 33 is rejected;
- ranking: proximity → span → repeat count → pattern ID;
- ranking is independent of input order;
- partial, missing, duplicate, reordered, malformed-endpoint, or out-of-bounds evidence is rejected;
- empty trace/no patterns return `null`.

### 18.2 Landing and metadata tests

Verify:

```text
RepeatedTransition → final complete motif start + periodSteps copied
RepeatedState      → last evidence index
NoProgress         → last evidence index + revisitCount copied
```

For repeated transition also verify malformed `periodSteps`, length mismatch, gapped indexes, and incomplete final motif reject the candidate.

### 18.3 Component tests

Create `tests/sidepanel/failure-first-entry.test.ts` covering all three factual titles, proximity/range copy, exact `Inspect` destination, native/accessibly named button, no navigation on render, and absence of forbidden diagnostic wording.

### 18.4 TraceVisualizer integration tests

Extend `tests/sidepanel/trace-visualizer.test.ts` covering:

- timeout/trace_limit/exception + eligible evidence render `Start Here`;
- same evidence under `completed` does not;
- out-of-window evidence does not;
- render leaves initial cursor unchanged;
- `Inspect` stops autoplay and routes to the exact raw index;
- after navigation, step label, code line, visual state, mutations, locals, call stack, output, timeline, and Trace Outline remain synchronized;
- raw Previous/Next/Play semantics remain unchanged.

### 18.5 Full repository gates

```bash
npm test
npm run typecheck
npm run build
```

---

## 19. Explicit Non-Goals

v0.1 does not include automatic initial cursor movement, Start Here for `completed`, WA detection, LeetCode judge-result integration, pattern-kind severity ranking, confidence/probability scores, top-N recommendations, dismissal/pinning, persistence, automatic Trace Outline expansion, automatic scrolling to Behavioral Signals, root-cause analysis, causal attribution, infinite-loop diagnosis, local-timeout-to-LeetCode-TLE inference, correctness prediction, fix suggestions, new behavioral pattern kinds, behavioral analyzer changes, trace schema changes, Tree/Graph/DP visualization, or cross-execution behavioral diff.

---

## 20. Success Criteria

The milestone is complete when:

1. abnormal captured executions produce at most one deterministic validated selection;
2. only evidence within the final 32 captured raw steps is eligible;
3. ranking follows proximity → span → repeat count → pattern ID exactly;
4. transition selection requires complete contiguous evidence of exact `periodSteps × repeatCount` length and lands at the final motif start;
5. repeated-state/no-progress selection lands at the final evidence index;
6. the discriminated selection carries only factual pattern-specific metadata needed by UI;
7. malformed/partial/stale evidence fails closed;
8. `Start Here` renders only when a selection exists and does not auto-navigate;
9. `Inspect` reuses `navigateDirect → stopPlaying → setStep`;
10. existing raw navigation stays authoritative;
11. no diagnosis, causal claim, correctness claim, or LeetCode TLE claim is introduced;
12. focused tests and complete repository test/typecheck/build gates pass.

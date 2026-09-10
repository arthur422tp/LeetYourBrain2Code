# Failure-First Entry Point — Design Spec v0.1

## 1. Goal

Add a deterministic `Start Here` entry point for captured executions that terminate abnormally and contain behavioral evidence near termination.

The feature does **not** diagnose the cause of failure. It only selects one already-observed behavioral pattern as the first inspection point.

Core invariant:

```text
Start Here = deterministic inspection priority over validated captured evidence
```

It is not:

```text
root-cause detection
bug localization
failure attribution
correctness diagnosis
infinite-loop detection
LeetCode TLE diagnosis
```

The raw trace remains authoritative.

---

## 2. Product Behavior

### 2.1 No automatic navigation

When an eligible recommendation exists, the Side Panel renders a `Start Here` card.

The raw cursor is **not** moved automatically.

The user must explicitly select `Inspect` before navigation occurs.

This preserves the existing navigation contract and avoids presenting a recommendation as a hidden diagnosis.

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

The selector uses `TraceSession.status` for this decision rather than enumerating `terminationReason` values.

This keeps the policy stable if additional concrete termination reasons are later added under an existing status.

### 2.3 One recommendation only

v0.1 renders at most one `Start Here` entry.

If no candidate satisfies the validation and terminal-window rules, the component is not rendered at all.

Do not render a placeholder such as `No recommendation`.

---

## 3. Architecture

The feature introduces a new pure selection layer between resolved behavioral evidence and presentation.

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

The behavioral analyzer remains unchanged.

The selector consumes existing pattern and evidence contracts; it does not mutate or reinterpret them.

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

Recommended public contract:

```ts
export const FAILURE_FIRST_TERMINAL_WINDOW_STEPS = 32;

export interface FailureFirstSelection {
  patternId: string;
  kind: BehavioralPattern["kind"];
  inspectIndex: number;
  evidenceStartIndex: number;
  evidenceEndIndex: number;
  distanceFromTermination: number;
  repeatCount: number;
  reason: "nearest_terminal_evidence";
}

export function selectFailureFirstEvidence(
  status: TraceSessionStatus,
  rawTraceLength: number,
  patterns: readonly BehavioralPattern[],
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>
): FailureFirstSelection | null;
```

The model deliberately excludes:

```text
confidence
severity
rootCause
bugScore
failureProbability
diagnosis
```

No available evidence justifies those semantics.

---

## 5. Candidate Validation

Failure-First is stricter than ordinary evidence navigation.

Behavioral Signals may still expose whatever evidence can be safely resolved, but a `Start Here` recommendation must be based on **complete resolved evidence**.

For each pattern, a candidate is valid only when all of the following are true:

1. the execution status is one of `exception`, `trace_limit`, or `timeout`;
2. `rawTraceLength` is a positive integer;
3. the pattern has an entry in `evidenceByPatternId`;
4. `evidence.patternId === pattern.patternId`;
5. `firstIndex` and `lastIndex` are non-null integers;
6. every original `pattern.evidenceSteps` entry resolves exactly once;
7. resolved `evidenceSteps` preserve the same identities and order as `pattern.evidenceSteps`;
8. `evidenceSteps.length === evidenceIndexes.length`;
9. resolved indexes are integers and strictly increasing;
10. all resolved indexes are within `0..rawTraceLength - 1`;
11. `firstIndex === evidenceIndexes[0]`;
12. `lastIndex === evidenceIndexes[evidenceIndexes.length - 1]`;
13. `lastIndex <= rawTraceLength - 1`;
14. `distanceFromTermination <= FAILURE_FIRST_TERMINAL_WINDOW_STEPS`.

Duplicate step identities, stale mappings, partial resolution, malformed endpoints, out-of-bounds indexes, or reordered evidence make the candidate ineligible.

Failure mode:

```text
invalid candidate → ignore candidate
no valid candidates → return null
```

Do not repair, interpolate, or guess missing evidence.

---

## 6. Terminal Proximity

Define:

```ts
const terminalIndex = rawTraceLength - 1;
const distanceFromTermination = terminalIndex - evidence.lastIndex;
```

A candidate is eligible only when:

```ts
distanceFromTermination <= FAILURE_FIRST_TERMINAL_WINDOW_STEPS
```

For v0.1:

```ts
FAILURE_FIRST_TERMINAL_WINDOW_STEPS = 32
```

This fixed window is intentionally simple and explainable.

A pattern that is the nearest available pattern but more than 32 captured raw steps from termination is **not** recommended.

---

## 7. Ranking

Among eligible candidates, choose exactly one using the following deterministic ordering:

1. smaller `distanceFromTermination`;
2. larger evidence span;
3. larger `repeatCount`;
4. lexicographically smaller `patternId`.

Evidence span is:

```ts
const evidenceSpanLength = evidenceEndIndex - evidenceStartIndex + 1;
```

Pseudo-order:

```text
nearest termination
    ↓
longest evidence span
    ↓
higher repeat count
    ↓
stable pattern ID
```

There is **no pattern-kind priority**.

Do not define rules such as:

```text
repeated_transition > no_progress > repeated_state
```

Such a ranking would imply that one behavioral pattern kind is inherently more diagnostic than another.

---

## 8. Inspect Landing Semantics

The ranking endpoint and inspection landing point are deliberately separate.

### 8.1 `RepeatedTransitionPattern`

Navigate to the beginning of the **last complete motif repetition**.

Validation requirements:

- `periodSteps` is a positive integer;
- `repeatCount` is a valid positive integer consistent with the pattern;
- resolved evidence is complete;
- the final motif repetition fits entirely inside the resolved evidence;
- the calculated landing index is a member of the resolved evidence interval.

For complete contiguous transition evidence:

```ts
inspectIndex = evidenceEndIndex - periodSteps + 1;
```

Example:

```text
Repeated 4-step behavior × 12
Evidence: Steps 21–68
Execution termination: Step 70

Inspect → Step 65
```

This presents the final complete observed motif rather than landing at the motif tail.

### 8.2 `RepeatedStatePattern`

Navigate to the final resolved evidence index:

```ts
inspectIndex = evidenceEndIndex;
```

### 8.3 `NoProgressPattern`

Navigate to the final resolved evidence index:

```ts
inspectIndex = evidenceEndIndex;
```

### 8.4 Defensive fallback

If the required landing point cannot be established exactly, the candidate is rejected.

Do not substitute another nearby raw index.

---

## 9. `Start Here` Component

Recommended component:

```text
src/sidepanel/components/FailureFirstEntry.ts
```

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

The component must not:

- rank candidates;
- call the behavioral analyzer;
- resolve evidence;
- own the raw cursor;
- own autoplay state;
- call Pyodide;
- mutate the selection.

It only renders a validated selection and emits a raw-index navigation intent.

---

## 10. UI Placement

Render `Start Here` immediately below the Trace summary and before the Code panel.

Recommended hierarchy:

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

Recommended titles:

### Repeated transition

```text
Repeated 4-step behavior × 18
```

### Repeated state

```text
Repeated observable state × 7
```

### No progress

```text
No observable progress across 6 revisits
```

Recommended supporting text:

```text
Observed within 4 captured steps of execution termination.
Evidence: Steps 181–252
```

Forbidden wording includes:

```text
root cause
bug location
likely cause
failure source
problem detected
suspicious loop
infinite loop
caused timeout
caused failure
likely failure
```

The UI may describe the actual execution status elsewhere using existing Trace summary semantics, but the recommendation itself must not attribute causality.

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

Consequences:

- rendering `Start Here` does not move the current raw step;
- clicking `Inspect` stops autoplay;
- `setStep()` remains the sole owner of synchronized raw-step state;
- Code, Visual State, What Changed, Behavioral Signals, Locals, Call Stack, Output, Trace Outline, and Behavioral Timeline remain synchronized through the existing path.

Do not create a second cursor or a special Failure-First navigation mode.

---

## 13. TraceVisualizer Integration

`TraceVisualizer` already computes:

```text
interpretation.behavioralAnalysis.patterns
traceIndex
evidenceByPatternId
traceFoldModel
```

Add one more pure projection during viewer creation:

```ts
const failureFirstSelection = selectFailureFirstEvidence(
  session.status,
  session.events.length,
  interpretation.behavioralAnalysis.patterns,
  evidenceByPatternId
);
```

Compute this once per viewer.

Do not recompute it on every `setStep()` call.

After `navigateDirect` is available:

```ts
const failureFirstEntry = failureFirstSelection
  ? createFailureFirstEntry({
      selection: failureFirstSelection,
      onNavigate: navigateDirect
    })
  : null;
```

Insert it after the Trace summary and before Code.

No changes are required to `setStep()` beyond existing synchronized navigation behavior.

---

## 14. Relationship to Existing Behavioral Features

### Behavioral Signals

Continue to list all supported behavioral patterns and expose exact evidence navigation.

Failure-First does not replace or reorder this component.

### Behavioral Timeline

Continue to show all resolvable behavioral evidence bands.

Failure-First does not change timeline lane layout, active membership semantics, or raw scrub behavior.

### Trace Folding / Trace Outline

Continue to fold only eligible contiguous `RepeatedTransitionPattern` regions.

Failure-First selection does not require that the chosen pattern also be foldable.

For example, `RepeatedStatePattern` and `NoProgressPattern` may be selected by Failure-First even though they cannot create Trace Outline fold segments.

`Inspect` does not automatically expand a folded Trace Outline segment.

---

## 15. Empty and Partial States

### Empty trace

```text
rawTraceLength === 0
→ selection = null
→ no Start Here UI
```

### No behavioral patterns

```text
patterns.length === 0
→ selection = null
```

### No pattern in terminal window

```text
all candidate distances > 32
→ selection = null
```

### Partial or stale evidence

```text
candidate rejected
→ other candidates may still compete
→ if none remain, selection = null
```

### Unsupported execution status

```text
selection = null
```

All of these states are silent; existing Trace UI remains unchanged.

---

## 16. Performance

The current behavioral analyzer is already bounded to at most 64 patterns.

Failure-First selection therefore operates over a small bounded candidate set.

Expected complexity:

```text
O(P log P)
```

or simpler, where `P <= MAX_PATTERNS_PER_TRACE`.

No additional trace replay, state reconstruction, DOM rebuild per step, or Pyodide execution is introduced.

The selection is computed once per TraceVisualizer instance.

---

## 17. Accessibility

Requirements:

- `Inspect` must be a native `button`;
- button type must be `button`;
- accessible name must describe the destination sufficiently to distinguish it from other buttons;
- recommendation meaning must not depend on color;
- evidence range and proximity must be available as text;
- rendering the card must not move keyboard focus automatically.

The component should not use an alert/live-region role; it is not an urgent system notification.

---

## 18. Testing Strategy

### 18.1 Pure selector tests

Recommended file:

```text
tests/sidepanel/failure-first-selection.test.ts
```

Required coverage:

- `completed` returns `null`;
- `running` returns `null`;
- `parse_error`, `input_error`, and `internal_error` return `null`;
- `exception`, `trace_limit`, and `timeout` evaluate candidates;
- distance `32` is eligible;
- distance `33` is rejected;
- nearest termination wins;
- equal distance prefers larger evidence span;
- equal span prefers larger `repeatCount`;
- complete tie prefers lexicographically smaller `patternId`;
- ranking is independent of input order;
- partial evidence is rejected;
- missing evidence is rejected;
- duplicate evidence identity is rejected;
- reordered evidence is rejected;
- malformed endpoints are rejected;
- out-of-bounds indexes are rejected;
- empty trace returns `null`;
- no patterns returns `null`.

### 18.2 Landing tests

Verify independently:

```text
RepeatedTransition → last complete motif start
RepeatedState → last evidence index
NoProgress → last evidence index
```

Also verify malformed `periodSteps` or incomplete final motif rejects a repeated-transition candidate.

### 18.3 Component tests

Recommended file:

```text
tests/sidepanel/failure-first-entry.test.ts
```

Required coverage:

- renders `Start Here`;
- factual title per pattern kind;
- renders terminal proximity text;
- renders evidence range;
- `Inspect` emits exactly `selection.inspectIndex`;
- native button and accessible label;
- component does not navigate on render;
- forbidden diagnostic wording does not appear.

### 18.4 TraceVisualizer integration tests

Extend:

```text
tests/sidepanel/trace-visualizer.test.ts
```

Required coverage:

- `timeout` plus eligible evidence renders `Start Here`;
- `trace_limit` plus eligible evidence renders `Start Here`;
- `exception` plus eligible evidence renders `Start Here`;
- identical evidence under `completed` does not render it;
- evidence outside the terminal window does not render it;
- initial raw cursor remains unchanged when the card renders;
- `Inspect` routes through direct navigation and stops autoplay;
- after `Inspect`, step label, active code line, visual state, mutations, locals, call stack, output, timeline, and Trace Outline active state remain synchronized;
- raw Previous/Next/Play semantics remain unchanged.

### 18.5 Full repository gates

Run:

```bash
npm test
npm run typecheck
npm run build
```

---

## 19. Explicit Non-Goals

v0.1 does not include:

- automatic initial cursor movement;
- Start Here for normal `completed` executions;
- WA detection;
- LeetCode judge-result integration;
- pattern-kind severity ranking;
- confidence or probability scores;
- multiple recommendations / top-N ranking;
- recommendation dismissal or pinning;
- persistent recommendation state;
- automatic Trace Outline expansion;
- automatic scrolling to Behavioral Signals;
- root-cause analysis;
- causal failure attribution;
- infinite-loop diagnosis;
- local timeout → LeetCode TLE inference;
- correctness prediction;
- fix suggestions;
- new behavioral pattern kinds;
- behavioral analyzer changes;
- trace schema changes;
- Tree/Graph/DP visualization;
- cross-execution behavioral diff.

---

## 20. Success Criteria

The milestone is complete when:

1. abnormal captured executions can deterministically produce at most one validated `FailureFirstSelection`;
2. only behavioral evidence within the final 32 captured raw steps is eligible;
3. ranking follows proximity → span → repeat count → pattern ID exactly;
4. repeated-transition inspection lands at the final complete motif start;
5. repeated-state and no-progress inspection lands at their final evidence index;
6. stale or partial evidence fails closed;
7. `Start Here` renders only when a selection exists;
8. rendering does not move the raw cursor;
9. `Inspect` reuses `navigateDirect → stopPlaying → setStep`;
10. existing raw navigation semantics remain authoritative;
11. no diagnosis, causal attribution, correctness claim, or LeetCode TLE claim is introduced;
12. all focused tests and the complete repository test/typecheck/build gates pass.

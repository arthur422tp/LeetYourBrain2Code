# Case-to-Case Behavioral Diff

## Design Spec v0.1

Date: 2026-09-28  
Status: Implemented first-divergence slice; multi-divergence deferred to v0.2.x
Target release: LeetYourBrain2Code v0.2.0

Primary goal: compare two executions of the same source code on two different LeetCode testcase Cases and surface the earliest safely aligned behavioral divergence without inferring correctness, intent, root cause, or a fix.

---

# 1. Product Definition

LeetYourBrain2Code already supports a pinned-baseline behavioral diff for repeated runs of the same testcase.

v0.2.0 adds a distinct workflow:

> Compare two selected testcase Cases of the same problem and same source revision, then show where their observed executions first diverge.

Typical questions:

- Why does Case 1 behave differently from Case 3?
- At what decision did the executions first choose different paths?
- Did one Case mutate state differently?
- Did one Case enter an extra call or loop iteration?
- Did one Case terminate while the other continued?

The feature does not decide which Case is correct, infer an expected path, diagnose root cause, or suggest a fix.

The product boundary is:

> Show where two captured executions stop behaving the same way.

---

# 2. User Flow

~~~text
Case A trace          Case B trace
     \                  /
      behavioral alignment
               ↓
       first divergence
               ↓
   factual side-by-side evidence
               ↓
      inspect either run
~~~

The normal one-Case debugger remains unchanged.

---

# 3. Existing Architecture to Reuse

The repository already contains most of the required comparison infrastructure.

## Run provenance

src/sidepanel/run-comparison-state.ts already stores problem slug/title, selectedCaseIndex, language, and the accepted TraceSession inside an immutable RunRecord.

Therefore Case identity is already captured at execution time.

## Behavioral projection

src/core/cross-run-checkpoints.ts already projects executions into stable behavioral checkpoints:

- decisions;
- expressions;
- loop iterations;
- control transfers;
- loop exits;
- stable mutations;
- child calls;
- frame entry/exit.

These checkpoints already carry semantic keys and run-local anchor steps.

## Frame alignment

src/core/cross-run-alignment.ts already aligns call frames by function identity and reports strong, structural, fallback, or ambiguous confidence.

This remains authoritative.

## Divergence engine

src/core/cross-run-diff.ts already produces a CrossRunDiffResult containing compatibility, aligned prefix, first divergence, coverage, and stop reason.

It already recognizes changes in:

- frame arguments;
- child calls;
- decision truth/outcome/operands;
- expression values/selections;
- loop bindings/status/exits;
- transfers;
- stable mutations;
- returns/exceptions;
- trace/session outcomes.

v0.2.0 must reuse this engine instead of creating a second behavioral diff implementation.

---

# 4. Why Current Pinned-Baseline Diff Is Not Enough

Current compatibility intentionally rejects different executed testcases. That is correct for pinned-baseline comparison because its question is:

> What changed between repeated executions of this same input?

Case-to-Case asks a different question:

> What changed between two inputs under the same code?

Therefore the current compatibility rule must not simply be weakened globally.

Introduce an explicit comparison mode.

~~~ts
type RunComparisonMode =
  | "same_testcase_baseline"
  | "case_to_case";
~~~

Existing pinned-baseline behavior remains unchanged.

---

# 5. Compatibility Contracts

## Same-testcase baseline mode

Preserve current rules:

~~~text
same problem
same normalized executed testcase
compatible entrypoint
supported schema/runtime
different captured run
~~~

## Case-to-case mode

Required:

~~~text
same problem
same source revision
different selected Case
compatible entrypoint
supported schema/runtime
~~~

The exact captured source must match between both runs.

Use local direct equality:

~~~ts
left.session.sourceCode === right.session.sourceCode
~~~

Do not persist or expose a source hash.

Add compatibility statuses equivalent to:

~~~text
same_case
different_source
~~~

A duplicate LeetCode testcase may exist under two Case indexes. Therefore different selected Case identity is required, but different raw testcase text is not required.

If two Cases execute identically, the valid result can be no observed divergence.

---

# 6. Case Comparison State

Do not overload the existing pinned-baseline controller with ambiguous semantics.

Introduce a small dedicated Case-pair controller.

Suggested shape:

~~~ts
interface CaseComparisonSelection {
  left: RunRecord | null;
  right: RunRecord | null;
}

interface CaseComparisonController {
  get(): CaseComparisonSelection;
  selectLeft(run: RunRecord): void;
  selectRight(run: RunRecord): void;
  clear(): void;
  clearForProblemChange(): void;
}
~~~

Rules:

- selected runs are immutable RunRecord snapshots;
- live execution does not silently replace a selected side;
- active problem change clears the pair;
- user selection is explicit;
- raw cursor movement does not clear the pair;
- inspection of A/B does not clear the pair;
- no persistent Case history is introduced.

---

# 7. Capture Workflow

Do not automatically execute every LeetCode Case.

First version:

~~~text
select Case 1
→ normal local run
→ Use as Case A

select Case 3
→ normal local run
→ Compare with Case A
~~~

This preserves the existing scheduler, latest-wins semantics, Pyodide workload, and user control.

Automatic batch Case execution is out of scope.

---

# 8. Case Diff Result

Prefer a thin wrapper around the existing CrossRunDiffResult.

Example:

~~~ts
interface CaseBehavioralDiffResult {
  compatibility: ComparisonCompatibility;
  leftCaseIndex: number;
  rightCaseIndex: number;
  diff?: CrossRunDiffResult;
}
~~~

Do not duplicate CrossRunDivergenceKind.

The existing cross-run engine should remain the single source of truth for behavioral alignment and factual divergence detection.

---

# 9. First Observed Divergence

The primary user-facing concept is:

> First observed divergence

Meaning:

- earliest divergence found under deterministic aligned behavioral traversal;
- only within captured evidence;
- constrained by alignment confidence and coverage.

It does not mean:

- first logical bug;
- root cause;
- wrong branch;
- point where the algorithm became incorrect.

Recommended wording:

~~~text
First observed divergence
~~~

Avoid causal wording such as Bug found here or Root cause.

---

# 10. Presentation Categories

Map existing divergence kinds into user-facing categories without changing engine semantics.

## Decision

Includes decision truth/outcome/operand/completion differences.

Example:

~~~text
Decision differs · line 12

Case 1: condition → false
Case 3: condition → true
~~~

## Mutation

Includes mutation value/presence differences.

Display only factual values already present in captured evidence.

## Call

Includes frame argument and child-call differences.

## Control flow

Includes loop iteration/status, transfer, and loop-exit differences.

## Expression

Includes expression value/selection/structure differences.

## Termination

Includes return, exception, frame-exit, trace-end, and session-outcome differences.

The presentation adapter must not invent causal prose.

---

# 11. No-Divergence and Alignment-Boundary States

A valid comparison may return:

~~~text
divergence found
no observed divergence
comparison stopped at alignment boundary
comparison unavailable/incompatible
~~~

Use:

> No behavioral difference was found in the captured evidence.

Do not imply semantic equivalence.

The current stop reasons such as coverage ended, ambiguous alignment, alignment boundary, and unmatched function must remain visible as bounded comparison states.

Ambiguous alignment must stop rather than guess.

---

# 12. Divergence Navigation

Required first-version actions:

~~~text
Inspect Case A
Inspect Case B
~~~

Each action should:

1. activate the corresponding captured run in the existing visualization;
2. move the raw trace cursor to the relevant run-local anchor step when available;
3. request Monaco replay only when the currently visible editor source still matches that captured source;
4. preserve the Case comparison pair.

Do not auto-jump when the diff card first appears.

Do not mutate source code.

---

# 13. Multi-Divergence Navigation

After First Divergence is stable, v0.2 may extend the same aligned walk to produce an ordered divergence sequence:

~~~text
Previous difference
Next difference
1 / N differences
~~~

Optional filters:

~~~text
All
Decision
Mutation
Call
Control flow
Expression
Termination
~~~

This must be implemented as one deterministic aligned traversal.

Do not run repeated independent comparisons to discover the next difference.

If this slice risks delaying a solid first-divergence v0.2.0, move it to v0.2.x.

---

# 14. UI

Do not build two full visualizers side by side.

Use the current Side Panel as the detailed inspection surface.

Recommended compact comparison card:

~~~text
Compare cases

Case 1      vs      Case 3

First observed divergence
─────────────────────────
Decision · line 12

Case 1
condition → false

Case 3
condition → true

[Inspect Case 1] [Inspect Case 3]
~~~

User-facing Case numbering is one-based even if selectedCaseIndex remains zero-based internally.

---

# 15. Interaction With Live Execution

Live execution keeps updating the current run.

Selected comparison sides remain stable.

~~~text
Case 1 run selected as A
        ↓
switch to Case 3
        ↓
live execution updates current run
        ↓
current run can be selected as B
~~~

If A and B have different captured source, comparison becomes unavailable.

Preferred guidance:

> Code changed between these captures. Run both Cases again with the same code.

Do not silently recapture Case A.

---

# 16. Interaction With Pinned Baseline

Both workflows remain.

Pinned baseline asks:

> What changed between executions of the same testcase?

Case-to-Case asks:

> What behaves differently between inputs under the same code?

Do not rename the Case A side to baseline in user-facing UI.

The existing pinned-baseline feature must retain its current compatibility contract.

---

# 17. Source Safety

There are two separate source checks.

Comparison compatibility:

~~~text
left captured source
vs
right captured source
~~~

Editor replay safety:

~~~text
selected captured source
vs
currently visible Monaco source
~~~

Do not conflate them.

A later editor edit must not corrupt the stored comparison result, but it must prevent stale editor highlighting.

---

# 18. Testcase Provenance

Use selectedCaseIndex as the user-intent Case identity.

Keep session.rawTestcase as execution provenance.

Case UI should normally show:

~~~text
Case 1 vs Case 3
~~~

not the raw testcase contents.

Diagnostics must never include testcase values.

---

# 19. Privacy

The feature remains fully local.

No new permissions, backend, telemetry, or persistent trace history.

Do not persist:

- source;
- testcase;
- trace;
- comparison pair;
- divergence values.

If diagnostics are extended, only bounded status is allowed, for example:

~~~text
case_comparison: none | ready | incompatible | divergence | no_divergence
~~~

No source hash, testcase hash, operand values, mutation values, or trace payloads.

---

# 20. Performance

Do not execute two runs simultaneously for comparison.

Compare already captured runs.

Recommended:

- compute lazily when the pair becomes valid;
- cache by in-memory selected pair identity;
- invalidate when either side changes;
- never block live scheduling;
- keep comparison TypeScript-side initially.

Worker changes require separate evidence that comparison cost is material.

---

# 21. Recovery States

The UI must explicitly represent:

~~~text
No Case A selected
No Case B selected
Same Case selected twice
Code changed between captures
Different problem
Unsupported schema/runtime
Alignment ambiguous
Coverage partial
No observed divergence
Divergence available
~~~

Whenever possible, state the action that resolves the condition.

Avoid generic Comparison failed copy.

---

# 22. Presentation Model

Create a pure adapter from CrossRunDivergence to UI.

Suggested structure:

~~~ts
interface CaseDivergencePresentation {
  category:
    | "decision"
    | "mutation"
    | "call"
    | "control_flow"
    | "expression"
    | "termination";
  title: string;
  detail?: string;
  left: {
    caseLabel: string;
    factualText?: string;
    step?: number;
  };
  right: {
    caseLabel: string;
    factualText?: string;
    step?: number;
  };
  confidence: AlignmentConfidence;
}
~~~

UI must consume this model rather than reinterpreting arbitrary raw trace data.

---

# 23. Confidence

Preserve alignment confidence.

Recommended presentation:

- strong: normal;
- structural: normal, optionally with subtle evidence note;
- fallback: indicate structural/name-based alignment;
- ambiguous: stop comparison and do not present a matched divergence.

Do not create numeric confidence scores.

---

# 24. First Means Aligned First

Do not define first divergence as the smaller raw step number.

Different Cases have different trace lengths and branching.

First means:

> the first divergence encountered in deterministic aligned behavioral traversal.

This is especially important for recursion and loops.

---

# 25. Initial Implementation Slices

## Slice 1 — Compatibility and Case-pair state

- explicit comparison mode;
- preserve pinned-baseline semantics;
- add same_case and different_source;
- Case comparison controller;
- tests.

## Slice 2 — Case pair through existing diff engine

- prepare A/B RunRecords;
- approve Case compatibility;
- reuse existing preparation/alignment/diff;
- return first divergence;
- scenario tests.

## Slice 3 — Presentation and UI

- select Case A;
- compare current accepted Case B;
- compatibility guidance;
- First observed divergence card;
- Inspect A/B.

## Slice 4 — Trace and Monaco navigation

- restore selected captured run;
- jump raw cursor to divergence anchor;
- source-safe Monaco replay;
- preserve pair while inspecting.

## Slice 5 — Ordered multi-divergence navigation

- extend aligned traversal to collect ordered divergences;
- Previous/Next difference;
- optional type filters.

Slice 5 may ship in v0.2.x if needed.

---

# 26. Acceptance Scenarios

## Decision divergence

Same Two Sum source, two Cases choose different aligned decision outcomes.

Expected: Decision differs with factual A/B evidence.

## Mutation divergence

Same source produces different stable mutation values.

Expected: factual mutation divergence.

## Extra loop iteration

One Case performs an additional aligned iteration.

Expected: control-flow divergence, with no claim that it is erroneous.

## Exception versus return

One Case returns and the other raises.

Expected: termination divergence.

## Source changed

Case A captured, source edited, Case B captured.

Expected: incompatible due to different source; no diff.

## Same Case twice

Expected: Choose two different Cases.

## No observed divergence

Two Cases produce identical captured behavioral evidence.

Expected: explicit no-observed-divergence state.

## Ambiguous recursive alignment

Expected: comparison stops with ambiguity notice; no guessed pairing.

---

# 27. Testing Strategy

Compatibility tests:

- same problem + same source + different Case is compatible;
- same Case rejected;
- different source rejected;
- different problem rejected;
- missing problem rejected;
- unsupported schema/runtime rejected;
- existing baseline mode unchanged.

State tests:

- select/replace A and B;
- live current run does not replace selected pair;
- problem change clears;
- raw cursor movement preserves;
- inspection preserves.

Diff tests:

- decision;
- mutation;
- child call;
- loop;
- return;
- exception;
- trace termination;
- no divergence;
- ambiguous alignment.

UI tests:

- one-based Case labels;
- factual copy;
- no causal language;
- Inspect A/B;
- partial coverage;
- no divergence;
- keyboard controls.

Release smoke:

1. capture Case A;
2. capture Case B;
3. comparison appears;
4. inspect A;
5. inspect B;
6. replay remains source-safe;
7. edit source and observe incompatibility;
8. rerun both Cases and restore comparison.

---

# 28. Non-Goals

Not part of this milestone:

- expected-output comparison;
- LeetCode judge integration;
- AI explanation;
- root-cause diagnosis;
- automatic fixes;
- algorithm classification;
- automatic Case generation;
- fuzzing;
- automatic execution of all Cases;
- persistent comparison history;
- cloud sync;
- cross-problem comparison;
- different-source comparison in Case mode;
- semantic-equivalence proof;
- heuristic matching beyond ambiguous alignment.

---

# 29. Release Isolation

While v0.1.1 remains under Chrome Web Store review:

~~~text
main
→ v0.1.x release/docs/urgent compatibility fixes

feature/v0.2-case-diff
→ v0.2 runtime and UI work
~~~

This design spec may live on main.

v0.2 implementation should preferably happen on a feature branch until the v0.1.1 Store review is resolved.

If Google requests a v0.1.1 correction, do not mix Case-diff code into that patch.

---

# 30. Success Criteria

A user can:

~~~text
run Case 1
→ select it as Case A
→ run Case 3
→ compare
→ see the earliest safely aligned behavioral difference
→ inspect either captured run at that evidence
~~~

while the system guarantees:

1. same source is required;
2. same problem is required;
3. different Case identity is required;
4. pinned-baseline behavior remains unchanged;
5. comparison uses captured evidence only;
6. ambiguous alignment stops rather than guesses;
7. stale Monaco replay is prevented;
8. no correctness/root-cause claim is made;
9. source/testcase/trace remain local;
10. no new Chrome permissions are required.

---

# 31. Recommended Product Copy

Short description:

> Compare two testcase executions and inspect where their observed behavior first diverges.

Evidence disclaimer:

> Differences describe captured runtime behavior. They do not identify the correct path or root cause.

---

# 32. Implementation Status

The v0.2.0 first-divergence slice is implemented.

Implemented:

- explicit `case_to_case` comparison mode with same-problem, same-source, and
  different-Case compatibility rules;
- immutable A/B Case selection independent from the pinned-baseline state;
- captured-run comparison through the existing cross-run alignment and
  divergence engine;
- factual first-observed-divergence presentation across decision, mutation,
  call, control-flow, expression, and termination categories;
- conservative incompatible, partial, ambiguous-boundary, and no-observed-
  divergence states;
- captured A/B inspection with exact trace-anchor navigation and source-safe
  Monaco replay;
- automated scenario, integration, compatibility, type, build, and package
  validation.

Deferred to v0.2.x:

- ordered multi-divergence collection;
- Previous / Next difference navigation and difference-count state;
- multi-divergence filters and the expanded evidence UI.

The real-browser Task 15 acceptance remains a release gate and must be
recorded separately from the automated implementation evidence. The
implementation does not claim that a divergence is a bug, the wrong path, a
root cause, or a fix.

# Case-to-Case Behavioral Diff Implementation Plan

**Target:** LeetYourBrain2Code v0.2.0  
**Design:** docs/superpowers/specs/2026-09-28-case-to-case-behavioral-diff-design.md

**Goal:** Let a user compare two accepted executions from different LeetCode Cases under the same source revision and inspect the earliest safely aligned behavioral divergence.

---

# Branch / Release Isolation

v0.1.1 is still under Chrome Web Store review.

Before runtime implementation:

~~~bash
git checkout main
git pull
git checkout -b feature/v0.2-case-diff
~~~

Keep documentation on main if desired, but all runtime/UI changes in this plan should be implemented on feature/v0.2-case-diff until the v0.1.1 review is resolved.

Do not mix v0.1.1 review fixes into this branch.

---

# Task 0: Add Explicit Comparison Mode Without Changing Existing Baseline Semantics

**Files:**
- Modify: src/sidepanel/run-comparison-state.ts
- Modify: tests/sidepanel/run-comparison-state.test.ts

Add:

~~~ts
export type RunComparisonMode =
  | "same_testcase_baseline"
  | "case_to_case";
~~~

Extend compareRunCompatibility to accept a mode, defaulting to same_testcase_baseline.

Requirements for existing mode:

- same problem;
- same executed testcase;
- compatible entrypoint;
- supported schema/runtime;
- existing tests continue to pass unchanged where possible.

Requirements for case_to_case:

- both sides exist;
- not same captured session;
- supported schema/runtime;
- non-null same problem slug;
- exact same captured sourceCode;
- compatible entrypoint;
- different selectedCaseIndex.

Add statuses:

~~~text
same_case
different_source
~~~

Do not require different raw testcase text.

Tests:

- current baseline compatibility remains unchanged;
- same problem + same source + Case 1 vs Case 3 => compatible;
- same Case => same_case;
- source differs => different_source;
- problem differs => different_problem;
- missing problem => missing_problem;
- unsupported runtime/schema still wins before deeper comparison.

Run:

~~~bash
npx vitest run tests/sidepanel/run-comparison-state.test.ts
npm run typecheck
~~~

Commit:

~~~bash
git add src/sidepanel/run-comparison-state.ts tests/sidepanel/run-comparison-state.test.ts
git commit -m "feat: add case comparison compatibility mode"
~~~

---

# Task 1: Add Dedicated Case Comparison Selection State

**Files:**
- Create: src/sidepanel/case-comparison-state.ts
- Create: tests/sidepanel/case-comparison-state.test.ts

Do not overload createRunComparisonState.

Recommended API:

~~~ts
export interface CaseComparisonSelection {
  left: RunRecord | null;
  right: RunRecord | null;
}

export interface CaseComparisonStateController {
  get(): CaseComparisonSelection;
  selectLeft(run: RunRecord): void;
  selectRight(run: RunRecord): void;
  clearLeft(): void;
  clearRight(): void;
  clear(): void;
  clearForProblemChange(): void;
}
~~~

Rules:

- selected RunRecords are retained as immutable accepted snapshots;
- live current run does not replace either side;
- selecting a new left/right is explicit;
- problem change clears both;
- cursor changes do not clear;
- no history array.

Tests:

- empty initial state;
- select left;
- select right;
- replace left;
- replace right;
- clear each side;
- clear both;
- problem change clears;
- current live state changes do not replace either selected side.

Commit:

~~~bash
git add src/sidepanel/case-comparison-state.ts tests/sidepanel/case-comparison-state.test.ts
git commit -m "feat: model case comparison selection"
~~~

---

# Task 2: Add Case Comparison Service That Reuses Existing Cross-Run Engine

**Files:**
- Create: src/core/case-behavioral-diff.ts
- Create: tests/core/case-behavioral-diff.test.ts
- Reuse:
  - src/core/cross-run-diff.ts
  - src/core/cross-run-diff-types.ts
  - src/core/trace-session-interpreter.ts
  - src/sidepanel/run-comparison-state.ts

Create a thin orchestrator.

Suggested result:

~~~ts
export interface CaseBehavioralDiffResult {
  compatibility: ComparisonCompatibility;
  leftCaseIndex?: number;
  rightCaseIndex?: number;
  diff?: CrossRunDiffResult;
}
~~~

Responsibilities:

1. run case_to_case compatibility;
2. return immediately if incompatible;
3. prepare/interpret both sessions using existing cross-run preparation path;
4. call the existing cross-run diff entry point;
5. return the same CrossRunDiffResult without rewriting divergence logic.

No new divergence taxonomy.

No UI prose here.

Tests:

- incompatible pair does not invoke comparison path;
- compatible pair returns existing first divergence;
- identical behavioral evidence returns no first divergence;
- coverage/stopReason flow through unchanged;
- selected Case indexes are preserved.

Commit:

~~~bash
git add src/core/case-behavioral-diff.ts tests/core/case-behavioral-diff.test.ts
git commit -m "feat: compare accepted testcase cases"
~~~

---

# Task 3: Add Case Divergence Presentation Adapter

**Files:**
- Create: src/sidepanel/case-diff-presentation.ts
- Create: tests/sidepanel/case-diff-presentation.test.ts

Create a pure adapter from CrossRunDivergence to UI model.

Suggested output:

~~~ts
export type CaseDiffCategory =
  | "decision"
  | "mutation"
  | "call"
  | "control_flow"
  | "expression"
  | "termination";

export interface CaseDivergencePresentation {
  category: CaseDiffCategory;
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

Map every current CrossRunDivergenceKind.

Required copy examples:

~~~text
Decision differs
State change differs
Call behavior differs
Control flow differs
Expression differs
Termination differs
~~~

Avoid:

~~~text
wrong branch
bug
root cause
correct case
bad case
fix
should
~~~

Use one-based user-facing labels such as Case 1, Case 2, Case 3.

Tests:

- all current divergence kinds map;
- left/right step preserved;
- factualText preserved;
- no causal language;
- fallback confidence can surface a neutral note;
- ambiguous confidence is not converted into a confident divergence card.

Commit:

~~~bash
git add src/sidepanel/case-diff-presentation.ts tests/sidepanel/case-diff-presentation.test.ts
git commit -m "feat: present case divergence evidence"
~~~

---

# Task 4: Add Case Comparison Controls

**Files:**
- Create: src/sidepanel/components/CaseComparisonControls.ts
- Create: tests/sidepanel/case-comparison-controls.test.ts
- Modify: src/sidepanel/styles.css

First version should be compact.

Recommended controls:

~~~text
Compare cases

Current: Case 1
[Use as Case A]

Case A: Case 1
Current: Case 3
[Compare current with Case A]

[Clear]
~~~

Requirements:

- only an accepted current run can be selected;
- current Case label visible;
- one-based labels;
- no raw testcase content by default;
- explicit Clear;
- buttons keyboard accessible;
- no automatic selection;
- no auto-run of all Cases.

Tests:

- no current run disables selection;
- select current as A;
- current Case changes without mutating A;
- compare current as B;
- same Case state displays actionable guidance;
- source mismatch displays actionable guidance;
- clear works;
- controls do not change LeetCode selected Case themselves.

Commit:

~~~bash
git add src/sidepanel/components/CaseComparisonControls.ts tests/sidepanel/case-comparison-controls.test.ts src/sidepanel/styles.css
git commit -m "feat: add case comparison controls"
~~~

---

# Task 5: Add First-Divergence Case Comparison Panel

**Files:**
- Create: src/sidepanel/components/CaseBehavioralDiff.ts
- Create: tests/sidepanel/case-behavioral-diff-ui.test.ts
- Modify: src/sidepanel/styles.css

Do not reuse BehavioralDiff.ts in a way that blurs same-testcase baseline semantics.

The Case component may reuse small rendering helpers if safe.

States:

~~~text
no Case A
no Case B
same Case
different source
different problem
unsupported
alignment stopped
no observed divergence
first divergence available
~~~

Divergence card:

~~~text
Case 1 vs Case 3

First observed divergence

Decision differs
Case 1: ...
Case 3: ...

[Inspect Case 1]
[Inspect Case 3]
~~~

Required evidence disclaimer:

> Differences describe captured runtime behavior. They do not identify the correct path or root cause.

Tests:

- factual card;
- no-divergence copy;
- partial coverage note;
- ambiguous alignment state;
- no correctness semantics;
- Inspect buttons only enabled when corresponding anchor step is authoritative.

Commit:

~~~bash
git add src/sidepanel/components/CaseBehavioralDiff.ts tests/sidepanel/case-behavioral-diff-ui.test.ts src/sidepanel/styles.css
git commit -m "feat: render first case divergence"
~~~

---

# Task 6: Integrate Case Comparison Into Side Panel State

**Files:**
- Modify: src/sidepanel/bootstrap.ts
- Modify: tests/sidepanel/bootstrap.test.ts
- Reuse:
  - src/sidepanel/case-comparison-state.ts
  - src/core/case-behavioral-diff.ts
  - src/sidepanel/components/CaseComparisonControls.ts
  - src/sidepanel/components/CaseBehavioralDiff.ts

Integrate without changing live scheduler ownership.

Authoritative data flow:

~~~text
accepted live session
      ↓
RunRecord
      ↓
current accepted run
      ├─ existing pinned baseline state
      └─ case comparison controls
              ↓
       selected A / B
              ↓
      case diff service
              ↓
      case diff panel
~~~

Rules:

- only accepted live sessions become selectable;
- stale scheduler runs never enter Case comparison;
- switching selected LeetCode Case updates current run normally;
- selected A/B remain unchanged;
- changing problem clears A/B;
- non-LeetCode pause does not corrupt pair state;
- source mismatch does not auto-clear A; it makes the pair incompatible.

Tests:

- Case 1 accepted → select A;
- Case 3 accepted → compare;
- current Case 2 later does not replace B;
- stale async result ignored;
- problem switch clears;
- non-LeetCode pause preserves safely;
- pinned baseline behavior remains unchanged.

Commit:

~~~bash
git add src/sidepanel/bootstrap.ts tests/sidepanel/bootstrap.test.ts
git commit -m "feat: integrate case behavioral comparison"
~~~

---

# Task 7: Add Captured-Run Inspection Switching

**Files:**
- Modify: src/sidepanel/bootstrap.ts
- Modify as needed: src/sidepanel/TraceVisualizer.ts
- Modify as needed: src/sidepanel/components/CaseBehavioralDiff.ts
- Modify tests:
  - tests/sidepanel/bootstrap.test.ts
  - tests/sidepanel/trace-visualizer.test.ts
  - tests/sidepanel/case-behavioral-diff-ui.test.ts

Inspect A/B must display the selected captured TraceSession using the existing visualizer.

Do not re-execute.

Required:

~~~text
Inspect Case A
→ render A's captured TraceSession
→ move cursor to A divergence anchor

Inspect Case B
→ render B's captured TraceSession
→ move cursor to B divergence anchor
~~~

Preserve:

- Case A/B selections;
- current live execution separately;
- selected Case in LeetCode UI is not silently changed;
- source editor is not modified.

If the current visualizer only supports latest-live-run ownership, introduce the smallest explicit display-session abstraction rather than overwriting scheduler state.

Tests:

- Inspect A shows A session;
- Inspect B shows B session;
- cursor maps exact step through existing traceIndex.stepToIndex;
- missing step does not guess nearest;
- switching inspect sides does not clear comparison;
- returning to current live run is possible.

Commit:

~~~bash
git add src/sidepanel/bootstrap.ts src/sidepanel/TraceVisualizer.ts src/sidepanel/components/CaseBehavioralDiff.ts tests/sidepanel
git commit -m "feat: inspect captured case divergence runs"
~~~

Omit unchanged files.

---

# Task 8: Integrate Source-Safe Monaco Replay for Inspected Runs

**Files:**
- Modify: src/sidepanel/editor-trace-sync.ts
- Modify: src/sidepanel/bootstrap.ts
- Modify:
  - tests/sidepanel/editor-trace-sync.test.ts
  - tests/sidepanel/bootstrap.test.ts
  - tests/compatibility/editor-replay-contract.test.ts

When inspecting A or B:

~~~text
captured source
vs visible Monaco source
~~~

must still gate replay.

Required:

- exact captured source + same problem => highlight allowed;
- visible source differs => stale/cleared;
- active problem differs => no highlight;
- source edit clears marker;
- Side Panel inspection still works if Monaco highlight is unavailable.

Do not change page-bridge source ownership semantics.

Run:

~~~bash
npm run test:compat
npm test
npm run typecheck
~~~

Commit:

~~~bash
git add src/sidepanel/editor-trace-sync.ts src/sidepanel/bootstrap.ts tests/sidepanel/editor-trace-sync.test.ts tests/sidepanel/bootstrap.test.ts tests/compatibility/editor-replay-contract.test.ts
git commit -m "feat: replay inspected case divergence safely"
~~~

---

# Task 9: Add End-to-End Case Comparison Scenarios

**Files:**
- Create: tests/core/case-diff-scenarios.test.ts
- Create: tests/sidepanel/case-diff-integration.test.ts

Required scenarios:

## A. Decision divergence

Same source, aligned decision truth/outcome differs.

Expected first divergence: decision.

## B. Mutation divergence

Same earlier decisions, first difference is stable mutation.

Expected mutation rather than later return.

## C. Extra call

One Case makes an additional child call.

Expected factual child-call divergence.

## D. Extra loop iteration

Expected control-flow divergence.

## E. Return vs exception

Expected termination divergence.

## F. Same captured behavior

Expected no observed divergence.

## G. Same Case twice

Expected incompatible same_case.

## H. Source edit between Cases

Expected different_source and no cross-run alignment.

## I. Ambiguous recursive alignment

Expected stop/ambiguous state.

## J. Partial evidence

Earlier proven divergence remains valid; later truncation appears in coverage.

Run:

~~~bash
npx vitest run tests/core/case-diff-scenarios.test.ts tests/sidepanel/case-diff-integration.test.ts
~~~

Commit:

~~~bash
git add tests/core/case-diff-scenarios.test.ts tests/sidepanel/case-diff-integration.test.ts
git commit -m "test: validate case comparison scenarios"
~~~

---

# Task 10: Product-Boundary, Privacy, Memory, and Accessibility Audit

**Files:**
- Modify as needed:
  - src/sidepanel/components/CaseComparisonControls.ts
  - src/sidepanel/components/CaseBehavioralDiff.ts
  - src/sidepanel/case-diff-presentation.ts
  - tests

Search new copy for prohibited causal/correctness language:

~~~bash
grep -RniE "wrong case|correct case|root cause|bug found|fix this|should have|expected path|bad case|good case|this caused|the error starts" src tests
~~~

Review fixture/context hits manually.

Accessibility requirements:

- A/B selection controls are real buttons;
- Inspect A/B are buttons;
- Case labels are text, not color-only;
- incompatible/no-divergence/partial states are textual;
- focus order is usable;
- no hover-only evidence.

Memory requirements:

- only two selected RunRecords retained;
- Clear/problem switch releases them;
- no history list;
- no localStorage/IndexedDB.

Privacy requirements:

- no Case source/testcase added to diagnostics;
- no analytics;
- no new permissions;
- no persistence of pair or divergence values.

Commit only if fixes are needed:

~~~bash
git add src/sidepanel tests
git commit -m "test: harden case diff product boundaries"
~~~

---

# Task 11: First-Divergence Milestone Regression Gate

Run:

~~~bash
python3 -m unittest discover -s tests/fixtures/python -p "test_*.py"
npm test
npm run test:compat
npm run typecheck
npm run build
npm run release:check
~~~

Expected: all PASS.

release:check is packaging safety only. Do not upload a v0.2 Web Store artifact yet.

At this point make an explicit scope decision:

~~~text
If First Divergence is already a strong debugging workflow:
→ keep v0.2.0 focused
→ move Tasks 12–14 to v0.2.x

If repeated differences are necessary for a usable v0.2.0:
→ continue Tasks 12–14
~~~

Do not add multi-divergence simply because it appears in this plan.

---

# Task 12: Extend Cross-Run Diff to Ordered Divergences

**Optional v0.2.0 slice; otherwise v0.2.x**

**Files:**
- Modify: src/core/cross-run-diff.ts
- Modify: src/core/cross-run-diff-types.ts
- Modify:
  - tests/core/cross-run-diff.test.ts
  - tests/core/cross-run-scenarios.test.ts

Do not run the existing comparison repeatedly.

Refactor one aligned walk to collect deterministic ordered divergences.

Target:

~~~ts
interface CrossRunDiffResult {
  // existing fields
  divergences: CrossRunDivergence[];
  firstDivergence?: CrossRunDivergence;
}
~~~

Keep firstDivergence as a compatibility projection if existing UI/tests depend on it.

Rules:

- ordering follows aligned traversal;
- no duplicate divergence for the same semantic checkpoint pair;
- stop at ambiguity/alignment boundary;
- coverage still applies;
- bounded lookahead remains bounded.

Tests:

- multiple differences ordered;
- firstDivergence equals first item;
- recursive child divergence ordering remains correct;
- no all-pairs behavior.

Commit:

~~~bash
git add src/core/cross-run-diff.ts src/core/cross-run-diff-types.ts tests/core
git commit -m "feat: collect ordered behavioral divergences"
~~~

---

# Task 13: Add Difference Navigation State

**Optional v0.2.0 slice; otherwise v0.2.x**

**Files:**
- Create: src/sidepanel/case-diff-navigation.ts
- Create: tests/sidepanel/case-diff-navigation.test.ts

State:

~~~ts
interface CaseDiffNavigationState {
  index: number;
  filter: CaseDiffCategory | "all";
}
~~~

Required:

- Next;
- Previous;
- current position / total count;
- category filter;
- changing comparison pair resets to first difference;
- Inspect A/B does not reset index;
- filtered list deterministic.

No independent recomputation.

Commit:

~~~bash
git add src/sidepanel/case-diff-navigation.ts tests/sidepanel/case-diff-navigation.test.ts
git commit -m "feat: navigate case behavioral differences"
~~~

---

# Task 14: Add Multi-Divergence UI

**Optional v0.2.0 slice; otherwise v0.2.x**

**Files:**
- Modify: src/sidepanel/components/CaseBehavioralDiff.ts
- Modify: src/sidepanel/styles.css
- Modify: tests/sidepanel/case-behavioral-diff-ui.test.ts

Add compact navigation:

~~~text
Previous difference
Next difference
2 / 7
~~~

Optional filter:

~~~text
All | Decision | Mutation | Call | Control flow | Expression | Termination
~~~

Do not render a long full diff list by default.

The existing visualizer remains the inspection surface.

Commit:

~~~bash
git add src/sidepanel/components/CaseBehavioralDiff.ts src/sidepanel/styles.css tests/sidepanel/case-behavioral-diff-ui.test.ts
git commit -m "feat: navigate case divergence evidence"
~~~

---

# Task 15: v0.2.0 Manual Acceptance

Use a development build from feature/v0.2-case-diff.

Primary acceptance problem: LeetCode 704 Binary Search.

Flow:

~~~text
1. open Binary Search
2. keep one source revision
3. run Case 1
4. select Case 1 as A
5. run another Case
6. compare
7. First observed divergence appears
8. Inspect A
9. Side Panel jumps to A anchor
10. Inspect B
11. Side Panel jumps to B anchor
12. Monaco replay follows only while source matches
13. edit source
14. comparison reports different source
15. rerun both Cases with same source
16. comparison works again
~~~

Also test:

- one loop-heavy problem;
- one recursive problem;
- one no-observed-divergence pair if practical;
- exception vs return using a deterministic local fixture if a public Case is unsuitable.

Record only public/sanitized evidence.

---

# Task 16: Full Regression and Completion Documentation

**Files:**
- Modify: docs/superpowers/specs/2026-09-28-case-to-case-behavioral-diff-design.md
- Modify: README.md
- Modify: README.zh-TW.md
- Modify: CHANGELOG.md only when v0.2.0 release preparation actually begins

Run:

~~~bash
python3 -m unittest discover -s tests/fixtures/python -p "test_*.py"
npm test
npm run test:compat
npm run typecheck
npm run build
npm run release:check
~~~

README capability line after implementation is green:

> Case-to-Case Behavioral Diff: compare two testcase executions under the same source revision and inspect where their captured behavior first diverges.

Do not say finds the bug or identifies the wrong Case.

Update design status with implemented and deferred slices.

If multi-divergence is deferred, state that explicitly.

Commit:

~~~bash
git add docs/superpowers/specs/2026-09-28-case-to-case-behavioral-diff-design.md README.md README.zh-TW.md CHANGELOG.md
git commit -m "docs: record case behavioral diff completion"
~~~

Omit CHANGELOG unless release preparation has begun.

---

# Dependency Order

~~~text
Task 0  comparison mode
   ↓
Task 1  Case pair state
   ↓
Task 2  Case diff service
   ↓
Task 3  presentation adapter

Task 4  controls
   ↓
Task 5  first-divergence panel
   ↓
Task 6  Side Panel integration
   ↓
Task 7  captured-run inspection
   ↓
Task 8  source-safe Monaco replay
   ↓
Task 9  end-to-end scenarios
   ↓
Task 10 boundary/accessibility audit
   ↓
Task 11 first-divergence regression gate

Optional:
Task 12 ordered divergences
   ↓
Task 13 navigation state
   ↓
Task 14 multi-divergence UI

Then:
Task 15 manual acceptance
   ↓
Task 16 docs
~~~

Tasks 0–3 should stabilize before UI implementation.

Do not start multi-divergence before First Divergence works end to end.

---

# Recommended Commit Sequence

~~~text
feat: add case comparison compatibility mode
feat: model case comparison selection
feat: compare accepted testcase cases
feat: present case divergence evidence
feat: add case comparison controls
feat: render first case divergence
feat: integrate case behavioral comparison
feat: inspect captured case divergence runs
feat: replay inspected case divergence safely
test: validate case comparison scenarios
test: harden case diff product boundaries

optional:
feat: collect ordered behavioral divergences
feat: navigate case behavioral differences
feat: navigate case divergence evidence

docs: record case behavioral diff completion
~~~

---

# Definition of Done — First Divergence v0.2 Foundation

1. Existing pinned-baseline compatibility behavior remains unchanged.
2. Comparison mode is explicit.
3. Case comparison requires same problem.
4. Case comparison requires same captured source.
5. Case comparison requires different selected Case indexes.
6. Duplicate testcase text across two Case indexes is allowed.
7. Same Case is rejected explicitly.
8. Different source is rejected explicitly.
9. Unsupported runtime/schema remains explicit.
10. Case pair state is separate from pinned baseline state.
11. Only two selected Case runs are retained.
12. Live current updates do not replace selected A/B.
13. Problem change clears A/B.
14. Cursor movement does not clear A/B.
15. No Case history is persisted.
16. No new browser permission is added.
17. No telemetry/backend is added.
18. No source/testcase/trace is transmitted.
19. Existing cross-run checkpoint projection is reused.
20. Existing frame alignment is reused.
21. Existing divergence taxonomy is reused.
22. No second behavioral inference engine is introduced.
23. Incompatible pairs do not run alignment.
24. First divergence follows aligned behavioral traversal, not raw step-number comparison.
25. Ambiguous alignment stops rather than guesses.
26. Coverage state survives into Case comparison.
27. No-divergence wording does not imply semantic equivalence.
28. Decision divergence is supported.
29. Mutation divergence is supported.
30. Call divergence is supported.
31. Control-flow divergence is supported.
32. Expression divergence is supported.
33. Termination divergence is supported.
34. Presentation is pure and factual.
35. User-facing Cases are one-based.
36. Raw testcase values are not displayed by default in Case diff.
37. Case controls are explicit.
38. No automatic execution of all Cases occurs.
39. Only accepted scheduler runs can be selected.
40. Stale scheduler runs never enter Case comparison.
41. First-divergence panel has explicit incompatible states.
42. First-divergence panel has explicit no-divergence state.
43. First-divergence panel surfaces partial/ambiguous evidence conservatively.
44. Inspect A works only from captured A.
45. Inspect B works only from captured B.
46. Inspect does not re-execute.
47. Inspect does not mutate the LeetCode editor.
48. Inspect preserves Case pair state.
49. Exact anchor step maps through existing trace index.
50. Missing anchor does not use nearest-step guessing.
51. Side Panel may inspect A/B even if Monaco replay is unavailable.
52. Monaco replay requires captured source to equal current visible source.
53. Monaco replay requires same problem identity.
54. Editing source clears/prevents stale highlight.
55. Existing active-tab ownership remains unchanged.
56. Existing latest-wins execution remains unchanged.
57. Existing Case selector execution remains unchanged.
58. Existing pinned baseline UI remains functional.
59. No correctness color semantics are introduced.
60. No root-cause/correctness/fix copy is introduced.
61. Case comparison controls are keyboard accessible.
62. Inspect controls are keyboard accessible.
63. Case diff meaning is understandable without color.
64. Decision scenario passes.
65. Mutation scenario passes.
66. Extra-call scenario passes.
67. Loop scenario passes.
68. Return-vs-exception scenario passes.
69. No-divergence scenario passes.
70. Different-source scenario passes.
71. Same-Case scenario passes.
72. Ambiguous-alignment scenario passes.
73. Partial-evidence scenario passes.
74. Python fixture suite passes.
75. Full Vitest suite passes.
76. Compatibility suite passes.
77. Typecheck passes.
78. Production build passes.
79. Release package check passes.
80. Manual Case A/B Chrome flow passes before v0.2.0 release.

---

# v0.2.0 Scope Decision Gate

After Task 11, make one explicit decision:

~~~text
If First Divergence already produces a strong debugging workflow:
→ ship v0.2.0 with First Divergence
→ move Tasks 12–14 to v0.2.x

If repeated differences are necessary for a usable v0.2.0:
→ complete Tasks 12–14 before v0.2.0
~~~

Do not add multi-divergence merely because it was planned.

The primary v0.2 product milestone is achieved when the extension can answer:

> Compared with another Case under the same code, where did the captured executions first begin behaving differently?

without claiming:

> This is where the code became wrong.

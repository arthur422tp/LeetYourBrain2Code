# Cross-Run Behavioral Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Keep each task independently testable and commit after each green checkpoint.

**Goal:** Let the user pin one accepted execution as a baseline, continue editing/running the same LeetCode testcase, and see the earliest factual behavioral divergence between the pinned run and the latest accepted current run.

**Design spec:** `docs/superpowers/specs/2026-09-20-cross-run-behavioral-diff-design.md`

**Architecture summary:**

```text
Side Panel
├─ pinned baseline RunRecord
├─ latest accepted current RunRecord
│
├─ interpretTraceSession(...)
│   ├─ baseline interpretation (cached)
│   └─ current interpretation
│
├─ cross-run preparation
│   ├─ stable function identities
│   ├─ hierarchical frame alignment
│   ├─ ordered behavioral checkpoints
│   └─ conservative value comparison
│
├─ first-divergence engine
│
└─ TraceVisualizer
    ├─ Behavioral Diff panel
    └─ existing current raw trace cursor
```

No baseline re-execution, no second raw cursor, no judge/expected-output integration, and no correctness/root-cause inference.

---

# Current Repo Observations

The plan is written against the current `main` state after the Call-Frame Execution Story milestone.

Important existing seams:

1. `LiveExecutionScheduler` already has latest-wins semantics and internally retains an `AcceptedRun { revision, request }`, but `onSession` currently exposes only the returned `TraceSession`.
2. `LiveExecutionInput` currently carries:
   ```ts
   language
   sourceCode
   rawTestcase
   selectedCaseIndex
   ```
   but not LeetCode problem identity.
3. `renderSidePanel()` owns live scheduling, problem switching, Case selection, and replacement of `activeVisualizer`. Therefore baseline lifecycle belongs here, not inside one visualizer instance.
4. `TraceVisualizer.ts` already contains:
   ```ts
   export function interpretTraceSession(session: TraceSession)
   ```
   as a wrapper around the long `interpretTrace(...)` argument list.
5. That helper currently lives in a UI component file. Cross-run analysis needs the same exact interpretation path, so it should be moved to core and imported by both consumers.
6. Current Call-Frame evidence provides the structural backbone:
   ```text
   CallFrameModel
   FrameEvidenceIndex
   Decision Evidence
   Expression Evidence
   Control-Flow Evidence
   RuntimeMutationBatch
   ```
7. Existing run-local identifiers must remain run-local. Cross-run matching requires new semantic keys; do not reuse `frameId`, `functionId`, `siteId`, `loopId`, `objectId`, or raw step equality.

---

# Global Constraints

- **Baseline is user-pinned reference, not known-good execution.**
- Compare only captured executions.
- No LLM or fuzzy semantic matching.
- No baseline re-execution.
- No automatic “previous live run” baseline.
- Same problem + same executed testcase + compatible entrypoint are required in v0.1.
- Source code may differ.
- Runtime status may differ.
- All cross-run value comparison is tri-state:
  ```text
  equal / different / incomparable
  ```
- Object identity is never inferred from equal/different run-local object IDs.
- First divergence means earliest safely supported divergence in factual nested execution order.
- If alignment becomes ambiguous, stop.
- If evidence coverage ends before a divergence is found, report incomplete comparison.
- Existing single-run UI/evidence semantics remain unchanged.
- Diff navigation controls only the current run's existing raw cursor.
- Full Python fixture suite, Vitest, typecheck, and build must remain green.

---

# Task 0: Extract the Shared TraceSession Interpreter

**Why first:** Baseline and current comparison must interpret `TraceSession` exactly the same way as the existing TraceVisualizer. Today that wrapper exists but lives in `TraceVisualizer.ts`.

**Files:**
- Create: `src/core/trace-session-interpreter.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Create: `tests/core/trace-session-interpreter.test.ts`
- Modify if needed: `tests/sidepanel/trace-visualizer.test.ts`

## Target API

```ts
import type { TraceSession } from "../shared/trace-types";
import type { TraceInterpretation } from "./trace-interpreter";

export function interpretTraceSession(
  session: TraceSession
): TraceInterpretation;
```

- [ ] **Step 1: Move the existing wrapper without changing semantics**

Move the existing argument mapping:

```ts
return interpretTrace(
  session.events,
  session.subscriptRelations ?? [],
  session.expressionPlan,
  session.expressionBatches ?? [],
  session.conditionPlan,
  session.decisionBatches ?? [],
  session.controlFlowPlan,
  session.controlFlowBatches ?? [],
  { status: session.status, terminationReason: session.terminationReason },
  session.functionPlan,
  session.callFrameBatches ?? [],
  session.callFrameTracing
);
```

Do not change `interpretTrace()`.

- [ ] **Step 2: Update TraceVisualizer to import the core helper**

Keep:

```ts
createTraceVisualizer(session)
```

backward compatible.

- [ ] **Step 3: Add one regression session containing all optional evidence channels**

Assert the helper forwards:

- expression;
- decision;
- control flow;
- function plan;
- call frames;
- termination context.

- [ ] **Step 4: Run**

```bash
npx vitest run   tests/core/trace-session-interpreter.test.ts   tests/sidepanel/trace-visualizer.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add   src/core/trace-session-interpreter.ts   src/sidepanel/components/TraceVisualizer.ts   tests/core/trace-session-interpreter.test.ts   tests/sidepanel/trace-visualizer.test.ts
git commit -m "refactor: share trace session interpretation"
```

---

# Task 1: Add Exact Accepted-Run Provenance to LiveExecutionScheduler

**Why:** A session may finish after Case selection/editor/problem state has already changed. Comparison context must describe the input that actually produced the accepted session.

**Files:**
- Modify: `src/execution/live-execution-scheduler.ts`
- Modify: `tests/execution/live-execution-scheduler.test.ts`
- Modify: `src/sidepanel/bootstrap.ts`
- Modify: `tests/sidepanel/bootstrap.test.ts`

## Extend input

```ts
export interface LiveExecutionInput {
  language: string;
  sourceCode: string;
  rawTestcase: string;
  selectedCaseIndex: number;
  problemSlug: string | null;
  problemTitle: string | null;
}
```

`problemSlug` participates in `inputKey()`.

`problemTitle` does not need to participate in identity.

## Accepted provenance

Prefer backward-compatible callback shape:

```ts
export interface AcceptedLiveSession {
  revision: number;
  input: LiveExecutionInput;
  selectedTestcase: string;
  request: ExecutionRequest;
}

onSession?: (
  session: TraceSession,
  accepted: AcceptedLiveSession
) => void;
```

A callback accepting only `session` remains valid TypeScript usage.

- [ ] **Step 1: Store an immutable input snapshot on AcceptedRun**

Change internal run structure to include the exact accepted input and selected testcase.

Do not retain a mutable object owned by the caller.

- [ ] **Step 2: Add problem slug to input deduplication**

Test:

```text
same language/source/testcase/case
different problemSlug
→ second execution is not suppressed
```

- [ ] **Step 3: Emit provenance only for an accepted latest runnable run**

When a stale run finishes, it must still be suppressed exactly as today.

It must never reach comparison state.

- [ ] **Step 4: Test Case provenance race**

Scenario:

```text
Case 1 starts
Case selector changes to Case 2
Case 1 completes later
Case 2 is latest accepted
```

Assert any emitted accepted metadata matches the run that actually emitted, never current UI selection by accident.

- [ ] **Step 5: Populate problem identity from Side Panel**

When scheduling a LeetCode snapshot:

```ts
problemSlug: currentPageState?.metadata.slug ?? null
problemTitle: currentPageState?.metadata.title ?? null
```

For the developer/sample harness use a deterministic local identity such as:

```text
sample
```

or null with diff controls disabled.

- [ ] **Step 6: Run**

```bash
npx vitest run   tests/execution/live-execution-scheduler.test.ts   tests/sidepanel/bootstrap.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add   src/execution/live-execution-scheduler.ts   tests/execution/live-execution-scheduler.test.ts   src/sidepanel/bootstrap.ts   tests/sidepanel/bootstrap.test.ts
git commit -m "feat: preserve live run provenance"
```

---

# Task 2: Define RunRecord, Compatibility, and Baseline Lifecycle State

**Files:**
- Create: `src/sidepanel/run-comparison-state.ts`
- Create: `tests/sidepanel/run-comparison-state.test.ts`

## Core Side Panel types

```ts
export interface RunContext {
  problemSlug: string;
  problemTitle?: string;
  selectedCaseIndex: number;
  language: string;
}

export interface RunRecord {
  session: TraceSession;
  context: RunContext;
}

export type ComparisonCompatibility =
  | { status: "compatible" }
  | { status: "no_baseline" }
  | { status: "no_current" }
  | { status: "same_run" }
  | { status: "different_problem" }
  | { status: "different_testcase" }
  | { status: "different_entrypoint" }
  | { status: "unsupported_schema" }
  | { status: "unsupported_runtime" };
```

- [ ] **Step 1: Normalize testcase line endings only**

```ts
normalizeExecutedTestcase(text)
```

Normalize `\r\n` / `\r` → `\n`.

Do not trim meaningful testcase content or parse/re-serialize values.

- [ ] **Step 2: Implement entrypoint compatibility**

Compare factual contract fields:

- className;
- methodName;
- parameterCount;
- parameterKinds.

- [ ] **Step 3: Implement run compatibility**

Required tests:

```text
same slug + same testcase + entrypoint → compatible
different source → still compatible
different status → still compatible
different slug → incompatible
different testcase → incompatible
different entrypoint → incompatible
same sessionId → same_run
```

- [ ] **Step 4: Add baseline state container**

Use a small explicit controller, for example:

```ts
export interface RunComparisonState {
  baseline: RunRecord | null;
  current: RunRecord | null;
}

export function createRunComparisonState(): {
  get(): RunComparisonState;
  setCurrent(run: RunRecord): void;
  pinCurrent(): boolean;
  replaceBaseline(): boolean;
  clearBaseline(): void;
  clearForProblemChange(): void;
}
```

No persistence.

- [ ] **Step 5: Assert baseline behavior**

```text
pin current
→ baseline === current reference record

set newer current
→ baseline unchanged

clear
→ baseline null

replace
→ baseline becomes latest accepted current
```

- [ ] **Step 6: Run**

```bash
npx vitest run tests/sidepanel/run-comparison-state.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add   src/sidepanel/run-comparison-state.ts   tests/sidepanel/run-comparison-state.test.ts
git commit -m "feat: model pinned baseline run state"
```

---

# Task 3: Implement Conservative Cross-Run Value Comparison

**Files:**
- Create: `src/core/cross-run-value.ts`
- Create: `tests/core/cross-run-value.test.ts`

## API

```ts
export type CrossRunValueComparison =
  | { status: "equal" }
  | { status: "different"; detail?: string }
  | { status: "incomparable"; reason: string };

export function compareCrossRunValues(
  baseline: ValueSnapshot,
  current: ValueSnapshot
): CrossRunValueComparison;
```

Also expose a stable canonical key helper only for values where it is safe:

```ts
export function stableCrossRunValueKey(
  value: ValueSnapshot
): string | null;
```

- [ ] **Step 1: Scalars**

Compare:

- int;
- float;
- bool;
- non-truncated strings;
- None.

Different snapshot types are factual differences unless both are opaque/reference categories where identity semantics are unavailable.

- [ ] **Step 2: Strings**

Rules:

- complete equal strings → equal;
- complete different strings → different;
- truncated matching visible prefix without proof of total equality → incomparable;
- proven different length/content → different.

- [ ] **Step 3: List/Tuple recursion**

Respect:

- length;
- truncation;
- element comparison.

A child `different` proves different.

No child differences + any incomparable child → incomparable.

- [ ] **Step 4: Dict**

Canonicalize only safe keys.

Do not depend on dict entry iteration order.

Opaque/reference/cycle keys → incomparable.

- [ ] **Step 5: Set**

Canonicalize safe comparable members and compare unordered.

- [ ] **Step 6: References**

Rules:

```text
same className → incomparable identity
different className → different
same textual objectId across runs → still incomparable
```

- [ ] **Step 7: unknown/cycle**

Return incomparable by default.

Do not compare `repr` or `referenceId` as semantic identity.

- [ ] **Step 8: Tests**

Required cases from spec, including explicit regression:

```ts
expect(compareCrossRunValues(
  { type: "reference", objectId: "obj-1", className: "TreeNode" },
  { type: "reference", objectId: "obj-1", className: "TreeNode" }
)).toEqual(expect.objectContaining({ status: "incomparable" }));
```

- [ ] **Step 9: Commit**

```bash
git add   src/core/cross-run-value.ts   tests/core/cross-run-value.test.ts
git commit -m "feat: compare cross run values conservatively"
```

---

# Task 4: Build Stable Cross-Run Function Identity and Hierarchical Frame Alignment

**Files:**
- Create: `src/core/cross-run-alignment.ts`
- Create: `tests/core/cross-run-alignment.test.ts`

## Types

```ts
export type AlignmentConfidence =
  | "strong"
  | "structural"
  | "fallback"
  | "ambiguous";

export interface CrossRunFunctionIdentity {
  key: string;
  displayName: string;
  qualifiedName?: string;
  confidence: Exclude<AlignmentConfidence, "ambiguous">;
}

export interface AlignedFramePair {
  baselineFrameId: number;
  currentFrameId: number;
  functionKey: string;
  confidence: AlignmentConfidence;
  baselineChildOrdinal: number;
  currentChildOrdinal: number;
}
```

- [ ] **Step 1: Build descriptor lookup per run**

Map `frame.functionId` to that run's `FunctionDescriptor`.

Never compare function IDs across runs.

- [ ] **Step 2: Stable function key**

Preferred:

```text
kind
qualifiedName
parameter names/kinds
```

Do not include span/line/column.

Fallback runtime name gets `fallback` confidence.

- [ ] **Step 3: Root alignment**

Align roots in factual root order using stable function identities.

If multiple unresolved candidates make the pairing ambiguous, return an alignment stop rather than choosing one.

- [ ] **Step 4: Child alignment under an aligned parent**

For each stable function key, assign occurrence ordinal in the parent's factual `childFrameIds` order:

```text
helper occurrence 1
helper occurrence 2
```

Pair same-key/same-ordinal children.

- [ ] **Step 5: Recursion**

Use exactly the same parent + function key + occurrence rule.

No special matching by recursion depth or return value.

- [ ] **Step 6: Tests**

Required:

- source line shift keeps strong identity;
- direct recursive chain;
- mutual recursion;
- repeated same-name siblings;
- same runtime short name / different qualified parent;
- renamed function does not silently align;
- functionPlan missing → fallback name identity;
- ambiguous fallback → stop;
- inserted same-function call behaves according to ordinal policy documented in spec.

- [ ] **Step 7: Commit**

```bash
git add   src/core/cross-run-alignment.ts   tests/core/cross-run-alignment.test.ts
git commit -m "feat: align call frames across runs"
```

---

# Task 5: Project One Interpreted Run Into Behavioral Checkpoints

**Files:**
- Create: `src/core/cross-run-checkpoints.ts`
- Create: `src/core/source-span-text.ts`
- Create: `tests/core/cross-run-checkpoints.test.ts`
- Create: `tests/core/source-span-text.test.ts`

**Inputs:**

```ts
TraceSession
TraceInterpretation
cross-run function identity index
```

**Output:**

Per concrete frame:

```ts
export interface CrossRunFrameProjection {
  frameId: number;
  functionIdentity: CrossRunFunctionIdentity;
  entry: FrameEntryCheckpoint;
  checkpoints: BehavioralCheckpoint[];
  childFrameIds: number[];
  exit: FrameExitCheckpoint;
}
```

## Checkpoint kinds

Start with:

```ts
type BehavioralCheckpoint =
  | DecisionCheckpoint
  | ExpressionCheckpoint
  | LoopIterationCheckpoint
  | TransferCheckpoint
  | LoopExitCheckpoint
  | MutationCheckpoint
  | ChildCallCheckpoint;
```

Frame entry/exit may remain dedicated fields but participate in comparison order.

- [ ] **Step 1: Add source-span slicing helper**

Control-flow descriptors do not currently carry source text.

Implement a deterministic helper that maps `SourceSpan` to normalized source text using `session.sourceCode`.

Test multiline and line-shift behavior.

Do not parse Python again.

- [ ] **Step 2: Semantic text normalization**

Create one explicit function:

```ts
normalizeCrossRunSource(text)
```

Allowed normalization:

- line endings;
- trim surrounding whitespace;
- collapse non-semantic whitespace where tested safe.

Do not rename variables, literals, operators, or AST-equivalent expressions.

- [ ] **Step 3: Decision checkpoints**

For each `DecisionStepEvidence`:

semantic key should include:

- decision site kind from `ConditionPlan`;
- normalized root condition source;
- occurrence ordinal within aligned frame.

Payload includes:

- truth;
- outcome;
- status;
- supported operand values/source.

Never use `siteId` as cross-run key.

- [ ] **Step 4: Expression checkpoints**

Use:

- root kind assignment/return;
- normalized root expression source;
- occurrence ordinal.

Payload includes:

- final expression value when available;
- min/max selection result/candidate index only where both evidence layers can compare safely.

Never use `rootId` or `exprId` as cross-run identity.

- [ ] **Step 5: Control-flow checkpoints**

Use static plan span text + loop/transfer kind.

Project:

- iteration begin/bindings;
- iteration terminal status;
- transfer committed/superseded/interrupted;
- loop exit reason.

Keep concrete `frameId` for run-local ownership only.

- [ ] **Step 6: Mutation checkpoints**

Supported stable targets:

```text
variable
sequence_element
mapping_entry with stable key
set_membership with stable member
local-owned reference
```

Explicitly skip as cross-run comparable checkpoints:

```text
object_attribute
object_visibility
object-owned reference
```

Track skipped/incomparable coverage counts.

- [ ] **Step 7: Child-call checkpoints**

From CallFrameModel:

```text
child call step
stable callee identity
occurrence ordinal under parent
run-local child frameId
```

- [ ] **Step 8: Stable same-step precedence**

Use an exported constant/order function.

Recommended initial precedence:

```text
decision
expression
loop_iteration
transfer
loop_exit
mutation
child_call
```

Sort by:

```text
anchorStep
then precedence
then stable local sequence
```

- [ ] **Step 9: Frame exit projection**

Preserve factual exit status and value/exception/reason.

If trace-ended has no anchor step, keep it as terminal frame evidence without inventing a raw navigation step.

- [ ] **Step 10: Run tests**

```bash
npx vitest run   tests/core/source-span-text.test.ts   tests/core/cross-run-checkpoints.test.ts
```

- [ ] **Step 11: Commit**

```bash
git add   src/core/cross-run-checkpoints.ts   src/core/source-span-text.ts   tests/core/cross-run-checkpoints.test.ts   tests/core/source-span-text.test.ts
git commit -m "feat: project behavioral checkpoints across runs"
```

---

# Task 6: Implement Comparison Compatibility, Coverage, and Prepared-Run Cache Model

**Files:**
- Create: `src/core/cross-run-diff-types.ts`
- Create: `src/core/cross-run-prepare.ts`
- Create: `tests/core/cross-run-prepare.test.ts`

## Prepared run

```ts
export interface PreparedCrossRun {
  session: TraceSession;
  interpretation: TraceInterpretation;
  frames: Map<number, CrossRunFrameProjection>;
  roots: number[];
  coverage: CrossRunCoverage;
}
```

`prepareCrossRun(session, interpretation?)` should accept an already-computed interpretation to avoid duplicate work.

- [ ] **Step 1: Coverage conversion**

Map tracing states:

```text
complete → complete
truncated → partial
unavailable → unavailable
missing legacy channel → unavailable or partial according to existing schema semantics
```

Mutation coverage is based on available raw reconstructed runtime states.

- [ ] **Step 2: Track incomparable/skipped values**

Coverage should expose at least:

```ts
values: {
  incomparableCount: number;
}
mutations: {
  status: "complete" | "partial";
  skippedUnstableObjectMutations: number;
}
```

Exact type may be refined but the UI must be able to distinguish unsupported coverage from “no differences”.

- [ ] **Step 3: Do not mutate TraceInterpretation**

Prepared projections are derived.

- [ ] **Step 4: Baseline cache friendliness**

PreparedCrossRun must be immutable-by-convention and safe to retain while the baseline stays pinned.

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/core/cross-run-prepare.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add   src/core/cross-run-diff-types.ts   src/core/cross-run-prepare.ts   tests/core/cross-run-prepare.test.ts
git commit -m "feat: prepare runs for behavioral diff"
```

---

# Task 7: Implement the First-Divergence Engine

**Files:**
- Create: `src/core/cross-run-diff.ts`
- Create: `tests/core/cross-run-diff.test.ts`

## Public API

Conceptually:

```ts
export function compareCrossRuns(
  baseline: PreparedCrossRun,
  current: PreparedCrossRun,
  compatibility: ComparisonCompatibility
): CrossRunDiffResult;
```

## Result

```ts
export interface CrossRunDiffResult {
  compatibility: ComparisonCompatibility;
  alignedPrefix: {
    frameCount: number;
    checkpointCount: number;
    callPath: string[];
  };
  firstDivergence?: CrossRunDivergence;
  coverage: CrossRunCoverage;
  stopReason?: ComparisonStopReason;
}
```

- [ ] **Step 1: Short-circuit incompatible/same-run cases**

No alignment work for:

- no baseline;
- different problem/testcase/entrypoint;
- same captured session;
- unsupported schema/runtime.

- [ ] **Step 2: Frame-entry argument comparison**

For aligned frames compare declared bound arguments by name/order.

Use `compareCrossRunValues()`.

Incomparable reference arguments do not become a divergence.

A proven changed scalar/container argument may be first divergence.

- [ ] **Step 3: Ordered checkpoint walk**

Implement deterministic bounded lookahead:

```ts
export const CROSS_RUN_ALIGNMENT_LOOKAHEAD = 8;
```

Rules:

1. same semantic key → compare payload;
2. mismatch → look ahead on both sides for a unique key match;
3. one-sided unmatched supported checkpoint before unique match → presence/structure divergence;
4. multiple possible matches → ambiguous stop;
5. no unique match in window → alignment stop / structural divergence if the evidence itself proves different next behavior.

- [ ] **Step 4: Recursively compare aligned child frames at child-call position**

Critical ordering:

```text
parent checkpoint
→ child call
→ compare child frame recursively
→ child return
→ resume parent
```

A divergence inside the child wins over a later parent mutation.

- [ ] **Step 5: Decision comparison**

Support:

- truth changed;
- outcome changed;
- completion changed;
- comparable operand changed;
- decision structure changed.

Changed normalized source is not silently aligned as the same decision.

- [ ] **Step 6: Expression comparison**

Support only aligned same-source/root-role checkpoints.

A source structural mismatch becomes a boundary rather than arbitrary value comparison.

- [ ] **Step 7: Control-flow comparison**

Support:

- iteration bindings;
- iteration terminal status;
- transfer state;
- loop exit reason.

No “premature” or “wrong” wording in core enums/prose.

- [ ] **Step 8: Mutation comparison**

Compare stable target keys and before/after/member values conservatively.

If an unsupported object mutation occurs, skip it and update coverage.

Do not let skipped object mutation block later safe comparisons unless ordering cannot be established safely.

- [ ] **Step 9: Frame exit comparison**

Support:

- returned vs returned value;
- returned vs exception;
- exception type;
- trace-ended reason;
- status transition.

- [ ] **Step 10: Session outcome fallback**

Only when no earlier frame-local divergence exists.

- [ ] **Step 11: No-divergence result**

Exact semantic meaning:

```text
No firstDivergence
+
coverage describes what was comparable
```

Never return `equivalent: true`.

- [ ] **Step 12: Truncation handling**

Tests:

- divergence before truncation remains returned;
- no divergence before coverage end → `stopReason = coverage_ended`;
- ambiguity → `stopReason = ambiguous_alignment`.

- [ ] **Step 13: Core acceptance tests**

Required scenarios:

1. binary-search decision same but following mutation differs;
2. changed decision truth;
3. recursive child divergence before parent mutation;
4. recursive return changed;
5. extra child call;
6. same supported behavior after source refactor;
7. timeout vs returned;
8. TreeNode reference IDs differ but do not generate false divergence;
9. different status but comparable prefix;
10. later dramatic return difference does not replace earlier decision divergence.

- [ ] **Step 14: Run**

```bash
npx vitest run   tests/core/cross-run-value.test.ts   tests/core/cross-run-alignment.test.ts   tests/core/cross-run-checkpoints.test.ts   tests/core/cross-run-prepare.test.ts   tests/core/cross-run-diff.test.ts
```

- [ ] **Step 15: Commit**

```bash
git add   src/core/cross-run-diff.ts   tests/core/cross-run-diff.test.ts
git commit -m "feat: find first behavioral divergence"
```

---

# Task 8: Integrate Baseline Lifecycle Into Side Panel Without Changing Live Semantics

**Files:**
- Modify: `src/sidepanel/bootstrap.ts`
- Modify: `tests/sidepanel/bootstrap.test.ts`
- Modify: `src/sidepanel/run-comparison-state.ts`

## State

Inside `renderSidePanel()`:

```ts
const comparisonState = createRunComparisonState();
let baselinePrepared: PreparedCrossRun | null = null;
let currentPrepared: PreparedCrossRun | null = null;
```

Only accepted scheduler sessions enter this state.

- [ ] **Step 1: Build RunRecord from scheduler provenance**

Do not read selectedCaseIndex/problem metadata from mutable current UI state after the run finishes.

Use the accepted provenance callback.

- [ ] **Step 2: Prepare current once**

On accepted session:

```text
interpretTraceSession(session)
→ prepareCrossRun(...)
→ set current
→ create TraceVisualizer using the same interpretation if supported
→ recompute diff if baseline exists
```

Avoid interpreting current twice.

- [ ] **Step 3: Extend TraceVisualizer options for precomputed interpretation**

Backward compatible API:

```ts
export interface TraceVisualizerOptions {
  interpretation?: TraceInterpretation;
  comparison?: BehavioralDiffViewModel | null;
  comparisonActions?: ...
}

createTraceVisualizer(
  session: TraceSession,
  options: TraceVisualizerOptions = {}
)
```

Existing tests/callers using one argument remain valid.

- [ ] **Step 4: Baseline problem lifecycle**

On confirmed different problem:

```text
clear current visualizer as today
clear baseline
clear baselinePrepared
clear comparison UI state
```

Do not clear baseline merely because source changes.

- [ ] **Step 5: Case switch**

Retain baseline.

Current accepted Case 2 run becomes incompatible against Case 1 baseline.

Returning to Case 1 may become compatible again.

- [ ] **Step 6: Paused/non-LeetCode active tab**

Do not silently replace baseline.

Comparison is dormant while no current compatible LeetCode run is active.

- [ ] **Step 7: Stale run regression**

A stale async session rejected by scheduler never enters comparison state.

- [ ] **Step 8: Tests**

Add Side Panel tests for:

- pin later task can rely on exact RunRecord;
- problem switch clears;
- source edit does not clear;
- case switch retains;
- stale result cannot replace current;
- current prepared analysis corresponds to accepted run provenance.

- [ ] **Step 9: Commit**

```bash
git add   src/sidepanel/bootstrap.ts   tests/sidepanel/bootstrap.test.ts   src/sidepanel/run-comparison-state.ts
git commit -m "feat: retain pinned baseline across live runs"
```

---

# Task 9: Add Baseline Controls

**Files:**
- Create: `src/sidepanel/components/BaselineControls.ts`
- Create: `tests/sidepanel/baseline-controls.test.ts`
- Modify: `src/sidepanel/bootstrap.ts`
- Modify: `src/sidepanel/styles.css`

## UI

Before baseline:

```text
[Pin baseline]
```

After baseline:

```text
Baseline pinned · Case 1
[Replace] [Clear]
```

Optional metadata:

```text
completed
Source differs from baseline
```

- [ ] **Step 1: Pure component contract**

```ts
interface BaselineControlsModel {
  hasCurrent: boolean;
  hasBaseline: boolean;
  caseLabel?: string;
  baselineStatus?: TraceSessionStatus;
  sourceDiffers: boolean;
}

interface BaselineControlsOptions {
  model: BaselineControlsModel;
  onPin(): void;
  onReplace(): void;
  onClear(): void;
}
```

Return a persistent handle with `update()`.

- [ ] **Step 2: Never use correctness labels**

No:

```text
good
correct
passing
expected
```

- [ ] **Step 3: Disable Pin if no accepted current run**

Editor text alone is not pinnable.

- [ ] **Step 4: Pin behavior**

Pin does not rerun.

Pin current RunRecord + prepared analysis already in memory.

- [ ] **Step 5: Replace behavior**

Replace baseline with latest accepted current and release old prepared baseline references.

- [ ] **Step 6: Clear behavior**

Remove baseline/diff but leave current TraceVisualizer untouched.

- [ ] **Step 7: Placement**

Put controls in Side Panel run/trace area close to the visualization output.

Do not put them inside Decision/Execution Story.

- [ ] **Step 8: Tests + commit**

```bash
npx vitest run   tests/sidepanel/baseline-controls.test.ts   tests/sidepanel/bootstrap.test.ts
```

```bash
git add   src/sidepanel/components/BaselineControls.ts   tests/sidepanel/baseline-controls.test.ts   src/sidepanel/bootstrap.ts   src/sidepanel/styles.css
git commit -m "feat: add pinned baseline controls"
```

---

# Task 10: Build Behavioral Diff Presentation Model and Component

**Files:**
- Create: `src/sidepanel/behavioral-diff-view.ts`
- Create: `src/sidepanel/components/BehavioralDiff.ts`
- Create: `tests/sidepanel/behavioral-diff-view.test.ts`
- Create: `tests/sidepanel/behavioral-diff.test.ts`
- Modify: `src/sidepanel/styles.css`

## Presentation model

Keep core enum/data separate from prose.

```ts
export interface BehavioralDiffViewModel {
  summary: string;
  compatibility: ComparisonCompatibility;
  sourceDiffers: boolean;
  baselineLabel: string;
  currentLabel: string;
  matchedPrefix?: {
    frames: number;
    checkpoints: number;
    callPath: string[];
  };
  divergence?: {
    categoryLabel: string;
    locationLabel?: string;
    baseline?: BehavioralDiffSide;
    current?: BehavioralDiffSide;
    currentStep?: number;
    confidence: AlignmentConfidence;
  };
  coverageMessage?: string;
}
```

- [ ] **Step 1: Map compatibility copy**

Required:

```text
No baseline pinned.
Baseline is the current captured run.
The current testcase differs from the pinned baseline.
Baseline is for a different problem.
Baseline uses a different entrypoint.
```

- [ ] **Step 2: Map divergence copy**

Neutral examples:

```text
Decision result changed
Frame argument changed
Different child call observed
Return value changed
Loop exit reason changed
Mutation value changed
Frame outcome changed
```

Never “wrong/correct/root cause/fix”.

- [ ] **Step 3: No-divergence copy**

Exact spirit:

```text
No behavioral divergence observed in comparable captured evidence.
```

If coverage ended:

```text
No divergence observed before comparison coverage ended.
```

- [ ] **Step 4: Side-by-side / stacked DOM**

Use semantic sections:

```text
Baseline
...
Current
...
```

CSS should naturally stack in the narrow Side Panel.

Do not rely on green/red.

- [ ] **Step 5: Matched prefix**

Show:

```text
Matched before divergence
3 frames · 8 checkpoints
solve → search
```

- [ ] **Step 6: Inspect current**

Render only when the current divergence has an authoritative raw step.

Callback:

```ts
onInspectCurrent(step)
```

No baseline inspect button in v0.1.

- [ ] **Step 7: Coverage/ambiguity**

Show neutral detail for:

- partial decision channel;
- partial call frames;
- incomparable values;
- ambiguous alignment.

- [ ] **Step 8: Accessibility**

Buttons are real buttons.

Baseline/current headings are textual.

Do not make difference understandable only by color.

- [ ] **Step 9: Tests + commit**

```bash
npx vitest run   tests/sidepanel/behavioral-diff-view.test.ts   tests/sidepanel/behavioral-diff.test.ts
```

```bash
git add   src/sidepanel/behavioral-diff-view.ts   src/sidepanel/components/BehavioralDiff.ts   tests/sidepanel/behavioral-diff-view.test.ts   tests/sidepanel/behavioral-diff.test.ts   src/sidepanel/styles.css
git commit -m "feat: render first behavioral divergence"
```

---

# Task 11: Integrate Behavioral Diff Into TraceVisualizer With the Existing Current Cursor

**Files:**
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`

## Handle extension

```ts
export interface TraceVisualizerHandle {
  element: HTMLElement;
  setStep(index: number): void;
  setBehavioralDiff(model: BehavioralDiffViewModel | null): void;
  dispose(): void;
}
```

Use a persistent BehavioralDiff component/slot.

- [ ] **Step 1: Panel placement**

Order:

```text
Code
Visual State
Execution Story
Behavioral Diff
Decision Evidence
Expression Evidence
What Changed
...
```

If no baseline is pinned, the panel may be absent/hidden.

Once a baseline exists, keep the panel mounted so disclosure state survives model updates.

- [ ] **Step 2: Default collapsed**

Do not auto-open on every live rerun.

- [ ] **Step 3: Preserve panel disclosure state**

`setBehavioralDiff()` updates body/title only.

Never replace the `<details>` node.

- [ ] **Step 4: Compact title**

Examples:

```text
Behavioral Diff · decision changed
Behavioral Diff · return changed
Behavioral Diff · no divergence observed
Behavioral Diff · incompatible testcase
Behavioral Diff · comparison incomplete
```

- [ ] **Step 5: Inspect current uses raw step lookup**

The component emits `currentStep`.

Visualizer resolves:

```ts
const index = traceIndex.stepToIndex.get(step);
if (index !== undefined) navigateDirect(index);
```

No nearest-step fallback.

- [ ] **Step 6: Verify all existing panels synchronize naturally**

After Inspect current:

- Code line;
- Visual State;
- Execution Story;
- Decision;
- Expression;
- What Changed;
- Call Stack;
- timeline/outline;

all update through existing `setStep()`.

- [ ] **Step 7: Regression**

Failure-First selection unchanged.

Behavioral Timeline lanes unchanged.

Call Tree unchanged.

Raw Previous/Next/Play unchanged.

- [ ] **Step 8: Tests + commit**

```bash
npx vitest run tests/sidepanel/trace-visualizer.test.ts
```

```bash
git add   src/sidepanel/components/TraceVisualizer.ts   tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: integrate behavioral diff with trace cursor"
```

---

# Task 12: Wire Live Recompute and Baseline Cache

**Files:**
- Modify: `src/sidepanel/bootstrap.ts`
- Modify: `tests/sidepanel/bootstrap.test.ts`

## Recompute flow

On accepted current:

```text
accepted session + exact provenance
    ↓
RunRecord
    ↓
interpret once
    ↓
PreparedCrossRun
    ↓
comparisonState.current = record
    ↓
if baseline:
    compare prepared baseline vs prepared current
    ↓
build BehavioralDiffViewModel
    ↓
activeVisualizer.setBehavioralDiff(...)
```

- [ ] **Step 1: Pin cache**

When Pin is clicked:

```text
baseline record = current record
baseline prepared = current prepared
```

No recomputation required.

- [ ] **Step 2: New current**

Keep baseline prepared object.

Prepare only new current.

- [ ] **Step 3: Editor change before accepted run**

The displayed diff continues to describe the latest accepted current run.

Do not recompute against unexecuted editor text.

- [ ] **Step 4: Source differs flag**

Exact source string inequality:

```ts
baseline.session.sourceCode !== current.session.sourceCode
```

is display metadata only.

- [ ] **Step 5: Case incompatibility**

New accepted Case 2 current should update Diff UI to incompatible without deleting Case 1 baseline.

- [ ] **Step 6: Return to compatible Case**

Recompute automatically against the same pinned baseline.

- [ ] **Step 7: Replace/Clear**

Replace resets cached baseline to current.

Clear releases baseline record + prepared baseline + diff state.

- [ ] **Step 8: Tests**

Required Side Panel scenarios:

1. no baseline → no analysis;
2. pin current;
3. edit + accepted current → diff recomputed;
4. edit without accepted run → old diff unchanged;
5. stale async run ignored;
6. case change incompatible;
7. return to baseline case compatible;
8. replace baseline;
9. clear baseline;
10. problem switch clears;
11. diff panel disclosure survives model refresh.

- [ ] **Step 9: Commit**

```bash
git add   src/sidepanel/bootstrap.ts   tests/sidepanel/bootstrap.test.ts
git commit -m "feat: recompute diff against pinned baseline"
```

---

# Task 13: End-to-End Behavioral Diff Acceptance Scenarios

**Files:**
- Create: `tests/core/cross-run-scenarios.test.ts`
- Create: `tests/sidepanel/behavioral-diff-integration.test.ts`
- Modify as needed: existing fixtures/tests

Do not add new Python instrumentation solely for the diff.

- [ ] **Scenario A: Binary search mutation divergence**

Baseline/current produce same early decision truth but mutate opposite pointer.

Expected first divergence:

```text
mutation target/value
```

not the later return.

- [ ] **Scenario B: Decision truth changes**

Expected first divergence:

```text
decision_truth_changed
```

with current raw anchor navigable.

- [ ] **Scenario C: LeetCode 104 recursive return change**

Use a baseline/current pair where the recurrence result changes.

Verify:

- recursive frames align despite source line shifts;
- TreeNode object IDs do not create false argument divergence;
- expression structural mismatch is conservative;
- return divergence appears only if no earlier supported divergence exists.

- [ ] **Scenario D: Extra recursive call**

Verify additional current child call is factual first divergence when proven.

No “missing base case”.

- [ ] **Scenario E: Same supported behavior after refactor**

Source differs.

Required:

```text
source differs
no behavioral divergence observed in comparable captured evidence
```

- [ ] **Scenario F: Different testcase**

Comparison incompatible.

No checkpoint alignment runs.

- [ ] **Scenario G: Timeout**

Baseline return vs current hard timeout/trace-ended.

No TLE/infinite-recursion wording.

- [ ] **Scenario H: Partial evidence**

Decision/expression channel truncates after a known earlier divergence.

Known divergence still wins.

- [ ] **Scenario I: Ambiguous fallback**

No arbitrary pairing.

Comparison stops as ambiguous.

- [ ] **Run**

```bash
npx vitest run   tests/core/cross-run-scenarios.test.ts   tests/sidepanel/behavioral-diff-integration.test.ts
```

- [ ] **Commit**

```bash
git add   tests/core/cross-run-scenarios.test.ts   tests/sidepanel/behavioral-diff-integration.test.ts
git commit -m "test: validate cross run behavioral diff scenarios"
```

---

# Task 14: Product-Boundary, Accessibility, and Performance Audit

**Files:**
- Modify as needed:
  - `src/core/cross-run-*.ts`
  - `src/sidepanel/components/BehavioralDiff.ts`
  - `src/sidepanel/components/BaselineControls.ts`
  - `src/sidepanel/styles.css`
  - tests

- [ ] **Step 1: Search prohibited inference copy**

```bash
grep -RniE   "baseline is correct|correct run|wrong run|root cause|fix this|should have|should call|should return|bug introduced|infinite recursion|LeetCode TLE|expected path|good run|bad run"   src/core src/sidepanel tests
```

Review contextual fixture hits manually.

- [ ] **Step 2: Audit run-local identifiers**

Search new cross-run core code for direct equality involving:

```text
frameId
functionId
siteId
loopId
transferId
objectId
step
```

Every occurrence must be justified as **within-run ownership/navigation**, not cross-run semantic identity.

- [ ] **Step 3: Performance**

Add a synthetic fixture with:

- hundreds of frames;
- thousands of checkpoints.

Assert comparison stays bounded by the lookahead algorithm and does not perform all-pairs checkpoint matching.

Do not assert brittle millisecond timing in CI; assert algorithmic call/count bounds where practical.

- [ ] **Step 4: Accessibility**

Verify:

- Pin/Replace/Clear are buttons;
- Inspect current is button;
- Baseline/Current headings exist;
- panel uses text for changed/incomplete/incompatible;
- no color-only semantics;
- disclosure state remains accessible.

- [ ] **Step 5: Memory lifecycle**

Tests should prove Clear/Replace/problem switch releases old baseline references from the comparison state/cache.

No run history array.

- [ ] **Step 6: Commit**

```bash
git add   src/core   src/sidepanel   tests
git commit -m "test: harden cross run diff boundaries"
```

---

# Task 15: Full Regression and Completion Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-cross-run-behavioral-diff-design.md`
- Optional modify: `README.md`
- Optional modify: `README.zh-TW.md`

- [ ] **Step 1: Python fixture suite**

```bash
python3 -m unittest discover -s tests/fixtures/python -p "test_*.py"
```

Expected: PASS.

Cross-run diff should require no new Python runtime instrumentation.

- [ ] **Step 2: Full Vitest**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Production build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Manual extension smoke flow**

Use one LeetCode problem, preferably a small binary-search case first:

```text
1. run baseline code
2. Pin baseline
3. modify one branch/mutation
4. wait for accepted live run
5. Behavioral Diff appears
6. inspect first divergence
7. raw cursor navigates correctly
8. Visual State and evidence panels synchronize
9. undo edit / make equivalent refactor
10. verify neutral no-divergence wording
11. change testcase
12. verify incompatible state
13. switch problem
14. verify baseline cleared
```

Also test LeetCode 104 to validate recursive frame alignment with TreeNode references.

- [ ] **Step 6: Update spec status**

Append:

```markdown
# Implementation Status

Implemented:
- explicit pinned baseline lifecycle;
- exact accepted-run provenance;
- shared TraceSession interpretation;
- stable hierarchical call-frame alignment;
- tri-state cross-run value comparison;
- decision/expression/control-flow/stable-mutation checkpoints;
- bounded first-divergence comparison;
- coverage/ambiguity handling;
- Behavioral Diff panel;
- current-side raw cursor navigation;
- same-problem/same-testcase compatibility policy.

Deferred:
- Case 1 vs Case 2 mode;
- arbitrary history;
- persistent baselines;
- baseline raw-cursor inspection;
- synchronized dual visualizers;
- judge/expected-output comparison;
- cross-run object identity alignment.
```

- [ ] **Step 7: README only after fully green**

Suggested capability line:

```text
- **Pinned baseline behavioral diff:** pin one captured run and compare later executions of the same testcase to surface the earliest safely aligned difference in calls, decisions, control flow, stable mutations, expressions, or frame outcomes.
```

Do not say “finds the bug”.

- [ ] **Step 8: Commit docs**

```bash
git add   docs/superpowers/specs/2026-09-20-cross-run-behavioral-diff-design.md   README.md   README.zh-TW.md
git commit -m "docs: record cross run behavioral diff completion"
```

Omit README files if intentionally unchanged.

---

# Dependency Order

```text
Task 0  shared TraceSession interpreter
   ↓
Task 1  exact live-run provenance
   ↓
Task 2  RunRecord + compatibility + baseline state

Task 3  value comparator
   ↓
Task 4  frame alignment
   ↓
Task 5  checkpoint projection
   ↓
Task 6  prepared-run / coverage model
   ↓
Task 7  first-divergence engine

Task 8  Side Panel state integration
   ↓
Task 9  baseline controls
   ↓
Task 10 Behavioral Diff component
   ↓
Task 11 TraceVisualizer cursor integration
   ↓
Task 12 live recompute + baseline cache
   ↓
Task 13 end-to-end scenarios
   ↓
Task 14 boundary/accessibility/performance audit
   ↓
Task 15 full regression + docs
```

Tasks 3 and the UI-independent part of Task 2 can proceed in parallel after Task 0/1 contracts are understood.

Do not start Task 10 from mocked prose-only divergence objects before Task 7's result contract is stable unless the mock exactly follows the final typed interface.

---

# Recommended Commit Sequence

```text
refactor: share trace session interpretation
feat: preserve live run provenance
feat: model pinned baseline run state
feat: compare cross run values conservatively
feat: align call frames across runs
feat: project behavioral checkpoints across runs
feat: prepare runs for behavioral diff
feat: find first behavioral divergence
feat: retain pinned baseline across live runs
feat: add pinned baseline controls
feat: render first behavioral divergence
feat: integrate behavioral diff with trace cursor
feat: recompute diff against pinned baseline
test: validate cross run behavioral diff scenarios
test: harden cross run diff boundaries
docs: record cross run behavioral diff completion
```

---

# Definition of Done

The milestone is complete only when all of the following are true:

1. `interpretTraceSession()` lives outside the UI component layer.
2. TraceVisualizer and cross-run analysis use the same session interpretation path.
3. Existing one-argument `createTraceVisualizer(session)` usage remains valid.
4. LiveExecutionInput carries problem identity.
5. problemSlug participates in scheduler deduplication identity.
6. Accepted session provenance represents the exact input that produced the session.
7. Case selection races cannot attach wrong case metadata to a session.
8. stale runs remain suppressed by latest-wins behavior.
9. stale runs never enter comparison state.
10. RunRecord contains accepted TraceSession + immutable run context.
11. baseline can only pin an accepted current run.
12. baseline survives source edits and compatible later runs.
13. baseline clears on problem change.
14. baseline remains while switching testcase Case within the same problem.
15. baseline can be explicitly replaced.
16. baseline can be explicitly cleared.
17. only one baseline is retained.
18. same captured session is recognized without full diff work.
19. same problem is required.
20. same executed testcase is required.
21. compatible entrypoint is required.
22. source code is allowed to differ.
23. runtime status is allowed to differ.
24. testcase normalization changes line endings only.
25. no run-local frameId is used as a cross-run semantic key.
26. no run-local functionId is used as a cross-run semantic key.
27. no siteId/loopId/transferId/actionId is used as a cross-run semantic key.
28. no raw objectId equality is used as cross-run object identity.
29. no raw step equality is used as cross-run alignment.
30. stable function identity survives source line shifts.
31. qualified lexical parents distinguish same short function names.
32. fallback runtime-name alignment has reduced confidence.
33. ambiguous function alignment stops rather than guesses.
34. children align under an already aligned parent.
35. repeated same-function sibling occurrences remain separate.
36. recursive occurrences align hierarchically.
37. value comparison is tri-state.
38. scalar comparison is factual.
39. truncated strings/containers do not produce false equality.
40. complete lists/tuples compare recursively.
41. dict comparison is key-order independent when safe.
42. set comparison is member-order independent when safe.
43. same-class object references are incomparable by identity.
44. different reference class names may be reported as factual difference.
45. unknown/cycle values remain conservative.
46. stable mapping/set keys use canonical safe values only.
47. source-span text extraction is deterministic and tested.
48. semantic source normalization does not rename identifiers/literals/operators.
49. decision checkpoints do not use siteId as cross-run identity.
50. expression checkpoints do not use exprId/rootId as cross-run identity.
51. control-flow checkpoints do not use loopId/transferId as cross-run identity.
52. stable local variable mutations can be compared.
53. stable sequence-element mutations can be compared.
54. safe mapping/set mutations can be compared.
55. local reference binding may be compared conservatively.
56. object_attribute mutation is not aligned by raw object ID.
57. object_visibility mutation is not aligned by raw object ID.
58. child calls are represented as execution checkpoints.
59. checkpoint same-anchor ordering is deterministic.
60. frame exits remain terminal factual evidence.
61. trace-ended without step does not invent a navigation anchor.
62. prepared baseline interpretation/projection can be cached.
63. current interpretation can be reused by TraceVisualizer.
64. no baseline re-execution occurs.
65. diff analysis triggers no Pyodide execution.
66. alignment lookahead is explicitly bounded.
67. checkpoint matching is order-preserving.
68. unique bounded lookahead may bridge small insertion/removal differences.
69. ambiguous lookahead stops safely.
70. first divergence is earliest in factual nested execution order.
71. child-frame divergence beats a later parent divergence.
72. frame argument changes can be first divergence when safely comparable.
73. decision truth changes are supported.
74. decision outcome changes are supported.
75. changed decision structure is not silently forced to align.
76. aligned expression result changes are supported.
77. loop iteration binding differences are supported.
78. transfer/iteration/loop-exit differences are supported.
79. stable mutation differences are supported.
80. child-call differences are supported.
81. return-value differences are supported.
82. frame exit-status differences are supported.
83. exception-type differences are supported.
84. trace-end reason differences are supported.
85. session outcome is only a fallback after more precise aligned evidence.
86. later divergences do not replace an earlier supported divergence.
87. no-divergence result does not claim program equivalence.
88. coverage is explicit.
89. divergence before truncation remains valid.
90. coverage end without divergence is reported as incomplete.
91. unsupported object comparison increments coverage/incomparability rather than false divergence.
92. BaselineControls uses neutral labels.
93. Pin/Replace/Clear are keyboard-accessible buttons.
94. source-diff indicator is separate from behavioral divergence.
95. Behavioral Diff is one canonical panel.
96. Diff panel defaults collapsed.
97. Diff disclosure state survives model refresh.
98. Baseline and Current are textually distinguished.
99. no correctness color semantics are required to understand the diff.
100. Inspect current exists only with an authoritative current raw step.
101. Inspect current resolves through existing `traceIndex.stepToIndex`.
102. no nearest-step guessing occurs.
103. no baseline raw cursor is introduced.
104. no second current raw cursor is introduced.
105. Visual State remains current-run-owned.
106. Execution Story remains current-run-owned.
107. Decision Evidence remains current-run detail owner.
108. Expression Evidence remains current-run detail owner.
109. What Changed remains current-run detail owner.
110. Call Tree remains current-run single-session structure owner.
111. Failure-First selection remains unchanged.
112. Behavioral Signals remain unchanged.
113. Behavioral Timeline lanes remain unchanged.
114. Trace Outline remains unchanged.
115. raw Previous/Next/Play remain unchanged.
116. Case selector behavior remains unchanged.
117. Run now behavior remains unchanged.
118. active-tab ownership remains unchanged.
119. live debounce/latest-wins remains unchanged.
120. source-only edits before accepted execution do not alter the current diff.
121. accepted compatible current runs recompute diff.
122. incompatible Case runs show an explanatory state rather than deleting baseline.
123. returning to the compatible Case can resume comparison.
124. problem switch clears comparison baseline.
125. recursive 104 scenario does not false-diff TreeNode object IDs.
126. binary-search mutation scenario identifies the earlier mutation divergence.
127. direct decision divergence is detected.
128. extra recursive child call is represented factually.
129. timeout comparison does not say LeetCode TLE or infinite recursion.
130. same supported behavior after refactor produces neutral no-divergence copy.
131. ambiguous alignment produces explicit incomplete/ambiguous state.
132. prohibited root-cause/fix/correctness wording is absent.
133. performance tests demonstrate bounded alignment behavior.
134. no unbounded run history is retained.
135. Python fixture suite passes.
136. full Vitest suite passes.
137. `npm run typecheck` passes.
138. `npm run build` passes.

---

# Recommended Manual Acceptance Problems

## Primary: LeetCode 704 — Binary Search

Use this first because a one-line pointer-direction edit can create a clean early divergence:

```text
same call
same decision
different mutation
```

This validates that the engine does not simply compare final outputs.

## Recursive: LeetCode 104 — Maximum Depth of Binary Tree

Use this to validate:

- hierarchical recursive frame alignment;
- stable function identity;
- TreeNode references remain incomparable rather than false-different;
- child divergence ordering;
- return divergence.

## Large repeated call shape: LeetCode 509 — Fibonacci Number

Use a small `n` first.

This stresses:

- repeated recursive sibling occurrence alignment;
- deterministic child ordinal matching;
- performance.

Do not use a huge `n` as the first acceptance case.

---

# Resulting Architecture

```text
LeetCode page state
      ↓
LiveExecutionScheduler
      ├─ latest-wins execution
      └─ exact accepted-run provenance
                ↓
             RunRecord
                ↓
       Side Panel comparison state
        ├─ pinned baseline
        └─ latest current
                ↓
      interpretTraceSession()
                ↓
       prepareCrossRun()
        ├─ stable function keys
        ├─ frame hierarchy
        ├─ behavioral checkpoints
        └─ coverage
                ↓
       compareCrossRuns()
                ↓
       first factual divergence
                ↓
     BehavioralDiffViewModel
                ↓
         TraceVisualizer
                ↓
         Inspect current
                ↓
       existing raw trace cursor
```

This keeps the product evidence hierarchy intact:

```text
single run:
runtime evidence → visual debugger

cross run:
captured runtime A + captured runtime B
→ conservative alignment
→ earliest supported difference
→ current-run visual debugger
```

The milestone should be considered successful when the extension can answer:

> “Compared with the run I pinned, where did the latest captured execution first begin behaving differently?”

without claiming:

> “This is where the code became wrong.”

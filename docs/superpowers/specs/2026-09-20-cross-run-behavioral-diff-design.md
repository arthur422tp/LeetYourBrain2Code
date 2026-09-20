# Cross-Run Behavioral Diff

## Design Spec v0.1

**Date:** 2026-09-20  
**Status:** Proposed  
**Primary dependency:** `docs/superpowers/specs/2026-09-20-recursion-call-frame-execution-story-ui-design.md`  
**Runtime dependency:** `docs/superpowers/specs/2026-09-19-recursion-call-frame-evidence-foundation-design.md`

---

# 1. Goal

Cross-Run Behavioral Diff compares **two captured executions of the user's own code** and identifies the earliest factual runtime divergence that can be aligned safely.

The first target workflow is:

```text
Pin one captured run as baseline
        ↓
Edit code
        ↓
Live execution produces a newer current run
        ↓
Align factual runtime structure
        ↓
Show the first supported behavioral divergence
```

Representative output:

```text
Behavioral Diff

Baseline: pinned run
Current: latest live run

Matched execution prefix
solve(...) → search(...)

First observed divergence
Solution.search · decision

Baseline
nums[i] < target → False

Current
nums[i] < target → True

Current step 21
Inspect current
```

The product question is:

> Where did these two captured executions first stop behaving the same way, according to evidence we can align safely?

This is not:

- a solver;
- an expected-vs-actual checker;
- a LeetCode judge comparison;
- a proof that the baseline is correct;
- root-cause analysis;
- automatic bug diagnosis.

---

# 2. Core Product Boundary

The UI may state:

```text
Baseline called helper(value=2)
Current called helper(value=3)

Baseline condition evaluated False
Current condition evaluated True

Baseline returned 4
Current returned 5

Baseline completed this loop iteration
Current committed break

Baseline changed total from 7 to 9
Current changed total from 7 to 8

The runs matched through 12 comparable checkpoints before this divergence.

Comparison stopped because the next evidence could not be aligned safely.
```

The UI must not state:

```text
the current run is wrong
the baseline is correct
this change introduced the bug
this is the root cause
fix this condition
you should restore the baseline
the expected value is ...
this call should not happen
this branch is incorrect
this mutation caused the failure
```

The word **baseline** means only:

> the run the user chose as the reference side of this comparison.

It never means known-good or expected.

---

# 3. v0.1 Comparison Mode

v0.1 supports one primary mode:

```text
Pinned baseline run
vs
latest accepted current run
```

The user explicitly pins a baseline.

The extension does **not** automatically treat every previous live rerun as a meaningful baseline.

Reason:

The live scheduler currently executes after a short editing debounce. If every accepted run automatically became the comparison baseline, the reference would drift on nearly every editing pause:

```text
type one character
→ run A

type another character
→ run B compares to A

type another character
→ run C compares to B
```

That makes the comparison unstable and often meaningless.

v0.1 therefore uses an intentional baseline:

```text
Pin baseline
→ baseline stays fixed
→ current may update many times
→ diff always recomputes against the same baseline
```

---

# 4. Deferred Comparison Modes

Do not combine these into v0.1:

```text
Case 1 vs Case 2
arbitrary historical run A vs run B
saved baselines across browser restarts
LeetCode expected output vs current run
LeetCode Accepted submission vs current run
remote/cloud run history
multi-baseline comparison
three-way diff
```

The architecture should not prevent them.

Likely future modes:

```text
previous explicit run vs current
Case 1 vs Case 2
pinned baseline vs current
Accepted submission vs current
```

---

# 5. Baseline Lifetime

The baseline lives at the **Side Panel session layer**, not inside one `TraceVisualizer`.

Reason:

The current Side Panel replaces the active visualizer whenever a newer live run is accepted:

```ts
activeVisualizer?.dispose();
activeVisualizer = createTraceVisualizer(session);
```

If the baseline lived inside `TraceVisualizer`, it would be destroyed on every accepted rerun.

v0.1 baseline storage should therefore live conceptually in:

```text
renderSidePanel(...)
└─ comparison state
   ├─ pinned baseline RunRecord
   └─ latest current RunRecord
```

The baseline is in-memory only.

It is cleared when:

- the user explicitly clears it;
- the active LeetCode problem changes;
- the Side Panel instance is disposed.

It is **not** cleared merely because the source code changes.

---

# 6. RunRecord

`TraceSession` remains the authoritative runtime artifact.

Do not add UI comparison metadata to the trace wire schema solely for this feature.

Create a Side Panel-level wrapper:

```ts
interface RunRecord {
  session: TraceSession;
  context: RunContext;
}

interface RunContext {
  problemSlug: string;
  problemTitle?: string;
  selectedCaseIndex: number;
  language: string;
}
```

Authoritative executed testcase comes from:

```ts
session.rawTestcase
```

not from whatever testcase editor content happens to exist later.

Authoritative source comes from:

```ts
session.sourceCode
```

---

# 7. Scheduler Provenance Requirement

The current `LiveExecutionScheduler.onSession` callback only returns:

```ts
(session: TraceSession) => void
```

That is not sufficient for a reliable baseline/current comparison context.

By the time an asynchronous run completes, Side Panel state may already have changed:

- another Case may be selected;
- another problem may be active;
- newer editor state may exist.

Do not attach current UI metadata retroactively to an older accepted session.

The scheduler must preserve accepted-run provenance.

Conceptually:

```ts
interface AcceptedLiveSession {
  session: TraceSession;
  revision: number;
  input: LiveExecutionInput;
  selectedTestcase: string;
}

onSession?: (accepted: AcceptedLiveSession) => void;
```

Or an equivalent contract.

The important invariant is:

> Run metadata must describe the input that actually produced that TraceSession.

---

# 8. LiveExecutionInput Identity

Extend live execution metadata so the accepted run can retain problem identity.

Conceptually:

```ts
interface LiveExecutionInput {
  language: string;
  sourceCode: string;
  rawTestcase: string;
  selectedCaseIndex: number;
  problemSlug: string | null;
  problemTitle: string | null;
}
```

`problemSlug` should participate in the live scheduling identity key.

This also fixes an existing edge case where two different LeetCode pages could theoretically have identical:

```text
language
source
testcase
selected case
```

and therefore accidentally look identical to the scheduler.

The title is display metadata, not identity.

---

# 9. Baseline Pinning Contract

The user may pin only an accepted captured run.

Required controls:

```text
Pin baseline
Replace baseline
Clear baseline
```

The current run remains unchanged when pinning.

Pinning is a reference action only.

Recommended baseline metadata:

```text
Baseline pinned
Case 1
status: completed
source changed since baseline
```

Do not label:

```text
Good run
Correct run
Expected run
Passing run
```

unless a future LeetCode judge integration has factual evidence for such a label.

---

# 10. Comparison Compatibility

Before behavioral alignment, validate run compatibility.

v0.1 requires:

1. same non-null LeetCode problem slug;
2. same executed testcase text:
   ```ts
   baseline.session.rawTestcase === current.session.rawTestcase
   ```
   after line-ending normalization only;
3. same entrypoint contract:
   - class name;
   - method/function name;
   - parameter count;
   - parameter kinds where available;
4. Python runtime on both sides;
5. supported trace schema versions.

Source code is **allowed to differ**.

Session status is **allowed to differ**.

Examples:

```text
completed vs completed   → comparable
completed vs exception   → comparable
completed vs timeout     → comparable prefix
exception vs exception   → comparable
```

---

# 11. Incompatible States

Required UI states:

```text
Baseline is for a different problem.
Baseline is for a different testcase.
Baseline uses a different entrypoint.
Baseline comparison is unavailable for this trace schema.
No baseline pinned.
Current run is not available yet.
```

If the user switches to another Case:

- retain the baseline in memory for the same problem;
- mark comparison incompatible;
- allow `Replace baseline`;
- if the original testcase is restored, comparison may become compatible again.

If the user switches problems:

- clear the baseline.

---

# 12. No Cross-Run Raw Identity Equality

The following IDs are **run-local or source-local** and must never be compared directly across runs:

```text
frameId
functionId
siteId
conditionId
chainId
loopId
transferId
actionId
objectId
cycle referenceId
raw trace step
```

Examples of forbidden logic:

```ts
baseline.frameId === current.frameId
baseline.functionId === current.functionId
baseline.siteId === current.siteId
baseline.objectId === current.objectId
baseline.step === current.step
```

These identifiers remain authoritative **within** one run for navigation and evidence lookup.

They are not cross-run semantic identities.

---

# 13. Why functionId Cannot Be the Cross-Run Key

Current static function IDs intentionally include source-location information.

A harmless edit above a function can shift its line number and therefore change the ID.

Example:

```text
Baseline:
method:Solution.search:8:4:0

Current:
method:Solution.search:11:4:0
```

These may still represent the same lexical function.

Cross-run function alignment therefore uses a separate stable key.

---

# 14. CrossRunFunctionKey

Preferred function identity:

```text
FunctionKind
+
qualifiedName
+
parameter signature
```

Conceptually:

```ts
interface CrossRunFunctionKey {
  kind?: FunctionKind;
  qualifiedName: string;
  parameterNames?: string[];
}
```

Priority:

1. static `FunctionDescriptor.qualifiedName` + kind;
2. qualified runtime/static name if available;
3. runtime `functionName` fallback with reduced alignment confidence.

Do not include source span in the primary cross-run key.

Do not include argument values in the key.

Argument values are behavior to compare, not identity.

---

# 15. Frame Alignment

Frame alignment is hierarchical.

First align roots.

Then, for each aligned parent pair, align child invocations under those concrete parents.

A child occurrence key is conceptually:

```text
aligned parent
+
CrossRunFunctionKey
+
occurrence ordinal of that function key under the parent
```

Example:

Baseline:

```text
solve
├─ helper(...)  # helper occurrence 1
└─ helper(...)  # helper occurrence 2
```

Current:

```text
solve
├─ helper(...)  # helper occurrence 1
└─ helper(...)  # helper occurrence 2
```

The two helper calls remain separately aligned.

No calls are merged merely because they share a function name.

---

# 16. Recursive Frame Alignment

Recursion uses the same rule.

Example:

```text
Baseline                  Current

f(3)                      f(3)
└─ f(2)                   └─ f(2)
   └─ f(1)                   └─ f(1)
```

Each recursive invocation is aligned through:

```text
aligned parent
+
same stable function key
+
same occurrence ordinal
```

Do not compare raw recursion frame IDs.

Do not use return value to align recursive calls.

---

# 17. Inserted or Removed Same-Function Calls

Suppose:

Baseline:

```text
solve
├─ helper(1)
└─ helper(2)
```

Current:

```text
solve
├─ helper(0)
├─ helper(1)
└─ helper(2)
```

v0.1 occurrence alignment may pair:

```text
baseline helper occurrence 1 ↔ current helper occurrence 1
```

and therefore observe:

```text
argument 1 vs 0
```

before later observing an extra child call.

That is acceptable.

The UI must state only the factual aligned difference.

It must not claim which call was “inserted incorrectly”.

A future sequence-alignment upgrade may improve this case.

---

# 18. Alignment Confidence

Every aligned region should have a factual confidence class.

Suggested:

```ts
type AlignmentConfidence =
  | "strong"
  | "structural"
  | "fallback"
  | "ambiguous";
```

Examples:

```text
strong
qualified function identity available on both runs

structural
same qualified function + parent + occurrence ordinal,
but source changed

fallback
runtime function name only

ambiguous
multiple candidates cannot be distinguished safely
```

When alignment becomes ambiguous, comparison stops at that boundary.

Do not choose an arbitrary candidate merely to continue the diff.

---

# 19. Behavioral Checkpoint Stream

Within an aligned frame pair, convert supported evidence into one deterministic ordered checkpoint stream.

Conceptually:

```ts
type BehavioralCheckpoint =
  | FrameEntryCheckpoint
  | DecisionCheckpoint
  | ExpressionCheckpoint
  | LoopCheckpoint
  | TransferCheckpoint
  | MutationCheckpoint
  | ChildCallCheckpoint
  | FrameExitCheckpoint;
```

Each checkpoint contains:

```ts
interface CheckpointBase {
  runLocalAnchorStep: number;
  frameId: number;
  semanticKey: string;
  kind: string;
}
```

The raw anchor step is used only to order and navigate **inside that run**.

It is never compared numerically to the other run.

---

# 20. Execution-Order Comparison

“First divergence” means:

> the earliest divergence encountered while walking the two aligned execution structures in factual observed execution order.

For an aligned frame:

1. compare frame-entry arguments;
2. walk supported checkpoints in anchor order;
3. when an aligned child call is reached, recursively compare that child execution before continuing the parent after the child returns;
4. compare frame exit.

This follows the actual nesting of execution.

Do not compare entire child subtrees only after the parent has finished.

---

# 21. Checkpoint Ordering at the Same Anchor

Different evidence layers may share one raw anchor.

Use one deterministic presentation order.

Recommended:

```text
decision
expression
control-flow observation
control-flow resolution
mutation
child call
frame exit
```

Exact ordering may be adjusted during implementation to match existing runtime emission semantics.

The requirement is:

- deterministic;
- tested;
- no layer silently overwrites another.

---

# 22. Decision Alignment

Decision checkpoints use a cross-run semantic site key.

Preferred key:

```text
DecisionSiteKind
+
normalized condition source
+
occurrence ordinal within the aligned frame
```

Source comes from the static `ConditionPlan`.

Normalize:

- line endings;
- insignificant surrounding whitespace;
- repeated internal whitespace where semantically safe.

Do not normalize identifiers or literals.

Example:

```text
if nums[i] < target
```

aligns with:

```text
if   nums[i] < target
```

but not automatically with:

```text
if nums[i] <= target
```

The latter is a changed decision structure.

---

# 23. Decision Divergence

For an aligned decision checkpoint compare:

1. completion status;
2. final condition truth if available;
3. factual branch/loop outcome if available;
4. supported operand values where safely comparable.

Possible divergence kinds:

```text
decision_truth_changed
decision_outcome_changed
decision_completion_changed
decision_operand_changed
```

Example:

```text
Baseline: nums[i] < target → False
Current:  nums[i] < target → True
```

This does not mean either side is correct.

---

# 24. Changed Decision Source

If the baseline and current source contain different normalized decision expressions at the point where the execution stream otherwise diverges:

```text
Baseline: nums[i] < target
Current:  nums[i] <= target
```

report a structural comparison boundary:

```text
Decision structure changed
```

Then show both factual source expressions.

Do not force the two sites into one semantic decision just because they occur on similar lines.

---

# 25. Expression Alignment

Expression Evidence may participate when available on both sides.

Preferred key:

```text
normalized expression source
+
expression role/root kind
+
occurrence ordinal within the aligned frame
```

Compare only evidence values that pass the cross-run value comparator.

Possible divergence:

```text
expression_value_changed
expression_selection_changed
```

Example:

```text
Baseline
max(left, right) → 2

Current
max(left, right) → 3
```

If Expression Evidence is unavailable or truncated on either side, skip unsupported expression checkpoints and mark comparison coverage accordingly.

---

# 26. Control-Flow Alignment

Loop IDs are source-local.

Cross-run loop key should derive from:

```text
loop kind
+
normalized source slice for the loop header
+
occurrence ordinal inside the aligned frame/context
```

Example:

```text
for value in nums
```

or:

```text
while left <= right
```

Supported comparisons:

```text
iteration began
iteration bindings
iteration completed
continue committed
break committed
return committed
loop exit reason
```

Never infer intended loop count.

---

# 27. Control-Flow Divergence

Possible factual divergence kinds:

```text
loop_iteration_binding_changed
iteration_status_changed
transfer_presence_changed
transfer_status_changed
loop_exit_reason_changed
```

Example:

```text
Baseline
Iteration #3 · completed normally

Current
Iteration #3 · break committed
```

Do not label this:

```text
premature break
wrong loop exit
```

---

# 28. Mutation Alignment

Mutation comparison is conservative.

Supported stable mutation target keys in v0.1:

```text
variable:
  local:<variableName>

sequence element:
  local:<containerName>[<numeric index>]

mapping entry:
  local:<containerName>[<stable comparable key>]

set membership:
  local:<containerName>:<stable comparable member>

local reference binding:
  local-ref:<variableName>
```

These use stable program-visible names/paths rather than runtime object IDs.

---

# 29. Mutation Types Not Safely Cross-Run Aligned in v0.1

Do not use raw object IDs to align:

```text
object_attribute
object_visibility
object-owned reference mutation
```

Example forbidden key:

```text
obj-17.next
```

because:

```text
baseline obj-17
```

and:

```text
current obj-17
```

do not necessarily refer to the same logical object.

These mutations remain visible in each run's ordinary **What Changed** panel.

They are excluded from cross-run first-divergence claims unless a stable object path can be proven by a future feature.

---

# 30. Cross-Run Value Comparison

Never compare serialized values with a generic JSON/string equality function.

Use an explicit tri-state comparator:

```ts
type CrossRunValueComparison =
  | { status: "equal" }
  | { status: "different"; detail?: string }
  | { status: "incomparable"; reason: string };
```

“Incomparable” is not “different”.

---

# 31. Scalar Values

The following are directly comparable:

```text
int
float
bool
str
None
```

Compare type + captured value.

For strings, truncation matters.

If two truncated strings share the same captured prefix and total-length metadata does not prove equality:

```text
status = incomparable
```

Do not claim equality from the visible prefix alone.

---

# 32. List and Tuple Values

Lists and tuples are comparable recursively only when:

- lengths are captured;
- neither side is truncated in a way that hides potentially different elements;
- every compared child value is comparable.

Rules:

```text
different length
→ different

same complete length + every item equal
→ equal

same visible prefix but either side truncated
→ incomparable

any child different
→ different

no differences but at least one child incomparable
→ incomparable
```

---

# 33. Dict Values

Dicts may be compared when keys can be canonicalized safely.

Stable scalar keys:

```text
int
float
bool
str
None
```

For complete dict snapshots:

- compare key sets;
- compare matching values recursively;
- do not depend on iteration order for equality.

If a key itself is an opaque reference/unknown/cycle value:

```text
incomparable
```

If either dict snapshot is truncated and no difference is already proven:

```text
incomparable
```

---

# 34. Set Values

For complete sets whose members have stable canonical scalar/container representations:

- canonicalize;
- compare as unordered membership.

If members contain opaque references, unknown values, or incomplete snapshots:

```text
incomparable
```

---

# 35. Object References

`ObjectReferenceSnapshot.objectId` is run-local.

Never state:

```text
baseline reference obj-4 != current reference obj-8
```

as a behavioral value difference solely because the IDs differ.

Rules:

- different `className` → factual type/class difference;
- same `className`, different objectId → **incomparable identity**;
- same textual objectId across runs → still incomparable identity.

A future object-structure alignment feature may improve this.

---

# 36. Unknown and Cycle Values

`unknown.repr` may contain unstable memory-address-like content.

Do not use it as a reliable cross-run equality key by default.

```text
unknown → incomparable
cycle → incomparable
```

Class-name differences may still be reported factually.

---

# 37. Frame Entry Comparison

For aligned frame occurrences compare bound arguments by parameter name/order.

Possible outcomes:

```text
same comparable arguments
argument value changed
argument presence changed
argument incomparable
```

Example:

```text
Baseline
helper(index=2, target=7)

Current
helper(index=3, target=7)
```

First factual divergence:

```text
argument index: 2 → 3
```

For TreeNode/LinkedList reference arguments, do not report divergence solely from object IDs.

---

# 38. Child Call Checkpoints

A child call checkpoint records:

```text
callee stable function key
occurrence ordinal under aligned parent
run-local child frame ID
call anchor
```

Possible divergence:

```text
child_call_changed
child_call_missing
child_call_extra
```

Example:

```text
Baseline next call
helper(...)

Current next call
validate(...)
```

The UI may say:

```text
Different next child call observed
```

It may not say which call should have happened.

---

# 39. Frame Exit Comparison

Frame exits are strong factual boundaries.

Compare:

```text
returned
exception
trace_ended
```

Possible divergence:

```text
frame_exit_status_changed
return_value_changed
exception_type_changed
trace_end_reason_changed
```

Examples:

```text
Baseline returned 4
Current returned 5
```

```text
Baseline returned 4
Current raised IndexError
```

```text
Baseline returned normally
Current trace ended · hard_timeout
```

Do not turn the latter into an “infinite recursion” or “TLE bug” diagnosis.

---

# 40. Session-Level Outcome

After aligned user frames are exhausted, compare session-level terminal facts if needed:

```text
completed
exception
trace_limit
timeout
internal_error
```

This is secondary to frame-local factual exit evidence.

Use session-level status when no more precise aligned frame boundary is available.

Example:

```text
Baseline session completed.
Current session timed out locally.
```

Reminder:

local timeout is not LeetCode TLE.

---

# 41. Checkpoint Alignment Strategy

v0.1 should use deterministic order-preserving alignment.

Recommended:

1. exact semantic-key match at current positions;
2. bounded lookahead for a unique matching key;
3. if one side has an unmatched comparable checkpoint before the unique match, report that structural/runtime presence difference;
4. if multiple candidates make alignment ambiguous, stop.

Do not use unbounded fuzzy matching.

Do not use LLM similarity.

Do not silently skip arbitrary mismatches until something looks similar.

---

# 42. Alignment Window

Use a small explicit lookahead window.

Example starting point:

```text
8 checkpoints
```

This is an implementation constant, not a semantic guarantee.

Purpose:

- handle one or two inserted/removed supported events;
- avoid accidentally aligning distant unrelated repeated events.

If no unique alignment exists within the window:

```text
alignment boundary
```

---

# 43. First Divergence

The engine returns at most one primary first divergence for v0.1.

Conceptually:

```ts
interface CrossRunDiffResult {
  compatibility: ComparisonCompatibility;
  alignedPrefix: AlignedPrefixSummary;
  firstDivergence?: CrossRunDivergence;
  coverage: CrossRunCoverage;
  stopReason?: ComparisonStopReason;
}
```

Do not start by generating a giant full diff.

The first divergence is the main product primitive.

---

# 44. Aligned Prefix Summary

Show factual context before the first divergence.

Example:

```text
Matched before divergence
3 aligned frames
8 comparable checkpoints
call path: solve → search
```

This helps the user understand:

> both runs behaved the same according to supported evidence up to here.

Do not say:

```text
the code is correct up to here
```

---

# 45. No Divergence Observed

If all safely comparable captured evidence matches:

```text
No behavioral divergence observed in comparable captured evidence.
```

Do not say:

```text
The runs are identical.
The new code is equivalent.
The code is correct.
```

Why:

- unsupported object-reference comparisons may remain;
- tracing channels may be truncated;
- not every Python semantic effect is instrumented.

---

# 46. Coverage Model

Comparison coverage must be explicit.

Conceptually:

```ts
interface CrossRunCoverage {
  callFrames: "complete" | "partial" | "unavailable";
  decisions: "complete" | "partial" | "unavailable";
  expressions: "complete" | "partial" | "unavailable";
  controlFlow: "complete" | "partial" | "unavailable";
  mutations: "complete" | "partial";
  values: {
    incomparableCount: number;
  };
}
```

Mutation coverage is derived from captured raw trace reconstruction.

Evidence-channel truncation must not erase previously comparable evidence.

---

# 47. Truncated Evidence

If both runs align and diverge **before** a truncation boundary, the divergence remains valid.

Example:

```text
decision differs at checkpoint 5
decision tracing truncates at checkpoint 20
```

The first divergence is still supported.

If no divergence is found before one side loses required evidence:

```text
No divergence observed before comparison coverage ended.
```

Do not continue by guessing.

---

# 48. Hard Timeout / Trace Limit

A timeout or trace limit may still provide a useful prefix.

Example:

```text
Baseline
f(3) → f(2) → f(1) → returned

Current
f(3) → f(2) → f(1) → f(0) → trace ended
```

If frame evidence proves the extra call:

```text
Current observed an additional child call before trace end.
```

If evidence ends before alignment can establish that:

```text
Comparison stopped at captured trace boundary.
```

Do not label:

```text
infinite recursion
missing base case
```

---

# 49. Comparison Result Categories

Suggested primary divergence categories:

```ts
type CrossRunDivergenceKind =
  | "frame_argument_changed"
  | "child_call_changed"
  | "child_call_missing"
  | "child_call_extra"
  | "decision_truth_changed"
  | "decision_outcome_changed"
  | "decision_structure_changed"
  | "expression_value_changed"
  | "loop_iteration_binding_changed"
  | "iteration_status_changed"
  | "transfer_status_changed"
  | "loop_exit_reason_changed"
  | "mutation_value_changed"
  | "mutation_presence_changed"
  | "frame_exit_status_changed"
  | "return_value_changed"
  | "exception_type_changed"
  | "trace_end_reason_changed"
  | "session_outcome_changed";
```

Do not create a generic `bug` category.

---

# 50. Divergence Evidence

Every primary divergence must carry evidence for both sides where available.

Conceptually:

```ts
interface CrossRunEvidenceAnchor {
  frameKey: string;
  runLocalFrameId?: number;
  step?: number;
  source?: string;
  line?: number;
  value?: ValueSnapshot;
  factualText: string;
}

interface CrossRunDivergence {
  kind: CrossRunDivergenceKind;
  baseline?: CrossRunEvidenceAnchor;
  current?: CrossRunEvidenceAnchor;
  alignmentConfidence: AlignmentConfidence;
}
```

The diff engine should produce data.

The UI owns prose.

---

# 51. Source Line Numbers

Source lines are run-local.

It is valid to show:

```text
Baseline · line 8
Current · line 11
```

Do not expect line numbers to match.

Do not use equal line number as a cross-run alignment requirement.

---

# 52. Diff UI Placement

Add one canonical panel:

```text
Code
Visual State
Execution Story
Behavioral Diff
Decision Evidence
Expression Evidence
What Changed
Locals
Execution analysis & advanced
```

The Diff panel appears only when:

- a baseline is pinned; or
- comparison state needs to explain why the pinned baseline is incompatible.

Do not add a second diff surface to Trace Outline or Behavioral Timeline in v0.1.

---

# 53. Default Diff Panel State

Default collapsed.

Panel summary may show a compact factual badge:

```text
Behavioral Diff · decision changed
Behavioral Diff · return changed
Behavioral Diff · no divergence observed
Behavioral Diff · incompatible testcase
Behavioral Diff · comparison incomplete
```

Do not automatically reopen the panel on every live rerun.

Live editing should not cause disruptive panel expansion.

Preserve the user's disclosure choice while the same baseline remains pinned.

---

# 54. Baseline Controls Placement

Recommended location:

Trace summary / run header:

```text
Trace    completed

[Pin baseline]
```

After pinning:

```text
Baseline pinned · Case 1
[Replace] [Clear]
```

The comparison controls belong to the run/Side Panel layer, not inside Decision Evidence or Call Tree.

---

# 55. First Divergence Card

Recommended:

```text
Behavioral Diff

Baseline
Pinned · Case 1

Current
Latest live run · Case 1

Matched prefix
3 frames · 8 checkpoints

First observed divergence
Solution.search
Decision

Baseline
nums[i] < target
False

Current
nums[i] < target
True

[Inspect current]
```

Prefer side-by-side columns when width allows.

Use stacked baseline/current blocks in narrow Side Panel width.

---

# 56. Current Navigation

v0.1 has one authoritative active raw cursor: the current run.

`Inspect current` resolves:

```text
current divergence step
→ current trace step index
→ existing navigateDirect(...)
```

Do not create a second active raw cursor.

Do not let the Diff component mutate Visual State directly.

---

# 57. Baseline Inspection in v0.1

Do not add a second fully interactive baseline visualizer yet.

The baseline side of the divergence card includes enough factual snapshot detail to compare:

- source expression/statement when available;
- function/call path;
- values;
- outcome;
- baseline raw step number as metadata.

No `Inspect baseline` button is required in v0.1.

Future versions may support:

- temporary run switching;
- synchronized dual cursors;
- two-column visual state.

Keep this out of the first implementation.

---

# 58. Current Visual State Integration

When the user clicks `Inspect current`:

- existing raw cursor moves;
- Code updates;
- Visual State updates;
- Execution Story updates;
- Decision/Expression/Mutation panels update normally.

Cross-Run Diff does not own those surfaces.

This gives the user:

```text
diff says where behavior diverged
→ inspect current runtime there
→ use existing visual debugger to understand it
```

---

# 59. Baseline Source Changed Indicator

The UI may state:

```text
Source differs from baseline
```

using exact source string/hash inequality.

This is not itself a behavioral divergence.

Do not create a source diff editor in v0.1.

Do not assume every source change affects runtime behavior.

---

# 60. Comparison Store State

Suggested state:

```ts
interface RunComparisonState {
  baseline: RunRecord | null;
  current: RunRecord | null;
}
```

Optional derived state:

```ts
interface RunComparisonViewState {
  compatibility: ComparisonCompatibility;
  diff?: CrossRunDiffResult;
}
```

The store does not mutate TraceSessions.

---

# 61. Recompute Policy

When no baseline is pinned:

```text
no diff analysis
```

When a compatible new current session is accepted:

```text
recompute diff against pinned baseline
```

When current source changes but no new run is accepted yet:

```text
continue displaying the diff for the latest accepted current run
```

Do not compare baseline against editor text that has never executed.

This preserves the core product rule:

> compare execution with execution.

---

# 62. Stale Run Protection

Reuse the scheduler's latest-wins semantics.

A stale asynchronous run that the scheduler rejects must never become:

- current comparison run;
- new diff result;
- replacement baseline.

Only accepted `onSession` output enters comparison state.

---

# 63. Baseline Replacement

`Replace baseline` pins the current accepted run.

After replacement:

- old baseline is discarded;
- current may equal the new baseline;
- diff should show:
  ```text
  No behavioral divergence observed in comparable captured evidence.
  ```
  or a neutral “baseline is current run” state.

No history stack is required.

---

# 64. Baseline and Current Same Session

If:

```text
baseline.sessionId === current.sessionId
```

the engine may short-circuit:

```text
same captured run
```

Do not wastefully rebuild a full cross-run alignment.

UI:

```text
Baseline is the current captured run.
```

---

# 65. Core Module Boundaries

Recommended modules:

```text
src/core/cross-run-value.ts
src/core/cross-run-alignment.ts
src/core/cross-run-checkpoints.ts
src/core/cross-run-diff.ts
```

Responsibilities:

`cross-run-value.ts`
- tri-state ValueSnapshot comparison;
- canonical scalar/container keys;
- never compare run-local object IDs.

`cross-run-alignment.ts`
- stable function keys;
- aligned frame pairs;
- occurrence-based child alignment;
- confidence / ambiguity.

`cross-run-checkpoints.ts`
- project one interpreted run into per-frame behavioral checkpoints.

`cross-run-diff.ts`
- compatibility;
- recursive execution-order comparison;
- first divergence;
- coverage summary.

No DOM in core modules.

---

# 66. Session Interpretation Helper

Today `TraceVisualizer` calls `interpretTrace(...)` directly with a long argument list.

Cross-run comparison will need to interpret baseline and current sessions consistently.

Introduce one helper conceptually:

```ts
export function interpretTraceSession(
  session: TraceSession
): TraceInterpretation
```

It must call `interpretTrace()` with all session evidence channels:

- raw events;
- expression;
- decision;
- control flow;
- call frame;
- termination.

Then both:

```text
TraceVisualizer
CrossRunDiff
```

use the same session-to-interpretation path.

This reduces drift.

---

# 67. No Re-execution for Diff

The diff engine compares captured runs.

It must not rerun the baseline.

It must not invoke user code.

It must not mutate testcases.

It must not make additional Pyodide calls.

Pipeline:

```text
TraceSession A
TraceSession B
     ↓
interpret both captured artifacts
     ↓
align
     ↓
diff
```

---

# 68. Performance

Diff recomputes after every accepted current live run while a baseline is pinned.

It must therefore be bounded.

Requirements:

- O(recorded supported evidence) target;
- no quadratic comparison over entire raw event arrays;
- bounded checkpoint lookahead;
- no DOM scan to build diff;
- no deep copy of all ObjectSnapshots solely for comparison;
- baseline interpretation may be cached while pinned;
- current interpretation may reuse the interpretation already needed by TraceVisualizer if architecture permits cleanly.

Do not prematurely build a persistent database.

---

# 69. Baseline Analysis Cache

A pinned baseline does not change.

Cache:

```text
TraceInterpretation
Cross-run function index
checkpoint projection
```

for the baseline.

Invalidate only when:

- baseline replaced;
- baseline cleared;
- problem changes;
- incompatible schema logic requires refresh.

Current projection is replaced with every accepted current run.

---

# 70. Memory Bound

Only one pinned baseline is retained in v0.1.

No unbounded run history.

The comparison layer therefore holds approximately:

```text
current TraceSession
+
one baseline TraceSession
+
derived analyses
```

When baseline is replaced, release the old references.

---

# 71. Failure-First Boundary

Cross-Run Diff does not replace Failure-First.

Failure-First:

```text
selects one inspection location inside one failing run
```

Cross-Run Diff:

```text
compares two captured runs and finds first supported divergence
```

Do not automatically change Failure-First selection based on the diff.

Future integration may offer:

```text
Start Here: cross-run divergence
```

only after a separate design.

---

# 72. Behavioral Evidence Boundary

Existing Behavioral Signals detect repeated/no-progress patterns inside one run.

Cross-Run Diff compares two runs.

Do not merge their semantics.

Example:

```text
Current run has repeated no-progress behavior.
```

and:

```text
Current diverged from baseline at decision X.
```

may both be true.

Do not claim the decision caused the repeated behavior.

---

# 73. Call Tree Integration

Call-Frame Evidence is the structural backbone for cross-run alignment.

When a divergence belongs to an aligned frame, show:

```text
Function
Solution.search

Call path
solve → search → helper
```

Use cross-run stable display names.

Do not display baseline `frameId` and current `frameId` as if they should match.

Run-local IDs may appear only as advanced metadata.

---

# 74. Decision Panel Integration

If the first divergence is a decision:

`Behavioral Diff` shows the compact comparison.

`Decision Evidence` remains the full current-side detail owner.

`Inspect current` navigates to the current decision anchor.

Do not duplicate the complete condition tree in the Diff panel.

---

# 75. Expression Panel Integration

If the first divergence is an expression:

`Behavioral Diff` shows:

```text
source
baseline result
current result
```

`Expression Evidence` remains the full current computation tree.

---

# 76. Mutation Panel Integration

If the first divergence is a supported stable mutation:

```text
Behavioral Diff

total

Baseline
7 → 9

Current
7 → 8
```

`What Changed` remains the current-side detailed mutation surface.

Do not cross-run compare unsupported object IDs.

---

# 77. Output / Return Integration

If no earlier comparable divergence exists and the frame/session output differs:

```text
First observed divergence
Return value

Baseline
3

Current
2
```

This is a valid final divergence.

It does not imply where the cause lies.

---

# 78. Accessibility

Required:

- baseline and current sides have textual labels;
- do not rely on red/green alone;
- divergence kind has readable text;
- incomplete/ambiguous states are textual;
- `Pin baseline`, `Replace`, `Clear`, and `Inspect current` are real buttons;
- panel disclosure preserves keyboard semantics;
- stacked narrow layout preserves source order:
  baseline first, current second.

Avoid using “good/bad” icons as the only distinction.

---

# 79. Visual Language

Do not use success/error coloring to imply baseline correctness.

Allowed neutral differentiation:

```text
Baseline
Current
Changed
Unavailable
Incomparable
```

Avoid:

```text
Correct
Wrong
Good
Bad
Fixed
Broken
```

Exception/timeout may continue using existing runtime-status styling because those are factual execution statuses.

---

# 80. Empty States

Required:

```text
Pin a captured run to compare future executions.
Baseline is the current captured run.
No behavioral divergence observed in comparable captured evidence.
Comparison stopped because evidence alignment became ambiguous.
No divergence observed before comparison coverage ended.
This testcase differs from the pinned baseline.
Call-frame evidence is unavailable for one side.
```

---

# 81. Representative Acceptance Scenario A: Binary Search Fix

Baseline code:

```python
if nums[mid] < target:
    right = mid - 1
else:
    left = mid + 1
```

Current code:

```python
if nums[mid] < target:
    left = mid + 1
else:
    right = mid - 1
```

Expected diff shape:

```text
Matched prefix
search(nums, target)

First observed divergence
Decision / following mutation

If the decision truth itself is identical:
nums[mid] < target → True
```

Then the comparator continues until:

```text
Baseline mutation
right: 6 → 2

Current mutation
left: 0 → 4
```

Do not claim which assignment is correct.

---

# 82. Representative Acceptance Scenario B: Recursive Return Change

Baseline:

```python
return max(left, right) + 1
```

Current:

```python
return max(left, right)
```

For LeetCode 104:

```text
Call-frame prefix aligns
maxDepth(root=3)
→ maxDepth(root=9)
→ ...
```

First supported divergence may be:

```text
Expression value changed
```

or, if expression source no longer aligns safely:

```text
Expression structure changed
```

followed later by:

```text
return value changed
```

Do not force source-different expressions into one checkpoint.

---

# 83. Representative Acceptance Scenario C: Extra Recursive Call

Baseline:

```text
f(3)
└─ f(2)
   └─ f(1)
```

Current:

```text
f(3)
└─ f(2)
   └─ f(1)
      └─ f(0)
```

If the aligned call-frame structure proves it:

```text
First observed divergence
Additional child call in current run
f(...)
```

Do not say:

```text
missing base case
unnecessary recursive call
```

---

# 84. Representative Acceptance Scenario D: Same Behavior After Refactor

Baseline and current source differ, but all supported captured behavior aligns.

Required result:

```text
Source differs from baseline.

No behavioral divergence observed in comparable captured evidence.
```

Not:

```text
Behavior is identical.
Refactor is safe.
```

---

# 85. Representative Acceptance Scenario E: Different Testcase

Baseline:

```text
Case 1
[3,9,20,null,null,15,7]
```

Current:

```text
Case 2
[1,null,2]
```

Required:

```text
Comparison unavailable
The current testcase differs from the pinned baseline.
```

Do not compare the runs in v0.1.

---

# 86. Representative Acceptance Scenario F: Reference Arguments

Baseline and current recursive TreeNode frames may contain:

```text
reference obj-7
reference obj-11
```

with the same class:

```text
TreeNode
```

Required:

```text
object identity is incomparable across runs
```

Do not report:

```text
argument changed: obj-7 → obj-11
```

The comparator may continue to later comparable evidence.

---

# 87. Representative Acceptance Scenario G: Timeout

Baseline:

```text
returned 3
```

Current:

```text
trace ended · hard_timeout
```

If this is the earliest supported divergence:

```text
Frame outcome changed

Baseline
Returned 3

Current
Trace ended · hard_timeout
```

Do not say:

```text
Current code has infinite recursion.
```

---

# 88. Test Strategy: Scheduler Provenance

Add tests proving:

- accepted session callback retains the exact input that produced it;
- stale run completion cannot overwrite newer comparison current;
- problem slug participates in run identity;
- selected case provenance remains correct even if UI selection changes while an older run is executing.

---

# 89. Test Strategy: Compatibility

Verify:

```text
same slug + same executed testcase + same entrypoint → compatible
different slug → incompatible
different testcase → incompatible
different entrypoint → incompatible
source changed → still compatible
status changed → still compatible
```

---

# 90. Test Strategy: Value Comparator

Required cases:

```text
scalar equal/different
complete list equal/different
truncated list incomparable
dict order independence
opaque dict key incomparable
set order independence
reference same class incomparable
reference different class different
unknown incomparable
cycle incomparable
```

No raw object-ID equality test should result in `equal`.

---

# 91. Test Strategy: Frame Alignment

Required:

```text
same qualified function after line-number shift
recursive chain
repeated sibling helper calls
helper inserted before another helper
renamed helper
same runtime function name but different qualified lexical parent
fallback name-only alignment
ambiguous alignment stop
```

---

# 92. Test Strategy: Decision Diff

Required:

```text
same condition / same truth
same condition / different truth
same truth / different branch outcome
changed condition source
decision channel truncated after divergence
decision channel truncated before any divergence
```

---

# 93. Test Strategy: Control-Flow Diff

Required:

```text
same iteration binding
changed iteration binding
completed vs break
continue vs completed
loop exhausted vs break
recursive loop evidence remains frame-scoped
```

---

# 94. Test Strategy: Mutation Diff

Required supported cases:

```text
local scalar variable change
list element change
mapping scalar-key change
set membership change
local reference bound/unbound
```

Required unsupported cases:

```text
object_attribute IDs differ across runs
object_visibility IDs differ across runs
```

Unsupported object-ID cases must not generate a false primary divergence.

---

# 95. Test Strategy: First Divergence Ordering

Construct runs where later differences also exist.

Example:

```text
checkpoint 1 same
checkpoint 2 decision differs
checkpoint 3 mutation differs
frame return differs
```

Required:

```text
firstDivergence = checkpoint 2 decision
```

Do not choose the most dramatic later difference.

---

# 96. Test Strategy: Recursive Execution Order

Build:

```text
parent entry
decision
child call
  child decision differs
child return
parent mutation differs later
```

Required:

```text
first divergence = child decision
```

This proves recursive comparison follows actual nested execution order.

---

# 97. Test Strategy: Coverage

Verify:

- divergence before truncation remains valid;
- no divergence before truncation produces incomplete result;
- call-frame unavailable blocks structural comparison;
- expression unavailable does not block decision comparison;
- mutation-incomparable count is exposed.

---

# 98. Side Panel Integration Tests

Verify:

1. no baseline → no active diff analysis;
2. Pin baseline retains current run;
3. newer accepted live run recomputes diff;
4. source-only editor changes before execution do not change displayed diff;
5. panel disclosure survives live reruns;
6. Replace baseline resets comparison;
7. Clear removes diff panel/reference;
8. problem switch clears baseline;
9. testcase switch shows incompatible state;
10. Inspect current navigates through sparse raw step index.

---

# 99. Regression Requirements

Must preserve:

```text
live editor synchronization
latest-wins scheduler
active-tab ownership
Case selection
Run now
TraceVisualizer
raw Previous / Next / Play
Visual State
Execution Story
Call Tree
Decision Evidence
Expression Evidence
What Changed
Locals
Behavioral Signals
Behavioral Timeline
Trace Outline
Failure-First
timeout / trace-limit prefix retention
```

Cross-Run Diff must not change the semantics of any existing single-run evidence layer.

---

# 100. Definition of Done

Cross-Run Behavioral Diff v0.1 is complete when:

1. the user can pin the current accepted run as baseline;
2. baseline survives subsequent compatible live reruns;
3. baseline is cleared on problem change;
4. baseline can be explicitly replaced and cleared;
5. scheduler provenance identifies the exact problem/case input that produced each accepted session;
6. stale runs cannot become comparison current;
7. comparison requires same problem slug;
8. comparison requires same executed testcase;
9. comparison requires same entrypoint contract;
10. source code may differ;
11. completed/exception/timeout statuses may be compared;
12. no raw run-local IDs are used as cross-run semantic equality keys;
13. stable function keys survive source line-number shifts;
14. aligned parent structure participates in child-frame alignment;
15. repeated same-function sibling calls remain separate;
16. recursion aligns through concrete hierarchical occurrences;
17. ambiguous frame alignment stops rather than guesses;
18. alignment confidence is represented;
19. each run is projected into ordered supported behavioral checkpoints;
20. nested child execution is compared in factual execution order;
21. decision checkpoints align through normalized semantic source identity;
22. changed decision source is not forced into the old site;
23. decision truth differences are factual divergence;
24. expression values compare only when expression evidence aligns;
25. loop IDs are not compared directly across runs;
26. control-flow differences remain factual;
27. stable local mutation targets can be compared;
28. object_attribute/object_visibility are not aligned through raw object IDs;
29. ValueSnapshot comparison is tri-state;
30. scalar values compare safely;
31. truncated containers do not produce false equality;
32. dict/set comparison is order-safe when values are comparable;
33. object references never compare by raw objectId;
34. unknown/cycle snapshots remain conservative;
35. frame bound arguments compare by stable parameter identity;
36. frame return values compare conservatively;
37. exception type/status differences are supported;
38. hard timeout / trace-ended outcomes remain factual;
39. the engine returns one primary earliest supported divergence;
40. later differences do not replace an earlier supported divergence;
41. matched-prefix summary is available;
42. no-divergence copy says only that none was observed in comparable evidence;
43. coverage is explicit;
44. divergence before evidence truncation remains valid;
45. comparison stops safely at unsupported/ambiguous coverage boundaries;
46. baseline interpretation can be cached;
47. no baseline rerun is required;
48. no new Pyodide execution is triggered by diff analysis;
49. only one pinned baseline is retained;
50. Diff panel is canonical and not duplicated elsewhere;
51. Diff panel default is collapsed;
52. panel disclosure survives compatible live reruns;
53. UI labels sides Baseline and Current;
54. baseline is never labeled correct/expected/good;
55. source-diff indicator is separate from runtime divergence;
56. current divergence navigation uses the existing raw trace cursor;
57. no second raw cursor is introduced;
58. Visual State remains owned by the current run;
59. Decision Evidence remains current-side detail owner;
60. Expression Evidence remains current-side detail owner;
61. What Changed remains current-side detail owner;
62. Call Tree remains single-run structure owner;
63. Failure-First selection remains unchanged;
64. Behavioral Signals remain unchanged;
65. local timeout is not labeled LeetCode TLE;
66. no root-cause/fix language is introduced;
67. no expected execution path is inferred;
68. baseline/current comparison is keyboard accessible;
69. baseline/current difference is understandable without color;
70. scheduler provenance tests pass;
71. value-comparator tests pass;
72. frame-alignment tests pass;
73. decision-diff tests pass;
74. control-flow-diff tests pass;
75. mutation-diff tests pass;
76. recursive execution-order tests pass;
77. coverage/truncation tests pass;
78. Side Panel baseline lifecycle tests pass;
79. existing Call-Frame tests pass;
80. existing Control-Flow tests pass;
81. full Vitest suite passes;
82. Python fixture suite passes;
83. `npm run typecheck` passes;
84. `npm run build` passes.

---

# 101. Resulting Product Architecture

After this milestone:

```text
Pinned TraceSession A
        ↓
interpretTraceSession(A)
        ↓
baseline cross-run projection
        │
        │
        ├───────────────┐
        │               │
        │         Latest TraceSession B
        │               ↓
        │      interpretTraceSession(B)
        │               ↓
        │      current cross-run projection
        │               │
        └──── alignment + checkpoint comparison
                        ↓
              first factual divergence
                        ↓
                 Behavioral Diff UI
                        ↓
                 Inspect current
                        ↓
             existing raw trace cursor
                        ↓
      Visual State / Execution Story / evidence panels
```

No second runtime engine is introduced.

---

# 102. Product Transition

Before this milestone, the extension answers:

> What did this one run actually do?

After this milestone, it can also answer:

> Compared with the run I pinned, where did the latest captured execution first begin behaving differently?

That is a significant shift from visualization alone toward **behavioral debugging**, while still staying evidence-first and solver-independent.

---

# 103. Recommended Next Phase After v0.1

After pinned-baseline diff is stable, the strongest next extension is:

**Case-to-Case Behavioral Diff**

because the same cross-run engine can compare:

```text
same source
Case 1 vs Case 2
```

with a different compatibility policy.

That would help explain:

```text
why this implementation behaves differently on the failing testcase
```

without requiring expected output or an AI solver.

Do not combine Case-to-Case Diff into this first implementation.

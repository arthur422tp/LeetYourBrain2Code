# Call-Frame Foundation Correction

## Design Spec v0.1

**Parent foundation:** `docs/superpowers/specs/2026-09-19-recursion-call-frame-evidence-foundation-design.md`

---

# 1. Purpose

The Recursion / Call-Frame Evidence Foundation is structurally complete, but post-implementation review found two correctness gaps that should be fixed before Call-Frame Execution Story UI work begins:

1. exception candidates are cleared on any later line event, which is incorrect during exception propagation through `finally`;
2. frame-scoped mutation indexing derives ownership from individual mutation variants and therefore drops object-level mutations that do not carry their own `frameId`.

A third issue is test coverage rather than product behavior:

3. hard-timeout call-frame projection is covered across collector/controller layers, but the foundation should retain one explicit regression proving a streamed open frame becomes factual `trace_ended / hard_timeout` evidence.

This correction does not add a new feature. It hardens the factual evidence contract already promised by the parent foundation.

Core acceptance statement:

> Exception exits remain factual through Python `finally` unwinding, every mutation batch is attributed to the runtime frame that produced it, and partial timeout prefixes remain explicitly validated without introducing inferred diagnosis.

---

# 2. Scope

This correction includes:

- preserving a pending exception candidate across `line` events until an authoritative frame terminal boundary resolves it;
- allowing a later exception in the same frame to replace the earlier pending candidate;
- normal return clearing any stale pending exception candidate without classifying the frame as exceptional;
- non-normal return committing the latest pending exception candidate as `frame_exception`;
- retaining `unresolved_exception_unwind` fallback only when a non-normal return occurs without a captured exception candidate;
- regression coverage for propagated exception through `finally`;
- regression coverage for handled exceptions remaining normal returns;
- changing frame-scoped mutation attribution to use authoritative `RuntimeMutationBatch.frameId`;
- including object attribute / object visibility mutations in the frame index when their batch has a factual frame owner;
- preventing mutation attribution when the batch has `frameId: null`;
- one explicit hard-timeout frame-prefix projection regression.

---

# 3. Non-Goals

This correction does not add:

- `try` / `except` / `finally` visualization;
- exception-handler occurrence models;
- `raise` as a first-class control-flow action;
- call-tree UI;
- recursion Execution Story UI;
- backtracking semantics;
- root-cause inference;
- bug likelihood;
- expected call paths;
- code fixes.

The correction remains evidence-first and runtime-factual.

---

# 4. Root Cause A — Line Events Do Not Prove Exception Handling

The current tracer behavior is conceptually:

~~~text
exception event
  -> store pending exception candidate

next line event in same frame
  -> clear pending exception candidate
~~~

This assumes:

> a later line event proves the exception was handled in that frame.

That assumption is false under Python `finally` semantics.

Example:

~~~python
def f():
    try:
        1 / 0
    finally:
        x = 1
        x += 1
~~~

A valid Python trace sequence is:

~~~text
exception ZeroDivisionError
line    # finally body
line    # finally body
return  # non-normal frame unwind boundary
~~~

The `line` events are part of exception unwinding. They do not prove the exception was caught.

Therefore the following transition is invalid:

~~~text
exception_observed
-> line
-> frame_resumed
-> clear candidate
~~~

because it converts a factual exception exit into:

~~~text
trace_ended("unresolved_exception_unwind")
~~~

instead of the correct:

~~~text
frame_exception(ZeroDivisionError)
~~~

---

# 5. Correct Exception Candidate Lifetime

The exception candidate should live until an authoritative terminal boundary decides what happened.

State per active frame:

~~~text
pending_exception_candidate?: ExceptionInfo
~~~

Required transitions:

~~~text
exception event
-> set / replace pending candidate

later line event
-> no call-frame exception state change

another exception event
-> replace pending candidate with the newer factual exception

normal RETURN_VALUE / RETURN_CONST boundary
-> frame_return(...)
-> discard pending candidate

non-normal return boundary
-> if candidate exists:
      frame_exception(candidate)
   else:
      frame_trace_ended("unresolved_exception_unwind")
~~~

Hard invariant:

> A line event is never sufficient evidence, by itself, that a previously observed exception was handled.

This rule correctly covers both:

~~~python
try:
    1 / 0
except ZeroDivisionError:
    return 7
~~~

and:

~~~python
try:
    1 / 0
finally:
    cleanup()
~~~

because the authoritative distinction appears at the final frame boundary:

~~~text
normal return   -> handled / otherwise completed normally
non-normal return -> propagated exception unwind
~~~

---

# 6. Handled Exception Behavior

Handled exceptions must continue to produce normal frame exits when the frame later reaches a normal return opcode.

Example:

~~~python
def f():
    try:
        1 / 0
    except ZeroDivisionError:
        return 7
~~~

Required Call-Frame Evidence:

~~~text
exception raw event exists
frame exit = returned(7)
~~~

Not:

~~~text
frame exit = exception
~~~

The pending exception candidate may remain stored internally until the normal return boundary; `frame_return()` clears it as part of terminal frame cleanup.

---

# 7. Nested / Replaced Exception Candidate

If a frame observes another exception before it exits, the latest factual candidate replaces the previous one.

Example:

~~~python
def f():
    try:
        1 / 0
    finally:
        raise ValueError("replacement")
~~~

Observed candidates:

~~~text
ZeroDivisionError
ValueError("replacement")
~~~

Required frame exit:

~~~text
exception ValueError("replacement")
~~~

The foundation does not need to model causal exception chaining in v0.1. It only needs to preserve the final factual exception that actually unwinds the frame.

---

# 8. Root Cause B — Mutation Ownership Is Already a Batch Property

The current `FrameEvidenceIndex` attempts to recover mutation ownership from each `RuntimeMutation` variant.

This works for variants that include `frameId`, such as:

~~~text
variable
sequence_element
mapping_entry
set_membership
local reference
~~~

but does not work for object-level mutations:

~~~text
object_attribute
object_visibility
~~~

Those mutations intentionally describe object identity and do not carry their own frame field.

However the mutation pipeline already has the authoritative owner:

~~~ts
interface RuntimeMutationBatch {
  step: number;
  frameId: number | null;
  currentLine: number | null;
  mutations: RuntimeMutation[];
}
~~~

The batch's `frameId` is the factual active runtime frame that produced the transition.

Therefore frame indexing must use:

~~~text
RuntimeMutationBatch.frameId
~~~

rather than subtype-specific inference.

---

# 9. Correct Mutation Indexing Contract

`FrameEvidenceIndex` should consume mutation batches directly.

Conceptually:

~~~ts
export interface FrameEvidenceIndexInput {
  callFrames: CallFrameModel;
  events: TraceEvent[];
  decisionEvidence: DecisionEvidenceByStep;
  controlFlow: ControlFlowInterpretation;
  expressionEvidence: ExpressionEvidenceByStep;
  mutationBatches: RuntimeMutationBatch[];
}
~~~

Indexing rule:

~~~text
for each mutationBatch:
    if mutationBatch.frameId is null:
        skip frame attribution

    if mutationBatch.mutations is empty:
        skip mutation anchor

    if callFrames contains mutationBatch.frameId:
        add mutationBatch.step to that frame's mutationAnchors
~~~

This means every mutation variant in the batch receives the same factual frame attribution without copying `frameId` into mutation types that do not semantically own it.

Hard invariant:

> Frame attribution belongs to the runtime transition batch, not to the shape of an individual mutation payload.

---

# 10. Object Mutation Acceptance Cases

The correction must cover at least:

~~~python
node.left = child
~~~

~~~python
current.next = next_node
~~~

~~~python
obj.value = obj.value + 1
~~~

When those operations produce:

~~~text
ObjectAttributeMutation
ObjectVisibilityMutation
~~~

inside a runtime mutation batch with:

~~~text
frameId = N
~~~

then:

~~~text
FrameEvidenceIndex[N].mutationAnchors
~~~

must contain that batch step.

This is important for recursion because multiple invocations of the same static function may mutate shared object topology. Frame attribution must stay occurrence-specific.

---

# 11. Null Frame Mutation Batches

A mutation batch with:

~~~text
frameId = null
~~~

must not be assigned to any frame.

The correction must not:

- guess from object ownership;
- use the most recent frame;
- use source line matching;
- attach to a root frame;
- synthesize a new frame index entry.

Missing attribution remains missing.

---

# 12. Hard-Timeout Regression Contract

The implementation already supports this pipeline:

~~~text
streamed frame_enter
-> browser hard timeout
-> collector preserves prefix
-> interpreter sees no terminal frame update
-> FrameOccurrence.exit = trace_ended("hard_timeout")
~~~

This correction requires one explicit regression that keeps that behavior locked.

Required evidence:

~~~text
session.status = timeout
terminationReason = hard_timeout
frame occurrence preserved
frame exit = trace_ended
reason = hard_timeout
~~~

No exception, return value, or recursion diagnosis may be fabricated.

---

# 13. Files Expected to Change

Primary implementation files:

~~~text
src/worker/python/tracer.py
src/worker/python/call_frame_recorder.py
src/core/frame-evidence-index.ts
src/core/trace-interpreter.ts
~~~

Primary tests:

~~~text
tests/fixtures/python/test_trace_engine.py
tests/fixtures/python/test_call_frame_recorder.py
tests/core/frame-evidence-index.test.ts
tests/core/trace-interpreter.test.ts
tests/execution/trace-session-collector.test.ts
~~~

No worker protocol/schema change is expected.

---

# 14. Compatibility

This correction must preserve:

- Trace Schema v6;
- existing `FunctionPlan`;
- existing `CallFrameBatch`;
- existing `FrameOccurrence`;
- existing worker message types;
- existing call-frame soft limits;
- existing Call Stack UI;
- existing Decision / Expression / Control-Flow evidence;
- existing object mutation payload types.

The correction should be internal and additive in behavior.

---

# 15. Testing Matrix

## Exception semantics

Required Python regressions:

~~~text
handled exception -> normal return
propagated exception -> exception exit
propagated exception through finally -> exception exit
exception replaced inside finally -> latest exception exit
normal return None -> returned None
non-normal unwind without candidate -> trace_ended unresolved fallback
~~~

## Mutation indexing

Required TypeScript regressions:

~~~text
variable mutation batch -> indexed by batch.frameId
object attribute mutation batch -> indexed by batch.frameId
object visibility mutation batch -> indexed by batch.frameId
multiple mutations in one batch -> one anchor
frameId null -> no attribution
unknown frameId -> no synthesized index entry
two recursive frame IDs -> no cross-frame leakage
~~~

## Timeout prefix

Required regression:

~~~text
frame_enter prefix
+ hard_timeout
-> preserved FrameOccurrence
-> trace_ended / hard_timeout
~~~

---

# 16. Definition of Done

The correction is complete when:

1. line events no longer clear pending call-frame exception candidates;
2. normal frame return still classifies handled exceptions as normal returns;
3. propagated exceptions through `finally` classify as `frame_exception`;
4. a newer exception replaces an older pending candidate;
5. non-normal unwind without a candidate remains fail-safe rather than fabricated;
6. frame mutation attribution uses `RuntimeMutationBatch.frameId`;
7. object attribute and visibility mutations are indexed to the factual active frame;
8. null-frame mutation batches remain unattributed;
9. recursive frame mutation anchors do not leak across frame IDs;
10. hard-timeout prefix projection remains covered;
11. no schema or UI expansion is introduced;
12. Python fixture tests pass;
13. Vitest passes;
14. typecheck passes;
15. production build passes.

After these conditions are satisfied, the Recursion / Call-Frame Evidence Foundation may be treated as closed and the next milestone can safely move to **Recursion / Call-Frame Execution Story UI**.

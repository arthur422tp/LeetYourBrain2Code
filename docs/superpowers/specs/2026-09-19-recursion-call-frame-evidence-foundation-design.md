# Recursion / Call-Frame Evidence Foundation

## Design Spec v0.1

**Date:** 2026-09-19  
**Status:** Proposed

---

# 1. Goal

LeetYourBrain2Code already captures factual runtime state, mutations, expression evidence, decision evidence, loop/control-flow occurrences, behavioral patterns, and structure-specific visualizations.

The next milestone is **Recursion / Call-Frame Evidence Foundation v0.1**.

The goal is to make user-code function execution a first-class runtime structure so that recursive and helper-function execution can be represented as factual parent/child frame occurrences rather than only as a transient raw call stack.

The existing evidence stack answers:

~~~text
Runtime State        -> what exists now
Runtime Mutation     -> what changed
Expression Evidence  -> how a value was computed
Decision Evidence    -> how a condition evaluated
Control-Flow Evidence-> which loop/transfer occurrence execution is in
Behavioral Evidence  -> what repeated or stalled over time
~~~

Call-Frame Evidence adds:

~~~text
Call-Frame Evidence  -> which user-code function occurrence is executing,
                        who called it,
                        which arguments Python actually bound,
                        how the frame exited,
                        and which child calls occurred inside it
~~~

Representative example:

~~~python
def depth(node):
    if not node:
        return 0

    left = depth(node.left)
    right = depth(node.right)
    return max(left, right) + 1
~~~

The foundation should be able to preserve factual evidence equivalent to:

~~~text
depth(root)                 frame 1
├─ depth(root.left)         frame 2 -> returned 1
└─ depth(root.right)        frame 5
   ├─ depth(...left)        frame 6 -> returned 1
   └─ depth(...right)       frame 9 -> returned 1
   -> returned 2
-> returned 3
~~~

This is runtime structure, not algorithm interpretation.

Core acceptance statement:

> Given supported user-code function calls, LeetYourBrain2Code can identify concrete frame occurrences, preserve parent/child call relationships, capture post-binding arguments and authoritative exits, distinguish normal return from exception/unwinding or incomplete tracing, and expose a stable frame hierarchy that existing evidence can reference without inferring correctness, intent, or a fix.

---

# 2. Product Principle and Epistemic Boundary

The central product rule remains:

> Visualize what the program actually did.

Call-Frame Evidence may state:

- a user-code frame was entered;
- the frame was called by another observed user-code frame;
- Python bound specific argument values in the callee;
- a child user-code frame was entered;
- the same static function appears again in the active ancestry;
- a frame returned normally with a captured return value;
- a frame exited because a captured exception propagated from it;
- a frame was still active when tracing ended;
- a recursive depth reached a factual observed value;
- multiple concrete invocations of the same static function occurred;
- an existing Decision, Expression, Control-Flow, Mutation, or Behavioral evidence item belongs to a specific frame occurrence.

Call-Frame Evidence must never state or imply:

- that recursion was the correct algorithm;
- that a recursive call was unnecessary, wrong, too deep, or missing;
- that a base case should have fired;
- that a function returned too early or too late;
- that another argument should have been passed;
- that another call path should have been taken;
- that a backtracking choice was correct or incorrect;
- expected recursion from a known-correct solution;
- root cause or bug diagnosis;
- a recommended code fix.

Factual boundary:

~~~text
"depth frame #5 called depth frame #6"          -> yes
"frame #6 bound node = TreeNode(15)"            -> yes
"frame #6 returned 1"                           -> yes
"depth appears in its active ancestry"          -> yes
"this recursive call is redundant"              -> no
"the base case should have returned here"       -> no
"this is where the algorithm went wrong"        -> no
~~~

---

# 3. Why This Foundation Comes Next

The current runtime model already uses frameId throughout several subsystems, but frame identity is mostly an attachment key rather than a fully interpreted runtime entity.

The project can already describe:

~~~text
loop occurrence
decision occurrence
expression occurrence
mutation occurrence
~~~

The missing structural level is:

~~~text
function/frame occurrence
~~~

The intended hierarchy becomes:

~~~text
Program Run
└─ Frame Occurrence
   ├─ Child Frame Occurrence
   ├─ Loop Occurrence
   │  ├─ Decision Occurrence
   │  └─ Transfer Evidence
   ├─ Expression Evidence
   ├─ Runtime Mutation
   └─ Behavioral Evidence
~~~

This foundation is therefore not another visualization adapter. It is a runtime identity layer that allows existing evidence to be organized around actual function execution.

---

# 4. Architectural Choice

Call-Frame Evidence is a **separate interpreted evidence layer** built from authoritative tracer events plus static user-source function metadata.

It does not replace the existing raw trace.

Conceptually:

~~~text
Original Python source
        │
        ├─ existing Expression / Decision / Control-Flow plans
        └─ FunctionPlan
               │
               ▼
        native Python execution
               │
               ▼
        raw call / line / return / exception events
               │
               ▼
        CallFrameRecorder / collector contract
               │
               ▼
        FrameOccurrence evidence
               │
               ▼
        CallFrameInterpreter
               │
               ├─ frame tree
               ├─ ancestry
               ├─ recursion facts
               └─ cross-evidence scoping
~~~

Core invariant:

~~~text
TraceEvent
!= FrameOccurrence
!= ControlFlowEvidence
!= DecisionEvidence
!= ExpressionEvidence
!= RuntimeMutation
~~~

A FrameOccurrence summarizes a concrete runtime frame. The raw events remain authoritative and navigable.

---

# 5. Scope

Call-Frame Evidence Foundation v0.1 includes:

1. deterministic static identity for supported user-defined functions and methods;
2. concrete runtime frame occurrence identity;
3. parent/child frame relationships;
4. post-binding argument snapshots sourced from the callee frame;
5. authoritative normal return capture;
6. factual exception/unwinding exits;
7. incomplete active-frame handling when tracing ends;
8. direct recursion detection from repeated static function identity in active ancestry;
9. mutual recursion support when the callee function already exists anywhere in active ancestry;
10. recursive depth derived from factual ancestry;
11. helper functions and helper methods defined in the submitted user source;
12. nested function definitions when they can be mapped deterministically;
13. frame-scoped linkage to existing Decision, Expression, Control-Flow, Mutation, and Behavioral evidence;
14. deterministic frame-tree interpretation;
15. independent call-frame recording limits and tracing state;
16. protocol and session transport for frame evidence;
17. semantic-preservation, interpreter, protocol, integration, and representative end-to-end tests.

---

# 6. Explicit Non-Goals

v0.1 does not implement:

- call-tree UI;
- recursion animation;
- a recursion-specific Execution Story panel;
- automatic backtracking semantic recognition;
- choice/undo terminology inferred from source shape;
- expected-vs-actual call-tree comparison;
- correctness judgment;
- bug diagnosis;
- fix suggestions;
- algorithm classification such as DFS, divide-and-conquer, dynamic programming, or backtracking;
- time-complexity inference;
- memoization effectiveness analysis;
- cycle detection over logical problem state;
- static call-graph construction for unexecuted paths;
- visualization of uncalled functions;
- built-in/library internals as first-class user frames;
- generator yield/suspend/resume lifecycle;
- async function/task lifecycle;
- coroutine scheduling;
- thread execution;
- multiprocessing;
- debugger-driven invocation of user functions;
- synthetic re-evaluation of call arguments.

A later Recursion / Call-Frame Execution Story UI spec may consume this foundation.

---

# 7. Static Function Identity

Runtime function names alone are not sufficient.

Two functions may share the same name:

~~~python
def solve():
    def visit(x):
        ...
    ...

def other():
    def visit(x):
        ...
~~~

Therefore v0.1 defines deterministic static user-function identity.

Conceptually:

~~~ts
interface FunctionPlan {
  version: 1;
  functions: FunctionDescriptor[];
}

interface FunctionDescriptor {
  functionId: string;
  kind: "function" | "method" | "nested_function";
  name: string;
  qualifiedName: string;
  span: SourceSpan;
  firstBodyLine: number | null;
  parameterNames: string[];
  parentFunctionId?: string;
  parentClassName?: string;
}
~~~

Requirements:

- functionId is deterministic for the same source;
- identity must not depend on runtime frameId;
- identity must not depend on function name alone;
- mapping should prefer source location / AST identity;
- class methods must be distinguishable from same-named top-level functions;
- nested functions must retain lexical parent identity;
- unsupported or ambiguous runtime frames may remain unmapped rather than receiving fabricated static identity.

Lambda support is optional in v0.1 and may be omitted if source mapping is not reliable.

---

# 8. User-Frame Boundary

Call-Frame Evidence focuses on frames originating from the submitted user solution source.

The recorder/interpreter may observe additional Python/Pyodide/library frames internally, but they must not become ordinary user FrameOccurrence nodes unless they can be proven to originate from the user source contract.

Examples normally excluded from the first-class hierarchy:

~~~text
Pyodide/runtime wrapper frames
test harness internals
serializer helpers
instrumentation helpers
Python standard-library implementation frames
debugger synthetic helpers
~~~

The hierarchy should therefore answer:

> Which user function called which other user function?

rather than exposing every interpreter/runtime implementation frame.

Synthetic instrumentation frames must never appear as user calls.

---

# 9. Runtime Frame Occurrence Identity

Every executed user frame receives a concrete runtime occurrence.

Conceptually:

~~~ts
type FrameExitStatus =
  | "active"
  | "returned"
  | "exception"
  | "trace_ended";

interface FrameOccurrence {
  frameId: number;
  functionId?: string;
  functionName: string;

  parentFrameId?: number;
  depth: number;

  callStep: number;
  firstUserLineStep?: number;
  exitStep?: number;

  arguments: BoundArgumentSnapshot[];

  exit:
    | { status: "active" }
    | { status: "returned"; value: ValueSnapshot }
    | { status: "exception"; exception: ExceptionSnapshot }
    | { status: "trace_ended"; reason: string };

  recursion: RecursionOccurrenceInfo;

  childFrameIds: number[];
}
~~~

The existing tracer frameId remains authoritative for runtime identity when available.

Core invariant:

> Static function identity tells us which function definition; frameId tells us which concrete invocation.

---

# 10. Call Occurrence vs Frame Occurrence

A call edge and a callee frame are related but conceptually distinct.

A FrameOccurrence represents the callee execution.

A CallOccurrence represents the factual parent -> child transition.

Conceptually:

~~~ts
interface CallOccurrence {
  callerFrameId?: number;
  calleeFrameId: number;

  callerStep?: number;
  calleeCallStep: number;

  calleeFunctionId?: string;
  calleeFunctionName: string;
}
~~~

v0.1 does not require static AST decomposition of arbitrary call expressions.

The call relationship is established from runtime frame ancestry, not by re-evaluating or statically predicting a call expression.

If the exact caller source step cannot be proven, callerStep remains absent rather than guessed.

---

# 11. Argument Capture

Arguments must be captured **after Python has already bound them in the callee frame**.

The debugger must not re-evaluate call arguments.

For:

~~~python
visit(node.left, index + 1)
~~~

the foundation may capture:

~~~text
callee parameter node  = actual bound runtime value
callee parameter depth = actual bound runtime value
~~~

It must not separately execute:

~~~text
node.left
index + 1
~~~

to reconstruct arguments.

Conceptually:

~~~ts
interface BoundArgumentSnapshot {
  name: string;
  value: ValueSnapshot;
  kind:
    | "positional_or_keyword"
    | "positional_only"
    | "keyword_only"
    | "varargs"
    | "varkw"
    | "unknown";
}
~~~

Argument order follows the static parameter descriptor when mapping is available.

If a value cannot be serialized safely, existing ValueSnapshot fallback rules apply.

---

# 12. self / cls Handling

For LeetCode Solution methods, self is usually implementation context rather than the most useful algorithm input.

The evidence model may retain self or cls internally when present because they are factual bindings.

Presentation layers may later choose to de-emphasize them.

The foundation must not drop self if doing so would break:

- object identity;
- helper-method receiver identity;
- mutation ownership;
- method-to-method call linkage.

No UI policy is fixed by this foundation.

---

# 13. Parent / Child Frame Relationships

Parentage is determined from factual runtime stack transitions.

Example:

~~~python
def outer(x):
    return helper(x - 1)
~~~

Observed hierarchy:

~~~text
outer frame 10
└─ helper frame 11
~~~

Required invariants:

- each non-root user frame has at most one factual parent frame occurrence;
- child order preserves runtime call order;
- siblings are not sorted by function name or source location;
- repeated calls to the same function produce distinct child frame occurrences;
- recursive children do not merge into the parent;
- trace truncation must not fabricate missing children or exits.

The first observed user frame for the selected execution request may have no user parent.

---

# 14. Recursion Facts

Recursion classification is factual and ancestry-based.

A new frame is considered recursive when its mapped functionId already appears in its active user-frame ancestry.

Conceptually:

~~~ts
interface RecursionOccurrenceInfo {
  isRecursive: boolean;
  recursionDepth: number;
  repeatedAncestorFrameId?: number;
  cycleFunctionIds?: string[];
}
~~~

Direct recursion:

~~~text
A -> A
~~~

Mutual recursion:

~~~text
A -> B -> A
~~~

Both are supported if static function identity is available.

The foundation may state:

~~~text
A appears again in its active ancestry
recursive depth = 3
~~~

It must not state:

~~~text
infinite recursion
excessive recursion
wrong recursion
missing base case
~~~

unless a separate future evidence layer proves a more specific factual condition.

---

# 15. Recursive Depth

Recursive depth is derived only from observed active ancestry.

For direct recursion:

~~~text
depth frame 1
└─ depth frame 2
   └─ depth frame 3
~~~

the deepest observed occurrence may expose recursionDepth = 3 under the chosen definition.

The exact definition must be stable:

> recursionDepth counts occurrences of the current functionId in the active ancestry including the current frame.

For mutual recursion, the foundation may also expose the repeated ancestor and cycle function identities, but UI interpretation is deferred.

General stack depth and recursive depth are distinct values.

---

# 16. Normal Return Capture

A normal return is authoritative only when the tracer records the frame's actual return boundary.

For:

~~~python
return left + right
~~~

Expression Evidence may explain the value computation.

Call-Frame Evidence records:

~~~text
frame exited normally
return value = captured runtime value
~~~

The return value must come from the authoritative tracer/runtime channel, not from re-evaluating the source expression.

Bare return is represented factually as a normal returned None when the runtime proves that exit.

---

# 17. Exception and Unwinding Exit

A frame returning None is not sufficient evidence that it completed normally.

Python tracing behavior around propagated exceptions requires the recorder/interpreter to use explicit captured exception evidence when classifying frame exit.

Conceptually:

~~~ts
interface ExceptionSnapshot {
  typeName: string;
  message?: string;
}
~~~

Required behavior:

- captured exception propagates out of frame -> exit.status = exception;
- normal return of None -> exit.status = returned with None;
- tracing ends while frame is active -> exit.status = trace_ended;
- do not infer exception from a missing return value alone;
- do not infer normal return solely from disappearance from a later visible stack.

Exception ownership and propagation should use existing authoritative trace/session semantics where available.

---

# 18. Trace End / Timeout / Trace Limit

If execution capture terminates while user frames remain active, those frames must remain incomplete.

Examples:

~~~text
timeout
trace_limit
worker termination
collector truncation
call-frame event limit
~~~

The foundation should finalize active frames as:

~~~text
exit.status = trace_ended
~~~

with a factual reason when known.

It must not fabricate:

~~~text
returned None
exception
completed recursion
base case reached
~~~

This is especially important for recursive executions that exceed trace or wall-clock limits.

---

# 19. Frame Recording Limits

Call-Frame Evidence uses an independent bounded recording budget.

Conceptually:

~~~ts
type CallFrameTracingState =
  | { status: "complete" }
  | { status: "truncated"; reason: "call_frame_event_limit" }
  | { status: "unavailable"; reason: string };
~~~

Requirements:

- reaching the call-frame evidence limit must not change Python semantics;
- raw execution may continue subject to the existing trace/runtime limits;
- previously recorded frame evidence remains valid;
- no later unrecorded frame may be synthesized from UI-visible stack shape;
- tracing state travels independently from other evidence-layer limits.

The initial limit should be chosen high enough for representative recursion while remaining bounded.

---

# 20. No Debugger-Driven Invocation

The debugger must never create function calls solely to learn call-frame structure.

Forbidden behavior includes:

~~~text
calling a helper again to inspect its arguments
executing a recursive call in isolation
calling repr-like user hooks purely for classification
re-running a base case
invoking iterators to discover future calls
~~~

The native Python execution is authoritative.

Call-Frame Evidence observes; it does not drive the program.

---

# 21. Synthetic Instrumentation Boundary

Prefer deriving frame entry/exit from the authoritative tracer rather than wrapping every call expression.

Static instrumentation may be used only when necessary to attach deterministic user-source function identity or metadata without changing call semantics.

Any synthetic helper must satisfy:

- no additional user-visible call;
- no extra evaluation of arguments;
- no change to exception propagation;
- no change to object identity;
- no change to return value;
- no synthetic source line in the user trace;
- no pollution of user Call-Frame Evidence.

If reliable static-to-runtime mapping can be achieved without call-expression instrumentation, that approach is preferred.

---

# 22. Nested Functions and Closures

Nested def execution is supported when runtime frames can be mapped deterministically to a FunctionDescriptor.

Example:

~~~python
def solve(nums):
    def dfs(i):
        ...
    return dfs(0)
~~~

Expected hierarchy:

~~~text
solve
└─ dfs(0)
   └─ dfs(1)
~~~

Closure cell values are not automatically treated as formal arguments.

They remain ordinary runtime locals/nonlocals according to existing state capture.

The foundation must not copy the entire closure environment into argument evidence.

---

# 23. Methods and Helper Methods

Standard LeetCode patterns such as:

~~~python
class Solution:
    def maxDepth(self, root):
        return self.depth(root)

    def depth(self, node):
        ...
~~~

should produce distinct static function identities and concrete frame occurrences.

Method-to-method parentage is runtime-based.

The foundation does not need general Python descriptor protocol visualization.

Decorators, metaclasses, dynamically replaced methods, and unusual descriptor behavior may be treated as unsupported/ambiguous if deterministic mapping is not possible.

---

# 24. Existing Evidence Integration

Existing evidence already carries frameId in several places.

Call-Frame Evidence makes frameId structurally meaningful.

The integration rule is:

~~~text
CallFrame owns frame occurrence identity
ControlFlow owns loop/transfer occurrence inside a frame
Decision owns condition evaluation inside a frame/context
Expression owns computation evidence inside a frame
Mutation owns runtime change evidence
Behavioral owns repeated/stalled observations
~~~

No layer should duplicate another layer's facts.

Examples:

- CallFrame does not explain why a condition was true;
- CallFrame does not recompute a return expression;
- CallFrame does not infer loop iteration outcome;
- Decision does not own parent/child frame relationships;
- ControlFlow does not infer recursive ancestry.

---

# 25. Frame-Scoped Cross-Evidence Projection

The interpreter should make it easy to ask:

~~~text
Which decisions occurred in frame 12?
Which loop occurrences belong to frame 12?
Which expression evidence belongs to frame 12?
Which mutations occurred while frame 12 was active?
Which child frames were called from frame 12?
~~~

Conceptually:

~~~ts
interface FrameEvidenceIndex {
  byFrameId: Map<number, {
    decisionEvidenceIds: string[];
    loopOccurrenceRefs: LoopOccurrenceRef[];
    expressionEvidenceSteps: number[];
    mutationSteps: number[];
    childFrameIds: number[];
  }>;
}
~~~

This index is a projection over existing evidence, not a new source of truth.

Missing evidence from another truncated layer must remain missing.

---

# 26. Frame Tree Interpretation

The core interpreter builds a deterministic runtime tree/forest from FrameOccurrence evidence.

Conceptually:

~~~ts
interface CallFrameModel {
  roots: FrameOccurrence[];
  byFrameId: Map<number, FrameOccurrence>;
  currentFrameId?: number;
  tracingState: CallFrameTracingState;
}
~~~

Properties:

- roots preserve runtime start order;
- children preserve runtime call order;
- recursive frames remain ordinary child nodes;
- no deduplication by functionId;
- no collapsing repeated calls in the foundation;
- no UI folding policy in v0.1.

A later presentation layer may fold or summarize repeated subtrees without changing this authoritative model.

---

# 27. Current Frame and Ancestry

Given the raw trace cursor, the interpreter should be able to resolve the factual current user frame where possible.

Conceptually:

~~~ts
interface FrameCursorContext {
  currentFrameId?: number;
  ancestors: number[];
  activeChildPath: number[];
}
~~~

Resolution must use authoritative raw event/frame identity.

It must not infer the current frame from:

~~~text
function-name text
source indentation
latest rendered call-stack row
visual tree selection
~~~

If the cursor is outside user-code execution or evidence is unavailable, currentFrameId may be absent.

---

# 28. Backtracking Boundary

Recursive backtracking is an important future UX target, but v0.1 does not introduce inferred backtracking semantics.

The foundation may factually expose:

~~~text
parent frame entered
child frame entered
child returned
parent state later changed
another child entered
~~~

It must not automatically rename that sequence:

~~~text
choose
explore
undo
backtrack
prune
~~~

Those labels require a future evidence design with its own proof boundary.

A later UI may still visually present call expansion/collapse using neutral terminology.

---

# 29. Repeated Recursive Motifs

Existing Behavioral Evidence may observe repeated state or transition patterns during recursion.

Call-Frame Evidence does not automatically convert repeated child-call shape into a BehavioralPattern.

Future work may use stable frame identity to define recursion-aware folding or repeated subtree presentation.

v0.1 only provides the factual hierarchy needed for such work.

---

# 30. Failure-First Boundary

Failure-First remains unchanged in this foundation.

Call-Frame Evidence may later improve inspection context near:

~~~text
exception
timeout
trace_limit
~~~

but v0.1 does not automatically select:

~~~text
deepest recursive frame
last recursive call
largest recursion depth
last return
~~~

as suspicious.

No call frame receives bug-likelihood weighting.

---

# 31. Protocol Contract

Frame evidence must travel through the worker/session pipeline as typed data.

Conceptually:

~~~ts
interface CallFrameBatch {
  frames: FrameOccurrence[];
  tracingState: CallFrameTracingState;
}
~~~

The exact batching strategy may follow existing Decision / Control-Flow evidence transport patterns.

Requirements:

- serialization is bounded;
- ValueSnapshot contracts are reused;
- frameId values remain stable across worker -> collector -> session;
- partial batches do not create duplicate frame occurrences;
- a later status update may finalize an existing active frame;
- the collector must reject or safely handle malformed parent references rather than silently inventing ancestry.

---

# 32. Session Contract

TraceSession gains optional call-frame evidence.

Conceptually:

~~~ts
interface TraceSession {
  ...
  functionPlan?: FunctionPlan;
  callFrameBatches?: CallFrameBatch[];
  callFrameTracing?: CallFrameTracingState;
}
~~~

Backward compatibility:

- sessions without call-frame evidence remain valid;
- existing visualizers continue to function;
- existing raw Call Stack remains usable;
- Decision / Expression / Control-Flow evidence does not require Call-Frame Evidence to render its existing v0.1 UI.

This foundation should be additive.

---

# 33. Performance Requirements

Recursive traces can create many frames quickly.

v0.1 should therefore:

- keep frame evidence bounded;
- snapshot only formal argument bindings, not every local at entry;
- reuse existing ValueSnapshot serialization limits;
- avoid storing duplicate complete call stacks on every frame event;
- store parentFrameId rather than copied ancestry;
- compute ancestry in the interpreter/index when needed;
- preserve O(number of recorded frames) tree construction;
- avoid quadratic descendant scans during ordinary cursor navigation;
- keep evidence collection off the Side Panel main thread.

A frame hierarchy must remain inspectable even when some deep values are truncated by serialization limits.

---

# 34. Semantic-Preservation Requirements

Representative semantic-preservation cases must include:

~~~python
# direct recursion
def f(n):
    if n == 0:
        return 0
    return f(n - 1) + 1
~~~

~~~python
# mutual recursion
def even(n):
    if n == 0:
        return True
    return odd(n - 1)

def odd(n):
    if n == 0:
        return False
    return even(n - 1)
~~~

~~~python
# exception propagation
def a():
    return b()

def b():
    raise ValueError("boom")
~~~

~~~python
# nested function
def solve(n):
    def helper(k):
        if k == 0:
            return 1
        return helper(k - 1)
    return helper(n)
~~~

~~~python
# repeated siblings
def solve(xs):
    return helper(xs[0]) + helper(xs[1])
~~~

For every case, enabling Call-Frame Evidence must not change:

- result value;
- exception type/message;
- mutation behavior;
- call count;
- iterator consumption;
- object identity visible to user code.

---

# 35. Testing Strategy

## 35.1 Static function-plan tests

Verify deterministic descriptors for:

- top-level function;
- Solution method;
- helper method;
- nested function;
- same-name nested functions in different lexical parents;
- multiple methods with different spans;
- unsupported/ambiguous mapping fallback.

## 35.2 Frame recorder tests

Verify:

- root user frame creation;
- parent/child relationship;
- sibling call ordering;
- post-binding argument capture;
- normal return;
- bare return;
- exception propagation;
- active frame finalized as trace_ended;
- event-limit truncation.

## 35.3 Recursion tests

Verify:

- direct recursion;
- recursion depth;
- repeated ancestor frame reference;
- mutual recursion A -> B -> A;
- non-recursive repeated sibling calls are not marked recursive;
- same function called sequentially after the prior call returned is not treated as active recursive ancestry.

## 35.4 Interpreter tests

Verify:

- deterministic frame tree;
- byFrameId lookup;
- current frame resolution by raw cursor;
- ancestor path;
- root order;
- partial/truncated model;
- no deduplication by function identity.

## 35.5 Cross-evidence tests

Verify frame scoping for:

- Decision Evidence;
- Control-Flow occurrences;
- Expression Evidence;
- Runtime Mutation;
- recursive function containing nested loops/branches.

## 35.6 Protocol/session tests

Verify:

- worker transport;
- collector merging/finalization;
- optional backward-compatible fields;
- malformed/duplicate batch handling;
- tracing status propagation.

## 35.7 End-to-end Pyodide tests

Representative E2E cases:

1. factorial-style direct recursion;
2. binary-tree depth recursion using TreeNode;
3. recursive helper plus Decision Evidence base case;
4. recursive helper with a loop inside each frame;
5. mutual recursion;
6. exception unwinding from deepest frame;
7. timeout or trace-limit prefix with active frames;
8. repeated sibling helper calls that must remain distinct occurrences.

---

# 36. Representative Acceptance Scenarios

## Scenario A: direct recursion

~~~python
def f(n):
    if n <= 0:
        return 0
    return f(n - 1) + 1
~~~

Required factual model:

~~~text
f(n=3) frame 1
└─ f(n=2) frame 2
   └─ f(n=1) frame 3
      └─ f(n=0) frame 4 -> returned 0
      -> returned 1
   -> returned 2
-> returned 3
~~~

No claim is made about correctness.

## Scenario B: repeated but non-recursive calls

~~~python
a = helper(1)
b = helper(2)
~~~

Required:

~~~text
caller
├─ helper(1) frame 2
└─ helper(2) frame 3
~~~

Neither helper occurrence is recursive if the first has already returned before the second begins.

## Scenario C: exception unwind

~~~python
def outer():
    return inner()

def inner():
    raise ValueError("boom")
~~~

Required:

~~~text
outer frame
└─ inner frame -> exception ValueError
outer frame -> exception ValueError
~~~

Do not convert the None-like trace return boundary into a normal returned None.

## Scenario D: trace ends mid-recursion

~~~text
f frame 1
└─ f frame 2
   └─ f frame 3
      └─ f frame 4
         trace capture ends
~~~

Required:

~~~text
active affected frames -> trace_ended
~~~

No fabricated returns.

---

# 37. Definition of Done

Recursion / Call-Frame Evidence Foundation v0.1 is complete when:

1. supported user-defined functions/methods receive deterministic static function identity;
2. concrete user runtime frames receive stable FrameOccurrence identity;
3. parent/child relationships preserve actual runtime call order;
4. callee argument evidence is captured after Python binding without re-evaluation;
5. repeated calls remain distinct frame occurrences;
6. direct recursion is identified from factual active ancestry;
7. mutual recursion can be identified when static identity is available;
8. general stack depth and recursive depth remain distinct;
9. normal return values come from authoritative runtime return evidence;
10. bare return is represented correctly;
11. propagated exception exits are distinguishable from normal returned None;
12. frames active at capture termination become trace_ended rather than fabricated returns;
13. synthetic instrumentation never appears as user frames;
14. built-in/runtime wrapper frames do not pollute the ordinary user hierarchy;
15. existing evidence can be scoped by frameId without duplicating facts;
16. a deterministic frame tree/index can be built in core;
17. current-frame ancestry can be resolved from the raw trace cursor;
18. call-frame evidence has an independent bounded tracing state;
19. sessions without call-frame evidence remain backward compatible;
20. no call-tree UI or algorithmic backtracking semantics are required by this foundation;
21. focused unit tests, Python semantic tests, protocol tests, integration tests, and representative Pyodide E2E tests pass;
22. full test suite, typecheck, and production build remain green.

---

# 38. Resulting Architecture

After this milestone, the evidence hierarchy becomes:

~~~text
Program Run
└─ Function / Frame Occurrence
   ├─ Child Function / Frame Occurrence
   ├─ Loop Occurrence
   │  ├─ Decision Occurrence
   │  └─ Transfer Evidence
   ├─ Expression Evidence
   ├─ Runtime Mutation
   └─ Behavioral Evidence
~~~

This gives the project the missing runtime structure needed for a later **Recursion / Call-Frame Execution Story UI** and, after that, more reliable cross-run trace alignment and behavioral diffing.

The foundation remains evidence-first:

> show the function calls Python actually executed, with the values and exits the runtime actually produced, without turning those facts into an inferred solution or diagnosis.

# 39. Implementation Status

Implemented:

- static `FunctionPlan` identities and post-binding argument snapshots;
- runtime `FrameOccurrence` evidence with factual parent/child relationships;
- authoritative normal-return, exception-unwind, and `trace_ended` exits;
- direct and mutual recursion facts derived from active ancestry;
- deterministic frame tree and raw-trace cursor context;
- frame-scoped Decision, Control-Flow, Expression, and Mutation evidence indexing;
- independent bounded call-frame streaming, session transport, and backward-compatible optional fields;
- representative Pyodide end-to-end validation, including hard-timeout and independent truncation prefixes.

Correction status (2026-09-20):

- exception candidates now survive `finally` line events until normal return, a newer exception, or non-normal unwind determines the factual exit;
- frame-scoped mutation indexing uses `RuntimeMutationBatch.frameId`, including object-attribute and object-visibility mutations;
- the controller path now has a streamed call-frame-prefix hard-timeout regression test.

Deferred:

- call-tree UI;
- recursion Execution Story;
- backtracking semantic evidence;
- cross-run call-tree diff.

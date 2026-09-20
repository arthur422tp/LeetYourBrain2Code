# Recursion / Call-Frame Execution Story UI

## Design Spec v0.1

**Date:** 2026-09-20  
**Status:** Proposed  
**Runtime dependency:** `docs/superpowers/specs/2026-09-19-recursion-call-frame-evidence-foundation-design.md`  
**Correction dependency:** `docs/superpowers/specs/2026-09-20-call-frame-foundation-correction-design.md`  
**Existing UI dependency:** `docs/superpowers/specs/2026-09-17-control-flow-execution-story-ui-design.md`

---

# 1. Goal

This document defines the first user-facing projection of the Call-Frame / Recursion Evidence foundation.

The runtime already knows factual execution structure such as:

```text
which concrete user frame entered
which frame called it
which arguments Python actually bound
which child calls occurred
which static function definition each frame maps to
whether the same function identity appears in active ancestry
how deep that repeated ancestry is
whether the frame returned, unwound with an exception, or remained incomplete
which Decision / Control-Flow / Expression / Mutation evidence belongs to each frame
```

The UI must turn those facts into a compact execution story that answers:

> Which function occurrence am I in, how did execution get here, what child calls occurred, and how did each concrete call exit?

Representative target:

```text
Execution Story

maxDepth(root=3) · frame 1
├─ maxDepth(root=9) · frame 2
│  ├─ maxDepth(root=None) → 0
│  └─ maxDepth(root=None) → 0
│  → returned 1
└─ maxDepth(root=20) · frame 5
   ├─ maxDepth(root=15) → 1
   └─ maxDepth(root=7) → 1
   → returned 2
→ returned 3
```

This presentation is factual runtime structure.

It is **not** a solver, algorithm classifier, correctness checker, or recursion diagnosis system.

---

# 2. Product Boundary

The UI may state factual runtime facts such as:

```text
Called
Returned 3
Raised ValueError
Trace ended
Recursive depth 4
Called by solve(...)
3 child calls
Current frame
Current path
Arguments: n = 3
```

The UI must not state or imply:

```text
correct recursive call
wrong recursive call
missing base case
base case should have fired
too much recursion
unnecessary call
bad branch
wrong return
should have returned earlier
should recurse left first
infinite recursion
backtracking mistake
root cause
fix
expected call tree
optimal recursion
DFS / BFS classification inferred from shape
```

Even when the observed frame hierarchy looks suspicious, the UI remains evidence-first.

---

# 3. Primary UX Decision: Extend Execution Story, Do Not Add a Competing Long Panel

The Side Panel already contains:

```text
Code
Visual State
Execution Story
Decision Evidence
Expression Evidence
What Changed
Locals
advanced execution analysis
```

A separate always-visible `Call Tree` panel would duplicate structural navigation and increase vertical density.

v0.1 therefore evolves the existing **Execution Story** into a frame-aware structural view.

Recommended structure:

```text
Execution Story
├─ Current Frame
├─ Call Path
├─ Call Tree
└─ Current Occurrence Story
   ├─ existing loop / decision / transfer story
   └─ frame exit boundary when relevant
```

The existing Control-Flow Execution Story remains valid.

Call-Frame UI adds the missing outer hierarchy:

```text
Program
└─ Frame occurrence
   └─ Loop occurrence
      ├─ Decision
      └─ Transfer
```

The panel becomes available when either:

- Call-Frame Evidence exists; or
- Control-Flow Evidence exists.

No second independent execution cursor is introduced.

---

# 4. Information Architecture

Recommended Side Panel order remains:

```text
Code
Visual State
Execution Story
Decision Evidence
Expression Evidence
What Changed
Locals
Execution analysis & advanced
```

Within Execution Story:

```text
Current frame summary
Call path
Call tree
Current loop / control-flow story
```

Responsibilities:

```text
Call Tree            → which concrete calls occurred and parent/child structure
Current Frame        → arguments, exit, recursion fact for selected raw cursor
Call Path            → ancestry root → current frame
Control-Flow Story   → what happened inside the current loop occurrence
Decision Evidence    → why a condition evaluated as captured
Expression Evidence  → how a supported expression evaluated
What Changed         → mutation details
Visual State         → structures and values at the current raw step
```

Call-Frame UI must not duplicate full Decision trees, expression trees, or mutation payloads.

---

# 5. Required Inputs

The UI consumes already interpreted evidence.

It must not reconstruct recursion from repeated function names or raw indentation.

Required inputs conceptually:

```ts
interface CallFrameStoryInput {
  callFrames: CallFrameModel;
  frameEvidenceIndex: FrameEvidenceIndex;
  functionPlan?: FunctionPlan;
  events: TraceEvent[];
  currentRawIndex: number;
}
```

Core should expose a presentation projection:

```ts
interface CallFrameStoryModel {
  currentFrame?: CallFrameStoryNode;
  currentPath: CallFrameStoryNode[];
  roots: CallFrameStoryNode[];
  tracingState: CallFrameTracingState;
}

interface CallFrameStoryNode {
  frameId: number;
  functionId?: string;
  functionName: string;
  qualifiedName?: string;
  arguments: BoundArgumentSnapshot[];
  callStep: number;
  firstUserLineStep?: number;
  exit: FrameExit;
  recursion: RecursionOccurrenceInfo;
  childFrameIds: number[];
  evidenceCounts: {
    decisions: number;
    loopIterations: number;
    expressions: number;
    mutations: number;
  };
}
```

This is a projection only.

Authoritative truth remains in:

```text
CallFrameModel
FrameEvidenceIndex
raw TraceEvent
existing evidence layers
```

---

# 6. Current Frame Selection

The current raw cursor remains authoritative.

Current frame is resolved through the existing factual mapping:

```text
raw event.frameId
→ CallFrameModel.byFrameId
→ FrameCursorContext
```

The UI must never choose current frame from:

```text
function name
latest visible tree row
deepest recursion node
selected visual object
source indentation
last-entered frame globally
```

If the current raw event belongs to a frame absent from Call-Frame Evidence because the channel truncated, show a neutral unavailable state rather than synthesizing a node.

---

# 7. Current Frame Summary

At the top of Execution Story, render a compact summary.

Example:

```text
Current frame
maxDepth(root=20)
Frame 5 · depth 2 · recursive depth 2
```

Non-recursive helper:

```text
helper(nums=[...], index=3)
Frame 8 · depth 3
```

Exit states:

```text
Returned 2
Raised ValueError
Trace ended · hard_timeout
Active at this step
```

Important distinction:

```text
depth            = call-stack depth
recursive depth  = repeated static function identity in active ancestry
```

Do not label ordinary stack depth as recursion depth.

---

# 8. Function Labeling

Prefer the most specific factual static identity available.

Priority:

```text
FunctionDescriptor.qualifiedName
→ FrameOccurrence.functionName
→ neutral "user function"
```

Examples:

```text
Solution.maxDepth
Solution.solve.helper
outer.visit
helper
```

The compact call-tree label may omit `Solution.` when visually redundant, but accessible text should retain the qualified identity.

Never infer semantic names such as:

```text
DFS
backtrack
search left
base case
recursive step
```

unless those words literally exist in user identifiers and are displayed as source identifiers.

---

# 9. Argument Presentation

Arguments come from `BoundArgumentSnapshot`.

Compact node label examples:

```text
f(n=3)
helper(index=2, target=7)
maxDepth(root=TreeNode#obj-3)
```

Rules:

- preserve declared parameter order;
- de-emphasize `self` / `cls` in the visible compact label by default;
- do not remove `self` / `cls` from underlying evidence;
- use existing `formatValue` behavior;
- truncate long values rather than expanding the entire object snapshot;
- full locals remain in Locals;
- argument object inspection remains in existing visual/state surfaces.

Recommended compact threshold:

```text
up to 3 visible parameters
then "…"
```

This is a UI density rule, not an evidence limit.

---

# 10. Call Path

Show root-to-current ancestry above the tree when the current frame is nested.

Example:

```text
Call path
solve(3) → visit(3) → visit(2) → visit(1)
```

For deep recursion, compact middle ancestry:

```text
solve → visit(15) → … 6 frames … → visit(8) → visit(7)
```

The path must preserve factual ancestry.

A compacted path may hide middle rows visually, but must not imply that hidden frames did not exist.

Each visible path segment navigates to that frame's authoritative call step.

---

# 11. Call Tree

The Call Tree is the main recursion visualization.

Basic structure:

```text
solve(nums)
└─ dfs(0)
   ├─ dfs(1)
   │  └─ dfs(2)
   └─ dfs(3)
```

Each row represents one concrete `FrameOccurrence`.

Repeated calls to the same function are separate rows.

No deduplication by `functionId`.

No static unexecuted calls are shown.

No node exists merely because a call expression appears in source.

---

# 12. Tree Row Content

Default row:

```text
▸ dfs(i=2)          → 4
```

Possible suffixes:

```text
→ 4
→ None
⚠ ValueError
… trace ended
active
```

Recursive occurrence badge:

```text
recursive · depth 3
```

Evidence-count metadata may be shown only in expanded/detail mode:

```text
2 decisions · 1 loop · 3 mutations
```

Do not put all evidence counts on every row by default.

The primary scan path must remain:

```text
function(args) + exit
```

---

# 13. Current Path Highlighting

At a raw cursor inside frame 9:

```text
solve frame 1
└─ dfs frame 4
   └─ dfs frame 7
      └─ dfs frame 9   ← current
```

Required states:

- current frame: `aria-current="step"`;
- ancestors of current frame: factual current-path styling;
- unrelated sibling frames: neutral;
- returned ancestors remain visible as historical nodes;
- current-path styling must update when raw Previous / Next / Play changes.

Color may assist, but text/DOM semantics must carry the state.

---

# 14. Tree Expansion Policy

A recursive tree can become large quickly.

Default expansion policy:

1. always show roots;
2. auto-expand the factual current ancestry;
3. show direct siblings of the current path;
4. collapse unrelated deep subtrees by default;
5. preserve user expansion choices while navigating within the same session;
6. newly current ancestry may auto-expand as needed;
7. never auto-collapse the current path.

Example:

```text
▼ maxDepth(3)
  ▼ maxDepth(9)
    maxDepth(None) → 0
    maxDepth(None) → 0
  ▼ maxDepth(20)       ← current ancestry
    maxDepth(15) → 1
    maxDepth(7) → 1
```

Large-subtree summary:

```text
▶ 14 child calls
```

This is visual folding only.

Underlying FrameOccurrence nodes remain unchanged.

---

# 15. Deep Recursion Density

Do not render thousands of fully expanded DOM rows.

v0.1 should use bounded presentation.

Recommended initial thresholds:

```text
max auto-rendered visible rows: 120
max auto-expanded depth away from current path: 2
```

If the factual tree exceeds the presentation threshold:

```text
+ 284 additional recorded frames
Show more
```

This is independent from Call-Frame tracing truncation.

Distinguish:

```text
UI tree folded / paged
vs
Call-frame evidence truncated
```

Never label presentation folding as evidence loss.

---

# 16. Recursive Depth Presentation

A recursive occurrence may show:

```text
recursive · depth 4
```

This is factual only when `RecursionOccurrenceInfo.isRecursive === true`.

The first invocation of a recursive function definition normally has:

```text
recursive depth = 1
isRecursive = false
```

Do not badge the first invocation as recursive solely because one of its children later calls the same function.

For mutual recursion:

```text
even(4)
└─ odd(3)
   └─ even(2)   recursive · depth 2
```

Optional detail text may show the factual cycle:

```text
even → odd → even
```

Do not label the cycle pathological.

---

# 17. Exit Presentation

Normal return:

```text
dfs(None) → 0
```

Complex value:

```text
helper(...) → [1, 2, 3]
```

Bare return:

```text
helper(...) → None
```

Exception:

```text
inner(...) ⚠ ValueError
```

Trace ended:

```text
visit(932) … trace ended · step_limit
```

Active frame at the current raw step may show:

```text
visit(3) · active
```

Important:

A frame may have a final recorded exit in the session while the current cursor is positioned earlier inside that frame.

The row may show session-final exit in a secondary slot, but the current-frame detail must distinguish:

```text
At current step: active
Session outcome: returned 3
```

Do not imply that the return already happened at the current raw cursor.

---

# 18. Temporal Boundary: Current-Step State vs Session-Final Frame Outcome

This distinction is mandatory.

`FrameOccurrence.exit` describes the frame's observed session outcome.

The UI also has a current raw cursor.

Example:

```text
step 8: inside dfs(2)
step 19: dfs(2) returns 4
```

At step 8:

```text
Current frame: dfs(2)
At this step: active
Observed later in captured execution: returned 4
```

Do not show only:

```text
dfs(2) → 4
```

in a way that implies the return has already occurred at step 8.

Tree rows may keep compact final suffixes for whole-run scanning, but the current-frame detail must explicitly preserve temporal semantics.

---

# 19. Navigation Contract

All navigation flows through the existing raw trace cursor.

Call-tree node click:

```text
frame.callStep
→ existing raw step lookup
→ existing current index update
```

Optional secondary navigation:

- click return suffix -> `exit.step`;
- click first-line affordance -> `firstUserLineStep`;
- click frame argument label -> remains at call step, does not create a new cursor.

No Call Tree component owns its own execution position.

There may be a UI-only expanded/collapsed selection state, but not a second runtime cursor.

---

# 20. Current-Frame Evidence Summary

The Execution Story may show a compact frame evidence summary:

```text
In this call
2 decisions · 1 loop iteration · 3 expressions · 4 mutations
```

These counts come only from `FrameEvidenceIndex`.

Clicking a count should navigate/open the existing evidence surface where practical.

Examples:

```text
2 decisions
→ navigate to first decision anchor in this frame
→ Decision Evidence remains the detail owner
```

```text
4 mutations
→ navigate to first mutation anchor
→ What Changed remains the detail owner
```

Do not duplicate the full evidence details inside the call-tree row.

---

# 21. Existing Control-Flow Execution Story Integration

The existing loop-oriented Execution Story remains intact.

New frame-aware composition:

```text
Execution Story

Current frame
visit(value=2)
Call path: solve → visit(3) → visit(2)

Call tree
...

Inside this frame
FOR · line 8
Iteration #1

1. iteration started
2. value <= 0 → False
3. total += item
4. iteration completed
```

When no loop occurrence is active:

```text
Current frame
...
Call tree
...

No control-flow occurrence for this step.
```

Do not hide the entire Execution Story just because no loop is active.

Call-Frame Evidence now provides a valid outer story even for recursion without loops.

---

# 22. Decision Evidence Integration

Do not replicate complete condition trees in Call Tree.

A current-frame summary may show:

```text
Decisions: 3
```

Existing Control-Flow story may still include factual compact decision rows:

```text
node is None → False
```

Full operand/short-circuit information remains in Decision Evidence.

Recursive invocations of the same static function must remain separated by concrete `frameId`.

---

# 23. Expression Evidence Integration

Return values in Call-Frame Evidence are authoritative final values.

Expression Evidence explains supported computation.

For:

```python
return max(left, right) + 1
```

Call Tree:

```text
maxDepth(node=20) → 2
```

Expression Evidence:

```text
max(left, right) → 1
1 + 1 → 2
```

Call Tree must not rebuild that arithmetic explanation.

If no Expression Evidence exists, the return value remains valid Call-Frame Evidence.

---

# 24. Mutation Integration

Frame-level mutation count comes from `FrameEvidenceIndex.mutationAnchors`.

This includes object-level changes already attributed through `RuntimeMutationBatch.frameId`.

Example:

```text
reverse(node=3)
3 mutations
```

The UI must not claim:

```text
this call changed node.next
```

unless the underlying mutation evidence supports that exact fact.

Detailed mutation rows remain in What Changed.

---

# 25. Tree / Linked-List / Graph / Matrix Visual Integration

Call-Frame UI does not add algorithm-specific overlays.

When navigating a frame:

- raw cursor moves to its factual call step;
- existing Visual State updates naturally;
- Tree / Linked List / Graph / Matrix visualizers render whatever state exists at that step.

Future versions may add cross-highlighting between frame arguments and visual objects.

v0.1 does not require:

```text
highlight recursive subtree
draw call-to-tree-node edges
label left/right recursion semantically
animate backtracking paths
```

This keeps object visualization and execution hierarchy separate.

---

# 26. Trace Outline Integration

Trace Outline already groups loop occurrences.

v0.1 may add an optional top-level frame grouping:

```text
Function calls
▼ solve(...)
  ▼ dfs(0)
    dfs(1)
    dfs(2)
```

However, avoid rendering a second full call tree if Execution Story already contains one.

Recommended v0.1 policy:

- Execution Story owns the full Call Tree;
- Trace Outline may show only lightweight frame boundaries or no new frame grouping;
- do not duplicate the same hierarchy in both surfaces by default.

The implementation plan should prefer **one canonical call-tree surface**.

---

# 27. Existing Raw Call Stack

The existing raw Call Stack remains useful for current runtime state.

Difference:

```text
Call Stack  → currently active stack snapshot at this raw step
Call Tree   → all recorded user frame occurrences in the captured run
```

Do not remove Call Stack in v0.1.

Do not use Call Stack as the source of truth for historical call-tree reconstruction.

---

# 28. Exception UX

If a frame exits by exception:

```text
inner(x=0) ⚠ ZeroDivisionError
```

Parent propagated unwind:

```text
middle() ⚠ ZeroDivisionError
solve() ⚠ ZeroDivisionError
```

If a child exception was handled by the parent and the parent later returned normally:

```text
child() ⚠ ValueError
parent() → 7
```

This is factual and useful.

Do not add:

```text
error originated here
root cause
fix this call
bad input
```

unless another future evidence layer defines such semantics.

The first thrown/propagated frame is not automatically suspicious.

---

# 29. Trace End / Timeout UX

For timeout / trace limit:

```text
solve(...)
└─ recurse(928)
   └─ recurse(929)
      └─ recurse(930) … trace ended
```

A banner may state:

```text
Call-frame evidence ended · hard_timeout
```

or:

```text
Call-frame tracing truncated · call_frame_event_limit
```

Distinguish:

1. program/session termination;
2. call-frame evidence-channel truncation;
3. UI presentation folding.

Do not convert any of these into:

```text
infinite recursion
recursion limit bug
missing base case
```

---

# 30. Tracing State

When `CallFrameTracingState.status !== "complete"`, retain captured tree nodes.

Examples:

```text
Call-frame tracing truncated · call_frame_event_limit
Call-frame tracing unavailable · <reason>
```

Previously captured frame nodes remain navigable.

Do not clear the tree.

Do not synthesize later frames from raw function names to fill gaps.

---

# 31. Empty and Partial States

Required neutral states:

```text
No call-frame evidence for this step.
Call-frame evidence unavailable.
Call-frame evidence incomplete.
Frame outcome not captured.
Static function identity unavailable.
```

Examples:

- runtime frame exists but no static mapping:
  `helper(...)` is still valid;
- frame entered but capture ended:
  `trace ended`;
- Call-Frame channel truncated before current raw event:
  do not invent current frame occurrence.

Absence of a child frame in truncated evidence does not prove no child call occurred.

---

# 32. Panel Visibility and Default Expansion

Execution Story should render if either:

```text
callFrames.byFrameId.size > 0
OR
existing control-flow story has evidence
```

Call-frame section visibility:

- exactly one user frame, no child calls, no recursion:
  show compact Current Frame only; Call Tree may stay collapsed/hidden;
- multiple frame occurrences:
  show Call Tree;
- any `isRecursive === true`:
  show Call Tree and default it open;
- exception/trace-ended descendant:
  show Call Tree and make terminating path visible.

This keeps trivial one-function problems compact.

---

# 33. Call Tree vs Recursion Tree Naming

User-facing title should be:

```text
Call Tree
```

not always:

```text
Recursion Tree
```

Reason: the same structure also supports non-recursive helper calls.

When actual recursion is present, a small factual badge may say:

```text
Recursion observed
```

This prevents the UI from mislabeling ordinary helper hierarchies.

---

# 34. Frame Row Identity and DOM Semantics

Recommended attributes:

```text
data-frame-id
data-function-id
data-frame-depth
data-recursion-depth
data-frame-exit-status
data-call-step
data-exit-step
data-current-frame
data-current-path
```

Buttons must be keyboard accessible.

Tree structure should use semantic nested lists or `role="tree" / role="treeitem"` only if the implementation fully satisfies keyboard semantics.

Prefer semantic nested lists for v0.1 unless implementing complete ARIA tree behavior.

Do not rely on connector lines or color alone to communicate ancestry.

---

# 35. Accessibility

Required:

- current frame has textual and ARIA state;
- exception state has text, not only color/icon;
- collapsed subtree button exposes `aria-expanded`;
- navigation controls have descriptive labels including function and frame;
- recursive-depth badge is text-readable;
- deep indentation must not be the only ancestry cue;
- return / exception / trace-ended states need distinct text.

Example accessible label:

```text
Inspect frame 7, Solution.maxDepth, root equals TreeNode, returned 2, call step 18
```

---

# 36. Presentation Model Boundary

Do not put DOM-specific logic into `CallFrameModel`.

Create a focused core projection, conceptually:

```text
src/core/call-frame-story.ts
```

Responsibilities:

- map FunctionPlan descriptor metadata;
- calculate current path from existing FrameCursorContext;
- attach FrameEvidenceIndex counts;
- provide deterministic tree nodes in runtime order;
- expose current-step temporal status;
- expose navigable call/exit anchors;
- provide bounded presentation helpers where appropriate.

It must not:

- mutate `CallFrameModel`;
- infer missing parents;
- infer recursion;
- infer backtracking;
- classify bugs;
- calculate expected calls.

---

# 37. Suggested Component Structure

Recommended:

```text
src/core/call-frame-story.ts

src/sidepanel/components/CallFrameStory.ts
    CurrentFrameSummary
    CallPath
    CallTree
    CallTreeNode

src/sidepanel/components/ExecutionStory.ts
    existing control-flow story
    composed with optional CallFrameStory
```

Alternatively, `CallFrameStory.ts` may return one section consumed by `TraceVisualizer`.

Avoid turning `ExecutionStory.ts` into one very large file.

---

# 38. State Preservation

During raw-step navigation, preserve:

```text
user-expanded frame nodes
user-collapsed frame nodes
Execution Story panel open/collapsed state
```

When a new session replaces the old one:

```text
reset expansion state
auto-expand new current ancestry
```

Do not persist frame IDs across sessions.

Frame IDs are session-local runtime identities.

---

# 39. Current Frame Temporal Status

Core should derive a cursor-relative status.

Conceptually:

```ts
type FrameAtCursorStatus =
  | "not_started"
  | "active"
  | "exited";
```

Given frame:

```text
callStep
exit.step?
current raw step
```

Rules:

- currentStep < callStep -> not_started;
- callStep <= currentStep < exitStep -> active;
- currentStep >= exitStep -> exited;
- `trace_ended` without exit step requires conservative handling;
- never infer an exact exit moment if no authoritative step exists.

This status belongs to the presentation projection.

It does not replace `FrameOccurrence.exit`.

---

# 40. Call Tree Ordering

Children preserve factual runtime entry order from `childFrameIds`.

Roots preserve factual runtime order from `CallFrameModel.roots`.

Never reorder by:

```text
function name
argument value
return value
source line
recursive depth
tree-node identity
```

Even if another ordering looks visually cleaner.

---

# 41. Multiple Roots

A session may contain multiple root user frames due to unusual execution patterns or partial evidence.

Render a forest:

```text
Call Tree
├─ root frame A
└─ root frame B
```

Do not fabricate a synthetic Program root unless it is a UI-only non-navigable grouping label.

If used:

```text
Captured user calls
├─ ...
└─ ...
```

The synthetic grouping element must not receive a frameId.

---

# 42. Same-Name Functions

Same-name functions in different lexical parents remain distinct through static `functionId`.

Example:

```text
outer.visit(1)
other.visit(1)
```

Qualified labels should be used when the visible tree would otherwise be ambiguous.

Do not merge them because `functionName === "visit"`.

---

# 43. Methods and self

For:

```python
class Solution:
    def helper(self, node):
        ...
```

Visible row:

```text
helper(node=3)
```

not:

```text
helper(self=Solution#..., node=3)
```

unless the user explicitly expands arguments.

The underlying evidence still retains `self`.

This is a presentation simplification only.

---

# 44. Backtracking Boundary

This UI deliberately stops before semantic backtracking interpretation.

It may visibly show factual sequence:

```text
search(path=[1])
├─ search(path=[1,2]) → False
└─ search(path=[1,3]) → True
```

It must not add labels:

```text
choose 2
undo 2
backtrack
pruned
dead end
successful choice
```

A future Backtracking Evidence/UI phase can define those semantics if desired.

The Call Tree is already useful without them.

---

# 45. Failure-First Boundary

Failure-First remains unchanged.

Do not automatically choose:

```text
deepest recursive frame
last child call
largest recursive depth
exception origin frame
last returned frame
```

as Start Here.

Call Tree provides context around whatever raw cursor / Failure-First location is selected.

A later spec may define recursion-aware failure navigation separately.

---

# 46. Behavioral Evidence Boundary

Do not automatically create a behavioral warning from:

```text
deep recursion
repeated same functionId
large call tree
mutual recursion
```

Existing Behavioral Evidence owns repeated/no-progress semantics.

Call-Frame UI may show a factual recursion depth.

It must not call that depth excessive.

---

# 47. Source Code Integration

When current raw cursor belongs to a call frame, Code panel may optionally expose a compact badge:

```text
frame 7 · dfs · recursion depth 3
```

This is optional for v0.1.

Do not introduce function-span background coloring or call arrows yet.

Execution Story remains the canonical frame hierarchy surface.

---

# 48. Performance

Requirements:

- Call Tree should be derived in O(recorded frames) for a full model;
- current path lookup should be O(call depth), not O(all descendants);
- do not rebuild expensive evidence summaries from raw events on every DOM row;
- use `FrameEvidenceIndex` rather than rescanning Decision/Expression/Mutation layers per frame;
- preserve expansion state without recreating the entire panel when only current index changes where practical;
- large trees require bounded visible rendering.

No virtualized tree is required for v0.1 if bounded rendering keeps DOM size safe.

---

# 49. Core Testing Strategy

## 49.1 Story projection

Verify:

```text
qualified function label
arguments
call step
exit step
evidence counts
current frame
current path
root order
child order
```

## 49.2 Temporal status

Given one frame:

```text
before call → not_started
after call before exit → active
at/after exit → exited
```

For `trace_ended` without exitStep, preserve neutral semantics.

## 49.3 Direct recursion

```text
f(3)
└─ f(2)
   └─ f(1)
      └─ f(0)
```

Verify current-path ancestry and recursion depths.

## 49.4 Mutual recursion

```text
even
└─ odd
   └─ even
```

Verify factual cycle metadata is displayed without diagnosis.

## 49.5 Same-name lexical functions

Verify qualified labels disambiguate same-name functions.

## 49.6 Partial/truncated evidence

Verify captured nodes remain present and no missing descendants are synthesized.

---

# 50. Component Testing Strategy

## 50.1 Current Frame

Verify:

- compact arguments;
- `self` hidden by default;
- stack depth;
- recursive depth only when factual;
- returned / exception / trace-ended outcomes;
- current-step temporal status.

## 50.2 Call Path

Verify:

- root → current ordering;
- middle compaction;
- visible segments navigate to callStep;
- current node marked.

## 50.3 Call Tree

Verify:

- nested runtime structure;
- sibling order;
- repeated same function remains distinct;
- current ancestry auto-expanded;
- unrelated deep subtree collapsible;
- user expansion preserved across navigation;
- child count summary for collapsed nodes.

## 50.4 Navigation

Verify clicking:

```text
frame row → callStep
return suffix → exitStep
call-path segment → callStep
```

Navigation must use existing trace cursor.

## 50.5 Tracing state

Verify truncated / unavailable banners retain captured tree.

---

# 51. Integration Testing Strategy

Representative runtime sessions:

1. direct factorial-style recursion;
2. binary-tree max depth;
3. recursive helper with Decision Evidence;
4. recursive helper with loop occurrence;
5. mutual recursion;
6. repeated non-recursive sibling helper calls;
7. child exception handled by parent;
8. propagated exception through multiple frames;
9. trace limit in deep recursion;
10. hard-timeout streamed frame prefix;
11. call-frame evidence truncation while raw trace continues.

For each, verify both:

```text
core story projection
DOM navigation behavior
```

---

# 52. Regression Requirements

The implementation must preserve:

```text
existing Control-Flow Execution Story
Decision Evidence
Expression Evidence
What Changed
Locals
Visual State
Tree visualization
Linked-list visualization
Graph visualization
Matrix visualization
Behavioral Signals
Behavioral Timeline
Failure-First
Trace Outline
raw Previous / Next / Play
existing Call Stack
live editor execution
active-tab ownership
```

No existing evidence surface should change ownership because Call Tree exists.

---

# 53. Representative Acceptance Scenario A: Tree Recursion

Source:

```python
class Solution:
    def maxDepth(self, root):
        if root is None:
            return 0
        return max(self.maxDepth(root.left), self.maxDepth(root.right)) + 1
```

Required presentation shape:

```text
Call Tree

maxDepth(root=3)
├─ maxDepth(root=9)
│  ├─ maxDepth(root=None) → 0
│  └─ maxDepth(root=None) → 0
│  → 1
└─ maxDepth(root=20)
   ├─ maxDepth(root=15)
   │  ...
   └─ maxDepth(root=7)
      ...
   → 2
→ 3
```

When the cursor is inside `root=15`, its factual ancestry is highlighted.

No claim such as `left subtree`, `right subtree`, or `DFS` is required unless directly proven by source/evidence and intentionally surfaced by a future feature.

---

# 54. Representative Acceptance Scenario B: Non-Recursive Helpers

```python
def solve(x):
    a = helper(x)
    b = helper(x + 1)
    return a + b
```

Required:

```text
solve(x=3)
├─ helper(x=3) → ...
└─ helper(x=4) → ...
```

Neither helper call receives a recursion badge.

The Call Tree remains useful even though recursion is absent.

---

# 55. Representative Acceptance Scenario C: Exception

```python
def solve():
    return middle()

def middle():
    return inner()

def inner():
    raise ValueError("boom")
```

Required:

```text
solve() ⚠ ValueError
└─ middle() ⚠ ValueError
   └─ inner() ⚠ ValueError
```

The UI may display the exception type/message.

It must not automatically label `inner` as root cause.

---

# 56. Representative Acceptance Scenario D: Timeout Prefix

```text
solve()
└─ recurse(1)
   └─ recurse(2)
      └─ recurse(3)
         ...
         trace ends
```

Required:

- all recorded prefix nodes remain visible;
- affected incomplete frames show `trace ended`;
- Call-Frame tracing/session reason shown factually;
- no invented return values;
- no `infinite recursion` diagnosis.

---

# 57. Representative Acceptance Scenario E: Current-Step Temporal Status

Captured full run:

```text
f(2)
└─ f(1)
   └─ f(0) → 0
   → 1
→ 2
```

Cursor currently before `f(0)` returns.

Required current frame detail:

```text
Current frame: f(0)
At this step: active
Observed later in captured execution: returned 0
```

This temporal distinction is required even though the whole-run tree can display compact final return suffixes.

---

# 58. Definition of Done

Recursion / Call-Frame Execution Story UI v0.1 is complete when:

1. Execution Story can render from Call-Frame Evidence even with no loop evidence;
2. current frame is resolved from authoritative raw `frameId`;
3. Current Frame summary shows compact factual arguments;
4. stack depth and recursive depth remain distinct;
5. qualified function labels disambiguate supported same-name functions;
6. Call Path shows factual root-to-current ancestry;
7. Call Tree shows every rendered concrete FrameOccurrence separately;
8. root and child ordering preserve runtime order;
9. repeated sibling calls are not collapsed by function identity;
10. direct recursion receives factual recursive-depth presentation;
11. mutual recursion can expose factual cycle metadata;
12. frame rows show returned / exception / trace-ended outcomes without diagnosis;
13. current-step active/exited state is distinguished from session-final frame outcome;
14. clicking a frame navigates through the existing raw trace cursor;
15. current ancestry auto-expands and remains highlighted;
16. unrelated deep subtrees can be folded without modifying evidence;
17. large recorded trees use bounded presentation;
18. captured frames remain visible when Call-Frame tracing is truncated;
19. missing evidence is not reconstructed from names or source shape;
20. `FrameEvidenceIndex` powers compact decision/loop/expression/mutation summaries;
21. existing Control-Flow Execution Story remains available inside the selected frame context;
22. Decision / Expression / Mutation details remain owned by their existing panels;
23. existing raw Call Stack remains unchanged;
24. Failure-First behavior remains unchanged;
25. Behavioral Evidence does not treat recursion depth itself as anomalous;
26. no backtracking semantics are inferred;
27. no correctness/root-cause/fix language is introduced;
28. direct-recursion DOM tests pass;
29. tree-recursion integration tests pass;
30. exception and timeout-prefix tests pass;
31. full Vitest suite passes;
32. Python fixture suite passes;
33. `npm run typecheck` passes;
34. `npm run build` passes.

---

# 59. Resulting Product Model

After this UI milestone, the user can finally see the runtime hierarchy that already exists internally:

```text
Program Run
└─ Frame Occurrence
   ├─ Child Frame Occurrence
   │  └─ ...
   ├─ Loop Occurrence
   │  ├─ Decision
   │  └─ Transfer
   ├─ Expression Evidence
   ├─ Runtime Mutation
   └─ Behavioral Evidence
```

The important product transition is:

```text
before:
"the debugger captured calls"

after:
"the user can visually follow the concrete function-call hierarchy"
```

This is the first point where recursive execution becomes a first-class visual debugging experience rather than only raw call-stack information.

---

# 60. Next Phase After v0.1

Do not combine the following into this implementation:

```text
semantic backtracking labels
expected-vs-actual recursion comparison
cross-run call-tree diff
recursion-aware Failure-First heuristics
algorithm classification
memoization analysis
complexity analysis
```

Recommended next major feature after this UI is stable:

**Cross-Run Behavioral Diff**

because the new stable frame hierarchy provides a stronger alignment key for comparing:

```text
previous code vs current code
Case 1 vs Case 2
baseline run vs current run
```

A future diff can then describe factual divergence such as:

```text
same call prefix
→ first differing frame argument
→ first differing decision
→ first differing mutation
→ different frame exit
```

without turning the product into a solver.

# Implementation Status

Implemented:

- frame-aware Execution Story composition;
- Current Frame summary and cursor-relative temporal status;
- factual Call Path;
- runtime Call Tree with persistent expansion state;
- bounded large-tree presentation;
- call/exit navigation through the raw trace cursor;
- recursion / mutual-recursion factual metadata;
- frame evidence-count summaries;
- Control-Flow story composition inside the selected frame context;
- exception, timeout, and tracing-truncation presentation.

Deferred:

- semantic backtracking labels;
- expected-vs-actual recursion comparison;
- recursion-aware Failure-First;
- algorithm classification;
- cross-run call-tree diff.

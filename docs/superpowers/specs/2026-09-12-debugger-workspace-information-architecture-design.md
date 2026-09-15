# Debugger Workspace & Information Architecture

## Design Spec v0.1

---

# 1. Goal

LeetYourBrain2Code now has enough runtime capability that its main product risk is no longer missing visualization types. The current Side Panel exposes many useful concepts at once: failure summary, `Start Here`, Code, Visual State, What Changed, Behavioral Signals, Locals, Call Stack, Output, raw Debug Details, Trace Outline, Behavioral Timeline, and execution controls.

The next milestone is to turn those capabilities into a focused debugging workspace for ordinary LeetCode users.

The UI must optimize for one primary workflow:

```text
Execution looks wrong
        ↓
Where should I inspect?
        ↓
What line is executing?
        ↓
What does the runtime state look like?
        ↓
What changed / how was this value computed?
        ↓
Need more evidence?
```

Core product invariant:

> The primary debugger surface must prioritize source code, runtime visualization, and step-to-step change. Failure status and advanced evidence must guide inspection without competing for the main visual area.

This milestone changes presentation and interaction hierarchy. It does not change runtime tracing semantics, behavioral-analysis semantics, Failure-First ranking, expression instrumentation, or the authoritative raw execution cursor.

---

# 2. Product Principles

## 2.1 Source and runtime state are the product center

The two largest persistent regions in the main debugger view are:

1. current source context;
2. current runtime visualization.

They must receive more vertical and visual emphasis than execution-status messaging, raw metadata, or evidence tooling.

## 2.2 Failure status is a guide, not the workspace

`exception`, `trace_limit`, and `timeout` must remain clearly visible, but the failure UI must be compact.

The failure state must answer only:

```text
What happened to execution?
Where should I inspect first, if validated evidence exists?
```

It must not consume a large persistent card after the user begins inspecting the trace.

## 2.3 Progressive disclosure

The default view answers:

```text
Where am I?
What does the state look like?
What changed?
```

Detailed behavioral evidence, timeline structure, raw locals, call stack, stdout, exception metadata, and raw trace remain available, but they are secondary or advanced surfaces.

## 2.4 Internal architecture must not leak into product vocabulary

The product may internally contain components such as `BehavioralSignals`, `BehavioralTimeline`, `TraceOutline`, and `TraceFolding`.

The default user does not need to learn those subsystem names.

The public UI should organize them around user tasks:

```text
Debug
Evidence
Advanced
```

## 2.5 Evidence-only language remains mandatory

This redesign does not weaken the project's deterministic evidence principle.

The UI may say:

```text
Repeated observable state × 6
No observable progress across 5 revisits
Repeated 4-step behavior × 8
```

It must not infer:

```text
infinite loop
root cause
this caused the timeout
bug detected
wrong algorithm
```

---

# 3. Scope

v0.1 includes:

1. a new primary debugger information hierarchy;
2. compact execution status and compact `Start Here` treatment;
3. sticky step navigation near the top of the debugger workspace;
4. source code promoted from a generic collapsible panel to a primary workspace region;
5. `Visual State` renamed and promoted to `Runtime State`;
6. larger visualizer viewport for List, Dict, Linked List, Tree, Graph, Matrix / Grid, and future visualizers;
7. `What Changed` promoted directly below runtime state;
8. contextual behavioral clues merged into the primary change surface when relevant;
9. Expression Tracing evidence integrated into the change/computation surface rather than introduced as another permanent top-level panel;
10. an `Evidence` secondary view for behavioral patterns, timeline, and folded trace structure;
11. an `Advanced` secondary view for raw locals, call stack, stdout, exception details, and raw trace;
12. responsive behavior for narrow Chrome Side Panel widths;
13. keyboard-accessible execution navigation;
14. DOM/integration tests for hierarchy, visibility, synchronization, and progressive disclosure.

---

# 4. Explicit Non-Goals

v0.1 does not include:

- changing Failure-First ranking;
- automatic root-cause diagnosis;
- automatic cursor movement when `Start Here` renders;
- changing behavioral pattern detection;
- changing Trace Folding semantics;
- changing expression instrumentation semantics;
- LeetCode judge-result integration;
- expected-output versus actual-output comparison;
- AI-generated debugging explanations;
- new visualization kinds;
- Tree / Graph / Matrix algorithm-specific interpretation;
- full IDE source editing inside the Side Panel;
- resizable split panes in v0.1;
- detachable panels;
- persistent user layout customization;
- multi-trace comparison.

---

# 5. Selected Information Architecture

The Side Panel has three conceptual layers.

## 5.1 Primary layer — Debug Workspace

This is the default view and should occupy the overwhelming majority of interaction time.

Order:

```text
Compact execution header
Compact Start Here (only when eligible)
Sticky Step Navigation
Code
Runtime State
What Changed / Computation
```

The user should not need to open another section to answer the first-order debugging questions.

## 5.2 Secondary layer — Evidence

Contains supporting execution evidence:

```text
Behavioral evidence summary
Behavioral timeline
Trace outline / folded repeated regions
Exact evidence navigation
```

## 5.3 Tertiary layer — Advanced

Contains debugger internals and escape-hatch inspection:

```text
Locals
Call Stack
Output / stdout
Exception Details
Raw Trace Events
Runtime metadata
```

---

# 6. Target Primary Layout

Conceptual layout:

```text
┌──────────────────────────────────────┐
│ timeout · 143 captured steps         │  compact status
│ ↻ Start here: repeated behavior  × 8 │  optional compact recommendation
│                         [Inspect]     │
├──────────────────────────────────────┤
│ ◀   Step 117 / 143   ▶   Play        │  sticky navigation
│ ━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━  │
├──────────────────────────────────────┤
│ Code                                 │
│                                      │
│ 10 while left <= right:              │
│ 11     mid = (left + right) // 2     │
│ 12 ▶   if nums[mid] < target:        │
│ 13         left = mid                │
│                                      │
├──────────────────────────────────────┤
│ Runtime State                        │
│                                      │
│      [primary visualizer area]       │
│                                      │
│   left=3   mid=3   right=4           │
│                                      │
├──────────────────────────────────────┤
│ What Changed                         │
│ left   3 → 3                         │
│ mid    3 → 3                         │
│                                      │
│ ↻ No observable progress             │
│   repeated across 6 revisits         │
│                                      │
│ How this value was computed          │
│ ... expression evidence ...          │
└──────────────────────────────────────┘

[ Debug ] [ Evidence ] [ Advanced ]
```

`Debug` is selected by default.

---

# 7. Visual Priority and Space Budget

The redesign must encode relative importance rather than relying only on styling taste.

At a typical Side Panel viewport height of approximately 800–1000 CSS px:

## 7.1 Compact failure/status region

The combined execution status + `Start Here` region should normally consume no more than approximately 15–18% of the initial visible debugger height.

The execution-status line should generally remain one compact row.

The optional `Start Here` recommendation may use a second compact row or compact card, but must not visually dominate Code or Runtime State.

Avoid large red hero banners.

## 7.2 Code region

The source region should target at least 25% of the main Debug viewport before scrolling when enough source context exists.

The region should show the active line plus useful surrounding context without requiring immediate expansion.

## 7.3 Runtime State region

The Runtime State region should target at least 30–35% of the main Debug viewport when a visualizer exists.

For Tree, Graph, Matrix, and Linked List visualizers, this region should be allowed to become taller than Code when necessary.

No arbitrary fixed height should force complex structures into a cramped viewport.

## 7.4 What Changed / computation region

The primary mutation/computation region receives remaining visible space and may continue below the fold.

The redesign must prefer a larger Code + Runtime State viewport over showing all secondary metadata at once.

---

# 8. Compact Execution Header

Replace the current large summary treatment with a compact header.

Representative copies:

```text
completed · 81 captured steps
exception · 24 captured steps
trace limit · 256 captured steps
timeout · 143 captured steps
```

Requirements:

- status remains visually distinguishable;
- abnormal status may use warning/error color, but color is not the only indicator;
- the header does not use alert/live-region behavior;
- termination reason and captured-step count remain available;
- do not imply LeetCode Accepted or LeetCode TLE.

The heading `Trace` is optional and should not consume a separate large row if branding/context already makes the page purpose obvious.

---

# 9. Compact `Start Here`

Failure-First semantics remain unchanged.

When `failureFirstSelection` exists, render one compact recommendation directly under the execution header.

Example:

```text
↻ Start here · Repeated 4-step behavior × 8 · near termination    [Inspect]
```

A second line may contain a short factual evidence summary when width permits:

```text
Evidence: steps 112–139
```

Requirements:

- at most one recommendation;
- no auto-navigation;
- `Inspect` continues to route through `navigateDirect()`;
- no causal or diagnostic language;
- no large hero card;
- after `Inspect`, the recommendation remains available but must not expand automatically;
- the component may visually de-emphasize after the user navigates to the recommended step, but v0.1 does not require persistent visited state.

---

# 10. Sticky Step Navigation

Execution navigation becomes a first-class persistent control.

It appears immediately above Code and remains sticky within the Side Panel's debugger scroll container.

Controls:

```text
Previous
Current step / total steps
Next
Play / Pause
Scrubber
```

Representative compact form:

```text
◀    Step 117 / 143    ▶    ▶/Ⅱ
━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━
```

Requirements:

- `setStep()` remains the sole authoritative cursor update path;
- `navigateDirect()` continues to stop autoplay before jumping;
- scrubber selection maps directly to raw trace indexes;
- Previous/Next retain exact raw-step semantics;
- Play retains current raw-step playback semantics;
- navigation updates Code, Runtime State, mutations, expression evidence, Evidence view, and Advanced view from the same raw cursor;
- controls remain keyboard reachable;
- keyboard shortcuts may be added only if they do not interfere with LeetCode editor input focus.

Behavioral markers on the scrubber are optional for the first implementation slice, but the component architecture should permit them later.

---

# 11. Code Workspace

Code is no longer modeled as an ordinary generic `<details>` panel in the primary Debug view.

Requirements:

- visible by default;
- not collapsible in v0.1 primary Debug view;
- active source line receives a strong but readable indicator;
- current line number remains visible;
- source text is always original user source;
- code view scrolls active line into view only when necessary and must avoid aggressive scroll-jumping on every step;
- retain surrounding context around the active line;
- do not duplicate `Line N` as separate metadata if the active-line indicator already communicates it.

Recommended line markers:

```text
▶ current execution line
◆ current Failure-First inspection target, if distinct visual treatment is needed
✕ exception line, when known
↻ optional evidence marker
```

Markers must not imply diagnosis.

---

# 12. Runtime State

Rename the visible concept `Visual State` to `Runtime State`.

Internal type names such as `VisualState` do not need to change solely for UI naming.

Requirements:

- region visible by default;
- larger minimum visual area than current panel treatment;
- preserve stable visual ordering across steps;
- existing visualizer registry remains authoritative;
- visualizers continue to own structure-specific rendering;
- no duplicate source-line metadata inside Runtime State;
- when no specialized visual exists, show a compact fallback explaining that detailed variables are available under Advanced → Locals;
- do not automatically expand raw Locals into the primary workspace merely because no visualizer exists.

For multiple simultaneous visual candidates, preserve deterministic ordering and avoid vertical reshuffling across adjacent steps.

---

# 13. What Changed as the Primary Inspector

`What Changed` becomes the main textual explanation region below Runtime State.

It combines three factual evidence classes when available:

```text
Runtime mutations
Contextual behavioral clue
Expression computation evidence
```

## 13.1 Runtime mutations

Existing `RuntimeMutation[]` remains authoritative.

Examples:

```text
left    2 → 3
stack   append 7
node.next   A → B
matrix[2][3]   0 → 1
```

## 13.2 Contextual behavioral clue

Do not reproduce the entire `Behavioral Signals` panel inside Debug.

When the current raw step intersects resolved behavioral evidence, show a compact contextual clue beneath mutations.

Examples:

```text
↻ Repeated observable state × 6
↻ No observable progress across 5 revisits
↻ Repeated 4-step behavior × 8
```

Provide `View evidence` to switch/open the Evidence layer at the corresponding pattern.

If no pattern is relevant to the current step, render no placeholder.

## 13.3 Expression computation evidence

When Expression Tracing provides a completed or partial root for the current step, render it inside the same primary inspector under a label such as:

```text
How this value was computed
```

Do not add a permanent top-level `Expression Evidence` panel to the Debug layout.

The expression evidence tree remains factual and preserves all semantic constraints from Expression Tracing Foundation.

---

# 14. Evidence View

The Evidence view consolidates advanced behavioral-navigation surfaces.

Contents:

```text
Behavioral patterns / evidence list
Behavioral timeline
Trace outline / folded repeated transitions
Evidence navigation controls
```

The first version may reuse existing components internally.

Requirements:

- Evidence is not selected by default;
- switching to Evidence does not change the raw cursor;
- clicking evidence navigation continues to use `navigateDirect()`;
- current raw step remains reflected in timeline and trace outline;
- Trace Folding remains presentation-only and never replaces raw trace authority;
- component names need not be exposed as product section names.

Recommended product terminology:

```text
Execution Evidence
Patterns
Timeline
Trace Structure
```

---

# 15. Advanced View

The Advanced view contains information useful for deep debugging but not required in the main workflow.

Contents:

```text
Locals
Call Stack
Output / stdout
Exception details
Raw trace events
```

Requirements:

- Advanced is not selected by default;
- Locals remains synchronized to current raw step;
- Call Stack remains synchronized to current raw step;
- Output continues to combine current stdout and runtime exception state according to existing semantics;
- raw trace stays available as a debugging escape hatch;
- no raw JSON appears before Code / Runtime State in the default flow.

---

# 16. Tab / Mode Behavior

Recommended navigation:

```text
[ Debug ] [ Evidence ] [ Advanced ]
```

`Debug` is default on every new `TraceVisualizer` instance.

Changing mode:

- does not alter `currentIndex`;
- does not start or stop autoplay by itself;
- does not recompute interpretation;
- does not create an independent cursor;
- preserves current raw-step synchronization.

Failure-First `Inspect` always returns/focuses the user to the Debug view after navigating, because Code and Runtime State are the primary inspection destination.

---

# 17. Suggested Component Architecture

The current `TraceVisualizer.ts` owns too much presentation composition. The redesign should introduce layout-level components without moving execution semantics into them.

Suggested structure:

```text
TraceVisualizer
├── ExecutionHeader
│   └── CompactFailureFirstEntry
├── StepNavigator
├── DebugWorkspace
│   ├── CodeWorkspace
│   ├── RuntimeStateWorkspace
│   └── ChangeInspector
├── EvidenceWorkspace
│   ├── behavioral evidence list
│   ├── BehavioralTimeline
│   └── TraceOutline
└── AdvancedWorkspace
    ├── Locals
    ├── CallStack
    ├── Output
    └── RawTrace
```

Responsibilities:

## `TraceVisualizer`

Owns:

- interpretation creation;
- evidence-map creation;
- Failure-First selection;
- Trace Fold model;
- current raw index;
- autoplay timer;
- `setStep()`;
- `navigateDirect()`;
- synchronization across workspaces.

## Layout/workspace components

Own only DOM composition and presentation.

They must not:

- call Pyodide;
- modify trace events;
- rank Failure-First candidates;
- re-run behavioral analysis;
- create secondary cursors;
- infer correctness.

---

# 18. State Synchronization

The architectural invariant remains:

```text
one raw cursor
     ↓
setStep(currentIndex)
     ├── Code
     ├── Runtime State
     ├── Runtime Mutation
     ├── Expression Evidence
     ├── Behavioral Context
     ├── Evidence Timeline / Outline
     └── Advanced debugger data
```

No workspace owns an independent execution position.

Tab switches are presentation state only.

---

# 19. Responsive Side Panel Behavior

The extension primarily runs in Chrome Side Panel, so narrow-width behavior is first-class.

Requirements:

- design target begins around 360 CSS px width;
- no horizontal page-level scroll for ordinary Debug UI;
- code block may horizontally scroll internally when unavoidable;
- visualizers may own controlled internal pan/scroll according to their current contracts;
- header and Step Navigator must remain usable at narrow widths;
- `What Changed` rows may stack vertically;
- tabs must remain visible without requiring page-level horizontal scroll;
- large Runtime State diagrams should receive vertical space rather than being scaled to illegibility.

At wider widths, the design may place small scalar variable summaries beside a structure visualizer, but v0.1 must not require a two-column layout.

---

# 20. Accessibility

- all navigation controls use native buttons / inputs where appropriate;
- tab controls expose correct selected state and keyboard behavior;
- code current-line meaning is not communicated by color alone;
- abnormal execution status is textually explicit;
- `Start Here` remains a normal button-driven navigation action, not automatic focus movement;
- Runtime State visualizers retain their existing accessibility contracts;
- reduced-motion preference should disable unnecessary animated transitions;
- sticky controls must not obscure focused elements when navigating with keyboard.

---

# 21. Testing Strategy

## 21.1 Layout hierarchy tests

Extend Side Panel DOM tests to verify default order:

```text
Execution Header
Start Here (when eligible)
Step Navigator
Code
Runtime State
What Changed
```

Verify Evidence and Advanced content are not part of the default primary visual flow.

## 21.2 Failure status tests

Verify:

- completed execution renders compact status;
- timeout / trace_limit / exception render compact abnormal status;
- eligible Failure-First selection renders compact `Start Here`;
- no eligible selection renders no placeholder;
- forbidden diagnostic wording remains absent;
- `Inspect` navigates without changing selection semantics.

## 21.3 Cursor synchronization tests

For Previous, Next, scrubber, Play, Failure-First Inspect, behavioral evidence navigation, and Trace Outline navigation, verify the same raw index synchronizes:

```text
code active line
runtime visual state
mutation list
expression evidence
behavioral contextual clue
locals
call stack
output
timeline
outline
```

## 21.4 Mode tests

Verify:

- Debug is default;
- switching Debug / Evidence / Advanced does not modify raw cursor;
- switching tabs does not start/stop playback;
- Failure-First Inspect returns to Debug and navigates exact raw index;
- Evidence navigation may navigate raw index while preserving single-cursor semantics.

## 21.5 Responsive tests

At representative widths, including approximately 360 px and 480 px:

- no page-level horizontal overflow;
- Step Navigator remains usable;
- tab navigation remains usable;
- Code remains readable / internally scrollable;
- Runtime State receives a usable viewport;
- What Changed does not force clipped content.

## 21.6 Regression gates

Existing visualizer and behavioral tests must continue to pass.

Full repository gates:

```bash
npm test
npm run typecheck
npm run build
```

---

# 22. Migration Strategy

The redesign should be implemented in presentation slices rather than rewriting tracing logic.

Recommended migration order:

```text
1. Introduce workspace shell + Debug/Evidence/Advanced mode state
2. Move execution controls into sticky Step Navigator
3. Replace large summary with compact Execution Header / Start Here
4. Promote Code into CodeWorkspace
5. Promote Visual State into RuntimeStateWorkspace
6. Consolidate What Changed + contextual behavioral clue
7. Integrate Expression Tracing evidence into ChangeInspector when available
8. Move Behavioral Signals / Timeline / Trace Outline under Evidence
9. Move Locals / Call Stack / Output / Raw Trace under Advanced
10. Responsive/accessibility polish + regression coverage
```

At every slice, `setStep()` remains authoritative.

---

# 23. Acceptance Criteria

The milestone is complete when all of the following are true:

1. the default debugger surface prioritizes Code and Runtime State over failure/status messaging;
2. abnormal execution status remains visible but compact;
3. eligible Failure-First evidence renders one compact `Start Here` action and does not auto-navigate;
4. Step Navigation is positioned directly above Code and remains accessible while inspecting the main workspace;
5. Code is visible by default and is not treated as an ordinary collapsible inspector panel;
6. Runtime State is visible by default and receives a substantially larger viewport than before;
7. `Visual State` product copy is replaced with `Runtime State` without requiring internal model renaming;
8. `What Changed` is the primary textual inspector;
9. behavioral evidence relevant to the current step can appear contextually inside the primary inspector without exposing the full Behavioral Signals panel;
10. Expression Tracing evidence appears as `How this value was computed` inside the primary inspector rather than as another permanent top-level panel;
11. behavioral timeline, trace outline/folding, and full pattern evidence are reachable from Evidence and are not required reading in the default flow;
12. Locals, Call Stack, Output, exception details, and raw trace are reachable from Advanced and do not precede the primary debugger workspace;
13. Debug / Evidence / Advanced use one shared raw cursor;
14. all direct navigation paths continue to route through existing cursor ownership (`navigateDirect()` / `setStep()`);
15. presentation restructuring does not change behavioral-analysis semantics, Failure-First ranking, Trace Folding semantics, runtime mutation semantics, or expression semantics;
16. narrow Side Panel layouts remain usable without page-level horizontal overflow;
17. no new diagnostic, causal, correctness, or LeetCode judge claims are introduced;
18. focused tests and full `npm test`, `npm run typecheck`, and `npm run build` gates pass.

---

# 24. Product Success Criterion

The redesign succeeds when a first-time user can inspect a failing or confusing execution without understanding LeetYourBrain2Code's internal trace architecture.

The intended cognitive path is:

```text
Failure / confusing behavior
        ↓
Inspection point
        ↓
Current source line
        ↓
Runtime structure
        ↓
Change / computation
        ↓
Optional deeper evidence
```

The user should not need to decide between `Behavioral Signals`, `Trace Outline`, `Behavioral Timeline`, `Locals`, and raw events before seeing what the program actually did.

That reduction in **time-to-useful-insight** is the primary product metric for this phase.

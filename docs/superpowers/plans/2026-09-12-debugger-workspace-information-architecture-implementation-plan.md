# Debugger Workspace & Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current vertically stacked trace-inspector UI with a focused Debug / Evidence / Advanced workspace that keeps Code and Runtime State visually dominant, makes step navigation persistent, compresses failure messaging, and preserves one authoritative raw execution cursor.

**Architecture:** `TraceVisualizer` remains the orchestration boundary for interpretation, Failure-First selection, `currentIndex`, autoplay, `navigateDirect()`, and `setStep()`. Presentation is split into focused components: compact execution header, sticky step navigator, Code workspace, Runtime State workspace, Change Inspector, Evidence workspace, Advanced workspace, and a tab shell. Existing behavioral analysis, Failure-First ranking, trace folding, runtime mutations, visualizer registry, and expression evidence remain authoritative data sources and are only reorganized for presentation.

**Tech Stack:** TypeScript 5.8, Vitest 3.2, JSDOM, Chrome MV3 Side Panel, existing DOM/CSS component architecture.

**Spec:** `docs/superpowers/specs/2026-09-12-debugger-workspace-information-architecture-design.md`

**Execution prerequisite:** Complete `docs/superpowers/plans/2026-09-12-expression-tracing-foundation-implementation-plan.md` first. This plan assumes trace schema v3 exists, `TraceInterpretation.expressionEvidence` is available, and `src/sidepanel/components/ExpressionEvidence.ts` exports `createExpressionEvidence(evidence, tracingState)`.

## Global Constraints

- Preserve the project rule: **visualize what the program actually did**.
- Do not change behavioral-analysis semantics, Failure-First ranking, Trace Folding semantics, runtime mutation semantics, expression semantics, or visualizer interpretation semantics.
- `setStep()` remains the sole authoritative raw-cursor update path.
- `navigateDirect(index)` continues to stop autoplay before calling `setStep(index)`.
- Debug is the default workspace mode for every new `TraceVisualizer` instance.
- Switching Debug / Evidence / Advanced must not change the raw cursor or autoplay state.
- Failure-First remains at most one deterministic evidence-backed recommendation and must not auto-navigate.
- Failure-First `Inspect` must navigate to the exact existing `selection.inspectIndex` and return the visible workspace to Debug.
- Product copy must not say `root cause`, `bug location`, `likely cause`, `failure source`, `problem detected`, `infinite loop`, `caused timeout`, `caused failure`, `wrong algorithm`, or imply LeetCode Accepted/TLE.
- The visible concept `Visual State` becomes **Runtime State**; internal `VisualState` type names do not need renaming.
- The default Debug surface order is: compact execution header → compact Start Here when eligible → sticky Step Navigator → Code → Runtime State → What Changed / computation.
- Behavioral Timeline, Trace Outline / folds, and full pattern evidence live under Evidence.
- Locals, Call Stack, stdout/output, exception details, and raw trace live under Advanced.
- Side Panel design target begins at 360 CSS px width; ordinary workspace UI must not require page-level horizontal scrolling.
- Avoid large red failure hero banners. Code and Runtime State must receive more visual space than execution-status messaging.
- Full regression gates remain `npm test`, `npm run typecheck`, and `npm run build`.

---

## File Structure

Create focused units rather than expanding `TraceVisualizer.ts` further:

```text
src/sidepanel/components/WorkspaceTabs.ts
    Debug / Evidence / Advanced tab semantics and presentation-only mode state.

src/sidepanel/components/ExecutionHeader.ts
    Compact session status line and host for the compact Failure-First entry.

src/sidepanel/components/StepNavigator.ts
    Previous / Next / Play / Pause / raw-index scrubber presentation.

src/sidepanel/components/CodeWorkspace.ts
    Persistent original-source view, current-line marker, exception marker,
    and nearest-only active-line scrolling.

src/sidepanel/components/RuntimeStateWorkspace.ts
    Persistent larger host for existing specialized visualizers.

src/sidepanel/contextual-behavioral-evidence.ts
    Pure current-index -> relevant resolved behavioral-evidence selection.

src/sidepanel/components/ChangeInspector.ts
    Runtime mutations + contextual behavioral clues + expression computation.

src/sidepanel/components/EvidenceWorkspace.ts
    Full behavioral signals, BehavioralTimeline, and TraceOutline composition.

src/sidepanel/components/AdvancedWorkspace.ts
    Locals, Call Stack, Output / exception details, and raw trace composition.
```

Modify existing seams only where needed:

```text
src/sidepanel/components/TraceVisualizer.ts
src/sidepanel/components/FailureFirstEntry.ts
src/sidepanel/components/BehavioralSignals.ts
src/sidepanel/styles.css

tests/sidepanel/trace-visualizer.test.ts
tests/sidepanel/failure-first-entry.test.ts
tests/sidepanel/behavioral-signals.test.ts
```

Add focused tests:

```text
tests/sidepanel/workspace-tabs.test.ts
tests/sidepanel/step-navigator.test.ts
tests/sidepanel/code-workspace.test.ts
tests/sidepanel/runtime-state-workspace.test.ts
tests/sidepanel/contextual-behavioral-evidence.test.ts
tests/sidepanel/change-inspector.test.ts
tests/sidepanel/evidence-workspace.test.ts
tests/sidepanel/advanced-workspace.test.ts
```

---

### Task 1: Add the Debug / Evidence / Advanced Workspace Shell

**Files:**
- Create: `src/sidepanel/components/WorkspaceTabs.ts`
- Create: `tests/sidepanel/workspace-tabs.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**

```ts
export type TraceWorkspaceMode = "debug" | "evidence" | "advanced";

export interface WorkspaceTabsHandle {
  element: HTMLDivElement;
  panels: Record<TraceWorkspaceMode, HTMLDivElement>;
  getMode(): TraceWorkspaceMode;
  setMode(mode: TraceWorkspaceMode, focusTab?: boolean): void;
}

export function createWorkspaceTabs(
  onModeChange?: (mode: TraceWorkspaceMode) => void
): WorkspaceTabsHandle;
```

`setMode()` changes presentation only. It never owns or receives `currentIndex`.

- [ ] **Step 1: Write failing tab-semantic tests**

Create `tests/sidepanel/workspace-tabs.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceTabs } from "../../src/sidepanel/components/WorkspaceTabs";

describe("WorkspaceTabs", () => {
  it("starts in Debug and exposes accessible tabs", () => {
    const handle = createWorkspaceTabs();
    const tabs = [...handle.element.querySelectorAll<HTMLButtonElement>("[role=tab]")];

    expect(handle.getMode()).toBe("debug");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Debug", "Evidence", "Advanced"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(handle.panels.debug.hidden).toBe(false);
    expect(handle.panels.evidence.hidden).toBe(true);
    expect(handle.panels.advanced.hidden).toBe(true);
  });

  it("switches presentation without inventing execution state", () => {
    const changed = vi.fn();
    const handle = createWorkspaceTabs(changed);
    const evidence = handle.element.querySelector<HTMLButtonElement>("[data-workspace-mode=evidence]")!;

    evidence.click();

    expect(handle.getMode()).toBe("evidence");
    expect(changed).toHaveBeenCalledWith("evidence");
    expect(handle.panels.evidence.hidden).toBe(false);
    expect(handle.panels.debug.hidden).toBe(true);
  });
});
```

Run:

```bash
npm test -- tests/sidepanel/workspace-tabs.test.ts
```

Expected: FAIL because `WorkspaceTabs.ts` does not exist.

- [ ] **Step 2: Implement accessible tab state**

Implement three native buttons inside a `role="tablist"` container. Each button gets:

```ts
button.type = "button";
button.role = "tab";
button.dataset.workspaceMode = mode;
button.setAttribute("aria-controls", panel.id);
```

Each corresponding panel gets:

```ts
panel.role = "tabpanel";
panel.id = `trace-workspace-${mode}`;
panel.hidden = mode !== "debug";
```

`setMode()` must update `aria-selected`, `tabIndex`, and `hidden`; `focusTab === true` focuses the selected tab.

- [ ] **Step 3: Integrate the shell without moving existing content yet**

In `TraceVisualizer.ts`, create the workspace shell and append all current trace content to `workspace.panels.debug` temporarily. Keep current DOM ordering otherwise unchanged for this task.

The root becomes conceptually:

```ts
const workspace = createWorkspaceTabs();
root.append(summary);
if (failureFirstEntry) root.append(failureFirstEntry);
root.append(workspace.element);
workspace.panels.debug.append(/* existing trace content */);
```

Do not move Behavioral Timeline / Trace Outline / Advanced content to their final tabs yet; that occurs in later tasks.

- [ ] **Step 4: Add shell styling**

Add CSS classes:

```css
.trace-workspace__tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  border-bottom: 1px solid #dfe5ee;
}

.trace-workspace__tab {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 9px 6px;
}

.trace-workspace__tab[aria-selected="true"] {
  border-bottom: 2px solid #1d67ed;
  color: #1d4ed8;
}

.trace-workspace__panel[hidden] {
  display: none;
}
```

- [ ] **Step 5: Verify shell behavior and existing trace tests**

```bash
npm test -- tests/sidepanel/workspace-tabs.test.ts tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/components/WorkspaceTabs.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/workspace-tabs.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "refactor: add debugger workspace shell"
```

---

### Task 2: Promote Raw Step Navigation into a Sticky Step Navigator

**Files:**
- Create: `src/sidepanel/components/StepNavigator.ts`
- Create: `tests/sidepanel/step-navigator.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**

```ts
export interface StepNavigatorState {
  currentIndex: number;
  totalSteps: number;
  playing: boolean;
}

export interface StepNavigatorHandle {
  element: HTMLElement;
  setState(state: StepNavigatorState): void;
}

export interface StepNavigatorOptions {
  onPrevious(): void;
  onNext(): void;
  onTogglePlay(): void;
  onScrub(index: number): void;
}

export function createStepNavigator(
  options: StepNavigatorOptions
): StepNavigatorHandle;
```

- [ ] **Step 1: Write failing navigator tests**

Create tests covering raw-index scrub semantics and empty/single-step state:

```ts
it("emits the selected raw index from the scrubber", () => {
  const onScrub = vi.fn();
  const handle = createStepNavigator({
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onTogglePlay: vi.fn(),
    onScrub
  });
  handle.setState({ currentIndex: 1, totalSteps: 5, playing: false });

  const range = handle.element.querySelector<HTMLInputElement>("input[type=range]")!;
  range.value = "3";
  range.dispatchEvent(new Event("input"));

  expect(onScrub).toHaveBeenCalledWith(3);
});

it("disables navigation when there are no captured steps", () => {
  const handle = createStepNavigator({
    onPrevious: vi.fn(), onNext: vi.fn(), onTogglePlay: vi.fn(), onScrub: vi.fn()
  });
  handle.setState({ currentIndex: 0, totalSteps: 0, playing: false });
  expect(handle.element.querySelectorAll("button:disabled").length).toBe(3);
});
```

Run:

```bash
npm test -- tests/sidepanel/step-navigator.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the navigator**

Use native buttons and `<input type="range">`.

State rules:

```ts
previous.disabled = totalSteps === 0 || currentIndex <= 0;
next.disabled = totalSteps === 0 || currentIndex >= totalSteps - 1;
play.disabled = totalSteps < 2;
range.disabled = totalSteps < 2;
range.min = "0";
range.max = String(Math.max(totalSteps - 1, 0));
range.value = String(Math.max(0, Math.min(currentIndex, totalSteps - 1)));
label.textContent = totalSteps === 0
  ? "No steps"
  : `Step ${currentIndex + 1} / ${totalSteps}`;
play.textContent = playing ? "Ⅱ Pause" : "▶ Play";
```

Do not implement behavioral markers in v0.1.

- [ ] **Step 3: Replace old inline controls in `TraceVisualizer`**

Remove the old `previous`, `next`, `play`, `controls`, `stepInfo`, and their direct DOM construction.

Create the navigator after `navigateDirect` can be assigned:

```ts
const stepNavigator = createStepNavigator({
  onPrevious: () => setStep(currentIndex - 1),
  onNext: () => setStep(currentIndex + 1),
  onTogglePlay: togglePlaying,
  onScrub: (index) => navigateDirect(index)
});
```

Extract current Play button listener logic into `togglePlaying()` without changing playback interval or reset behavior.

Every `setStep()` path calls:

```ts
stepNavigator.setState({
  currentIndex,
  totalSteps: interpretation.visualStates.length,
  playing: timer !== null
});
```

`stopPlaying()` also updates navigator state after clearing the timer.

- [ ] **Step 4: Place navigation above Code and make it sticky**

Append it at the beginning of Debug content before Code.

CSS:

```css
.trace-step-nav {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  gap: 7px;
  border: 1px solid #dfe5ee;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.96);
  padding: 9px 10px;
  backdrop-filter: blur(8px);
}

.trace-step-nav__controls {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
}

.trace-step-nav__range {
  width: 100%;
}
```

- [ ] **Step 5: Verify exact cursor and autoplay semantics**

Extend `trace-visualizer.test.ts` to assert:

```text
scrubber -> navigateDirect -> exact raw index
Previous/Next -> exact adjacent raw index
Play still advances raw states
scrub while playing stops autoplay
```

Run:

```bash
npm test -- tests/sidepanel/step-navigator.test.ts tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/components/StepNavigator.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/step-navigator.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: add sticky trace step navigator"
```

---

### Task 3: Compress Execution Status and Failure-First into a Small Header Region

**Files:**
- Create: `src/sidepanel/components/ExecutionHeader.ts`
- Modify: `src/sidepanel/components/FailureFirstEntry.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/failure-first-entry.test.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**

```ts
export interface ExecutionHeaderOptions {
  session: TraceSession;
  failureFirstEntry?: HTMLElement | null;
}

export function createExecutionHeader(
  options: ExecutionHeaderOptions
): HTMLDivElement;
```

Keep `createFailureFirstEntry({ selection, onNavigate })` signature unchanged.

- [ ] **Step 1: Rewrite Failure-First presentation tests before implementation**

Update `failure-first-entry.test.ts` to assert compact factual content:

```ts
expect(entry.textContent).toContain("Start here");
expect(entry.textContent).toContain("Repeated 4-step behavior");
expect(entry.textContent).toContain("Evidence: Steps");
expect(entry.textContent).not.toContain("root cause");
expect(entry.textContent).not.toContain("caused timeout");
```

Preserve the existing exact `Inspect` callback assertion.

Add `trace-visualizer.test.ts` assertion that `.trace-execution-header` occurs before `.trace-step-nav` and contains no `<h2>Trace</h2>` hero block.

Run:

```bash
npm test -- tests/sidepanel/failure-first-entry.test.ts tests/sidepanel/trace-visualizer.test.ts
```

Expected: FAIL against the current large summary/card structure.

- [ ] **Step 2: Implement compact `ExecutionHeader`**

Render one status row:

```text
{status label} · {event count} captured steps
```

Use humanized `trace_limit -> trace limit`; retain `session.terminationReason` in a secondary `title` attribute or compact metadata span rather than a large separate block.

Set:

```ts
root.dataset.executionStatus = session.status;
```

Do not use `role="alert"` or live-region attributes.

- [ ] **Step 3: Compress `FailureFirstEntry` markup**

Keep the factual title function and exact evidence range. Replace the five vertically stacked elements with a compact row + optional detail line:

```text
↻ Start here · {pattern title} · within {distance} captured steps of termination   [Inspect]
Evidence: Steps X–Y
```

Use `Start here` capitalization in visible copy; retain exact accessible button destination.

- [ ] **Step 4: Integrate the header and preserve navigation contract**

In `TraceVisualizer.ts`:

```ts
const failureFirstEntry = failureFirstSelection
  ? createFailureFirstEntry({
      selection: failureFirstSelection,
      onNavigate: (index) => {
        workspace.setMode("debug");
        navigateDirect(index);
      }
    })
  : null;

const executionHeader = createExecutionHeader({ session, failureFirstEntry });
root.append(executionHeader, workspace.element);
```

This is the first task where Failure-First `Inspect` explicitly restores Debug mode.

- [ ] **Step 5: Replace hero styling with compact styling**

Delete obsolete `.trace-viewer__summary*` hero rules after no references remain.

Add compact CSS with no large filled red block:

```css
.trace-execution-header {
  display: grid;
  gap: 5px;
  border: 1px solid #dfe5ee;
  border-radius: 9px;
  background: #fff;
  padding: 7px 9px;
}

.trace-execution-header__status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  color: #475569;
  font-size: 11px;
  font-weight: 700;
}

.trace-execution-header[data-execution-status="timeout"] .trace-execution-header__status,
.trace-execution-header[data-execution-status="trace_limit"] .trace-execution-header__status,
.trace-execution-header[data-execution-status="exception"] .trace-execution-header__status {
  color: #b45309;
}
```

- [ ] **Step 6: Verify compact status and exact Failure-First behavior**

```bash
npm test -- tests/sidepanel/failure-first-entry.test.ts tests/sidepanel/failure-first-selection.test.ts tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS; selector tests must be untouched semantically.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/components/ExecutionHeader.ts src/sidepanel/components/FailureFirstEntry.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/failure-first-entry.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "refactor: compact execution failure header"
```

---

### Task 4: Extract Code into a Persistent Primary Workspace

**Files:**
- Create: `src/sidepanel/components/CodeWorkspace.ts`
- Create: `tests/sidepanel/code-workspace.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**

```ts
export interface CodeWorkspaceHandle {
  element: HTMLElement;
  setCurrentLine(line: number | null): void;
}

export interface CodeWorkspaceOptions {
  sourceCode: string;
  exceptionLine?: number | null;
}

export function createCodeWorkspace(
  options: CodeWorkspaceOptions
): CodeWorkspaceHandle;
```

- [ ] **Step 1: Write failing source-workspace tests**

Test that the component is not `<details>`, renders original source, marks exactly one active line, and marks a known exception line without replacing active-line semantics.

```ts
const handle = createCodeWorkspace({
  sourceCode: "x = 1\ny = x + 1\nreturn y",
  exceptionLine: 2
});
handle.setCurrentLine(2);

expect(handle.element.tagName).not.toBe("DETAILS");
expect(handle.element.querySelectorAll(".is-active")).toHaveLength(1);
expect(handle.element.querySelector("[data-line='2']")?.classList.contains("is-exception-line")).toBe(true);
```

Add a scroll test by stubbing `getBoundingClientRect()` and `scrollIntoView()` so scrolling occurs only when the active line falls outside the code viewport.

Run:

```bash
npm test -- tests/sidepanel/code-workspace.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Move code rendering from `TraceVisualizer.ts`**

Move current original-source line construction into `CodeWorkspace.ts`.

Use a fixed primary structure:

```text
<section class="trace-code-workspace">
  <header>Code <span>Python</span></header>
  <pre class="trace-viewer__code">...</pre>
</section>
```

Each line keeps `data-line` and line number text.

Active line:

```ts
line.classList.toggle("is-active", lineNumber === currentLine);
line.toggleAttribute("aria-current", lineNumber === currentLine);
```

Exception line:

```ts
line.classList.toggle("is-exception-line", lineNumber === options.exceptionLine);
```

- [ ] **Step 3: Implement nearest-only source scrolling**

Track the prior active line. On a changed current line:

1. inspect code viewport rectangle;
2. inspect active line rectangle;
3. call `scrollIntoView({ block: "nearest" })` only when the line top is above viewport top or line bottom is below viewport bottom.

Do not scroll when the active line is already visible.

- [ ] **Step 4: Integrate into `setStep()`**

Create once:

```ts
const codeWorkspace = createCodeWorkspace({
  sourceCode: session.sourceCode,
  exceptionLine: session.exception?.line ?? null
});
```

In `setStep()`:

```ts
codeWorkspace.setCurrentLine(state?.currentLine ?? null);
```

Delete `renderCodePanel`, `codePanel.lines`, and `codePanel.lineLabel` from `TraceVisualizer.ts`.

- [ ] **Step 5: Give Code primary visual space**

Add CSS:

```css
.trace-code-workspace {
  min-height: 190px;
  border: 1px solid #dfe5ee;
  border-radius: 10px;
  background: #fff;
  padding: 10px;
}

.trace-code-workspace .trace-viewer__code {
  max-height: min(34vh, 320px);
  min-height: 150px;
}
```

At 800–1000 px viewport heights, this is consistent with the spec's approximate 25% Code target without introducing brittle JS viewport calculations.

Add a visible marker pseudo-element or marker column for the active line so meaning is not color-only.

- [ ] **Step 6: Verify integration**

```bash
npm test -- tests/sidepanel/code-workspace.test.ts tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/components/CodeWorkspace.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/code-workspace.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "refactor: promote code to primary debugger workspace"
```

---

### Task 5: Extract and Enlarge Runtime State without Changing Visualizer Semantics

**Files:**
- Create: `src/sidepanel/components/RuntimeStateWorkspace.ts`
- Create: `tests/sidepanel/runtime-state-workspace.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**

```ts
export interface RuntimeStateWorkspaceHandle {
  element: HTMLElement;
  setState(state: VisualState | undefined): void;
  dispose(): void;
}

export function createRuntimeStateWorkspace(): RuntimeStateWorkspaceHandle;
```

- [ ] **Step 1: Write failing Runtime State tests**

Port the existing visualizer-host expectations into a focused test:

```ts
const handle = createRuntimeStateWorkspace();
expect(handle.element.textContent).toContain("Runtime State");

handle.setState(undefined);
expect(handle.element.textContent).toContain("No execution steps were captured.");
```

For a `VisualState` with no visual candidates, assert exact fallback:

```text
No specialized runtime visualization for this step. Detailed variables are available in Advanced → Locals.
```

For consecutive states with the same `visualId`, assert the same visual DOM handle is updated rather than replaced.

Run:

```bash
npm test -- tests/sidepanel/runtime-state-workspace.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Move `createVisualStateRenderer()` out of `TraceVisualizer.ts`**

Preserve the current stable `visualOrder`, handle reuse, `createVisualizer`, `updateVisualizer`, and disposal behavior exactly.

Remove only the old `stateMeta` / `Line N` text. Source position is now owned by Code.

- [ ] **Step 3: Use Runtime State product naming**

Visible heading must be exactly:

```text
Runtime State
```

Do not rename `VisualState`, `visuals`, `visualId`, or visualizer-registry internals.

- [ ] **Step 4: Integrate into `TraceVisualizer`**

Replace old `visualPanel` and `visualStateRenderer` with one `runtimeStateWorkspace` handle.

`setStep()` uses:

```ts
runtimeStateWorkspace.setState(state);
```

`dispose()` uses:

```ts
runtimeStateWorkspace.dispose();
```

- [ ] **Step 5: Increase the visualizer viewport**

CSS:

```css
.trace-runtime-workspace {
  min-height: 240px;
  border: 1px solid #dfe5ee;
  border-radius: 10px;
  background: #fff;
  padding: 10px;
}

.trace-runtime-workspace__visuals {
  display: grid;
  min-height: 200px;
  align-content: start;
  gap: 10px;
}
```

Do not impose a hard max-height on Tree / Graph / Matrix / Linked List content. Their existing internal viewport/pan/scroll behavior remains authoritative.

- [ ] **Step 6: Run all visualizer regression tests**

```bash
npm test -- \
  tests/sidepanel/runtime-state-workspace.test.ts \
  tests/sidepanel/trace-visualizer.test.ts \
  tests/sidepanel/list-visualizer.test.ts \
  tests/sidepanel/linked-list-visualizer.test.ts \
  tests/sidepanel/tree-visualizer.test.ts \
  tests/sidepanel/graph-visualizer.test.ts \
  tests/sidepanel/matrix-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/components/RuntimeStateWorkspace.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/runtime-state-workspace.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "refactor: promote runtime state workspace"
```

---

### Task 6: Consolidate What Changed, Contextual Behavioral Evidence, and Expression Computation

**Files:**
- Create: `src/sidepanel/contextual-behavioral-evidence.ts`
- Create: `src/sidepanel/components/ChangeInspector.ts`
- Create: `tests/sidepanel/contextual-behavioral-evidence.test.ts`
- Create: `tests/sidepanel/change-inspector.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**

```ts
export interface ContextualBehavioralEvidence {
  pattern: BehavioralPattern;
  evidence: ResolvedBehavioralEvidence;
}

export function resolveContextualBehavioralEvidence(
  patterns: readonly BehavioralPattern[],
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>,
  currentIndex: number
): ContextualBehavioralEvidence[];
```

The result includes only patterns whose resolved `evidenceIndexes` contain `currentIndex`, sorted lexicographically by `patternId`. This ordering is deterministic but intentionally does **not** express severity.

```ts
export interface ChangeInspectorHandle {
  element: HTMLElement;
  setStep(input: {
    mutations: RuntimeMutation[];
    behavioralEvidence: ContextualBehavioralEvidence[];
    expressionEvidence: ExpressionStepEvidence | undefined;
    expressionTracing: ExpressionTracingState | undefined;
  }): void;
}

export function createChangeInspector(options: {
  onViewEvidence(patternId: string): void;
}): ChangeInspectorHandle;
```

- [ ] **Step 1: Write failing pure contextual-evidence tests**

Cases:

```text
pattern evidence does not include current raw index -> absent
resolved evidence includes current raw index -> present
missing evidence-map entry -> absent
multiple matches -> sorted by patternId, no kind/severity priority
```

Run:

```bash
npm test -- tests/sidepanel/contextual-behavioral-evidence.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the pure resolver**

Implementation is intentionally simple:

```ts
return patterns
  .map((pattern) => ({ pattern, evidence: evidenceByPatternId.get(pattern.patternId) }))
  .filter((entry): entry is ContextualBehavioralEvidence =>
    entry.evidence !== undefined && entry.evidence.evidenceIndexes.includes(currentIndex)
  )
  .sort((a, b) => a.pattern.patternId.localeCompare(b.pattern.patternId));
```

Do not add a semantic pattern-kind priority.

- [ ] **Step 3: Write failing Change Inspector tests**

Create a test with mutations + three contextual patterns + expression evidence.

Required behavior:

```text
heading = What Changed
mutation list renders first
at most first two pattern clues render inline
when >2 matches, show "+1 more evidence pattern" without selecting a semantic winner
View evidence carries exact patternId
expression section heading = How this value was computed
no expression placeholder when expressionEvidence is undefined
```

Use the real `createExpressionEvidence()` from the completed Expression Tracing prerequisite.

- [ ] **Step 4: Implement `ChangeInspector`**

Reuse `createMutationList()` unchanged.

Map pattern titles factually:

```ts
repeated_state      -> `Repeated observable state × ${repeatCount}`
no_progress         -> `No observable progress across ${revisitCount} revisits`
repeated_transition -> `Repeated ${periodSteps}-step behavior × ${repeatCount}`
```

Render at most two clue rows, sorted by the pure resolver. Each gets a `View evidence` button calling the exact `pattern.patternId`.

If expression evidence exists:

```ts
expressionHost.append(
  heading("How this value was computed"),
  createExpressionEvidence(expressionEvidence, input.expressionTracing)
);
```

If it does not exist, omit the entire computation section; do not render `No expression evidence for this step` in the primary Debug flow.

- [ ] **Step 5: Integrate with `TraceVisualizer`**

Create the inspector once. Its `onViewEvidence(patternId)` callback must:

```ts
workspace.setMode("evidence");
evidenceWorkspace.focusPattern(patternId);
```

`setStep()` computes:

```ts
const event = session.events[currentIndex];
const contextual = resolveContextualBehavioralEvidence(
  interpretation.behavioralAnalysis.patterns,
  evidenceByPatternId,
  currentIndex
);
const expressionEvidence = event
  ? interpretation.expressionEvidence.get(event.step)
  : undefined;

changeInspector.setStep({
  mutations: state?.mutations ?? [],
  behavioralEvidence: contextual,
  expressionEvidence,
  expressionTracing: session.expressionTracing
});
```

This replaces the old `changesPanel` and removes the full Behavioral Signals panel from Debug.

- [ ] **Step 6: Style the inspector as the third primary region**

Use one contained surface, not a three-column inspector grid. Delete `.trace-viewer__inspector-grid` after no references remain.

Ensure expression-tree content inherits the available width and may scroll internally only where the Expression Evidence component already requires it.

- [ ] **Step 7: Verify primary-flow behavior**

```bash
npm test -- \
  tests/sidepanel/contextual-behavioral-evidence.test.ts \
  tests/sidepanel/change-inspector.test.ts \
  tests/sidepanel/trace-visualizer.test.ts \
  tests/sidepanel/expression-evidence.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/contextual-behavioral-evidence.ts src/sidepanel/components/ChangeInspector.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/contextual-behavioral-evidence.test.ts tests/sidepanel/change-inspector.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "feat: consolidate primary change inspector"
```

---

### Task 7: Move Full Behavioral Tooling into Evidence

**Files:**
- Create: `src/sidepanel/components/EvidenceWorkspace.ts`
- Create: `tests/sidepanel/evidence-workspace.test.ts`
- Modify: `src/sidepanel/components/BehavioralSignals.ts`
- Modify: `tests/sidepanel/behavioral-signals.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**

Extend Behavioral Signals presentation without changing navigation rules:

```ts
export interface BehavioralSignalsOptions {
  analysis: BehavioralAnalysis;
  currentIndex: number;
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>;
  onNavigate(index: number): void;
  focusPatternId?: string | null;
}
```

When `focusPatternId` matches a rendered row, add `tabIndex = -1`, class `is-focused-evidence`, and call `focus({ preventScroll: true })` only when invoked through the workspace's explicit `focusPattern()` action; ordinary step updates never auto-focus.

```ts
export interface EvidenceWorkspaceHandle {
  element: HTMLElement;
  setCurrentIndex(index: number): void;
  focusPattern(patternId: string): void;
}

export function createEvidenceWorkspace(options: {
  analysis: BehavioralAnalysis;
  traceIndex: TraceStepIndex;
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>;
  traceFoldModel: TraceFoldModel;
  currentIndex: number;
  onNavigate(index: number): void;
}): EvidenceWorkspaceHandle;
```

- [ ] **Step 1: Write failing evidence-workspace tests**

Assert the workspace contains product-level sections:

```text
Execution Evidence
Patterns
Timeline
Trace Structure
```

It may reuse `BehavioralSignals`, `BehavioralTimeline`, and `TraceOutline` internally.

Verify `setCurrentIndex(3)` updates timeline and outline current state but does not emit navigation.

Verify `focusPattern("pattern-2")` focuses the exact pattern row and does not navigate the trace.

- [ ] **Step 2: Add explicit pattern focusing support to Behavioral Signals**

Keep existing First / Previous / Next / Last exact navigation unchanged.

Add a small helper so `EvidenceWorkspace.focusPattern()` can rebuild signals with the same current index and target `focusPatternId`, replace the pattern host, then focus the matching row.

Do not auto-focus on every `setCurrentIndex()`.

- [ ] **Step 3: Build `EvidenceWorkspace`**

Create once:

```ts
const timeline = createBehavioralTimeline(...);
const outline = createTraceOutline(...);
```

Keep a dedicated pattern host that rebuilds `createBehavioralSignals()` when current index changes because Behavioral Signals currently derives Previous/Next button destinations during render.

`setCurrentIndex(index)` must:

```ts
currentIndex = index;
renderSignals(null);
timeline.setCurrentIndex(index);
outline.setCurrentIndex(index);
```

`focusPattern(patternId)` calls `renderSignals(patternId)` without changing `currentIndex`.

- [ ] **Step 4: Move old behavioral surfaces out of Debug**

In `TraceVisualizer.ts`:

```ts
workspace.panels.evidence.append(evidenceWorkspace.element);
```

Delete direct root/debug appends of:

```text
Behavioral Signals panel
Behavioral Timeline element
Trace Outline element
```

In `setStep()` call only:

```ts
evidenceWorkspace.setCurrentIndex(currentIndex);
```

- [ ] **Step 5: Verify Evidence navigation reuses the raw cursor**

Extend `trace-visualizer.test.ts`:

1. switch to Evidence;
2. click a Behavioral Signals `Next` or timeline band;
3. assert exact raw index updates Code, Runtime State, Change Inspector, timeline, and outline;
4. assert mode remains Evidence after ordinary Evidence navigation.

Failure-First remains the only action that forcibly restores Debug.

- [ ] **Step 6: Run focused regression tests**

```bash
npm test -- \
  tests/sidepanel/evidence-workspace.test.ts \
  tests/sidepanel/behavioral-signals.test.ts \
  tests/sidepanel/behavioral-timeline.test.ts \
  tests/sidepanel/trace-outline.test.ts \
  tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/components/EvidenceWorkspace.ts src/sidepanel/components/BehavioralSignals.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/evidence-workspace.test.ts tests/sidepanel/behavioral-signals.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "refactor: move behavioral tooling into evidence workspace"
```

---

### Task 8: Move Raw Debugger Detail into Advanced

**Files:**
- Create: `src/sidepanel/components/AdvancedWorkspace.ts`
- Create: `tests/sidepanel/advanced-workspace.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**

```ts
export interface AdvancedWorkspaceHandle {
  element: HTMLElement;
  setStep(state: VisualState | undefined): void;
}

export function createAdvancedWorkspace(
  session: TraceSession
): AdvancedWorkspaceHandle;
```

The component may keep its internal subsections as collapsible `<details>` because Advanced is explicitly a secondary inspection surface.

- [ ] **Step 1: Write failing Advanced workspace tests**

Test initial headings:

```text
Locals
Call Stack
Output
Exception Details   # only when session.exception exists
Raw Trace
```

Assert raw JSON is present only inside the Advanced component.

Call `setStep()` with two different states and assert Locals + Call Stack update synchronously.

- [ ] **Step 2: Move Locals rendering into `AdvancedWorkspace.ts`**

Move `renderLocals()` from `TraceVisualizer.ts` unchanged except for CSS ownership.

Locals continues to use `formatValue()` and the existing snapshot data; no interpretation changes.

- [ ] **Step 3: Move Call Stack and Output rendering**

Move `renderCallStack()` and `renderOutput()` into the component.

Separate exception metadata from ordinary stdout in presentation:

```text
Output
  stdout

Exception Details
  RuntimeError · line 5
  boom
```

Do not alter `TraceSession.exception` authority.

- [ ] **Step 4: Move Raw Trace JSON**

Render:

```ts
const raw = document.createElement("pre");
raw.id = "trace-output";
raw.textContent = JSON.stringify(session.events, null, 2);
```

inside a closed-by-default `Raw Trace · ${session.events.length} events` details section.

- [ ] **Step 5: Integrate and delete old primary-flow panels**

Create once:

```ts
const advancedWorkspace = createAdvancedWorkspace(session);
workspace.panels.advanced.append(advancedWorkspace.element);
```

`setStep()` uses:

```ts
advancedWorkspace.setStep(state);
```

Delete old Locals panel, Call Stack panel, Output panel, and `Debug details` panel creation from `TraceVisualizer.ts`.

- [ ] **Step 6: Verify Advanced does not alter execution state**

Test:

1. navigate to step 2;
2. switch Advanced;
3. inspect Locals/Call Stack;
4. switch back Debug;
5. assert still step 2 and playback state unchanged.

Run:

```bash
npm test -- tests/sidepanel/advanced-workspace.test.ts tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/components/AdvancedWorkspace.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/advanced-workspace.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "refactor: move raw debugger details into advanced workspace"
```

---

### Task 9: Finalize Primary Layout, Narrow-Width Behavior, Accessibility, and End-to-End Synchronization

**Files:**
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `tests/sidepanel/workspace-tabs.test.ts`
- Modify: `tests/sidepanel/step-navigator.test.ts`
- Modify: `tests/sidepanel/code-workspace.test.ts`

**Interfaces:**
- Consumes all handles produced by Tasks 1–8.
- Produces the final composition contract required by the spec.

- [ ] **Step 1: Add one final DOM-order integration test**

In `trace-visualizer.test.ts`, assert the Debug panel child order by stable selectors:

```ts
const debug = root.querySelector("#trace-workspace-debug")!;
const selectors = [...debug.children].map((element) => element.className);

expect(selectors).toEqual([
  "trace-step-nav",
  "trace-code-workspace",
  "trace-runtime-workspace",
  "trace-change-inspector"
]);
```

The execution header remains above workspace tabs at root level. No Locals, full Behavioral Signals, Call Stack, Output, raw JSON, Timeline, or Outline may appear inside the Debug panel.

- [ ] **Step 2: Add all-navigation synchronization coverage**

For a fixture with visual state, mutations, expression evidence, behavioral evidence, locals, call stack, and output, exercise each path independently:

```text
Previous
Next
scrubber
Play tick
Failure-First Inspect
Behavioral Signals navigation
Behavioral Timeline navigation
Trace Outline Inspect
```

After each action assert the authoritative raw index agrees across:

```text
Step Navigator label/range
Code current line
Runtime State current visual
What Changed mutations
expression evidence
contextual behavioral clue
Advanced Locals
Advanced Call Stack
Evidence Timeline
Evidence Trace Outline
```

Do not assert a second cursor because none may exist.

- [ ] **Step 3: Add narrow-width CSS rules**

Keep `body { min-width: 360px; }`.

Add:

```css
.trace-workspace,
.trace-workspace__panel,
.trace-code-workspace,
.trace-runtime-workspace,
.trace-change-inspector,
.trace-evidence-workspace,
.trace-advanced-workspace {
  min-width: 0;
  max-width: 100%;
}

.trace-code-workspace .trace-viewer__code {
  overflow-x: auto;
}

@media (max-width: 480px) {
  .app-shell {
    padding: 10px;
  }

  .trace-step-nav__controls {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .trace-step-nav__play {
    grid-column: 1 / -1;
    justify-self: center;
  }

  .trace-change-inspector__mutation-row,
  .trace-change-inspector__clue-row {
    grid-template-columns: 1fr;
  }
}
```

Do not shrink visualizers with global `transform: scale(...)` or fixed tiny heights. Prefer vertical space and their existing internal scrolling/panning.

- [ ] **Step 4: Add reduced-motion and focus-visible rules**

```css
@media (prefers-reduced-motion: reduce) {
  .trace-viewer *,
  .trace-viewer *::before,
  .trace-viewer *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}

.trace-viewer button:focus-visible,
.trace-viewer input:focus-visible {
  outline: 2px solid #1d67ed;
  outline-offset: 2px;
}
```

Ensure current-line and abnormal-status meaning remain textual/marker-based, not color-only.

- [ ] **Step 5: Remove dead legacy CSS and DOM helpers**

Search and remove unused rules/helpers for:

```text
trace-viewer__summary*
trace-viewer__state-meta
trace-viewer__inspector-grid
old bottom trace-viewer__controls
old primary Locals / Behavioral panel layout wrappers
```

Do not remove styles still used inside Evidence or Advanced.

Run:

```bash
npm test -- tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS and no TypeScript unused-reference errors introduced by the refactor.

- [ ] **Step 6: Run the complete Side Panel suite**

```bash
npm test -- tests/sidepanel
```

Expected: PASS.

- [ ] **Step 7: Run full repository verification**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 8: Manual Chrome smoke test**

Load the freshly built `dist/` extension as unpacked and verify these representative workflows:

```text
Binary Search / timeout-like or trace-limit fixture:
  compact status -> Start Here -> Inspect -> Code + Runtime State + What Changed

Two Sum / completed:
  no failure hero -> raw stepping -> List/Dict visualization remains stable

Linked List:
  larger Runtime State keeps topology readable

Tree / Graph / Matrix:
  visual area is not cramped by status/evidence panels

Expression-traced DP-style assignment:
  What Changed includes "How this value was computed"

Evidence tab:
  pattern navigation changes the same raw cursor

Advanced tab:
  Locals / Call Stack / Output reflect the same selected step
```

Do not evaluate LeetCode judge correctness; this smoke test validates extension UI behavior only.

- [ ] **Step 9: Commit**

```bash
git add src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel
git commit -m "test: validate debugger workspace information architecture"
```

---

## Final Acceptance Checklist

Before marking the milestone complete, verify each spec outcome explicitly:

```text
[ ] compact execution status is visible without a large hero banner
[ ] eligible Start Here stays factual, single, compact, and non-automatic
[ ] Failure-First Inspect returns to Debug and lands on exact inspectIndex
[ ] sticky Step Navigator sits immediately above Code
[ ] Code is persistent, non-collapsible, and visually larger than before
[ ] Runtime State is persistent, named correctly, and substantially larger
[ ] Runtime visualizers retain stable ordering and existing semantics
[ ] What Changed contains runtime mutations as primary textual evidence
[ ] current-step behavioral clues appear contextually, not as the full signals panel
[ ] expression evidence appears under "How this value was computed"
[ ] no empty expression placeholder appears in primary Debug flow
[ ] full Behavioral Signals / Timeline / Trace Outline live in Evidence
[ ] Locals / Call Stack / Output / exception details / raw events live in Advanced
[ ] Debug / Evidence / Advanced share one raw cursor
[ ] workspace changes do not start or stop autoplay
[ ] Evidence navigation still uses navigateDirect()
[ ] no causal/correctness/LeetCode judge claim was added
[ ] 360px-class Side Panel layout has no ordinary page-level horizontal overflow
[ ] reduced-motion and keyboard focus behavior remain usable
[ ] npm test passes
[ ] npm run typecheck passes
[ ] npm run build passes
```

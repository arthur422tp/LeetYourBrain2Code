# Debugger Workspace & Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current vertically stacked trace-inspector UI with a focused Debug / Evidence / Advanced workspace that keeps Code and Runtime State visually dominant, makes raw-step navigation persistent, compresses failure messaging, and preserves one authoritative execution cursor.

**Architecture:** `TraceVisualizer` remains the orchestration boundary for trace interpretation, Failure-First selection, `currentIndex`, autoplay, `navigateDirect()`, and `setStep()`. Presentation is split into focused components for tabs, execution status, step navigation, Code, Runtime State, Evidence, Change Inspector, and Advanced details. Existing behavioral analysis, Failure-First ranking, Trace Folding, runtime mutations, visualizer registry, and expression evidence remain authoritative and are reorganized only at the presentation layer.

**Tech Stack:** TypeScript 5.8, Vitest 3.2, JSDOM, Chrome MV3 Side Panel, existing DOM/CSS component architecture.

**Spec:** `docs/superpowers/specs/2026-09-12-debugger-workspace-information-architecture-design.md`

**Execution prerequisite:** Complete `docs/superpowers/plans/2026-09-12-expression-tracing-foundation-implementation-plan.md` first. This plan assumes trace schema v3 exists, `TraceInterpretation.expressionEvidence` is available, and `src/sidepanel/components/ExpressionEvidence.ts` exports `createExpressionEvidence(evidence, tracingState)`.

## Global Constraints

- Preserve the product rule: **visualize what the program actually did**.
- Do not change behavioral-analysis semantics, Failure-First ranking, Trace Folding semantics, runtime mutation semantics, expression semantics, or structure-visualizer semantics.
- `setStep()` remains the sole authoritative raw-cursor update path.
- `navigateDirect(index)` continues to stop autoplay before calling `setStep(index)`.
- Debug is the default mode for every new `TraceVisualizer` instance.
- Switching Debug / Evidence / Advanced must not change raw cursor or autoplay state.
- Failure-First remains at most one deterministic evidence-backed recommendation and never auto-navigates.
- Failure-First `Inspect` must navigate to the existing exact `selection.inspectIndex` and switch visible mode to Debug.
- Product copy must not say `root cause`, `bug location`, `likely cause`, `failure source`, `problem detected`, `infinite loop`, `caused timeout`, `caused failure`, `wrong algorithm`, or imply LeetCode Accepted/TLE.
- Visible product copy `Visual State` becomes **Runtime State**; internal `VisualState` naming does not need to change.
- Default Debug order is: compact execution header → compact Start Here when eligible → workspace tabs → sticky Step Navigator → Code → Runtime State → What Changed / computation.
- Full Behavioral Signals, Behavioral Timeline, and Trace Outline / folds live under Evidence.
- Locals, Call Stack, stdout/output, exception details, and raw events live under Advanced.
- Side Panel design target begins at 360 CSS px width; ordinary workspace UI must not require page-level horizontal scrolling.
- Avoid large red failure hero banners. Code and Runtime State receive more visual space than status/evidence messaging.
- Full regression gates remain `npm test`, `npm run typecheck`, and `npm run build`.

---

## File Structure

Create focused units:

```text
src/sidepanel/components/WorkspaceTabs.ts
    Debug / Evidence / Advanced presentation-only mode state.

src/sidepanel/components/ExecutionHeader.ts
    Compact session status and compact Failure-First host.

src/sidepanel/components/StepNavigator.ts
    Previous / Next / Play / Pause / raw-index scrubber.

src/sidepanel/components/CodeWorkspace.ts
    Persistent original-source view, current-line/exception markers,
    and nearest-only active-line scrolling.

src/sidepanel/components/RuntimeStateWorkspace.ts
    Persistent enlarged host for the existing visualizer registry.

src/sidepanel/components/EvidenceWorkspace.ts
    Full Behavioral Signals, Behavioral Timeline, and Trace Outline.

src/sidepanel/contextual-behavioral-evidence.ts
    Pure current-index -> matching resolved behavioral evidence.

src/sidepanel/components/ChangeInspector.ts
    Runtime mutations + contextual behavioral clues + expression computation.

src/sidepanel/components/AdvancedWorkspace.ts
    Locals, Call Stack, stdout, exception details, and raw trace.
```

Modify established seams:

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
tests/sidepanel/evidence-workspace.test.ts
tests/sidepanel/contextual-behavioral-evidence.test.ts
tests/sidepanel/change-inspector.test.ts
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

`setMode()` owns presentation only and never receives `currentIndex`.

- [ ] **Step 1: Write the failing tab tests**

Create `tests/sidepanel/workspace-tabs.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceTabs } from "../../src/sidepanel/components/WorkspaceTabs";

describe("WorkspaceTabs", () => {
  it("starts in Debug with accessible tab state", () => {
    const handle = createWorkspaceTabs();
    const tabs = [...handle.element.querySelectorAll<HTMLButtonElement>("[role=tab]")];

    expect(handle.getMode()).toBe("debug");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Debug", "Evidence", "Advanced"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(handle.panels.debug.hidden).toBe(false);
    expect(handle.panels.evidence.hidden).toBe(true);
    expect(handle.panels.advanced.hidden).toBe(true);
  });

  it("changes only presentation mode", () => {
    const changed = vi.fn();
    const handle = createWorkspaceTabs(changed);
    handle.element.querySelector<HTMLButtonElement>("[data-workspace-mode=evidence]")!.click();

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

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement tab semantics**

Render three native buttons inside `role="tablist"`. Each button uses:

```ts
button.type = "button";
button.setAttribute("role", "tab");
button.dataset.workspaceMode = mode;
button.setAttribute("aria-controls", panel.id);
```

Each panel uses:

```ts
panel.setAttribute("role", "tabpanel");
panel.id = `trace-workspace-${mode}`;
panel.hidden = mode !== "debug";
```

`setMode()` updates `aria-selected`, `tabIndex`, and `hidden`. Only `focusTab === true` moves focus.

- [ ] **Step 3: Integrate the shell without changing cursor behavior**

Create the workspace once in `TraceVisualizer.ts`. For this task only, keep all existing trace panels under `workspace.panels.debug` so no feature disappears while the shell lands.

Do not add any mode state to `setStep()`.

- [ ] **Step 4: Add base styles**

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

- [ ] **Step 5: Verify**

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

```ts
it("emits the exact raw index selected by the range input", () => {
  const onScrub = vi.fn();
  const handle = createStepNavigator({
    onPrevious: vi.fn(), onNext: vi.fn(), onTogglePlay: vi.fn(), onScrub
  });
  handle.setState({ currentIndex: 1, totalSteps: 5, playing: false });

  const range = handle.element.querySelector<HTMLInputElement>("input[type=range]")!;
  range.value = "3";
  range.dispatchEvent(new Event("input"));

  expect(onScrub).toHaveBeenCalledWith(3);
});

it("disables raw navigation for an empty trace", () => {
  const handle = createStepNavigator({
    onPrevious: vi.fn(), onNext: vi.fn(), onTogglePlay: vi.fn(), onScrub: vi.fn()
  });
  handle.setState({ currentIndex: 0, totalSteps: 0, playing: false });
  expect(handle.element.querySelectorAll("button:disabled")).toHaveLength(3);
  expect(handle.element.querySelector<HTMLInputElement>("input[type=range]")!.disabled).toBe(true);
});
```

Run:

```bash
npm test -- tests/sidepanel/step-navigator.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the navigator**

Use native Previous, Next, Play/Pause buttons and `<input type="range">`.

State rules:

```ts
previous.disabled = totalSteps === 0 || currentIndex <= 0;
next.disabled = totalSteps === 0 || currentIndex >= totalSteps - 1;
play.disabled = totalSteps < 2;
range.disabled = totalSteps < 2;
range.min = "0";
range.max = String(Math.max(totalSteps - 1, 0));
range.value = String(totalSteps === 0 ? 0 : currentIndex);
label.textContent = totalSteps === 0 ? "No steps" : `Step ${currentIndex + 1} / ${totalSteps}`;
play.textContent = playing ? "Ⅱ Pause" : "▶ Play";
```

Do not add behavioral markers to the range in v0.1.

- [ ] **Step 3: Replace the old bottom controls**

Extract the existing Play listener into `togglePlaying()` without changing `PLAY_INTERVAL_MS` or reset behavior.

Create:

```ts
const stepNavigator = createStepNavigator({
  onPrevious: () => setStep(currentIndex - 1),
  onNext: () => setStep(currentIndex + 1),
  onTogglePlay: togglePlaying,
  onScrub: (index) => navigateDirect(index)
});
```

Every `setStep()` path updates the navigator with `currentIndex`, `interpretation.visualStates.length`, and `timer !== null`. `stopPlaying()` also updates the displayed playing state after clearing the timer.

Delete the old `previous`, `next`, `play`, `controls`, and `stepInfo` DOM construction.

- [ ] **Step 4: Put navigation first in Debug and make it sticky**

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

- [ ] **Step 5: Verify cursor/autoplay semantics**

Extend `trace-visualizer.test.ts` to assert:

```text
scrubber -> exact raw index
Previous/Next -> adjacent raw index
Play -> same raw-step sequence as before
scrub while playing -> autoplay stops through navigateDirect()
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

### Task 3: Compress Execution Status and Failure-First

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

- [ ] **Step 1: Write failing compact-header tests**

Update Failure-First tests to keep exact navigation and forbidden-language checks while expecting compact text:

```ts
expect(entry.textContent).toContain("Start here");
expect(entry.textContent).toContain("Repeated 4-step behavior");
expect(entry.textContent).toContain("Evidence: Steps");
expect(entry.textContent).not.toContain("root cause");
expect(entry.textContent).not.toContain("caused timeout");
```

Add `trace-visualizer.test.ts` assertion that the new `.trace-execution-header` is before the workspace and old `<h2>Trace</h2>` hero markup is absent.

Run:

```bash
npm test -- tests/sidepanel/failure-first-entry.test.ts tests/sidepanel/trace-visualizer.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement compact `ExecutionHeader`**

Render one main status line:

```text
completed · 81 captured steps
exception · 24 captured steps
trace limit · 256 captured steps
timeout · 143 captured steps
```

Set:

```ts
root.dataset.executionStatus = session.status;
```

Keep `terminationReason` available as compact secondary metadata or a `title` attribute. Do not use alert/live-region roles.

- [ ] **Step 3: Compress `FailureFirstEntry`**

Keep the existing factual title mapping and exact evidence range. Render:

```text
↻ Start here · {pattern title} · within {distance} captured steps of termination    [Inspect]
Evidence: Steps X–Y
```

Retain the existing accessible button destination exactly.

- [ ] **Step 4: Integrate exact Failure-First behavior**

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
root.prepend(executionHeader);
```

Do not modify `selectFailureFirstEvidence()`.

- [ ] **Step 5: Replace hero styling**

Delete obsolete summary hero rules when no references remain. Add compact neutral-container styling; abnormal status uses warning/error text or small icon treatment, never a full large red card.

- [ ] **Step 6: Verify**

```bash
npm test -- tests/sidepanel/failure-first-entry.test.ts tests/sidepanel/failure-first-selection.test.ts tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

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

- [ ] **Step 1: Write failing Code workspace tests**

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

Stub `getBoundingClientRect()` and `scrollIntoView()` to prove scrolling occurs only when the active line is outside the code viewport.

Run:

```bash
npm test -- tests/sidepanel/code-workspace.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Move source rendering out of `TraceVisualizer.ts`**

Render a persistent section rather than `<details>`:

```text
<section class="trace-code-workspace">
  <header>Code <span>Python</span></header>
  <pre class="trace-viewer__code">...</pre>
</section>
```

Preserve original source text, `data-line`, line numbers, and monospace rendering.

Active line:

```ts
line.classList.toggle("is-active", lineNumber === currentLine);
if (lineNumber === currentLine) line.setAttribute("aria-current", "step");
else line.removeAttribute("aria-current");
```

Known exception line gets `is-exception-line` independently of current line.

- [ ] **Step 3: Implement nearest-only active-line scrolling**

When the active line changes, compare the line rectangle against the code viewport rectangle. Call:

```ts
activeLine.scrollIntoView({ block: "nearest" });
```

only if line top is above viewport top or line bottom is below viewport bottom.

- [ ] **Step 4: Integrate with `setStep()`**

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

- [ ] **Step 5: Allocate primary space**

```css
.trace-code-workspace {
  min-height: 190px;
  border: 1px solid #dfe5ee;
  border-radius: 10px;
  background: #fff;
  padding: 10px;
}

.trace-code-workspace .trace-viewer__code {
  min-height: 150px;
  max-height: min(34vh, 320px);
  overflow: auto;
}
```

Add a visible active-line marker so current execution is not communicated by color alone.

- [ ] **Step 6: Verify**

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

### Task 5: Extract and Enlarge Runtime State

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

Verify visible title `Runtime State`, empty trace copy, no-specialized-visual fallback, and DOM handle reuse for the same `visualId` across adjacent states.

Required fallback:

```text
No specialized runtime visualization for this step. Detailed variables are available in Advanced → Locals.
```

Run:

```bash
npm test -- tests/sidepanel/runtime-state-workspace.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Move `createVisualStateRenderer()` into the new component**

Preserve current:

```text
visualOrder
createVisualizer()
updateVisualizer()
handle reuse
disposal
```

Remove only the redundant `Line N` state metadata; Code now owns source position.

- [ ] **Step 3: Integrate**

Create once and place immediately after Code:

```ts
const runtimeStateWorkspace = createRuntimeStateWorkspace();
```

`setStep()`:

```ts
runtimeStateWorkspace.setState(state);
```

`dispose()`:

```ts
runtimeStateWorkspace.dispose();
```

Delete old `visualPanel` and embedded visual-state renderer from `TraceVisualizer.ts`.

- [ ] **Step 4: Enlarge the viewport**

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

Do not add a hard max-height to Tree, Graph, Matrix, or Linked List views.

- [ ] **Step 5: Run visualizer regressions**

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

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/components/RuntimeStateWorkspace.ts src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel/runtime-state-workspace.test.ts tests/sidepanel/trace-visualizer.test.ts
git commit -m "refactor: promote runtime state workspace"
```

---

### Task 6: Move Full Behavioral Tooling into Evidence

**Files:**
- Create: `src/sidepanel/components/EvidenceWorkspace.ts`
- Create: `tests/sidepanel/evidence-workspace.test.ts`
- Modify: `src/sidepanel/components/BehavioralSignals.ts`
- Modify: `tests/sidepanel/behavioral-signals.test.ts`
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**

Extend Behavioral Signals presentation only:

```ts
export interface BehavioralSignalsOptions {
  analysis: BehavioralAnalysis;
  currentIndex: number;
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>;
  onNavigate(index: number): void;
  focusPatternId?: string | null;
}
```

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

- [ ] **Step 1: Write failing Evidence workspace tests**

Assert product sections exist:

```text
Execution Evidence
Patterns
Timeline
Trace Structure
```

Verify:

```ts
handle.setCurrentIndex(3);
```

updates timeline/outline active state without calling `onNavigate`.

Verify:

```ts
handle.focusPattern("pattern-2");
```

focuses the exact Behavioral Signals row without changing raw index.

- [ ] **Step 2: Add explicit pattern focus support to Behavioral Signals**

Rows already expose `data-pattern-id`. When `focusPatternId` matches a row, make that row programmatically focusable (`tabIndex = -1`) and expose a class such as `is-focused-evidence`.

Do not focus during normal `setCurrentIndex()` updates. Focus occurs only from `EvidenceWorkspace.focusPattern()`.

Keep First / Previous / Next / Last exact navigation unchanged.

- [ ] **Step 3: Implement `EvidenceWorkspace`**

Create Timeline and Trace Outline once:

```ts
const timeline = createBehavioralTimeline(...);
const outline = createTraceOutline(...);
```

Keep a dedicated signals host because Behavioral Signals currently computes Previous/Next destinations during render.

```ts
const renderSignals = (focusPatternId: string | null = null) => {
  signalsHost.replaceChildren(createBehavioralSignals({
    analysis: options.analysis,
    currentIndex,
    evidenceByPatternId: options.evidenceByPatternId,
    onNavigate: options.onNavigate,
    focusPatternId
  }));
};
```

`setCurrentIndex(index)`:

```ts
currentIndex = index;
renderSignals();
timeline.setCurrentIndex(index);
outline.setCurrentIndex(index);
```

`focusPattern(patternId)` calls `renderSignals(patternId)` and focuses the resulting matching row. It does not navigate.

- [ ] **Step 4: Move behavioral surfaces out of Debug**

```ts
const evidenceWorkspace = createEvidenceWorkspace({
  analysis: interpretation.behavioralAnalysis,
  traceIndex,
  evidenceByPatternId,
  traceFoldModel,
  currentIndex,
  onNavigate: navigateDirect
});
workspace.panels.evidence.append(evidenceWorkspace.element);
```

Remove full Behavioral Signals, Behavioral Timeline, and Trace Outline from Debug/root composition.

`setStep()` calls:

```ts
evidenceWorkspace.setCurrentIndex(currentIndex);
```

- [ ] **Step 5: Verify Evidence navigation uses the same raw cursor**

In integration tests:

1. switch to Evidence;
2. click Behavioral Signals `Next`, a Timeline band, or Trace Outline `Inspect`;
3. assert Step Navigator, Code, Runtime State, and Evidence all reflect the exact same raw index;
4. assert ordinary Evidence navigation leaves mode as Evidence.

- [ ] **Step 6: Run focused regressions**

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

### Task 7: Consolidate What Changed, Behavioral Clues, and Expression Computation

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

Results include only resolved patterns whose `evidenceIndexes` contain `currentIndex`, sorted lexicographically by `patternId`. The ordering is deterministic and explicitly not severity ranking.

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

- [ ] **Step 1: Write failing contextual-evidence tests**

Cover:

```text
current index absent from evidence -> excluded
current index present -> included
missing evidence map entry -> excluded
multiple matches -> patternId order, no kind priority
```

Run:

```bash
npm test -- tests/sidepanel/contextual-behavioral-evidence.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the pure resolver**

```ts
return patterns
  .map((pattern) => ({ pattern, evidence: evidenceByPatternId.get(pattern.patternId) }))
  .filter((entry): entry is ContextualBehavioralEvidence =>
    entry.evidence !== undefined && entry.evidence.evidenceIndexes.includes(currentIndex)
  )
  .sort((a, b) => a.pattern.patternId.localeCompare(b.pattern.patternId));
```

- [ ] **Step 3: Write failing Change Inspector tests**

Required behavior:

```text
heading = What Changed
runtime mutations render first
up to two current-step behavioral clues render inline
more than two -> "+N more evidence patterns"
View evidence emits exact patternId
expression heading = How this value was computed
no expression placeholder when no expression evidence exists
```

Use the actual `createExpressionEvidence()` from the completed expression-tracing prerequisite.

- [ ] **Step 4: Implement `ChangeInspector`**

Reuse `createMutationList()` unchanged.

Factual clue titles:

```ts
repeated_state      -> `Repeated observable state × ${repeatCount}`
no_progress         -> `No observable progress across ${revisitCount} revisits`
repeated_transition -> `Repeated ${periodSteps}-step behavior × ${repeatCount}`
```

Render the first two items from the already deterministic result. If more exist, render `+${count} more evidence pattern(s)` without choosing a semantic winner.

Each clue's `View evidence` button emits the exact `patternId`.

If expression evidence exists:

```ts
expressionHost.append(
  createSectionHeading("How this value was computed"),
  createExpressionEvidence(input.expressionEvidence, input.expressionTracing)
);
```

If it does not exist, omit the section entirely.

- [ ] **Step 5: Integrate with the already-existing `EvidenceWorkspace`**

Create:

```ts
const changeInspector = createChangeInspector({
  onViewEvidence: (patternId) => {
    workspace.setMode("evidence");
    evidenceWorkspace.focusPattern(patternId);
  }
});
```

In `setStep()`:

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

Delete the old primary `What Changed` panel and the old inspector grid.

- [ ] **Step 6: Style as one primary inspector**

Delete `.trace-viewer__inspector-grid` after all references are gone. Use one full-width contained surface beneath Runtime State.

Do not add a separate top-level Expression Evidence panel to Debug.

- [ ] **Step 7: Verify**

```bash
npm test -- \
  tests/sidepanel/contextual-behavioral-evidence.test.ts \
  tests/sidepanel/change-inspector.test.ts \
  tests/sidepanel/evidence-workspace.test.ts \
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

Advanced may use internal `<details>` sections because it is explicitly secondary.

- [ ] **Step 1: Write failing Advanced tests**

Verify headings/content:

```text
Locals
Call Stack
Output
Exception Details   # only when session.exception exists
Raw Trace
```

Assert raw JSON exists only inside Advanced. Call `setStep()` with two states and assert Locals and Call Stack update to the new step.

- [ ] **Step 2: Move Locals rendering**

Move current `renderLocals()` logic out of `TraceVisualizer.ts` and continue using `formatValue()` against captured snapshots.

- [ ] **Step 3: Move Call Stack and Output**

Move `renderCallStack()` and stdout rendering. Present runtime exception metadata under a distinct `Exception Details` section but do not alter `TraceSession.exception` semantics.

- [ ] **Step 4: Move Raw Trace JSON**

```ts
const raw = document.createElement("pre");
raw.id = "trace-output";
raw.textContent = JSON.stringify(session.events, null, 2);
```

Place it in a closed-by-default `Raw Trace · ${session.events.length} events` details section.

- [ ] **Step 5: Integrate**

```ts
const advancedWorkspace = createAdvancedWorkspace(session);
workspace.panels.advanced.append(advancedWorkspace.element);
```

`setStep()`:

```ts
advancedWorkspace.setStep(state);
```

Delete old primary/root Locals, Call Stack, Output, and Debug Details panels.

- [ ] **Step 6: Verify mode switching does not mutate execution**

Test sequence:

```text
navigate to step 2
switch Advanced
inspect Locals / Call Stack
switch Debug
raw cursor still step 2
playing state unchanged
```

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

### Task 9: Finalize Layout, Responsiveness, Accessibility, and End-to-End Synchronization

**Files:**
- Modify: `src/sidepanel/components/TraceVisualizer.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/trace-visualizer.test.ts`
- Modify: `tests/sidepanel/workspace-tabs.test.ts`
- Modify: `tests/sidepanel/step-navigator.test.ts`
- Modify: `tests/sidepanel/code-workspace.test.ts`

**Interfaces:**
- Consumes all handles produced by Tasks 1–8.
- Produces the final composition required by the design spec.

- [ ] **Step 1: Add final primary DOM-order test**

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

The compact execution header remains above workspace tabs at root level. Debug must not contain full Behavioral Signals, Timeline, Trace Outline, Locals, Call Stack, Output, or raw JSON.

- [ ] **Step 2: Add cross-surface single-cursor integration tests**

Using a fixture with visual state, mutations, expression evidence, behavioral evidence, locals, call stack, and output, exercise independently:

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

After each action assert the same raw index is reflected in:

```text
Step Navigator
Code current line
Runtime State
What Changed mutations
expression computation
contextual behavioral clue
Advanced Locals
Advanced Call Stack
Evidence Timeline
Evidence Trace Outline
```

- [ ] **Step 3: Add narrow-width rules**

Keep existing:

```css
body {
  min-width: 360px;
}
```

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

Never solve narrow width by globally scaling Tree / Graph / Matrix / Linked List content to unreadable size.

- [ ] **Step 4: Add reduced-motion and keyboard focus rules**

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

Current-line and abnormal-status meaning must remain readable without color.

- [ ] **Step 5: Remove dead legacy presentation code**

Remove unused helpers/rules for:

```text
trace-viewer__summary*
trace-viewer__state-meta
trace-viewer__inspector-grid
old bottom trace-viewer__controls
old primary Locals / Behavioral panel layout wrappers
```

Do not remove styles still consumed inside Evidence/Advanced.

Run:

```bash
npm test -- tests/sidepanel/trace-visualizer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Run the complete Side Panel suite**

```bash
npm test -- tests/sidepanel
```

Expected: PASS.

- [ ] **Step 7: Run full repository gates**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 8: Manual Chrome smoke test**

Build and load `dist/` as an unpacked extension. Verify:

```text
Binary Search / timeout-like or trace-limit execution:
  compact status -> Start Here -> Inspect -> Code + Runtime State + What Changed

Two Sum / completed execution:
  no failure hero -> raw stepping -> List/Dict visualization remains stable

Linked List:
  Runtime State topology remains readable

Tree / Graph / Matrix:
  visual area is not cramped by status/evidence panels

Expression-traced DP-style assignment:
  What Changed contains "How this value was computed"

Evidence:
  pattern/timeline/outline navigation changes the same raw cursor

Advanced:
  Locals / Call Stack / Output reflect the same selected step
```

This smoke test validates extension behavior only; do not infer LeetCode judge correctness.

- [ ] **Step 9: Commit**

```bash
git add src/sidepanel/components/TraceVisualizer.ts src/sidepanel/styles.css tests/sidepanel
git commit -m "test: validate debugger workspace information architecture"
```

---

## Final Acceptance Checklist

```text
[ ] compact execution status is visible without a large hero banner
[ ] eligible Start Here stays factual, single, compact, and non-automatic
[ ] Failure-First Inspect returns to Debug and lands on exact inspectIndex
[ ] sticky Step Navigator sits immediately above Code
[ ] Code is persistent, non-collapsible, and substantially larger than before
[ ] Runtime State is persistent, named correctly, and substantially larger
[ ] specialized visualizers preserve existing ordering and semantics
[ ] What Changed is the primary textual inspector
[ ] current-step behavioral clues are contextual rather than the full signals panel
[ ] expression evidence appears under "How this value was computed"
[ ] no empty expression placeholder appears in primary Debug
[ ] full Behavioral Signals / Timeline / Trace Outline live in Evidence
[ ] Locals / Call Stack / Output / exception details / raw events live in Advanced
[ ] Debug / Evidence / Advanced share exactly one raw cursor
[ ] workspace changes do not start or stop autoplay
[ ] all Evidence navigation still uses navigateDirect()
[ ] no causal/correctness/LeetCode judge claim was introduced
[ ] 360px-class Side Panel layout has no ordinary page-level horizontal overflow
[ ] reduced-motion and keyboard-focus behavior remain usable
[ ] npm test passes
[ ] npm run typecheck passes
[ ] npm run build passes
```

# Live Editor State & Pre-Run Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LeetYourBrain2Code mirror the active LeetCode Monaco editor while the user is typing, before any LeetCode Run / Submit action, and automatically execute only when the latest page state contains a usable testcase and runnable Python draft.

**Architecture:** Introduce a partial `LeetCodePageState` source contract that can represent code, language, and testcase independently. Migrate the MAIN-world bridge, content script, active-tab ownership layer, and Side Panel to transport that page state; the Side Panel updates the code mirror first, then projects the state into the existing complete `LeetCodeSnapshot` / `LiveExecutionScheduler` path only when execution prerequisites are present. Use a short-lived compatibility path while migrating the protocol, then remove it before completion.

**Tech Stack:** TypeScript 5.8, Chrome Manifest V3, LeetCode Monaco MAIN-world bridge, Vitest 3.2 + jsdom, existing `LiveExecutionScheduler`, bundled Pyodide Web Worker.

**Spec:** `docs/superpowers/specs/2026-09-06-live-editor-state-pre-run-execution-design.md`

## Global Constraints

- Code synchronization must work before the user presses LeetCode Run or Submit.
- Editor synchronization and execution readiness are separate states.
- `code === ""` means an observed empty editor; `code === null` means the editor is currently unavailable.
- `testcase === ""` means an observed empty testcase editor; `testcase === null` means testcase state is currently unavailable.
- Never reuse a testcase from a previous tab ownership or previous problem when the current page state has `testcase === null`.
- Preserve active-tab ownership, active-tab epoch, fetch-sequence, and stale-error suppression semantics.
- Preserve the last rendered runnable visualization when the latest source state is not runnable.
- A newly non-runnable source revision must make older in-flight execution results stale; it must not clear an already-rendered visualization.
- Keep the existing 300 ms changed-only MAIN-world polling; do not add a Monaco event-listener subsystem in this feature.
- Keep the existing `LiveExecutionScheduler` debounce/latest-wins/single-flight behavior; do not move source mirroring into the scheduler.
- Do not add Linked List, Tree, Graph, DP, or other new visualizers in this feature.
- Do not call LeetCode judge APIs and do not simulate Run / Submit.
- No new backend and no new runtime dependency.

---

## File Structure

### Create

`src/content/leetcode-page-state.ts`

Owns the source-layer data contracts and pure validation/projection helpers:

```ts
ProblemMetadata
LeetCodePageState
LeetCodeSnapshot
validatePageState()
validateSnapshot()
toRunnableSnapshot()
```

This keeps partial source truth separate from DOM extraction and avoids putting execution-readiness policy into the page bridge.

### Modify

`src/content/leetcode-adapter.ts`

Owns isolated-world extraction, MAIN-world request helpers, normalization, and compatibility re-exports while the protocol migrates.

`src/page-bridge/leetcode-main-world.ts`

Extracts partial page state from Monaco/DOM and publishes changed page-state updates without requiring testcase readiness.

`src/content/content-script.ts`

Validates MAIN-world page-state messages and forwards them to extension runtime.

`src/sidepanel/active-tab-source.ts`

Keeps existing exact-tab/window ownership semantics but transports `LeetCodePageState` instead of requiring complete snapshots.

`src/sidepanel/bootstrap.ts`

Separates source mirroring/readiness UI from execution scheduling. This file must update the source textarea before deciding whether to execute.

`README.md`

Documents pre-Run typing-time synchronization.

`README.zh-TW.md`

Documents the same behavior in Traditional Chinese.

### Tests

`tests/execution/leetcode-adapter.test.ts`

Covers partial-state validation, `null` vs empty-string semantics, MAIN-world extraction, changed-only publishing, and testcase appearance after typing.

`tests/execution/content-script.test.ts`

Covers page-state request/response and update forwarding.

`tests/sidepanel/active-tab-source.test.ts`

Covers partial page-state ownership, exact-tab refresh, background filtering, stale-owner suppression, and no cross-owner testcase leakage.

`tests/sidepanel/bootstrap.test.ts`

Covers code mirror before testcase availability, non-runnable invalidation, waiting status, automatic execution when testcase later appears, empty-editor semantics, and `Run now` behavior.

`tests/execution/live-execution-scheduler.test.ts`

Regression-only unless implementation exposes a scheduler regression. The source layer should not require new scheduler public APIs beyond existing `invalidate()` and `schedule()`.

---

### Task 1: Introduce the Partial Page-State Domain Contract

**Files:**
- Create: `src/content/leetcode-page-state.ts`
- Modify: `src/content/leetcode-adapter.ts`
- Test: `tests/execution/leetcode-adapter.test.ts`

**Interfaces:**
- Consumes: none; this establishes the shared contract used by all later tasks.
- Produces:

```ts
export interface ProblemMetadata {
  slug: string | null;
  title: string | null;
}

export interface LeetCodePageState {
  code: string | null;
  language: string | null;
  testcase: string | null;
  metadata: ProblemMetadata;
}

export interface LeetCodeSnapshot {
  code: string;
  language: string;
  testcase: string;
  metadata: ProblemMetadata;
}

export function validatePageState(value: unknown): value is LeetCodePageState;
export function validateSnapshot(value: unknown): value is LeetCodeSnapshot;
export function toRunnableSnapshot(state: LeetCodePageState): LeetCodeSnapshot | null;
```

- `leetcode-adapter.ts` temporarily re-exports these names so existing imports remain green while later tasks migrate consumers.

- [ ] **Step 1: Add failing tests for partial-state validation and projection**

Add imports:

```ts
import {
  toRunnableSnapshot,
  validatePageState,
  type LeetCodePageState
} from "../../src/content/leetcode-page-state";
```

Add tests:

```ts
it("accepts code when testcase is not available yet", () => {
  const state: LeetCodePageState = {
    code: "class Solution:\n    def twoSum(self, nums, target):\n        pass",
    language: "python",
    testcase: null,
    metadata: { slug: "two-sum", title: "Two Sum" }
  };

  expect(validatePageState(state)).toBe(true);
  expect(toRunnableSnapshot(state)).toBeNull();
});

it("distinguishes an observed empty editor from an unavailable editor", () => {
  expect(validatePageState({
    code: "",
    language: "python",
    testcase: "[2,7,11,15]\n9",
    metadata: { slug: "two-sum", title: "Two Sum" }
  })).toBe(true);

  expect(validatePageState({
    code: null,
    language: "python",
    testcase: "[2,7,11,15]\n9",
    metadata: { slug: "two-sum", title: "Two Sum" }
  })).toBe(true);
});

it("projects only source-complete page state into a runnable snapshot candidate", () => {
  const complete: LeetCodePageState = {
    code: "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",
    language: "python",
    testcase: "[2,7,11,15]\n9",
    metadata: { slug: "two-sum", title: "Two Sum" }
  };

  expect(toRunnableSnapshot(complete)).toEqual(complete);
  expect(toRunnableSnapshot({ ...complete, code: "" })).toBeNull();
  expect(toRunnableSnapshot({ ...complete, language: null })).toBeNull();
  expect(toRunnableSnapshot({ ...complete, testcase: null })).toBeNull();
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the new module does not exist**

Run:

```bash
npm test -- tests/execution/leetcode-adapter.test.ts
```

Expected: FAIL with an import/module resolution error for `leetcode-page-state`.

- [ ] **Step 3: Create `leetcode-page-state.ts` with bounded validation and pure projection**

Implement:

```ts
const MAX_CODE_LENGTH = 1_000_000;
const MAX_TESTCASE_LENGTH = 100_000;
const MAX_LANGUAGE_LENGTH = 64;

export interface ProblemMetadata {
  slug: string | null;
  title: string | null;
}

export interface LeetCodePageState {
  code: string | null;
  language: string | null;
  testcase: string | null;
  metadata: ProblemMetadata;
}

export interface LeetCodeSnapshot {
  code: string;
  language: string;
  testcase: string;
  metadata: ProblemMetadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validNullableString(
  value: unknown,
  maxLength: number
): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function validMetadata(value: unknown): value is ProblemMetadata {
  return isRecord(value) &&
    (value.slug === null || typeof value.slug === "string") &&
    (value.title === null || typeof value.title === "string");
}

export function validatePageState(value: unknown): value is LeetCodePageState {
  return isRecord(value) &&
    validNullableString(value.code, MAX_CODE_LENGTH) &&
    validNullableString(value.language, MAX_LANGUAGE_LENGTH) &&
    validNullableString(value.testcase, MAX_TESTCASE_LENGTH) &&
    validMetadata(value.metadata);
}

export function validateSnapshot(value: unknown): value is LeetCodeSnapshot {
  return isRecord(value) &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    value.code.length <= MAX_CODE_LENGTH &&
    typeof value.language === "string" &&
    value.language.length > 0 &&
    value.language.length <= MAX_LANGUAGE_LENGTH &&
    typeof value.testcase === "string" &&
    value.testcase.length <= MAX_TESTCASE_LENGTH &&
    validMetadata(value.metadata);
}

export function toRunnableSnapshot(
  state: LeetCodePageState
): LeetCodeSnapshot | null {
  if (
    state.code === null ||
    state.code.length === 0 ||
    state.language === null ||
    state.language.length === 0 ||
    state.testcase === null
  ) {
    return null;
  }
  return {
    code: state.code,
    language: state.language,
    testcase: state.testcase,
    metadata: state.metadata
  };
}
```

Move the existing `ProblemMetadata`, `LeetCodeSnapshot`, size caps, `isRecord`, and `validateSnapshot` responsibility out of `leetcode-adapter.ts`. Import what the adapter needs and re-export the public names from the new module so existing call sites still compile during migration:

```ts
export {
  toRunnableSnapshot,
  validatePageState,
  validateSnapshot,
  type LeetCodePageState,
  type LeetCodeSnapshot,
  type ProblemMetadata
} from "./leetcode-page-state";
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npm test -- tests/execution/leetcode-adapter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the domain contract**

```bash
git add src/content/leetcode-page-state.ts src/content/leetcode-adapter.ts tests/execution/leetcode-adapter.test.ts
git commit -m "refactor: separate leetcode page state"
```

---

### Task 2: Add Partial Page-State Extraction and MAIN-World Transport

**Files:**
- Modify: `src/content/leetcode-adapter.ts`
- Modify: `src/page-bridge/leetcode-main-world.ts`
- Test: `tests/execution/leetcode-adapter.test.ts`

**Interfaces:**
- Consumes: `LeetCodePageState`, `validatePageState()`, `toRunnableSnapshot()` from Task 1.
- Produces:

```ts
export function extractIsolatedPageState(doc: Document): LeetCodePageState;
export function requestMainWorldPageState(
  pageWindow: Window,
  timeoutMs?: number
): Promise<LeetCodePageState>;

export interface LeetCodeAdapter {
  getPageState(): Promise<LeetCodePageState>;
}

export function extractPageState(
  doc: Document,
  pageWindow: LeetCodePageWindow
): LeetCodePageState;
```

- During this task only, preserve the existing snapshot request/update path as a compatibility path by deriving a complete snapshot with `toRunnableSnapshot()`. Task 6 removes it.

- [ ] **Step 1: Add failing tests for pre-Run partial extraction**

Add a helper that installs an editor without testcase fields:

```ts
function installTwoSumEditorWithoutTestcase(): void {
  document.title = "Two Sum - LeetCode";
  window.history.replaceState({}, "", "/problems/two-sum/description/");
  document.body.innerHTML = `
    <button>Python3</button>
    <a href="/problems/two-sum/">1. Two Sum</a>
    <textarea aria-label="Code editor">class Solution:\n    def twoSum(self, nums, target):\n        pass</textarea>
  `;
}
```

Add tests:

```ts
it("extracts editor state before testcase controls are available", () => {
  installTwoSumEditorWithoutTestcase();

  expect(extractPageState(document, window)).toEqual({
    code: "class Solution:\n    def twoSum(self, nums, target):\n        pass",
    language: "python",
    testcase: null,
    metadata: { slug: "two-sum", title: "Two Sum" }
  });
});

it("publishes code changes while testcase is still unavailable", async () => {
  installTwoSumEditorWithoutTestcase();
  const updates: LeetCodePageState[] = [];
  const onMessage = (event: MessageEvent): void => {
    if (
      event.data?.source === LEETCODE_MESSAGE_SOURCE &&
      event.data?.type === LEETCODE_MESSAGE_TYPES.pageStateUpdated
    ) {
      updates.push(event.data.state as LeetCodePageState);
    }
  };
  window.addEventListener("message", onMessage);
  const cleanup = installMainWorldBridge(window, document, { watchIntervalMs: 10 });

  try {
    await vi.waitFor(() => expect(updates.length).toBeGreaterThan(0));
    const editor = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Code editor"]'
    )!;
    editor.value = "class Solution:\n    def twoSum(self, nums, target):";

    await vi.waitFor(() => expect(updates.at(-1)?.code).toBe(editor.value));
    expect(updates.at(-1)?.testcase).toBeNull();
  } finally {
    cleanup();
    window.removeEventListener("message", onMessage);
  }
});

it("publishes testcase readiness even when code did not change", async () => {
  installTwoSumEditorWithoutTestcase();
  const updates: LeetCodePageState[] = [];
  const onMessage = (event: MessageEvent): void => {
    if (event.data?.type === LEETCODE_MESSAGE_TYPES.pageStateUpdated) {
      updates.push(event.data.state as LeetCodePageState);
    }
  };
  window.addEventListener("message", onMessage);
  const cleanup = installMainWorldBridge(window, document, { watchIntervalMs: 10 });

  try {
    await vi.waitFor(() => expect(updates.at(-1)?.testcase).toBeNull());
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div contenteditable="true" class="w-full cursor-text">[2,7,11,15]</div>' +
      '<div contenteditable="true" class="w-full cursor-text">9</div>'
    );

    await vi.waitFor(() =>
      expect(updates.at(-1)?.testcase).toBe("[2,7,11,15]\n9")
    );
  } finally {
    cleanup();
    window.removeEventListener("message", onMessage);
  }
});
```

Also add an empty-editor assertion:

```ts
it("reports an observed empty editor as an empty string", () => {
  installTwoSumEditorWithoutTestcase();
  document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Code editor"]'
  )!.value = "";

  expect(extractPageState(document, window).code).toBe("");
});
```

- [ ] **Step 2: Run the focused tests and verify they fail on the current complete-snapshot behavior**

Run:

```bash
npm test -- tests/execution/leetcode-adapter.test.ts
```

Expected: FAIL because testcase absence currently makes extraction unavailable and `pageStateUpdated` does not exist.

- [ ] **Step 3: Extend message constants with page-state names without removing snapshot names yet**

In `leetcode-adapter.ts`, extend MAIN-world constants:

```ts
export const LEETCODE_MESSAGE_TYPES = {
  requestSnapshot: "request_snapshot",
  responseSnapshot: "response_snapshot",
  snapshotUpdated: "snapshot_updated",
  requestPageState: "request_page_state",
  responsePageState: "response_page_state",
  pageStateUpdated: "page_state_updated"
} as const;
```

Extend content-runtime constants similarly:

```ts
export const LEETCODE_CONTENT_MESSAGE_TYPES = {
  requestSnapshot: "request_leetcode_snapshot",
  snapshotUpdated: "leetcode_snapshot_updated",
  requestPageState: "request_leetcode_page_state",
  pageStateUpdated: "leetcode_page_state_updated"
} as const;
```

These legacy snapshot entries are temporary migration scaffolding and must be deleted in Task 6.

- [ ] **Step 4: Implement partial DOM/Monaco extraction**

Change page extraction so unavailable fields become `null` rather than invalidating the entire state:

```ts
export function extractPageState(
  doc: Document,
  pageWindow: LeetCodePageWindow
): LeetCodePageState {
  const selectedLanguage = readLanguageFromDom(doc);
  const monacoCode = readCodeFromMonaco(pageWindow, selectedLanguage);
  const domCode = readCodeFromDom(doc);

  return {
    code: monacoCode?.code ?? domCode,
    language: monacoCode?.language ?? selectedLanguage,
    testcase: readTestcase(doc),
    metadata: extractMetadata(doc)
  };
}
```

Change `readCodeFromMonaco()` and `readCodeFromDom()` so an existing empty editor returns `""`; use `null` only when no editor/model can be observed. Do not use `code.length > 0` as the existence test.

Implement isolated extraction with the same semantics:

```ts
export function extractIsolatedPageState(doc: Document): LeetCodePageState {
  const editor = doc.querySelector<HTMLTextAreaElement>(LEETCODE_ACCESSORS.codeEditor);
  return {
    code: editor ? editor.value : null,
    language: readLanguageFromDom(doc),
    testcase: readTestcaseFromDom(doc),
    metadata: extractMetadata(doc)
  };
}
```

- [ ] **Step 5: Add request/response support for partial page state**

Implement `requestMainWorldPageState()` using the existing request-id/origin validation pattern, but validate `event.data.state` with `validatePageState()`.

Update `LeetCodeAdapter` to expose:

```ts
export interface LeetCodeAdapter {
  getPageState(): Promise<LeetCodePageState>;
  getSnapshot(): Promise<LeetCodeSnapshot>; // temporary compatibility only
}
```

`getPageState()` should prefer MAIN-world state and fall back to isolated partial state. `getSnapshot()` remains temporarily and may project `getPageState()` with `toRunnableSnapshot()`; if projection returns `null`, throw the existing actionable no-valid-snapshot error rather than inventing missing fields.

- [ ] **Step 6: Publish changed partial page state from the MAIN-world bridge**

The primary polling path becomes:

```ts
let lastPageStateKey: string | null = null;

const publishPageStateUpdate = (): void => {
  const state = extractPageState(doc, pageWindow);
  if (!validatePageState(state)) return;

  const key = JSON.stringify(state);
  if (key === lastPageStateKey) return;
  lastPageStateKey = key;

  pageWindow.postMessage({
    source: LEETCODE_MESSAGE_SOURCE,
    type: LEETCODE_MESSAGE_TYPES.pageStateUpdated,
    state
  }, targetOrigin);

  const snapshot = toRunnableSnapshot(state);
  if (snapshot) {
    pageWindow.postMessage({
      source: LEETCODE_MESSAGE_SOURCE,
      type: LEETCODE_MESSAGE_TYPES.snapshotUpdated,
      snapshot
    }, targetOrigin);
  }
};
```

Handle both `requestPageState` and the temporary legacy `requestSnapshot` request during migration. The page-state response must return the partial state even when testcase is `null`.

- [ ] **Step 7: Run adapter tests and typecheck**

Run:

```bash
npm test -- tests/execution/leetcode-adapter.test.ts
npm run typecheck
```

Expected: PASS, including the existing snapshot tests and the new pre-Run page-state tests.

- [ ] **Step 8: Commit source acquisition support**

```bash
git add src/content/leetcode-adapter.ts src/page-bridge/leetcode-main-world.ts tests/execution/leetcode-adapter.test.ts
git commit -m "feat: capture partial leetcode page state"
```

---

### Task 3: Forward Partial Page State Through the Content Script

**Files:**
- Modify: `src/content/content-script.ts`
- Test: `tests/execution/content-script.test.ts`

**Interfaces:**
- Consumes: `LeetCodeAdapter.getPageState()`, `validatePageState()`, `LEETCODE_MESSAGE_TYPES.pageStateUpdated`, `LEETCODE_CONTENT_MESSAGE_TYPES.requestPageState/pageStateUpdated`.
- Produces:

```ts
export function createPageStateMessageHandler(
  adapter: Pick<LeetCodeAdapter, "getPageState">
): ChromeRuntimeMessageHandler;

export function createPageStateUpdateHandler(
  pageWindow: Window,
  publish: (state: LeetCodePageState) => void
): (event: MessageEvent) => void;
```

- Keep old snapshot handlers registered during this task so the existing active-tab source remains operational until Task 4.

- [ ] **Step 1: Add failing tests for partial request/response and forwarding**

Use:

```ts
const partialState: LeetCodePageState = {
  code: "class Solution:\n    def one(self, value):",
  language: "python",
  testcase: null,
  metadata: { slug: "one", title: "One" }
};
```

Add:

```ts
it("responds with partial page state before testcase is available", async () => {
  const adapter = { getPageState: vi.fn(async () => partialState) };
  const sendResponse = vi.fn();
  const handler = createPageStateMessageHandler(adapter);

  expect(handler(
    { type: LEETCODE_CONTENT_MESSAGE_TYPES.requestPageState },
    {},
    sendResponse
  )).toBe(true);

  await vi.waitFor(() =>
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, state: partialState })
  );
});

it("forwards validated partial page-state updates", () => {
  const publish = vi.fn();
  const handler = createPageStateUpdateHandler(window, publish);

  handler({
    source: window,
    origin: window.location.origin,
    data: {
      source: LEETCODE_MESSAGE_SOURCE,
      type: LEETCODE_MESSAGE_TYPES.pageStateUpdated,
      state: partialState
    }
  } as unknown as MessageEvent);

  expect(publish).toHaveBeenCalledWith(partialState);
});
```

Also verify oversized/malformed partial state is not forwarded.

- [ ] **Step 2: Run the focused test and verify failure**

```bash
npm test -- tests/execution/content-script.test.ts
```

Expected: FAIL because the page-state handlers are not defined.

- [ ] **Step 3: Implement the page-state handlers**

Mirror the existing snapshot handler structure, but use `getPageState()` and `validatePageState()`:

```ts
function isPageStateRequest(message: unknown): boolean {
  return typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === LEETCODE_CONTENT_MESSAGE_TYPES.requestPageState;
}
```

Response shape:

```ts
{ ok: true, state }
```

Update shape:

```ts
{
  type: LEETCODE_CONTENT_MESSAGE_TYPES.pageStateUpdated,
  state
}
```

Register both the new page-state runtime handler and temporary legacy snapshot handler until Task 6.

- [ ] **Step 4: Run focused tests and the existing adapter tests**

```bash
npm test -- tests/execution/content-script.test.ts tests/execution/leetcode-adapter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the content bridge**

```bash
git add src/content/content-script.ts tests/execution/content-script.test.ts
git commit -m "feat: forward leetcode page state"
```

---

### Task 4: Migrate Active-Tab Ownership from Snapshot to Page State

**Files:**
- Modify: `src/sidepanel/active-tab-source.ts`
- Modify: `src/sidepanel/bootstrap.ts` only enough to compile against renamed active-source callbacks; full readiness UI is Task 5.
- Test: `tests/sidepanel/active-tab-source.test.ts`
- Test: `tests/sidepanel/bootstrap.test.ts`

**Interfaces:**
- Consumes: `LeetCodePageState`, `validatePageState()`, `LEETCODE_CONTENT_MESSAGE_TYPES.requestPageState/pageStateUpdated`.
- Produces:

```ts
export interface ActiveTabPageState {
  tabId: number;
  state: LeetCodePageState;
}

export interface ActiveTabSourceOptions {
  onOwnershipInvalidated(): void;
  onStateChange(state: ActiveTabState): void;
  onPageState(value: ActiveTabPageState): void;
  onError(error: Error): void;
}

export interface ActiveTabSource {
  start(): Promise<void>;
  refresh(): Promise<ActiveTabPageState | null>;
  dispose(): void;
}
```

- Remove `ActiveTabSnapshot` / `onSnapshot` from the active-source public interface in this task. The old page/content snapshot protocol may still physically exist until Task 6, but the Side Panel no longer consumes it.

- [ ] **Step 1: Convert active-source test fixtures to page state and add a partial-state ownership test**

Introduce:

```ts
function pageState(
  overrides: Partial<LeetCodePageState> = {}
): LeetCodePageState {
  return {
    code: "class Solution:\n    def one(self, value):\n        return value\n",
    language: "python",
    testcase: "7",
    metadata: { slug: "one", title: "One" },
    ...overrides
  };
}
```

Add a test equivalent to:

```ts
it("accepts a code-only state from the active LeetCode tab", async () => {
  const emitted: ActiveTabPageState[] = [];
  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: vi.fn(),
    onPageState: (value) => emitted.push(value),
    onError: vi.fn()
  }, chromeFake.api);

  chromeFake.setSnapshotResponse({
    ok: true,
    state: pageState({ testcase: null })
  });

  await source.start();

  await vi.waitFor(() =>
    expect(emitted.at(-1)?.state.testcase).toBeNull()
  );
  expect(emitted.at(-1)?.state.code).toContain("class Solution");
});
```

Adapt the fake API helper name if necessary; do not preserve snapshot terminology in newly written tests.

- [ ] **Step 2: Add/convert ownership regressions before implementation**

Ensure tests explicitly cover:

```ts
it("ignores page-state updates from a background LeetCode tab", ...)
it("drops an old-owner page state that arrives after a tab switch", ...)
it("refreshes the exact owned tab page state", ...)
it("does not surface an old-owner refresh error after ownership changes", ...)
it("does not inherit the old owner testcase when the new owner reports null", ...)
```

For the last case, emit:

```ts
{ tabId: 11, state: pageState({ testcase: "7" }) }
```

then switch ownership and emit:

```ts
{
  tabId: 22,
  state: pageState({
    testcase: null,
    metadata: { slug: "two-sum", title: "Two Sum" }
  })
}
```

The accepted value for tab 22 must retain `testcase: null`; the ownership layer must never fill it from tab 11.

- [ ] **Step 3: Run active-source tests and verify the contract migration fails**

```bash
npm test -- tests/sidepanel/active-tab-source.test.ts
```

Expected: FAIL on the new `onPageState` / request-page-state contract.

- [ ] **Step 4: Migrate exact-tab fetch to page state**

Rename the internal request path conceptually:

```ts
requestPageStateOnce(api, tabId): Promise<LeetCodePageState>
requestPageState(api, tabId): Promise<LeetCodePageState>
```

Use runtime request:

```ts
{ type: LEETCODE_CONTENT_MESSAGE_TYPES.requestPageState }
```

Validate response shape:

```ts
response.ok === true && validatePageState(response.state)
```

Keep existing missing-receiver reinjection behavior unchanged.

- [ ] **Step 5: Migrate ownership emission and runtime filtering**

Change fetch contexts from snapshot payloads to:

```ts
{ tabId: context.tabId, state: currentPageState }
```

Change runtime listener acceptance to:

```ts
message.type === LEETCODE_CONTENT_MESSAGE_TYPES.pageStateUpdated &&
validatePageState(message.state) &&
sender.tab?.id === activeLeetCodeTabId
```

Then call:

```ts
options.onPageState({
  tabId: activeLeetCodeTabId,
  state: message.state
});
```

Do not change `currentWindowId`, `currentActiveTabId`, `activeLeetCodeTabId`, `activeTabEpoch`, `fetchSequence`, or failure reconciliation semantics beyond payload naming.

- [ ] **Step 6: Make the minimal bootstrap type migration**

Change the fake/source callback names and `currentSnapshot` storage name to `currentPageState`, but preserve current complete-state behavior temporarily by projecting:

```ts
const runnable = toRunnableSnapshot(state);
if (runnable) {
  applySnapshot(runnable);
}
```

Do not implement the new code-only UI semantics in this step; Task 5 owns that behavior. The purpose here is to keep the application compiling while active-source transport changes.

- [ ] **Step 7: Run ownership, bootstrap, and type tests**

```bash
npm test -- tests/sidepanel/active-tab-source.test.ts tests/sidepanel/bootstrap.test.ts
npm run typecheck
```

Expected: PASS. Existing visible behavior remains unchanged for complete states, while the ownership layer can now transport partial page states safely.

- [ ] **Step 8: Commit the ownership transport migration**

```bash
git add src/sidepanel/active-tab-source.ts src/sidepanel/bootstrap.ts tests/sidepanel/active-tab-source.test.ts tests/sidepanel/bootstrap.test.ts
git commit -m "refactor: transport active leetcode page state"
```

---

### Task 5: Decouple Side Panel Code Mirroring from Execution Readiness

**Files:**
- Modify: `src/sidepanel/bootstrap.ts`
- Test: `tests/sidepanel/bootstrap.test.ts`
- Regression test: `tests/execution/live-execution-scheduler.test.ts`

**Interfaces:**
- Consumes: `LeetCodePageState`, `toRunnableSnapshot()`, existing `LiveExecutionScheduler.schedule()` and `invalidate()`.
- Produces local Side Panel source/readiness behavior:

```ts
type SourceReadiness =
  | "waiting_for_editor"
  | "waiting_for_language"
  | "waiting_for_testcase"
  | "candidate";

function sourceReadiness(state: LeetCodePageState): SourceReadiness;
```

The helper may remain private to `bootstrap.ts`; do not create a public abstraction unless tests need it.

- [ ] **Step 1: Add the primary acceptance test: typing-time code mirror with no testcase**

Update the fake active source to emit `onPageState` values and add:

```ts
it("mirrors active-tab code before testcase is available without executing", async () => {
  const root = document.createElement("main");
  const source = fakeActiveTabSourceFactory();
  const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));
  const handle = renderSidePanel(root, {
    controller: { execute },
    activeTabSourceFactory: source.factory,
    liveDebounceMs: 0
  });

  source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
  source.callbacks().onPageState({
    tabId: 11,
    state: {
      code: "class Solution:\n    def twoSum(self, nums, target):",
      language: "python",
      testcase: null,
      metadata: { slug: "two-sum", title: "Two Sum" }
    }
  });

  expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.value)
    .toContain("def twoSum");
  expect(root.querySelector<HTMLTextAreaElement>("#testcase")?.value).toBe("");
  expect(root.querySelector<HTMLSelectElement>("#testcase-case")?.disabled).toBe(true);
  expect(root.querySelector("#runtime-status")?.textContent)
    .toBe("Live: code synced · waiting for testcase");
  expect(execute).not.toHaveBeenCalled();

  handle.dispose();
});
```

- [ ] **Step 2: Add tests for repeated typing and empty-editor semantics**

Add:

```ts
it("keeps mirroring newer code-only revisions while execution remains blocked", () => {
  // Emit state A with testcase:null, then state B with different code/testcase:null.
  // Assert source textarea equals B and execute remains uncalled.
});

it("clears the source mirror for an observed empty editor", () => {
  // Emit a non-empty page state, then emit code:"" on the same owner.
  // Assert #source-code.value === "" and the previous trace element is preserved.
});
```

The test implementation must use complete page-state objects; do not use comments as the final committed test bodies.

- [ ] **Step 3: Add the automatic testcase-readiness test**

```ts
it("executes the latest mirrored code when testcase appears without another code change", async () => {
  const root = document.createElement("main");
  const source = fakeActiveTabSourceFactory();
  const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));
  const handle = renderSidePanel(root, {
    controller: { execute },
    activeTabSourceFactory: source.factory,
    liveDebounceMs: 0
  });

  const code = "class Solution:\n    def one(self, value):\n        return value + 1\n";

  source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
  source.callbacks().onPageState({
    tabId: 11,
    state: {
      code,
      language: "python",
      testcase: null,
      metadata: { slug: "one", title: "One" }
    }
  });
  expect(execute).not.toHaveBeenCalled();

  source.callbacks().onPageState({
    tabId: 11,
    state: {
      code,
      language: "python",
      testcase: "8",
      metadata: { slug: "one", title: "One" }
    }
  });

  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(execute.mock.calls[0]?.[0].sourceCode).toBe(code);
  expect(execute.mock.calls[0]?.[0].rawTestcase).toBe("8");

  handle.dispose();
});
```

- [ ] **Step 4: Add a stale in-flight execution test for a newly non-runnable source revision**

This test protects the global constraint that a source revision with no testcase makes older in-flight work stale without clearing an already-rendered visualization.

Use a deferred first execution:

```ts
it("does not render an older in-flight session after the latest page state loses execution readiness", async () => {
  const first = deferred<TraceSession>();
  const execute = vi.fn((request: ExecutionRequest) => first.promise);
  // Emit runnable state R1 and wait until execute starts.
  // Emit R2 with newer code and testcase:null.
  // Resolve R1.
  // Assert code mirror shows R2 and R1 did not create/replace the trace viewer.
});
```

The committed test must fully instantiate `root`, source callbacks, R1, R2, and `completedSession()`; do not leave pseudocode comments.

- [ ] **Step 5: Run bootstrap tests and verify failures**

```bash
npm test -- tests/sidepanel/bootstrap.test.ts
```

Expected: FAIL because current bootstrap only applies complete runnable snapshots and does not expose waiting-for-testcase semantics.

- [ ] **Step 6: Implement source readiness separately from scheduler status**

Track:

```ts
let currentPageState: LeetCodePageState | null = null;
let ownershipState: ActiveTabState | null = null;
let schedulerStatus: LiveStatus | null = null;
```

Use a single render function rather than letting scheduler callbacks directly overwrite source-readiness text:

```ts
const renderLiveStatus = (): void => {
  if (ownershipState?.kind === "paused") {
    status.dataset.liveStatus = "paused";
    status.textContent = "Live: paused · No active LeetCode tab";
    return;
  }

  if (!currentPageState || currentPageState.code === null) {
    status.dataset.liveStatus = "syncing";
    status.textContent = "Live: syncing";
    return;
  }

  if (currentPageState.language === null) {
    status.dataset.liveStatus = "editing";
    status.textContent = "Live: editing";
    return;
  }

  if (currentPageState.testcase === null) {
    status.dataset.liveStatus = "waiting_for_testcase";
    status.textContent = "Live: code synced · waiting for testcase";
    return;
  }

  const next = schedulerStatus ?? "updating";
  status.dataset.liveStatus = next;
  status.textContent = `Live: ${next}`;
};
```

If a source-complete state later proves invalid in `createExecutionRequest`, existing scheduler behavior sets `editing`; keep that behavior.

- [ ] **Step 7: Update source UI before execution projection**

Replace snapshot-first handling with page-state-first handling:

```ts
const applyPageState = (
  state: LeetCodePageState,
  options: { schedule?: boolean } = {}
): void => {
  if (disposed) return;

  currentPageState = state;

  if (state.code !== null) {
    source.value = state.code;
  }

  if (state.testcase === null) {
    testcase.value = "";
    testcase.placeholder = "Waiting for testcase…";
    caseSelector.replaceChildren();
    caseSelector.disabled = true;
    scheduler.invalidate();
    renderLiveStatus();
    return;
  }

  testcase.placeholder = "";
  testcase.value = state.testcase;
  refreshCaseSelector(state.code ?? "", state.testcase);

  const snapshot = toRunnableSnapshot(state);
  if (snapshot === null) {
    scheduler.invalidate();
    renderLiveStatus();
    return;
  }

  if (options.schedule !== false) {
    scheduleSnapshot(snapshot);
  }
  renderLiveStatus();
};
```

`source.value` rule is intentional:

- `code === ""` clears the textarea because it is observed truth.
- `code === null` does not fabricate a new code value; keep the last visible source text while status shows syncing until editor state is observed again.

`testcase === null` must clear the current testcase UI so no stale value appears actionable.

- [ ] **Step 8: Make non-runnable source revisions stale without clearing the last rendered visualization**

Call `scheduler.invalidate()` whenever the latest page state cannot produce a runnable snapshot candidate. `invalidate()` must not dispose `activeVisualizer`.

Do not call `result.replaceChildren(placeholder)` for editing/waiting states.

This makes a running older revision stale while preserving any trace that was already rendered.

- [ ] **Step 9: Preserve selected-case and scheduler behavior for complete states**

Refactor current `scheduleCurrent()` so it consumes a complete snapshot or a projected page state but still passes exactly:

```ts
{
  language: snapshot.language,
  sourceCode: snapshot.code,
  rawTestcase: snapshot.testcase,
  selectedCaseIndex
}
```

into `LiveExecutionScheduler.schedule()`.

When testcase content changes and contains multiple cases, call existing `refreshCaseSelector()` before scheduling.

- [ ] **Step 10: Run Side Panel and scheduler regressions**

```bash
npm test -- tests/sidepanel/bootstrap.test.ts tests/execution/live-execution-scheduler.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit readiness decoupling**

```bash
git add src/sidepanel/bootstrap.ts tests/sidepanel/bootstrap.test.ts tests/execution/live-execution-scheduler.test.ts
git commit -m "feat: mirror leetcode code before execution readiness"
```

---

### Task 6: Make `Run now` Refresh Page State Without Reusing Stale Testcases

**Files:**
- Modify: `src/sidepanel/bootstrap.ts`
- Test: `tests/sidepanel/bootstrap.test.ts`

**Interfaces:**
- Consumes: `ActiveTabSource.refresh(): Promise<ActiveTabPageState | null>` and `applyPageState()` from Task 5.
- Produces: `Run now = exact-owner refresh + source mirror + immediate execution only if latest state is runnable`.

- [ ] **Step 1: Replace the old complete-snapshot Run-now test with page-state semantics**

Keep the existing complete-state test, but update its fixture shape to:

```ts
source.refresh.mockResolvedValue({
  tabId: 11,
  state: pageState({ testcase: "8" })
});
```

Assert immediate execution still uses testcase `8`.

- [ ] **Step 2: Add the stale-testcase prevention test**

```ts
it("Run now refreshes code but does not execute when the latest owned state has no testcase", async () => {
  const root = document.createElement("main");
  const source = fakeActiveTabSourceFactory();
  const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));
  const handle = renderSidePanel(root, {
    controller: { execute },
    activeTabSourceFactory: source.factory,
    liveDebounceMs: 0
  });

  source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
  source.callbacks().onPageState({
    tabId: 11,
    state: pageState({ testcase: "7" })
  });
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

  source.refresh.mockResolvedValue({
    tabId: 11,
    state: pageState({
      code: "class Solution:\n    def one(self, value):\n        return value + 2\n",
      testcase: null
    })
  });

  root.querySelector<HTMLButtonElement>("#run")?.click();

  await vi.waitFor(() => expect(source.refresh).toHaveBeenCalledTimes(1));
  expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.value)
    .toContain("return value + 2");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(root.querySelector("#runtime-status")?.textContent)
    .toBe("Live: code synced · waiting for testcase");

  handle.dispose();
});
```

- [ ] **Step 3: Run the focused tests and verify the stale-testcase test fails if old Run-now logic remains**

```bash
npm test -- tests/sidepanel/bootstrap.test.ts
```

Expected before implementation: FAIL because current Run-now logic assumes refresh returns a complete runnable snapshot.

- [ ] **Step 4: Implement Run-now page-state refresh**

Use:

```ts
const latest = await activeTabSource.refresh();
if (!latest || disposed) return;
applyPageState(latest.state, { schedule: false });

const snapshot = toRunnableSnapshot(latest.state);
if (snapshot === null) {
  scheduler.invalidate();
  renderLiveStatus();
  return;
}

scheduleSnapshot(snapshot, { immediate: true, force: true });
```

Preserve the existing `ownershipGeneration` error suppression around the refresh call. A refresh that changes owner or pauses must not overwrite the new status with an old error.

- [ ] **Step 5: Run Run-now, paused, and stale-error regressions**

```bash
npm test -- tests/sidepanel/bootstrap.test.ts tests/sidepanel/active-tab-source.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Run-now semantics**

```bash
git add src/sidepanel/bootstrap.ts tests/sidepanel/bootstrap.test.ts
git commit -m "fix: refresh live page state on run now"
```

---

### Task 7: Remove the Temporary Snapshot Transport and Update Product Documentation

**Files:**
- Modify: `src/content/leetcode-adapter.ts`
- Modify: `src/content/content-script.ts`
- Modify: `src/page-bridge/leetcode-main-world.ts`
- Modify: `src/sidepanel/active-tab-source.ts` if any legacy names remain
- Modify: `tests/execution/leetcode-adapter.test.ts`
- Modify: `tests/execution/content-script.test.ts`
- Modify: `tests/sidepanel/active-tab-source.test.ts`
- Modify: `README.md`
- Modify: `README.zh-TW.md`

**Interfaces:**
- Consumes: completed page-state pipeline from Tasks 1–6.
- Produces: one canonical source protocol only:

```ts
MAIN world:
request_page_state
response_page_state
page_state_updated

content/runtime:
request_leetcode_page_state
leetcode_page_state_updated
```

`LeetCodeSnapshot` remains as an internal complete execution-input type used by `toRunnableSnapshot()`. It is no longer a page/content transport protocol.

- [ ] **Step 1: Add a source search assertion to the cleanup checklist**

Before cleanup run:

```bash
grep -R "requestSnapshot\|responseSnapshot\|snapshotUpdated\|request_leetcode_snapshot\|leetcode_snapshot_updated" src tests
```

Expected before cleanup: matches in the temporary compatibility path.

- [ ] **Step 2: Delete legacy MAIN-world snapshot message constants and handlers**

Final `LEETCODE_MESSAGE_TYPES` should be:

```ts
export const LEETCODE_MESSAGE_TYPES = {
  requestPageState: "request_page_state",
  responsePageState: "response_page_state",
  pageStateUpdated: "page_state_updated"
} as const;
```

Remove legacy snapshot request/response handling and dual publishing from `installMainWorldBridge()`.

The polling loop must publish exactly one changed page-state message per changed state.

- [ ] **Step 3: Delete legacy content-runtime snapshot constants and handlers**

Final content constants:

```ts
export const LEETCODE_CONTENT_MESSAGE_TYPES = {
  requestPageState: "request_leetcode_page_state",
  pageStateUpdated: "leetcode_page_state_updated"
} as const;
```

Remove `createSnapshotMessageHandler`, snapshot update forwarding, and any temporary `getSnapshot()` adapter compatibility method that exists only for transport.

Keep `LeetCodeSnapshot`, `validateSnapshot()`, and `toRunnableSnapshot()` only if they are still used in the execution-side projection path.

- [ ] **Step 4: Update tests to assert only the page-state protocol**

Delete tests whose only purpose is legacy page-transport compatibility. Preserve complete-snapshot tests that exercise `toRunnableSnapshot()` or execution request behavior.

Run:

```bash
npm test -- tests/execution/leetcode-adapter.test.ts tests/execution/content-script.test.ts tests/sidepanel/active-tab-source.test.ts
```

Expected: PASS.

- [ ] **Step 5: Verify no legacy transport names remain**

Run:

```bash
grep -R "requestSnapshot\|responseSnapshot\|snapshotUpdated\|request_leetcode_snapshot\|leetcode_snapshot_updated" src tests
```

Expected: no output.

Do not replace this with a vague manual inspection; the zero-match grep is the acceptance check for migration cleanup.

- [ ] **Step 6: Update README behavior**

In `README.md`, change the Live Visualization description so it explicitly states:

```text
The Side Panel mirrors the active LeetCode editor while you type; pressing
LeetCode Run or Submit is not required to start source synchronization.
If the current testcase is already available, the latest runnable Python draft
is re-executed automatically after the live debounce. If testcase state is not
yet available, code continues to sync and execution waits without clearing the
last runnable visualization.
```

In `README.zh-TW.md`, add the equivalent:

```text
Side Panel 會在你輸入時持續同步目前 active LeetCode editor 的程式碼；
不需要先按 LeetCode Run 或 Submit 才開始取得 source code。
若目前 testcase 已可取得，最新可執行的 Python draft 會在 debounce 後自動重新執行；
若 testcase 尚不可取得，code 仍持續同步，execution 進入等待狀態並保留上一份可執行 visualization。
```

Do not claim that testcase is guaranteed to be available on every LeetCode layout before Run; the spec only guarantees code sync and automatic execution whenever canonical testcase editor state is available.

- [ ] **Step 7: Run the complete verification suite**

Run exactly:

```bash
npm test
npm run typecheck
npm run build
```

Expected:

```text
all Vitest tests PASS
tsc --noEmit exits 0
all three Vite builds exit 0
```

- [ ] **Step 8: Commit protocol cleanup and docs**

```bash
git add src/content/leetcode-adapter.ts src/content/content-script.ts src/page-bridge/leetcode-main-world.ts src/sidepanel/active-tab-source.ts tests/execution/leetcode-adapter.test.ts tests/execution/content-script.test.ts tests/sidepanel/active-tab-source.test.ts README.md README.zh-TW.md
git commit -m "docs: finalize pre-run live editor workflow"
```

---

## Final Manual Acceptance

After automated verification, load the rebuilt `dist/` as the unpacked extension and perform this exact smoke test on LeetCode:

1. Open a problem page such as Two Sum with the Side Panel already open.
2. Do **not** press LeetCode Run or Submit.
3. Type a visible code change in the Monaco editor.
4. Confirm `#source-code` mirrors the new code within approximately the existing polling interval plus message delivery.
5. Continue typing until the Python draft is temporarily syntax-incomplete; confirm the newest code remains visible and the last rendered visualization is not cleared.
6. If the testcase editor is available, finish the code into a runnable draft and confirm visualization updates automatically without Run / Submit.
7. If the testcase editor is not yet available, confirm status is `Live: code synced · waiting for testcase` and no stale testcase execution occurs.
8. Make testcase state available/edit it without changing code; confirm the latest code is executed automatically.
9. Switch to another LeetCode tab; confirm the Side Panel mirrors that exact tab and no background-tab update replaces it.
10. Switch to a non-LeetCode tab; confirm `Live: paused · No active LeetCode tab` and the last visualization remains visible.
11. Switch back to LeetCode; confirm exact-tab page-state synchronization resumes without requiring an editor edit.
12. Press `Run now` when testcase is unavailable; confirm it refreshes source code but does not execute using a testcase from an older state.

The feature is complete only when both the automated suite and this pre-Run smoke test pass.

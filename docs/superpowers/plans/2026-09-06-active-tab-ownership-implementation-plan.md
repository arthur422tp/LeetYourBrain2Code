# Active Tab Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Chrome Side Panel follow exactly the active LeetCode tab in its own Chrome window, ignore background-tab snapshots, preserve the previous visualization while paused on non-LeetCode tabs, and suppress stale snapshot/execution results during tab changes.

**Architecture:** Add a Side Panel-owned `ActiveTabSource` that centralizes Chrome tab identity, current-window ownership, exact-tab snapshot fetching, runtime sender filtering, navigation/reload handling, and active-tab epoch suppression. Keep tab concepts out of `LiveExecutionScheduler`; extend it only with `invalidate()` so ownership changes can make old running/pending work stale without killing the warmed Pyodide Worker.

**Tech Stack:** TypeScript 5.8, Chrome Manifest V3, Chrome Tabs/Runtime/Scripting APIs, Vite 6, Vitest 3, vanilla DOM Side Panel, existing LiveExecutionScheduler and persistent Pyodide Worker.

**Spec:** `docs/superpowers/specs/2026-09-06-active-tab-ownership-design.md`

## Global Constraints

- The canonical source is the active LeetCode tab in the Side Panel's own Chrome window.
- Background LeetCode tabs must never update the current snapshot or visualization.
- `chrome.tabs.onActivated` must fetch from the exact activated `tabId`; do not re-query the active tab for that fetch.
- Same-tab navigation/reload must refresh the canonical snapshot.
- Async snapshot results/errors from an old tab or old active-tab epoch must be ignored.
- Ownership transitions must invalidate old scheduler relevance but must not terminate a normally healthy warmed Pyodide Worker.
- Paused behavior is exactly `Live: paused · No active LeetCode tab` and must preserve the last rendered visualization.
- `paused` remains an ownership/UI state; do not add it to `LiveExecutionScheduler.LiveStatus`.
- Do not add a background service worker.
- Do not add the Chrome `tabs` permission; retain the existing `https://leetcode.com/*` host permission.
- Do not put `tabId`, active-tab epoch, or live revision metadata into `ExecutionRequest`, `TraceEvent`, or the worker protocol.
- Keep the existing ~300 ms MAIN-world snapshot polling unchanged.
- Existing same-tab Live Visualization, selected testcase behavior, `Run now`, trace inspection, warmed Worker reuse, timeout recovery, and last-runnable behavior must remain intact.

---

## File Structure

```text
src/
├── execution/
│   └── live-execution-scheduler.ts          # modify: add invalidate()
└── sidepanel/
    ├── active-tab-source.ts                 # create: all Chrome tab ownership logic
    ├── bootstrap.ts                         # modify: consume ActiveTabSource callbacks
    └── styles.css                           # modify: paused status color only

tests/
├── execution/
│   └── live-execution-scheduler.test.ts     # modify: invalidation regression
└── sidepanel/
    ├── active-tab-source.test.ts            # create: tab/window/race/navigation tests
    └── bootstrap.test.ts                    # modify: ownership integration tests

README.md                                    # modify: multi-tab/paused behavior
README.zh-TW.md                              # modify: multi-tab/paused behavior
public/manifest.json                         # verify unchanged permissions
```

`active-tab-source.ts` is the only module that should understand `tabs.onActivated`, `tabs.onUpdated`, `sender.tab.id`, `windowId`, exact-tab reinjection, or active-tab epoch. `bootstrap.ts` should only react to ownership/snapshot/error callbacks and feed accepted snapshots into the existing scheduler.

---

### Task 1: Add Scheduler Ownership Invalidation

**Files:**
- Modify: `src/execution/live-execution-scheduler.ts`
- Modify: `tests/execution/live-execution-scheduler.test.ts`

**Interfaces:**
- Existing:

```ts
schedule(input: LiveExecutionInput, options?: LiveScheduleOptions): number;
dispose(): void;
```

- Add:

```ts
invalidate(): number;
```

`invalidate()` increments scheduler revision, clears debounce/pending work, marks the current running result stale, clears duplicate-input suppression so an identical snapshot from a newly-owned tab may execute, and emits no `LiveStatus` by itself.

- [ ] **Step 1: Write the running-result invalidation test**

Append to `tests/execution/live-execution-scheduler.test.ts`:

```ts
it("invalidates a running result without emitting a replacement status", async () => {
  const running = deferred<TraceSession>();
  let captured!: ExecutionRequest;
  const rendered: TraceSession[] = [];
  const statuses: LiveStatus[] = [];
  const scheduler = new LiveExecutionScheduler({
    runner: {
      execute: (request) => {
        captured = request;
        return running.promise;
      }
    },
    createSessionId: () => "running-before-tab-switch",
    debounceMs: 0,
    onStatusChange: (status) => statuses.push(status),
    onSession: (session) => rendered.push(session)
  });

  scheduler.schedule(input());
  await vi.runAllTimersAsync();
  const statusCountBeforeInvalidate = statuses.length;

  const invalidationRevision = scheduler.invalidate();
  expect(invalidationRevision).toBeGreaterThan(0);
  expect(statuses).toHaveLength(statusCountBeforeInvalidate);

  running.resolve(makeSession(captured));
  await Promise.resolve();
  await Promise.resolve();

  expect(rendered).toEqual([]);
});
```

- [ ] **Step 2: Write the pending/debounce clearing test**

```ts
it("clears debounced and pending work on invalidation", async () => {
  const first = deferred<TraceSession>();
  const requests: ExecutionRequest[] = [];
  const scheduler = new LiveExecutionScheduler({
    runner: {
      execute: (request) => {
        requests.push(request);
        return requests.length === 1
          ? first.promise
          : Promise.resolve(makeSession(request));
      }
    },
    createSessionId: () => `invalidate-${requests.length + 1}`,
    debounceMs: 25
  });

  scheduler.schedule(input({ rawTestcase: "1" }));
  await vi.advanceTimersByTimeAsync(25);
  expect(requests).toHaveLength(1);

  scheduler.schedule(input({ rawTestcase: "2" }));
  await vi.advanceTimersByTimeAsync(25);
  scheduler.schedule(input({ rawTestcase: "3" }));
  scheduler.invalidate();
  await vi.advanceTimersByTimeAsync(25);

  first.resolve(makeSession(requests[0]!));
  await Promise.resolve();
  await Promise.resolve();

  expect(requests.map((request) => request.rawTestcase)).toEqual(["1"]);
});
```

- [ ] **Step 3: Write the identical-input-after-ownership-change test**

```ts
it("allows the same execution input after ownership invalidation", async () => {
  const execute = vi.fn(async (request: ExecutionRequest) => makeSession(request));
  let id = 0;
  const scheduler = new LiveExecutionScheduler({
    runner: { execute },
    createSessionId: () => `same-input-${++id}`,
    debounceMs: 0
  });

  scheduler.schedule(input());
  await vi.runAllTimersAsync();
  scheduler.schedule(input());
  await vi.runAllTimersAsync();
  expect(execute).toHaveBeenCalledTimes(1);

  scheduler.invalidate();
  scheduler.schedule(input());
  await vi.runAllTimersAsync();
  expect(execute).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 4: Run the focused scheduler tests and verify failure**

```bash
npm test -- live-execution-scheduler
```

Expected: FAIL because `invalidate()` does not exist.

- [ ] **Step 5: Implement `invalidate()`**

Add before `dispose()` in `LiveExecutionScheduler`:

```ts
public invalidate(): number {
  if (this.disposed) {
    return this.latestRevision;
  }

  const revision = ++this.revision;
  this.latestRevision = revision;
  this.latestRunnableRevision = revision;
  this.latestInputKey = null;
  this.clearTimer();
  this.pending = null;
  return revision;
}
```

Do not change `LiveStatus`.

- [ ] **Step 6: Verify Task 1**

```bash
npm test -- live-execution-scheduler
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/execution/live-execution-scheduler.ts \
  tests/execution/live-execution-scheduler.test.ts
git commit -m "feat: invalidate stale live executions"
```

---

### Task 2: Create `ActiveTabSource` Core Ownership and Exact-Tab Snapshot Flow

**Files:**
- Create: `src/sidepanel/active-tab-source.ts`
- Create: `tests/sidepanel/active-tab-source.test.ts`

**Interfaces:**

```ts
export interface ActiveTabSnapshot {
  tabId: number;
  snapshot: LeetCodeSnapshot;
}

export type ActiveTabState =
  | { kind: "leetcode"; tabId: number }
  | { kind: "paused" };

export interface ActiveTabSourceOptions {
  onOwnershipInvalidated(): void;
  onStateChange(state: ActiveTabState): void;
  onSnapshot(value: ActiveTabSnapshot): void;
  onError(error: Error): void;
}

export interface ActiveTabSource {
  start(): Promise<void>;
  refresh(): Promise<ActiveTabSnapshot | null>;
  dispose(): void;
}

export function createActiveTabSource(
  options: ActiveTabSourceOptions,
  chromeApi?: Pick<typeof chrome, "runtime" | "tabs" | "scripting">
): ActiveTabSource;
```

`onOwnershipInvalidated()` is intentionally separate from `onStateChange()`: tab activation/navigation must make old scheduler work stale immediately, before an asynchronous `tabs.get()` or snapshot fetch resolves, without falsely showing `paused` during a LeetCode→LeetCode transition.

`refresh()` preserves the existing `Run now` semantics: it fetches the canonical snapshot from the currently-owned exact tab and returns it only if the `(tabId, epoch)` is still current. It does not emit `onSnapshot()` itself; normal tab/runtime flows use internal refresh-and-emit behavior.

Internal state must include:

```ts
let currentWindowId: number | null = null;
let currentActiveTabId: number | null = null;
let activeLeetCodeTabId: number | null = null;
let activeTabEpoch = 0;
let started = false;
let disposed = false;
```

`currentActiveTabId` is required even while paused so same-tab navigation from a non-LeetCode page back to LeetCode can be detected by `tabs.onUpdated`.

- [ ] **Step 1: Create reusable fake Chrome events for the tests**

Start `tests/sidepanel/active-tab-source.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

import type { LeetCodeSnapshot } from "../../src/content/leetcode-adapter";
import {
  createActiveTabSource,
  type ActiveTabSnapshot,
  type ActiveTabState
} from "../../src/sidepanel/active-tab-source";

class FakeEvent<T extends (...args: any[]) => void> {
  readonly listeners = new Set<T>();

  addListener = (listener: T): void => {
    this.listeners.add(listener);
  };

  removeListener = (listener: T): void => {
    this.listeners.delete(listener);
  };

  emit(...args: Parameters<T>): void {
    for (const listener of [...this.listeners]) {
      listener(...args);
    }
  }
}

function snapshot(slug: string): LeetCodeSnapshot {
  return {
    code: `class Solution:\n    def ${slug}(self, value):\n        return value\n`,
    language: "python",
    testcase: "7",
    metadata: { slug, title: slug }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}
```

Create a fake Chrome builder that uses callbacks like the current production code:

```ts
function fakeChrome(initialTab: chrome.tabs.Tab) {
  const onActivated = new FakeEvent<(info: chrome.tabs.TabActiveInfo) => void>();
  const onUpdated = new FakeEvent<(
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab
  ) => void>();
  const onMessage = new FakeEvent<(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => void>();

  const tabs = new Map<number, chrome.tabs.Tab>([[initialTab.id!, initialTab]]);
  const responses = new Map<number, LeetCodeSnapshot>();

  const api = {
    runtime: {
      lastError: undefined,
      onMessage
    },
    tabs: {
      query: vi.fn((_query, callback) => callback([initialTab])),
      get: vi.fn((tabId: number, callback: (tab: chrome.tabs.Tab) => void) => {
        callback(tabs.get(tabId)!);
      }),
      sendMessage: vi.fn((tabId: number, _message: unknown, callback: (response: unknown) => void) => {
        callback({ ok: true, snapshot: responses.get(tabId) });
      }),
      onActivated,
      onUpdated
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue([])
    }
  } as unknown as Pick<typeof chrome, "runtime" | "tabs" | "scripting">;

  return { api, tabs, responses, onActivated, onUpdated, onMessage };
}
```

- [ ] **Step 2: Write the initial exact-tab ownership test**

```ts
it("owns and fetches the initial active LeetCode tab", async () => {
  const tab = {
    id: 11,
    windowId: 7,
    active: true,
    index: 0,
    pinned: false,
    highlighted: true,
    incognito: false,
    url: "https://leetcode.com/problems/two-sum/"
  } as chrome.tabs.Tab;
  const chromeFake = fakeChrome(tab);
  chromeFake.responses.set(11, snapshot("twoSum"));
  const states: ActiveTabState[] = [];
  const snapshots: ActiveTabSnapshot[] = [];

  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: (state) => states.push(state),
    onSnapshot: (value) => snapshots.push(value),
    onError: vi.fn()
  }, chromeFake.api);

  await source.start();

  expect(states).toEqual([{ kind: "leetcode", tabId: 11 }]);
  expect(snapshots).toEqual([{ tabId: 11, snapshot: snapshot("twoSum") }]);
  expect(chromeFake.api.tabs.sendMessage).toHaveBeenCalledWith(
    11,
    { type: "request_leetcode_snapshot" },
    expect.any(Function)
  );
});
```

- [ ] **Step 3: Write the LeetCode→LeetCode activation test**

```ts
it("invalidates immediately and fetches the exact newly activated LeetCode tab", async () => {
  const first = {
    id: 11, windowId: 7, active: true, index: 0, pinned: false,
    highlighted: true, incognito: false,
    url: "https://leetcode.com/problems/binary-search/"
  } as chrome.tabs.Tab;
  const second = {
    ...first,
    id: 22,
    index: 1,
    url: "https://leetcode.com/problems/two-sum/"
  } as chrome.tabs.Tab;
  const chromeFake = fakeChrome(first);
  chromeFake.tabs.set(22, second);
  chromeFake.responses.set(11, snapshot("search"));
  chromeFake.responses.set(22, snapshot("twoSum"));
  const invalidated = vi.fn();
  const snapshots: ActiveTabSnapshot[] = [];

  const source = createActiveTabSource({
    onOwnershipInvalidated: invalidated,
    onStateChange: vi.fn(),
    onSnapshot: (value) => snapshots.push(value),
    onError: vi.fn()
  }, chromeFake.api);
  await source.start();
  snapshots.length = 0;

  chromeFake.onActivated.emit({ tabId: 22, windowId: 7 });
  await vi.waitFor(() => expect(snapshots).toHaveLength(1));

  expect(invalidated).toHaveBeenCalledTimes(1);
  expect(snapshots[0]).toEqual({ tabId: 22, snapshot: snapshot("twoSum") });
  expect(chromeFake.api.tabs.sendMessage).toHaveBeenLastCalledWith(
    22,
    { type: "request_leetcode_snapshot" },
    expect.any(Function)
  );
});
```

- [ ] **Step 4: Write background/active runtime sender filtering tests**

```ts
it("accepts runtime snapshots only from the active owned tab", async () => {
  const tab = {
    id: 11, windowId: 7, active: true, index: 0, pinned: false,
    highlighted: true, incognito: false,
    url: "https://leetcode.com/problems/two-sum/"
  } as chrome.tabs.Tab;
  const chromeFake = fakeChrome(tab);
  chromeFake.responses.set(11, snapshot("initial"));
  const snapshots: ActiveTabSnapshot[] = [];
  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: vi.fn(),
    onSnapshot: (value) => snapshots.push(value),
    onError: vi.fn()
  }, chromeFake.api);
  await source.start();
  snapshots.length = 0;

  chromeFake.onMessage.emit(
    { type: "leetcode_snapshot_updated", snapshot: snapshot("background") },
    { tab: { id: 99, windowId: 7 } as chrome.tabs.Tab },
    vi.fn()
  );
  chromeFake.onMessage.emit(
    { type: "leetcode_snapshot_updated", snapshot: snapshot("active") },
    { tab: { id: 11, windowId: 7 } as chrome.tabs.Tab },
    vi.fn()
  );

  expect(snapshots).toEqual([{ tabId: 11, snapshot: snapshot("active") }]);
});
```

- [ ] **Step 5: Write stale async fetch suppression test**

For this test, replace the fake `sendMessage` implementation with deferred callbacks:

```ts
it("ignores a slow snapshot from a previously active tab", async () => {
  const first = {
    id: 11, windowId: 7, active: true, index: 0, pinned: false,
    highlighted: true, incognito: false,
    url: "https://leetcode.com/problems/binary-search/"
  } as chrome.tabs.Tab;
  const second = { ...first, id: 22, index: 1, url: "https://leetcode.com/problems/two-sum/" };
  const chromeFake = fakeChrome(first);
  chromeFake.tabs.set(22, second as chrome.tabs.Tab);

  const callbacks = new Map<number, (response: unknown) => void>();
  (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
    .mockImplementation((tabId: number, _message: unknown, callback: (response: unknown) => void) => {
      callbacks.set(tabId, callback);
    });

  const emitted: ActiveTabSnapshot[] = [];
  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: vi.fn(),
    onSnapshot: (value) => emitted.push(value),
    onError: vi.fn()
  }, chromeFake.api);

  const starting = source.start();
  await vi.waitFor(() => expect(callbacks.has(11)).toBe(true));

  chromeFake.onActivated.emit({ tabId: 22, windowId: 7 });
  await vi.waitFor(() => expect(callbacks.has(22)).toBe(true));
  callbacks.get(22)!({ ok: true, snapshot: snapshot("twoSum") });
  await vi.waitFor(() => expect(emitted).toHaveLength(1));

  callbacks.get(11)!({ ok: true, snapshot: snapshot("search") });
  await starting;
  await Promise.resolve();

  expect(emitted).toEqual([{ tabId: 22, snapshot: snapshot("twoSum") }]);
});
```

- [ ] **Step 6: Write paused/current-window tests**

```ts
it("pauses for a non-LeetCode active tab and ignores activations in another window", async () => {
  const leetcode = {
    id: 11, windowId: 7, active: true, index: 0, pinned: false,
    highlighted: true, incognito: false,
    url: "https://leetcode.com/problems/two-sum/"
  } as chrome.tabs.Tab;
  const nonLeetCode = { ...leetcode, id: 33, url: undefined };
  const otherWindow = { ...leetcode, id: 44, windowId: 9 };
  const chromeFake = fakeChrome(leetcode);
  chromeFake.tabs.set(33, nonLeetCode as chrome.tabs.Tab);
  chromeFake.tabs.set(44, otherWindow as chrome.tabs.Tab);
  chromeFake.responses.set(11, snapshot("twoSum"));
  const states: ActiveTabState[] = [];
  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: (state) => states.push(state),
    onSnapshot: vi.fn(),
    onError: vi.fn()
  }, chromeFake.api);
  await source.start();

  chromeFake.onActivated.emit({ tabId: 44, windowId: 9 });
  await Promise.resolve();
  expect(states.at(-1)).toEqual({ kind: "leetcode", tabId: 11 });

  chromeFake.onActivated.emit({ tabId: 33, windowId: 7 });
  await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: "paused" }));
});
```

- [ ] **Step 7: Run the new tests and verify failure**

```bash
npm test -- active-tab-source
```

Expected: FAIL because `src/sidepanel/active-tab-source.ts` does not exist.

- [ ] **Step 8: Implement the core ActiveTabSource helpers**

Create `src/sidepanel/active-tab-source.ts` beginning with:

```ts
import {
  LEETCODE_CONTENT_MESSAGE_TYPES,
  validateSnapshot,
  type LeetCodeSnapshot
} from "../content/leetcode-adapter";

export interface ActiveTabSnapshot {
  tabId: number;
  snapshot: LeetCodeSnapshot;
}

export type ActiveTabState =
  | { kind: "leetcode"; tabId: number }
  | { kind: "paused" };

export interface ActiveTabSourceOptions {
  onOwnershipInvalidated(): void;
  onStateChange(state: ActiveTabState): void;
  onSnapshot(value: ActiveTabSnapshot): void;
  onError(error: Error): void;
}

export interface ActiveTabSource {
  start(): Promise<void>;
  refresh(): Promise<ActiveTabSnapshot | null>;
  dispose(): void;
}

type ChromeApi = Pick<typeof chrome, "runtime" | "tabs" | "scripting">;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingReceiverError(error: unknown): boolean {
  const message = errorText(error);
  return message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection");
}

function isLeetCodeUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === "https://leetcode.com";
  } catch {
    return false;
  }
}
```

Add callback-to-Promise wrappers:

```ts
function queryCurrentActiveTab(api: ChromeApi): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve, reject) => {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const runtimeError = api.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(tabs[0] ?? null);
    });
  });
}

function getTab(api: ChromeApi, tabId: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    api.tabs.get(tabId, (tab) => {
      const runtimeError = api.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function requestSnapshotOnce(api: ChromeApi, tabId: number): Promise<LeetCodeSnapshot> {
  return new Promise((resolve, reject) => {
    api.tabs.sendMessage(
      tabId,
      { type: LEETCODE_CONTENT_MESSAGE_TYPES.requestSnapshot },
      (response: unknown) => {
        const runtimeError = api.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (
          typeof response !== "object" ||
          response === null ||
          !("ok" in response) ||
          response.ok !== true ||
          !("snapshot" in response) ||
          !validateSnapshot(response.snapshot)
        ) {
          reject(new Error("No valid LeetCode snapshot was returned"));
          return;
        }
        resolve(response.snapshot);
      }
    );
  });
}
```

Add exact-tab reinjection:

```ts
async function injectLeetCodeContentScripts(api: ChromeApi, tabId: number): Promise<void> {
  const target = { tabId };
  await api.scripting.executeScript({
    target,
    files: ["page-bridge/leetcode-main-world.js"],
    world: "MAIN"
  });
  await api.scripting.executeScript({
    target,
    files: ["content/leetcode-adapter.js"]
  });
}

async function requestSnapshot(
  api: ChromeApi,
  tabId: number
): Promise<LeetCodeSnapshot> {
  try {
    return await requestSnapshotOnce(api, tabId);
  } catch (error) {
    if (!isMissingReceiverError(error)) throw error;
    await injectLeetCodeContentScripts(api, tabId);
    return requestSnapshotOnce(api, tabId);
  }
}
```

- [ ] **Step 9: Implement ownership/epoch transitions**

Use a closure-based factory with the exact state listed above. The core transition must follow this shape:

```ts
export function createActiveTabSource(
  options: ActiveTabSourceOptions,
  chromeApi: ChromeApi = chrome
): ActiveTabSource {
  let currentWindowId: number | null = null;
  let currentActiveTabId: number | null = null;
  let activeLeetCodeTabId: number | null = null;
  let activeTabEpoch = 0;
  let started = false;
  let disposed = false;

  const isCurrent = (tabId: number, epoch: number): boolean =>
    !disposed &&
    activeLeetCodeTabId === tabId &&
    activeTabEpoch === epoch;

  const fetchCurrent = async (
    tabId: number,
    epoch: number
  ): Promise<ActiveTabSnapshot | null> => {
    const snapshot = await requestSnapshot(chromeApi, tabId);
    return isCurrent(tabId, epoch) ? { tabId, snapshot } : null;
  };

  const refreshAndEmit = async (tabId: number, epoch: number): Promise<void> => {
    try {
      const value = await fetchCurrent(tabId, epoch);
      if (value) options.onSnapshot(value);
    } catch (error) {
      if (isCurrent(tabId, epoch)) {
        options.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

  const applyResolvedTab = async (
    tab: chrome.tabs.Tab,
    epoch: number
  ): Promise<void> => {
    if (disposed || epoch !== activeTabEpoch || tab.id !== currentActiveTabId) return;

    if (!isLeetCodeUrl(tab.url)) {
      activeLeetCodeTabId = null;
      options.onStateChange({ kind: "paused" });
      return;
    }

    activeLeetCodeTabId = tab.id!;
    options.onStateChange({ kind: "leetcode", tabId: tab.id! });
    await refreshAndEmit(tab.id!, epoch);
  };

  const activate = async (tabId: number, windowId: number): Promise<void> => {
    if (disposed || (currentWindowId !== null && windowId !== currentWindowId)) return;
    currentActiveTabId = tabId;
    activeLeetCodeTabId = null;
    const epoch = ++activeTabEpoch;
    options.onOwnershipInvalidated();
    try {
      await applyResolvedTab(await getTab(chromeApi, tabId), epoch);
    } catch (error) {
      if (!disposed && epoch === activeTabEpoch) {
        options.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

  // listeners and returned lifecycle methods are completed in Task 3
```

For `start()`, attach listeners first, then capture an initialization epoch before querying. If an activation event increments the epoch while the initial query is outstanding, the initial query result must be ignored.

- [ ] **Step 10: Verify Task 2 core tests**

```bash
npm test -- active-tab-source
npm run typecheck
```

Expected: the core ownership/filter/race tests pass. Navigation/recovery lifecycle tests added in Task 3 may still be absent at this point.

- [ ] **Step 11: Commit**

```bash
git add src/sidepanel/active-tab-source.ts \
  tests/sidepanel/active-tab-source.test.ts
git commit -m "feat: track active leetcode tab ownership"
```

---

### Task 3: Complete Navigation, Recovery, Refresh, and Disposal Semantics

**Files:**
- Modify: `src/sidepanel/active-tab-source.ts`
- Modify: `tests/sidepanel/active-tab-source.test.ts`
- Verify: `public/manifest.json`

**Interfaces:**
- `ActiveTabSource.start()` installs listeners and resolves initial ownership.
- `ActiveTabSource.refresh()` returns the currently-owned exact-tab snapshot or `null` if paused/stale.
- `ActiveTabSource.dispose()` removes all listeners and suppresses future callbacks.

- [ ] **Step 1: Add same-tab navigation and reload tests**

```ts
it("refetches when the current active tab navigates to another LeetCode problem", async () => {
  const tab = {
    id: 11, windowId: 7, active: true, index: 0, pinned: false,
    highlighted: true, incognito: false,
    url: "https://leetcode.com/problems/two-sum/"
  } as chrome.tabs.Tab;
  const chromeFake = fakeChrome(tab);
  chromeFake.responses.set(11, snapshot("twoSum"));
  const invalidated = vi.fn();
  const emitted: ActiveTabSnapshot[] = [];
  const source = createActiveTabSource({
    onOwnershipInvalidated: invalidated,
    onStateChange: vi.fn(),
    onSnapshot: (value) => emitted.push(value),
    onError: vi.fn()
  }, chromeFake.api);
  await source.start();
  emitted.length = 0;

  const updated = {
    ...tab,
    url: "https://leetcode.com/problems/binary-search/"
  } as chrome.tabs.Tab;
  chromeFake.responses.set(11, snapshot("search"));
  chromeFake.onUpdated.emit(11, { url: updated.url }, updated);

  await vi.waitFor(() => expect(emitted).toHaveLength(1));
  expect(invalidated).toHaveBeenCalledTimes(1);
  expect(emitted[0]?.snapshot.metadata.slug).toBe("search");
});

it("refetches after the active LeetCode tab completes a reload", async () => {
  const tab = {
    id: 11, windowId: 7, active: true, index: 0, pinned: false,
    highlighted: true, incognito: false,
    url: "https://leetcode.com/problems/two-sum/"
  } as chrome.tabs.Tab;
  const chromeFake = fakeChrome(tab);
  chromeFake.responses.set(11, snapshot("beforeReload"));
  const emitted: ActiveTabSnapshot[] = [];
  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: vi.fn(),
    onSnapshot: (value) => emitted.push(value),
    onError: vi.fn()
  }, chromeFake.api);
  await source.start();
  emitted.length = 0;

  chromeFake.responses.set(11, snapshot("afterReload"));
  chromeFake.onUpdated.emit(11, { status: "complete" }, tab);

  await vi.waitFor(() => expect(emitted).toHaveLength(1));
  expect(emitted[0]?.snapshot.metadata.slug).toBe("afterReload");
});
```

- [ ] **Step 2: Add paused same-tab resume test**

```ts
it("resumes when the current non-LeetCode tab navigates to LeetCode", async () => {
  const tab = {
    id: 33, windowId: 7, active: true, index: 0, pinned: false,
    highlighted: true, incognito: false,
    url: undefined
  } as chrome.tabs.Tab;
  const chromeFake = fakeChrome(tab);
  const states: ActiveTabState[] = [];
  const emitted: ActiveTabSnapshot[] = [];
  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: (state) => states.push(state),
    onSnapshot: (value) => emitted.push(value),
    onError: vi.fn()
  }, chromeFake.api);
  await source.start();
  expect(states.at(-1)).toEqual({ kind: "paused" });

  const leetcode = {
    ...tab,
    url: "https://leetcode.com/problems/two-sum/"
  } as chrome.tabs.Tab;
  chromeFake.responses.set(33, snapshot("twoSum"));
  chromeFake.onUpdated.emit(33, { url: leetcode.url }, leetcode);

  await vi.waitFor(() => expect(emitted).toHaveLength(1));
  expect(states.at(-1)).toEqual({ kind: "leetcode", tabId: 33 });
});
```

- [ ] **Step 3: Add exact-tab missing-receiver reinjection test**

```ts
it("reinjects and retries the same exact tab after a missing receiver error", async () => {
  const tab = {
    id: 22, windowId: 7, active: true, index: 0, pinned: false,
    highlighted: true, incognito: false,
    url: "https://leetcode.com/problems/two-sum/"
  } as chrome.tabs.Tab;
  const chromeFake = fakeChrome(tab);
  let attempt = 0;
  (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
    .mockImplementation((tabId: number, _message: unknown, callback: (response: unknown) => void) => {
      attempt += 1;
      if (attempt === 1) {
        Object.defineProperty(chromeFake.api.runtime, "lastError", {
          configurable: true,
          value: { message: "Could not establish connection. Receiving end does not exist." }
        });
        callback(undefined);
        Object.defineProperty(chromeFake.api.runtime, "lastError", {
          configurable: true,
          value: undefined
        });
        return;
      }
      callback({ ok: true, snapshot: snapshot("twoSum") });
    });

  const emitted: ActiveTabSnapshot[] = [];
  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: vi.fn(),
    onSnapshot: (value) => emitted.push(value),
    onError: vi.fn()
  }, chromeFake.api);

  await source.start();

  expect(chromeFake.api.scripting.executeScript).toHaveBeenNthCalledWith(1, {
    target: { tabId: 22 },
    files: ["page-bridge/leetcode-main-world.js"],
    world: "MAIN"
  });
  expect(chromeFake.api.scripting.executeScript).toHaveBeenNthCalledWith(2, {
    target: { tabId: 22 },
    files: ["content/leetcode-adapter.js"]
  });
  expect(emitted).toEqual([{ tabId: 22, snapshot: snapshot("twoSum") }]);
});
```

- [ ] **Step 4: Add explicit `refresh()` test**

```ts
it("refresh returns the current exact-tab snapshot without emitting it", async () => {
  const tab = {
    id: 11, windowId: 7, active: true, index: 0, pinned: false,
    highlighted: true, incognito: false,
    url: "https://leetcode.com/problems/two-sum/"
  } as chrome.tabs.Tab;
  const chromeFake = fakeChrome(tab);
  chromeFake.responses.set(11, snapshot("initial"));
  const emitted: ActiveTabSnapshot[] = [];
  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: vi.fn(),
    onSnapshot: (value) => emitted.push(value),
    onError: vi.fn()
  }, chromeFake.api);
  await source.start();
  emitted.length = 0;

  chromeFake.responses.set(11, snapshot("runNow"));
  const refreshed = await source.refresh();

  expect(refreshed).toEqual({ tabId: 11, snapshot: snapshot("runNow") });
  expect(emitted).toEqual([]);
});
```

- [ ] **Step 5: Add disposal test**

```ts
it("removes tab/runtime listeners and suppresses late async callbacks after dispose", async () => {
  const tab = {
    id: 11, windowId: 7, active: true, index: 0, pinned: false,
    highlighted: true, incognito: false,
    url: "https://leetcode.com/problems/two-sum/"
  } as chrome.tabs.Tab;
  const chromeFake = fakeChrome(tab);
  const callbacks: Array<(response: unknown) => void> = [];
  (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
    .mockImplementation((_tabId: number, _message: unknown, callback: (response: unknown) => void) => {
      callbacks.push(callback);
    });
  const onSnapshot = vi.fn();
  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: vi.fn(),
    onSnapshot,
    onError: vi.fn()
  }, chromeFake.api);

  const starting = source.start();
  await vi.waitFor(() => expect(callbacks).toHaveLength(1));
  source.dispose();
  callbacks[0]!({ ok: true, snapshot: snapshot("late") });
  await starting;

  expect(onSnapshot).not.toHaveBeenCalled();
  expect(chromeFake.onActivated.listeners.size).toBe(0);
  expect(chromeFake.onUpdated.listeners.size).toBe(0);
  expect(chromeFake.onMessage.listeners.size).toBe(0);
});
```

- [ ] **Step 6: Complete listeners and lifecycle implementation**

Add runtime listener:

```ts
const onRuntimeMessage = (
  message: unknown,
  sender: chrome.runtime.MessageSender
): void => {
  if (
    disposed ||
    sender.tab?.id !== activeLeetCodeTabId ||
    typeof message !== "object" ||
    message === null ||
    !("type" in message) ||
    message.type !== LEETCODE_CONTENT_MESSAGE_TYPES.snapshotUpdated ||
    !("snapshot" in message) ||
    !validateSnapshot(message.snapshot)
  ) {
    return;
  }

  options.onSnapshot({
    tabId: activeLeetCodeTabId,
    snapshot: message.snapshot
  });
};
```

Add navigation listener. It must invalidate synchronously before evaluating/fetching the new canonical state:

```ts
const onUpdated = (
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): void => {
  if (
    disposed ||
    tabId !== currentActiveTabId ||
    (changeInfo.url === undefined && changeInfo.status !== "complete")
  ) {
    return;
  }

  activeLeetCodeTabId = null;
  const epoch = ++activeTabEpoch;
  options.onOwnershipInvalidated();
  void applyResolvedTab(tab, epoch);
};
```

Add activation listener:

```ts
const onActivated = (info: chrome.tabs.TabActiveInfo): void => {
  void activate(info.tabId, info.windowId);
};
```

Implement `start()` so listeners are attached before the initial query and a newer event wins over a slow initial query:

```ts
const start = async (): Promise<void> => {
  if (started || disposed) return;
  started = true;

  chromeApi.runtime.onMessage.addListener(onRuntimeMessage);
  chromeApi.tabs.onActivated.addListener(onActivated);
  chromeApi.tabs.onUpdated.addListener(onUpdated);

  const epoch = ++activeTabEpoch;
  try {
    const tab = await queryCurrentActiveTab(chromeApi);
    if (disposed || epoch !== activeTabEpoch) return;
    if (!tab?.id) {
      currentActiveTabId = null;
      activeLeetCodeTabId = null;
      options.onStateChange({ kind: "paused" });
      return;
    }
    currentWindowId = tab.windowId;
    currentActiveTabId = tab.id;
    await applyResolvedTab(tab, epoch);
  } catch (error) {
    if (!disposed && epoch === activeTabEpoch) {
      options.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
};
```

Implement `refresh()`:

```ts
const refresh = async (): Promise<ActiveTabSnapshot | null> => {
  if (disposed || activeLeetCodeTabId === null) return null;
  const tabId = activeLeetCodeTabId;
  const epoch = activeTabEpoch;
  return fetchCurrent(tabId, epoch);
};
```

Implement `dispose()`:

```ts
const dispose = (): void => {
  if (disposed) return;
  disposed = true;
  ++activeTabEpoch;
  chromeApi.runtime.onMessage.removeListener(onRuntimeMessage);
  chromeApi.tabs.onActivated.removeListener(onActivated);
  chromeApi.tabs.onUpdated.removeListener(onUpdated);
};
```

Return:

```ts
return { start, refresh, dispose };
```

- [ ] **Step 7: Add current-owner failure re-resolution without retry loops**

When an internal `refreshAndEmit()` request fails for the still-current `(tabId, epoch)` after missing-receiver recovery has already been attempted:

```ts
options.onError(normalizedError);
const current = await queryCurrentActiveTab(chromeApi).catch(() => null);
if (
  !disposed &&
  activeTabEpoch === epoch &&
  current?.id !== undefined &&
  current.id !== currentActiveTabId
) {
  void activate(current.id, current.windowId);
}
```

If the query returns the same current tab, do not immediately retry again; wait for the next runtime update, reload completion, explicit `Run now`, or tab event. This prevents an unavailable content script from causing an infinite recovery loop.

- [ ] **Step 8: Verify the manifest permission boundary**

Run:

```bash
grep -n '"tabs"' public/manifest.json || true
```

Expected: no `"tabs"` permission entry.

Also inspect that the existing manifest still contains:

```json
"permissions": [
  "sidePanel",
  "scripting"
],
"host_permissions": [
  "https://leetcode.com/*"
]
```

Do not modify `public/manifest.json` if it already matches.

- [ ] **Step 9: Verify Task 3**

```bash
npm test -- active-tab-source
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/sidepanel/active-tab-source.ts \
  tests/sidepanel/active-tab-source.test.ts
git diff -- public/manifest.json
git commit -m "feat: handle tab navigation and ownership recovery"
```

`public/manifest.json` should remain unstaged and unchanged.

---

### Task 4: Integrate Active Tab Ownership into the Side Panel

**Files:**
- Modify: `src/sidepanel/bootstrap.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/bootstrap.test.ts`

**Interfaces:**

Replace the old default snapshot provider/subscription dependency boundary with:

```ts
export type ActiveTabSourceFactory = (
  options: ActiveTabSourceOptions
) => ActiveTabSource;

export interface SidePanelDependencies {
  controller?: SidePanelController;
  activeTabSourceFactory?: ActiveTabSourceFactory;
  liveDebounceMs?: number;
}
```

Keep:

```ts
export interface SidePanelHandle {
  dispose(): void;
}
```

- [ ] **Step 1: Add a fake ActiveTabSource factory helper to `bootstrap.test.ts`**

```ts
import type {
  ActiveTabSource,
  ActiveTabSourceOptions,
  ActiveTabSnapshot,
  ActiveTabState
} from "../../src/sidepanel/active-tab-source";

function fakeActiveTabSourceFactory() {
  let callbacks!: ActiveTabSourceOptions;
  const refresh = vi.fn<() => Promise<ActiveTabSnapshot | null>>()
    .mockResolvedValue(null);
  const dispose = vi.fn();
  const start = vi.fn(async () => undefined);

  const factory = vi.fn((options: ActiveTabSourceOptions): ActiveTabSource => {
    callbacks = options;
    return { start, refresh, dispose };
  });

  return {
    factory,
    start,
    refresh,
    dispose,
    callbacks: () => callbacks
  };
}
```

- [ ] **Step 2: Replace the old initial provider test with active-owner initialization**

```ts
it("visualizes the canonical snapshot emitted by the active tab source", async () => {
  const root = document.createElement("main");
  const source = fakeActiveTabSourceFactory();
  const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));
  const handle = renderSidePanel(root, {
    controller: { execute },
    activeTabSourceFactory: source.factory,
    liveDebounceMs: 0
  });

  source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
  source.callbacks().onSnapshot({ tabId: 11, snapshot: snapshot() });

  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(root.querySelector("#runtime-status")?.textContent).toBe("Live: synced");
  expect(root.querySelector("#trace-viewer")).not.toBeNull();
  handle.dispose();
});
```

- [ ] **Step 3: Add LeetCode-tab switch integration test**

```ts
it("invalidates the old execution before applying a newly owned tab snapshot", async () => {
  const root = document.createElement("main");
  const source = fakeActiveTabSourceFactory();
  const first = deferred<TraceSession>();
  const requests: ExecutionRequest[] = [];
  const execute = vi.fn((request: ExecutionRequest) => {
    requests.push(request);
    return requests.length === 1
      ? first.promise
      : Promise.resolve(completedSession(request));
  });
  const handle = renderSidePanel(root, {
    controller: { execute },
    activeTabSourceFactory: source.factory,
    liveDebounceMs: 0
  });

  const binary = snapshot({
    code: "class Solution:\n    def search(self, value):\n        return value\n",
    metadata: { slug: "binary-search", title: "Binary Search" }
  });
  const twoSum = snapshot({
    code: "class Solution:\n    def twoSum(self, value):\n        return value\n",
    metadata: { slug: "two-sum", title: "Two Sum" }
  });

  source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
  source.callbacks().onSnapshot({ tabId: 11, snapshot: binary });
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

  source.callbacks().onOwnershipInvalidated();
  source.callbacks().onStateChange({ kind: "leetcode", tabId: 22 });
  source.callbacks().onSnapshot({ tabId: 22, snapshot: twoSum });

  first.resolve(completedSession(requests[0]!));
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.value).toBe(twoSum.code)
  );

  expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.value).toBe(twoSum.code);
  handle.dispose();
});
```

- [ ] **Step 4: Add paused preservation/resume test**

```ts
it("pauses on a non-LeetCode tab without clearing the last visualization and resumes later", async () => {
  const root = document.createElement("main");
  const source = fakeActiveTabSourceFactory();
  const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));
  const handle = renderSidePanel(root, {
    controller: { execute },
    activeTabSourceFactory: source.factory,
    liveDebounceMs: 0
  });

  source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
  source.callbacks().onSnapshot({ tabId: 11, snapshot: snapshot() });
  await vi.waitFor(() => expect(root.querySelector("#trace-viewer")).not.toBeNull());

  source.callbacks().onOwnershipInvalidated();
  source.callbacks().onStateChange({ kind: "paused" });
  expect(root.querySelector("#runtime-status")?.textContent)
    .toBe("Live: paused · No active LeetCode tab");
  expect(root.querySelector("#trace-viewer")).not.toBeNull();
  expect(execute).toHaveBeenCalledTimes(1);

  const resumed = snapshot({ testcase: "8" });
  source.callbacks().onOwnershipInvalidated();
  source.callbacks().onStateChange({ kind: "leetcode", tabId: 22 });
  source.callbacks().onSnapshot({ tabId: 22, snapshot: resumed });
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  expect(execute.mock.calls[1]?.[0].rawTestcase).toBe("8");
  handle.dispose();
});
```

- [ ] **Step 5: Add `Run now` canonical refresh test**

```ts
it("Run now refreshes the exact owned tab snapshot and executes it immediately", async () => {
  const root = document.createElement("main");
  const source = fakeActiveTabSourceFactory();
  const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));
  const handle = renderSidePanel(root, {
    controller: { execute },
    activeTabSourceFactory: source.factory,
    liveDebounceMs: 1_000
  });

  source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
  source.callbacks().onSnapshot({ tabId: 11, snapshot: snapshot({ testcase: "7" }) });
  source.refresh.mockResolvedValue({
    tabId: 11,
    snapshot: snapshot({ testcase: "8" })
  });

  root.querySelector<HTMLButtonElement>("#run")?.click();

  await vi.waitFor(() => expect(source.refresh).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(execute.mock.calls[0]?.[0].rawTestcase).toBe("8");
  handle.dispose();
});
```

The pre-existing debounced schedule for testcase `7` must be replaced by the forced immediate `8` run; `applySnapshot()` for `Run now` must therefore update the mirror without normal scheduling, then call `scheduleCurrent({ immediate: true, force: true })`.

- [ ] **Step 6: Add source error/disposal tests**

```ts
it("shows a current active-source error without clearing the existing visualization", async () => {
  const root = document.createElement("main");
  const source = fakeActiveTabSourceFactory();
  const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));
  const handle = renderSidePanel(root, {
    controller: { execute },
    activeTabSourceFactory: source.factory,
    liveDebounceMs: 0
  });

  source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
  source.callbacks().onSnapshot({ tabId: 11, snapshot: snapshot() });
  await vi.waitFor(() => expect(root.querySelector("#trace-viewer")).not.toBeNull());

  source.callbacks().onError(new Error("No valid LeetCode snapshot was returned"));
  expect(root.querySelector("#runtime-status")?.textContent)
    .toBe("Live: No valid LeetCode snapshot was returned");
  expect(root.querySelector("#trace-viewer")).not.toBeNull();
  handle.dispose();
});

it("disposes the active tab source scheduler visualizer and controller", () => {
  const root = document.createElement("main");
  const source = fakeActiveTabSourceFactory();
  const controllerDispose = vi.fn();
  const handle = renderSidePanel(root, {
    controller: { execute: vi.fn(), dispose: controllerDispose },
    activeTabSourceFactory: source.factory
  });

  handle.dispose();

  expect(source.dispose).toHaveBeenCalledTimes(1);
  expect(controllerDispose).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 7: Run bootstrap tests and verify they fail against the old dependency boundary**

```bash
npm test -- bootstrap
```

Expected: FAIL until `bootstrap.ts` accepts `activeTabSourceFactory` and ownership callbacks.

- [ ] **Step 8: Replace direct Chrome snapshot orchestration in `bootstrap.ts`**

Remove the Side Panel-local implementations of:

```text
queryActiveLeetCodeTab
injectLeetCodeContentScripts
requestSnapshotFromActiveLeetCodeTab
createDefaultSnapshotProvider
createDefaultSnapshotSubscription
createResilientSnapshotProvider
```

Remove `SnapshotSubscription`, `snapshotProvider`, and `snapshotSubscription` from `SidePanelDependencies`.

Import:

```ts
import {
  createActiveTabSource,
  type ActiveTabSource,
  type ActiveTabSourceOptions
} from "./active-tab-source";
```

Add:

```ts
export type ActiveTabSourceFactory = (
  options: ActiveTabSourceOptions
) => ActiveTabSource;

export interface SidePanelDependencies {
  controller?: SidePanelController;
  activeTabSourceFactory?: ActiveTabSourceFactory;
  liveDebounceMs?: number;
}
```

- [ ] **Step 9: Refactor snapshot application and ownership callbacks**

Keep:

```ts
let currentSnapshot: LeetCodeSnapshot | null = null;
let selectedCaseIndex = 0;
let activeVisualizer: TraceVisualizerHandle | null = null;
let disposed = false;
```

Refactor snapshot application so normal accepted source snapshots schedule, while `Run now` may suppress normal scheduling:

```ts
const applySnapshot = (
  snapshot: LeetCodeSnapshot,
  options: { schedule?: boolean } = {}
): void => {
  if (disposed) return;
  currentSnapshot = snapshot;
  source.value = snapshot.code;
  testcase.value = snapshot.testcase;
  refreshCaseSelector(snapshot.code, snapshot.testcase);
  if (options.schedule !== false) {
    scheduleCurrent();
  }
};
```

Construct the source after the scheduler exists:

```ts
const activeTabSourceFactory =
  dependencies.activeTabSourceFactory ??
  ((options: ActiveTabSourceOptions) => createActiveTabSource(options));

const activeTabSource = activeTabSourceFactory({
  onOwnershipInvalidated: () => {
    currentSnapshot = null;
    scheduler.invalidate();
    status.dataset.liveStatus = "updating";
    status.textContent = "Live: updating";
  },
  onStateChange: (state) => {
    if (state.kind === "paused") {
      currentSnapshot = null;
      status.dataset.liveStatus = "paused";
      status.textContent = "Live: paused · No active LeetCode tab";
      return;
    }
    status.dataset.liveStatus = "updating";
    status.textContent = "Live: updating";
  },
  onSnapshot: ({ snapshot }) => {
    applySnapshot(snapshot);
  },
  onError: (error) => {
    status.removeAttribute("data-live-status");
    status.textContent = `Live: ${errorText(error)}`;
  }
});

void activeTabSource.start().catch((error: unknown) => {
  if (!disposed) {
    status.textContent = `Live: ${errorText(error)}`;
  }
});
```

Do not clear `result` in any ownership callback.

- [ ] **Step 10: Preserve `Run now` by using `ActiveTabSource.refresh()`**

Replace the old provider-based click path with:

```ts
runButton.addEventListener("click", () => {
  const runLatest = async (): Promise<void> => {
    if (disposed) return;
    try {
      const latest = await activeTabSource.refresh();
      if (!latest || disposed) return;
      applySnapshot(latest.snapshot, { schedule: false });
      scheduleCurrent({ immediate: true, force: true });
    } catch (error: unknown) {
      if (!disposed) {
        status.textContent = `Live: ${errorText(error)}`;
      }
    }
  };
  void runLatest();
});
```

- [ ] **Step 11: Update disposal order**

Use:

```ts
return {
  dispose(): void {
    if (disposed) return;
    disposed = true;
    activeTabSource.dispose();
    scheduler.dispose();
    activeVisualizer?.dispose();
    activeVisualizer = null;
    controller.dispose?.();
  }
};
```

- [ ] **Step 12: Add paused status styling only**

Append to `src/sidepanel/styles.css`:

```css
#runtime-status[data-live-status="paused"] {
  color: #64748b;
}
```

Do not change TraceVisualizer layout or container visuals.

- [ ] **Step 13: Verify Task 4**

```bash
npm test -- bootstrap active-tab-source live-execution-scheduler
npm run typecheck
```

Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add src/sidepanel/bootstrap.ts \
  src/sidepanel/styles.css \
  tests/sidepanel/bootstrap.test.ts
git commit -m "feat: follow active leetcode tab in side panel"
```

---

### Task 5: Documentation, Full Regression, and Chrome Multi-Tab Acceptance

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`
- Verify unchanged: `public/manifest.json`

- [ ] **Step 1: Document active-tab ownership in English README**

Add near the Live Visualization description:

```md
The Side Panel follows the active LeetCode tab in its current Chrome window. Switching between already-open LeetCode problems triggers an exact-tab snapshot refresh even when the editor content did not change. Snapshot updates from background LeetCode tabs are ignored.

When the active tab is not LeetCode, Live Visualization pauses without clearing the last trace. Returning to LeetCode resumes from the newly active tab automatically.
```

Add the design/plan links:

```md
- [Active Tab Ownership Design Spec](docs/superpowers/specs/2026-09-06-active-tab-ownership-design.md)
- [Active Tab Ownership Implementation Plan](docs/superpowers/plans/2026-09-06-active-tab-ownership-implementation-plan.md)
```

- [ ] **Step 2: Document the same behavior in Traditional Chinese README**

Add:

```md
Side Panel 只會跟隨目前 Chrome window 中的 active LeetCode tab。即使另一個 LeetCode tab 已經開著且 editor 內容沒有再次變動，只要切換過去，Side Panel 就會向該 exact tab 重新取得 canonical snapshot；background LeetCode tab 的 snapshot update 會被忽略。

當 active tab 不是 LeetCode 時，Live Visualization 會顯示 `Live: paused · No active LeetCode tab`，但保留上一份 trace visualization。切回 LeetCode 後會自動從新的 active tab 恢復同步。
```

Add:

```md
- [Active Tab Ownership Design Spec](docs/superpowers/specs/2026-09-06-active-tab-ownership-design.md)
- [Active Tab Ownership Implementation Plan](docs/superpowers/plans/2026-09-06-active-tab-ownership-implementation-plan.md)
```

- [ ] **Step 3: Run full automated verification**

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected:

```text
all Vitest tests pass
tsc exits 0
all Vite builds exit 0
git diff --check produces no output
```

- [ ] **Step 4: Verify the permission boundary after build**

```bash
grep -n '"tabs"' public/manifest.json dist/manifest.json || true
```

Expected: no `"tabs"` permission entry in either manifest.

Verify both still contain only the existing extension permissions and LeetCode host permission.

- [ ] **Step 5: Perform the exact Chrome multi-tab acceptance checklist**

Build/reload `dist/`, then use:

```text
Tab A = Binary Search
Tab B = Two Sum
```

Execute:

```text
A. Open Side Panel while Tab A is active.
B. Confirm Binary Search code/testcase/visualization.
C. Switch to Tab B without editing any code.
D. Confirm Side Panel automatically changes to Two Sum and executes it.
E. Switch back to Tab A and confirm automatic restore.

F. Switch from LeetCode to GitHub / YouTube / ChatGPT.
G. Confirm status exactly: Live: paused · No active LeetCode tab.
H. Confirm the previous LeetCode visualization remains visible.
I. Switch back to Two Sum and confirm automatic resume.

J. Keep Two Sum active.
K. Modify Binary Search in the background tab.
L. Confirm the Side Panel remains on Two Sum.

M. In one active tab navigate Two Sum → Binary Search.
N. Confirm the Side Panel changes to Binary Search without reopening it.
O. Reload the active LeetCode tab.
P. Confirm the canonical snapshot refreshes after load completes.

Q. Rapidly switch A → B → A.
R. Confirm final code, testcase, status, and visualization all belong to A.
S. Confirm no slower B snapshot or B execution completion overwrites A.

T. Open another Chrome window and switch tabs there.
U. Confirm the original window's Side Panel does not change ownership.

V. Click Run now after changing code and before waiting for normal polling.
W. Confirm Run now refreshes the current exact active tab and executes that latest snapshot.
```

- [ ] **Step 6: Verify existing same-tab Live Visualization regressions manually**

On Two Sum:

```text
1. Edit runnable Python and confirm Updating → Synced automatically.
2. Leave incomplete syntax and confirm Editing while old visualization remains.
3. Complete the syntax and confirm automatic resume.
4. Switch testcase Case 1 → Case 2 and confirm automatic execution.
5. Trigger Runtime Error and confirm trace prefix remains inspectable.
6. Trigger hard timeout, fix the code, and confirm Worker recovery still works.
7. Use Previous / Next / Play on the newest trace.
```

- [ ] **Step 7: Review changed-file scope**

```bash
git diff --name-only HEAD~5..HEAD
```

The implementation should be confined to the planned files plus documentation. Confirm there is no new:

```text
background service worker
"tabs" permission
worker protocol field
TraceEvent tab/revision metadata
forced Worker termination on normal tab switch
Monaco event integration
visualizer type expansion
```

- [ ] **Step 8: Commit documentation**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: document active tab ownership"
```

- [ ] **Step 9: Final verification**

```bash
npm test
npm run typecheck
npm run build
git diff --check
git status --short
```

Expected final state:

```text
all commands exit 0
git diff --check has no output
git status --short has no uncommitted implementation changes
```

---

## Implementation Order

```text
Task 1  scheduler invalidate()
  ↓
Task 2  ActiveTabSource core ownership + sender filtering + epoch
  ↓
Task 3  navigation + exact-tab recovery + refresh + disposal
  ↓
Task 4  Side Panel integration + paused/resume + Run now
  ↓
Task 5  docs + regression + Chrome multi-tab acceptance
```

Do not integrate ActiveTabSource into `bootstrap.ts` until Task 1 scheduler invalidation and Task 2/3 ActiveTabSource tests pass independently.

## Completion Definition

LeetCode tab switching:

```text
Binary Search active
      ↓ switch tab
Two Sum active
      ↓
onOwnershipInvalidated
      ↓
old scheduler result becomes stale
      ↓
exact Two Sum tab snapshot
      ↓
LiveExecutionScheduler
      ↓
Two Sum visualization
```

Background isolation:

```text
Active = Two Sum

Two Sum snapshot_updated       → accept
Binary Search snapshot_updated → ignore
```

Paused state:

```text
LeetCode
   ↓ switch
non-LeetCode
   ↓
scheduler relevance invalidated
   ↓
Live: paused · No active LeetCode tab
   ↓
last visualization remains visible
```

Race protection:

```text
A fetch starts
   ↓ switch to B
activeTabEpoch++
   ↓
B fetch completes and renders
   ↓
late A fetch / late A execution completion
   ↓
stale → ignored
```

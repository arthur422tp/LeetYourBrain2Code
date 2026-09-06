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

```ts
schedule(input: LiveExecutionInput, options?: LiveScheduleOptions): number;
invalidate(): number;
dispose(): void;
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
  let sessionId = 0;
  const scheduler = new LiveExecutionScheduler({
    runner: {
      execute: (request) => {
        requests.push(request);
        return requests.length === 1
          ? first.promise
          : Promise.resolve(makeSession(request));
      }
    },
    createSessionId: () => `invalidate-${++sessionId}`,
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

### Task 2: Create `ActiveTabSource` Core Ownership, Filtering, and Epoch Semantics

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

`onOwnershipInvalidated()` is separate from `onStateChange()`: activation must make old scheduler work stale immediately, before asynchronous `tabs.get()`/snapshot work resolves, without briefly mislabeling a LeetCode→LeetCode switch as paused.

`refresh()` preserves `Run now`: it fetches the current exact owner and returns a snapshot only if `(tabId, epoch)` is still current. It does not emit `onSnapshot()` itself.

Internal state for Task 2:

```ts
let currentWindowId: number | null = null;
let currentActiveTabId: number | null = null;
let activeLeetCodeTabId: number | null = null;
let activeTabEpoch = 0;
let started = false;
let disposed = false;
```

- [ ] **Step 1: Create reusable fake Chrome events and data helpers**

Create `tests/sidepanel/active-tab-source.test.ts`:

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

function tab(
  id: number,
  windowId: number,
  url: string | undefined
): chrome.tabs.Tab {
  return {
    id,
    windowId,
    active: true,
    index: 0,
    pinned: false,
    highlighted: true,
    incognito: false,
    url
  } as chrome.tabs.Tab;
}
```

Create a fake Chrome builder:

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
  const chromeFake = fakeChrome(tab(
    11,
    7,
    "https://leetcode.com/problems/two-sum/"
  ));
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

- [ ] **Step 3: Write exact activated-tab and current-window tests**

```ts
it("invalidates immediately and fetches the exact newly activated LeetCode tab", async () => {
  const first = tab(11, 7, "https://leetcode.com/problems/binary-search/");
  const second = tab(22, 7, "https://leetcode.com/problems/two-sum/");
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

it("ignores tab activation from another Chrome window", async () => {
  const first = tab(11, 7, "https://leetcode.com/problems/two-sum/");
  const otherWindow = tab(44, 9, "https://leetcode.com/problems/binary-search/");
  const chromeFake = fakeChrome(first);
  chromeFake.tabs.set(44, otherWindow);
  chromeFake.responses.set(11, snapshot("twoSum"));
  const invalidated = vi.fn();
  const source = createActiveTabSource({
    onOwnershipInvalidated: invalidated,
    onStateChange: vi.fn(),
    onSnapshot: vi.fn(),
    onError: vi.fn()
  }, chromeFake.api);
  await source.start();

  chromeFake.onActivated.emit({ tabId: 44, windowId: 9 });
  await Promise.resolve();

  expect(invalidated).not.toHaveBeenCalled();
  expect(chromeFake.api.tabs.sendMessage).not.toHaveBeenCalledWith(
    44,
    expect.anything(),
    expect.any(Function)
  );
});
```

- [ ] **Step 4: Write background/active runtime sender filtering test**

```ts
it("accepts runtime snapshots only from the active owned tab", async () => {
  const chromeFake = fakeChrome(tab(
    11,
    7,
    "https://leetcode.com/problems/two-sum/"
  ));
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
    { tab: tab(99, 7, "https://leetcode.com/problems/binary-search/") },
    vi.fn()
  );
  chromeFake.onMessage.emit(
    { type: "leetcode_snapshot_updated", snapshot: snapshot("active") },
    { tab: tab(11, 7, "https://leetcode.com/problems/two-sum/") },
    vi.fn()
  );

  expect(snapshots).toEqual([{ tabId: 11, snapshot: snapshot("active") }]);
});
```

- [ ] **Step 5: Write stale snapshot and stale error suppression tests**

```ts
it("ignores a slow snapshot and error from a previously active tab", async () => {
  const first = tab(11, 7, "https://leetcode.com/problems/binary-search/");
  const second = tab(22, 7, "https://leetcode.com/problems/two-sum/");
  const chromeFake = fakeChrome(first);
  chromeFake.tabs.set(22, second);

  const callbacks = new Map<number, (response: unknown) => void>();
  (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
    .mockImplementation((tabId: number, _message: unknown, callback: (response: unknown) => void) => {
      callbacks.set(tabId, callback);
    });

  const emitted: ActiveTabSnapshot[] = [];
  const onError = vi.fn();
  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: vi.fn(),
    onSnapshot: (value) => emitted.push(value),
    onError
  }, chromeFake.api);

  const starting = source.start();
  await vi.waitFor(() => expect(callbacks.has(11)).toBe(true));

  chromeFake.onActivated.emit({ tabId: 22, windowId: 7 });
  await vi.waitFor(() => expect(callbacks.has(22)).toBe(true));
  callbacks.get(22)!({ ok: true, snapshot: snapshot("twoSum") });
  await vi.waitFor(() => expect(emitted).toHaveLength(1));

  callbacks.get(11)!({ ok: false });
  await starting;
  await Promise.resolve();

  expect(emitted).toEqual([{ tabId: 22, snapshot: snapshot("twoSum") }]);
  expect(onError).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Write paused activation test**

```ts
it("pauses when the current-window active tab is not LeetCode", async () => {
  const leetcode = tab(11, 7, "https://leetcode.com/problems/two-sum/");
  const nonLeetCode = tab(33, 7, undefined);
  const chromeFake = fakeChrome(leetcode);
  chromeFake.tabs.set(33, nonLeetCode);
  chromeFake.responses.set(11, snapshot("twoSum"));
  const states: ActiveTabState[] = [];
  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: (state) => states.push(state),
    onSnapshot: vi.fn(),
    onError: vi.fn()
  }, chromeFake.api);
  await source.start();

  chromeFake.onActivated.emit({ tabId: 33, windowId: 7 });
  await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: "paused" }));
});
```

- [ ] **Step 7: Run the new tests and verify failure**

```bash
npm test -- active-tab-source
```

Expected: FAIL because `src/sidepanel/active-tab-source.ts` does not exist.

- [ ] **Step 8: Implement exact-tab snapshot helpers**

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

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isMissingReceiverError(error: unknown): boolean {
  const message = normalizeError(error).message;
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
    api.tabs.get(tabId, (resolvedTab) => {
      const runtimeError = api.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(resolvedTab);
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

async function requestSnapshot(api: ChromeApi, tabId: number): Promise<LeetCodeSnapshot> {
  try {
    return await requestSnapshotOnce(api, tabId);
  } catch (error) {
    if (!isMissingReceiverError(error)) throw error;
    await injectLeetCodeContentScripts(api, tabId);
    return requestSnapshotOnce(api, tabId);
  }
}
```

- [ ] **Step 9: Implement a complete Task-2 lifecycle**

Use a closure-based factory. Task 2 must compile and pass independently before navigation support is added in Task 3:

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
    !disposed && activeLeetCodeTabId === tabId && activeTabEpoch === epoch;

  const fetchCurrent = async (
    tabId: number,
    epoch: number
  ): Promise<ActiveTabSnapshot | null> => {
    const currentSnapshot = await requestSnapshot(chromeApi, tabId);
    return isCurrent(tabId, epoch)
      ? { tabId, snapshot: currentSnapshot }
      : null;
  };

  const refreshAndEmit = async (tabId: number, epoch: number): Promise<void> => {
    try {
      const value = await fetchCurrent(tabId, epoch);
      if (value) options.onSnapshot(value);
    } catch (error) {
      if (isCurrent(tabId, epoch)) {
        options.onError(normalizeError(error));
      }
    }
  };

  const applyResolvedTab = async (
    resolvedTab: chrome.tabs.Tab,
    epoch: number
  ): Promise<void> => {
    if (
      disposed ||
      epoch !== activeTabEpoch ||
      resolvedTab.id === undefined ||
      resolvedTab.id !== currentActiveTabId
    ) {
      return;
    }

    if (!isLeetCodeUrl(resolvedTab.url)) {
      activeLeetCodeTabId = null;
      options.onStateChange({ kind: "paused" });
      return;
    }

    activeLeetCodeTabId = resolvedTab.id;
    options.onStateChange({ kind: "leetcode", tabId: resolvedTab.id });
    await refreshAndEmit(resolvedTab.id, epoch);
  };

  const activate = async (tabId: number, windowId: number): Promise<void> => {
    if (
      disposed ||
      currentWindowId === null ||
      windowId !== currentWindowId
    ) {
      return;
    }

    currentActiveTabId = tabId;
    activeLeetCodeTabId = null;
    const epoch = ++activeTabEpoch;
    options.onOwnershipInvalidated();

    try {
      await applyResolvedTab(await getTab(chromeApi, tabId), epoch);
    } catch (error) {
      if (!disposed && epoch === activeTabEpoch) {
        options.onError(normalizeError(error));
      }
    }
  };

  const onActivated = (info: chrome.tabs.TabActiveInfo): void => {
    void activate(info.tabId, info.windowId);
  };

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

  const attachCoreListeners = (): void => {
    chromeApi.runtime.onMessage.addListener(onRuntimeMessage);
    chromeApi.tabs.onActivated.addListener(onActivated);
  };

  const start = async (): Promise<void> => {
    if (started || disposed) return;
    started = true;

    // First query establishes which Chrome window this Side Panel belongs to.
    const initialTab = await queryCurrentActiveTab(chromeApi);
    if (disposed) return;
    if (!initialTab?.id) {
      activeTabEpoch += 1;
      options.onStateChange({ kind: "paused" });
      return;
    }

    currentWindowId = initialTab.windowId;
    attachCoreListeners();

    // Query again after listener attachment to close the activation race window.
    const epoch = ++activeTabEpoch;
    const currentTab = await queryCurrentActiveTab(chromeApi);
    if (disposed || epoch !== activeTabEpoch) return;
    if (!currentTab?.id || currentTab.windowId !== currentWindowId) {
      currentActiveTabId = null;
      activeLeetCodeTabId = null;
      options.onStateChange({ kind: "paused" });
      return;
    }

    currentActiveTabId = currentTab.id;
    await applyResolvedTab(currentTab, epoch);
  };

  const refresh = async (): Promise<ActiveTabSnapshot | null> => {
    if (disposed || activeLeetCodeTabId === null) return null;
    return fetchCurrent(activeLeetCodeTabId, activeTabEpoch);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    ++activeTabEpoch;
    chromeApi.runtime.onMessage.removeListener(onRuntimeMessage);
    chromeApi.tabs.onActivated.removeListener(onActivated);
  };

  return { start, refresh, dispose };
}
```

The two-query startup handshake is required: it establishes `currentWindowId` before accepting global `onActivated` events, then re-queries after listeners are attached so a tab switch during startup cannot be missed or attributed to another window.

- [ ] **Step 10: Verify Task 2**

```bash
npm test -- active-tab-source
npm run typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/sidepanel/active-tab-source.ts \
  tests/sidepanel/active-tab-source.test.ts
git commit -m "feat: track active leetcode tab ownership"
```

---

### Task 3: Add Same-Tab Navigation, Reload, Recovery, and Full Disposal

**Files:**
- Modify: `src/sidepanel/active-tab-source.ts`
- Modify: `tests/sidepanel/active-tab-source.test.ts`
- Verify unchanged: `public/manifest.json`

**Interfaces:**
- `start()` installs runtime, activation, and update listeners.
- `refresh()` remains exact-owner and non-emitting.
- `dispose()` removes all three listener families.

Add one internal field:

```ts
let currentTabUrl: string | undefined;
```

It prevents a LeetCode URL-change event followed by `status: "complete"` from invalidating twice. URL change invalidates once; the later completion performs only a canonical refresh at the same epoch, so the scheduler's existing duplicate-input suppression can prevent a duplicate execution.

- [ ] **Step 1: Add same-tab LeetCode navigation test**

```ts
it("invalidates once and refetches when the active tab navigates to another LeetCode problem", async () => {
  const initial = tab(11, 7, "https://leetcode.com/problems/two-sum/");
  const updated = tab(11, 7, "https://leetcode.com/problems/binary-search/");
  const chromeFake = fakeChrome(initial);
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
  invalidated.mockClear();
  emitted.length = 0;

  chromeFake.responses.set(11, snapshot("search"));
  chromeFake.onUpdated.emit(11, { url: updated.url }, updated);
  await vi.waitFor(() => expect(emitted).toHaveLength(1));
  chromeFake.onUpdated.emit(11, { status: "complete" }, updated);
  await vi.waitFor(() => expect(chromeFake.api.tabs.sendMessage).toHaveBeenCalledTimes(4));

  expect(invalidated).toHaveBeenCalledTimes(1);
  expect(emitted.at(-1)?.snapshot.metadata.slug).toBe("search");
});
```

The expected `sendMessage` count is: one initial fetch after Task-2 startup, one URL-change fetch, and one completion refresh. If the test helper's startup path changes the exact count, assert the relative increase instead:

```ts
const before = (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
// emit URL + complete
expect(chromeFake.api.tabs.sendMessage).toHaveBeenCalledTimes(before + 2);
```

Use the relative-count form in the final test to avoid coupling to startup internals.

- [ ] **Step 2: Add reload and paused same-tab resume tests**

```ts
it("refreshes after the active LeetCode tab completes a reload without a second ownership invalidation", async () => {
  const initial = tab(11, 7, "https://leetcode.com/problems/two-sum/");
  const chromeFake = fakeChrome(initial);
  chromeFake.responses.set(11, snapshot("beforeReload"));
  const invalidated = vi.fn();
  const emitted: ActiveTabSnapshot[] = [];
  const source = createActiveTabSource({
    onOwnershipInvalidated: invalidated,
    onStateChange: vi.fn(),
    onSnapshot: (value) => emitted.push(value),
    onError: vi.fn()
  }, chromeFake.api);
  await source.start();
  invalidated.mockClear();
  emitted.length = 0;

  chromeFake.responses.set(11, snapshot("afterReload"));
  chromeFake.onUpdated.emit(11, { status: "complete" }, initial);

  await vi.waitFor(() => expect(emitted).toHaveLength(1));
  expect(invalidated).not.toHaveBeenCalled();
  expect(emitted[0]?.snapshot.metadata.slug).toBe("afterReload");
});

it("resumes when the current non-LeetCode tab navigates to LeetCode", async () => {
  const initial = tab(33, 7, undefined);
  const leetcode = tab(33, 7, "https://leetcode.com/problems/two-sum/");
  const chromeFake = fakeChrome(initial);
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

  chromeFake.responses.set(33, snapshot("twoSum"));
  chromeFake.onUpdated.emit(33, { url: leetcode.url }, leetcode);

  await vi.waitFor(() => expect(emitted).toHaveLength(1));
  expect(states.at(-1)).toEqual({ kind: "leetcode", tabId: 33 });
});
```

- [ ] **Step 3: Add exact-tab missing-receiver reinjection test**

```ts
it("reinjects and retries the same exact tab after a missing receiver error", async () => {
  const initial = tab(22, 7, "https://leetcode.com/problems/two-sum/");
  const chromeFake = fakeChrome(initial);
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

  const source = createActiveTabSource({
    onOwnershipInvalidated: vi.fn(),
    onStateChange: vi.fn(),
    onSnapshot: vi.fn(),
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
});
```

- [ ] **Step 4: Add current-owner disappearance re-resolution test**

```ts
it("re-resolves the current active tab after a current-owner request failure", async () => {
  const first = tab(11, 7, "https://leetcode.com/problems/binary-search/");
  const replacement = tab(22, 7, "https://leetcode.com/problems/two-sum/");
  const chromeFake = fakeChrome(first);
  chromeFake.tabs.set(22, replacement);

  let queryCount = 0;
  (chromeFake.api.tabs.query as unknown as ReturnType<typeof vi.fn>)
    .mockImplementation((_query: unknown, callback: (tabs: chrome.tabs.Tab[]) => void) => {
      queryCount += 1;
      callback(queryCount <= 2 ? [first] : [replacement]);
    });

  (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
    .mockImplementation((tabId: number, _message: unknown, callback: (response: unknown) => void) => {
      if (tabId === 11) {
        callback({ ok: false });
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
  await vi.waitFor(() =>
    expect(emitted.at(-1)).toEqual({ tabId: 22, snapshot: snapshot("twoSum") })
  );
});
```

- [ ] **Step 5: Add explicit `refresh()` and full disposal tests**

```ts
it("refresh returns the current exact-tab snapshot without emitting it", async () => {
  const chromeFake = fakeChrome(tab(
    11,
    7,
    "https://leetcode.com/problems/two-sum/"
  ));
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

it("removes all tab/runtime listeners and suppresses late callbacks after dispose", async () => {
  const chromeFake = fakeChrome(tab(
    11,
    7,
    "https://leetcode.com/problems/two-sum/"
  ));
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

- [ ] **Step 6: Add `currentTabUrl` tracking and `onUpdated` implementation**

Set `currentTabUrl = resolvedTab.url` inside `applyResolvedTab()` after current-epoch validation.

Add:

```ts
const invalidateForUpdatedTab = (
  updatedTab: chrome.tabs.Tab
): number => {
  activeLeetCodeTabId = null;
  currentTabUrl = updatedTab.url;
  const epoch = ++activeTabEpoch;
  options.onOwnershipInvalidated();
  return epoch;
};

const onUpdated = (
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  updatedTab: chrome.tabs.Tab
): void => {
  if (disposed || tabId !== currentActiveTabId) return;

  const urlChanged =
    changeInfo.url !== undefined && changeInfo.url !== currentTabUrl;

  if (urlChanged) {
    const epoch = invalidateForUpdatedTab(updatedTab);
    void applyResolvedTab(updatedTab, epoch);
    return;
  }

  if (changeInfo.status !== "complete") return;

  if (updatedTab.url !== currentTabUrl) {
    const epoch = invalidateForUpdatedTab(updatedTab);
    void applyResolvedTab(updatedTab, epoch);
    return;
  }

  if (activeLeetCodeTabId === tabId) {
    void refreshAndEmit(tabId, activeTabEpoch);
  }
};
```

This produces exactly one invalidation for a URL change, while still performing a completion-time canonical refresh. A pure reload with the same URL refetches on completion without inventing a new ownership transition.

Register/remove the new listener:

```ts
chromeApi.tabs.onUpdated.addListener(onUpdated);
// dispose:
chromeApi.tabs.onUpdated.removeListener(onUpdated);
```

- [ ] **Step 7: Add one-shot current-owner re-resolution after a failed fetch**

Extend `refreshAndEmit()` catch handling:

```ts
if (!isCurrent(tabId, epoch)) return;
options.onError(normalizeError(error));

const active = await queryCurrentActiveTab(chromeApi).catch(() => null);
if (
  disposed ||
  epoch !== activeTabEpoch ||
  !active?.id ||
  active.windowId !== currentWindowId ||
  active.id === currentActiveTabId
) {
  return;
}

void activate(active.id, active.windowId);
```

Do not immediately retry if `queryCurrentActiveTab()` returns the same failed tab. Missing-receiver retry is already performed once inside `requestSnapshot()`; same-tab failures then wait for reload completion, runtime update, `Run now`, or a new tab event. This prevents a failed content script from creating an infinite recovery loop.

- [ ] **Step 8: Verify the manifest permission boundary**

```bash
grep -n '"tabs"' public/manifest.json || true
```

Expected: no `"tabs"` permission entry.

Verify the existing manifest still contains:

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
git commit -m "feat: handle active tab navigation and recovery"
```

`public/manifest.json` should remain unstaged and unchanged.

---

### Task 4: Integrate Active Tab Ownership into the Side Panel

**Files:**
- Modify: `src/sidepanel/bootstrap.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/bootstrap.test.ts`

**Interfaces:**

Replace the old snapshot provider/subscription dependency boundary with:

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
  ActiveTabSnapshot
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

- [ ] **Step 2: Replace old provider/subscription tests with canonical source integration**

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

- [ ] **Step 3: Add LeetCode-tab switch stale-execution integration test**

Add a local `deferred<T>()` helper if `bootstrap.test.ts` does not already contain one:

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
```

Then add:

```ts
it("prevents the old tab execution from overwriting a newly owned tab", async () => {
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
it("pauses without clearing the last visualization and resumes on the next LeetCode owner", async () => {
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

- [ ] **Step 5: Add exact-owner `Run now` test**

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

The existing debounced testcase `7` schedule must be replaced by the forced immediate testcase `8` schedule.

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

it("disposes the active tab source and persistent controller", () => {
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

- [ ] **Step 7: Run bootstrap tests and verify failure**

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

Refactor snapshot application:

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
  onSnapshot: ({ snapshot: acceptedSnapshot }) => {
    applySnapshot(acceptedSnapshot);
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

- [ ] **Step 10: Preserve `Run now` with `ActiveTabSource.refresh()`**

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

Add the same design/plan links.

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

V. Change code and immediately click Run now before normal polling catches up.
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

Confirm there is no new:

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
Task 3  same-tab navigation + reload + recovery + full disposal
  ↓
Task 4  Side Panel integration + paused/resume + Run now
  ↓
Task 5  docs + regression + Chrome multi-tab acceptance
```

Do not integrate `ActiveTabSource` into `bootstrap.ts` until Task 1 scheduler invalidation and Task 2/3 ActiveTabSource tests pass independently.

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

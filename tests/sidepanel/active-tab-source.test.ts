import { describe, expect, it, vi } from "vitest";

import type { LeetCodePageState } from "../../src/content/leetcode-adapter";
import {
  createActiveTabSource,
  type ActiveTabPageState,
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

function pageState(overrides: Partial<LeetCodePageState> = {}): LeetCodePageState {
  return {
    code: "class Solution:\n    def one(self, value):\n        return value\n",
    language: "python",
    testcase: "7",
    metadata: { slug: "one", title: "One" },
    ...overrides
  };
}

function problemState(slug: string): LeetCodePageState {
  return pageState({
    code: `class Solution:\n    def ${slug}(self, value):\n        return value\n`,
    metadata: { slug, title: slug }
  });
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
  const responses = new Map<number, LeetCodePageState>();

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
      sendMessage: vi.fn((
        tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => {
        callback({ ok: true, state: responses.get(tabId) });
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

describe("createActiveTabSource", () => {
  it("accepts a code-only state from the active LeetCode tab", async () => {
    const chromeFake = fakeChrome(tab(
      11,
      7,
      "https://leetcode.com/problems/one/"
    ));
    const emitted: ActiveTabPageState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);

    chromeFake.responses.set(11, pageState({ testcase: null }));

    await source.start();

    await vi.waitFor(() =>
      expect(emitted.at(-1)?.state.testcase).toBeNull()
    );
    expect(emitted.at(-1)?.state.code).toContain("class Solution");
  });

  it("owns and fetches the initial active LeetCode tab", async () => {
    const chromeFake = fakeChrome(tab(
      11,
      7,
      "https://leetcode.com/problems/two-sum/"
    ));
    chromeFake.responses.set(11, problemState("twoSum"));
    const states: ActiveTabState[] = [];
    const pageStates: ActiveTabPageState[] = [];

    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: (state) => states.push(state),
      onPageState: (value) => pageStates.push(value),
      onError: vi.fn()
    }, chromeFake.api);

    await source.start();

    expect(states).toEqual([{ kind: "leetcode", tabId: 11 }]);
    expect(pageStates).toEqual([{ tabId: 11, state: problemState("twoSum") }]);
    expect(chromeFake.api.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      { type: "request_leetcode_page_state" },
      expect.any(Function)
    );
  });

  it("invalidates immediately and fetches the exact newly activated LeetCode tab", async () => {
    const first = tab(11, 7, "https://leetcode.com/problems/binary-search/");
    const second = tab(22, 7, "https://leetcode.com/problems/two-sum/");
    const chromeFake = fakeChrome(first);
    chromeFake.tabs.set(22, second);
    chromeFake.responses.set(11, problemState("search"));
    chromeFake.responses.set(22, problemState("twoSum"));
    const invalidated = vi.fn();
    const pageStates: ActiveTabPageState[] = [];

    const source = createActiveTabSource({
      onOwnershipInvalidated: invalidated,
      onStateChange: vi.fn(),
      onPageState: (value) => pageStates.push(value),
      onError: vi.fn()
    }, chromeFake.api);
    await source.start();
    pageStates.length = 0;

    chromeFake.onActivated.emit({ tabId: 22, windowId: 7 });
    await vi.waitFor(() => expect(pageStates).toHaveLength(1));

    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(pageStates[0]).toEqual({ tabId: 22, state: problemState("twoSum") });
    expect(chromeFake.api.tabs.sendMessage).toHaveBeenLastCalledWith(
      22,
      { type: "request_leetcode_page_state" },
      expect.any(Function)
    );
  });

  it("ignores tab activation from another Chrome window", async () => {
    const first = tab(11, 7, "https://leetcode.com/problems/two-sum/");
    const otherWindow = tab(44, 9, "https://leetcode.com/problems/binary-search/");
    const chromeFake = fakeChrome(first);
    chromeFake.tabs.set(44, otherWindow);
    chromeFake.responses.set(11, problemState("twoSum"));
    const invalidated = vi.fn();
    const source = createActiveTabSource({
      onOwnershipInvalidated: invalidated,
      onStateChange: vi.fn(),
      onPageState: vi.fn(),
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

  it("ignores page-state updates from a background LeetCode tab", async () => {
    const chromeFake = fakeChrome(tab(
      11,
      7,
      "https://leetcode.com/problems/two-sum/"
    ));
    chromeFake.responses.set(11, problemState("initial"));
    const pageStates: ActiveTabPageState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState: (value) => pageStates.push(value),
      onError: vi.fn()
    }, chromeFake.api);
    await source.start();
    pageStates.length = 0;

    chromeFake.onMessage.emit(
      { type: "leetcode_page_state_updated", state: problemState("background") },
      { tab: tab(99, 7, "https://leetcode.com/problems/binary-search/") },
      vi.fn()
    );
    chromeFake.onMessage.emit(
      { type: "leetcode_page_state_updated", state: problemState("active") },
      { tab: tab(11, 7, "https://leetcode.com/problems/two-sum/") },
      vi.fn()
    );

    expect(pageStates).toEqual([{ tabId: 11, state: problemState("active") }]);
  });

  it("drops an old-owner page state that arrives after a tab switch", async () => {
    const first = tab(11, 7, "https://leetcode.com/problems/binary-search/");
    const second = tab(22, 7, "https://leetcode.com/problems/two-sum/");
    const chromeFake = fakeChrome(first);
    chromeFake.tabs.set(22, second);

    const callbacks = new Map<number, (response: unknown) => void>();
    (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation((
        tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => {
        callbacks.set(tabId, callback);
      });

    const emitted: ActiveTabPageState[] = [];
    const onError = vi.fn();
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState: (value) => emitted.push(value),
      onError
    }, chromeFake.api);

    const starting = source.start();
    await vi.waitFor(() => expect(callbacks.has(11)).toBe(true));

    chromeFake.onActivated.emit({ tabId: 22, windowId: 7 });
    await vi.waitFor(() => expect(callbacks.has(22)).toBe(true));
    callbacks.get(22)!({ ok: true, state: problemState("twoSum") });
    await vi.waitFor(() => expect(emitted).toHaveLength(1));

    callbacks.get(11)!({ ok: true, state: problemState("search") });
    await starting;
    await Promise.resolve();

    expect(emitted).toEqual([{ tabId: 22, state: problemState("twoSum") }]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not inherit the old owner testcase when the new owner reports null", async () => {
    const chromeFake = fakeChrome(tab(
      11,
      7,
      "https://leetcode.com/problems/one/"
    ));
    chromeFake.responses.set(11, pageState({ testcase: "7" }));
    const emitted: ActiveTabPageState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);
    await source.start();

    chromeFake.tabs.set(22, tab(22, 7, "https://leetcode.com/problems/two-sum/"));
    chromeFake.responses.set(22, pageState({
      testcase: null,
      metadata: { slug: "two-sum", title: "Two Sum" }
    }));
    chromeFake.onActivated.emit({ tabId: 22, windowId: 7 });

    await vi.waitFor(() =>
      expect(emitted.at(-1)).toEqual({
        tabId: 22,
        state: pageState({
          testcase: null,
          metadata: { slug: "two-sum", title: "Two Sum" }
        })
      })
    );
  });

  it("pauses when the current-window active tab is not LeetCode", async () => {
    const leetcode = tab(11, 7, "https://leetcode.com/problems/two-sum/");
    const nonLeetCode = tab(33, 7, undefined);
    const chromeFake = fakeChrome(leetcode);
    chromeFake.tabs.set(33, nonLeetCode);
    chromeFake.responses.set(11, problemState("twoSum"));
    const states: ActiveTabState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: (state) => states.push(state),
      onPageState: vi.fn(),
      onError: vi.fn()
    }, chromeFake.api);
    await source.start();

    chromeFake.onActivated.emit({ tabId: 33, windowId: 7 });
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: "paused" }));
  });

  it("invalidates once and refetches when the active tab navigates to another LeetCode problem", async () => {
    const initial = tab(11, 7, "https://leetcode.com/problems/two-sum/");
    const updated = tab(11, 7, "https://leetcode.com/problems/binary-search/");
    const chromeFake = fakeChrome(initial);
    chromeFake.responses.set(11, problemState("twoSum"));
    const invalidated = vi.fn();
    const emitted: ActiveTabPageState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: invalidated,
      onStateChange: vi.fn(),
      onPageState: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);
    await source.start();
    invalidated.mockClear();
    emitted.length = 0;
    const sendMessageMock = chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>;
    const before = sendMessageMock.mock.calls.length;

    chromeFake.responses.set(11, problemState("search"));
    chromeFake.onUpdated.emit(11, { url: updated.url }, updated);
    await vi.waitFor(() => expect(emitted).toHaveLength(1));

    chromeFake.onUpdated.emit(11, { status: "complete" }, updated);
    await vi.waitFor(() =>
      expect(chromeFake.api.tabs.sendMessage).toHaveBeenCalledTimes(before + 2)
    );

    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(emitted.at(-1)?.state.metadata.slug).toBe("search");
  });

  it("refreshes after the active LeetCode tab completes a reload without a second ownership invalidation", async () => {
    const initial = tab(11, 7, "https://leetcode.com/problems/two-sum/");
    const chromeFake = fakeChrome(initial);
    chromeFake.responses.set(11, problemState("beforeReload"));
    const invalidated = vi.fn();
    const emitted: ActiveTabPageState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: invalidated,
      onStateChange: vi.fn(),
      onPageState: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);
    await source.start();
    invalidated.mockClear();
    emitted.length = 0;

    chromeFake.responses.set(11, problemState("afterReload"));
    chromeFake.onUpdated.emit(11, { status: "complete" }, initial);

    await vi.waitFor(() => expect(emitted).toHaveLength(1));
    expect(invalidated).not.toHaveBeenCalled();
    expect(emitted[0]?.state.metadata.slug).toBe("afterReload");
  });

  it("resumes when the current non-LeetCode tab navigates to LeetCode", async () => {
    const initial = tab(33, 7, undefined);
    const leetcode = tab(33, 7, "https://leetcode.com/problems/two-sum/");
    const chromeFake = fakeChrome(initial);
    const states: ActiveTabState[] = [];
    const emitted: ActiveTabPageState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: (state) => states.push(state),
      onPageState: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);
    await source.start();
    expect(states.at(-1)).toEqual({ kind: "paused" });

    chromeFake.responses.set(33, problemState("twoSum"));
    chromeFake.onUpdated.emit(33, { url: leetcode.url }, leetcode);

    await vi.waitFor(() => expect(emitted).toHaveLength(1));
    expect(states.at(-1)).toEqual({ kind: "leetcode", tabId: 33 });
  });

  it("reinjects and retries the same exact tab after a missing receiver error", async () => {
    const initial = tab(22, 7, "https://leetcode.com/problems/two-sum/");
    const chromeFake = fakeChrome(initial);
    let attempt = 0;
    (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation((
        tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => {
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
        callback({ ok: true, state: problemState("twoSum") });
      });

    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState: vi.fn(),
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
      .mockImplementation((
        tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => {
        if (tabId === 11) {
          callback({ ok: false });
          return;
        }
        callback({ ok: true, state: problemState("twoSum") });
      });

    const emitted: ActiveTabPageState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);

    await source.start();
    await vi.waitFor(() =>
      expect(emitted.at(-1)).toEqual({ tabId: 22, state: problemState("twoSum") })
    );
  });

  it("pauses when the current owner disappears during a page-state request", async () => {
    const first = tab(11, 7, "https://leetcode.com/problems/binary-search/");
    const chromeFake = fakeChrome(first);
    let queryCount = 0;
    (chromeFake.api.tabs.query as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation((_query: unknown, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        queryCount += 1;
        callback(queryCount <= 2 ? [first] : []);
      });

    (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation((
        _tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => {
        callback({ ok: false });
      });

    const states: ActiveTabState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: (state) => states.push(state),
      onPageState: vi.fn(),
      onError: vi.fn()
    }, chromeFake.api);

    await source.start();
    await vi.waitFor(() =>
      expect(states.at(-1)).toEqual({ kind: "paused" })
    );
  });

  it("re-resolves a replacement tab when activation metadata lookup fails", async () => {
    const first = tab(11, 7, "https://leetcode.com/problems/binary-search/");
    const replacement = tab(23, 7, "https://leetcode.com/problems/two-sum/");
    const chromeFake = fakeChrome(first);
    chromeFake.tabs.set(23, replacement);
    chromeFake.responses.set(11, problemState("search"));
    chromeFake.responses.set(23, problemState("twoSum"));

    let queryCount = 0;
    (chromeFake.api.tabs.query as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation((_query: unknown, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        queryCount += 1;
        callback(queryCount <= 2 ? [first] : [replacement]);
      });
    (chromeFake.api.tabs.get as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation((tabId: number, callback: (resolvedTab: chrome.tabs.Tab) => void) => {
        if (tabId === 22) {
          Object.defineProperty(chromeFake.api.runtime, "lastError", {
            configurable: true,
            value: { message: "No tab with id: 22" }
          });
          callback(undefined as unknown as chrome.tabs.Tab);
          Object.defineProperty(chromeFake.api.runtime, "lastError", {
            configurable: true,
            value: undefined
          });
          return;
        }
        callback(chromeFake.tabs.get(tabId)!);
      });

    const emitted: ActiveTabPageState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);
    await source.start();

    chromeFake.onActivated.emit({ tabId: 22, windowId: 7 });
    await vi.waitFor(() =>
      expect(emitted.at(-1)).toEqual({ tabId: 23, state: problemState("twoSum") })
    );
  });

  it("re-resolves ownership when refresh fails for the current exact tab", async () => {
    const first = tab(11, 7, "https://leetcode.com/problems/binary-search/");
    const replacement = tab(22, 7, "https://leetcode.com/problems/two-sum/");
    const chromeFake = fakeChrome(first);
    chromeFake.tabs.set(22, replacement);
    chromeFake.responses.set(11, problemState("search"));
    chromeFake.responses.set(22, problemState("twoSum"));

    let queryCount = 0;
    (chromeFake.api.tabs.query as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation((_query: unknown, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        queryCount += 1;
        callback(queryCount <= 2 ? [first] : [replacement]);
      });

    let requestCount = 0;
    (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation((
        tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => {
        requestCount += 1;
        if (tabId === 11 && requestCount === 2) {
          callback({ ok: false });
          return;
        }
        callback({ ok: true, state: chromeFake.responses.get(tabId) });
      });

    const emitted: ActiveTabPageState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);
    await source.start();

    await expect(source.refresh()).resolves.toBeNull();
    await vi.waitFor(() =>
      expect(emitted.at(-1)).toEqual({ tabId: 22, state: problemState("twoSum") })
    );
  });

  it("ignores an older same-epoch navigation fetch after completion refresh wins", async () => {
    const initial = tab(11, 7, "https://leetcode.com/problems/two-sum/");
    const updated = tab(11, 7, "https://leetcode.com/problems/binary-search/");
    const chromeFake = fakeChrome(initial);
    const callbacks: Array<{
      tabId: number;
      resolve: (response: unknown) => void;
    }> = [];
    (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation((
        tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => {
        callbacks.push({ tabId, resolve: callback });
      });

    const emitted: ActiveTabPageState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);

    const starting = source.start();
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    callbacks[0]!.resolve({ ok: true, state: problemState("initial") });
    await starting;
    emitted.length = 0;

    chromeFake.onUpdated.emit(11, { url: updated.url }, updated);
    await vi.waitFor(() => expect(callbacks).toHaveLength(2));
    chromeFake.onUpdated.emit(11, { status: "complete" }, updated);
    await vi.waitFor(() => expect(callbacks).toHaveLength(3));

    callbacks[2]!.resolve({ ok: true, state: problemState("newest") });
    await vi.waitFor(() => expect(emitted).toHaveLength(1));
    callbacks[1]!.resolve({ ok: true, state: problemState("stale") });
    await Promise.resolve();
    await Promise.resolve();

    expect(emitted).toEqual([{ tabId: 11, state: problemState("newest") }]);
  });

  it("refreshes the exact owned tab page state without emitting it", async () => {
    const chromeFake = fakeChrome(tab(
      11,
      7,
      "https://leetcode.com/problems/two-sum/"
    ));
    chromeFake.responses.set(11, problemState("initial"));
    const emitted: ActiveTabPageState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);
    await source.start();
    emitted.length = 0;

    chromeFake.responses.set(11, problemState("runNow"));
    const refreshed = await source.refresh();

    expect(refreshed).toEqual({ tabId: 11, state: problemState("runNow") });
    expect(emitted).toEqual([]);
  });

  it("does not surface an old-owner refresh error after ownership changes", async () => {
    const first = tab(11, 7, "https://leetcode.com/problems/binary-search/");
    const second = tab(22, 7, "https://leetcode.com/problems/two-sum/");
    const chromeFake = fakeChrome(first);
    chromeFake.tabs.set(22, second);
    chromeFake.responses.set(11, problemState("search"));
    chromeFake.responses.set(22, problemState("twoSum"));
    const onError = vi.fn();
    const emitted: ActiveTabPageState[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState: (value) => emitted.push(value),
      onError
    }, chromeFake.api);
    await source.start();

    let oldOwnerRefresh!: (response: unknown) => void;
    (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation((
        tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => {
        if (tabId === 11) {
          oldOwnerRefresh = callback;
          return;
        }
        callback({ ok: true, state: chromeFake.responses.get(tabId) });
      });

    const refreshing = source.refresh();
    await vi.waitFor(() => expect(oldOwnerRefresh).toBeDefined());
    chromeFake.onActivated.emit({ tabId: 22, windowId: 7 });
    await vi.waitFor(() =>
      expect(emitted.at(-1)).toEqual({ tabId: 22, state: problemState("twoSum") })
    );

    oldOwnerRefresh({ ok: false });

    await expect(refreshing).resolves.toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("removes all tab/runtime listeners and suppresses late callbacks after dispose", async () => {
    const chromeFake = fakeChrome(tab(
      11,
      7,
      "https://leetcode.com/problems/two-sum/"
    ));
    const callbacks: Array<(response: unknown) => void> = [];
    (chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation((
        _tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => {
        callbacks.push(callback);
      });
    const onPageState = vi.fn();
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState,
      onError: vi.fn()
    }, chromeFake.api);

    const starting = source.start();
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    source.dispose();
    callbacks[0]!({ ok: true, state: problemState("late") });
    await starting;

    expect(onPageState).not.toHaveBeenCalled();
    expect(chromeFake.onActivated.listeners.size).toBe(0);
    expect(chromeFake.onUpdated.listeners.size).toBe(0);
    expect(chromeFake.onMessage.listeners.size).toBe(0);
  });
});

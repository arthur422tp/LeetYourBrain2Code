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
      sendMessage: vi.fn((
        tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => {
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

describe("createActiveTabSource", () => {
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

  it("ignores a slow snapshot and error from a previously active tab", async () => {
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
    const sendMessageMock = chromeFake.api.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>;
    const before = sendMessageMock.mock.calls.length;

    chromeFake.responses.set(11, snapshot("search"));
    chromeFake.onUpdated.emit(11, { url: updated.url }, updated);
    await vi.waitFor(() => expect(emitted).toHaveLength(1));

    chromeFake.onUpdated.emit(11, { status: "complete" }, updated);
    await vi.waitFor(() =>
      expect(chromeFake.api.tabs.sendMessage).toHaveBeenCalledTimes(before + 2)
    );

    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(emitted.at(-1)?.snapshot.metadata.slug).toBe("search");
  });

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

  it("pauses when the current owner disappears during a snapshot request", async () => {
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
      onSnapshot: vi.fn(),
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
    chromeFake.responses.set(11, snapshot("search"));
    chromeFake.responses.set(23, snapshot("twoSum"));

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

    const emitted: ActiveTabSnapshot[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onSnapshot: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);
    await source.start();

    chromeFake.onActivated.emit({ tabId: 22, windowId: 7 });
    await vi.waitFor(() =>
      expect(emitted.at(-1)).toEqual({ tabId: 23, snapshot: snapshot("twoSum") })
    );
  });

  it("re-resolves ownership when refresh fails for the current exact tab", async () => {
    const first = tab(11, 7, "https://leetcode.com/problems/binary-search/");
    const replacement = tab(22, 7, "https://leetcode.com/problems/two-sum/");
    const chromeFake = fakeChrome(first);
    chromeFake.tabs.set(22, replacement);
    chromeFake.responses.set(11, snapshot("search"));
    chromeFake.responses.set(22, snapshot("twoSum"));

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
        callback({ ok: true, snapshot: chromeFake.responses.get(tabId) });
      });

    const emitted: ActiveTabSnapshot[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onSnapshot: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);
    await source.start();

    await expect(source.refresh()).resolves.toBeNull();
    await vi.waitFor(() =>
      expect(emitted.at(-1)).toEqual({ tabId: 22, snapshot: snapshot("twoSum") })
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

    const emitted: ActiveTabSnapshot[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onSnapshot: (value) => emitted.push(value),
      onError: vi.fn()
    }, chromeFake.api);

    const starting = source.start();
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    callbacks[0]!.resolve({ ok: true, snapshot: snapshot("initial") });
    await starting;
    emitted.length = 0;

    chromeFake.onUpdated.emit(11, { url: updated.url }, updated);
    await vi.waitFor(() => expect(callbacks).toHaveLength(2));
    chromeFake.onUpdated.emit(11, { status: "complete" }, updated);
    await vi.waitFor(() => expect(callbacks).toHaveLength(3));

    callbacks[2]!.resolve({ ok: true, snapshot: snapshot("newest") });
    await vi.waitFor(() => expect(emitted).toHaveLength(1));
    callbacks[1]!.resolve({ ok: true, snapshot: snapshot("stale") });
    await Promise.resolve();
    await Promise.resolve();

    expect(emitted).toEqual([{ tabId: 11, snapshot: snapshot("newest") }]);
  });

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
      .mockImplementation((
        _tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => {
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
});

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
});

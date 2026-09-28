import { describe, expect, it, vi } from "vitest";

import type { LeetCodePageState } from "../../src/content/leetcode-page-state";
import { createActiveTabSource } from "../../src/sidepanel/active-tab-source";

class FakeEvent<T extends (...args: any[]) => void> {
  readonly listeners = new Set<T>();

  addListener = (listener: T): void => {
    this.listeners.add(listener);
  };

  removeListener = (listener: T): void => {
    this.listeners.delete(listener);
  };

  emit(...args: Parameters<T>): void {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

function tab(id: number, windowId: number, url: string): chrome.tabs.Tab {
  return {
    id,
    windowId,
    url,
    active: true,
    index: 0,
    pinned: false,
    highlighted: true,
    incognito: false
  } as chrome.tabs.Tab;
}

function pageState(slug = "two-sum"): LeetCodePageState {
  return {
    code: "class Solution:\n    pass",
    language: "python",
    testcase: "1",
    metadata: { slug, title: slug }
  };
}

function fakeChrome(initialTab: chrome.tabs.Tab, state: LeetCodePageState) {
  const onActivated = new FakeEvent<(info: chrome.tabs.TabActiveInfo) => void>();
  const onUpdated = new FakeEvent<(
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    updatedTab: chrome.tabs.Tab
  ) => void>();
  const onMessage = new FakeEvent<(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => void>();
  const tabs = new Map<number, chrome.tabs.Tab>([[initialTab.id!, initialTab]]);
  const responses = new Map<number, LeetCodePageState>([[initialTab.id!, state]]);
  let currentActiveTabId = initialTab.id!;

  const api = {
    runtime: { lastError: undefined, onMessage },
    tabs: {
      query: vi.fn((_query: unknown, callback: (result: chrome.tabs.Tab[]) => void) => {
        callback([tabs.get(currentActiveTabId)!]);
      }),
      get: vi.fn((tabId: number, callback: (resolvedTab: chrome.tabs.Tab) => void) => {
        callback(tabs.get(tabId)!);
      }),
      sendMessage: vi.fn((
        tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => callback({ ok: true, state: responses.get(tabId) })),
      onActivated,
      onUpdated
    },
    scripting: { executeScript: vi.fn().mockResolvedValue([]) }
  } as unknown as Pick<typeof chrome, "runtime" | "tabs" | "scripting">;

  return {
    api,
    tabs,
    responses,
    setActiveTab: (tabId: number): void => { currentActiveTabId = tabId; },
    onActivated,
    onUpdated,
    onMessage
  };
}

describe("LeetCode compatibility: active tab ownership", () => {
  it("owns the current-window LeetCode tab and requests its page state", async () => {
    const initialTab = tab(11, 7, "https://leetcode.com/problems/two-sum/");
    const chromeFake = fakeChrome(initialTab, pageState());
    const states: unknown[] = [];
    const pageStates: unknown[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: (state) => states.push(state),
      onPageState: (value) => pageStates.push(value),
      onError: vi.fn()
    }, chromeFake.api);

    await source.start();

    expect(states).toEqual([{ kind: "leetcode", tabId: 11 }]);
    expect(pageStates).toEqual([{ tabId: 11, state: pageState() }]);
    expect(chromeFake.api.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      { type: "request_leetcode_page_state" },
      expect.any(Function)
    );
    source.dispose();
  });

  it("refreshes the exact newly active LeetCode tab and ignores background updates", async () => {
    const first = tab(11, 7, "https://leetcode.com/problems/two-sum/");
    const second = tab(22, 7, "https://leetcode.com/problems/binary-search/");
    const chromeFake = fakeChrome(first, pageState("two-sum"));
    chromeFake.tabs.set(second.id!, second);
    chromeFake.responses.set(second.id!, pageState("binary-search"));
    const invalidated = vi.fn();
    const pageStates: Array<{ tabId: number; state: LeetCodePageState }> = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: invalidated,
      onStateChange: vi.fn(),
      onPageState: (value) => pageStates.push(value),
      onError: vi.fn()
    }, chromeFake.api);

    await source.start();
    pageStates.length = 0;
    chromeFake.onMessage.emit(
      { type: "leetcode_page_state_updated", state: pageState("background") },
      { tab: tab(99, 7, "https://leetcode.com/problems/background/") },
      vi.fn()
    );
    expect(pageStates).toEqual([]);

    chromeFake.setActiveTab(22);
    chromeFake.onActivated.emit({ tabId: 22, windowId: 7 });
    await vi.waitFor(() => expect(pageStates).toHaveLength(1));

    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(pageStates[0]).toEqual({ tabId: 22, state: pageState("binary-search") });
    expect(chromeFake.api.tabs.sendMessage).toHaveBeenLastCalledWith(
      22,
      { type: "request_leetcode_page_state" },
      expect.any(Function)
    );
    source.dispose();
  });

  it("pauses on a non-LeetCode tab and resumes from the newly active LeetCode tab", async () => {
    const first = tab(11, 7, "https://leetcode.com/problems/two-sum/");
    const other = tab(33, 7, "https://example.com/");
    const returning = tab(44, 7, "https://leetcode.com/problems/three-sum/");
    const chromeFake = fakeChrome(first, pageState("two-sum"));
    chromeFake.tabs.set(other.id!, other);
    chromeFake.tabs.set(returning.id!, returning);
    chromeFake.responses.set(returning.id!, pageState("three-sum"));
    const states: unknown[] = [];
    const pageStates: unknown[] = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: (state) => states.push(state),
      onPageState: (value) => pageStates.push(value),
      onError: vi.fn()
    }, chromeFake.api);

    await source.start();
    chromeFake.setActiveTab(33);
    chromeFake.onActivated.emit({ tabId: 33, windowId: 7 });
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: "paused" }));
    expect(chromeFake.api.tabs.sendMessage).not.toHaveBeenLastCalledWith(
      33,
      expect.anything(),
      expect.any(Function)
    );

    chromeFake.setActiveTab(44);
    chromeFake.onActivated.emit({ tabId: 44, windowId: 7 });
    await vi.waitFor(() => expect(pageStates.at(-1)).toEqual({
      tabId: 44,
      state: pageState("three-sum")
    }));
    expect(states.at(-1)).toEqual({ kind: "leetcode", tabId: 44 });
    source.dispose();
  });

  it("refreshes a new SPA problem identity in the same browser tab", async () => {
    const current = tab(11, 7, "https://leetcode.com/problems/two-sum/");
    const chromeFake = fakeChrome(current, pageState("two-sum"));
    const pageStates: Array<{ tabId: number; state: LeetCodePageState }> = [];
    const source = createActiveTabSource({
      onOwnershipInvalidated: vi.fn(),
      onStateChange: vi.fn(),
      onPageState: (value) => pageStates.push(value),
      onError: vi.fn()
    }, chromeFake.api);

    await source.start();
    pageStates.length = 0;
    const next = tab(11, 7, "https://leetcode.com/problems/binary-search/");
    chromeFake.tabs.set(11, next);
    chromeFake.responses.set(11, pageState("binary-search"));
    chromeFake.onUpdated.emit(11, { url: next.url }, next);

    await vi.waitFor(() => expect(pageStates).toEqual([
      { tabId: 11, state: pageState("binary-search") }
    ]));
    expect(chromeFake.api.tabs.sendMessage).toHaveBeenLastCalledWith(
      11,
      { type: "request_leetcode_page_state" },
      expect.any(Function)
    );
    source.dispose();
  });
});

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

function pageState(): LeetCodePageState {
  return {
    code: "class Solution:\n    pass",
    language: "python",
    testcase: "1",
    metadata: { slug: "two-sum", title: "Two Sum" }
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

  const api = {
    runtime: { lastError: undefined, onMessage },
    tabs: {
      query: vi.fn((_query: unknown, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        callback([initialTab]);
      }),
      get: vi.fn((_tabId: number, callback: (resolvedTab: chrome.tabs.Tab) => void) => {
        callback(initialTab);
      }),
      sendMessage: vi.fn((
        _tabId: number,
        _message: unknown,
        callback: (response: unknown) => void
      ) => callback({ ok: true, state })),
      onActivated,
      onUpdated
    },
    scripting: { executeScript: vi.fn().mockResolvedValue([]) }
  } as unknown as Pick<typeof chrome, "runtime" | "tabs" | "scripting">;

  return { api, onActivated, onUpdated, onMessage };
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
});

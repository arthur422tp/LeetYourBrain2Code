import { afterEach, describe, expect, it } from "vitest";

import { createPageStateMessageHandler } from "../../src/content/content-script";
import {
  createLeetCodeAdapter,
  extractIsolatedPageState,
  requestMainWorldPageState
} from "../../src/content/leetcode-adapter";
import {
  toRunnableSnapshot,
  validatePageState,
  type LeetCodePageState
} from "../../src/content/leetcode-page-state";
import {
  extractPageState,
  installMainWorldBridge
} from "../../src/page-bridge/leetcode-main-world";

function installTwoSumPage(): void {
  document.title = "Two Sum - LeetCode";
  window.history.replaceState({}, "", "/problems/two-sum/description/");
  document.body.innerHTML = `
    <button>Python3</button>
    <a href="/problems/two-sum/">1. Two Sum</a>
    <textarea aria-label="Code editor">class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]</textarea>
    <div contenteditable="true" class="w-full cursor-text">[2,7,11,15]</div>
    <div contenteditable="true" class="w-full cursor-text">9</div>
  `;
}

const partialPageState: LeetCodePageState = {
  code: "class Solution:\n    pass",
  language: "python",
  testcase: null,
  metadata: { slug: "two-sum", title: "Two Sum" }
};

afterEach(() => {
  document.body.replaceChildren();
  document.title = "";
  window.history.replaceState({}, "", "/");
});

describe("LeetCode compatibility: page state", () => {
  it("round-trips page identity, editor source, and testcase through the bridge", async () => {
    installTwoSumPage();
    const cleanup = installMainWorldBridge(window, document, { watchIntervalMs: 10 });

    try {
      await expect(requestMainWorldPageState(window, 250)).resolves.toEqual({
        code: "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",
        language: "python",
        testcase: "[2,7,11,15]\n9",
        metadata: { slug: "two-sum", title: "Two Sum" }
      });
      expect(extractPageState(document, window)).toEqual(
        await createLeetCodeAdapter({ document, window }).getPageState()
      );
    } finally {
      cleanup();
    }
  });

  it("keeps a validated partial page state while testcase controls are unavailable", async () => {
    expect(validatePageState(partialPageState)).toBe(true);
    expect(toRunnableSnapshot(partialPageState)).toBeNull();
    expect(extractIsolatedPageState(document)).toEqual({
      code: null,
      language: null,
      testcase: null,
      metadata: { slug: null, title: null }
    });

    const handler = createPageStateMessageHandler({
      getPageState: async () => partialPageState
    });
    const response = await new Promise<unknown>((resolve) => {
      expect(handler(
        { type: "request_leetcode_page_state" },
        {},
        resolve
      )).toBe(true);
    });

    expect(response).toEqual({ ok: true, state: partialPageState });
  });
});

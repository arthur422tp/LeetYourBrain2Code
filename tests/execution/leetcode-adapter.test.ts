import { describe, expect, it } from "vitest";

import {
  createLeetCodeAdapter,
  extractIsolatedSnapshot,
  requestMainWorldSnapshot,
  type LeetCodeSnapshot,
  validateSnapshot
} from "../../src/content/leetcode-adapter";
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

describe("LeetCode adapter", () => {
  it("extracts the current code, language, testcase, and metadata from the page", async () => {
    installTwoSumPage();

    const snapshot = await createLeetCodeAdapter({ document }).getSnapshot();

    expect(snapshot).toEqual({
      code: "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",
      language: "python",
      testcase: "[2,7,11,15]\n9",
      metadata: { slug: "two-sum", title: "Two Sum" }
    });
  });

  it("returns null for isolated extraction when a current editor value is unavailable", () => {
    document.body.innerHTML = "<button>Python3</button>";

    expect(extractIsolatedSnapshot(document)).toBeNull();
  });

  it("prefers the current Python Monaco model in the main world", () => {
    installTwoSumPage();
    Object.defineProperty(window, "monaco", {
      configurable: true,
      value: {
        editor: {
          getModels: () => [
            {
              getLanguageId: () => "python",
              getValue: () => "class Solution:\n    def twoSum(self, nums, target):\n        return [1, 0]"
            }
          ]
        }
      }
    });

    try {
      expect(extractPageState(document, window)?.code).toBe(
        "class Solution:\n    def twoSum(self, nums, target):\n        return [1, 0]"
      );
    } finally {
      delete (window as Window & { monaco?: unknown }).monaco;
    }
  });

  it("falls back to a validated main-world snapshot", async () => {
    document.body.innerHTML = "";
    const expected: LeetCodeSnapshot = {
      code: "class Solution:\n    def twoSum(self, nums, target):\n        pass",
      language: "python",
      testcase: "[2,7,11,15]\n9",
      metadata: { slug: "two-sum", title: "Two Sum" }
    };
    let requests = 0;

    const snapshot = await createLeetCodeAdapter({
      document,
      requestMainWorldSnapshot: async () => {
        requests += 1;
        return expected;
      }
    }).getSnapshot();

    expect(requests).toBe(1);
    expect(snapshot).toEqual(expected);
  });

  it("round-trips page extraction through the main-world message bridge", async () => {
    installTwoSumPage();
    const cleanup = installMainWorldBridge(window, document);

    try {
      await expect(requestMainWorldSnapshot(window, 250)).resolves.toEqual({
        code: "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",
        language: "python",
        testcase: "[2,7,11,15]\n9",
        metadata: { slug: "two-sum", title: "Two Sum" }
      });
    } finally {
      cleanup();
    }
  });

  it("rejects untrusted or malformed snapshots", () => {
    expect(validateSnapshot({ code: "", language: "python", testcase: "", metadata: {} })).toBe(
      false
    );
    expect(
      validateSnapshot({
        code: "class Solution: pass",
        language: "python",
        testcase: "1",
        metadata: { slug: 123, title: "Two Sum" }
      })
    ).toBe(false);
  });
});

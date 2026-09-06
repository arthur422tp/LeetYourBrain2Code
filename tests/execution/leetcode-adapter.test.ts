import { describe, expect, it } from "vitest";

import {
  toRunnableSnapshot,
  validatePageState,
  type LeetCodePageState
} from "../../src/content/leetcode-page-state";
import {
  createLeetCodeAdapter,
  extractIsolatedSnapshot,
  LEETCODE_MESSAGE_SOURCE,
  LEETCODE_MESSAGE_TYPES,
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
    expect(
      validatePageState({
        code: "",
        language: "python",
        testcase: "[2,7,11,15]\n9",
        metadata: { slug: "two-sum", title: "Two Sum" }
      })
    ).toBe(true);

    expect(
      validatePageState({
        code: null,
        language: "python",
        testcase: "[2,7,11,15]\n9",
        metadata: { slug: "two-sum", title: "Two Sum" }
      })
    ).toBe(true);
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

  it("prefers the main-world snapshot for the live content-script path", async () => {
    installTwoSumPage();
    const expected: LeetCodeSnapshot = {
      code: "class Solution:\n    def twoSum(self, nums, target):\n        return [1, 0]",
      language: "python",
      testcase: "[2,7,11,15]\n9",
      metadata: { slug: "two-sum", title: "Two Sum" }
    };

    await expect(createLeetCodeAdapter({
      document,
      preferMainWorldSnapshot: true,
      requestMainWorldSnapshot: async () => expected
    }).getSnapshot()).resolves.toEqual(expected);
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

  it("publishes a snapshot update when the LeetCode editor changes", async () => {
    installTwoSumPage();
    const updates: LeetCodeSnapshot[] = [];
    const onMessage = (event: MessageEvent): void => {
      if (
        event.data?.source === LEETCODE_MESSAGE_SOURCE &&
        event.data?.type === LEETCODE_MESSAGE_TYPES.snapshotUpdated &&
        event.data.snapshot
      ) {
        updates.push(event.data.snapshot as LeetCodeSnapshot);
      }
    };
    window.addEventListener("message", onMessage);
    const cleanup = installMainWorldBridge(window, document, { watchIntervalMs: 10 });

    try {
      await vi.waitFor(() => expect(updates[0]?.code).toContain("return [0, 1]"));

      const editor = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Code editor"]'
      );
      expect(editor).not.toBeNull();
      editor!.value = "class Solution:\n    def twoSum(self, nums, target):\n        return [1, 0]";

      await vi.waitFor(() => expect(updates.at(-1)?.code).toContain("return [1, 0]"));
    } finally {
      cleanup();
      window.removeEventListener("message", onMessage);
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

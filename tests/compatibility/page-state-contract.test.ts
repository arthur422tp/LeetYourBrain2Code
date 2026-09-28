import { afterEach, describe, expect, it, vi } from "vitest";

import { createPageStateMessageHandler } from "../../src/content/content-script";
import {
  createLeetCodeAdapter,
  extractMetadata,
  extractIsolatedPageState,
  LEETCODE_MESSAGE_SOURCE,
  LEETCODE_MESSAGE_TYPES,
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
import { LiveExecutionScheduler } from "../../src/execution/live-execution-scheduler";
import { getTestcaseCases } from "../../src/execution/testcase-selection";

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

  it("extracts problem identity and changes the page-state identity on SPA navigation", () => {
    installTwoSumPage();
    const twoSum = extractPageState(document, window);

    document.title = "Binary Search - LeetCode";
    window.history.replaceState({}, "", "/problems/binary-search/");
    const binarySearchLink = document.querySelector("a")!;
    binarySearchLink.href = "/problems/binary-search/";
    binarySearchLink.textContent = "704. Binary Search";
    const binarySearch = extractPageState(document, window);

    expect(extractMetadata(document)).toEqual({
      slug: "binary-search",
      title: "Binary Search"
    });
    expect(twoSum.metadata).toEqual({ slug: "two-sum", title: "Two Sum" });
    expect(binarySearch.metadata).toEqual({ slug: "binary-search", title: "Binary Search" });
    expect(binarySearch.metadata).not.toEqual(twoSum.metadata);
  });

  it("degrades non-problem page identity to explicit null metadata", () => {
    document.title = "";
    window.history.replaceState({}, "", "/problemset/");
    document.body.innerHTML = '<textarea aria-label="Code editor">pass</textarea>';

    expect(extractMetadata(document)).toEqual({ slug: null, title: null });
    expect(extractPageState(document, window).metadata).toEqual({
      slug: null,
      title: null
    });
  });

  it("prefers the selected Python Monaco model and represents unsupported languages", () => {
    installTwoSumPage();
    let models = [
      { getLanguageId: () => "javascript", getValue: () => "const stale = true;" },
      {
        getLanguageId: () => "python",
        getValue: () => "class Solution:\n    def twoSum(self, nums, target):\n        return [1, 0]"
      }
    ];
    Object.defineProperty(window, "monaco", {
      configurable: true,
      value: {
        editor: {
          getModels: () => models
        }
      }
    });

    try {
      expect(extractPageState(document, window)).toMatchObject({
        code: "class Solution:\n    def twoSum(self, nums, target):\n        return [1, 0]",
        language: "python"
      });

      document.querySelector("button")!.textContent = "Java";
      models = [{ getLanguageId: () => "java", getValue: () => "class Solution {}" }];
      expect(extractPageState(document, window)).toMatchObject({
        code: "class Solution {}",
        language: "java"
      });
    } finally {
      delete (window as Window & { monaco?: unknown }).monaco;
    }
  });

  it("prefers the source model attached to a visible Monaco editor", () => {
    installTwoSumPage();
    const staleSource = "class Solution:\n    # stale hidden source\n    pass";
    const visibleSource = "class Solution:\n    # current visible source\n    return [0, 1]";
    const staleModel = { getLanguageId: () => "python", getValue: () => staleSource };
    const visibleModel = { getLanguageId: () => "python", getValue: () => visibleSource };
    const hiddenNode = document.createElement("div");
    hiddenNode.hidden = true;
    document.body.append(hiddenNode);
    Object.defineProperty(hiddenNode, "getClientRects", {
      configurable: true,
      value: () => [{ width: 800, height: 600 }]
    });
    const visibleNode = document.createElement("div");
    document.body.append(visibleNode);
    Object.defineProperty(visibleNode, "getClientRects", {
      configurable: true,
      value: () => [{ width: 800, height: 600 }]
    });

    Object.defineProperty(window, "monaco", {
      configurable: true,
      value: {
        editor: {
          getModels: () => [staleModel, visibleModel],
          getEditors: () => [
            { getModel: () => staleModel, getDomNode: () => hiddenNode },
            { getModel: () => visibleModel, getDomNode: () => visibleNode }
          ]
        }
      }
    });

    try {
      expect(extractPageState(document, window)).toMatchObject({
        code: visibleSource,
        language: "python"
      });
    } finally {
      delete (window as Window & { monaco?: unknown }).monaco;
    }
  });

  it("rejects hidden and disconnected Monaco editors before using the DOM source", () => {
    installTwoSumPage();
    const hiddenSource = "class Solution:\n    # hidden source\n    pass";
    const disconnectedSource = "class Solution:\n    # disconnected source\n    pass";
    const hiddenModel = { getLanguageId: () => "python", getValue: () => hiddenSource };
    const disconnectedModel = {
      getLanguageId: () => "python",
      getValue: () => disconnectedSource
    };
    const hiddenNode = document.createElement("div");
    hiddenNode.hidden = true;
    document.body.append(hiddenNode);
    Object.defineProperty(hiddenNode, "getClientRects", {
      configurable: true,
      value: () => [{ width: 800, height: 600 }]
    });
    const disconnectedNode = document.createElement("div");
    Object.defineProperty(disconnectedNode, "getClientRects", {
      configurable: true,
      value: () => [{ width: 800, height: 600 }]
    });

    Object.defineProperty(window, "monaco", {
      configurable: true,
      value: {
        editor: {
          getModels: () => [hiddenModel, disconnectedModel],
          getEditors: () => [
            { getModel: () => hiddenModel, getDomNode: () => hiddenNode },
            { getModel: () => disconnectedModel, getDomNode: () => disconnectedNode }
          ]
        }
      }
    });

    try {
      expect(extractPageState(document, window)).toMatchObject({
        code: "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",
        language: "python"
      });
    } finally {
      delete (window as Window & { monaco?: unknown }).monaco;
    }
  });

  it("publishes source changes and suppresses duplicate logical page-state updates", async () => {
    installTwoSumPage();
    const updates: LeetCodePageState[] = [];
    const onMessage = (event: MessageEvent): void => {
      if (
        event.data?.source === LEETCODE_MESSAGE_SOURCE &&
        event.data?.type === LEETCODE_MESSAGE_TYPES.pageStateUpdated
      ) {
        updates.push(event.data.state as LeetCodePageState);
      }
    };
    window.addEventListener("message", onMessage);
    const cleanup = installMainWorldBridge(window, document, { watchIntervalMs: 5 });

    try {
      await vi.waitFor(() => expect(updates).toHaveLength(1));
      const editor = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Code editor"]'
      )!;
      const nextSource = `${editor.value}\n# changed`;
      editor.value = nextSource;
      await vi.waitFor(() => expect(updates).toHaveLength(2));
      expect(updates[1]?.code).toBe(nextSource);

      await new Promise((resolve) => window.setTimeout(resolve, 20));
      expect(updates).toHaveLength(2);
    } finally {
      cleanup();
      window.removeEventListener("message", onMessage);
    }
  });

  it("turns an available testcase into a runnable snapshot without fabricating missing input", () => {
    installTwoSumPage();
    const complete = extractPageState(document, window);
    expect(toRunnableSnapshot(complete)).toEqual({
      code: complete.code,
      language: complete.language,
      testcase: "[2,7,11,15]\n9",
      metadata: complete.metadata
    });

    document.body.innerHTML = `
      <button>Python3</button>
      <a href="/problems/two-sum/">1. Two Sum</a>
      <textarea aria-label="Code editor">class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]</textarea>
    `;
    const waiting = extractPageState(document, window);
    expect(waiting.code).toContain("def twoSum");
    expect(waiting.testcase).toBeNull();
    expect(toRunnableSnapshot(waiting)).toBeNull();
  });

  it("does not fabricate execution cases from malformed testcase text", () => {
    const source = "class Solution:\n    def add(self, left, right):\n        return left + right\n";
    expect(getTestcaseCases(source, "[malformed")).toEqual([]);
    expect(getTestcaseCases(source, "")).toEqual([]);
  });

  it("associates each selected case with a distinct execution identity", async () => {
    const requests: string[] = [];
    const scheduler = new LiveExecutionScheduler({
      runner: {
        execute: async (request) => {
          requests.push(request.rawTestcase);
          return {
            schemaVersion: 2,
            sessionId: request.sessionId,
            sourceCode: request.sourceCode,
            rawTestcase: request.rawTestcase,
            entrypoint: request.entrypoint,
            executionEnvironment: { runtime: "pyodide", pythonVersion: "unknown" },
            status: "completed",
            terminationReason: "normal_return",
            events: [],
            stdout: "",
            limits: request.limits
          };
        }
      },
      createSessionId: (() => {
        let count = 0;
        return () => `compat-case-${++count}`;
      })(),
      debounceMs: 0
    });

    const input = {
      language: "python",
      sourceCode: "class Solution:\n    def one(self, value):\n        return value\n",
      rawTestcase: "7\n8",
      selectedCaseIndex: 0,
      problemSlug: "one",
      problemTitle: "One"
    };
    scheduler.schedule(input, { immediate: true });
    await Promise.resolve();
    scheduler.schedule({ ...input, selectedCaseIndex: 1 }, { immediate: true });
    await Promise.resolve();
    scheduler.dispose();

    expect(requests).toEqual(["7", "8"]);
  });
});

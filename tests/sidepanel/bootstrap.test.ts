import { describe, expect, it, vi } from "vitest";

import { DEFAULT_EXECUTION_LIMITS } from "../../src/shared/execution-types";
import type { ExecutionRequest } from "../../src/shared/execution-types";
import type { TraceSession } from "../../src/shared/trace-types";
import type { LeetCodeSnapshot } from "../../src/content/leetcode-adapter";
import { renderSidePanel, type SidePanelController } from "../../src/sidepanel/bootstrap";

describe("renderSidePanel", () => {
  it("renders the initial runtime status", () => {
    const root = document.createElement("main");

    renderSidePanel(root);

    expect(root.textContent).toContain("Visualizer");
    expect(root.textContent).toContain("Runtime: not started");
  });

  it("runs the temporary developer harness and renders the trace session", async () => {
    const root = document.createElement("main");
    const execute = vi.fn(async (request: ExecutionRequest): Promise<TraceSession> => ({
      schemaVersion: 1,
      sessionId: request.sessionId,
      sourceCode: request.sourceCode,
      rawTestcase: request.rawTestcase,
      entrypoint: request.entrypoint,
      executionEnvironment: { runtime: "pyodide", pythonVersion: "unknown" },
      status: "completed",
      terminationReason: "normal_return",
      events: [
        {
          step: 1,
          event: "call",
          frameId: 1,
          parentFrameId: null,
          function: "twoSum",
          line: 2,
          callDepth: 1,
          locals: {},
          stdoutDelta: ""
        }
      ],
      stdout: "",
      limits: request.limits,
      returnValue: { type: "int", value: "9" }
    }));
    const controller: SidePanelController = { execute };

    renderSidePanel(root, { controller });

    const source = root.querySelector<HTMLTextAreaElement>("#source-code");
    const testcase = root.querySelector<HTMLTextAreaElement>("#testcase");
    const runButton = root.querySelector<HTMLButtonElement>("#run");
    expect(source?.value).toContain("class Solution");
    expect(testcase?.value).toContain("[2, 7]");
    expect(runButton).not.toBeNull();

    runButton?.click();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceCode: expect.stringContaining("class Solution"),
        rawTestcase: expect.stringContaining("[2, 7]"),
        entrypoint: { className: "Solution", methodName: "twoSum", parameterCount: 2 },
        limits: DEFAULT_EXECUTION_LIMITS
      })
    );
    expect(root.querySelector("#runtime-status")?.textContent).toBe("Runtime: completed");
    expect(root.querySelector("#trace-viewer")).not.toBeNull();
    expect(root.querySelector(".trace-viewer__step-label")?.textContent).toBe("Step 1 / 1");
    expect(root.querySelector("#trace-output")?.textContent).toContain('"event": "call"');
    expect(root.querySelector<HTMLDetailsElement>(".trace-viewer__debug")?.open).toBe(false);
  });

  it("initially mirrors the current LeetCode snapshot", async () => {
    const root = document.createElement("main");
    const snapshot: LeetCodeSnapshot = {
      code: "class Solution:\n    def one(self, value):\n        return value\n",
      language: "python",
      testcase: "7",
      metadata: { slug: "one", title: "One" }
    };

    renderSidePanel(root, { snapshotProvider: async () => snapshot });

    await vi.waitFor(() =>
      expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.value).toBe(snapshot.code)
    );
    expect(root.querySelector<HTMLTextAreaElement>("#testcase")?.value).toBe(snapshot.testcase);
    expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.readOnly).toBe(true);
    expect(root.querySelector("#load-snapshot")).toBeNull();
    expect(root.querySelector("#runtime-status")?.textContent).toBe("Runtime: ready");
  });

  it("keeps a read-only LeetCode mirror synchronized without a load button", async () => {
    const root = document.createElement("main");
    const initialSnapshot: LeetCodeSnapshot = {
      code: "class Solution:\n    def one(self, value):\n        return value\n",
      language: "python",
      testcase: "7",
      metadata: { slug: "one", title: "One" }
    };
    const updatedSnapshot: LeetCodeSnapshot = {
      ...initialSnapshot,
      code: "class Solution:\n    def one(self, value):\n        return value + 1\n",
      testcase: "8"
    };
    let onSnapshot: ((snapshot: LeetCodeSnapshot) => void) | undefined;

    renderSidePanel(root, {
      snapshotProvider: async () => initialSnapshot,
      snapshotSubscription: (listener) => {
        onSnapshot = listener;
        return () => undefined;
      }
    });

    await vi.waitFor(() =>
      expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.value)
        .toBe(initialSnapshot.code)
    );
    expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.readOnly).toBe(true);
    expect(root.querySelector<HTMLTextAreaElement>("#testcase")?.readOnly).toBe(true);
    expect(root.querySelector("#load-snapshot")).toBeNull();

    onSnapshot?.(updatedSnapshot);

    expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.value)
      .toBe(updatedSnapshot.code);
    expect(root.querySelector<HTMLTextAreaElement>("#testcase")?.value)
      .toBe(updatedSnapshot.testcase);
  });

  it("fetches the latest LeetCode snapshot before visualizing", async () => {
    const root = document.createElement("main");
    const initialSnapshot: LeetCodeSnapshot = {
      code: "class Solution:\n    def one(self, value):\n        return value\n",
      language: "python",
      testcase: "7",
      metadata: { slug: "one", title: "One" }
    };
    const latestSnapshot: LeetCodeSnapshot = {
      ...initialSnapshot,
      code: "class Solution:\n    def one(self, value):\n        return value + 1\n",
      testcase: "8"
    };
    const snapshotProvider = vi
      .fn<() => Promise<LeetCodeSnapshot>>()
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(latestSnapshot);
    const execute = vi.fn(async (request: ExecutionRequest): Promise<TraceSession> => ({
      schemaVersion: 1,
      sessionId: request.sessionId,
      sourceCode: request.sourceCode,
      rawTestcase: request.rawTestcase,
      entrypoint: request.entrypoint,
      executionEnvironment: { runtime: "pyodide", pythonVersion: "unknown" },
      status: "completed",
      terminationReason: "normal_return",
      events: [],
      stdout: "",
      limits: request.limits,
      returnValue: { type: "int", value: "8" }
    }));

    renderSidePanel(root, {
      controller: { execute },
      snapshotProvider
    });

    await vi.waitFor(() =>
      expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.value)
        .toBe(initialSnapshot.code)
    );
    root.querySelector<HTMLButtonElement>("#run")?.click();

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      sourceCode: latestSnapshot.code,
      rawTestcase: latestSnapshot.testcase
    }));
    expect(snapshotProvider).toHaveBeenCalledTimes(2);
  });
});

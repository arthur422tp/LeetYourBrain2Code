import { describe, expect, it, vi } from "vitest";

import { DEFAULT_EXECUTION_LIMITS } from "../../src/shared/execution-types";
import type { ExecutionRequest } from "../../src/shared/execution-types";
import type { TraceSession } from "../../src/shared/trace-types";
import type { LeetCodeSnapshot } from "../../src/content/leetcode-adapter";
import {
  createResilientSnapshotProvider,
  renderSidePanel,
  type SidePanelController
} from "../../src/sidepanel/bootstrap";

function snapshot(overrides: Partial<LeetCodeSnapshot> = {}): LeetCodeSnapshot {
  return {
    code: "class Solution:\n    def one(self, value):\n        return value\n",
    language: "python",
    testcase: "7",
    metadata: { slug: "one", title: "One" },
    ...overrides
  };
}

function completedSession(request: ExecutionRequest): TraceSession {
  return {
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
    limits: request.limits
  };
}

describe("renderSidePanel", () => {
  it("reconnects the LeetCode content script after a missing receiver error", async () => {
    const current = snapshot();
    const request = vi.fn<() => Promise<LeetCodeSnapshot>>()
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce(current);
    const reconnect = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const provider = createResilientSnapshotProvider(request, reconnect);

    await expect(provider()).resolves.toEqual(current);
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not reconnect for snapshot errors unrelated to a missing receiver", async () => {
    const request = vi.fn<() => Promise<LeetCodeSnapshot>>()
      .mockRejectedValue(new Error("No valid LeetCode snapshot was returned"));
    const reconnect = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const provider = createResilientSnapshotProvider(request, reconnect);

    await expect(provider()).rejects.toThrow("No valid LeetCode snapshot was returned");
    expect(reconnect).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("requests the snapshot from the active LeetCode tab", async () => {
    const root = document.createElement("main");
    const current = snapshot();
    const sendMessageToRuntime = vi.fn(
      (_message: unknown, callback: (response: unknown) => void) => callback(undefined)
    );
    const sendMessageToTab = vi.fn(
      (_tabId: number, _message: unknown, callback: (response: unknown) => void) =>
        callback({ ok: true, snapshot: current })
    );
    const chromeApi = {
      runtime: {
        lastError: undefined,
        sendMessage: sendMessageToRuntime,
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        }
      },
      tabs: {
        query: vi.fn(
          (_query: unknown, callback: (tabs: Array<{ id: number; url: string }>) => void) =>
            callback([{ id: 42, url: "https://leetcode.com/problems/one/" }])
        ),
        sendMessage: sendMessageToTab
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([])
      }
    } as unknown as typeof chrome;

    vi.stubGlobal("chrome", chromeApi);
    try {
      const handle = renderSidePanel(root, {
        controller: { execute: vi.fn(async (request) => completedSession(request)) },
        liveDebounceMs: 0
      });

      await vi.waitFor(() =>
        expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.value)
          .toBe(current.code)
      );
      expect(sendMessageToRuntime).not.toHaveBeenCalled();
      expect(sendMessageToTab).toHaveBeenCalledWith(
        42,
        { type: "request_leetcode_snapshot" },
        expect.any(Function)
      );
      handle.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders the initial live status", () => {
    const root = document.createElement("main");
    const controller: SidePanelController = { execute: vi.fn() };

    renderSidePanel(root, { controller, liveDebounceMs: 1_000 });

    expect(root.textContent).toContain("Visualizer");
    expect(root.textContent).toContain("Live: not started");
  });

  it("runs the temporary developer harness when Run now is pressed", async () => {
    const root = document.createElement("main");
    const execute = vi.fn(async (request: ExecutionRequest): Promise<TraceSession> => ({
      ...completedSession(request),
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
      returnValue: { type: "int", value: "9" }
    }));
    const controller: SidePanelController = { execute };

    const handle = renderSidePanel(root, { controller, liveDebounceMs: 1_000 });

    const source = root.querySelector<HTMLTextAreaElement>("#source-code");
    const testcase = root.querySelector<HTMLTextAreaElement>("#testcase");
    const runButton = root.querySelector<HTMLButtonElement>("#run");
    expect(source?.value).toContain("class Solution");
    expect(testcase?.value).toContain("[2, 7]");
    expect(runButton?.textContent).toBe("Run now");

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
    expect(root.querySelector("#runtime-status")?.textContent).toBe("Live: synced");
    expect(root.querySelector("#trace-viewer")).not.toBeNull();
    expect(root.querySelector(".trace-viewer__step-label")?.textContent).toBe("Step 1 / 1");
    expect(root.querySelector("#trace-output")?.textContent).toContain('"event": "call"');
    expect(root.querySelector<HTMLDetailsElement>(".trace-viewer__debug")?.open).toBe(false);
    handle.dispose();
  });

  it("automatically visualizes the initial synced Python snapshot", async () => {
    const root = document.createElement("main");
    const current = snapshot();
    const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));

    const handle = renderSidePanel(root, {
      controller: { execute },
      snapshotProvider: async () => current,
      liveDebounceMs: 0
    });

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(root.querySelector("#runtime-status")?.textContent).toBe("Live: synced");
    expect(root.querySelector("#trace-viewer")).not.toBeNull();
    handle.dispose();
  });

  it("automatically executes a newer snapshot from the subscription", async () => {
    const root = document.createElement("main");
    const first = snapshot();
    const second = snapshot({
      code: "class Solution:\n    def one(self, value):\n        return value + 1\n"
    });
    let onSnapshot: ((next: LeetCodeSnapshot) => void) | undefined;
    const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));

    const handle = renderSidePanel(root, {
      controller: { execute },
      snapshotProvider: async () => first,
      snapshotSubscription: (listener) => {
        onSnapshot = listener;
        return () => undefined;
      },
      liveDebounceMs: 0
    });

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    onSnapshot?.(second);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]?.[0].sourceCode).toBe(second.code);
    handle.dispose();
  });

  it("automatically executes the selected testcase case", async () => {
    const root = document.createElement("main");
    const current = snapshot({ testcase: "7\n8\n9" });
    const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));

    const handle = renderSidePanel(root, {
      controller: { execute },
      snapshotProvider: async () => current,
      liveDebounceMs: 0
    });

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0]?.[0].rawTestcase).toBe("7");

    const caseSelector = root.querySelector<HTMLSelectElement>("#testcase-case")!;
    caseSelector.value = "1";
    caseSelector.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]?.[0].rawTestcase).toBe("8");
    handle.dispose();
  });

  it("keeps the previous visualization while the latest code is incomplete", async () => {
    const root = document.createElement("main");
    const initial = snapshot();
    let onSnapshot: ((next: LeetCodeSnapshot) => void) | undefined;
    const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));

    const handle = renderSidePanel(root, {
      controller: { execute },
      snapshotProvider: async () => initial,
      snapshotSubscription: (listener) => {
        onSnapshot = listener;
        return () => undefined;
      },
      liveDebounceMs: 0
    });

    await vi.waitFor(() => expect(root.querySelector("#trace-viewer")).not.toBeNull());
    onSnapshot?.({
      ...initial,
      code: "class Solution:\n    def one(self, value):"
    });

    await vi.waitFor(() =>
      expect(root.querySelector("#runtime-status")?.textContent).toBe("Live: editing")
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(root.querySelector("#trace-viewer")).not.toBeNull();
    handle.dispose();
  });

  it.each([
    ["timeout", "hard_timeout", "Live: timeout"],
    ["exception", "runtime_exception", "Live: runtime_error"],
    ["internal_error", "tracer_internal_error", "Live: runtime_error"]
  ] as const)("renders %s sessions and the matching live status", async (
    sessionStatus,
    terminationReason,
    expectedText
  ) => {
    const root = document.createElement("main");
    const current = snapshot();
    const execute = vi.fn(async (request: ExecutionRequest): Promise<TraceSession> => ({
      ...completedSession(request),
      status: sessionStatus,
      terminationReason
    }));

    const handle = renderSidePanel(root, {
      controller: { execute },
      snapshotProvider: async () => current,
      liveDebounceMs: 0
    });

    await vi.waitFor(() =>
      expect(root.querySelector("#runtime-status")?.textContent).toBe(expectedText)
    );
    expect(root.querySelector("#trace-viewer")).not.toBeNull();
    handle.dispose();
  });

  it("Run now fetches the latest snapshot and bypasses the debounce", async () => {
    const root = document.createElement("main");
    const initial = snapshot();
    const latest = snapshot({ testcase: "8" });
    const snapshotProvider = vi.fn<() => Promise<LeetCodeSnapshot>>()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(latest);
    const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));

    const handle = renderSidePanel(root, {
      controller: { execute },
      snapshotProvider,
      liveDebounceMs: 1_000
    });

    await vi.waitFor(() =>
      expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.value).toBe(initial.code)
    );
    root.querySelector<HTMLButtonElement>("#run")?.click();

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(snapshotProvider).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0].rawTestcase).toBe("8");
    handle.dispose();
  });

  it("disposes the scheduler subscription and persistent controller", () => {
    const root = document.createElement("main");
    const unsubscribe = vi.fn();
    const dispose = vi.fn();
    const handle = renderSidePanel(root, {
      controller: {
        execute: vi.fn(),
        dispose
      },
      snapshotSubscription: () => unsubscribe
    });

    handle.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

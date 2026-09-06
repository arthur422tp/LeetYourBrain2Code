import { describe, expect, it, vi } from "vitest";

import { DEFAULT_EXECUTION_LIMITS } from "../../src/shared/execution-types";
import type { ExecutionRequest } from "../../src/shared/execution-types";
import type { TraceSession } from "../../src/shared/trace-types";
import type { LeetCodeSnapshot } from "../../src/content/leetcode-adapter";
import {
  renderSidePanel,
  type SidePanelController
} from "../../src/sidepanel/bootstrap";
import type {
  ActiveTabSource,
  ActiveTabSourceOptions,
  ActiveTabSnapshot
} from "../../src/sidepanel/active-tab-source";

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

function fakeActiveTabSourceFactory() {
  let callbacks!: ActiveTabSourceOptions;
  const refresh = vi.fn<() => Promise<ActiveTabSnapshot | null>>()
    .mockResolvedValue(null);
  const dispose = vi.fn();
  const start = vi.fn(async () => undefined);

  const factory = vi.fn((options: ActiveTabSourceOptions): ActiveTabSource => {
    callbacks = options;
    return { start, refresh, dispose };
  });

  return {
    factory,
    start,
    refresh,
    dispose,
    callbacks: () => callbacks
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("renderSidePanel", () => {
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

  it("visualizes the canonical snapshot emitted by the active tab source", async () => {
    const root = document.createElement("main");
    const source = fakeActiveTabSourceFactory();
    const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));
    const handle = renderSidePanel(root, {
      controller: { execute },
      activeTabSourceFactory: source.factory,
      liveDebounceMs: 0
    });

    expect(source.start).toHaveBeenCalledTimes(1);
    source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
    source.callbacks().onSnapshot({ tabId: 11, snapshot: snapshot() });

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(root.querySelector("#runtime-status")?.textContent).toBe("Live: synced");
    expect(root.querySelector("#trace-viewer")).not.toBeNull();
    handle.dispose();
  });

  it("automatically executes a newer snapshot from the active tab source", async () => {
    const root = document.createElement("main");
    const source = fakeActiveTabSourceFactory();
    const first = snapshot();
    const second = snapshot({
      code: "class Solution:\n    def one(self, value):\n        return value + 1\n"
    });
    const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));

    const handle = renderSidePanel(root, {
      controller: { execute },
      activeTabSourceFactory: source.factory,
      liveDebounceMs: 0
    });

    source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
    source.callbacks().onSnapshot({ tabId: 11, snapshot: first });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    source.callbacks().onSnapshot({ tabId: 11, snapshot: second });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]?.[0].sourceCode).toBe(second.code);
    handle.dispose();
  });

  it("automatically executes the selected testcase case", async () => {
    const root = document.createElement("main");
    const source = fakeActiveTabSourceFactory();
    const current = snapshot({ testcase: "7\n8\n9" });
    const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));

    const handle = renderSidePanel(root, {
      controller: { execute },
      activeTabSourceFactory: source.factory,
      liveDebounceMs: 0
    });

    source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
    source.callbacks().onSnapshot({ tabId: 11, snapshot: current });
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
    const source = fakeActiveTabSourceFactory();
    const initial = snapshot();
    const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));

    const handle = renderSidePanel(root, {
      controller: { execute },
      activeTabSourceFactory: source.factory,
      liveDebounceMs: 0
    });

    source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
    source.callbacks().onSnapshot({ tabId: 11, snapshot: initial });
    await vi.waitFor(() => expect(root.querySelector("#trace-viewer")).not.toBeNull());

    source.callbacks().onSnapshot({
      tabId: 11,
      snapshot: {
        ...initial,
        code: "class Solution:\n    def one(self, value):"
      }
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
    const source = fakeActiveTabSourceFactory();
    const current = snapshot();
    const execute = vi.fn(async (request: ExecutionRequest): Promise<TraceSession> => ({
      ...completedSession(request),
      status: sessionStatus,
      terminationReason
    }));

    const handle = renderSidePanel(root, {
      controller: { execute },
      activeTabSourceFactory: source.factory,
      liveDebounceMs: 0
    });

    source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
    source.callbacks().onSnapshot({ tabId: 11, snapshot: current });
    await vi.waitFor(() =>
      expect(root.querySelector("#runtime-status")?.textContent).toBe(expectedText)
    );
    expect(root.querySelector("#trace-viewer")).not.toBeNull();
    handle.dispose();
  });

  it("prevents the old tab execution from overwriting a newly owned tab", async () => {
    const root = document.createElement("main");
    const source = fakeActiveTabSourceFactory();
    const first = deferred<TraceSession>();
    const requests: ExecutionRequest[] = [];
    const execute = vi.fn((request: ExecutionRequest) => {
      requests.push(request);
      return requests.length === 1
        ? first.promise
        : Promise.resolve(completedSession(request));
    });
    const handle = renderSidePanel(root, {
      controller: { execute },
      activeTabSourceFactory: source.factory,
      liveDebounceMs: 0
    });

    const binary = snapshot({
      code: "class Solution:\n    def search(self, value):\n        return value\n",
      metadata: { slug: "binary-search", title: "Binary Search" }
    });
    const twoSum = snapshot({
      code: "class Solution:\n    def twoSum(self, value):\n        return value\n",
      metadata: { slug: "two-sum", title: "Two Sum" }
    });

    source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
    source.callbacks().onSnapshot({ tabId: 11, snapshot: binary });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    source.callbacks().onOwnershipInvalidated();
    source.callbacks().onStateChange({ kind: "leetcode", tabId: 22 });
    source.callbacks().onSnapshot({ tabId: 22, snapshot: twoSum });

    first.resolve(completedSession(requests[0]!));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.value).toBe(twoSum.code)
    );

    expect(root.querySelector<HTMLTextAreaElement>("#source-code")?.value).toBe(twoSum.code);
    handle.dispose();
  });

  it("pauses without clearing the last visualization and resumes on the next LeetCode owner", async () => {
    const root = document.createElement("main");
    const source = fakeActiveTabSourceFactory();
    const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));
    const handle = renderSidePanel(root, {
      controller: { execute },
      activeTabSourceFactory: source.factory,
      liveDebounceMs: 0
    });

    source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
    source.callbacks().onSnapshot({ tabId: 11, snapshot: snapshot() });
    await vi.waitFor(() => expect(root.querySelector("#trace-viewer")).not.toBeNull());

    source.callbacks().onOwnershipInvalidated();
    source.callbacks().onStateChange({ kind: "paused" });
    expect(root.querySelector("#runtime-status")?.textContent)
      .toBe("Live: paused · No active LeetCode tab");
    expect(root.querySelector("#trace-viewer")).not.toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);

    const resumed = snapshot({ testcase: "8" });
    source.callbacks().onOwnershipInvalidated();
    source.callbacks().onStateChange({ kind: "leetcode", tabId: 22 });
    source.callbacks().onSnapshot({ tabId: 22, snapshot: resumed });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]?.[0].rawTestcase).toBe("8");
    handle.dispose();
  });

  it("Run now refreshes the exact owned tab snapshot and executes it immediately", async () => {
    const root = document.createElement("main");
    const source = fakeActiveTabSourceFactory();
    const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));
    const handle = renderSidePanel(root, {
      controller: { execute },
      activeTabSourceFactory: source.factory,
      liveDebounceMs: 1_000
    });

    source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
    source.callbacks().onSnapshot({ tabId: 11, snapshot: snapshot({ testcase: "7" }) });
    source.refresh.mockResolvedValue({
      tabId: 11,
      snapshot: snapshot({ testcase: "8" })
    });

    root.querySelector<HTMLButtonElement>("#run")?.click();

    await vi.waitFor(() => expect(source.refresh).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0]?.[0].rawTestcase).toBe("8");
    handle.dispose();
  });

  it("shows a current active-source error without clearing the existing visualization", async () => {
    const root = document.createElement("main");
    const source = fakeActiveTabSourceFactory();
    const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));
    const handle = renderSidePanel(root, {
      controller: { execute },
      activeTabSourceFactory: source.factory,
      liveDebounceMs: 0
    });

    source.callbacks().onStateChange({ kind: "leetcode", tabId: 11 });
    source.callbacks().onSnapshot({ tabId: 11, snapshot: snapshot() });
    await vi.waitFor(() => expect(root.querySelector("#trace-viewer")).not.toBeNull());

    source.callbacks().onError(new Error("No valid LeetCode snapshot was returned"));
    expect(root.querySelector("#runtime-status")?.textContent)
      .toBe("Live: No valid LeetCode snapshot was returned");
    expect(root.querySelector("#trace-viewer")).not.toBeNull();
    handle.dispose();
  });

  it("turns a missing content receiver error into actionable recovery guidance", () => {
    const root = document.createElement("main");
    const source = fakeActiveTabSourceFactory();
    const handle = renderSidePanel(root, {
      controller: { execute: vi.fn() },
      activeTabSourceFactory: source.factory
    });

    source.callbacks().onError(
      new Error("Could not establish connection. Receiving end does not exist.")
    );

    expect(root.querySelector("#runtime-status")?.textContent).toBe(
      "Live: Unable to connect to the LeetCode page. Refresh the LeetCode tab and reopen the side panel."
    );
    handle.dispose();
  });

  it("disposes the active tab source and persistent controller", () => {
    const root = document.createElement("main");
    const source = fakeActiveTabSourceFactory();
    const controllerDispose = vi.fn();
    const handle = renderSidePanel(root, {
      controller: { execute: vi.fn(), dispose: controllerDispose },
      activeTabSourceFactory: source.factory
    });

    handle.dispose();

    expect(source.dispose).toHaveBeenCalledTimes(1);
    expect(controllerDispose).toHaveBeenCalledTimes(1);
  });
});

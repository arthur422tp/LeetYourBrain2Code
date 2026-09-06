import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExecutionRequest,
  TerminationReason,
  TraceSessionStatus
} from "../../src/shared/execution-types";
import type { TraceSession } from "../../src/shared/trace-types";
import {
  LiveExecutionScheduler,
  type LiveStatus
} from "../../src/execution/live-execution-scheduler";

const source = `class Solution:
    def one(self, value):
        return value
`;

function reasonFor(status: TraceSessionStatus): TerminationReason {
  switch (status) {
    case "completed": return "normal_return";
    case "timeout": return "hard_timeout";
    case "exception": return "runtime_exception";
    case "trace_limit": return "step_limit";
    case "parse_error": return "syntax_error";
    case "input_error": return "unsupported_testcase_format";
    case "internal_error": return "tracer_internal_error";
    case "running": return "tracer_internal_error";
  }
}

function makeSession(
  request: ExecutionRequest,
  status: Exclude<TraceSessionStatus, "running"> = "completed"
): TraceSession {
  return {
    schemaVersion: 1,
    sessionId: request.sessionId,
    sourceCode: request.sourceCode,
    rawTestcase: request.rawTestcase,
    entrypoint: request.entrypoint,
    executionEnvironment: { runtime: "pyodide", pythonVersion: "unknown" },
    status,
    terminationReason: reasonFor(status),
    events: [],
    stdout: "",
    limits: request.limits
  };
}

function input(overrides: Partial<{
  language: string;
  sourceCode: string;
  rawTestcase: string;
  selectedCaseIndex: number;
}> = {}) {
  return {
    language: "python",
    sourceCode: source,
    rawTestcase: "7",
    selectedCaseIndex: 0,
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("LiveExecutionScheduler", () => {
  it("waits 200 ms before executing the latest runnable draft", async () => {
    const execute = vi.fn(async (request: ExecutionRequest) => makeSession(request));
    const statuses: LiveStatus[] = [];
    const sessions: TraceSession[] = [];
    let id = 0;
    const scheduler = new LiveExecutionScheduler({
      runner: { execute },
      createSessionId: () => `live-${++id}`,
      onStatusChange: (status) => statuses.push(status),
      onSession: (session) => sessions.push(session)
    });

    scheduler.schedule(input());
    await vi.advanceTimersByTimeAsync(199);
    expect(execute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(sessions).toHaveLength(1);
    expect(statuses.at(-1)).toBe("synced");
  });

  it("keeps one execution running and collapses intermediate revisions", async () => {
    const first = deferred<TraceSession>();
    const requests: ExecutionRequest[] = [];
    const execute = vi.fn((request: ExecutionRequest) => {
      requests.push(request);
      return requests.length === 1
        ? first.promise
        : Promise.resolve(makeSession(request));
    });
    const rendered: TraceSession[] = [];
    let id = 0;
    const scheduler = new LiveExecutionScheduler({
      runner: { execute },
      createSessionId: () => `live-${++id}`,
      debounceMs: 0,
      onSession: (session) => rendered.push(session)
    });

    scheduler.schedule(input({ rawTestcase: "1" }));
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(1);

    scheduler.schedule(input({ rawTestcase: "2" }));
    scheduler.schedule(input({ rawTestcase: "3" }));
    scheduler.schedule(input({ rawTestcase: "4" }));
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(1);

    first.resolve(makeSession(requests[0]!));
    await Promise.resolve();
    await Promise.resolve();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(requests[1]?.rawTestcase).toBe("4");
    expect(rendered.map((session) => session.rawTestcase)).toEqual(["4"]);
  });

  it("marks an incomplete latest revision as editing without starting it", async () => {
    const execute = vi.fn(async (request: ExecutionRequest) => makeSession(request));
    const statuses: LiveStatus[] = [];
    let id = 0;
    const scheduler = new LiveExecutionScheduler({
      runner: { execute },
      createSessionId: () => `live-${++id}`,
      debounceMs: 0,
      onStatusChange: (status) => statuses.push(status)
    });

    scheduler.schedule(input());
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(1);

    scheduler.schedule(input({
      sourceCode: "class Solution:\n    def one(self, value):"
    }));
    await vi.runAllTimersAsync();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe("editing");
  });

  it("renders the last runnable result after a newer invalid edit without leaving editing state", async () => {
    const running = deferred<TraceSession>();
    let captured!: ExecutionRequest;
    const statuses: LiveStatus[] = [];
    const rendered: TraceSession[] = [];
    const scheduler = new LiveExecutionScheduler({
      runner: {
        execute: (request) => {
          captured = request;
          return running.promise;
        }
      },
      createSessionId: () => "live-1",
      debounceMs: 0,
      onStatusChange: (status) => statuses.push(status),
      onSession: (session) => rendered.push(session)
    });

    scheduler.schedule(input());
    await vi.runAllTimersAsync();
    scheduler.schedule(input({
      sourceCode: "class Solution:\n    def one(self, value):"
    }));
    await vi.runAllTimersAsync();
    expect(statuses.at(-1)).toBe("editing");

    running.resolve(makeSession(captured));
    await Promise.resolve();
    await Promise.resolve();

    expect(rendered).toHaveLength(1);
    expect(statuses.at(-1)).toBe("editing");
  });

  it("executes only the selected testcase case", async () => {
    const requests: ExecutionRequest[] = [];
    const scheduler = new LiveExecutionScheduler({
      runner: {
        execute: async (request) => {
          requests.push(request);
          return makeSession(request);
        }
      },
      createSessionId: () => "case-run",
      debounceMs: 0
    });

    scheduler.schedule(input({ rawTestcase: "7\n8\n9", selectedCaseIndex: 1 }));
    await vi.runAllTimersAsync();
    expect(requests[0]?.rawTestcase).toBe("8");
  });

  it("suppresses identical inputs but allows a forced immediate retry", async () => {
    const execute = vi.fn(async (request: ExecutionRequest) => makeSession(request));
    let id = 0;
    const scheduler = new LiveExecutionScheduler({
      runner: { execute },
      createSessionId: () => `run-${++id}`,
      debounceMs: 0
    });

    scheduler.schedule(input());
    await vi.runAllTimersAsync();
    scheduler.schedule(input());
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(1);

    scheduler.schedule(input(), { immediate: true, force: true });
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not execute a non-Python snapshot", async () => {
    const execute = vi.fn();
    const statuses: LiveStatus[] = [];
    const scheduler = new LiveExecutionScheduler({
      runner: { execute },
      createSessionId: () => "java-run",
      debounceMs: 0,
      onStatusChange: (status) => statuses.push(status)
    });

    scheduler.schedule(input({ language: "java" }));
    await vi.runAllTimersAsync();
    expect(execute).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("editing");
  });

  it.each([
    ["completed", "synced"],
    ["timeout", "timeout"],
    ["exception", "runtime_error"],
    ["internal_error", "runtime_error"],
    ["trace_limit", "runtime_error"]
  ] as const)("maps %s sessions to %s", async (sessionStatus, expectedLiveStatus) => {
    const statuses: LiveStatus[] = [];
    const scheduler = new LiveExecutionScheduler({
      runner: {
        execute: async (request) => makeSession(request, sessionStatus)
      },
      createSessionId: () => `status-${sessionStatus}`,
      debounceMs: 0,
      onStatusChange: (status) => statuses.push(status)
    });

    scheduler.schedule(input());
    await vi.runAllTimersAsync();
    expect(statuses.at(-1)).toBe(expectedLiveStatus);
  });

  it("invalidates a running result without emitting a replacement status", async () => {
    const running = deferred<TraceSession>();
    let captured!: ExecutionRequest;
    const rendered: TraceSession[] = [];
    const statuses: LiveStatus[] = [];
    const scheduler = new LiveExecutionScheduler({
      runner: {
        execute: (request) => {
          captured = request;
          return running.promise;
        }
      },
      createSessionId: () => "running-before-tab-switch",
      debounceMs: 0,
      onStatusChange: (status) => statuses.push(status),
      onSession: (session) => rendered.push(session)
    });

    scheduler.schedule(input());
    await vi.runAllTimersAsync();
    const statusCountBeforeInvalidate = statuses.length;

    const invalidationRevision = scheduler.invalidate();
    expect(invalidationRevision).toBeGreaterThan(0);
    expect(statuses).toHaveLength(statusCountBeforeInvalidate);

    running.resolve(makeSession(captured));
    await Promise.resolve();
    await Promise.resolve();

    expect(rendered).toEqual([]);
  });

  it("keeps an older in-flight result stale after the latest source revision becomes non-runnable", async () => {
    const running = deferred<TraceSession>();
    let captured!: ExecutionRequest;
    const rendered: TraceSession[] = [];
    const statuses: LiveStatus[] = [];
    const scheduler = new LiveExecutionScheduler({
      runner: {
        execute: (request) => {
          captured = request;
          return running.promise;
        }
      },
      createSessionId: () => "running-before-waiting-testcase",
      debounceMs: 0,
      onStatusChange: (status) => statuses.push(status),
      onSession: (session) => rendered.push(session)
    });

    scheduler.schedule(input({
      sourceCode: "class Solution:\n    def one(self, value):\n        return value\n",
      rawTestcase: "7"
    }));
    await vi.runAllTimersAsync();
    expect(captured.sourceCode).toContain("return value");

    const statusCountBeforeInvalidate = statuses.length;
    scheduler.invalidate();
    expect(statuses).toHaveLength(statusCountBeforeInvalidate);

    running.resolve(makeSession(captured));
    await Promise.resolve();
    await Promise.resolve();

    expect(rendered).toEqual([]);
    expect(statuses).toHaveLength(statusCountBeforeInvalidate);
  });

  it("clears debounced and pending work on invalidation", async () => {
    const first = deferred<TraceSession>();
    const requests: ExecutionRequest[] = [];
    let sessionId = 0;
    const scheduler = new LiveExecutionScheduler({
      runner: {
        execute: (request) => {
          requests.push(request);
          return requests.length === 1
            ? first.promise
            : Promise.resolve(makeSession(request));
        }
      },
      createSessionId: () => `invalidate-${++sessionId}`,
      debounceMs: 25
    });

    scheduler.schedule(input({ rawTestcase: "1" }));
    await vi.advanceTimersByTimeAsync(25);
    expect(requests).toHaveLength(1);

    scheduler.schedule(input({ rawTestcase: "2" }));
    await vi.advanceTimersByTimeAsync(25);
    scheduler.schedule(input({ rawTestcase: "3" }));
    scheduler.invalidate();
    await vi.advanceTimersByTimeAsync(25);

    first.resolve(makeSession(requests[0]!));
    await Promise.resolve();
    await Promise.resolve();

    expect(requests.map((request) => request.rawTestcase)).toEqual(["1"]);
  });

  it("allows the same execution input after ownership invalidation", async () => {
    const execute = vi.fn(async (request: ExecutionRequest) => makeSession(request));
    let id = 0;
    const scheduler = new LiveExecutionScheduler({
      runner: { execute },
      createSessionId: () => `same-input-${++id}`,
      debounceMs: 0
    });

    scheduler.schedule(input());
    await vi.runAllTimersAsync();
    scheduler.schedule(input());
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(1);

    scheduler.invalidate();
    scheduler.schedule(input());
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

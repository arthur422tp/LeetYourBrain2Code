# Live Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將目前需要手動點擊 `Visualize` 的 LeetCode Python execution visualizer 改成 near-real-time Live Visualization：code、testcase 或 selected case 改變後，自動執行最新可執行 revision，並可靠更新 Side Panel visualization。

**Architecture:** 保留現有 `LeetCode snapshot → ExecutionRequest → ExecutionController → Pyodide Worker → TraceSession → TraceVisualizer` pipeline，在 snapshot 與 execution 之間新增 `LiveExecutionScheduler`，負責 `200 ms` debounce、monotonic revision、latest-wins、single-flight 與 last-runnable semantics。同時把 `ExecutionController` 從 per-request Worker 改為 lazy persistent Worker；正常 execution 間重用 warmed Pyodide，hard timeout、worker error、unrecoverable protocol error 或 initialization failure 才丟棄並重建 Worker。

**Tech Stack:** TypeScript 5.8, Chrome Manifest V3, Vite 6, Vitest 3, Web Worker, bundled Pyodide 0.29, vanilla DOM Side Panel UI.

**Spec:** `docs/superpowers/specs/2026-09-06-live-visualization-design.md`

## Global Constraints

- Live scheduler debounce 固定為 `200 ms`；本階段不做 adaptive debounce。
- 現有 MAIN-world page-state polling 約 `300 ms` 保留；不改成 Monaco `onDidChangeContent`。
- Scheduler 同時間最多 `1` 個 running execution，最多 `1` 個 latest pending execution；禁止建立 FIFO queue。
- Source code、完整 testcase text、selected case index、language 任一改變都形成新的 execution-input revision。
- stale execution result 不得覆蓋較新 runnable revision 的 visualization。
- incomplete / temporarily unrunnable code 必須保留 last rendered visualization，live status 改為 `editing`，不得清空結果區。
- 正常連續 execution 必須重用 warmed Pyodide Worker；hard timeout、worker `error`、unrecoverable protocol error、initialization failure 必須使 Worker unhealthy。
- Request 的 `hardTimeoutMs` 從 `ExecutionController.execute()` 開始計時，包含首次 Worker/Pyodide initialization；不得讓 initialization 無限等待。
- Python runtime exception（例如 `IndexError`、`KeyError`）只是單次 request terminal result，不得因此重建 Worker。
- Persistent Worker 只能重用 Pyodide VM；每個 request 必須維持新的 user execution namespace。
- `sessionId` 只負責 worker protocol correlation；Live scheduling 的 revision 不加入 `TraceEvent`、`ExecutionRequest` 或 worker wire protocol。
- `Previous / Next / Play` 與現有 trace inspection 全部保留。
- 本計畫不新增 Tree / Graph / Linked List / DP table visualizer，不新增 expression-level stepping，不做 AI inference，不大改 UI layout。

---

## File Structure

```text
src/
├── execution/
│   ├── execution-controller.ts             # modify
│   ├── testcase-selection.ts               # create
│   └── live-execution-scheduler.ts          # create
├── sidepanel/
│   ├── bootstrap.ts                        # modify
│   └── styles.css                          # modify
├── worker/
│   ├── pyodide-worker.ts                   # normally unchanged
│   └── pyodide-runtime.ts                  # normally unchanged
└── shared/
    └── worker-protocol.ts                  # unchanged contract

tests/
├── execution/
│   ├── testcase-selection.test.ts          # create
│   ├── live-execution-scheduler.test.ts     # create
│   ├── execution-controller.test.ts        # create
│   ├── trace-session-collector.test.ts      # modify
│   ├── pyodide-worker.test.ts               # modify
│   └── pyodide-runtime.test.ts              # modify
└── sidepanel/
    └── bootstrap.test.ts                    # modify

README.md                                    # modify
README.zh-TW.md                              # modify
```

`testcase-selection.ts` owns source-aware testcase grouping. `live-execution-scheduler.ts` owns interaction-level scheduling only. `execution-controller.ts` owns one `ExecutionRequest → TraceSession` execution plus Worker lifecycle only.

---

### Task 1: Extract Shared Testcase Selection

**Files:**
- Create: `src/execution/testcase-selection.ts`
- Create: `tests/execution/testcase-selection.test.ts`
- Modify: `src/sidepanel/bootstrap.ts` — testcase helper imports and local helper removal

**Interfaces:**

```ts
export function getTestcaseCases(
  sourceCode: string,
  rawTestcase: string
): string[];

export function getSelectedTestcase(
  sourceCode: string,
  rawTestcase: string,
  selectedCaseIndex: number
): string | null;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/execution/testcase-selection.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  getSelectedTestcase,
  getTestcaseCases
} from "../../src/execution/testcase-selection";

const oneArgSource = `class Solution:
    def one(self, value):
        return value
`;

const twoArgSource = `class Solution:
    def add(self, left, right):
        return left + right
`;

describe("testcase selection", () => {
  it("groups testcase text using the resolved parameter count", () => {
    expect(getTestcaseCases(oneArgSource, "7\n8\n9")).toEqual(["7", "8", "9"]);
    expect(getTestcaseCases(twoArgSource, "1\n2\n3\n4")).toEqual(["1\n2", "3\n4"]);
  });

  it("returns the selected case or null for an unavailable index", () => {
    expect(getSelectedTestcase(oneArgSource, "7\n8\n9", 1)).toBe("8");
    expect(getSelectedTestcase(oneArgSource, "7\n8\n9", 3)).toBeNull();
  });

  it("returns no cases while the Solution entrypoint is incomplete", () => {
    expect(getTestcaseCases("class Solution:\n    pass", "7")).toEqual([]);
    expect(getSelectedTestcase("class Solution:\n    pass", "7", 0)).toBeNull();
  });

  it("returns no cases when argument lines cannot form complete groups", () => {
    expect(getTestcaseCases(twoArgSource, "1\n2\n3")).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify the test fails**

```bash
npm test -- testcase-selection
```

Expected: FAIL because `src/execution/testcase-selection.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/execution/testcase-selection.ts`:

```ts
import { resolveEntrypoint } from "./entrypoint-resolver";
import { splitTestcaseIntoCases } from "./testcase-parser";

export function getTestcaseCases(
  sourceCode: string,
  rawTestcase: string
): string[] {
  const resolution = resolveEntrypoint(sourceCode);
  if (!resolution.ok) {
    return [];
  }

  const result = splitTestcaseIntoCases(
    rawTestcase,
    resolution.entrypoint.parameterCount
  );
  return result.ok ? result.cases : [];
}

export function getSelectedTestcase(
  sourceCode: string,
  rawTestcase: string,
  selectedCaseIndex: number
): string | null {
  return getTestcaseCases(sourceCode, rawTestcase)[selectedCaseIndex] ?? null;
}
```

- [ ] **Step 4: Reuse the helper from `bootstrap.ts`**

Remove these imports:

```ts
import { resolveEntrypoint } from "../execution/entrypoint-resolver";
import { splitTestcaseIntoCases } from "../execution/testcase-parser";
```

Remove the local `getTestcaseCases()` and `getSelectedTestcase()` definitions. Add:

```ts
import {
  getSelectedTestcase,
  getTestcaseCases
} from "../execution/testcase-selection";
```

- [ ] **Step 5: Verify Task 1**

```bash
npm test -- testcase-selection bootstrap
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/execution/testcase-selection.ts \
  src/sidepanel/bootstrap.ts \
  tests/execution/testcase-selection.test.ts
git commit -m "refactor: share testcase selection logic"
```

---

### Task 2: Add `LiveExecutionScheduler`

**Files:**
- Create: `src/execution/live-execution-scheduler.ts`
- Create: `tests/execution/live-execution-scheduler.test.ts`

**Interfaces:**

```ts
export const DEFAULT_LIVE_DEBOUNCE_MS = 200;

export type LiveStatus =
  | "editing"
  | "updating"
  | "synced"
  | "runtime_error"
  | "timeout";

export interface LiveExecutionInput {
  language: string;
  sourceCode: string;
  rawTestcase: string;
  selectedCaseIndex: number;
}

export interface LiveExecutionRunner {
  execute(request: ExecutionRequest): Promise<TraceSession>;
}

export interface LiveExecutionSchedulerOptions {
  runner: LiveExecutionRunner;
  createSessionId: () => string;
  debounceMs?: number;
  onStatusChange?: (status: LiveStatus) => void;
  onSession?: (session: TraceSession) => void;
}

export interface LiveScheduleOptions {
  immediate?: boolean;
  force?: boolean;
}

export class LiveExecutionScheduler {
  constructor(options: LiveExecutionSchedulerOptions);
  schedule(input: LiveExecutionInput, options?: LiveScheduleOptions): number;
  dispose(): void;
}
```

- [ ] **Step 1: Create deterministic test helpers**

Start `tests/execution/live-execution-scheduler.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExecutionRequest,
  TraceSessionStatus,
  TerminationReason
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
```

- [ ] **Step 2: Write the 200 ms debounce test**

```ts
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
});
```

- [ ] **Step 3: Verify the scheduler test fails**

```bash
npm test -- live-execution-scheduler
```

Expected: FAIL because `LiveExecutionScheduler` does not exist.

- [ ] **Step 4: Add the single-flight/latest-wins test**

```ts
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
```

- [ ] **Step 5: Add last-runnable/incomplete-code tests**

```ts
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
```

- [ ] **Step 6: Add selected-case, duplicate, forced-run and language tests**

```ts
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
```

- [ ] **Step 7: Add terminal-status mapping tests**

```ts
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
```

- [ ] **Step 8: Implement the scheduler**

Create `src/execution/live-execution-scheduler.ts`:

```ts
import type { ExecutionRequest } from "../shared/execution-types";
import type { TraceSession } from "../shared/trace-types";
import { createExecutionRequest } from "./execution-request";
import { getSelectedTestcase } from "./testcase-selection";

export const DEFAULT_LIVE_DEBOUNCE_MS = 200;

export type LiveStatus =
  | "editing"
  | "updating"
  | "synced"
  | "runtime_error"
  | "timeout";

export interface LiveExecutionInput {
  language: string;
  sourceCode: string;
  rawTestcase: string;
  selectedCaseIndex: number;
}

export interface LiveExecutionRunner {
  execute(request: ExecutionRequest): Promise<TraceSession>;
}

export interface LiveExecutionSchedulerOptions {
  runner: LiveExecutionRunner;
  createSessionId: () => string;
  debounceMs?: number;
  onStatusChange?: (status: LiveStatus) => void;
  onSession?: (session: TraceSession) => void;
}

export interface LiveScheduleOptions {
  immediate?: boolean;
  force?: boolean;
}

interface AcceptedRun {
  revision: number;
  request: ExecutionRequest;
}

function inputKey(input: LiveExecutionInput): string {
  return JSON.stringify([
    input.language,
    input.sourceCode,
    input.rawTestcase,
    input.selectedCaseIndex
  ]);
}

function liveStatusFor(session: TraceSession): LiveStatus {
  if (session.status === "completed") return "synced";
  if (session.status === "timeout") return "timeout";
  return "runtime_error";
}

export class LiveExecutionScheduler {
  private readonly runner: LiveExecutionRunner;
  private readonly createSessionId: () => string;
  private readonly debounceMs: number;
  private readonly onStatusChange?: (status: LiveStatus) => void;
  private readonly onSession?: (session: TraceSession) => void;

  private revision = 0;
  private latestRevision = 0;
  private latestRunnableRevision = 0;
  private latestInputKey: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: AcceptedRun | null = null;
  private pending: AcceptedRun | null = null;
  private currentStatus: LiveStatus | null = null;
  private disposed = false;

  public constructor(options: LiveExecutionSchedulerOptions) {
    this.runner = options.runner;
    this.createSessionId = options.createSessionId;
    this.debounceMs = options.debounceMs ?? DEFAULT_LIVE_DEBOUNCE_MS;
    this.onStatusChange = options.onStatusChange;
    this.onSession = options.onSession;
  }

  public schedule(
    input: LiveExecutionInput,
    options: LiveScheduleOptions = {}
  ): number {
    if (this.disposed) return this.latestRevision;

    const key = inputKey(input);
    if (!options.force && key === this.latestInputKey) {
      return this.latestRevision;
    }

    this.latestInputKey = key;
    const revision = ++this.revision;
    this.latestRevision = revision;
    this.clearTimer();
    this.emitStatus("updating");

    if (options.immediate) {
      this.accept(revision, input);
    } else {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.accept(revision, input);
      }, this.debounceMs);
    }
    return revision;
  }

  public dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.pending = null;
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private emitStatus(status: LiveStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    this.onStatusChange?.(status);
  }

  private accept(revision: number, input: LiveExecutionInput): void {
    if (this.disposed || revision !== this.latestRevision) return;

    if (input.language !== "python") {
      this.pending = null;
      this.emitStatus("editing");
      return;
    }

    const selectedTestcase = getSelectedTestcase(
      input.sourceCode,
      input.rawTestcase,
      input.selectedCaseIndex
    );
    if (selectedTestcase === null) {
      this.pending = null;
      this.emitStatus("editing");
      return;
    }

    const built = createExecutionRequest({
      sessionId: this.createSessionId(),
      sourceCode: input.sourceCode,
      rawTestcase: selectedTestcase
    });
    if (!built.ok) {
      this.pending = null;
      this.emitStatus("editing");
      return;
    }

    this.latestRunnableRevision = revision;
    this.pending = { revision, request: built.request };
    this.emitStatus("updating");
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.running !== null || this.pending === null) return;

    const run = this.pending;
    this.pending = null;
    this.running = run;

    try {
      const session = await this.runner.execute(run.request);
      if (this.disposed) return;

      if (run.revision === this.latestRunnableRevision) {
        this.onSession?.(session);
      }
      if (run.revision === this.latestRevision) {
        this.emitStatus(liveStatusFor(session));
      }
    } catch {
      if (!this.disposed && run.revision === this.latestRevision) {
        this.emitStatus("runtime_error");
      }
    } finally {
      if (this.running?.revision === run.revision) {
        this.running = null;
      }
      if (!this.disposed && this.pending !== null) {
        this.emitStatus("updating");
        void this.drain();
      }
    }
  }
}
```

- [ ] **Step 9: Verify Task 2**

```bash
npm test -- live-execution-scheduler
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/execution/live-execution-scheduler.ts \
  tests/execution/live-execution-scheduler.test.ts
git commit -m "feat: schedule live executions"
```

---

### Task 3: Reuse a Warm Worker in `ExecutionController`

**Files:**
- Modify: `src/execution/execution-controller.ts` — full Worker lifecycle
- Create: `tests/execution/execution-controller.test.ts`
- Modify: `tests/execution/trace-session-collector.test.ts` — normal completion no longer auto-terminates Worker

**Interfaces:**

```ts
export class ExecutionController {
  execute(request: ExecutionRequest): Promise<TraceSession>;
  dispose(): void;
}
```

`execute()` still rejects if another request is active.

- [ ] **Step 1: Create the controllable Worker test double**

Create `tests/execution/execution-controller.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import type {
  ExecutionRequest,
  ExecutionTerminalResult
} from "../../src/shared/execution-types";
import {
  ExecutionController,
  type WorkerLike
} from "../../src/execution/execution-controller";

function request(sessionId: string, hardTimeoutMs = 1_000): ExecutionRequest {
  return {
    sessionId,
    sourceCode: "class Solution:\n    def one(self, value):\n        return value",
    rawTestcase: "1",
    entrypoint: { className: "Solution", methodName: "one", parameterCount: 1 },
    limits: {
      maxTraceSteps: 100,
      maxContainerItems: 100,
      maxNestingDepth: 8,
      maxSnapshotBytes: 10_000,
      maxSessionBytes: 100_000,
      maxStdoutBytes: 1_000,
      hardTimeoutMs
    }
  };
}

const completed: ExecutionTerminalResult = {
  status: "completed",
  terminationReason: "normal_return",
  stdout: "",
  durationMs: 1
};

class ControlledWorker implements WorkerLike {
  readonly posted: unknown[] = [];
  terminateCount = 0;
  private messageListeners: Array<(event: MessageEvent) => void> = [];
  private errorListeners: Array<(event: ErrorEvent) => void> = [];

  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "message" | "error", listener: any): void {
    if (type === "message") this.messageListeners.push(listener);
    else this.errorListeners.push(listener);
  }

  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message" | "error", listener: any): void {
    if (type === "message") {
      this.messageListeners = this.messageListeners.filter((item) => item !== listener);
    } else {
      this.errorListeners = this.errorListeners.filter((item) => item !== listener);
    }
  }

  postMessage(message: any): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emit(data: unknown): void {
    const event = new MessageEvent("message", { data });
    for (const listener of [...this.messageListeners]) listener(event);
  }

  emitError(message: string): void {
    const event = new ErrorEvent("error", { message });
    for (const listener of [...this.errorListeners]) listener(event);
  }
}
```

- [ ] **Step 2: Write the sequential Worker reuse test**

```ts
it("reuses one ready worker across sequential executions", async () => {
  const worker = new ControlledWorker();
  const workerFactory = vi.fn(() => worker);
  const controller = new ExecutionController({ workerFactory });

  const firstPromise = controller.execute(request("one"));
  worker.emit({ type: "ready" });
  await Promise.resolve();
  expect(worker.posted).toContainEqual({ type: "execute", request: request("one") });
  worker.emit({ type: "execution_finished", sessionId: "one", result: completed });
  await expect(firstPromise).resolves.toEqual(expect.objectContaining({ status: "completed" }));

  const secondPromise = controller.execute(request("two"));
  await Promise.resolve();
  expect(worker.posted).toContainEqual({ type: "execute", request: request("two") });
  worker.emit({ type: "execution_finished", sessionId: "two", result: completed });
  await expect(secondPromise).resolves.toEqual(expect.objectContaining({ status: "completed" }));

  expect(workerFactory).toHaveBeenCalledTimes(1);
  expect(worker.terminateCount).toBe(0);
  controller.dispose();
  expect(worker.terminateCount).toBe(1);
});
```

- [ ] **Step 3: Prove `hardTimeoutMs` includes initialization and forces recovery**

```ts
it("times out a request even if the worker never becomes ready and rebuilds on the next run", async () => {
  vi.useFakeTimers();
  try {
    const workers = [new ControlledWorker(), new ControlledWorker()];
    let workerIndex = 0;
    const workerFactory = vi.fn(() => workers[workerIndex++]!);
    const controller = new ExecutionController({ workerFactory });

    const first = controller.execute(request("slow-init", 20));
    await vi.advanceTimersByTimeAsync(20);
    await expect(first).resolves.toEqual(expect.objectContaining({
      status: "timeout",
      terminationReason: "hard_timeout"
    }));
    expect(workers[0]!.terminateCount).toBe(1);

    const second = controller.execute(request("recovered"));
    workers[1]!.emit({ type: "ready" });
    await Promise.resolve();
    workers[1]!.emit({
      type: "execution_finished",
      sessionId: "recovered",
      result: completed
    });
    await expect(second).resolves.toEqual(expect.objectContaining({ status: "completed" }));
    expect(workerFactory).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 4: Add initialization failure, execution error, and malformed-protocol recovery tests**

```ts
it("rebuilds after an initialization worker_error", async () => {
  const workers = [new ControlledWorker(), new ControlledWorker()];
  let workerIndex = 0;
  const controller = new ExecutionController({
    workerFactory: () => workers[workerIndex++]!
  });

  const failed = controller.execute(request("init-failure"));
  workers[0]!.emit({ type: "worker_error", message: "cannot initialize" });
  await expect(failed).resolves.toEqual(expect.objectContaining({
    status: "internal_error",
    terminationReason: "worker_initialization_failed"
  }));
  expect(workers[0]!.terminateCount).toBe(1);

  const recovered = controller.execute(request("after-init-failure"));
  workers[1]!.emit({ type: "ready" });
  await Promise.resolve();
  workers[1]!.emit({
    type: "execution_finished",
    sessionId: "after-init-failure",
    result: completed
  });
  await expect(recovered).resolves.toEqual(expect.objectContaining({ status: "completed" }));
});

it("rebuilds after a worker error event during execution", async () => {
  const workers = [new ControlledWorker(), new ControlledWorker()];
  let workerIndex = 0;
  const controller = new ExecutionController({
    workerFactory: () => workers[workerIndex++]!
  });

  const failed = controller.execute(request("crash"));
  workers[0]!.emit({ type: "ready" });
  await Promise.resolve();
  workers[0]!.emitError("worker crashed");
  await expect(failed).resolves.toEqual(expect.objectContaining({ status: "internal_error" }));
  expect(workers[0]!.terminateCount).toBe(1);

  const recovered = controller.execute(request("after-crash"));
  workers[1]!.emit({ type: "ready" });
  await Promise.resolve();
  workers[1]!.emit({
    type: "execution_finished",
    sessionId: "after-crash",
    result: completed
  });
  await expect(recovered).resolves.toEqual(expect.objectContaining({ status: "completed" }));
});

it("treats malformed worker output as an unrecoverable protocol error", async () => {
  const worker = new ControlledWorker();
  const controller = new ExecutionController({ workerFactory: () => worker });

  const failed = controller.execute(request("malformed"));
  worker.emit({ type: "ready" });
  await Promise.resolve();
  worker.emit({ unexpected: true });

  await expect(failed).resolves.toEqual(expect.objectContaining({ status: "internal_error" }));
  expect(worker.terminateCount).toBe(1);
});
```

- [ ] **Step 5: Prove ordinary Python exceptions keep the Worker healthy**

```ts
it("keeps the worker after an ordinary Python runtime exception", async () => {
  const worker = new ControlledWorker();
  const workerFactory = vi.fn(() => worker);
  const controller = new ExecutionController({ workerFactory });
  const runtimeException: ExecutionTerminalResult = {
    status: "exception",
    terminationReason: "runtime_exception",
    stdout: "",
    durationMs: 1,
    exception: {
      type: "IndexError",
      message: "list index out of range",
      line: 3,
      stack: [],
      frameId: 1
    }
  };

  const first = controller.execute(request("exception"));
  worker.emit({ type: "ready" });
  await Promise.resolve();
  worker.emit({
    type: "execution_finished",
    sessionId: "exception",
    result: runtimeException
  });
  await expect(first).resolves.toEqual(expect.objectContaining({ status: "exception" }));

  const second = controller.execute(request("after-exception"));
  await Promise.resolve();
  worker.emit({
    type: "execution_finished",
    sessionId: "after-exception",
    result: completed
  });
  await expect(second).resolves.toEqual(expect.objectContaining({ status: "completed" }));

  expect(workerFactory).toHaveBeenCalledTimes(1);
  expect(worker.terminateCount).toBe(0);
});
```

- [ ] **Step 6: Implement the persistent controller lifecycle**

Keep the existing `WorkerLike`, `TraceSessionCollector`, and `internalErrorResult()` contracts. Add this internal handle:

```ts
interface WorkerHandle {
  worker: WorkerLike;
  ready: Promise<WorkerLike>;
  cancelReady(error: Error): void;
}
```

Use these fields:

```ts
private readonly workerFactory: () => WorkerLike;
private workerHandle: WorkerHandle | null = null;
private active = false;
private disposed = false;
private abortActive: (() => void) | null = null;
```

Implement `createWorkerHandle()` with temporary initialization listeners. The essential code shape is:

```ts
private createWorkerHandle(): WorkerHandle {
  const worker = this.workerFactory();
  let settled = false;
  let resolveReady!: (worker: WorkerLike) => void;
  let rejectReady!: (error: Error) => void;

  const cleanup = (): void => {
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onError);
  };

  const rejectOnce = (error: Error): void => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectReady(error);
  };

  const onMessage = (event: MessageEvent): void => {
    if (!isWorkerOutboundMessage(event.data)) {
      rejectOnce(new Error("Worker sent malformed initialization message"));
      return;
    }
    const message = event.data;
    if (message.type === "ready") {
      if (settled) return;
      settled = true;
      cleanup();
      resolveReady(worker);
      return;
    }
    if (message.type === "worker_error") {
      rejectOnce(new Error(message.message));
      return;
    }
    rejectOnce(new Error(`Worker sent ${message.type} before ready`));
  };

  const onError = (event: ErrorEvent): void => {
    rejectOnce(new Error(event.message || "Worker initialization failed"));
  };

  const ready = new Promise<WorkerLike>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);

  return { worker, ready, cancelReady: rejectOnce };
}
```

Add:

```ts
private ensureWorker(): Promise<WorkerLike> {
  if (this.disposed) {
    return Promise.reject(new Error("Execution controller is disposed"));
  }
  if (this.workerHandle === null) {
    try {
      this.workerHandle = this.createWorkerHandle();
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return this.workerHandle.ready;
}

private invalidateWorker(reason: Error): void {
  const handle = this.workerHandle;
  this.workerHandle = null;
  if (!handle) return;
  handle.cancelReady(reason);
  handle.worker.terminate();
}
```

Refactor `execute()` so its single request timeout begins **before** awaiting Worker readiness:

```ts
public execute(request: ExecutionRequest): Promise<TraceSession> {
  if (this.disposed) {
    return Promise.reject(new Error("Execution controller is disposed"));
  }
  if (this.active) {
    return Promise.reject(new Error("An execution is already in progress"));
  }
  this.active = true;

  const collector = new TraceSessionCollector({
    sessionId: request.sessionId,
    sourceCode: request.sourceCode,
    rawTestcase: request.rawTestcase,
    entrypoint: request.entrypoint,
    limits: request.limits
  });

  return new Promise<TraceSession>((resolve) => {
    let settled = false;
    let worker: WorkerLike | null = null;
    let onMessage: ((event: MessageEvent) => void) | null = null;
    let onError: ((event: ErrorEvent) => void) | null = null;

    const cleanupExecutionListeners = (): void => {
      if (worker && onMessage) worker.removeEventListener("message", onMessage);
      if (worker && onError) worker.removeEventListener("error", onError);
    };

    const finish = (session: TraceSession, invalidate = false): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      cleanupExecutionListeners();
      this.abortActive = null;
      this.active = false;
      if (invalidate) {
        this.invalidateWorker(new Error("Worker became unhealthy"));
      }
      resolve(session);
    };

    const fail = (message: string, duringInitialization = false): void => {
      finish(
        collector.finish(internalErrorResult(message, duringInitialization)),
        true
      );
    };

    const timeoutId = setTimeout(
      () => finish(collector.forceTimeout(), true),
      request.limits.hardTimeoutMs
    );

    this.abortActive = () => fail("Execution controller disposed");

    void this.ensureWorker()
      .then((readyWorker) => {
        if (settled) return;
        worker = readyWorker;

        onMessage = (event: MessageEvent): void => {
          if (!isWorkerOutboundMessage(event.data)) {
            fail("Worker sent malformed protocol message");
            return;
          }
          const message = event.data;

          if (message.type === "ready") return;
          if (message.type === "trace_batch") {
            if (message.sessionId === request.sessionId) {
              collector.append(message.events);
            }
            return;
          }
          if (message.type === "execution_finished") {
            if (message.sessionId === request.sessionId) {
              finish(
                collector.finish(message.result),
                message.result.terminationReason === "hard_timeout"
              );
            }
            return;
          }
          if (!message.sessionId || message.sessionId === request.sessionId) {
            fail(message.message);
          }
        };

        onError = (event: ErrorEvent): void => {
          fail(event.message || "Worker execution failed");
        };

        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.postMessage({ type: "execute", request });
      })
      .catch((error: unknown) => {
        if (!settled) {
          fail(errorMessage(error), true);
        }
      });
  });
}
```

Add disposal:

```ts
public dispose(): void {
  if (this.disposed) return;
  this.disposed = true;
  this.abortActive?.();
  this.invalidateWorker(new Error("Execution controller disposed"));
}
```

- [ ] **Step 7: Update collector tests for persistent Worker semantics**

In `tests/execution/trace-session-collector.test.ts` keep existing timeout assertions that the worker terminates. For the normal completion test, capture the Worker and add these exact assertions:

```ts
expect(worker?.terminated).toBe(false);
controller.dispose();
expect(worker?.terminated).toBe(true);
```

- [ ] **Step 8: Verify Task 3**

```bash
npm test -- execution-controller trace-session-collector
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/execution/execution-controller.ts \
  tests/execution/execution-controller.test.ts \
  tests/execution/trace-session-collector.test.ts
git commit -m "refactor: reuse warmed pyodide worker"
```

---

### Task 4: Verify Sequential Worker/Runtime Reuse and Namespace Isolation

**Files:**
- Modify: `tests/execution/pyodide-worker.test.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify `src/worker/pyodide-worker.ts` or `src/worker/pyodide-runtime.ts` only if these new regression tests reveal an actual defect

- [ ] **Step 1: Add a sequential worker test**

Append to `tests/execution/pyodide-worker.test.ts`:

```ts
it("forwards multiple sequential requests through one initialized runtime", async () => {
  const listeners: Array<(event: MessageEvent) => void | Promise<void>> = [];
  const posted: unknown[] = [];
  const calls: ExecutionRequest[] = [];
  let initializeCount = 0;
  const runtime: PyodideRuntime = {
    initialize: async () => {
      initializeCount += 1;
    },
    execute: async (received) => {
      calls.push(received);
    }
  };
  const scope: WorkerScopeLike = {
    addEventListener: (_type, listener) => {
      listeners.push(listener);
    },
    removeEventListener: () => undefined,
    postMessage: (message) => {
      posted.push(message);
    }
  };

  installPyodideWorker(scope, runtime);
  await Promise.resolve();

  const first = { ...request, sessionId: "first" };
  const second = { ...request, sessionId: "second" };
  await listeners[0]!(new MessageEvent("message", {
    data: { type: "execute", request: first }
  }));
  await listeners[0]!(new MessageEvent("message", {
    data: { type: "execute", request: second }
  }));

  expect(initializeCount).toBe(1);
  expect(posted[0]).toEqual({ type: "ready" });
  expect(calls.map((item) => item.sessionId)).toEqual(["first", "second"]);
});
```

- [ ] **Step 2: Add the VM reuse / fresh namespace test**

Append to `tests/execution/pyodide-runtime.test.ts`:

```ts
it("loads Pyodide once while rebuilding a fresh runtime namespace for every request", async () => {
  let loadCount = 0;
  const scripts: string[] = [];
  const runtime = createPyodideRuntime({
    loadPyodide: async () => {
      loadCount += 1;
      return {
        runPythonAsync: async (code: string) => {
          scripts.push(code);
          return [1, ""];
        }
      };
    }
  });

  await runtime.initialize();
  await runtime.execute({ ...request, sessionId: "first" });
  await runtime.execute({ ...request, sessionId: "second" });

  expect(loadCount).toBe(1);
  expect(scripts).toHaveLength(2);
  expect(scripts[0]).toContain("__lc_runtime_namespace = {}");
  expect(scripts[1]).toContain("__lc_runtime_namespace = {}");
  expect(scripts[0]).toContain(JSON.stringify("first"));
  expect(scripts[1]).toContain(JSON.stringify("second"));
});
```

- [ ] **Step 3: Run the new tests before modifying Worker/runtime code**

```bash
npm test -- pyodide-worker pyodide-runtime
```

Expected: PASS with the current Worker/runtime design. If either test fails, fix only the specific repeated-execution defect demonstrated by that test, rerun the same command, and keep the existing worker protocol shapes unchanged.

- [ ] **Step 4: Confirm revision metadata did not leak into the protocol**

```bash
npm test -- worker-protocol
```

Then verify `src/shared/worker-protocol.ts` still has exactly these message families:

```ts
{ type: "execute"; request: ExecutionRequest }
{ type: "ready" }
{ type: "trace_batch"; sessionId: string; events: TraceEvent[] }
{ type: "execution_finished"; sessionId: string; result: ExecutionTerminalResult }
{ type: "worker_error"; sessionId?: string; message: string }
```

- [ ] **Step 5: Commit**

```bash
git add tests/execution/pyodide-worker.test.ts \
  tests/execution/pyodide-runtime.test.ts \
  src/worker/pyodide-worker.ts \
  src/worker/pyodide-runtime.ts
git diff --cached --quiet || git commit -m "test: cover repeated pyodide execution"
```

If the source files did not change, `git add` simply leaves them out of the staged diff.

---

### Task 5: Integrate Live Scheduling into the Side Panel

**Files:**
- Modify: `src/sidepanel/bootstrap.ts` — imports, dependencies, scheduling, click handler, cleanup
- Modify: `src/sidepanel/styles.css` — `#runtime-status` state styling only
- Modify: `tests/sidepanel/bootstrap.test.ts`

**Interfaces:**

```ts
export interface SidePanelController {
  execute(request: ExecutionRequest): Promise<TraceSession>;
  dispose?(): void;
}

export interface SidePanelDependencies {
  controller?: SidePanelController;
  snapshotProvider?: () => Promise<LeetCodeSnapshot>;
  snapshotSubscription?: SnapshotSubscription;
  liveDebounceMs?: number;
}

export interface SidePanelHandle {
  dispose(): void;
}

export function renderSidePanel(
  root: HTMLElement,
  dependencies?: SidePanelDependencies
): SidePanelHandle;
```

- [ ] **Step 1: Add a completed-session helper to `bootstrap.test.ts`**

```ts
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
```

- [ ] **Step 2: Add the initial automatic-run test**

```ts
it("automatically visualizes the initial synced Python snapshot", async () => {
  const root = document.createElement("main");
  const snapshot: LeetCodeSnapshot = {
    code: "class Solution:\n    def one(self, value):\n        return value\n",
    language: "python",
    testcase: "7",
    metadata: { slug: "one", title: "One" }
  };
  const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));

  renderSidePanel(root, {
    controller: { execute },
    snapshotProvider: async () => snapshot,
    liveDebounceMs: 0
  });

  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(root.querySelector("#runtime-status")?.textContent).toBe("Live: synced");
  expect(root.querySelector("#trace-viewer")).not.toBeNull();
});
```

- [ ] **Step 3: Add subscription-driven auto-run test**

```ts
it("automatically executes a newer snapshot from the subscription", async () => {
  const root = document.createElement("main");
  const first: LeetCodeSnapshot = {
    code: "class Solution:\n    def one(self, value):\n        return value\n",
    language: "python",
    testcase: "7",
    metadata: { slug: "one", title: "One" }
  };
  const second: LeetCodeSnapshot = {
    ...first,
    code: "class Solution:\n    def one(self, value):\n        return value + 1\n"
  };
  let onSnapshot: ((snapshot: LeetCodeSnapshot) => void) | undefined;
  const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));

  renderSidePanel(root, {
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
});
```

- [ ] **Step 4: Convert the selected-case test to auto-run**

Use a three-case snapshot and assert that changing the `<select>` triggers a second request without clicking `#run`:

```ts
const caseSelector = root.querySelector<HTMLSelectElement>("#testcase-case")!;
caseSelector.value = "1";
caseSelector.dispatchEvent(new Event("change"));

await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
expect(execute.mock.calls[1]?.[0].rawTestcase).toBe("8");
```

The test setup must use:

```ts
snapshot.testcase = "7\n8\n9";
liveDebounceMs = 0;
```

- [ ] **Step 5: Add last-runnable UI preservation test**

```ts
it("keeps the previous visualization while the latest code is incomplete", async () => {
  const root = document.createElement("main");
  const initial: LeetCodeSnapshot = {
    code: "class Solution:\n    def one(self, value):\n        return value\n",
    language: "python",
    testcase: "7",
    metadata: { slug: "one", title: "One" }
  };
  let onSnapshot: ((snapshot: LeetCodeSnapshot) => void) | undefined;
  const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));

  renderSidePanel(root, {
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
});
```

- [ ] **Step 6: Add terminal live-status rendering tests**

```ts
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
  const snapshot: LeetCodeSnapshot = {
    code: "class Solution:\n    def one(self, value):\n        return value\n",
    language: "python",
    testcase: "7",
    metadata: { slug: "one", title: "One" }
  };
  const execute = vi.fn(async (request: ExecutionRequest): Promise<TraceSession> => ({
    ...completedSession(request),
    status: sessionStatus,
    terminationReason
  }));

  renderSidePanel(root, {
    controller: { execute },
    snapshotProvider: async () => snapshot,
    liveDebounceMs: 0
  });

  await vi.waitFor(() =>
    expect(root.querySelector("#runtime-status")?.textContent).toBe(expectedText)
  );
  expect(root.querySelector("#trace-viewer")).not.toBeNull();
});
```

- [ ] **Step 7: Add forced `Run now` test**

```ts
it("Run now fetches the latest snapshot and bypasses the debounce", async () => {
  const root = document.createElement("main");
  const initial: LeetCodeSnapshot = {
    code: "class Solution:\n    def one(self, value):\n        return value\n",
    language: "python",
    testcase: "7",
    metadata: { slug: "one", title: "One" }
  };
  const latest = { ...initial, testcase: "8" };
  const snapshotProvider = vi.fn<() => Promise<LeetCodeSnapshot>>()
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(latest);
  const execute = vi.fn(async (request: ExecutionRequest) => completedSession(request));

  renderSidePanel(root, {
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
});
```

- [ ] **Step 8: Add cleanup test**

```ts
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
```

- [ ] **Step 9: Refactor Side Panel orchestration**

Change `SidePanelController` and dependencies to the interfaces at the top of this task. Import:

```ts
import {
  LiveExecutionScheduler,
  type LiveStatus
} from "../execution/live-execution-scheduler";
import { getTestcaseCases } from "../execution/testcase-selection";
```

Delete the direct `createExecutionRequest` import from `bootstrap.ts`; the scheduler becomes the only component allowed to create requests from live UI input.

Keep:

```ts
let activeVisualizer: TraceVisualizerHandle | null = null;
let currentSnapshot: LeetCodeSnapshot | null = null;
let selectedCaseIndex = 0;
```

Construct the scheduler:

```ts
const scheduler = new LiveExecutionScheduler({
  runner: controller,
  createSessionId,
  debounceMs: dependencies.liveDebounceMs,
  onStatusChange: (liveStatus: LiveStatus) => {
    status.dataset.liveStatus = liveStatus;
    status.textContent = `Live: ${liveStatus}`;
  },
  onSession: (session) => {
    activeVisualizer?.dispose();
    activeVisualizer = createTraceVisualizer(session);
    result.replaceChildren(activeVisualizer.element);
  }
});
```

Add:

```ts
const scheduleCurrent = (
  options: { immediate?: boolean; force?: boolean } = {}
): void => {
  if (!currentSnapshot) return;
  scheduler.schedule({
    language: currentSnapshot.language,
    sourceCode: currentSnapshot.code,
    rawTestcase: currentSnapshot.testcase,
    selectedCaseIndex
  }, options);
};
```

Refactor snapshot application:

```ts
const applySnapshot = (
  snapshot: LeetCodeSnapshot,
  options: { schedule?: boolean } = {}
): void => {
  currentSnapshot = snapshot;
  source.value = snapshot.code;
  testcase.value = snapshot.testcase;
  refreshCaseSelector(snapshot.code, snapshot.testcase);
  if (options.schedule !== false) {
    scheduleCurrent();
  }
};
```

The initial provider path becomes:

```ts
status.textContent = "Live: syncing";
void snapshotProvider()
  .then(applySnapshot)
  .catch((error: unknown) => {
    status.textContent = `Live: ${snapshotErrorText(error)}`;
  });
```

Capture the subscription cleanup:

```ts
const unsubscribeSnapshot = snapshotSubscription?.(applySnapshot);
```

- [ ] **Step 10: Make case changes schedule immediately through the same scheduler**

Use:

```ts
caseSelector.addEventListener("change", () => {
  const nextIndex = Number.parseInt(caseSelector.value, 10);
  selectedCaseIndex = Number.isInteger(nextIndex) && nextIndex >= 0 ? nextIndex : 0;
  scheduleCurrent();
});
```

`refreshCaseSelector()` still preserves the previous index when valid and falls back to `0` when invalid.

- [ ] **Step 11: Replace the old click-driven execution path**

Rename:

```ts
runButton.textContent = "Run now";
```

Delete the old `running` boolean, the old direct `createExecutionRequest()` call, and the old direct `controller.execute()` call. Replace the click listener with:

```ts
runButton.addEventListener("click", () => {
  const runLatest = async (): Promise<void> => {
    if (snapshotProvider) {
      try {
        applySnapshot(await snapshotProvider(), { schedule: false });
      } catch (error: unknown) {
        status.textContent = `Live: ${snapshotErrorText(error)}`;
        return;
      }
    }
    scheduleCurrent({ immediate: true, force: true });
  };
  void runLatest();
});
```

Do not clear `result` when an execution starts or when code becomes incomplete.

- [ ] **Step 12: Add Side Panel cleanup**

Return:

```ts
return {
  dispose(): void {
    unsubscribeSnapshot?.();
    scheduler.dispose();
    activeVisualizer?.dispose();
    activeVisualizer = null;
    controller.dispose?.();
  }
};
```

At module bootstrap use:

```ts
if (typeof document !== "undefined") {
  const handle = renderSidePanel(document.body);
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => handle.dispose(), { once: true });
  }
}
```

- [ ] **Step 13: Update status/placeholder presentation only**

Change the initial status to:

```ts
status.textContent = "Live: not started";
```

Change placeholder text to:

```text
Waiting for a runnable Python draft…
```

Add to `src/sidepanel/styles.css`:

```css
#runtime-status[data-live-status="synced"] {
  color: #166534;
}

#runtime-status[data-live-status="editing"],
#runtime-status[data-live-status="updating"] {
  color: #64748b;
}

#runtime-status[data-live-status="runtime_error"],
#runtime-status[data-live-status="timeout"] {
  color: #b45309;
}
```

Do not alter TraceVisualizer layout.

- [ ] **Step 14: Verify Task 5**

```bash
npm test -- bootstrap live-execution-scheduler
```

Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add src/sidepanel/bootstrap.ts \
  src/sidepanel/styles.css \
  tests/sidepanel/bootstrap.test.ts
git commit -m "feat: enable live visualization"
```

---

### Task 6: Documentation, Full Regression, and Chrome Acceptance

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`

- [ ] **Step 1: Update the English README**

Add near `How it works`:

```md
Live Visualization follows the latest runnable Python draft. When the LeetCode code, testcase, or selected testcase case changes, the Side Panel automatically re-executes after a short debounce. Temporarily incomplete code keeps the previous visualization visible until the draft becomes runnable again; `Run now` remains available as an immediate retry.
```

Replace the flow diagram with:

```text
Current Python code + selected testcase case
                ↓
Live scheduler (debounce + latest-wins)
                ↓
Warm bundled Pyodide Web Worker
                ↓
Ordered line-level execution trace
                ↓
Runtime state + state diff
                ↓
Chrome Side Panel visualization
```

Add:

```md
- [Live Visualization Design Spec](docs/superpowers/specs/2026-09-06-live-visualization-design.md)
- [Live Visualization Implementation Plan](docs/superpowers/plans/2026-09-06-live-visualization-implementation-plan.md)
```

- [ ] **Step 2: Update the Traditional Chinese README**

Add:

```md
Live Visualization 會追蹤目前最新可執行的 Python draft。當 LeetCode 的程式碼、testcase 或目前選中的 testcase case 改變時，Side Panel 會在短暫 debounce 後自動重新執行。若使用者正輸入暫時不完整的程式碼，畫面會保留上一份可執行版本的 visualization，直到新版再次可執行；`Run now` 則保留作為立即重試入口。
```

Use the same updated flow diagram translated only where appropriate; keep Live Visualization, debounce, latest-wins, Pyodide, Web Worker and Side Panel in English.

- [ ] **Step 3: Run full automated verification**

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected:

```text
all Vitest tests pass
tsc exits 0
all Vite builds exit 0
git diff --check produces no output
```

Existing Pyodide browser-externalization warnings are acceptable only if the build still exits `0`.

- [ ] **Step 4: Perform Chrome acceptance on Two Sum**

Build and reload `dist/` from `chrome://extensions`, then execute this exact checklist:

```text
A. Open Two Sum and the Side Panel; select Case 1.
B. Do not click Run now.
C. Modify one runnable line; observe Live: updating → Live: synced.
D. Confirm TraceViewer updates automatically.
E. Make several rapid edits; confirm the UI never jumps backward to an older source revision.
F. Leave a temporarily incomplete line such as `if need in`; wait beyond debounce.
G. Confirm Live: editing and confirm the previous visualization remains visible.
H. Complete the syntax; confirm automatic execution resumes.
I. Switch Case 1 → Case 2 → Case 3; confirm each selection re-executes automatically.
J. Trigger a normal Runtime Error; confirm its trace prefix remains inspectable.
K. Trigger an infinite loop; confirm hard timeout occurs without freezing the Side Panel.
L. Fix the infinite loop; confirm a fresh Worker initializes and Live Visualization recovers.
M. Use Previous / Next / Play on the newest trace.
N. Click Run now; confirm the current snapshot executes immediately without waiting for debounce.
```

- [ ] **Step 5: Verify warmed Worker behavior manually**

Open Side Panel DevTools and perform three normal code edits. Confirm subsequent executions do not repeatedly incur full Pyodide initialization latency. Then trigger one hard timeout and confirm exactly the next execution may incur reinitialization because the old Worker was discarded. Remove any temporary debugging logs before committing.

- [ ] **Step 6: Verify scope boundaries**

Run:

```bash
git diff --name-only HEAD~5..HEAD
```

Review the changed files and confirm no implementation was added for:

```text
TreeVisualizer
GraphVisualizer
LinkedListVisualizer
DP table visualizer
expression-level stepping
Monaco onDidChangeContent
revisionId in TraceEvent / worker protocol
parallel Python execution
large Side Panel redesign
```

- [ ] **Step 7: Commit documentation**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: document live visualization"
```

- [ ] **Step 8: Final verification**

```bash
npm test
npm run typecheck
npm run build
git diff --check
git status --short
```

Expected final state:

```text
all commands exit 0
git diff --check has no output
git status --short has no uncommitted implementation changes
```

---

## Implementation Order

```text
Task 1  shared testcase selection
  ↓
Task 2  LiveExecutionScheduler
  ↓
Task 3  persistent ExecutionController
  ↓
Task 4  sequential Worker/runtime regression
  ↓
Task 5  Side Panel integration
  ↓
Task 6  docs + full verification + Chrome acceptance
```

Do not integrate the scheduler into `bootstrap.ts` until both Task 2 and Task 3 test suites pass independently.

## Completion Definition

Normal editing:

```text
edit code
   ↓
snapshot update
   ↓
200 ms debounce
   ↓
latest runnable revision
   ↓
warmed Worker execution
   ↓
TraceSession
   ↓
automatic visualization update
```

Incomplete draft:

```text
latest draft cannot form an ExecutionRequest
   ↓
Live: editing
   ↓
previous visualization remains visible
```

Rapid edits:

```text
R41 running
R42 arrives
R43 arrives
R44 arrives
   ↓
R42/R43 collapse
pending = R44
   ↓
R41 cannot replace R44
```

Recovery:

```text
hard timeout / worker failure
   ↓
terminate unhealthy Worker
   ↓
latest runnable revision creates a fresh Worker
   ↓
Live Visualization continues
```

# Live Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將目前需要手動點擊 `Visualize` 的 LeetCode Python execution visualizer 改成 near-real-time Live Visualization：code / testcase / selected case 改變後，自動執行最新可執行 revision，並可靠地更新 Side Panel visualization。

**Architecture:** 保留現有 `LeetCode snapshot → ExecutionRequest → ExecutionController → Pyodide Worker → TraceSession → TraceVisualizer` pipeline，在 snapshot 與 execution 之間新增 `LiveExecutionScheduler`，負責 200 ms debounce、revision、latest-wins、single-flight 與 last-runnable semantics。同時把 `ExecutionController` 從 per-request Worker 改為 lazy persistent Worker，正常 execution 間重用 warmed Pyodide；hard timeout、worker error、protocol failure 或 initialization failure 才丟棄並重建 Worker。

**Tech Stack:** TypeScript 5.8, Chrome Manifest V3, Vite 6, Vitest 3, Web Worker, bundled Pyodide 0.29, vanilla DOM Side Panel UI.

**Spec:** `docs/superpowers/specs/2026-09-06-live-visualization-design.md`

## Global Constraints

- Live scheduler debounce 固定為 `200 ms`；本階段不做 adaptive debounce。
- 現有 MAIN-world page-state polling 約 `300 ms` 保留；不改成 Monaco `onDidChangeContent`。
- Scheduler 同時間最多 `1` 個 running execution，最多 `1` 個 latest pending execution；禁止建立 FIFO execution queue。
- 所有會影響 execution input 的變化都必須形成新的 revision：source code、完整 testcase text、selected case index。
- stale execution result 不得覆蓋較新 runnable revision 的 visualization。
- incomplete / temporarily unrunnable code 必須保留 last rendered visualization，live status 改為 `editing`，不得清空結果區。
- 正常連續 execution 必須重用 warmed Pyodide Worker；hard timeout、worker `error`、unrecoverable protocol error、initialization failure 必須使 Worker unhealthy 並在下一次 execution 重建。
- Python runtime exception（例如 `IndexError`、`KeyError`）只是單次 request terminal result，不得因此重建 Worker。
- Persistent Worker 只能重用 Pyodide VM；每個 request 必須維持新的 user execution namespace，不得讓前一個 Solution instance、user globals、testcase mutation、tracer/session state 洩漏到下一次 execution。
- `sessionId` 繼續只負責 worker protocol correlation；Live scheduling 的 `revisionId` 不加入 `TraceEvent` 或 worker wire protocol。
- `Previous / Next / Play` 與現有 trace inspection 全部保留。
- 本計畫不新增 Tree / Graph / Linked List / DP table visualizer，不新增 expression-level stepping，不做 AI inference，不大改 UI layout。

---

# Proposed File Structure

```text
src/
├── execution/
│   ├── execution-controller.ts             # modify: persistent warmed worker + recovery
│   ├── execution-request.ts                # unchanged contract
│   ├── testcase-parser.ts                  # unchanged parser primitive
│   ├── testcase-selection.ts               # new: shared source + testcase → cases helper
│   └── live-execution-scheduler.ts          # new: debounce / revision / latest-wins
│
├── sidepanel/
│   ├── bootstrap.ts                        # modify: wire snapshot/case changes into scheduler
│   └── styles.css                          # modify only for compact live-status styling
│
├── worker/
│   ├── pyodide-worker.ts                   # behavior retained; add sequential-run regression coverage
│   └── pyodide-runtime.ts                  # behavior retained; verify VM reuse + fresh namespace
│
└── shared/
    └── worker-protocol.ts                  # no revision fields added

tests/
├── execution/
│   ├── testcase-selection.test.ts          # new
│   ├── live-execution-scheduler.test.ts     # new
│   ├── execution-controller.test.ts        # new
│   ├── trace-session-collector.test.ts      # modify existing worker-lifecycle expectations
│   ├── pyodide-worker.test.ts               # modify sequential execution coverage
│   └── pyodide-runtime.test.ts              # modify VM reuse / namespace coverage
│
└── sidepanel/
    └── bootstrap.test.ts                    # modify/add live integration coverage

README.md                                    # modify: document Live Visualization
README.zh-TW.md                              # modify: document Live Visualization
```

The new files have one responsibility each:

- `testcase-selection.ts`: move source-aware testcase grouping out of `bootstrap.ts` so Side Panel and scheduler share exactly one selection rule.
- `live-execution-scheduler.ts`: own interaction-level scheduling only; it never touches DOM or worker messages.
- `execution-controller.ts`: own one `ExecutionRequest → TraceSession` execution and Worker lifecycle only; it never knows editor revisions or testcase selection UI.

---

### Task 1: Extract Shared Testcase Selection

**Files:**
- Create: `src/execution/testcase-selection.ts`
- Create: `tests/execution/testcase-selection.test.ts`
- Modify: `src/sidepanel/bootstrap.ts`

**Interfaces:**
- Consumes: `resolveEntrypoint(sourceCode)` and `splitTestcaseIntoCases(rawTestcase, parameterCount)`.
- Produces:

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

These exact functions are used by Task 2 and Task 5.

- [ ] **Step 1: Write the failing testcase-selection tests**

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
  it("groups synced LeetCode testcase text using the resolved parameter count", () => {
    expect(getTestcaseCases(oneArgSource, "7\n8\n9")).toEqual(["7", "8", "9"]);
    expect(getTestcaseCases(twoArgSource, "1\n2\n3\n4")).toEqual(["1\n2", "3\n4"]);
  });

  it("returns the requested case or null when the index is unavailable", () => {
    expect(getSelectedTestcase(oneArgSource, "7\n8\n9", 1)).toBe("8");
    expect(getSelectedTestcase(oneArgSource, "7\n8\n9", 3)).toBeNull();
  });

  it("returns no cases while the Solution entrypoint is incomplete", () => {
    expect(getTestcaseCases("class Solution:\n    pass", "7")).toEqual([]);
    expect(getSelectedTestcase("class Solution:\n    pass", "7", 0)).toBeNull();
  });

  it("returns no cases when argument lines cannot form complete testcase groups", () => {
    expect(getTestcaseCases(twoArgSource, "1\n2\n3")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the module does not exist**

Run:

```bash
npm test -- testcase-selection
```

Expected: FAIL with module resolution error for `src/execution/testcase-selection.ts`.

- [ ] **Step 3: Add the shared testcase-selection implementation**

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

- [ ] **Step 4: Replace the duplicate local helpers in `bootstrap.ts` with imports**

Remove the direct `resolveEntrypoint` / `splitTestcaseIntoCases` imports and the local `getTestcaseCases` / `getSelectedTestcase` functions. Add:

```ts
import {
  getSelectedTestcase,
  getTestcaseCases
} from "../execution/testcase-selection";
```

No behavior change is intended in this task.

- [ ] **Step 5: Run focused and bootstrap regression tests**

Run:

```bash
npm test -- testcase-selection bootstrap
```

Expected: PASS.

- [ ] **Step 6: Commit the extraction**

```bash
git add src/execution/testcase-selection.ts \
  src/sidepanel/bootstrap.ts \
  tests/execution/testcase-selection.test.ts
git commit -m "refactor: share testcase selection logic"
```

---

### Task 2: Add the LiveExecutionScheduler State Machine

**Files:**
- Create: `src/execution/live-execution-scheduler.ts`
- Create: `tests/execution/live-execution-scheduler.test.ts`

**Interfaces:**
- Consumes:

```ts
getSelectedTestcase(sourceCode, rawTestcase, selectedCaseIndex): string | null
createExecutionRequest(input): ExecutionRequestResult
runner.execute(request): Promise<TraceSession>
```

- Produces:

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

`language` participates in the revision key. Non-Python snapshots are not executed and resolve to `editing` for this Python-only MVP.

- [ ] **Step 1: Write scheduler test helpers and the 200 ms debounce test**

Start `tests/execution/live-execution-scheduler.test.ts` with deterministic fake timers and a session factory:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionRequest } from "../../src/shared/execution-types";
import type { TraceSession } from "../../src/shared/trace-types";
import {
  LiveExecutionScheduler,
  type LiveStatus
} from "../../src/execution/live-execution-scheduler";

const source = `class Solution:
    def one(self, value):
        return value
`;

function makeSession(request: ExecutionRequest, status: TraceSession["status"] = "completed"): TraceSession {
  return {
    schemaVersion: 1,
    sessionId: request.sessionId,
    sourceCode: request.sourceCode,
    rawTestcase: request.rawTestcase,
    entrypoint: request.entrypoint,
    executionEnvironment: { runtime: "pyodide", pythonVersion: "unknown" },
    status,
    terminationReason: status === "timeout" ? "hard_timeout" : "normal_return",
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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("LiveExecutionScheduler", () => {
  it("waits 200 ms before executing the latest runnable draft", async () => {
    const execute = vi.fn(async (request: ExecutionRequest) => makeSession(request));
    const statuses: LiveStatus[] = [];
    const sessions: TraceSession[] = [];
    let nextSession = 0;
    const scheduler = new LiveExecutionScheduler({
      runner: { execute },
      createSessionId: () => `live-${++nextSession}`,
      onStatusChange: (status) => statuses.push(status),
      onSession: (session) => sessions.push(session)
    });

    scheduler.schedule(input());
    expect(execute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(199);
    expect(execute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(sessions).toHaveLength(1);
    expect(statuses).toContain("updating");
    expect(statuses.at(-1)).toBe("synced");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- live-execution-scheduler
```

Expected: FAIL because `LiveExecutionScheduler` does not exist.

- [ ] **Step 3: Add tests for latest-wins and no FIFO queue**

Add a deferred helper:

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
```

Then add:

```ts
it("keeps one running execution and collapses intermediate revisions to the latest pending input", async () => {
  const first = deferred<TraceSession>();
  const requests: ExecutionRequest[] = [];
  const execute = vi.fn((request: ExecutionRequest) => {
    requests.push(request);
    return requests.length === 1 ? first.promise : Promise.resolve(makeSession(request));
  });
  const sessions: TraceSession[] = [];
  let nextSession = 0;
  const scheduler = new LiveExecutionScheduler({
    runner: { execute },
    createSessionId: () => `live-${++nextSession}`,
    debounceMs: 0,
    onSession: (session) => sessions.push(session)
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
  expect(sessions.map((session) => session.rawTestcase)).toEqual(["4"]);
});
```

This test establishes both contracts: no parallel execution and only the latest pending runnable revision survives.

- [ ] **Step 4: Add tests for incomplete code and last-runnable rendering**

Add:

```ts
it("marks an incomplete latest revision as editing without starting another execution", async () => {
  const execute = vi.fn(async (request: ExecutionRequest) => makeSession(request));
  const statuses: LiveStatus[] = [];
  let nextSession = 0;
  const scheduler = new LiveExecutionScheduler({
    runner: { execute },
    createSessionId: () => `live-${++nextSession}`,
    debounceMs: 0,
    onStatusChange: (status) => statuses.push(status)
  });

  scheduler.schedule(input());
  await vi.runAllTimersAsync();
  expect(execute).toHaveBeenCalledTimes(1);

  scheduler.schedule(input({ sourceCode: "class Solution:\n    def one(self, value):" }));
  await vi.runAllTimersAsync();

  expect(execute).toHaveBeenCalledTimes(1);
  expect(statuses.at(-1)).toBe("editing");
});
```

Also cover the important race where an older runnable revision is still running and the user moves to an invalid draft:

```ts
it("may render the last runnable result after a newer invalid edit but keeps status editing", async () => {
  const running = deferred<TraceSession>();
  let capturedRequest: ExecutionRequest | undefined;
  const statuses: LiveStatus[] = [];
  const sessions: TraceSession[] = [];
  const scheduler = new LiveExecutionScheduler({
    runner: {
      execute: (request) => {
        capturedRequest = request;
        return running.promise;
      }
    },
    createSessionId: () => "live-1",
    debounceMs: 0,
    onStatusChange: (status) => statuses.push(status),
    onSession: (session) => sessions.push(session)
  });

  scheduler.schedule(input());
  await vi.runAllTimersAsync();

  scheduler.schedule(input({ sourceCode: "class Solution:\n    def one(self, value):" }));
  await vi.runAllTimersAsync();
  expect(statuses.at(-1)).toBe("editing");

  running.resolve(makeSession(capturedRequest!));
  await Promise.resolve();
  await Promise.resolve();

  expect(sessions).toHaveLength(1);
  expect(statuses.at(-1)).toBe("editing");
});
```

- [ ] **Step 5: Add tests for selected case, duplicate suppression, forced immediate run, and terminal status mapping**

Add tests that assert:

```ts
it("uses the selected testcase case", async () => {
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

it("does not schedule an identical input twice unless force is true", async () => {
  const execute = vi.fn(async (request: ExecutionRequest) => makeSession(request));
  let sessionId = 0;
  const scheduler = new LiveExecutionScheduler({
    runner: { execute },
    createSessionId: () => `run-${++sessionId}`,
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
```

Add one mapping test for `timeout` and one for an execution exception/internal terminal status mapping to `runtime_error`. Do not add new LiveStatus enum members.

- [ ] **Step 6: Implement `LiveExecutionScheduler`**

Create `src/execution/live-execution-scheduler.ts` with this state model:

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

function sessionStatus(session: TraceSession): LiveStatus {
  if (session.status === "completed") {
    return "synced";
  }
  if (session.status === "timeout") {
    return "timeout";
  }
  return "runtime_error";
}

function inputKey(input: LiveExecutionInput): string {
  return JSON.stringify([
    input.language,
    input.sourceCode,
    input.rawTestcase,
    input.selectedCaseIndex
  ]);
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
    if (this.disposed) {
      return this.latestRevision;
    }

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
    if (status === this.currentStatus) {
      return;
    }
    this.currentStatus = status;
    this.onStatusChange?.(status);
  }

  private accept(revision: number, input: LiveExecutionInput): void {
    if (this.disposed || revision !== this.latestRevision) {
      return;
    }

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

    const requestResult = createExecutionRequest({
      sessionId: this.createSessionId(),
      sourceCode: input.sourceCode,
      rawTestcase: selectedTestcase
    });
    if (!requestResult.ok) {
      this.pending = null;
      this.emitStatus("editing");
      return;
    }

    this.latestRunnableRevision = revision;
    this.pending = { revision, request: requestResult.request };
    this.emitStatus("updating");
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.running !== null || this.pending === null) {
      return;
    }

    const run = this.pending;
    this.pending = null;
    this.running = run;

    try {
      const session = await this.runner.execute(run.request);
      if (this.disposed) {
        return;
      }

      if (run.revision === this.latestRunnableRevision) {
        this.onSession?.(session);
      }
      if (run.revision === this.latestRevision) {
        this.emitStatus(sessionStatus(session));
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

The implementer may make purely local naming adjustments while coding, but the exported interfaces above must remain exact because later tasks depend on them.

- [ ] **Step 7: Run the scheduler tests**

```bash
npm test -- live-execution-scheduler
```

Expected: PASS.

- [ ] **Step 8: Commit the scheduler**

```bash
git add src/execution/live-execution-scheduler.ts \
  tests/execution/live-execution-scheduler.test.ts
git commit -m "feat: schedule live executions"
```

---

### Task 3: Refactor ExecutionController to Reuse a Warm Worker

**Files:**
- Modify: `src/execution/execution-controller.ts`
- Create: `tests/execution/execution-controller.test.ts`
- Modify: `tests/execution/trace-session-collector.test.ts`

**Interfaces:**
- Consumes existing worker protocol:

```ts
{ type: "ready" }
{ type: "trace_batch"; sessionId; events }
{ type: "execution_finished"; sessionId; result }
{ type: "worker_error"; sessionId?; message }
```

- Produces unchanged primary contract plus lifecycle cleanup:

```ts
export class ExecutionController {
  execute(request: ExecutionRequest): Promise<TraceSession>;
  dispose(): void;
}
```

The controller must continue rejecting a second concurrent `execute()` call. Live queuing belongs only in `LiveExecutionScheduler`.

- [ ] **Step 1: Add a reusable controllable FakeWorker test double**

Create `tests/execution/execution-controller.test.ts` with a worker that does not auto-terminate itself:

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

  postMessage(message: unknown): void {
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

- [ ] **Step 2: Write the worker reuse test**

Add:

```ts
it("reuses one ready worker across sequential executions", async () => {
  const worker = new ControlledWorker();
  const workerFactory = vi.fn(() => worker);
  const controller = new ExecutionController({ workerFactory });

  const firstPromise = controller.execute(request("one"));
  worker.emit({ type: "ready" });
  expect(worker.posted).toContainEqual({ type: "execute", request: request("one") });
  worker.emit({ type: "execution_finished", sessionId: "one", result: completed });
  await expect(firstPromise).resolves.toEqual(expect.objectContaining({ status: "completed" }));

  const secondPromise = controller.execute(request("two"));
  expect(worker.posted).toContainEqual({ type: "execute", request: request("two") });
  worker.emit({ type: "execution_finished", sessionId: "two", result: completed });
  await expect(secondPromise).resolves.toEqual(expect.objectContaining({ status: "completed" }));

  expect(workerFactory).toHaveBeenCalledTimes(1);
  expect(worker.terminateCount).toBe(0);
});
```

The second request must be posted without waiting for another `ready` message.

- [ ] **Step 3: Write unhealthy-worker recovery tests**

Add hard-timeout coverage with fake timers:

```ts
it("terminates a worker on hard timeout and creates a new worker for the next execution", async () => {
  vi.useFakeTimers();
  try {
    const workers = [new ControlledWorker(), new ControlledWorker()];
    const workerFactory = vi.fn(() => workers[workerFactory.mock.calls.length]!);
    const controller = new ExecutionController({ workerFactory });

    const first = controller.execute(request("slow", 20));
    workers[0]!.emit({ type: "ready" });
    await vi.advanceTimersByTimeAsync(20);
    await expect(first).resolves.toEqual(expect.objectContaining({ status: "timeout" }));
    expect(workers[0]!.terminateCount).toBe(1);

    const second = controller.execute(request("recovered"));
    workers[1]!.emit({ type: "ready" });
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

Add equivalent recovery assertions for:

```ts
worker.emitError("worker crashed");
worker.emit({ type: "worker_error", sessionId: "one", message: "runtime bridge failed" });
worker.emit({ unexpected: true });
```

All three must mark the worker unhealthy and force the next request to instantiate a new worker.

- [ ] **Step 4: Prove ordinary Python exceptions do not recreate the worker**

Use:

```ts
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
```

Execute one request returning `runtimeException`, then a second completed request. Assert `workerFactory` is still called exactly once and `terminateCount` remains `0`.

- [ ] **Step 5: Implement a persistent WorkerHandle inside ExecutionController**

Refactor `execution-controller.ts` around these internal responsibilities:

```ts
interface WorkerHandle {
  worker: WorkerLike;
  ready: Promise<WorkerLike>;
  cancelReady(error: Error): void;
}
```

The controller fields become:

```ts
private readonly workerFactory: () => WorkerLike;
private workerHandle: WorkerHandle | null = null;
private active = false;
private disposed = false;
private abortActive: (() => void) | null = null;
```

Create a lazy `createWorkerHandle()` that attaches temporary initialization listeners before waiting for `ready`. Its behavior must be:

```text
ready                         → resolve handle.ready and remove init listeners
worker_error before ready     → reject handle.ready, terminate worker, clear handle
error event before ready      → reject handle.ready, terminate worker, clear handle
malformed message before ready→ reject handle.ready, terminate worker, clear handle
```

`ensureWorker()` returns the existing resolved handle on subsequent requests and therefore does not initialize Pyodide again.

The per-execution listener must:

```text
trace_batch with matching sessionId        → collector.append(events)
execution_finished with matching sessionId → collector.finish(result)
message for another session                → ignore
ready after initialization                 → ignore
worker_error for current/no session         → finish internal_error + invalidate worker
malformed outbound message                 → finish internal_error + invalidate worker
error event                                 → finish internal_error + invalidate worker
hard timeout                               → collector.forceTimeout() + invalidate worker
```

Normal `execution_finished` with `status: "exception"` or `status: "trace_limit"` completes the request but keeps the worker healthy. If a terminal result explicitly carries `terminationReason === "hard_timeout"`, invalidate the worker as well.

- [ ] **Step 6: Add explicit disposal**

Add:

```ts
public dispose(): void {
  if (this.disposed) {
    return;
  }
  this.disposed = true;
  this.abortActive?.();
  this.invalidateWorker(new Error("Execution controller disposed"));
}
```

`execute()` called after disposal must reject:

```ts
Promise.reject(new Error("Execution controller is disposed"))
```

If disposal occurs while initialization is pending, `cancelReady()` must reject that readiness promise so no execution promise hangs indefinitely.

- [ ] **Step 7: Update the existing trace-session collector tests for persistent workers**

`tests/execution/trace-session-collector.test.ts` currently assumes a normally completed request terminates its worker. Keep the timeout assertions:

```ts
expect(worker?.terminated).toBe(true);
```

for hard-timeout tests, but update normal completion expectations so the worker is not terminated until explicit disposal.

At the end of normal-controller tests call:

```ts
controller.dispose();
```

and assert the worker is then terminated.

- [ ] **Step 8: Run controller and collector tests**

```bash
npm test -- execution-controller trace-session-collector
```

Expected: PASS.

- [ ] **Step 9: Commit the worker-lifecycle refactor**

```bash
git add src/execution/execution-controller.ts \
  tests/execution/execution-controller.test.ts \
  tests/execution/trace-session-collector.test.ts
git commit -m "refactor: reuse warmed pyodide worker"
```

---

### Task 4: Verify Sequential Worker Runtime Reuse and Request Isolation

**Files:**
- Modify: `tests/execution/pyodide-worker.test.ts`
- Modify: `tests/execution/pyodide-runtime.test.ts`
- Modify only if a regression is exposed: `src/worker/pyodide-worker.ts`
- Modify only if a regression is exposed: `src/worker/pyodide-runtime.ts`

**Interfaces:**
- `PyodideRuntime.initialize()` must be performed once per persistent Worker.
- `PyodideRuntime.execute(request)` must support multiple sequential requests.
- `buildExecutionScript(request)` must continue creating `__lc_runtime_namespace = {}` for every request.

- [ ] **Step 1: Add a sequential worker forwarding test**

In `tests/execution/pyodide-worker.test.ts`, add:

```ts
it("forwards multiple sequential execute requests through one initialized runtime", async () => {
  const listeners: Array<(event: MessageEvent) => Promise<void> | void> = [];
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
    addEventListener: (_type, listener) => listeners.push(listener),
    removeEventListener: () => undefined,
    postMessage: (message) => posted.push(message)
  };

  installPyodideWorker(scope, runtime);
  await Promise.resolve();

  const first = { ...request, sessionId: "first" };
  const second = { ...request, sessionId: "second" };
  await listeners[0]!(new MessageEvent("message", { data: { type: "execute", request: first } }));
  await listeners[0]!(new MessageEvent("message", { data: { type: "execute", request: second } }));

  expect(initializeCount).toBe(1);
  expect(posted[0]).toEqual({ type: "ready" });
  expect(calls.map((item) => item.sessionId)).toEqual(["first", "second"]);
});
```

- [ ] **Step 2: Add a runtime test proving Pyodide loads once while scripts are rebuilt per request**

In `tests/execution/pyodide-runtime.test.ts`, add:

```ts
it("reuses one loaded Pyodide VM while building a fresh execution namespace per request", async () => {
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
  await runtime.execute({ ...request, sessionId: "first", rawTestcase: "1\n2" });
  await runtime.execute({ ...request, sessionId: "second", rawTestcase: "3\n4" });

  expect(loadCount).toBe(1);
  expect(scripts).toHaveLength(2);
  expect(scripts[0]).toContain("__lc_runtime_namespace = {}");
  expect(scripts[1]).toContain("__lc_runtime_namespace = {}");
  expect(scripts[0]).toContain('session_id="first"');
  expect(scripts[1]).toContain('session_id="second"');
});
```

If exact string quoting differs, assert using `JSON.stringify("first")` / `JSON.stringify("second")`, matching `buildExecutionScript()`.

- [ ] **Step 3: Run the worker/runtime tests before changing production code**

```bash
npm test -- pyodide-worker pyodide-runtime
```

Expected outcome: these tests should pass with the existing worker/runtime implementation once Task 3 supplies the persistent controller. If they fail, fix only the concrete sequential-execution or initialization bug revealed by the test; do not redesign the worker protocol.

- [ ] **Step 4: Confirm the worker wire protocol remains revision-free**

Run:

```bash
npm test -- worker-protocol
```

Then inspect `src/shared/worker-protocol.ts` and ensure no `revisionId` field was added. Live revision metadata must remain scheduler-local.

- [ ] **Step 5: Commit the regression coverage**

If only tests changed:

```bash
git add tests/execution/pyodide-worker.test.ts \
  tests/execution/pyodide-runtime.test.ts
git commit -m "test: cover repeated pyodide execution"
```

If a concrete worker/runtime fix was required, include only those directly related source files in the same commit.

---

### Task 5: Integrate Live Scheduling into the Side Panel

**Files:**
- Modify: `src/sidepanel/bootstrap.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/bootstrap.test.ts`

**Interfaces:**
- Consumes:

```ts
LiveExecutionScheduler
LiveStatus
getTestcaseCases
SidePanelController.execute()
SidePanelController.dispose?()
```

- Produces:

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

- [ ] **Step 1: Update bootstrap tests to expect automatic execution**

Add a deterministic helper to create completed sessions in `tests/sidepanel/bootstrap.test.ts` and use `liveDebounceMs: 0` in live tests.

Add this primary acceptance test:

```ts
it("automatically visualizes the initial synced Python snapshot without clicking Run now", async () => {
  const root = document.createElement("main");
  const snapshot: LeetCodeSnapshot = {
    code: "class Solution:\n    def one(self, value):\n        return value\n",
    language: "python",
    testcase: "7",
    metadata: { slug: "one", title: "One" }
  };
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
    limits: request.limits
  }));

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

- [ ] **Step 2: Add subscription-driven auto-run and case-change tests**

Test a `snapshotSubscription` update that changes code from `return value` to `return value + 1`. Assert a second execution occurs automatically without clicking the button.

Update the existing multi-case test so changing the `<select>` from Case 1 to Case 2 triggers execution automatically and the new request contains:

```ts
expect.objectContaining({ rawTestcase: "8" })
```

No `#run` click should be used in this case-selection test.

- [ ] **Step 3: Add last-runnable UI behavior test**

Render one valid session, then push an incomplete snapshot through the subscription:

```ts
onSnapshot?.({
  ...initialSnapshot,
  code: "class Solution:\n    def one(self, value):"
});
```

Assert after the debounce:

```ts
expect(execute).toHaveBeenCalledTimes(1);
expect(root.querySelector("#trace-viewer")).not.toBeNull();
expect(root.querySelector("#runtime-status")?.textContent).toBe("Live: editing");
```

This test prevents `result.replaceChildren()` from being called merely because the newest draft is incomplete.

- [ ] **Step 4: Add terminal status tests**

For a session with:

```ts
status: "timeout",
terminationReason: "hard_timeout"
```

assert:

```text
Live: timeout
```

For `status: "exception"` or `internal_error`, assert:

```text
Live: runtime_error
```

In both cases the returned `TraceSession` must still render through `createTraceVisualizer`, so trace prefixes remain inspectable.

- [ ] **Step 5: Add manual Run now test**

Keep the existing behavior that manual execution first requests the latest snapshot when a provider exists, but change the button's role to forced immediate scheduling.

The test should:

1. use a non-zero debounce such as `1_000 ms`;
2. open the panel with an initial snapshot;
3. click `#run` before debounce expires;
4. assert execution occurs immediately;
5. assert the provider was queried again for the latest snapshot;
6. assert duplicate suppression does not block this forced retry.

- [ ] **Step 6: Refactor `bootstrap.ts` around current snapshot + scheduler**

Keep one source of truth:

```ts
let currentSnapshot: LeetCodeSnapshot | null = null;
let selectedCaseIndex = 0;
```

Construct the scheduler after the result host and visualizer state exist:

```ts
const scheduler = new LiveExecutionScheduler({
  runner: controller,
  createSessionId,
  debounceMs: dependencies.liveDebounceMs,
  onStatusChange: (liveStatus) => {
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
  if (!currentSnapshot) {
    return;
  }
  scheduler.schedule({
    language: currentSnapshot.language,
    sourceCode: currentSnapshot.code,
    rawTestcase: currentSnapshot.testcase,
    selectedCaseIndex
  }, options);
};
```

`applySnapshot()` becomes responsible only for mirror/selector state plus scheduling:

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

Do not clear `result` while entering `editing` or `updating`.

- [ ] **Step 7: Make testcase selection itself a live execution input**

In the case selector handler:

```ts
caseSelector.addEventListener("change", () => {
  const nextIndex = Number.parseInt(caseSelector.value, 10);
  selectedCaseIndex = Number.isInteger(nextIndex) && nextIndex >= 0 ? nextIndex : 0;
  scheduleCurrent();
});
```

`refreshCaseSelector()` must keep the current index if still valid. If it becomes invalid because case count shrank, set `selectedCaseIndex = 0`; the subsequent `scheduleCurrent()` from `applySnapshot()` will execute Case 1.

- [ ] **Step 8: Replace the old click-driven execution body with Run now / Retry**

Rename the button:

```ts
runButton.textContent = "Run now";
```

Manual click behavior:

```ts
runButton.addEventListener("click", () => {
  const runLatest = async (): Promise<void> => {
    if (snapshotProvider) {
      try {
        const latest = await snapshotProvider();
        applySnapshot(latest, { schedule: false });
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

Delete the old `running` flag and direct `createExecutionRequest()` / `controller.execute()` click path. The scheduler is now the only path that starts an execution.

- [ ] **Step 9: Add Side Panel cleanup so persistent workers do not survive panel teardown**

Capture the subscription cleanup:

```ts
const unsubscribeSnapshot = snapshotSubscription?.(applySnapshot);
```

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

At module bootstrap:

```ts
if (typeof document !== "undefined") {
  const handle = renderSidePanel(document.body);
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => handle.dispose(), { once: true });
  }
}
```

Add one test that calls the returned handle's `dispose()` and verifies a supplied controller `dispose` spy and snapshot unsubscribe spy are each called exactly once.

- [ ] **Step 10: Make live status visually legible without redesigning the panel**

Keep `#runtime-status` as the same compact text line. Add only lightweight state styling in `src/sidepanel/styles.css`, for example:

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

Do not restructure the Side Panel or change TraceVisualizer layout in this task.

- [ ] **Step 11: Update placeholder copy**

Replace:

```text
Run Visualize to inspect the execution step by step.
```

with:

```text
Waiting for a runnable Python draft…
```

This remains visible only until the first renderable TraceSession arrives.

- [ ] **Step 12: Run sidepanel and scheduler integration tests**

```bash
npm test -- bootstrap live-execution-scheduler
```

Expected: PASS.

- [ ] **Step 13: Commit the Live Visualization UI integration**

```bash
git add src/sidepanel/bootstrap.ts \
  src/sidepanel/styles.css \
  tests/sidepanel/bootstrap.test.ts
git commit -m "feat: enable live visualization"
```

---

### Task 6: Full Regression, Documentation, and Chrome Acceptance

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`
- No source changes unless a failing regression directly identifies a defect from Tasks 1–5.

**Interfaces:** None. This task validates the complete feature and updates user-facing behavior documentation.

- [ ] **Step 1: Update the English README interaction description**

Change the opening description so it states that the extension automatically re-executes the latest runnable draft after editor/testcase changes.

Add this paragraph near `How it works`:

```md
Live Visualization follows the latest runnable Python draft. When the LeetCode code, testcase, or selected testcase case changes, the Side Panel automatically re-executes after a short debounce. Temporarily incomplete code keeps the previous visualization visible until the draft becomes runnable again; `Run now` remains available as an immediate retry.
```

Update the diagram to include:

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

Add project document links:

```md
- [Live Visualization Design Spec](docs/superpowers/specs/2026-09-06-live-visualization-design.md)
- [Live Visualization Implementation Plan](docs/superpowers/plans/2026-09-06-live-visualization-implementation-plan.md)
```

- [ ] **Step 2: Make the equivalent Traditional Chinese README update**

Use this core wording:

```md
Live Visualization 會追蹤目前最新可執行的 Python draft。當 LeetCode 的程式碼、testcase 或目前選中的 testcase case 改變時，Side Panel 會在短暫 debounce 後自動重新執行。若使用者正輸入暫時不完整的程式碼，畫面會保留上一份可執行版本的 visualization，直到新版再次可執行；`Run now` 則保留作為立即重試入口。
```

Keep technical terms such as Live Visualization, debounce, latest-wins, Side Panel, Pyodide, Web Worker in English.

- [ ] **Step 3: Run the full automated verification suite**

Run exactly:

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

The existing browser externalization warnings from bundled Pyodide are acceptable only if they remain warnings and the build exits `0`.

- [ ] **Step 4: Perform manual Chrome acceptance on Two Sum**

Build and reload `dist/` in `chrome://extensions`, open LeetCode Two Sum, then verify each item in order:

```text
A. Open the Side Panel and select Case 1.
B. Do not click Run now.
C. Modify one runnable line and verify Live: updating → Live: synced.
D. Confirm the new TraceViewer appears automatically.
E. Rapidly make several code edits and confirm the visualization never jumps backward to an older source revision.
F. Leave the code temporarily incomplete, e.g. `if need in`, and wait beyond the debounce.
G. Confirm Live: editing and confirm the previous visualization remains visible.
H. Complete the syntax and confirm automatic execution resumes.
I. Switch Case 1 → Case 2 → Case 3 and confirm each selection automatically re-executes with that case.
J. Produce a normal Runtime Error and confirm the error session / trace prefix remains inspectable.
K. Produce an infinite loop and confirm hard timeout occurs without freezing the Side Panel.
L. Fix the infinite loop and confirm a new Worker initializes and Live Visualization recovers automatically.
M. Use Previous / Next / Play on the latest session and confirm trace inspection still works.
N. Click Run now and confirm it immediately retries the current snapshot without waiting for the normal debounce.
```

- [ ] **Step 5: Check Worker reuse manually**

With Side Panel DevTools open, add temporary local debugging only if needed while testing. Verify several normal edits do not repeatedly pay full Pyodide initialization cost. Remove any temporary logging before commit.

A hard timeout should be the opposite: the next execution is allowed to incur one reinitialization because the previous worker is unhealthy.

- [ ] **Step 6: Review scope against the approved spec**

Confirm the implementation did **not** add:

```text
TreeVisualizer
GraphVisualizer
LinkedListVisualizer
DP table visualizer
expression-level stepping
Monaco onDidChangeContent migration
revisionId in TraceEvent / worker protocol
parallel Python executions
large Side Panel redesign
```

If any appeared incidentally, remove it before final verification.

- [ ] **Step 7: Commit documentation and final regression state**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: document live visualization"
```

- [ ] **Step 8: Final repository verification**

Run again after the documentation commit:

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

# Implementation Order and Dependency Graph

```text
Task 1  testcase selection extraction
  ↓
Task 2  LiveExecutionScheduler
  ↓
Task 3  persistent ExecutionController
  ↓
Task 4  worker/runtime sequential reuse regression
  ↓
Task 5  Side Panel live integration
  ↓
Task 6  full regression + Chrome acceptance + docs
```

Task 2 and Task 3 are logically independent after Task 1, but implement them in the listed order so scheduler behavior is locked down before changing worker lifecycle. Do not integrate into `bootstrap.ts` until both scheduler and persistent controller tests are green.

# Completion Definition

The feature is complete only when the user can stay in the normal LeetCode editor and experience this loop without a required button press:

```text
edit code
   ↓
latest snapshot arrives
   ↓
200 ms scheduler debounce
   ↓
latest runnable revision executes
   ↓
TraceSession renders automatically
   ↓
edit again
```

During invalid intermediate drafts:

```text
edit incomplete code
   ↓
Live: editing
   ↓
last runnable visualization remains visible
```

During fast edits:

```text
R41 running
R42 arrives
R43 arrives
R44 arrives
   ↓
only R44 remains pending
   ↓
R41 cannot overwrite R44
```

And across ordinary runs:

```text
Worker boots + Pyodide initializes once
   ↓
request A
   ↓
request B
   ↓
request C
```

while failure recovery remains:

```text
hard timeout / worker failure
   ↓
terminate unhealthy Worker
   ↓
next runnable revision creates fresh Worker
   ↓
Live Visualization continues
```

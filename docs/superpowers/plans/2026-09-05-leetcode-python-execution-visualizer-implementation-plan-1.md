# LeetCode Python Execution Visualizer — Implementation Plan 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Every task ends with an independently testable result.

**Goal:** 建立可運作的 Chrome MV3 extension execution foundation，使 LeetCode Python code/testcase 能送入 bundled Pyodide Web Worker 執行，並產生可在 timeout 前持續保存的 ordered execution trace。

**Architecture:** 本階段只建立 `LeetCode Adapter → ExecutionRequest → ExecutionController → Pyodide Worker → TraceEvent batches → TraceSession Collector`。不做 AST interpretation、pointer visualization 或正式 Side Panel UI。

**Tech Stack:** TypeScript, Chrome Manifest V3, Vite, Vitest, Web Worker, Pyodide, Python `sys.settrace`.

**Spec:** `docs/superpowers/specs/2026-09-05-leetcode-python-execution-visualizer-design.md`

## Global Constraints

* Python execution 必須在 Web Worker 中。
* Pyodide executable assets 必須 bundle 在 extension 中，不從 CDN 動態載入。
* User source line number 必須保持與 LeetCode editor 一致。
* `completed` 不等於 LeetCode AC。
* `timeout` 不等於 LeetCode TLE。
* Runtime Error、trace limit、hard timeout 都必須保留已取得的 trace prefix。
* Worker 不得每個 TraceEvent 都單獨 `postMessage()`。
* v0.1 tracing granularity 固定為 Python line-level。
* MAIN-world bridge 只能負責 page-state extraction，不持有 privileged Chrome operations。

---

# Proposed File Structure

```text
leetcode-python-visualizer/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── manifest.json
│
├── src/
│   ├── shared/
│   │   ├── execution-types.ts
│   │   ├── trace-types.ts
│   │   └── worker-protocol.ts
│   │
│   ├── content/
│   │   └── leetcode-adapter.ts
│   │
│   ├── page-bridge/
│   │   └── leetcode-main-world.ts
│   │
│   ├── execution/
│   │   ├── execution-request.ts
│   │   ├── entrypoint-resolver.ts
│   │   ├── testcase-parser.ts
│   │   └── execution-controller.ts
│   │
│   ├── sidepanel/
│   │   ├── index.html
│   │   └── bootstrap.ts
│   │
│   └── worker/
│       ├── pyodide-worker.ts
│       ├── pyodide-runtime.ts
│       └── python/
│           ├── runtime_prelude.py
│           ├── tracer.py
│           └── runner.py
│
└── tests/
    ├── execution/
    ├── protocol/
    └── fixtures/
```

---

# Task 1 — Chrome MV3 Extension Shell

## Files

Create:

```text
package.json
tsconfig.json
vite.config.ts
public/manifest.json
src/sidepanel/index.html
src/sidepanel/bootstrap.ts
```

## Deliverable

Chrome 可以載入 unpacked extension，並開啟 Side Panel。

Side Panel 暫時只顯示：

```text
LeetCode Python Visualizer
Runtime: not started
```

## Manifest requirements

至少包含：

```json
{
  "manifest_version": 3,
  "name": "LeetCode Python Execution Visualizer",
  "version": "0.1.0",
  "permissions": [
    "sidePanel",
    "scripting"
  ],
  "host_permissions": [
    "https://leetcode.com/*"
  ],
  "side_panel": {
    "default_path": "sidepanel/index.html"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

不要加入與 MVP 無關的：

```text
storage
tabs
webRequest
identity
unlimitedStorage
```

permissions。

## Verification

* [ ] `npm run build`
* [ ] Build 成功。
* [ ] Chrome `chrome://extensions` 可以 Load unpacked。
* [ ] LeetCode 頁面可以開啟 Side Panel。
* [ ] DevTools console 沒有 CSP error。

## Commit

```bash
git add .
git commit -m "chore: scaffold mv3 extension shell"
```

---

# Task 2 — Shared Execution Contracts

## Files

Create:

```text
src/shared/execution-types.ts
src/shared/trace-types.ts
src/shared/worker-protocol.ts
tests/protocol/worker-protocol.test.ts
```

## Interfaces

建立：

```ts
export interface EntryPoint {
  className: string;
  methodName: string;
  parameterCount: number;
}

export interface ExecutionLimits {
  maxTraceSteps: number;
  maxContainerItems: number;
  maxNestingDepth: number;
  maxSnapshotBytes: number;
  maxSessionBytes: number;
  maxStdoutBytes: number;
  hardTimeoutMs: number;
}

export interface ExecutionRequest {
  sessionId: string;
  sourceCode: string;
  rawTestcase: string;
  entrypoint: EntryPoint;
  limits: ExecutionLimits;
}
```

Trace status：

```ts
export type TraceSessionStatus =
  | "running"
  | "completed"
  | "exception"
  | "trace_limit"
  | "timeout"
  | "parse_error"
  | "input_error"
  | "internal_error";
```

Termination reason：

```ts
export type TerminationReason =
  | "normal_return"
  | "runtime_exception"
  | "step_limit"
  | "trace_byte_limit"
  | "stdout_limit"
  | "hard_timeout"
  | "syntax_error"
  | "unsupported_testcase_format"
  | "entrypoint_resolution_failed"
  | "worker_initialization_failed"
  | "pyodide_initialization_failed"
  | "tracer_internal_error";
```

Worker protocol：

```ts
export type WorkerInboundMessage =
  | {
      type: "execute";
      request: ExecutionRequest;
    };

export type WorkerOutboundMessage =
  | {
      type: "ready";
    }
  | {
      type: "trace_batch";
      sessionId: string;
      events: TraceEvent[];
    }
  | {
      type: "execution_finished";
      sessionId: string;
      result: ExecutionTerminalResult;
    }
  | {
      type: "worker_error";
      sessionId?: string;
      message: string;
    };
```

## Tests

驗證：

* legal status values
* trace batch retains session id
* execution terminal result 可以與 trace batches 分離
* timeout result 不要求 worker 回傳最後 batch

## Verification

```bash
npm test -- worker-protocol
```

Expected：

```text
PASS
```

## Commit

```bash
git add src/shared tests/protocol
git commit -m "feat: define execution and trace contracts"
```

---

# Task 3 — LeetCode Adapter Spike

## Files

Create:

```text
src/content/leetcode-adapter.ts
src/page-bridge/leetcode-main-world.ts
tests/execution/leetcode-adapter.test.ts
```

## Public interface

```ts
export interface ProblemMetadata {
  slug: string | null;
  title: string | null;
}

export interface LeetCodeSnapshot {
  code: string;
  language: string;
  testcase: string;
  metadata: ProblemMetadata;
}

export interface LeetCodeAdapter {
  getSnapshot(): Promise<LeetCodeSnapshot>;
}
```

## Design

所有 LeetCode DOM/page-state coupling 都限制在這一層。

流程：

```text
Content Script
   ↓
try isolated extraction
   ↓ unavailable
MAIN-world bridge
   ↓
validated structured message
   ↓
LeetCodeAdapter
```

MAIN bridge 只回傳：

```ts
{
  code,
  language,
  testcase,
  metadata
}
```

禁止回傳 function、DOM element 或 privileged callback。

## Spike procedure

在目前 LeetCode Python 題目上驗證：

1. code editor current content
2. selected language
3. testcase editor current content
4. problem slug/title

對 code editor 優先測試 page Monaco runtime 是否存在。

若存在：

```js
window.monaco?.editor?.getModels()
```

只在 MAIN-world bridge 使用。

若不存在，檢查 editor DOM 是否有穩定 text source。

所有 discovered selectors/access paths 集中定義在：

```ts
const LEETCODE_ACCESSORS = ...
```

不得散落在 UI 或 execution layer。

## Acceptance

對 Two Sum 題修改 code 及 testcase 後：

```ts
const snapshot = await adapter.getSnapshot();
```

必須回傳**目前 editor 中實際內容**，不是初始題目 template。

## Commit

```bash
git add src/content src/page-bridge tests/execution
git commit -m "feat: add isolated leetcode adapter"
```

---

# Task 4 — Entrypoint Resolver & Testcase Parser

## Files

Create:

```text
src/execution/entrypoint-resolver.ts
src/execution/testcase-parser.ts
src/execution/execution-request.ts

tests/execution/entrypoint-resolver.test.ts
tests/execution/testcase-parser.test.ts
```

## Entrypoint behavior

Input：

```python
class Solution:
    def twoSum(self, numbers: List[int], target: int):
        pass
```

Output：

```ts
{
  className: "Solution",
  methodName: "twoSum",
  parameterCount: 2
}
```

`self` 不計入 parameter count。

如果：

* 找不到 `Solution`
* 沒有 candidate method
* candidate ambiguous

回傳 typed failure：

```ts
{
  ok: false,
  reason: "entrypoint_resolution_failed"
}
```

不要 heuristic 猜第一個 random function。

## Testcase Parser

v0.1 支援每一行代表一個 Python literal argument：

```text
[2,7,11,15]
9
```

轉換成：

```json
[
  [2, 7, 11, 15],
  9
]
```

支援：

```text
int
float
bool
str
None
list
tuple
dict
set
```

不要 JavaScript `eval()`。

真正 parsing 由 Python runtime 使用：

```python
ast.literal_eval
```

完成。

TS layer 只保存：

```text
rawTestcase
```

並檢查 argument line count 是否與 `parameterCount` 相容。

## Acceptance

以下必須通過：

```text
twoSum(list, int)
binarySearch(list, int)
single argument list
string argument
None
malformed literal
wrong argument count
```

## Commit

```bash
git add src/execution tests/execution
git commit -m "feat: build execution request from leetcode input"
```

---

# Task 5 — Bundled Pyodide Worker Boot

## Files

Create:

```text
src/worker/pyodide-worker.ts
src/worker/pyodide-runtime.ts
src/worker/python/runtime_prelude.py
```

## Runtime API

```ts
export interface PyodideRuntime {
  initialize(): Promise<void>;
  execute(request: ExecutionRequest): Promise<void>;
}
```

Worker boot：

```text
Side Panel
   ↓ new Worker(...)
Module Worker
   ↓
load local Pyodide assets
   ↓
postMessage({type: "ready"})
```

Pyodide 不得使用 CDN URL。

## Runtime prelude

獨立執行：

```python
from typing import *
from collections import *
from functools import *
from itertools import *
from math import *
from heapq import *
from bisect import *
```

user source 必須獨立：

```python
compile(source_code, "<leetcode-user-code>", "exec")
```

不可：

```python
compile(prelude + source_code, ...)
```

避免 source line offset。

## Verification

Worker 能執行：

```python
class Solution:
    def add(self, a: int, b: int):
        return a + b
```

Testcase：

```text
2
3
```

Result：

```text
5
```

## Commit

```bash
git add src/worker
git commit -m "feat: execute python in bundled pyodide worker"
```

---

# Task 6 — Python Trace Engine

## Files

Create:

```text
src/worker/python/tracer.py
src/worker/python/runner.py
tests/fixtures/python/
```

## Tracer responsibilities

使用：

```python
sys.settrace(trace_function)
```

捕捉：

```text
call
line
return
exception
```

只記錄：

```text
<leetcode-user-code>
```

避免把：

* tracer internals
* Pyodide internals
* runtime prelude

放入 user trace。

## Frame identity

建立：

```python
frame_ids: dict[int, int]
next_frame_id = 1
```

針對每個 Python frame 配置 session-local monotonic ID。

Event：

```python
{
    "step": 18,
    "event": "line",
    "frame_id": 4,
    "parent_frame_id": 1,
    "function": "twoSum",
    "line": 7,
    "call_depth": 2,
    "locals": {...},
    "stdout_delta": ""
}
```

## Step limit

每 relevant event：

```python
step_count += 1
```

若：

```python
step_count > max_trace_steps
```

停止 user execution，terminal result：

```text
status = trace_limit
reason = step_limit
```

## Required tests

Trace：

```python
def f(x):
    y = x + 1
    return y
```

確認：

```text
call
line
line
return
```

Recursive：

```python
def f(n):
    if n == 0:
        return 0
    return f(n - 1)
```

確認每次 invocation 有不同 `frame_id`。

Exception：

```python
x = [1]
x[4]
```

確認 exception event 被保存。

## Commit

```bash
git add src/worker/python tests/fixtures
git commit -m "feat: collect line-level python trace events"
```

---

# Task 7 — Trace Batching & Session Collector

## Files

Create:

```text
src/execution/execution-controller.ts
src/execution/trace-session-collector.ts
tests/execution/trace-session-collector.test.ts
```

## Collector

```ts
export class TraceSessionCollector {
  append(events: TraceEvent[]): void;
  finish(result: ExecutionTerminalResult): TraceSession;
  forceTimeout(): TraceSession;
}
```

Worker 每達：

```text
50 events
```

或 batch serialized size threshold 時送：

```text
trace_batch
```

不要等 execution 完成。

## Hard timeout

Controller：

```ts
const timeoutId = setTimeout(() => {
  worker.terminate();
  collector.forceTimeout();
}, request.limits.hardTimeoutMs);
```

timeout 後：

```text
status = timeout
terminationReason = hard_timeout
```

並保留：

```text
collector.events
```

## Critical test

模擬：

```text
batch 1 = events 1..50
batch 2 = events 51..100
worker terminated
```

Result：

```text
session.events.length === 100
session.status === "timeout"
```

## Commit

```bash
git add src/execution tests/execution
git commit -m "feat: preserve trace batches across worker timeout"
```

---

# Task 8 — Phase 0/1 Acceptance Harness

建立 temporary developer screen：

```text
Code textarea
Testcase textarea
Run
Trace event JSON
```

不追求正式 UI。

測試：

### Normal

```text
Two Sum
```

### Exception

```text
IndexError
```

### Recursion

```text
factorial / DFS
```

### Trace limit

```python
while True:
    x += 1
```

### Hard timeout

故意設：

```text
MAX_TRACE_STEPS = very high
hardTimeoutMs = low
```

驗證 timeout 路徑。

## Phase 1 Exit Criteria

只有以下全部成立才進 Plan 2：

* [ ] MV3 + Side Panel 可穩定載入。
* [ ] Bundled Pyodide 可初始化。
* [ ] LeetCode current code/testcase 可抽取。
* [ ] ExecutionRequest 可建立。
* [ ] User source line number 沒被 prelude offset。
* [ ] `call/line/return/exception` trace 順序正確。
* [ ] Recursion frame identity 正確。
* [ ] Trace step limit 生效。
* [ ] Hard timeout 不 freeze UI。
* [ ] Hard timeout 前 trace prefix 不遺失。

最後：

```bash
git commit -am "milestone: complete execution trace foundation"
```

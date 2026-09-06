# Live Visualization

## Design Spec v0.1

---

# 1. Goal

將目前的手動 workflow：

```text
LeetCode editor
    ↓
snapshot sync
    ↓
按 Visualize
    ↓
execute
    ↓
trace
    ↓
visualize
```

改成：

```text
LeetCode editor
    ↓
snapshot update
    ↓
LiveExecutionScheduler
    ↓
latest runnable revision
    ↓
execute
    ↓
trace
    ↓
visualize automatically
```

使用者在 LeetCode 修改 Python code 後，不需要再按 `Visualize`。Side Panel 應在短暫 debounce 後，自動以目前選定 testcase 執行最新可執行版本，並更新 execution visualization。

這個 feature 的目的不是提高 execution coverage，而是把現有 visual debugger 改成 near-real-time feedback loop：

```text
Write code
    ↓
See actual execution state
    ↓
Adjust code
    ↓
See updated execution state
```

---

# 2. Existing Baseline

目前系統已經具備：

- LeetCode code / testcase snapshot extraction；
- MAIN-world bridge；
- `snapshot_updated` event；
- Side Panel code / testcase mirror；
- testcase case selection；
- `ExecutionRequest` construction；
- Web Worker + bundled Pyodide execution；
- bounded trace collection；
- state reconstruction / diff / visual model；
- `TraceVisualizer`、`ListVisualizer`、`DictVisualizer`；
- `Previous / Next / Play` trace inspection。

因此 Live Visualization 不新增另一套 editor integration，也不新增另一套 tracing pipeline。

它只在：

```text
snapshot update
```

與：

```text
ExecutionController
```

之間增加 scheduling / lifecycle coordination。

---

# 3. Scope

本 spec 包含：

1. snapshot update 後自動執行；
2. debounce；
3. revision-based latest-wins scheduling；
4. incomplete / temporarily unrunnable code 的 last-runnable visualization；
5. selected testcase 與 live execution 的一致性；
6. warmed Pyodide worker reuse；
7. hard timeout / worker failure 後的 worker recovery；
8. live status UI；
9. 保留現有 trace inspection controls。

---

# 4. Explicit Non-Goals

此 feature 不包含：

- Tree visualizer；
- Graph visualizer；
- Linked List visualizer；
- DP table visualizer；
- expression-level stepping；
- AI algorithm inference；
- AI explanation / correction；
- correctness / AC / WA 判斷；
- 改成 Monaco `onDidChangeContent` event integration；
- 大規模 Side Panel UI redesign；
- 多 execution 並行。

現有約 300 ms page-state polling 可以繼續使用。

---

# 5. Interaction Semantics

Live Visualization 是：

> near-real-time visualization of the latest runnable draft

不是：

> execute on every keystroke

使用者輸入過程中，code 可能暫時是 invalid Python，例如：

```python
if need in
```

此時不應清空既有 visualization，也不應把正常 editing flow 當成主要 runtime failure。

UI 應維持上一份可顯示的 trace，並進入：

```text
Editing
```

狀態。

當最新 code 可以形成有效 execution request 時，進入：

```text
Updating
```

完成且仍為最新 revision 時，進入：

```text
Synced
```

---

# 6. Live Status Model

第一版 live status：

```ts
type LiveStatus =
  | "editing"
  | "updating"
  | "synced"
  | "runtime_error"
  | "timeout";
```

語意：

## `editing`

最新 snapshot 尚不能形成有效 execution request，例如：

- entrypoint 暫時無法解析；
- testcase 與目前 method parameter count 暫時不一致；
- code 正在輸入中而不完整。

此狀態保留 last rendered visualization。

## `updating`

已接受一個 runnable revision，正在 debounce、等待目前 execution 完成、初始化 worker，或執行 latest revision。

## `synced`

目前顯示的 `TraceSession` 對應最新已接受且 runnable 的 revision，以及當時選中的 testcase。

## `runtime_error`

最新 runnable revision 已執行並產生 runtime exception / internal error。若該 session 含有效 trace prefix，仍應顯示該 session。

## `timeout`

最新 runnable revision 達到 hard timeout。保留 timeout 前收集到的 trace prefix；worker 必須被視為 unhealthy 並重建。

---

# 7. Scheduling Architecture

新增一個單一責任元件：

```text
LiveExecutionScheduler
```

責任：

- 接受最新 `LeetCodeSnapshot` + selected testcase；
- 產生 monotonic revision id；
- debounce；
- 驗證是否可以建立 `ExecutionRequest`；
- 保證 single-flight execution；
- collapse intermediate revisions；
- 防止 stale result render；
- 通知 Side Panel live status；
- 將真正的 Python execution 委派給 `ExecutionController`。

它不負責：

- LeetCode DOM extraction；
- Python trace interpretation；
- rendering；
- worker protocol parsing。

建議位置：

```text
src/execution/live-execution-scheduler.ts
```

---

# 8. Revision Model

每次影響 execution input 的變化都建立新的 revision：

- code change；
- testcase content change；
- selected testcase case change。

使用 monotonic integer：

```ts
type RevisionId = number;
```

例如：

```text
41 → 42 → 43 → 44
```

Scheduler 永遠只需要保存：

```text
running revision
latest pending revision
latest rendered revision
```

不建立 FIFO execution queue。

如果：

```text
revision 41 running
revision 42 arrives
revision 43 arrives
revision 44 arrives
```

則：

```text
running = 41
pending = 44
```

`42`、`43` 不需要執行。

當 `41` 結束：

- 若 `41` 已不是最新 revision，不 render 它；
- 接著執行 `44`。

形式上：

```text
pending := max(received runnable revisions not yet started)
```

---

# 9. Single-Flight Rule

Live execution 不允許兩個 Python requests 同時在同一 worker runtime 中執行。

Scheduler contract：

```text
0 or 1 running execution
0 or 1 pending latest execution
```

因此第一版不需要實作 cooperative Python cancellation。

正常快速 execution：

```text
A running
B arrives
C arrives
A finishes
C runs
```

長時間 execution 則依既有 hard timeout 終止，不讓 pending revision 無限等待。

---

# 10. Debounce

目前 MAIN-world bridge 已約每 300 ms 檢查一次 page state，且只在 snapshot 改變時 publish。

因此 Live scheduler 第一版 debounce 建議：

```text
200 ms
```

固定值即可，不做 adaptive debounce。

目的：

- 合併同一次 typing burst 中緊鄰的 snapshot changes；
- 避免額外引入接近 1 秒的 feedback latency。

未來若改成 Monaco change event，再重新評估 debounce；不在本 spec 範圍內。

---

# 11. Runnable Validation and Last-Runnable State

Scheduler 收到 revision 後，在真正執行前使用現有 request construction path：

```text
resolveEntrypoint
    +
selected testcase
    ↓
createExecutionRequest
```

若 request 無法建立：

```text
latest revision = invalid / incomplete
```

則：

1. 不呼叫 `ExecutionController.execute()`；
2. status = `editing`；
3. 不 dispose 目前 `TraceVisualizer`；
4. 不清空 result panel；
5. 等待下一個 snapshot revision。

這個 last-runnable behavior 只保留畫面，不代表舊 execution 已與最新 code 同步。

因此 UI 必須透過 `editing` 狀態明確表示目前 visualization 是上一個 runnable revision。

---

# 12. Testcase Semantics

Live execution 永遠使用 Side Panel 當前選中的 case。

例如原 testcase 包含：

```text
Case 1
Case 2
Case 3
```

若使用者目前選擇 `Case 2`：

```text
code revision 50
    ↓
Case 2
    ↓
execution 50
```

當 user 改成 `Case 3`，即使 code 沒有修改，也建立新 revision 並自動執行。

Snapshot 更新時若 case 數量仍允許目前 index，保留 selection。

若 case 數量縮小使 selection invalid，fallback 至 Case 1，並以新的有效 selection 建立 revision。

---

# 13. ExecutionController Lifecycle

目前 `ExecutionController` 每次 execution 建立新 Worker，完成後 terminate。

Live Visualization 需要改為：

```text
ExecutionController instance
        ↓
create worker lazily
        ↓
wait until ready
        ↓
execute request A
        ↓
keep worker alive
        ↓
execute request B
        ↓
keep worker alive
```

正常 execution 間重用同一 warmed Pyodide runtime。

Controller 仍維持 single active request contract；scheduler 負責避免 concurrent calls。

建議新增 lifecycle operation：

```ts
dispose(): void;
```

Side Panel teardown 或 unrecoverable worker replacement 時可明確釋放 worker。

---

# 14. Runtime Isolation Across Reused Worker

Worker persistence 不等於 user-code globals persistence。

每個 execution 必須建立新的 per-request runtime namespace。

目前 execution script 已建立：

```python
__lc_runtime_namespace = {}
```

並將 user execution state 放在該 request-specific namespace 中。

Persistent worker implementation 必須保留此 isolation property。

不得因 worker reuse 讓：

- 前一次 Solution instance；
- user globals；
- testcase mutation；
- tracer state；
- stdout buffer；
- session trace state

洩漏至下一次 execution。

可以重用的是：

```text
Pyodide VM / WebAssembly runtime
```

而不是：

```text
user execution namespace
```

---

# 15. Worker Failure and Recovery

Worker 分成：

```text
healthy
unhealthy
```

以下情況 worker 必須視為 unhealthy：

- hard timeout；
- worker `error` event；
- malformed / unrecoverable worker protocol error；
- initialization failure。

Unhealthy worker：

```text
terminate
    ↓
clear worker reference
    ↓
next runnable execution lazily creates new worker
    ↓
initialize Pyodide again
```

正常 Python runtime exception：

```python
IndexError
KeyError
ValueError
...
```

不代表 worker unhealthy。

這些只是該 request 的合法 terminal result，worker 可繼續 reuse。

---

# 16. Timeout Behavior

如果 revision `R` hard timeout：

1. 收集並完成目前已取得的 trace prefix；
2. `R` 仍是 latest revision 時，render timeout session；
3. status = `timeout`；
4. terminate worker；
5. 若已有 newer pending runnable revision，重建 worker 後執行最新 pending revision。

如果 timeout 的 `R` 已 stale：

- 不用它覆蓋目前 UI；
- 仍必須 terminate unhealthy worker；
- 直接恢復 latest pending revision。

---

# 17. Stale Result Rule

任何 execution result 在 render 前都必須比較 revision。

只有：

```text
result.revisionId === latestRunnableRevisionId
```

才可以替換目前 visualization。

Revision metadata 可以存在 scheduler promise context，不要求修改 Python trace schema 或 worker wire protocol。

因此不需要把 `revisionId` 寫入每個 `TraceEvent`。

`sessionId` 繼續負責 worker protocol correlation；`revisionId` 負責 Side Panel live scheduling correlation。

這兩者是不同概念。

---

# 18. Rendering Semantics

收到最新可 render session 時：

```text
activeVisualizer.dispose()
    ↓
createTraceVisualizer(newSession)
    ↓
replace visualization-output
```

第一版可以維持完整 `TraceVisualizer` replacement。

跨 source revision 的 visual DOM morphing / object identity animation 不是本 feature 的 acceptance requirement。

現有單一 trace session 內 ListVisualizer 的 stable DOM behavior 保留。

---

# 19. Manual Trace Inspection

Live mode 只自動決定：

> 哪一份 execution trace 是目前要看的 trace

它不移除 trace navigation。

最新 session render 後，仍保留：

- Previous；
- Next；
- Play / Pause；
- current step；
- locals；
- state changes；
- call stack；
- output；
- list / dict visualization。

第一版不需要新增獨立的 `Live / Inspect` toggle。

使用者操作 Previous / Next 時，只是在 inspect 當前 latest session。

下一個 runnable revision 完成後，Side Panel 仍會切換到新的 latest session。

---

# 20. Visualize Button

第一版可以保留 `Visualize` button，但其角色改為：

```text
Run now / Retry
```

而不是主要 execution trigger。

按下按鈕時：

- bypass debounce；
- 對目前 snapshot / selected testcase 建立新 revision；
- 仍遵守 latest-wins 與 single-flight rules。

若實際 UX 驗證後證明沒有必要，再於後續版本移除。

---

# 21. High-Level Data Flow

```text
LeetCode Monaco / DOM
        │
        ▼
page-bridge/leetcode-main-world.ts
        │ snapshot_updated
        ▼
content/content-script.ts
        │ validated extension message
        ▼
sidepanel/bootstrap.ts
        │
        ├── update read-only mirror
        ├── update case selector
        │
        ▼
execution/live-execution-scheduler.ts
        │
        ├── revision
        ├── debounce
        ├── request validation
        ├── latest-wins
        └── single-flight
        │
        ▼
execution/execution-controller.ts
        │
        ▼
persistent Web Worker
        │
        ▼
warmed Pyodide
        │
        ▼
TraceSession
        │
        ▼
existing trace interpretation
        │
        ▼
existing TraceVisualizer
```

---

# 22. Primary File Boundaries

## New

```text
src/execution/live-execution-scheduler.ts
```

Owns live scheduling state and revision semantics.

Suggested test file:

```text
tests/execution/live-execution-scheduler.test.ts
```

## Modified

```text
src/execution/execution-controller.ts
```

Changes worker lifecycle from per-request worker to persistent warmed worker with explicit recovery/disposal.

```text
src/sidepanel/bootstrap.ts
```

Connects `snapshotSubscription`, case selection, manual run, status rendering, scheduler callbacks, and visualizer replacement.

Likely regression tests:

```text
tests/execution/pyodide-worker.test.ts
tests/execution/pyodide-runtime.test.ts
tests/sidepanel/bootstrap.test.ts
```

Worker protocol types should only change if persistent lifecycle requires a concrete protocol correction. Revision scheduling alone must not force revision fields into the worker protocol.

---

# 23. Design Alternatives Considered

## A. Execute directly inside `applySnapshot`

Rejected.

Reason：

- debounce、stale result、single-flight、case changes、retry semantics 都會塞進 `bootstrap.ts`；
- Side Panel UI code 會同時負責 scheduling policy；
- 難以獨立測試。

## B. Put live scheduling inside `ExecutionController`

Rejected.

Reason：

`ExecutionController` 應維持：

```text
ExecutionRequest → TraceSession
```

的 execution abstraction。

Editor revisions / selected testcase / debounce 是 interaction-level policy，不應污染 execution primitive。

## C. Separate `LiveExecutionScheduler` above persistent `ExecutionController`

Selected.

Reason：

- scheduling 與 execution lifecycle 分離；
- scheduler 可純單元測試；
- 現有 tracing / visualization pipeline 幾乎不變；
- 未來若更換 snapshot source，scheduler contract 仍可保留。

---

# 24. Acceptance Criteria

Live Visualization MVP 完成需滿足：

1. 修改 LeetCode Python code 後，不需點擊 `Visualize` 即會自動執行。
2. 自動執行使用目前選定 testcase case。
3. selected case 改變時，即使 code 不變，也會自動重新執行。
4. typing burst 不會建立 unbounded execution queue。
5. scheduler 同時間最多一個 execution running。
6. 中間 revisions 被 collapse，只保留 latest pending revision。
7. stale execution result 不得覆蓋較新 revision 的 UI。
8. 暫時無法建立 execution request 的 code 不會清空上一份 visualization。
9. incomplete code 時 UI 顯示 `editing`。
10. runnable execution 進行期間顯示 `updating`。
11. 最新 execution 完成後顯示 `synced` 或相應 terminal failure status。
12. 正常連續 execution 重用同一 warmed Pyodide worker。
13. 每個 request 保持 user runtime namespace isolation。
14. hard timeout / worker error 後會 terminate unhealthy worker。
15. failure recovery 後下一個 runnable revision 可以重新初始化 worker 並繼續 execution。
16. Runtime Error / timeout 的 trace prefix 仍可視覺化。
17. `Previous / Next / Play` 對最新 TraceSession 仍正常運作。
18. 手動 `Visualize` 若保留，可立即觸發 run/retry，但仍遵守 scheduler rules。
19. 現有 LeetCode snapshot sync、trace interpretation、ListVisualizer、DictVisualizer 不因 Live Mode regression。
20. `npm test`、`npm run typecheck`、`npm run build` 全部通過。

---

# 25. Manual Chrome Acceptance

自動測試通過後，需要在實際 Chrome extension side panel 驗證：

```text
A. 開啟 Two Sum
B. 選 Case 1
C. 不按 Visualize
D. 修改一個 runnable line
E. 確認 Side Panel 自動進入 Updating → Synced
F. 快速連續修改數次，確認沒有舊結果倒退覆蓋新結果
G. 輸入暫時 syntax-incomplete code，確認上一份 visual 保留且狀態為 Editing
H. 補完 syntax，確認自動恢復執行
I. 切換 Case 2 / Case 3，確認自動重新執行
J. 寫入可觸發 Runtime Error 的 code，確認 trace prefix 保留
K. 寫入 infinite loop，確認 hard timeout 後 UI 不鎖死
L. 修正 infinite loop，確認 worker 重建後 Live Visualization 自動恢復
M. 使用 Previous / Next / Play 檢查最新 trace
```

---

# 26. Product Boundary After This Feature

完成後，產品主 interaction 從：

```text
write → click Visualize → inspect
```

變成：

```text
write ↔ visualize
```

Tree、Graph、DP 等後續工作仍然是在擴充：

> visualized representation 的種類

而 Live Visualization 解決的是更底層的問題：

> 使用者如何持續使用這個 visualizer 作為 coding feedback loop。

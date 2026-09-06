# Active Tab Ownership

## Design Spec v0.1

---

# 1. Goal

確保 Chrome Side Panel 永遠只由「目前 Side Panel 所屬 Chrome window 的 active LeetCode tab」驅動。

目前 Live Visualization 已能在同一個 LeetCode tab 中根據 code / testcase / selected case 變化自動更新，但當使用者在多個 LeetCode tabs 間切換時，Side Panel 不會主動切換到新的 active tab；此外，background LeetCode tab 發出的 `snapshot_updated` 目前也可能被 Side Panel 接受。

此 feature 將 source-of-truth 明確定義為：

```text
Active LeetCode Tab
        ↓
Canonical Snapshot
        ↓
LiveExecutionScheduler
        ↓
TraceSession
        ↓
Side Panel Visualization
```

核心 invariant：

> 只有目前 Side Panel 所屬 Chrome window 中的 active LeetCode tab，才有權更新 current snapshot、觸發 LiveExecutionScheduler，或替換目前 visualization。

---

# 2. Existing Baseline

目前 repo 已完成：

- MAIN-world LeetCode page-state extraction；
- 約 300 ms snapshot polling，且只有 snapshot 真正變化才 publish；
- content script 將 `snapshot_updated` forwarding 至 extension runtime；
- Side Panel 初始化時可 query current active LeetCode tab 並 request snapshot；
- `LiveExecutionScheduler` 的 200 ms debounce、latest-wins、single-flight、last-runnable semantics；
- persistent warmed Pyodide Worker；
- Side Panel live visualization、case selection 與 `Run now`；
- Side Panel dispose lifecycle。

現有缺口：

1. `snapshotProvider()` 只在初始化與 `Run now` 主動查 active tab；
2. tab activation 本身不觸發 canonical snapshot fetch；
3. runtime snapshot listener 沒有使用 `sender.tab.id` 驗證 ownership；
4. same-tab navigation 沒有被 Side Panel 視為 source identity / canonical source state change；
5. active tab 切到 non-LeetCode 時沒有明確 paused state；
6. tab-switch 中可能出現 stale snapshot fetch 或 stale execution completion race。

---

# 3. Scope

本 spec 包含：

1. active LeetCode tab ownership；
2. current-window scoping；
3. `chrome.tabs.onActivated` tracking；
4. active-tab `chrome.tabs.onUpdated` handling；
5. exact-tab snapshot fetch；
6. runtime snapshot sender filtering；
7. active-tab epoch / stale async snapshot suppression；
8. tab ownership change時讓舊 scheduler result 失效；
9. non-LeetCode active tab 的 paused semantics；
10. Side Panel cleanup / listener disposal；
11. multi-tab / same-tab-navigation / multi-window testing。

---

# 4. Explicit Non-Goals

此 feature 不包含：

- 新增 background service worker；
- 新增跨 window global coordinator；
- 新增 `tabs` permission；
- 改 MAIN-world 300 ms polling；
- 改 Monaco integration；
- 修改 Python tracing 或 worker protocol；
- 把 tab id 或 active-tab epoch 寫入 `TraceEvent`；
- 強制 cancel 正在執行的 Python request；
- 每個 LeetCode tab 各自保存一份 Side Panel UI state；
- Tree / Graph / DP 等 visualization 擴充；
- 大規模 Side Panel UI redesign。

---

# 5. Selected Architecture

採用 Side Panel-owned active-tab tracking。

新增：

```text
src/sidepanel/active-tab-source.ts
```

高階 flow：

```text
Chrome tabs API
    ↓
ActiveTabSource
    ├─ current window ownership
    ├─ active tab identity
    ├─ tab activation
    ├─ active-tab navigation
    ├─ exact-tab snapshot fetch
    ├─ runtime sender filtering
    └─ active-tab epoch
            ↓
        Side Panel callbacks
            ↓
      LiveExecutionScheduler
            ↓
        TraceVisualizer
```

不新增 background/service worker，因為目前只有 Side Panel 需要 active-tab ownership。將 coordination 放到 background 會增加額外 lifecycle、manifest、message protocol 與測試面，沒有對 MVP 帶來必要收益。

---

# 6. Public Component Boundary

建議 contract：

```ts
export interface ActiveTabSnapshot {
  tabId: number;
  snapshot: LeetCodeSnapshot;
}

export type ActiveTabState =
  | {
      kind: "leetcode";
      tabId: number;
    }
  | {
      kind: "paused";
    };

export interface ActiveTabSourceOptions {
  onStateChange(state: ActiveTabState): void;
  onSnapshot(value: ActiveTabSnapshot): void;
}

export interface ActiveTabSource {
  start(): Promise<void>;
  dispose(): void;
}
```

`ActiveTabSource` 負責所有 Chrome tab identity / sender / window semantics。

`bootstrap.ts` 不應直接處理：

```text
tabs.onActivated
tabs.onUpdated
sender.tab.id
windowId
active-tab epoch
```

`bootstrap.ts` 只處理：

```text
onStateChange
onSnapshot
```

---

# 7. Source of Truth

Side Panel 的 canonical source 是：

```text
activeLeetCodeTabId
```

不是：

```text
latest snapshot message received from any LeetCode tab
```

因此 runtime snapshot acceptance rule 必須是：

```text
sender.tab.id === activeLeetCodeTabId
```

若不成立：

```text
ignore
```

這將目前的：

```text
latest message wins
```

改為：

```text
active tab wins
```

---

# 8. Current Window Ownership

Side Panel 只追蹤它所屬 Chrome window 的 active tab。

初始化時：

```text
chrome.tabs.query({ active: true, currentWindow: true })
```

取得 initial tab 後，記錄：

```ts
currentWindowId = tab.windowId;
```

`tabs.onActivated`：

```ts
if (activationInfo.windowId !== currentWindowId) {
  return;
}
```

另一個 Chrome window 的 tab activation 不得影響目前 Side Panel。

若初始化 query 無法取得任何 active tab，進入 paused state。

---

# 9. Exact-Tab Snapshot Fetch

將目前 active-tab query 與 snapshot fetch 解耦。

底層 API：

```ts
requestSnapshotFromLeetCodeTab(tabId: number): Promise<LeetCodeSnapshot>
```

現有概念上的：

```ts
requestSnapshotFromActiveLeetCodeTab()
```

若仍保留，只能作為：

```text
query active tab
    ↓
requestSnapshotFromLeetCodeTab(tab.id)
```

的 convenience wrapper。

當 `tabs.onActivated` 已提供 `tabId` 時，必須直接 request 該 exact tab，不得再 query active tab，避免 tab switch race。

---

# 10. Active Tab Epoch

每次 active-tab ownership identity 改變，都增加 monotonic epoch：

```ts
type ActiveTabEpoch = number;
```

內部 state 至少包含：

```text
currentWindowId
activeLeetCodeTabId
activeTabEpoch
```

每個 async canonical snapshot fetch 捕捉：

```text
(tabId, epoch)
```

fetch 完成後，只有：

```text
tabId === activeLeetCodeTabId
AND
epoch === activeTabEpoch
```

才可以 emit `onSnapshot()`。

例如：

```text
activate Two Sum
    ↓ fetch Two Sum (slow)

activate Binary Search
    ↓ epoch++
    ↓ fetch Binary Search (fast)
    ↓ emit Binary Search

Two Sum response arrives late
    ↓ epoch mismatch
    ↓ ignore
```

---

# 11. Tab Activation Semantics

`chrome.tabs.onActivated` 是 LeetCode-tab switching 的 primary ownership event。

若 activation event 屬於 Side Panel current window：

1. 增加 `activeTabEpoch`；
2. 取得該 exact `tabId` 的 tab metadata；
3. 重新判斷是否為可擁有 source 的 LeetCode tab；
4. emit ownership state；
5. 若為 LeetCode，立即向該 exact `tabId` fetch canonical snapshot。

LeetCode → LeetCode：

```text
Binary Search
    ↓ onActivated
Two Sum
    ↓
state = leetcode(tabId=TwoSum)
    ↓
fetch Two Sum
    ↓
onSnapshot(Two Sum)
```

即使 Two Sum tab 本身 code 沒有變，也必須 fetch，不能依賴該 tab 自己再次 publish `snapshot_updated`。

---

# 12. Same-Tab Navigation Semantics

`tabs.onUpdated` 處理 active tab 內的 navigation / reload。

只考慮：

```text
tabId === currently active tab id
```

並且只在下列條件重新判斷：

```text
changeInfo.url !== undefined
OR
changeInfo.status === "complete"
```

URL change 用來立即更新 ownership：

```text
LeetCode → non-LeetCode
LeetCode problem A → LeetCode problem B
```

`status === "complete"` 用來在 navigation / reload 完成後重新拉 canonical snapshot。

若 active tab navigation 後仍為 LeetCode：

```text
invalidate previous ownership relevance
→ keep same tabId as owner
→ fetch canonical snapshot
```

若不再是 LeetCode：

```text
activeLeetCodeTabId = null
→ paused
```

重複 `onUpdated` event 可以發生；stale fetch 由 epoch 擋掉，identical execution input 由現有 LiveExecutionScheduler duplicate suppression 擋掉。

---

# 13. Background Snapshot Filtering

runtime snapshot listener 必須讀取 Chrome runtime message sender。

概念：

```ts
const onMessage = (
  message: unknown,
  sender: chrome.runtime.MessageSender
): void => {
  if (sender.tab?.id !== activeLeetCodeTabId) {
    return;
  }

  // validate snapshotUpdated
  // emit current active-tab snapshot
};
```

Behavior：

```text
Active = Two Sum

Two Sum snapshot_updated       → accept
Binary Search snapshot_updated → ignore
```

若 `activeLeetCodeTabId === null`，所有 LeetCode runtime snapshot 都忽略。

---

# 14. Scheduler Invalidation on Ownership Change

Tab identity 改變時，舊 execution 的 result 即使之後完成，也不得 render。

因此 `LiveExecutionScheduler` 新增一個 control API：

```ts
invalidate(): number;
```

語意：

1. increment scheduler revision；
2. clear debounce timer；
3. clear latest pending run；
4. make current running result stale；
5. do not terminate the running Python execution；
6. do not emit a LiveStatus by itself。

`invalidate()` 不負責 ownership UI。

例如：

```text
Binary Search R20 running
    ↓
activate Two Sum
    ↓
scheduler.invalidate()
    ↓
Two Sum canonical snapshot arrives
    ↓
new scheduler revision

R20 finishes later
    ↓
stale
    ↓
may not render
```

不強制 terminate Worker，因為現有 request 已有 hard timeout，且每次 tab switch 都殺 Worker 會破壞 warmed Pyodide 的正常 reuse。

---

# 15. Paused Semantics

採用：

```text
Live: paused · No active LeetCode tab
```

當 current active tab 不是 LeetCode：

1. `activeLeetCodeTabId = null`；
2. increment active-tab epoch；
3. `scheduler.invalidate()`；
4. 不 schedule 新 execution；
5. 保留上一份 `TraceVisualizer`；
6. 顯示 paused status；
7. background LeetCode snapshots 全部忽略。

不清空 visualization。

這與目前 incomplete code 的 last-runnable philosophy 一致：暫時沒有新的有效 input source，不代表要摧毀使用者正在看的 visual context。

---

# 16. Resume Semantics

從 non-LeetCode tab 切回 LeetCode：

```text
tabs.onActivated
    ↓
set activeLeetCodeTabId
    ↓
state = leetcode
    ↓
UI = Live: updating
    ↓
fetch exact-tab snapshot
    ↓
onSnapshot
    ↓
LiveExecutionScheduler.schedule(...)
    ↓
Live: synced / terminal status
```

Resume 必須主動 fetch canonical snapshot，不依賴 page bridge 是否剛好 publish update。

---

# 17. Ownership State vs Execution State

`paused` 不加入 `LiveExecutionScheduler.LiveStatus`。

Scheduler 仍維持：

```ts
type LiveStatus =
  | "editing"
  | "updating"
  | "synced"
  | "runtime_error"
  | "timeout";
```

因為：

```text
paused = input-source ownership state
editing/updating/synced/... = execution/live scheduling state
```

`bootstrap.ts` 負責將 ownership state 與 scheduler status 映射成 UI text。

---

# 18. Chrome Permission Policy

本 feature 不新增：

```json
"tabs"
```

permission。

目前 manifest 已有：

```json
"host_permissions": [
  "https://leetcode.com/*"
]
```

本 feature 只需要：

- `chrome.tabs.query`；
- `chrome.tabs.get`；
- `chrome.tabs.sendMessage`；
- `chrome.tabs.onActivated`；
- `chrome.tabs.onUpdated`；
- 對 LeetCode host 判斷 tab 是否 eligible。

對 non-LeetCode tab，如果 `tab.url` 不可見或 undefined，直接視為 non-LeetCode / paused；不需要知道使用者切到哪一個非 LeetCode網站。

因此不為更廣 URL visibility 要求額外權限。

---

# 19. Error Handling

## Snapshot request failure on active LeetCode tab

若 exact-tab snapshot request 因 missing receiver 失敗，可沿用現有 content-script reinjection recovery，但 reinjection target 必須是同一個 exact `tabId`，不能重新 query active tab。

Recovery 後仍必須檢查：

```text
(tabId, epoch) still current
```

才 emit snapshot。

## Tab disappears during fetch

若 tab closed / inaccessible / sendMessage fails，且該 epoch 仍 current：

- 不套用 stale snapshot；
- ownership layer重新 resolve current active tab state；
- 若無 active LeetCode tab則 paused。

## Stale errors

舊 tab / 舊 epoch 的 async error不得改寫目前 active tab status。

---

# 20. Disposal

`ActiveTabSource.dispose()` 必須移除：

- `chrome.tabs.onActivated` listener；
- `chrome.tabs.onUpdated` listener；
- `chrome.runtime.onMessage` listener；
- 任何 source-owned temporary lifecycle state。

Side Panel `dispose()` 順序建議：

```text
ActiveTabSource.dispose()
→ LiveExecutionScheduler.dispose()
→ active TraceVisualizer.dispose()
→ ExecutionController.dispose()
```

Dispose 後任何 async snapshot response 都不得 emit callback。

---

# 21. Primary File Boundaries

## New

```text
src/sidepanel/active-tab-source.ts
```

Owns：

```text
current window
active tab identity
active-tab epoch
tab activation
tab navigation
runtime sender filtering
exact-tab canonical fetch
```

Suggested tests：

```text
tests/sidepanel/active-tab-source.test.ts
```

## Modified

```text
src/sidepanel/bootstrap.ts
```

Changes：

- consume `ActiveTabSource` callbacks；
- ownership-state UI；
- call `scheduler.invalidate()` on ownership transition；
- preserve visual on paused；
- remove blind default snapshot subscription/provider orchestration。

```text
src/execution/live-execution-scheduler.ts
```

Changes：

- add `invalidate(): number` only；
- no tab concepts；
- no new LiveStatus member。

```text
tests/execution/live-execution-scheduler.test.ts
```

Changes：

- prove `invalidate()` makes running result stale；
- prove pending/debounce are cleared。

```text
tests/sidepanel/bootstrap.test.ts
```

Changes：

- dependency-inject fake ActiveTabSource；
- assert paused/resume integration；
- assert last visualization remains visible while paused。

`public/manifest.json` should not require a permission change.

---

# 22. Design Alternatives Considered

## A. Side Panel-owned `ActiveTabSource`

Selected.

Advantages：

- ownership logic集中；
- no background service worker；
- minimal new abstraction；
- easy fake/test；
- `bootstrap.ts` 不需要直接理解 Chrome tab event details；
- matches current Side Panel-centered product architecture。

## B. Background service worker coordinator

Rejected for MVP。

Reason：

- 新增 extension lifecycle surface；
- 新增 manifest/background wiring；
- 新增 message protocol；
- 目前沒有第二個 consumer需要共享 ownership state。

## C. Only add `tabs.onActivated → snapshotProvider()`

Rejected。

Reason：

- 修復切 tab不更新的 symptom；
- 但 background tab snapshot仍可能覆蓋 active tab；
- async old-tab response race仍存在；
- same-tab navigation與non-LeetCode paused semantics未解決。

---

# 23. Automated Test Matrix

至少覆蓋：

| Case | Expected |
| --- | --- |
| initial active tab = Two Sum | fetch exact Two Sum tab |
| Binary Search → Two Sum | exact Two Sum fetch + emit |
| Two Sum → Binary Search | exact Binary Search fetch + emit |
| LeetCode → GitHub / unknown URL | paused; keep visual |
| non-LeetCode → LeetCode | exact-tab fetch + resume |
| background LeetCode sends snapshot | ignore |
| active LeetCode sends snapshot | accept |
| slow Two Sum fetch then switch Binary Search | stale Two Sum response ignored |
| old Binary Search execution completes after tab switch | stale result cannot render |
| same tab Two Sum → Binary Search | ownership relevance invalidate + canonical refetch |
| active tab reload | refetch on completion |
| other Chrome window activates tab | ignore |
| active tab disappears during request | current state re-resolved; no stale apply |
| dispose | all tab/runtime listeners removed |

---

# 24. Manual Chrome Acceptance

Use two already-open LeetCode tabs:

```text
Tab A = Binary Search
Tab B = Two Sum
```

Checklist：

```text
A. Open Side Panel while Tab A is active.
B. Confirm Binary Search code/testcase/visualization.
C. Switch to Tab B without editing any code.
D. Confirm Side Panel automatically changes to Two Sum and executes it.
E. Switch back to Tab A and confirm automatic restore.

F. Switch from LeetCode to GitHub / YouTube / ChatGPT.
G. Confirm status = "Live: paused · No active LeetCode tab".
H. Confirm the last LeetCode visualization remains visible.
I. Switch back to Two Sum and confirm automatic resume.

J. Keep Two Sum active.
K. Modify Binary Search in the background tab.
L. Confirm background Binary Search snapshot does not overwrite Two Sum.

M. In one active tab navigate Two Sum → Binary Search.
N. Confirm Side Panel changes to Binary Search without reopening the panel.

O. Rapidly switch A → B → A.
P. Confirm final code, testcase and visualization are A only.
Q. Confirm a slow B snapshot or execution cannot arrive later and overwrite A.

R. Open another Chrome window and switch tabs there.
S. Confirm the original window's Side Panel does not change ownership.
```

---

# 25. Acceptance Criteria

Feature complete requires：

1. Side Panel tracks the active tab in its own Chrome window.
2. Switching between already-open LeetCode tabs updates without requiring code edits.
3. Tab activation fetches snapshot from the exact activated tab id.
4. Background LeetCode runtime snapshots are ignored.
5. Active LeetCode runtime snapshots remain accepted for normal live editing.
6. Async snapshot responses from an older tab / epoch are ignored.
7. Scheduler running result from previous ownership cannot overwrite the new active tab.
8. Pending/debounced old ownership work is cleared on ownership transition.
9. Same-tab LeetCode problem navigation causes canonical snapshot refresh.
10. Active tab reload refreshes canonical snapshot after completion.
11. LeetCode → non-LeetCode enters paused state.
12. Paused state preserves the last visualization.
13. While paused, background LeetCode snapshots cannot resume or replace visualization.
14. Returning to LeetCode performs exact-tab canonical fetch and resumes Live Visualization.
15. Other Chrome window activity does not affect current Side Panel ownership.
16. No new `tabs` permission is required.
17. No background service worker is introduced.
18. `LiveExecutionScheduler.LiveStatus` does not gain a `paused` member.
19. `revisionId` / active-tab epoch does not enter worker protocol or trace schema.
20. All new tab/runtime listeners are removed on dispose.
21. Existing same-tab Live Visualization behavior remains intact.
22. `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` all pass.

---

# 26. Product Boundary After This Feature

Before：

```text
Live Visualization follows the latest snapshot it happens to receive.
```

After：

```text
Live Visualization follows exactly one canonical source:

active LeetCode tab
in the Side Panel's Chrome window
```

因此多 tab 使用時的 interaction 從：

```text
switch tab
→ panel may remain stale
```

變成：

```text
switch tab
→ ownership changes
→ canonical snapshot refresh
→ live execution
→ visualization follows the user
```

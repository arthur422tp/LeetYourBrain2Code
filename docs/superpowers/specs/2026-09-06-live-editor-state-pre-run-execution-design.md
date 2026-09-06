# Live Editor State & Pre-Run Execution

## Design Spec v0.1

---

# 1. Goal

讓 LeetYourBrain2Code 在使用者**尚未按下 LeetCode Run / Submit** 時，就能持續取得目前 editor 中的程式碼，並立即同步到 Chrome Side Panel。

若目前 testcase 已可從 LeetCode page state 取得，則沿用既有 Live Visualization workflow，在短暫 debounce 後自動重新執行最新可執行的 Python draft 並更新 visualization。

核心 UX：

```text
User types in LeetCode Monaco editor
        ↓
LeetYourBrain2Code observes latest editor state
        ↓
Side Panel code mirror updates immediately
        ↓
Execution readiness check
        ├─ testcase unavailable / draft not runnable
        │      ↓
        │   keep code mirror current
        │   do not replace last visualization
        │
        └─ runnable Python + testcase available
               ↓
          debounce + latest-wins
               ↓
          Pyodide execution
               ↓
          visualization update
```

最重要的 invariant：

> **Editor synchronization 與 execution readiness 是兩個不同狀態。Side Panel 能否看到最新 code，不得依賴目前是否已有 testcase，也不得依賴使用者是否按過 Run / Submit。**

---

# 2. User Problem

目前使用者實際觀察到的 workflow 是：

```text
open LeetCode problem
    ↓
type code
    ↓
Side Panel still has no usable source state
    ↓
press LeetCode Run / Submit
    ↓
Side Panel receives code + testcase
    ↓
visualization workflow starts
```

這和產品目標不一致。

LeetYourBrain2Code 的核心價值不是：

```text
write code → run on LeetCode → inspect afterward
```

而應是：

```text
write code ↔ continuously inspect execution model
```

使用者應能在 implementation 尚未完成時，持續看到插件正在追蹤自己目前寫到哪裡；當 draft 再次可執行時，visualization 自動追上最新 runnable state。

---

# 3. Existing Baseline

目前 repo 已有：

- MAIN-world access to LeetCode Monaco models；
- 約 300 ms page-state polling；
- snapshot changed-only publishing；
- content-script bridge；
- active-tab ownership 與 exact-tab canonical fetch；
- stale fetch / stale ownership suppression；
- `LiveExecutionScheduler` 200 ms debounce；
- latest-wins execution；
- single-flight scheduling；
- last-runnable visualization preservation；
- warmed bundled Pyodide Worker；
- testcase parsing / selected-case handling；
- `Run now` immediate retry。

現有 MAIN-world extraction conceptually 為：

```ts
const code = ...;
const language = ...;
const testcase = readTestcase(doc);

if (!code || !language || testcase === null) {
  return null;
}
```

因此目前 complete snapshot 的成立條件同時要求：

```text
code
AND language
AND testcase
```

這讓 source acquisition 與 execution readiness 被錯誤耦合。

只要 testcase 尚未出現在目前 selector 可讀取的 page state 中，即使 Monaco 已經有最新 code，page bridge 仍無法 publish 一份有效 snapshot。

---

# 4. Scope

本 spec 包含：

1. 將 LeetCode page/editor state 與 runnable execution input 分離；
2. typing-time Monaco code synchronization；
3. 允許 partial page state，包括尚未取得 testcase；
4. 允許 editor code 暫時為空字串或 syntax incomplete；
5. Side Panel source textarea 持續 mirror 最新 code；
6. testcase readiness 與 execution readiness 判定；
7. testcase 尚不可用時不觸發 execution；
8. testcase 之後出現時，自動使用最新 code 啟動既有 live execution；
9. 保留 last-runnable visualization semantics；
10. active-tab ownership 與 partial state 的整合；
11. page-state validation / message protocol 調整；
12. corresponding unit / integration tests。

---

# 5. Explicit Non-Goals

此 feature 不包含：

- 自動打開 Chrome Side Panel；
- 依賴或模擬使用者點擊 LeetCode Run / Submit；
- 呼叫 LeetCode judge API；
- 將本機 `completed` 解釋為 LeetCode Accepted；
- 從 problem description 自動生成或猜測 testcase；
- 使用 submission result 作為 pre-run testcase 的必要來源；
- 新增 Linked List / Tree / Graph / DP 專用 visualizer；
- 修改 Python tracing semantics；
- 修改 state diff / visual model semantics；
- 強制 cancel 正在執行的 Pyodide request；
- 以 Monaco event listener 取代現有 300 ms polling；
- 大規模 Side Panel UI redesign。

300 ms polling 已足以支援 MVP typing-time synchronization，且目前已存在完整 changed-only publish path。本 feature 優先修正 state contract，不同時引入另一套 editor observation mechanism。

---

# 6. Selected Architecture

採用：

```text
Partial LeetCode Page State
        ↓
Side Panel Code Mirror
        ↓
Execution Readiness Projection
        ↓
Existing LiveExecutionScheduler
```

也就是把目前單一 complete `LeetCodeSnapshot` responsibility 拆成兩層：

```text
Page truth
    ↓
LeetCodePageState
    ↓
readiness projection
    ↓
Runnable input
    ↓
ExecutionRequest
```

Source layer 可以表示「我現在知道什麼」。

Execution layer 只接受「目前確定可以執行什麼」。

這兩層不得重新混在一起。

---

# 7. Alternatives Considered

## Option A — 只想辦法更早取得 testcase，繼續保留 complete snapshot

概念：

```text
find testcase earlier
    ↓
keep code + language + testcase mandatory
```

不採用。

原因：

- code visibility 仍然依賴 testcase；
- testcase selector 暫時失效時整份 code state 仍會消失；
- editor 暫時清空時仍無法 mirror；
- source acquisition 與 execution policy 仍耦合；
- 未解決產品模型本身的錯誤抽象。

## Option B — Side Panel 自己直接讀 Monaco

不採用。

原因：

- Monaco 位於 LeetCode page MAIN world；
- 會破壞目前 page bridge / content isolation 邊界；
- active-tab ownership 會和 page extraction responsibility 混在 Side Panel；
- duplicate extraction logic 增加維護成本。

## Option C — Partial page state + runnable projection

採用。

原因：

- code sync 與 testcase readiness 可獨立演進；
- 不需要改 tracing engine；
- 不需要改 Pyodide worker architecture；
- 能直接重用現有 scheduler；
- 對 active-tab ownership 的 source-of-truth model 相容；
- 未來若 testcase acquisition 改成更穩定的方法，不影響 editor state contract。

---

# 8. Page-State Contract

新增明確的 source-layer contract：

```ts
export interface LeetCodePageState {
  code: string | null;
  language: string | null;
  testcase: string | null;
  metadata: ProblemMetadata;
}
```

語意：

### `code`

- `null`：目前尚無法取得 editor model；
- `""`：editor 已存在，而且目前真的為空；
- non-empty string：目前 Monaco / editor 中的實際 code。

`""` 與 `null` 必須區分。

使用者 Ctrl+A 後刪除所有 code 時，Side Panel 必須 mirror 為空，而不能保留上一份 code 假裝沒有變化。

### `language`

- `null`：目前尚無法可靠判斷；
- string：normalized language id，例如 `python`。

### `testcase`

- `null`：目前 testcase 尚不可從 page state 可靠取得；
- `""`：testcase input 存在，但目前真的為空；
- non-empty string：目前 testcase raw text。

### `metadata`

metadata 可繼續使用：

```ts
interface ProblemMetadata {
  slug: string | null;
  title: string | null;
}
```

metadata 不決定 editor synchronization readiness。

---

# 9. Runnable Projection

保留 complete execution input 的概念，但它不再是 page bridge 的唯一可發布 state。

可保留現有 `LeetCodeSnapshot` 作為 runnable/source-complete contract：

```ts
export interface LeetCodeSnapshot {
  code: string;
  language: string;
  testcase: string;
  metadata: ProblemMetadata;
}
```

並新增純函式 projection：

```ts
function toRunnableSnapshot(
  state: LeetCodePageState
): LeetCodeSnapshot | null;
```

最低條件：

```text
state.code !== null
AND state.code.length > 0
AND state.language !== null
AND state.testcase !== null
```

注意：

`toRunnableSnapshot()` 不負責判斷完整 Python syntax 是否有效，也不負責 testcase 是否能轉成合法 method arguments。

這些仍交由既有 execution request / scheduler path 判斷。

因此 readiness 分兩階段：

```text
source complete enough
    ↓
toRunnableSnapshot
    ↓
execution request validation
```

---

# 10. MAIN-World Extraction Semantics

`extractPageState()` 不再因 testcase 缺失就回傳 `null`。

目前概念：

```ts
if (!code || !language || testcase === null) {
  return null;
}
```

改為：

```text
read whatever is currently available
        ↓
construct LeetCodePageState
        ↓
validate bounded field shapes
        ↓
publish state
```

只有完全無法建立可信 page-state envelope 時才不 publish，例如 document lifecycle 尚未到能安全取得 metadata / page identity 的極早期瞬間。

即使：

```text
code = latest Monaco text
testcase = null
```

仍必須 publish。

即使：

```text
code = ""
testcase = previous/current testcase
```

也必須 publish，因為空 editor 是有效 editor state。

---

# 11. Typing-Time Synchronization

保留現有 changed-only polling：

```text
300 ms poll
    ↓
extractPageState
    ↓
serialize state key
    ↓
changed?
   ├─ no  → no message
   └─ yes → page_state_updated
```

當使用者輸入：

```text
class Solution:
```

變成：

```text
class Solution:
    def twoSum(
```

即使第二個狀態 syntax incomplete，也要 publish 最新 code。

Side Panel source mirror latency 的 MVP 目標是：

```text
approximately one page polling interval + message delivery
```

不要求每個 keystroke 都立即觸發 Python execution。

---

# 12. Message Protocol

因 payload 不再保證 complete runnable snapshot，message naming 應反映實際語意。

建議 MAIN-world protocol：

```ts
request_page_state
response_page_state
page_state_updated
```

建議 content/runtime protocol：

```ts
request_leetcode_page_state
leetcode_page_state_updated
```

Payload：

```ts
{
  type: "leetcode_page_state_updated";
  state: LeetCodePageState;
}
```

不建議繼續把 partial payload 命名為 `snapshot`，否則後續很容易再次將 source state 誤認為 runnable input。

目前 protocol 沒有外部 public consumer，因此可以直接 migration，不需要維持兩套長期 compatibility aliases。

---

# 13. Validation Policy

Page script 傳入 extension 的資料仍視為 untrusted。

新增：

```ts
validatePageState(value: unknown): value is LeetCodePageState
```

規則至少包含：

- `code` 必須是 `null` 或 bounded string；
- `language` 必須是 `null` 或 bounded string；
- `testcase` 必須是 `null` 或 bounded string；
- metadata object shape 必須有效；
- 保留目前 code / testcase / language size caps；
- 空字串對 `code` / `testcase` 是合法值；
- `null` 與空字串不可 normalization 成同一語意。

`validateSnapshot()` 可繼續只驗證 complete runnable snapshot。

---

# 14. Content Adapter Boundary

Content script / adapter 的責任變成：

```text
MAIN-world LeetCodePageState
        ↓
validatePageState
        ↓
forward bounded partial state
```

若 MAIN-world bridge 暫時 unavailable，可保留 isolated-world fallback。

Fallback 同樣應回傳 partial `LeetCodePageState`，不能因 testcase 缺失而把已取得的 code 丟掉。

因此 isolated extraction 也應從：

```text
extractIsolatedSnapshot
```

演進為 source-state-oriented extraction，例如：

```text
extractIsolatedPageState
```

---

# 15. Active Tab Ownership Integration

Active-tab ownership semantics 不改。

仍然只有：

```text
sender.tab.id === activeLeetCodeTabId
```

的 page state 才能更新 Side Panel。

Canonical exact-tab fetch 也改為 request exact-tab **page state**，而不是要求 exact-tab 必須立即提供 runnable snapshot。

概念：

```text
activate Two Sum
    ↓
ownership epoch++
    ↓
request Two Sum page state
    ↓
{ code: latest, testcase: null, ... }
    ↓
accept current code immediately
    ↓
wait for later testcase readiness
```

Tab ownership change 時：

1. clear current source ownership；
2. invalidate scheduler；
3. 不得把舊 tab testcase 套到新 tab code；
4. preserve previous visualization until a new runnable session replaces it；
5. fetch exact new active tab page state。

---

# 16. Side Panel State Model

Side Panel 不再只保存：

```ts
currentSnapshot: LeetCodeSnapshot | null
```

改成至少區分：

```ts
currentPageState: LeetCodePageState | null
```

以及由它投影出的 runnable input。

高階 flow：

```text
onPageState(state)
    ↓
apply source mirror immediately
    ↓
apply testcase UI if available
    ↓
refresh case selector if testcase available
    ↓
toRunnableSnapshot(state)
    ├─ null
    │    ↓
    │  do not schedule
    │  keep last visualization
    │
    └─ complete
         ↓
       scheduler.schedule(...)
```

最重要的 ordering：

> **先更新 source mirror，再判斷能不能 execute。**

不得因 `toRunnableSnapshot()` 返回 `null` 而跳過 source UI 更新。

---

# 17. Testcase UI Semantics

當 `testcase === null`：

- code mirror 繼續更新；
- 不 schedule 新 execution；
- testcase input 顯示 waiting / unavailable state；
- case selector disabled；
- 不使用其他 problem / previous ownership 的 testcase；
- 不清除上一份 TraceVisualizer。

當 testcase 從 `null` 變成 string：

```text
latest code already mirrored
    ↓
raw testcase becomes available
    ↓
refresh case selector
    ↓
project latest page state
    ↓
schedule latest runnable input
```

不要求使用者再修改一次 code 才觸發 execution。

也不要求使用者按 `Run now`。

---

# 18. Pre-Run Testcase Acquisition Policy

本 feature 的目標不是依賴 LeetCode Run / Submit 才取得 testcase。

`readTestcase()` 應明確定位為讀取：

```text
current editable testcase state
```

而不是：

```text
latest execution/submission result
```

初始實作仍優先使用目前已存在的 LeetCode testcase DOM / CodeMirror accessors；若 testcase editor 在正常 problem page lifecycle 中已存在，就應在 Run 前被取得。

但此 spec 不要求使用不穩定、未驗證的 LeetCode private internal store，也不要求從題目 examples 猜 testcase。

因此 MVP contract 是：

```text
code sync: mandatory before Run
pre-run testcase acquisition: use available canonical testcase editor state
execution: automatic whenever that testcase becomes available
```

若 LeetCode 某個頁面 layout 確實完全不 expose testcase editor state，插件應顯示 waiting state，而不是阻止 code mirror 或偽造 testcase。

未來若需要新增更可靠的 testcase provider，只需替換 source-layer acquisition，不應修改 Side Panel / scheduler execution contract。

---

# 19. Execution Scheduling Semantics

現有 `LiveExecutionScheduler` 的核心 policy 保留：

- debounce；
- duplicate input suppression；
- latest-wins；
- single-flight；
- last-runnable session preservation；
- Python-only execution；
- invalid testcase / invalid request → editing rather than destroying old visualization。

差異只在 scheduler 不再是 source mirroring 的 gatekeeper。

例如：

```text
user types valid Python R10
    ↓
execution starts

user continues typing incomplete Python R11
    ↓
Side Panel code mirror = R11
    ↓
R11 is not runnable
    ↓
visualization remains R10
```

UI 必須允許：

```text
visible code revision > visualization runnable revision
```

這不是 stale bug，而是 intentional last-runnable semantics。

---

# 20. Status Semantics

不要把所有 state 壓進單一 `LiveStatus`。

至少概念上區分：

```text
Ownership State
Source Readiness
Execution Status
```

例如：

```text
ownership = leetcode
source = editor_ready / waiting_for_testcase
execution = editing / updating / synced / runtime_error / timeout
```

UI 可以保持簡潔，但內部不能重新耦合。

建議可見狀態：

```text
Live: syncing
Live: code synced · waiting for testcase
Live: editing
Live: updating
Live: synced
Live: runtime_error
Live: timeout
Live: paused · No active LeetCode tab
```

當 code 已同步但 testcase 尚未取得時，應明確顯示：

```text
Live: code synced · waiting for testcase
```

避免使用者誤以為 extension 沒有追蹤 editor。

---

# 21. `Run now` Semantics

`Run now` 保留。

按下時：

1. 向 current exact active tab refresh latest `LeetCodePageState`；
2. 立即更新 code mirror；
3. 若 latest state 可投影成 runnable input，force immediate schedule；
4. 若 testcase 仍 unavailable，不得使用 stale testcase 強制執行；
5. 顯示相對應 readiness status。

因此 `Run now` 是：

```text
refresh + immediate retry
```

不是：

```text
activate plugin
```

---

# 22. Error Handling

## Monaco/editor temporarily unavailable

若 `code === null`：

- 不清除目前 visualization；
- 不執行；
- source state 顯示 syncing / waiting for editor；
- subsequent polling 自動恢復。

## Testcase temporarily unavailable

若 `testcase === null`：

- code mirror 繼續更新；
- 不執行；
- 不沿用其他 ownership 的 testcase；
- subsequent state 自動恢復。

## Syntax-incomplete draft

若 code 已 mirror，但 execution request 無法建立：

- scheduler / readiness 顯示 editing；
- 保留 last runnable visualization；
- 使用者繼續輸入後自動再嘗試。

## Old async execution completes later

沿用 scheduler revision semantics：

- stale session 不 render；
- latest runnable revision wins。

## Ownership changes during page-state fetch

沿用 active-tab epoch / fetch sequence suppression：

- stale owner state 不 emit；
- stale owner error 不覆蓋新 owner UI。

---

# 23. Security Boundary

這次 contract 變成 partial state，不改既有 trust model。

仍然必須：

- 驗證所有 MAIN-world `postMessage` payload；
- 驗證 message source / type / request id；
- 驗證 origin；
- 驗證 bounded string size；
- runtime message 只接受 current active LeetCode tab sender；
- page-provided state 不得用於 privileged extension operations；
- Pyodide Worker isolation 不視為 hardened malicious-code sandbox。

---

# 24. Files Expected to Change

預期 implementation 至少涉及：

```text
src/content/leetcode-adapter.ts
src/content/content-script.ts
src/page-bridge/leetcode-main-world.ts
src/sidepanel/active-tab-source.ts
src/sidepanel/bootstrap.ts
```

可能新增 source/readiness helper，例如：

```text
src/content/leetcode-page-state.ts
```

或：

```text
src/execution/execution-readiness.ts
```

但不要求為了檔案數量而拆檔；實作時以 responsibility boundary 為準。

預期 tests 至少涉及：

```text
tests/execution/leetcode-adapter.test.ts
tests/execution/content-script.test.ts
tests/execution/live-execution-scheduler.test.ts
tests/sidepanel/active-tab-source.test.ts
tests/sidepanel/bootstrap.test.ts
```

---

# 25. Required Test Matrix

## Page extraction

1. code + language + testcase → complete page state；
2. code + language + no testcase → valid partial page state；
3. empty editor string → valid page state with `code === ""`；
4. no editor yet → `code === null` rather than stale previous code；
5. Monaco code changes while testcase absent → new page state is published；
6. testcase appears later without another code change → new page state is published。

## Content bridge

7. partial page state passes validation；
8. malformed / oversized partial state is rejected；
9. request/response bridge can return partial state。

## Active tab ownership

10. active tab code-only state is accepted；
11. background tab code-only state is ignored；
12. old owner partial state arriving late is ignored；
13. new owner cannot inherit previous owner testcase。

## Side Panel

14. code textarea updates when testcase is `null`；
15. repeated typing updates code mirror before any execution occurs；
16. testcase-null state does not schedule execution；
17. testcase later becomes available and schedules latest code automatically；
18. invalid/incomplete latest draft remains visible while previous visualization remains；
19. empty editor clears source mirror but preserves last visualization；
20. `Run now` with no testcase refreshes state but does not execute stale input。

## Regression

21. current multi-case testcase selection still works；
22. Python runnable draft still auto-executes after debounce；
23. latest-wins scheduler behavior remains intact；
24. active-tab switch / same-tab navigation semantics remain intact；
25. runtime error / timeout trace-prefix visualization remains intact。

---

# 26. Acceptance Criteria

本 feature 完成時，以下情境必須成立。

## Primary acceptance

在一個剛開啟的 LeetCode problem page 中，**使用者完全沒有按過 Run 或 Submit**：

1. Side Panel 已開啟；
2. 使用者在 Monaco editor 修改 Python code；
3. Side Panel source textarea 在短時間內顯示相同最新 code；
4. 此同步不得因 testcase 尚未取得而停止；
5. 若目前 testcase 已可取得，latest runnable draft 自動觸發 visualization；
6. 若 testcase 尚不可取得，UI 明確顯示 waiting state，而不是假裝沒有 code；
7. testcase 之後變為可取得時，不需要再次修改 code，也會使用 latest code 自動啟動 execution。

## Editing acceptance

當使用者從 valid code 打到暫時 invalid code：

```text
latest editor code → always visible
last runnable visualization → preserved
```

當 code 再次可執行：

```text
latest runnable revision → automatically replaces visualization
```

## Ownership acceptance

切到另一個 LeetCode tab 後：

```text
new active tab latest code → mirror
old tab code/testcase → cannot update or execute
```

---

# 27. Product Outcome

完成本 feature 後，LeetYourBrain2Code 的 interaction model 從：

```text
write
→ LeetCode Run / Submit
→ plugin receives runnable snapshot
→ visualize
```

變成：

```text
write
↕
live code mirror
↕
execution readiness
↕
latest-runnable visualization
```

這是後續新增 Linked List、Tree、Graph、DP 等 visualization feature 之前應先完成的 integration foundation。

新增 visualizer 只應改變：

```text
Trace / Runtime State
        ↓
Visual Interpretation
        ↓
Renderer
```

不應再需要處理「使用者是否先按過 LeetCode Run」這類 source lifecycle 問題。

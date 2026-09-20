# LeetCode Python Execution Visualizer

[English](README.md) | 繁體中文

> **一款原生整合於 LeetCode 的 Python 視覺化除錯器，讓你看見程式碼實際做了什麼——即使它執行失敗，或永遠跑不完。**

一款透過 Chrome Side Panel 顯示於 LeetCode 頁面旁的 Manifest V3 擴充功能。它會重新執行編輯器中目前的 Python 程式碼與 testcase，再將 execution trace 轉換為可逐步檢視的 runtime-state visualization。

## 為什麼需要它

這個專案處理的是一個常見落差：你已經理解演算法，實際寫出的程式卻沒有依照腦中的模型運作。與其只看著 Wrong Answer、Runtime Error 或卡住的執行結果猜問題，你可以直接檢查程式真正走過的步驟，找出 implementation 與 mental model 從哪裡開始分岔。

它是視覺化除錯器，不是 LeetCode solver，也不取代 LeetCode judge。

## 運作方式

```text
目前的 Python 程式碼 + 目前選中的 testcase case
                    ↓
Live scheduler（debounce + latest-wins）
                    ↓
Warm bundled Pyodide Web Worker
                    ↓
依序保存的 line-level execution trace
                    ↓
RuntimeState + FrameDiff/ObjectDiff
                    ↓
RuntimeMutation + BehavioralPattern
                    ↓
Expression Evidence
                    ↓
Decision Evidence
                    ↓
Visual interpretation + Behavioral Evidence Navigation
                    ↓
Repeated-transition Trace Folding
                    ↓
Trace Outline + Behavioral Timeline + Chrome Side Panel 視覺化
```

Side Panel 會在你輸入時持續同步目前 active LeetCode editor 的程式碼；
不需要先按 LeetCode Run 或 Submit 才開始取得 source code。
若目前 testcase 已可取得，最新可執行的 Python draft 會在 debounce 後自動重新執行；
若 testcase 尚不可取得，code 仍持續同步，execution 進入等待狀態並保留上一份可執行 visualization。

Side Panel 只會跟隨目前 Chrome window 中的 active LeetCode tab。即使另一個 LeetCode tab 已經開著且 editor 內容沒有再次變動，只要切換過去，Side Panel 就會向該 exact tab 重新取得 page state；background LeetCode tab 的 page-state update 會被忽略。

當 active tab 不是 LeetCode 時，Live Visualization 會顯示 `Live: paused · No active LeetCode tab`，但保留上一份 trace visualization。切回 LeetCode 後會自動從新的 active tab 恢復同步。

MVP 的目標是呈現：

- 目前執行到的 source line；
- function call、return、exception 與 call stack；
- locals、scalar changes 與 container mutations；
- stdout 與 return value；
- 對支援的 assignment／return expression 提供 captured Expression Evidence，
  包含 operand、intermediate、result value；若 runtime evidence 能安全證明，
  也會呈現 factual `min`／`max` candidate selection，以及 List／Matrix 上的
  operand、selected candidate 與 assignment target overlay；
- 對支援的 `if`、`elif`、`while` 提供 captured Decision Evidence，包含巢狀
  `and`／`or`／`not`、factual short-circuit 狀態、branch-chain 結果、重複
  `while` history，以及 List／Matrix condition operand highlighting；
- 帶有 index／pointer bindings 的 list state；
- 完整矩形 2D `list`／`tuple` scalar state 的專用 Matrix / Grid 視覺化，包含直接 `matrix[i][j]` focus、負索引正規化、越界 requested-cell evidence、由 runtime mutation evidence 推導的實際 cell 變更、受邊界限制且會跟隨 focus 的 viewport，以及可持續的 cell inspection；
- 對具有 `next` topology 的 Python runtime object 提供專用 linked-list 視覺化，包含 pointer labels、edge mutation、disconnected fragments 與 cycle-safe display；
- 標準 LeetCode `TreeNode` 的專用二元樹視覺化，包含 active pointer、`left` / `right` 邊變更、斷開 component，以及 cycle / shared-child 的 deterministic fallback 呈現；
- 標準 LeetCode `Node(val, neighbors)` 的專用 graph 視覺化，包含直接 adjacency-list testcase 執行、directed 與 reciprocal runtime reference、多個 component、isolated node、edge add/remove 狀態，以及 node／connection inspection；
- 標準 LeetCode level-order binary-tree testcase literal（包含 `null` child marker）會在 trace 前轉換成 `TreeNode` 物件；
- 基於事實的 behavioral signals：重複可觀察狀態、同一 execution anchor 沒有可觀察進展，以及重複 execution / mutation motif，並可直接在 first／previous／next／last evidence 之間導航；
- behavioral trace timeline，支援 raw trace scrub 與 compact evidence-span bands，同時保留原本的 Previous／Next／Play raw navigation；
- 對符合完整、連續 evidence 條件的 `RepeatedTransitionPattern` 提供 folded Trace Outline，可先看摘要，再展開成 motif repetition ranges；
- Behavioral Timeline 支援 collision-safe subtracks，同 kind 的重疊 evidence bands 不再互相遮蓋；
- 即使有 folded presentation，原本的 raw Previous／Next／Play 仍維持 authoritative raw-step navigation；
- Runtime Error、trace limit 或 hard timeout 發生前已取得的 trace prefix；
- Failure-First entry point：針對本機的 `exception`、`trace_limit` 或 `timeout` capture，以 deterministic 方式呈現一個靠近 termination、且 evidence 已完整驗證的 behavioral evidence location，作為可選的 `Start Here` 檢視起點；不會自動移動 raw cursor，也不是診斷。
- **Call Tree／recursion execution story：** 視覺化具體的 user-function invocation、arguments、parent／child call structure、recursion depth、return、exception 與不完整的 timeout／trace prefix，並與 raw trace cursor 保持同步。
- **Pinned baseline behavioral diff：** 固定一份已捕獲的 execution run，將同一 testcase 的後續執行與它比較，呈現 calls、decisions、control flow、stable mutations、expressions 或 frame outcomes 中，最早且安全對齊的差異。

Python 不會在 Side Panel 的 main thread 中執行。Pyodide 會隨擴充功能一起 bundle，並在本機 Web Worker 中運作；MVP 不需要 backend。

## Graph 支援 v0.1

已支援：

- 標準 LeetCode `Node(val, neighbors)`；
- 直接以 adjacency-list testcase 執行；
- directed 與 reciprocal runtime reference；
- 多個 component 與 isolated node；
- edge add/remove 視覺化；
- node 與 connection inspection。

尚未支援：

- generic dict/list adjacency inference；
- weighted graph；
- custom graph class；
- BFS/DFS/shortest-path semantic interpretation。

## Matrix / Grid 支援 v0.1

已支援：

- 完整、矩形的 2D `list`／`tuple` snapshot，cell 僅接受 `int`、`float`、`bool`、`str` 或 `None`；
- 對 variable 與 integer-literal operand 的直接 `matrix[row][column]` focus；
- Python 負索引正規化，以及明確呈現越界 requested-cell evidence；
- 由 runtime mutation evidence 推導的實際 cell 變更；
- 受邊界限制且會跟隨 focus 的 viewport，以及可持續的 cell inspection；
- 對已捕獲的 List／Matrix operand、selected `min`／`max` candidate 與
  assignment target 提供 Expression Evidence overlay。
- 對已捕獲的 List／Matrix condition operand 提供獨立於 Expression Evidence
  樣式的 Decision Evidence overlay。

尚未支援：

- ragged、3D、sparse 或 NumPy matrix 視覺化；
- 同一 runtime matrix 透過其他名稱存取時的 alias recovery；
- 對 `i + 1`、`j - 1` 或其他任意 index expression 的 focus 推導；
- DP recurrence 或演算法意圖推導，也不進行 expected-vs-actual correctness diagnosis。

## 重要邊界

- `completed` 只代表本機執行正常返回，**不代表** LeetCode Accepted。
- `timeout` 只代表本機視覺化 runtime 超過 wall-clock limit，**不等於** LeetCode TLE。
- Failure-First v0.1 只評估 `exception`、`trace_limit`、`timeout`；`Inspect` 必須由使用者觸發，推薦結果只是對 validated captured evidence 的檢視優先順序，不宣稱原因、正確性或 LeetCode TLE。
- Behavioral Signals 只描述 captured trace 中的 runtime evidence，不會自行診斷 infinite loop、correctness failure、bug 或修正方式。
- Expression Evidence 只描述 captured execution computation，不會推導正確的
  recurrence、演算法意圖、root cause 或修正方式；只有在 runtime evidence 能
  安全證明時，才會呈現 `min`／`max` candidate selection。
- Decision Evidence 只描述支援的 condition 如何被評估，以及 Python 實際選擇
  的 branch；不會判斷該 branch 是否正確。
- Decision Tracing v0.1 尚不拆解 chained comparison、不推導 `for` loop semantics、
  不解釋 `break`／`continue` causality、不比較 expected path，也不自動修正 bug。
- Trace folding 只是 captured raw steps 上的 deterministic presentation projection，不會刪除 raw events，也不會診斷 execution failure 的原因。
- Pyodide 無法完整重現 LeetCode judge environment。
- Testcase synchronization 會讀取 LeetCode 畫面上可見的 testcase controls；如果 testcase editor 尚未 mount，Side Panel 仍會同步 code，並等待 testcase 出現。
- 專用 TreeNode 視覺化目前只支援標準 LeetCode binary-tree 結構；generic dict/list adjacency inference、weighted graph、custom graph class、BFS/DFS/shortest-path semantic interpretation、自訂／N-ary tree inference 與演算法特定的 DP recurrence inference 仍不在目前範圍內。
- Web Worker 與 Pyodide 的隔離不應被視為可執行惡意程式碼的 hardened sandbox。

## 隱私與本機處理

擴充功能會讀取目前 active LeetCode 頁面的 Python editor、可見 testcase 與 problem metadata，來建立 visualization。Pyodide 會隨擴充功能 bundle，並在本機 Web Worker 中執行。程式碼、testcase、trace 與 comparison state 不會送到 backend；v0.1 也不會刻意保存 user-code history。請參考[隱私政策](PRIVACY.md)與 [Chrome Web Store 隱私草稿](docs/store/privacy-dashboard.md)。

## 支援

可使用[錯誤回報表單](.github/ISSUE_TEMPLATE/bug_report.yml)回報可重現的
visualizer 問題，使用[整合問題表單](.github/ISSUE_TEMPLATE/integration_issue.yml)
回報 LeetCode page 或 tab state 問題，或使用[功能請求表單](.github/ISSUE_TEMPLATE/feature_request.yml)
提出範圍明確的改善建議。[商店支援草稿](docs/store/support.md)說明應提供的
資訊。將程式碼或 testcase 貼到公開 issue 前，請先移除任何不想公開的內容。

## 開發

目前狀態：正在準備 v0.1.0 release candidate。

Release freeze：v0.1.0 前不新增主要視覺化／除錯能力；只允許修復 release blocker、正確性問題、整合問題與 release hardening。

需要 Node.js 與 npm。

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Build 完成後，前往 `chrome://extensions`，以「載入未封裝項目」載入 `dist/`。

## 專案文件

- [MVP Design Spec v0.2](docs/superpowers/specs/2026-09-05-leetcode-python-execution-visualizer-design.md)
- [Implementation Plan 1](docs/superpowers/plans/2026-09-05-leetcode-python-execution-visualizer-implementation-plan-1.md)
- [Live Visualization Design Spec](docs/superpowers/specs/2026-09-06-live-visualization-design.md)
- [Live Visualization Implementation Plan](docs/superpowers/plans/2026-09-06-live-visualization-implementation-plan.md)
- [Active Tab Ownership Design Spec](docs/superpowers/specs/2026-09-06-active-tab-ownership-design.md)
- [Active Tab Ownership Implementation Plan](docs/superpowers/plans/2026-09-06-active-tab-ownership-implementation-plan.md)
- [Linked List Visualization Design Spec](docs/superpowers/specs/2026-09-07-visualization-coverage-linked-list-design.md)
- [Linked List Visualization Implementation Plan](docs/superpowers/plans/2026-09-07-linked-list-visualization-implementation-plan.md)
- [Tree Visualization Design Spec](docs/superpowers/specs/2026-09-11-tree-visualization-design.md)
- [Tree Visualization Implementation Plan](docs/superpowers/plans/2026-09-11-tree-visualization-implementation-plan.md)
- [Runtime Mutation Semantics Design Spec](docs/superpowers/specs/2026-09-08-runtime-mutation-semantics-design.md)
- [Runtime Mutation Semantics Implementation Plan](docs/superpowers/plans/2026-09-08-runtime-mutation-semantics-implementation-plan.md)
- [Behavioral Debugging Foundation Design Spec](docs/superpowers/specs/2026-09-08-behavioral-debugging-foundation-design.md)
- [Behavioral Debugging Foundation Implementation Plan](docs/superpowers/plans/2026-09-08-behavioral-debugging-foundation-implementation-plan.md)
- [Behavioral Trace Navigation Design Spec](docs/superpowers/specs/2026-09-08-behavioral-trace-navigation-design.md)
- [Behavioral Trace Navigation Implementation Plan](docs/superpowers/plans/2026-09-08-behavioral-trace-navigation-implementation-plan.md)
- [Behavioral Trace Folding Design Spec](docs/superpowers/specs/2026-09-09-behavioral-trace-folding-design.md)
- [Behavioral Trace Folding Implementation Plan](docs/superpowers/plans/2026-09-09-behavioral-trace-folding-implementation-plan.md)

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
Visual interpretation + Behavioral Evidence Navigation
                    ↓
Behavioral Timeline + Chrome Side Panel 視覺化
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
- 帶有 index／pointer bindings 的 list state；
- 對具有 `next` topology 的 Python runtime object 提供專用 linked-list 視覺化，包含 pointer labels、edge mutation、disconnected fragments 與 cycle-safe display；
- 基於事實的 behavioral signals：重複可觀察狀態、同一 execution anchor 沒有可觀察進展，以及重複 execution / mutation motif，並可直接在 first／previous／next／last evidence 之間導航；
- behavioral trace timeline，支援 raw trace scrub 與 compact evidence-span bands，同時保留原本的 Previous／Next／Play raw navigation；
- Runtime Error、trace limit 或 hard timeout 發生前已取得的 trace prefix。

Python 不會在 Side Panel 的 main thread 中執行。Pyodide 會隨擴充功能一起 bundle，並在本機 Web Worker 中運作；MVP 不需要 backend。

## 重要邊界

- `completed` 只代表本機執行正常返回，**不代表** LeetCode Accepted。
- `timeout` 只代表本機視覺化 runtime 超過 wall-clock limit，**不等於** LeetCode TLE。
- Behavioral Signals 只描述 captured trace 中的 runtime evidence，不會自行診斷 infinite loop、correctness failure、bug 或修正方式。
- Pyodide 無法完整重現 LeetCode judge environment。
- 目前已支援具有 `next` topology 的 Python runtime object 的 linked-list 專用 visualizer，包含 pointer labels、edge mutation、disconnected fragments 與 cycle-safe display；tree、node-edge graph 和 DP table 的專用 visualizer 仍不在目前範圍內。
- Web Worker 與 Pyodide 的隔離不應被視為可執行惡意程式碼的 hardened sandbox。

## 開發

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
- [Runtime Mutation Semantics Design Spec](docs/superpowers/specs/2026-09-08-runtime-mutation-semantics-design.md)
- [Runtime Mutation Semantics Implementation Plan](docs/superpowers/plans/2026-09-08-runtime-mutation-semantics-implementation-plan.md)
- [Behavioral Debugging Foundation Design Spec](docs/superpowers/specs/2026-09-08-behavioral-debugging-foundation-design.md)
- [Behavioral Debugging Foundation Implementation Plan](docs/superpowers/plans/2026-09-08-behavioral-debugging-foundation-implementation-plan.md)
- [Behavioral Trace Navigation Design Spec](docs/superpowers/specs/2026-09-08-behavioral-trace-navigation-design.md)
- [Behavioral Trace Navigation Implementation Plan](docs/superpowers/plans/2026-09-08-behavioral-trace-navigation-implementation-plan.md)

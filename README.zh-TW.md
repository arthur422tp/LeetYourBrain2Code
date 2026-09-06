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
Runtime state + state diff
                    ↓
Chrome Side Panel 視覺化
```

Live Visualization 會追蹤目前最新可執行的 Python draft。當 LeetCode 的程式碼、testcase 或目前選中的 testcase case 改變時，Side Panel 會在短暫 debounce 後自動重新執行。若使用者正輸入暫時不完整的程式碼，畫面會保留上一份可執行版本的 visualization，直到新版再次可執行；`Run now` 則保留作為立即重試入口。

MVP 的目標是呈現：

- 目前執行到的 source line；
- function call、return、exception 與 call stack；
- locals、scalar changes 與 container mutations；
- stdout 與 return value；
- 帶有 index／pointer bindings 的 list state；
- Runtime Error、trace limit 或 hard timeout 發生前已取得的 trace prefix。

Python 不會在 Side Panel 的 main thread 中執行。Pyodide 會隨擴充功能一起 bundle，並在本機 Web Worker 中運作；MVP 不需要 backend。

## 重要邊界

- `completed` 只代表本機執行正常返回，**不代表** LeetCode Accepted。
- `timeout` 只代表本機視覺化 runtime 超過 wall-clock limit，**不等於** LeetCode TLE。
- Pyodide 無法完整重現 LeetCode judge environment。
- MVP 聚焦於 Python primitive 與 container。Linked list、tree、node-edge graph 和 DP table 的專用 visualizer 不在 v0.1 範圍內。
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

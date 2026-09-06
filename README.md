# LeetCode Python Execution Visualizer

English | [繁體中文](README.zh-TW.md)

> **A LeetCode-native Python visual debugger that shows what your code actually does—even when it fails or never finishes.**

A Chrome Manifest V3 extension that runs beside LeetCode in the Side Panel. It re-executes the Python code and testcase currently in the editor, then turns the resulting execution trace into runtime-state visualization.

## Why it exists

This project is built for the moment when you understand an algorithm but your implementation does not behave the way your mental model says it should. Instead of guessing from a wrong answer, runtime error, or stalled run, you can inspect what the code actually did and find where the two began to diverge.

It is a visual debugger—not a LeetCode solver and not a replacement for the LeetCode judge.

## How it works

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

The Side Panel mirrors the active LeetCode editor while you type; pressing
LeetCode Run or Submit is not required to start source synchronization.
If the current testcase is already available, the latest runnable Python draft
is re-executed automatically after the live debounce. If testcase state is not
yet available, code continues to sync and execution waits without clearing the
last runnable visualization.

The Side Panel follows the active LeetCode tab in its current Chrome window. Switching between already-open LeetCode problems triggers an exact-tab page-state refresh even when the editor content did not change. Page-state updates from background LeetCode tabs are ignored.

When the active tab is not LeetCode, Live Visualization pauses without clearing the last trace. Returning to LeetCode resumes from the newly active tab automatically.

The MVP is designed to expose:

- the active source line;
- function calls, returns, exceptions, and the call stack;
- locals, scalar changes, and container mutations;
- stdout and return values;
- list state with index/pointer bindings;
- the trace prefix captured before a runtime error, trace limit, or hard timeout.

Python execution stays off the Side Panel's main thread. Pyodide is bundled with the extension and runs locally in a Web Worker; the MVP does not require a backend.

## Important boundaries

- `completed` means local execution returned normally. It does **not** mean LeetCode Accepted.
- `timeout` means the local visualization runtime exceeded its wall-clock limit. It does **not** mean LeetCode TLE.
- Pyodide does not perfectly reproduce LeetCode's judge environment.
- The MVP focuses on Python primitives and containers. Dedicated visualizers for linked lists, trees, node-edge graphs, and DP tables are outside the v0.1 scope.
- Web Worker and Pyodide isolation should not be treated as a hardened sandbox for hostile code.

## Development

Requirements: Node.js and npm.

```bash
npm ci
npm test
npm run typecheck
npm run build
```

After building, load `dist/` as an unpacked extension from `chrome://extensions`.

## Project documents

- [MVP Design Spec v0.2](docs/superpowers/specs/2026-09-05-leetcode-python-execution-visualizer-design.md)
- [Implementation Plan 1](docs/superpowers/plans/2026-09-05-leetcode-python-execution-visualizer-implementation-plan-1.md)
- [Live Visualization Design Spec](docs/superpowers/specs/2026-09-06-live-visualization-design.md)
- [Live Visualization Implementation Plan](docs/superpowers/plans/2026-09-06-live-visualization-implementation-plan.md)
- [Active Tab Ownership Design Spec](docs/superpowers/specs/2026-09-06-active-tab-ownership-design.md)
- [Active Tab Ownership Implementation Plan](docs/superpowers/plans/2026-09-06-active-tab-ownership-implementation-plan.md)

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
RuntimeState + FrameDiff/ObjectDiff
                ↓
RuntimeMutation + BehavioralPattern
                ↓
Visual interpretation + Behavioral Evidence Navigation
                ↓
Repeated-transition Trace Folding
                ↓
Trace Outline + Behavioral Timeline + Chrome Side Panel visualization
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
- dedicated linked-list visualization for Python objects with `next` topology, including pointer labels, edge mutation, disconnected fragments, and cycle-safe display;
- dedicated binary-tree visualization for standard LeetCode `TreeNode` objects, including active pointers, `left` / `right` edge mutation, detached components, and deterministic cycle/shared-child fallback presentation;
- dedicated graph visualization for standard LeetCode `Node(val, neighbors)` objects, including direct adjacency-list testcase execution, directed and reciprocal runtime references, multiple components, isolated nodes, edge add/remove states, and node/connection inspection;
- standard LeetCode level-order binary-tree testcase literals, including `null` child markers, are decoded into `TreeNode` objects before tracing;
- factual behavioral signals for repeated observable state, no observable progress at a repeated execution anchor, and repeated execution/mutation motifs, with direct first/previous/next/last evidence navigation;
- a behavioral trace timeline with raw scrubbing and compact evidence-span bands while preserving raw Previous/Next/Play navigation;
- a folded Trace Outline for eligible contiguous `RepeatedTransitionPattern` regions, with collapsed summaries and expandable motif-repetition ranges;
- collision-safe Behavioral Timeline subtracks so overlapping same-kind evidence bands remain independently visible;
- raw Previous / Next / Play navigation remains authoritative even when folded presentation is available;
- the trace prefix captured before a runtime error, trace limit, or hard timeout.
- a Failure-First Entry Point for local `exception`, `trace_limit`, or `timeout` captures: it deterministically surfaces one validated behavioral evidence location near termination as an optional `Start Here` inspection point. It does not move the raw cursor automatically, and `Start Here` is an inspection priority—not a diagnosis.

Python execution stays off the Side Panel's main thread. Pyodide is bundled with the extension and runs locally in a Web Worker; the MVP does not require a backend.

## Graph support v0.1

Supported:

- standard LeetCode `Node(val, neighbors)`;
- direct adjacency-list testcase execution;
- directed and reciprocal runtime references;
- multiple components and isolated nodes;
- edge add/remove visualization;
- node and connection inspection.

Not yet supported:

- generic dict/list adjacency inference;
- weighted graphs;
- custom graph classes;
- BFS/DFS/shortest-path semantic interpretation.

## Important boundaries

- `completed` means local execution returned normally. It does **not** mean LeetCode Accepted.
- `timeout` means the local visualization runtime exceeded its wall-clock limit. It does **not** mean LeetCode TLE.
- Failure-First v0.1 evaluates only `exception`, `trace_limit`, and `timeout`; `Inspect` is user-triggered and the recommendation does not claim a cause or correctness result.
- Behavioral Signals describe evidence in the captured trace. They do not diagnose an infinite loop, correctness failure, bug, or fix.
- Trace folding is a deterministic presentation projection over captured raw steps. It does not delete raw events or diagnose why execution failed.
- Pyodide does not perfectly reproduce LeetCode's judge environment.
- Testcase synchronization observes LeetCode's visible testcase controls; if the testcase editor has not mounted yet, the Side Panel keeps code synchronized and waits for the testcase.
- Dedicated TreeNode visualization supports the standard LeetCode binary-tree shape only. Generic dict/list adjacency inference, weighted graphs, custom graph classes, BFS/DFS/shortest-path semantic interpretation, custom/N-ary tree inference, and DP tables remain outside the current scope.
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

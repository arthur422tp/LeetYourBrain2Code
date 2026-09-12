# Tree Input Sync and Runtime Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a standard LeetCode binary-tree testcase observable by the extension and executable as a traced `TreeNode` graph.

**Architecture:** Keep page-state acquisition and execution readiness separate. Extend the shared DOM reader with narrowly scoped testcase fallbacks, then extend the existing entrypoint metadata and Python runner so a `TreeNode` parameter receives a level-order-built object graph. Reuse the existing object identity, topology collector, and Tree visualizer without adding a second tracing pipeline.

**Tech Stack:** TypeScript 5.8, Vitest 3, Python 3 fixtures, Pyodide runtime, Chrome Manifest V3.

**Spec:** `docs/superpowers/specs/2026-09-06-live-editor-state-pre-run-execution-design.md` and `docs/superpowers/specs/2026-09-11-tree-visualization-design.md`

## Global Constraints

- `testcase === null` means the testcase editor is unavailable; an observed empty editor remains `""`.
- Do not reuse a testcase from another tab or problem.
- Preserve existing List, Dict, Linked List, live-sync, and trace behavior.
- Tree input uses LeetCode level-order serialization with `null` child markers.
- Malformed tree input returns the existing typed `input_error` / `unsupported_testcase_format` result.
- Do not infer correctness or algorithm intent from tree topology.

### Task 1: Lock down testcase extraction and TreeNode entrypoint behavior

**Files:**
- Modify: `tests/execution/leetcode-adapter.test.ts`
- Modify: `tests/execution/execution-request.test.ts`
- Modify: `tests/fixtures/python/test_trace_engine.py`

**Interfaces:**
- Test the exported page extraction behavior using DOM fixtures that distinguish the code editor from testcase controls.
- Test `createExecutionRequest()` reports `binary_tree` for `TreeNode` annotations.
- Test `run_request()` executes a commented-template-style `Optional[TreeNode]` solution against a serialized tree and captures TreeNode objects.

- [x] **Step 1: Add the failing DOM regression test**

  Add a fixture containing a code editor plus a testcase panel with two generic text inputs, and assert extraction returns only the testcase values joined by newlines. Add a fixture with no testcase panel and assert `testcase` remains `null`.

- [x] **Step 2: Add the failing entrypoint regression test**

  Add a `Solution.isSymmetric(self, root: Optional[TreeNode])` source fixture and assert its resolved parameter kind is `binary_tree`.

- [x] **Step 3: Add the failing Python runtime regression test**

  Use a source string beginning with `from typing import Optional` and a `Solution` method annotated with `Optional[TreeNode]`; call it with `[1,2,2,3,4,4,3]`, assert `status == "completed"`, and assert the captured object snapshots include class `TreeNode` with `left` and `right` reference attributes.

- [x] **Step 4: Run only the new tests and verify they fail for missing behavior**

  Run:

  ```bash
  npm test -- tests/execution/leetcode-adapter.test.ts tests/execution/execution-request.test.ts
  python3 -m pytest tests/fixtures/python/test_trace_engine.py -q
  ```

  The DOM test must fail because the new structured fallback is absent, the request test must fail because `TreeNode` is classified as `value`, and the Python test must fail because the runtime does not define or construct `TreeNode`.

### Task 2: Implement the shared testcase reader fallback

**Files:**
- Modify: `src/content/leetcode-adapter.ts`
- Modify: `src/page-bridge/leetcode-main-world.ts`
- Modify: `tests/execution/leetcode-adapter.test.ts`

**Interfaces:**
- Keep `extractPageState()` and `extractIsolatedPageState()` unchanged at their public boundaries.
- Keep the existing raw `cursor-text` and CodeMirror paths first.
- Add a scoped structured-input fallback that excludes `textarea[aria-label="Code editor"]` and only reads controls inside the testcase panel.

- [x] **Step 1: Implement the minimal shared extraction helper**

  Export a helper from `leetcode-adapter.ts` that reads, in order, existing raw testcase fields, a non-code-editor CodeMirror content element, and structured testcase controls located under an element identified by testcase semantics (`data-testid`, `aria-label`, `aria-labelledby`, or a visible `Testcase` label). Return `null` when no testcase control exists and preserve empty strings when a control exists but is empty.

- [x] **Step 2: Use the same helper in the MAIN-world bridge**

  Remove the duplicate testcase-reading implementation from `leetcode-main-world.ts` and call the shared helper so request and polling paths cannot disagree.

- [x] **Step 3: Run the adapter tests and verify they pass**

  Run:

  ```bash
  npm test -- tests/execution/leetcode-adapter.test.ts
  ```

  Confirm raw fields, CodeMirror fields, structured fields, unavailable fields, and empty-field semantics all pass.

### Task 3: Add binary-tree parameter metadata

**Files:**
- Modify: `src/shared/execution-types.ts`
- Modify: `src/execution/entrypoint-resolver.ts`
- Modify: `tests/execution/execution-request.test.ts`

**Interfaces:**
- Extend `ParameterKind` with `"binary_tree"`.
- Recognize `TreeNode`, `Optional[TreeNode]`, `TreeNode | None`, and `None | TreeNode` after whitespace normalization.
- Continue classifying all unrelated annotations as `value`.

- [x] **Step 1: Extend the type and resolver**

  Add the new union member and a dedicated tree annotation branch after the existing linked-list branch.

- [x] **Step 2: Run focused TypeScript tests**

  Run:

  ```bash
  npm test -- tests/execution/execution-request.test.ts tests/execution/testcase-selection.test.ts
  ```

  Confirm existing linked-list and ordinary-value expectations remain unchanged.

### Task 4: Implement level-order TreeNode construction in Python

**Files:**
- Modify: `src/worker/python/runtime_prelude.py`
- Modify: `src/worker/python/runner.py`
- Modify: `tests/fixtures/python/test_trace_engine.py`
- Modify: `tests/execution/pyodide-runtime.test.ts`

**Interfaces:**
- Define a standard `TreeNode(val=0, left=None, right=None)` in the runtime prelude.
- Add a bounded queue-based `_build_binary_tree(values, node_class)` helper in the runner.
- Convert only parameters whose metadata is `binary_tree`; leave literal lists unchanged for `value` parameters.

- [x] **Step 1: Add the runtime prelude class and conversion helper**

  Build children in level-order rather than complete-array index arithmetic, so `[1,null,2,3]` attaches `3` as the left child of `2`. Treat `[]`, `None`, and `[None]` as an empty tree. Reject non-list values and invalid child payloads with `UnsupportedTestcaseFormat`.

- [x] **Step 2: Wire conversion into the existing parameter loop**

  Select `TreeNode` from the user namespace when available, otherwise use the prelude class. Convert `None` and list literals for `binary_tree`, and retain the existing linked-list path.

- [x] **Step 3: Run Python fixture tests and the runtime script test**

  Run:

  ```bash
  python3 -m pytest tests/fixtures/python/test_trace_engine.py -q
  npm test -- tests/execution/pyodide-runtime.test.ts
  ```

  Confirm the tree regression passes, the linked-list topology test still passes, and the generated Pyodide script contains the updated prelude.

### Task 5: Verify the full integration and update documentation

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`

- [x] **Step 1: Document the testcase-mode requirement and TreeNode coverage**

  State that the current page reader observes raw testcase controls and that TreeNode input is decoded from LeetCode level-order serialization. Keep limitations explicit for N-ary trees, graphs, and arbitrary custom node classes.

- [x] **Step 2: Run all verification gates**

  Run:

  ```bash
  npm test
  npm run typecheck
  npm run build
  python3 -m pytest tests/fixtures/python -q
  git diff --check
  git status --short
  ```

  Inspect the final diff and confirm no generated build output or unrelated changes are included.

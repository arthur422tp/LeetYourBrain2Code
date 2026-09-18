# Control-Flow Execution Story UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Control-Flow Evidence foundation into an occurrence-scoped Execution Story UI that explains factual loop iterations, decisions, transfers, and loop exits while preserving the existing raw trace cursor and evidence-first product boundary.

**Architecture:** Keep worker/runtime evidence authoritative and build a pure TypeScript presentation projection between core interpretation and DOM rendering. Before UI work, remove the remaining gated `break/continue` instrumentation and derive concrete loop activation scope from existing `frameId + parent ExecutionContextRef + static loopId`; no worker protocol change is required. The Side Panel then renders one Execution Story panel, activation-scoped iteration history, contextual Decision chains, factual source badges, and optional Control-Flow grouping in Trace Outline while leaving Behavioral Timeline and Failure-First behavior unchanged.

**Tech Stack:** Python 3 AST instrumentation, Pyodide 0.29.3, TypeScript 5.8, DOM APIs, Vitest 3.2, existing Side Panel CSS, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-control-flow-execution-story-ui-design.md`

**Runtime correction dependency:** `docs/superpowers/specs/2026-09-18-control-flow-foundation-correction-design.md`

## Global Constraints

- Control-Flow UI is a projection of factual interpreted evidence; it must not own or recreate runtime state machines.
- No worker protocol or Trace schema change is required for loop activation scope.
- Concrete loop activation scope is derived from `frameId + parent ExecutionContextRef.loopStack + static loopId`.
- Activation-local display ordinals are projection metadata; do not rewrite worker iteration numbers.
- A `break` or `continue` observation probe must never gate whether Python executes the original transfer statement.
- Synthetic lifecycle/transfer probes must remain hidden from user-visible trace steps.
- The raw trace cursor remains authoritative; all Control-Flow navigation resolves to existing raw steps/indexes.
- Behavioral Timeline receives no generic Control-Flow lane.
- Failure-First selection logic remains unchanged.
- No UI text may imply correctness, expected path, root cause, or recommended fix.
- Preserve factual distinctions between `observed`, `committed`, `superseded`, and `interrupted`.
- Tracing `truncated` / `unavailable` states must preserve already captured evidence.
- No inferred loop exit, branch selection, or transfer commitment may be fabricated from missing evidence.
- Semantic states must have text/data attributes and must not rely on color alone.

---

### Task 0: UI Prerequisite Cleanup — Ungated Transfers and Concrete Loop Activation Scope

**Files:**
- Modify: `src/worker/python/control_flow_instrumenter.py`
- Modify: `tests/fixtures/python/test_control_flow_instrumenter.py`
- Create: `src/core/control-flow-scope.ts`
- Create: `tests/core/control-flow-scope.test.ts`
- Modify: `src/core/control-flow-interpreter.ts`
- Modify: `tests/core/control-flow-interpreter.test.ts`

**Interfaces:**
- Produces `controlFlowActivationKey(frameId: number, loopId: string, context: ExecutionContextRef): string`.
- Produces `iterationActivationKey(iteration: LoopIterationEvidence): string`.
- Extends `ControlFlowInterpretation` with `iterationsByActivation: Map<string, LoopIterationEvidence[]>`.
- Keeps all public worker messages and `ControlFlowRuntimeEvent` wire types unchanged.

- [ ] **Step 1: Add a failing instrumenter regression proving `break/continue` do not depend on observer truthiness**

Add to `tests/fixtures/python/test_control_flow_instrumenter.py`:

```python
def test_break_and_continue_are_not_gated_by_observer_return_value(self):
    break_source = """def solve(xs):
    for x in xs:
        break
    return 7
"""
    result = instrument_control_flow(
        break_source, ast.parse(break_source),
        "ib", "ic", "to", "ro", "ne", "after"
    )
    namespace = {
        "ib": lambda *_args: None,
        "ic": lambda *_args: None,
        "to": lambda *_args: False,
        "ro": lambda _site, value: value,
        "ne": lambda *_args: None,
        "after": lambda *_args: None,
    }
    exec(compile(result.instrumented_tree, "<test>", "exec"), namespace, namespace)
    self.assertEqual(namespace["solve"]([1, 2]), 7)
```

Add the same shape for `continue` with `to` returning `None` and assert `[1, 2]` becomes `[2]`.

Run:

```bash
python3 -m unittest \
  tests.fixtures.python.test_control_flow_instrumenter.ControlFlowInstrumenterTests.test_break_and_continue_are_not_gated_by_observer_return_value
```

Expected: FAIL with the current synthetic `if observer(): break/continue` rewrite.

- [ ] **Step 2: Rewrite `break/continue` as side-effect-only synthetic probe + original statement**

In `src/worker/python/control_flow_instrumenter.py`, replace the guarded rewrite with:

```python
probe = self._synthetic_expr(self.transfer_observed_name, args, node)
return [probe, node]
```

Do not change `return` wrapping.

Run:

```bash
python3 -m unittest tests.fixtures.python.test_control_flow_instrumenter
```

Expected: PASS.

- [ ] **Step 3: Add failing activation-scope tests**

Create `tests/core/control-flow-scope.test.ts`:
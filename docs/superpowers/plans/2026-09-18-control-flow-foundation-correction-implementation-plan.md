# Control-Flow Foundation Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct Control-Flow Evidence so nested `finally` transfers resolve only at factual runtime boundaries, terminal fallback touches only still-active occurrences, and Python semantic regressions become a CI gate.

**Architecture:** Replace the recorder's single per-frame pending transfer with an ordered unresolved-transfer ledger. Make loop natural exit explicit for every `for`/`while` by inserting a hidden synthetic `else` probe, so break/continue resolution is boundary-driven rather than inferred. In TypeScript, separate historical iteration storage from active iteration/loop state so timeout/exception fallback cannot mutate already-closed history.

**Tech Stack:** Python 3 AST + `sys.settrace`, Pyodide 0.29.3, TypeScript 5.8, Vitest 3.2, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-18-control-flow-foundation-correction-design.md`

## Global Constraints

- A later transfer observation must never, by itself, supersede an earlier unresolved transfer.
- `loop_after(fN)` may commit only a compatible unresolved `break` targeting `fN`.
- The next `iteration_begin(fN)` or explicit natural-exit boundary may commit only a compatible unresolved `continue` targeting `fN`.
- A normal frame `RETURN_VALUE` / `RETURN_CONST` boundary may commit only unresolved `return` actions in that frame.
- Exception / trace termination never selects a winning transfer; unresolved actions become `interrupted`.
- A loop transfer may supersede an older action only when it targets the same loop or crosses a loop already present in the older action's observed execution context.
- Historical completed occurrences are immutable; terminal fallback may process only still-active iterations/loops.
- `controlFlowTracing.status = "truncated"` is not program termination and must not synthesize terminal loop exits.
- Synthetic lifecycle probes must remain hidden from user-visible trace steps, Locals, Call Stack, and behavioral analysis.
- No Execution Story UI work is part of this plan.
- Keep existing worker protocol and public control-flow event types unless a failing test proves a schema change is necessary.

---

### Task 1: Replace Single Pending Transfer With Boundary-Resolved Ledger

**Files:**
- Modify: `src/worker/python/control_flow_recorder.py`
- Modify: `src/worker/python/control_flow_instrumenter.py`
- Modify: `tests/fixtures/python/test_control_flow_recorder.py`
- Modify: `tests/fixtures/python/test_control_flow_instrumenter.py`

**Interfaces:**
- Consumes: existing `ExecutionContextRef` wire shape `{"loop_stack": [{"loop_id": string, "iteration": int}]}`, current `transfer_observed`, `return_observed`, `iteration_begin`, `loop_natural_exit`, `loop_after`, and `on_frame_return` entry points.
- Produces: `ControlFlowRecorder.unresolved_transfers: dict[int, list[dict]]`; boundary-specific internal helpers `_resolve_loop_transfer(frame_id, loop_id, kind)`, `_resolve_frame_return(frame_id)`, and `_interrupt_frame(frame_id)`. External event schema remains unchanged.

- [ ] **Step 1: Add failing recorder regressions for independent inner transfers and same-loop competition**

In `tests/fixtures/python/test_control_flow_recorder.py`, replace assumptions around a single pending action with direct ledger-behavior tests:

```python
def status_by_action(self, recorder):
    return {
        event["action_id"]: event["status"]
        for event in self.events(recorder)
        if event["kind"] == "transfer_status"
    }

def test_inner_break_commits_without_superseding_outer_return(self):
    recorder = self.make_recorder()

    self.assertEqual(recorder.return_observed("t_return", 1), 1)
    recorder.iteration_begin("f2", "for", (), ())
    recorder.transfer_observed("t_inner_break", "break", "f2")
    recorder.loop_after("f2", "for")
    recorder.on_frame_return(7, 20)

    statuses = self.status_by_action(recorder)
    self.assertEqual(statuses["a1"], "committed")
    self.assertEqual(statuses["a2"], "committed")

def test_same_loop_continue_supersedes_older_break_when_next_iteration_begins(self):
    recorder = self.make_recorder()

    recorder.iteration_begin("f1", "for", (), ())
    recorder.transfer_observed("t_break", "break", "f1")
    recorder.transfer_observed("t_continue", "continue", "f1")
    recorder.iteration_begin("f1", "for", (), ())

    statuses = self.status_by_action(recorder)
    self.assertEqual(statuses["a1"], "superseded")
    self.assertEqual(statuses["a2"], "committed")

def test_outer_break_survives_inner_break_until_outer_boundary(self):
    recorder = self.make_recorder()

    recorder.iteration_begin("f1", "for", (), ())
    recorder.transfer_observed("t_outer_break", "break", "f1")
    recorder.iteration_begin("f2", "for", (), ())
    recorder.transfer_observed("t_inner_break", "break", "f2")

    recorder.loop_after("f2", "for")
    self.assertNotIn("a1", self.status_by_action(recorder))

    recorder.loop_after("f1", "for")
    statuses = self.status_by_action(recorder)
    self.assertEqual(statuses["a1"], "committed")
    self.assertEqual(statuses["a2"], "committed")
```

Also add the inverse same-loop case:

```python
def test_same_loop_break_supersedes_older_continue_at_loop_after(self):
    recorder = self.make_recorder()

    recorder.iteration_begin("f1", "for", (), ())
    recorder.transfer_observed("t_continue", "continue", "f1")
    recorder.transfer_observed("t_break", "break", "f1")
    recorder.loop_after("f1", "for")

    statuses = self.status_by_action(recorder)
    self.assertEqual(statuses["a1"], "superseded")
    self.assertEqual(statuses["a2"], "committed")
```

Cover the remaining ledger matrix explicitly:

```python
def test_inner_continue_commits_without_superseding_outer_return(self):
    recorder = self.make_recorder()

    self.assertEqual(recorder.return_observed("t_return", 1), 1)
    recorder.iteration_begin("f2", "for", (), ())
    recorder.transfer_observed("t_inner_continue", "continue", "f2")
    recorder.iteration_begin("f2", "for", (), ())
    recorder.iteration_complete("f2")
    recorder.loop_natural_exit("f2", "for")
    recorder.loop_after("f2", "for")
    recorder.on_frame_return(7, 20)

    statuses = self.status_by_action(recorder)
    self.assertEqual(statuses["a1"], "committed")
    self.assertEqual(statuses["a2"], "committed")

def test_outer_continue_supersedes_return_when_next_outer_iteration_begins(self):
    recorder = self.make_recorder()

    recorder.iteration_begin("f1", "for", (), ())
    self.assertEqual(recorder.return_observed("t_return", 1), 1)
    recorder.transfer_observed("t_continue", "continue", "f1")
    recorder.iteration_begin("f1", "for", (), ())

    statuses = self.status_by_action(recorder)
    self.assertEqual(statuses["a1"], "superseded")
    self.assertEqual(statuses["a2"], "committed")

def test_frame_return_supersedes_older_break(self):
    recorder = self.make_recorder()

    recorder.iteration_begin("f1", "for", (), ())
    recorder.transfer_observed("t_break", "break", "f1")
    self.assertEqual(recorder.return_observed("t_return", 2), 2)
    recorder.on_frame_return(7, 20)

    statuses = self.status_by_action(recorder)
    self.assertEqual(statuses["a1"], "superseded")
    self.assertEqual(statuses["a2"], "committed")
```

- [ ] **Step 2: Add failing end-to-end Python regressions for real `finally` semantics**

In the same fixture, add:

```python
def test_return_survives_inner_break_in_finally(self):
    result = run_request(
        """class Solution:
    def solve(self):
        try:
            return 1
        finally:
            for _ in [1]:
                break
""",
        "",
        {"class_name": "Solution", "method_name": "solve", "parameter_count": 0},
        LIMITS,
    )
    events = [event for batch in result["control_flow_batches"] for event in batch["events"]]
    actions = {
        event["action_id"]: event
        for event in events
        if event["kind"] == "transfer_observed"
    }
    statuses = {
        event["action_id"]: event["status"]
        for event in events
        if event["kind"] == "transfer_status"
    }

    return_action = next(action_id for action_id, event in actions.items() if event["transfer_kind"] == "return")
    break_action = next(action_id for action_id, event in actions.items() if event["transfer_kind"] == "break")

    self.assertEqual(result["status"], "completed")
    self.assertEqual(result["return_value"], {"type": "int", "value": "1"})
    self.assertEqual(statuses[break_action], "committed")
    self.assertEqual(statuses[return_action], "committed")
```

Add outer-loop override:

```python
def test_outer_break_in_finally_supersedes_return(self):
    result = run_request(
        """class Solution:
    def solve(self):
        for _ in [1]:
            try:
                return 1
            finally:
                break
        return 2
""",
        "",
        {"class_name": "Solution", "method_name": "solve", "parameter_count": 0},
        LIMITS,
    )
    events = [event for batch in result["control_flow_batches"] for event in batch["events"]]
    observed = [event for event in events if event["kind"] == "transfer_observed"]
    status = {
        event["action_id"]: event["status"]
        for event in events
        if event["kind"] == "transfer_status"
    }
    first_return = next(event for event in observed if event["transfer_kind"] == "return")
    committed_break = next(event for event in observed if event["transfer_kind"] == "break")

    self.assertEqual(result["return_value"], {"type": "int", "value": "2"})
    self.assertEqual(status[first_return["action_id"]], "superseded")
    self.assertEqual(status[committed_break["action_id"]], "committed")
```

- [ ] **Step 3: Run the focused Python tests and verify current code fails**

Run:

```bash
python3 -m unittest   tests.fixtures.python.test_control_flow_recorder.ControlFlowRecorderTests.test_inner_break_commits_without_superseding_outer_return   tests.fixtures.python.test_control_flow_recorder.ControlFlowRecorderTests.test_same_loop_continue_supersedes_older_break_when_next_iteration_begins   tests.fixtures.python.test_control_flow_recorder.ControlFlowRecorderTests.test_outer_break_survives_inner_break_until_outer_boundary   tests.fixtures.python.test_control_flow_recorder.ControlFlowRecorderTests.test_return_survives_inner_break_in_finally
```

Expected: FAIL because `_observe_transfer()` immediately supersedes `self.pending_transfers[frame_id]`.

- [ ] **Step 4: Replace `pending_transfers` with an ordered unresolved ledger**

In `ControlFlowRecorder.__init__`:

```python
self.unresolved_transfers = {}
```

Delete `self.pending_transfers` and `_commit_pending()`.

Add focused helpers:

```python
def _ledger(self, frame_id):
    return self.unresolved_transfers.setdefault(frame_id, [])

@staticmethod
def _context_contains_loop(action, loop_id):
    return any(
        item["loop_id"] == loop_id
        for item in action["observed_context"]["loop_stack"]
    )

def _emit_transfer_status(self, frame_id, action, status, superseded_by=None):
    fields = {
        "action_id": action["action_id"],
        "status": status,
    }
    if superseded_by is not None:
        fields["superseded_by_action_id"] = superseded_by
    self._emit([self._event(frame_id, "transfer_status", **fields)])

def _remove_actions(self, frame_id, action_ids):
    remaining = [
        action
        for action in self.unresolved_transfers.get(frame_id, [])
        if action["action_id"] not in action_ids
    ]
    if remaining:
        self.unresolved_transfers[frame_id] = remaining
    else:
        self.unresolved_transfers.pop(frame_id, None)
```

Observation must only append:

```python
def _observe_transfer(self, frame_id, transfer_id, transfer_kind, target_loop_id=None):
    if self.status != "complete" or frame_id is None:
        return True

    action_id = f"a{self.next_action_id}"
    observed_order = self.next_action_id
    self.next_action_id += 1

    action = {
        "action_id": action_id,
        "transfer_id": transfer_id,
        "kind": transfer_kind,
        "target_loop_id": target_loop_id,
        "observed_order": observed_order,
        "observed_context": self._copy_context(
            self.active_loop_stacks.get(frame_id, [])
        ),
    }
    self._ledger(frame_id).append(action)

    self._emit([self._event(
        frame_id,
        "transfer_observed",
        action_id=action_id,
        transfer_id=transfer_id,
        transfer_kind=transfer_kind,
        **({"target_loop_id": target_loop_id} if target_loop_id is not None else {}),
    )])
    return True
```

Do not emit `superseded` here.

- [ ] **Step 5: Implement deterministic loop-boundary resolution**

Add:

```python
def _resolve_loop_transfer(self, frame_id, loop_id, kind):
    ledger = self.unresolved_transfers.get(frame_id, [])
    candidates = [
        action for action in ledger
        if action["kind"] == kind
        and action.get("target_loop_id") == loop_id
    ]
    if not candidates:
        return None

    winner = max(candidates, key=lambda action: action["observed_order"])
    resolved_ids = {winner["action_id"]}
    self._emit_transfer_status(frame_id, winner, "committed")

    for action in ledger:
        if action["action_id"] == winner["action_id"]:
            continue
        if action["observed_order"] >= winner["observed_order"]:
            continue

        same_target = action.get("target_loop_id") == loop_id
        crosses_original_context = self._context_contains_loop(action, loop_id)
        if same_target or crosses_original_context:
            self._emit_transfer_status(
                frame_id,
                action,
                "superseded",
                winner["action_id"],
            )
            resolved_ids.add(action["action_id"])

    self._remove_actions(frame_id, resolved_ids)
    return winner
```

Use it in `iteration_begin()` before starting the new iteration:

```python
winner = self._resolve_loop_transfer(frame_id, loop_id, "continue")
if winner is not None:
    self._pop_active_loop(frame_id, loop_id)
```

Use it in `loop_natural_exit()` to confirm a final-iteration continue:

```python
winner = self._resolve_loop_transfer(frame_id, loop_id, "continue")
if winner is not None:
    self._pop_active_loop(frame_id, loop_id)
```

Use it in `loop_after()` only for `break` after the natural-exit marker check:

```python
winner = self._resolve_loop_transfer(frame_id, loop_id, "break")
if winner is None:
    return None

self._pop_active_loop(frame_id, loop_id)
self._emit([self._event(
    frame_id,
    "loop_exit",
    loop_id=loop_id,
    loop_kind=loop_kind,
    reason="break",
)])
```

Do not default `loop_after()` to `exhausted` or `condition_false`; natural completion will get its own explicit marker in Step 7.

- [ ] **Step 6: Implement normal frame-return resolution and interruption**

Add:

```python
def _resolve_frame_return(self, frame_id):
    ledger = self.unresolved_transfers.get(frame_id, [])
    returns = [action for action in ledger if action["kind"] == "return"]
    if not returns:
        return None

    winner = max(returns, key=lambda action: action["observed_order"])
    self._emit_transfer_status(frame_id, winner, "committed")

    for action in ledger:
        if action["action_id"] == winner["action_id"]:
            continue
        self._emit_transfer_status(
            frame_id,
            action,
            "superseded",
            winner["action_id"],
        )

    self.unresolved_transfers.pop(frame_id, None)
    return winner

def _interrupt_frame(self, frame_id):
    ledger = self.unresolved_transfers.pop(frame_id, [])
    for action in ledger:
        self._emit_transfer_status(frame_id, action, "interrupted")
```

Update `on_frame_return()`:

```python
winner = self._resolve_frame_return(frame_id)
if winner is None:
    return None

stack = self.active_loop_stacks.get(frame_id, [])
for occurrence in reversed(stack):
    self._emit([self._event(
        frame_id,
        "loop_exit",
        loop_id=occurrence["loop_id"],
        loop_kind=occurrence["loop_kind"],
        reason="function_return",
    )])
self.active_loop_stacks.pop(frame_id, None)
```

Update `_finalize(reason)` to call `_interrupt_frame(frame_id)` for every frame in the ledger before finalizing active loops.

- [ ] **Step 7: Make natural loop exit explicit for every loop, not only source loops with `else`**

In `src/worker/python/control_flow_instrumenter.py`, change `_rewrite_loop()` so every instrumented loop has a synthetic natural-exit probe in its `orelse` suite:

```python
natural_exit = self._synthetic_expr(
    self.loop_natural_exit_name,
    [
        ast.Constant(descriptor["loopId"]),
        ast.Constant(descriptor["kind"]),
    ],
    node,
)
node.orelse = [natural_exit, *node.orelse]
```

This intentionally turns:

```python
for x in xs:
    body()
```

into the semantic equivalent of:

```python
for x in xs:
    body()
else:
    __lc_loop_natural_exit(...)

__lc_loop_after(...)
```

so normal exhaustion/condition-false is distinguishable from `break` without calling `iter()` or `next()` manually.

Retain `natural_exit_seen` so the immediately following `loop_after` is ignored after a natural exit.

- [ ] **Step 8: Add instrumenter tests for unconditional natural-exit probes**

In `tests/fixtures/python/test_control_flow_instrumenter.py`, extend the lifecycle test:

```python
def test_loop_without_source_else_still_marks_natural_exit(self):
    source = """def solve(xs):
    for x in xs:
        pass
"""
    calls = []
    result = instrument_control_flow(
        source, ast.parse(source),
        "ib", "ic", "to", "ro", "ne", "after"
    )
    namespace = {
        "ib": lambda *_args: calls.append("begin"),
        "ic": lambda *_args: calls.append("complete"),
        "to": lambda *_args: True,
        "ro": lambda _site, value: value,
        "ne": lambda *_args: calls.append("natural"),
        "after": lambda *_args: calls.append("after"),
    }
    exec(compile(result.instrumented_tree, "<test>", "exec"), namespace, namespace)
    namespace["solve"]([1])

    self.assertEqual(calls, ["begin", "complete", "natural", "after"])
```

Add a break case proving the natural marker is skipped:

```python
def test_break_skips_synthetic_natural_exit(self):
    source = """def solve(xs):
    for x in xs:
        break
"""
    calls = []
    result = instrument_control_flow(
        source, ast.parse(source),
        "ib", "ic", "to", "ro", "ne", "after"
    )
    namespace = {
        "ib": lambda *_args: calls.append("begin"),
        "ic": lambda *_args: calls.append("complete"),
        "to": lambda *_args: calls.append("transfer") or True,
        "ro": lambda _site, value: value,
        "ne": lambda *_args: calls.append("natural"),
        "after": lambda *_args: calls.append("after"),
    }
    exec(compile(result.instrumented_tree, "<test>", "exec"), namespace, namespace)
    namespace["solve"]([1])

    self.assertEqual(calls, ["begin", "transfer", "after"])
```

- [ ] **Step 9: Run the complete Python control-flow fixture suite**

Run:

```bash
python3 -m unittest   tests.fixtures.python.test_control_flow_instrumenter   tests.fixtures.python.test_control_flow_recorder
```

Expected: PASS, including the existing return-opcode regressions:
- normal `return None` commits;
- `return None` interrupted by escaping exception does not commit;
- caught exception inside `finally` preserves the original return.

- [ ] **Step 10: Commit Task 1**

```bash
git add   src/worker/python/control_flow_recorder.py   src/worker/python/control_flow_instrumenter.py   tests/fixtures/python/test_control_flow_recorder.py   tests/fixtures/python/test_control_flow_instrumenter.py
git commit -m "fix: resolve control flow transfers by runtime boundary"
```

---

### Task 2: Separate Historical Occurrences From Active Terminal State

**Files:**
- Modify: `src/core/control-flow-interpreter.ts`
- Modify: `tests/core/control-flow-interpreter.test.ts`

**Interfaces:**
- Consumes: unchanged `ControlFlowBatch[]`, `ControlFlowPlan | undefined`, `RuntimeState[]`, and `TraceTerminationContext`.
- Produces: unchanged `ControlFlowInterpretation`; internal state is split into `iterationsById`, `activeIterations`, and `activeLoops`.

- [ ] **Step 1: Add failing test for a closed loop followed by exception**

In `tests/core/control-flow-interpreter.test.ts`:

```ts
it("does not re-finalize an exhausted loop when the frame later throws", () => {
  const result = buildControlFlowEvidence(
    plan,
    [batch([
      {
        ...baseEvent(1, 3),
        kind: "iteration_begin",
        loopId: "f1",
        loopKind: "for",
        iteration: 1,
        bindings: []
      },
      {
        ...baseEvent(2, 4),
        kind: "iteration_complete",
        loopId: "f1",
        iteration: 1
      },
      {
        ...baseEvent(3, 5, { loopStack: [] }),
        kind: "loop_exit",
        loopId: "f1",
        loopKind: "for",
        reason: "exhausted"
      }
    ])],
    reconstructStates([rawEvent(3), rawEvent(4), rawEvent(5), rawEvent(6)]),
    { status: "exception", terminationReason: "exception" }
  );

  expect(result.iterations).toEqual([
    expect.objectContaining({ loopId: "f1", iteration: 1, status: "completed" })
  ]);
  expect(result.loopExits).toEqual([
    expect.objectContaining({ loopId: "f1", reason: "exhausted" })
  ]);
});
```

- [ ] **Step 2: Add failing test for one historical loop plus one active loop at timeout**

Add:

```ts
it("finalizes only the second active loop when an earlier loop already exited", () => {
  const twoLoopPlan: ControlFlowPlan = {
    version: 1,
    loops: [
      { loopId: "f1", kind: "for", span: { line: 2, column: 0, endLine: 3, endColumn: 1 } },
      { loopId: "w2", kind: "while", span: { line: 5, column: 0, endLine: 6, endColumn: 1 } }
    ],
    transfers: []
  };

  const result = buildControlFlowEvidence(
    twoLoopPlan,
    [batch([
      {
        eventId: 1,
        anchorStep: 2,
        frameId: 1,
        context: { loopStack: [{ loopId: "f1", iteration: 1 }] },
        kind: "iteration_begin",
        loopId: "f1",
        loopKind: "for",
        iteration: 1,
        bindings: []
      },
      {
        eventId: 2,
        anchorStep: 3,
        frameId: 1,
        context: { loopStack: [{ loopId: "f1", iteration: 1 }] },
        kind: "iteration_complete",
        loopId: "f1",
        iteration: 1
      },
      {
        eventId: 3,
        anchorStep: 4,
        frameId: 1,
        context: { loopStack: [] },
        kind: "loop_exit",
        loopId: "f1",
        loopKind: "for",
        reason: "exhausted"
      },
      {
        eventId: 4,
        anchorStep: 6,
        frameId: 1,
        context: { loopStack: [{ loopId: "w2", iteration: 1 }] },
        kind: "iteration_begin",
        loopId: "w2",
        loopKind: "while",
        iteration: 1,
        bindings: []
      }
    ])],
    reconstructStates([2, 3, 4, 5, 6].map(rawEvent)),
    { status: "timeout", terminationReason: "hard_timeout" }
  );

  expect(result.loopExits.filter((item) => item.loopId === "f1"))
    .toEqual([expect.objectContaining({ reason: "exhausted" })]);
  expect(result.loopExits.filter((item) => item.loopId === "w2"))
    .toEqual([expect.objectContaining({ reason: "trace_ended" })]);
  expect(result.iterations.find((item) => item.loopId === "w2"))
    .toMatchObject({ status: "interrupted" });
});
```

- [ ] **Step 3: Add a failing test that terminal fallback finalizes nested loops inner-to-outer**

Add:

```ts
it("finalizes nested active loops from inner to outer", () => {
  const nestedPlan: ControlFlowPlan = {
    version: 1,
    loops: [
      { loopId: "f1", kind: "for", span: { line: 2, column: 0, endLine: 6, endColumn: 1 } },
      { loopId: "w2", kind: "while", span: { line: 3, column: 0, endLine: 5, endColumn: 1 } }
    ],
    transfers: []
  };
  const nestedContext = {
    loopStack: [
      { loopId: "f1", iteration: 1 },
      { loopId: "w2", iteration: 1 }
    ]
  };

  const result = buildControlFlowEvidence(
    nestedPlan,
    [batch([
      {
        eventId: 1,
        anchorStep: 2,
        frameId: 1,
        context: { loopStack: [{ loopId: "f1", iteration: 1 }] },
        kind: "iteration_begin",
        loopId: "f1",
        loopKind: "for",
        iteration: 1,
        bindings: []
      },
      {
        eventId: 2,
        anchorStep: 3,
        frameId: 1,
        context: nestedContext,
        kind: "iteration_begin",
        loopId: "w2",
        loopKind: "while",
        iteration: 1,
        bindings: []
      }
    ])],
    reconstructStates([rawEvent(2), rawEvent(3)]),
    { status: "exception", terminationReason: "exception" }
  );

  expect(result.loopExits.map((exit) => exit.loopId)).toEqual(["w2", "f1"]);
  expect(result.loopExits.map((exit) => exit.reason)).toEqual(["exception", "exception"]);
});
```

- [ ] **Step 4: Run the focused tests and verify current interpreter fails**

Run:

```bash
npx vitest run tests/core/control-flow-interpreter.test.ts
```

Expected: at least the completed-loop/later-exception test FAILS because the current termination fallback scans historical iterations.

- [ ] **Step 5: Split all iteration history from active iteration state**

In `src/core/control-flow-interpreter.ts`, replace the single `open` map with:

```ts
const iterationsById = new Map<string, OpenIteration>();
const activeIterations = new Map<string, OpenIteration>();

interface ActiveLoopRuntime {
  frameId: number;
  loopId: string;
  loopKind: "for" | "while";
  context: ExecutionContextRef;
  lastAnchorStep: number;
}

const activeLoops = new Map<string, ActiveLoopRuntime>();
```

On `iteration_begin`:

```ts
const key = occurrenceKey(event.frameId, event.loopId, event.iteration);
const iteration: OpenIteration = {
  frameId: event.frameId,
  loopId: event.loopId,
  iteration: event.iteration,
  context: cloneContext(event.context),
  anchorStepStart: event.anchorStep,
  anchorStepEnd: event.anchorStep,
  bindings: event.bindings.map((binding) => ({
    name: binding.name,
    value: binding.value
  })),
  status: "open"
};

if (!iterationsById.has(key)) {
  iterationsById.set(key, iteration);
  activeIterations.set(key, iteration);
}

activeLoops.set(controlFlowLoopKey(event.frameId, event.loopId), {
  frameId: event.frameId,
  loopId: event.loopId,
  loopKind: event.loopKind,
  context: cloneContext(event.context),
  lastAnchorStep: event.anchorStep
});
```

Do not create active-loop state from the static plan alone.

- [ ] **Step 6: Make iteration resolution remove only active state**

Update `findOccurrence()` to read from `activeIterations`.

Update `markIteration()` so a terminal status closes the active occurrence while preserving history:

```ts
const key = occurrenceKey(frameId, matching.loopId, matching.iteration);
const iteration = activeIterations.get(key);
if (!iteration || iteration.status !== "open") return;

iteration.status = status;
iteration.anchorStepEnd = Math.max(iteration.anchorStepEnd, anchorStep);
if (actionId) iteration.exitActionId = actionId;
activeIterations.delete(key);
```

Update `iteration_complete` similarly:

```ts
const key = occurrenceKey(event.frameId, event.loopId, event.iteration);
const iteration = activeIterations.get(key);
if (iteration && iteration.status === "open") {
  iteration.status = "completed";
  iteration.anchorStepEnd = Math.max(iteration.anchorStepEnd, event.anchorStep);
  activeIterations.delete(key);
}
```

- [ ] **Step 7: Close active-loop state on authoritative `loop_exit`**

When processing a `loop_exit` event:

```ts
activeLoops.delete(controlFlowLoopKey(event.frameId, event.loopId));
```

Then apply the existing precise iteration status projection:
- `break` -> `broke`
- `function_return` -> `function_returned`
- `exception` / `trace_ended` -> `interrupted`

For `exhausted` / `condition_false`, do not invent `completed` for an unexplained active iteration. If one remains because upstream evidence is partial, leave it unresolved until the final "incomplete evidence" cleanup in Step 8.

- [ ] **Step 8: Finalize terminal fallback from active state only, inner-to-outer**

Replace the current historical scan with:

```ts
if (needsInterruption) {
  const reason = termination?.status === "exception"
    ? "exception"
    : "trace_ended";

  for (const iteration of activeIterations.values()) {
    if (iteration.status !== "open") continue;
    iteration.status = "interrupted";
    iteration.anchorStepEnd = lastCapturedStep;
  }
  activeIterations.clear();

  const activeLoopList = [...activeLoops.values()]
    .sort((left, right) =>
      right.context.loopStack.length - left.context.loopStack.length
      || right.lastAnchorStep - left.lastAnchorStep
    );

  for (const loop of activeLoopList) {
    const exit: LoopExitEvidence = {
      frameId: loop.frameId,
      loopId: loop.loopId,
      loopKind: loop.loopKind,
      context: cloneContext(loop.context),
      anchorStep: lastCapturedStep,
      reason
    };
    const exitKey =
      `${exit.frameId}:${exit.loopId}:${exit.anchorStep}:${exit.reason}`;
    if (!loopExitKeys.has(exitKey)) {
      loopExitKeys.add(exitKey);
      loopExits.push(exit);
    }
  }
  activeLoops.clear();
}
```

This fallback must remain triggered only by terminal session status, never by `controlFlowTracing.status === "truncated"`.

- [ ] **Step 9: Preserve incomplete evidence conservatively at non-interrupting termination**

After all events are processed, any `activeIterations` left open without a terminal interruption means the control-flow stream is incomplete. Mark those iterations `interrupted` for UI safety, but do **not** synthesize a new loop exit:

```ts
for (const iteration of activeIterations.values()) {
  if (iteration.status === "open") {
    iteration.status = "interrupted";
    iteration.anchorStepEnd = lastCapturedStep;
  }
}
activeIterations.clear();
```

Build final history from:

```ts
const iterations = [...iterationsById.values()].filter(
  (iteration): iteration is LoopIterationEvidence =>
    iteration.status !== "open"
);
```

- [ ] **Step 10: Run interpreter tests**

Run:

```bash
npx vitest run tests/core/control-flow-interpreter.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 2**

```bash
git add   src/core/control-flow-interpreter.ts   tests/core/control-flow-interpreter.test.ts
git commit -m "fix: finalize only active control flow occurrences"
```

---

### Task 3: Add Cross-Layer Python Semantics Regressions

**Files:**
- Modify: `tests/core/control-flow-e2e.test.ts`
- Modify: `tests/execution/execution-controller.test.ts` only if the existing hard-timeout test does not already prove streamed control-flow batches survive `forceTimeout()`

**Interfaces:**
- Consumes: unchanged `interpretTrace(..., controlPlan, controlBatches, termination)` and current Pyodide runtime callbacks.
- Produces: regression coverage for real Python unwinding plus a controller-level hard-timeout retention assertion.

- [ ] **Step 1: Add Pyodide E2E for return surviving an inner break**

In `tests/core/control-flow-e2e.test.ts`:

```ts
it("keeps an outer return alive when finally completes an inner-loop break", async () => {
  const result = await run(
    "control-e2e-return-inner-break",
    `class Solution:
    def solve(self):
        try:
            return 1
        finally:
            for _ in [1]:
                break
`,
    "",
    entrypoint("solve", 0, [])
  );

  expect(result.terminal.returnValue).toEqual({ type: "int", value: "1" });

  const actions = result.interpretation.controlFlow.actions;
  expect(actions.find((action) => action.kind === "break"))
    .toMatchObject({ status: "committed" });
  expect(actions.find((action) => action.kind === "return"))
    .toMatchObject({ status: "committed" });
  expect(actions.filter((action) => action.status === "superseded"))
    .toHaveLength(0);
});
```

- [ ] **Step 2: Add Pyodide E2E for outer-loop break overriding return**

```ts
it("supersedes a pending return when finally commits a break from its original loop", async () => {
  const result = await run(
    "control-e2e-return-outer-break",
    `class Solution:
    def solve(self):
        for _ in [1]:
            try:
                return 1
            finally:
                break
        return 2
`,
    "",
    entrypoint("solve", 0, [])
  );

  expect(result.terminal.returnValue).toEqual({ type: "int", value: "2" });

  const returns = result.interpretation.controlFlow.actions
    .filter((action) => action.kind === "return");
  expect(returns.some((action) => action.status === "superseded")).toBe(true);
  expect(returns.some((action) => action.status === "committed")).toBe(true);
  expect(result.interpretation.controlFlow.actions
    .some((action) => action.kind === "break" && action.status === "committed"))
    .toBe(true);
});
```

- [ ] **Step 3: Add Pyodide E2E for same-loop `break ↔ continue` overrides**

Add one test containing both sources:

```ts
it("resolves competing break and continue using the boundary that actually occurs", async () => {
  const continueWins = await run(
    "control-e2e-break-then-continue",
    `class Solution:
    def solve(self):
        last = -1
        for i in range(2):
            last = i
            try:
                break
            finally:
                continue
        return last
`,
    "",
    entrypoint("solve", 0, [])
  );

  expect(continueWins.terminal.returnValue).toEqual({ type: "int", value: "1" });
  expect(continueWins.interpretation.controlFlow.actions
    .some((action) => action.kind === "break" && action.status === "superseded"))
    .toBe(true);
  expect(continueWins.interpretation.controlFlow.actions
    .some((action) => action.kind === "continue" && action.status === "committed"))
    .toBe(true);

  const breakWins = await run(
    "control-e2e-continue-then-break",
    `class Solution:
    def solve(self):
        last = -1
        for i in range(2):
            last = i
            try:
                continue
            finally:
                break
        return last
`,
    "",
    entrypoint("solve", 0, [])
  );

  expect(breakWins.terminal.returnValue).toEqual({ type: "int", value: "0" });
  expect(breakWins.interpretation.controlFlow.actions
    .some((action) => action.kind === "continue" && action.status === "superseded"))
    .toBe(true);
  expect(breakWins.interpretation.controlFlow.actions
    .some((action) => action.kind === "break" && action.status === "committed"))
    .toBe(true);
});
```

- [ ] **Step 4: Add E2E for a completed loop followed by a later exception**

```ts
it("does not relabel an exhausted loop when the function later raises", async () => {
  const result = await run(
    "control-e2e-exhausted-then-exception",
    `class Solution:
    def solve(self):
        for x in [1]:
            pass
        raise ValueError("boom")
`,
    "",
    entrypoint("solve", 0, [])
  );

  expect(result.terminal.status).toBe("exception");
  const exits = result.interpretation.controlFlow.loopExits
    .filter((exit) => exit.loopId === result.controlPlan!.loops[0]!.loopId);
  expect(exits).toEqual([
    expect.objectContaining({ reason: "exhausted" })
  ]);
});
```

- [ ] **Step 5: Add Pyodide trace-limit E2E for completed first loop + interrupted second loop**

Hard timeout belongs to `ExecutionController`, not `createPyodideRuntime().execute()`; use `trace_limit` for the real Pyodide cross-layer case:

```ts
it("keeps a completed first loop closed when tracing ends inside a second loop", async () => {
  const result = await run(
    "control-e2e-first-closed-second-truncated",
    `class Solution:
    def solve(self):
        for x in [1]:
            pass

        i = 0
        while True:
            i += 1
`,
    "",
    entrypoint("solve", 0, []),
    { maxTraceSteps: 28 }
  );

  expect(result.terminal.status).toBe("trace_limit");

  const [firstLoop, secondLoop] = result.controlPlan!.loops;
  expect(result.interpretation.controlFlow.loopExits
    .filter((exit) => exit.loopId === firstLoop!.loopId))
    .toEqual([expect.objectContaining({ reason: "exhausted" })]);

  expect(result.interpretation.controlFlow.loopExits
    .filter((exit) => exit.loopId === secondLoop!.loopId))
    .toEqual([expect.objectContaining({ reason: "trace_ended" })]);
});
```

- [ ] **Step 6: Ensure controller hard timeout preserves streamed Control-Flow evidence**

Inspect the existing hard-timeout case in `tests/execution/execution-controller.test.ts`.

If it does not already stream a control-flow plan/batch before timeout, extend that existing case so the mock worker sends:

```ts
worker.emitMessage({
  type: "control_flow_plan",
  sessionId: request.sessionId,
  plan: {
    version: 1,
    loops: [{
      loopId: "w1",
      kind: "while",
      span: { line: 2, column: 0, endLine: 3, endColumn: 1 }
    }],
    transfers: []
  }
});

worker.emitMessage({
  type: "control_flow_batch",
  sessionId: request.sessionId,
  batches: [{
    batchId: 1,
    events: [{
      eventId: 1,
      anchorStep: 2,
      frameId: 1,
      context: { loopStack: [{ loopId: "w1", iteration: 1 }] },
      kind: "iteration_begin",
      loopId: "w1",
      loopKind: "while",
      iteration: 1,
      bindings: []
    }]
  }]
});
```

After the timeout resolves, assert:

```ts
expect(session.status).toBe("timeout");
expect(session.terminationReason).toBe("hard_timeout");
expect(session.controlFlowPlan?.loops[0]?.loopId).toBe("w1");
expect(session.controlFlowBatches?.[0]?.events[0]?.kind).toBe("iteration_begin");
```

Do not make the controller interpret Control-Flow Evidence; it only has to preserve streamed evidence for the core interpreter.

- [ ] **Step 7: Run the focused cross-layer tests**

Run:

```bash
npx vitest run   tests/core/control-flow-e2e.test.ts   tests/execution/execution-controller.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add   tests/core/control-flow-e2e.test.ts   tests/execution/execution-controller.test.ts
git commit -m "test: cover nested control flow transfer resolution"
```

---

### Task 4: Make Python Semantics a CI Gate and Run Full Verification

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: all Python fixture tests under `tests/fixtures/python/test_*.py`, existing `npm test`, `npm run typecheck`, and `npm run build`.
- Produces: four explicit CI gates: Python tests, Vitest, Typecheck, Build.

- [ ] **Step 1: Add the Python fixture suite before Vitest in CI**

Update `.github/workflows/ci.yml`:

```yaml
      - name: Python tests
        run: python3 -m unittest discover -s tests/fixtures/python -p "test_*.py"

      - name: Test
        run: npm test

      - name: Typecheck
        run: npm run typecheck

      - name: Build
        run: npm run build
```

Keep Python and Vitest as separate steps so failures are attributable.

- [ ] **Step 2: Run the exact Python CI command locally**

Run:

```bash
python3 -m unittest discover -s tests/fixtures/python -p "test_*.py"
```

Expected: PASS with all Python fixtures, including Control-Flow, Decision, and Expression recorder/instrumenter regressions.

- [ ] **Step 3: Run the complete Vitest suite**

Run:

```bash
npm test
```

Expected: all test files pass, including the new Control-Flow E2E and interpreter regressions.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit code 0.

- [ ] **Step 5: Run production builds**

Run:

```bash
npm run build
```

Expected: all three Vite builds complete successfully:
- side panel / worker bundle;
- content script;
- page bridge.

Existing Pyodide browser-compatibility externalization warnings are acceptable if unchanged from baseline; new errors are not.

- [ ] **Step 6: Verify the correction's semantic matrix before committing**

Run these focused commands one final time:

```bash
python3 -m unittest   tests.fixtures.python.test_control_flow_recorder   tests.fixtures.python.test_control_flow_instrumenter

npx vitest run   tests/core/control-flow-interpreter.test.ts   tests/core/control-flow-e2e.test.ts   tests/execution/execution-controller.test.ts
```

Expected: PASS.

Manually confirm from assertions that the suite now protects all of these outcomes:

```text
return -> finally inner break    => break committed, return committed
return -> finally outer break    => first return superseded, break committed
break -> finally continue        => break superseded, continue committed
continue -> finally break        => continue superseded, break committed
closed loop -> later exception   => no second exception loop exit
closed loop -> later trace limit => closed loop unchanged
active loop -> trace limit       => interrupted + trace_ended
exception unwind                 => unresolved return interrupted
```

- [ ] **Step 7: Commit Task 4**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: gate control flow Python semantics"
```

- [ ] **Step 8: Confirm the pushed GitHub Actions run is green**

After pushing the branch/commit, inspect the workflow run for the new head SHA.

Required successful steps:

```text
Install dependencies
Python tests
Test
Typecheck
Build
```

Do not start the separate Execution Story UI implementation plan until this workflow is green.

---

## Execution Handoff

Plan complete after self-review. Execute Tasks 1 → 4 in order. Task 1 changes the semantic state machine that all later tasks depend on; Task 2 fixes interpretation of its immutable events; Task 3 proves cross-layer behavior; Task 4 turns the regressions into permanent CI gates.

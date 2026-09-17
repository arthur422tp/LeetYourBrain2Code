# Control-Flow Evidence Foundation — Mandatory Plan Amendment

This file is a mandatory correction to:

`docs/superpowers/plans/2026-09-17-control-flow-evidence-foundation-implementation-plan.md`

When the two documents differ, this amendment wins.

## 1. Static ID allocation is exact

Task 2 must allocate loop IDs from one global loop ordinal while retaining the loop kind in the prefix:

```python
self.loop_ordinal += 1
loop_id = (
    f"f{self.loop_ordinal}"
    if isinstance(node, ast.For)
    else f"w{self.loop_ordinal}"
)
```

Transfer IDs use one global transfer ordinal:

```python
self.transfer_ordinal += 1
transfer_id = f"t{self.transfer_ordinal}"
```

A loop's `orelse` suite is visited **after that loop has been popped from the lexical loop stack**. Therefore a `break` / `continue` occurring in a nested loop inside an outer loop's `else` targets that nested loop (or another actually enclosing loop), never the loop whose `else` is executing.

## 2. A raw `sys.settrace` `return` event is not by itself proof of a normal frame return

Python also emits a `return` trace event with `arg is None` when a frame unwinds because an exception escapes it. Therefore Task 3 Step 10 must **not** call `ControlFlowRecorder.on_frame_return(...)` for every raw `return` event.

Add a cached normal-return instruction check in `src/worker/python/tracer.py`:

```python
import dis

class TraceCollector:
    def __init__(...):
        ...
        self.return_offsets = {}

    def _normal_return_offsets(self, code):
        offsets = self.return_offsets.get(code)
        if offsets is None:
            offsets = {
                instruction.offset
                for instruction in dis.get_instructions(code)
                if instruction.opname in {"RETURN_VALUE", "RETURN_CONST"}
            }
            self.return_offsets[code] = offsets
        return offsets

    def _is_normal_frame_return(self, frame):
        return frame.f_lasti in self._normal_return_offsets(frame.f_code)
```

After recording the authoritative raw `return` event:

```python
if (
    self.control_flow_recorder is not None
    and self._is_normal_frame_return(frame)
):
    self.control_flow_recorder.on_frame_return(info["frame_id"], step)
```

If the return trace event is caused by exception unwinding, do **not** commit a pending explicit return there. The runner's terminal exception path later calls:

```python
control_recorder.finalize_exception()
```

which resolves the pending return as `interrupted` and active loops as `exception` exits.

This check is evidence-only. It must not alter user bytecode or exception propagation.

## 3. Add explicit return/unwind regression tests

Task 3 Python tests and Task 7 Pyodide E2E tests must include all three cases below.

### Normal bare/None return

```python
def f():
    return None
```

Expected:

```text
return observed
normal RETURN_* frame event
return committed
terminal return value = None
```

### Return superseded by escaping exception

```python
def f():
    try:
        return None
    finally:
        raise ValueError("boom")
```

Expected:

```text
return observed
exception-unwind return trace event is NOT a commit boundary
return interrupted
terminal status = exception
```

There must be no `transfer_status=committed` for this return.

### Original return survives a caught exception inside `finally`

```python
def f():
    try:
        return None
    finally:
        try:
            1 / 0
        except ZeroDivisionError:
            pass
```

Expected:

```text
return observed
caught exception does not terminate frame
final normal RETURN_* frame event commits the original return
terminal return value = None
```

These tests are required because `arg is None` cannot distinguish normal `return None` from exception-unwind trace events.

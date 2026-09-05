import json
import math
import sys
import traceback


USER_CODE_FILENAME = "<leetcode-user-code>"


class TraceLimitExceeded(Exception):
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


def _limit(limits, snake_name, camel_name, default):
    if snake_name in limits:
        return limits[snake_name]
    if camel_name in limits:
        return limits[camel_name]
    return default


class ValueSerializer:
    def __init__(self, limits):
        self.max_container_items = max(
            0, int(_limit(limits, "max_container_items", "maxContainerItems", 1000))
        )
        self.max_nesting_depth = max(
            0, int(_limit(limits, "max_nesting_depth", "maxNestingDepth", 12))
        )
        self.active_objects = set()
        self.references = {}
        self.next_reference_id = 1

    def _cycle(self, value):
        object_id = id(value)
        reference_id = self.references.get(object_id)
        if reference_id is None:
            reference_id = f"ref-{self.next_reference_id}"
            self.next_reference_id += 1
            self.references[object_id] = reference_id
        return {"type": "cycle", "referenceId": reference_id}

    def _unknown(self, value, truncated=False):
        try:
            representation = repr(value)
        except Exception:
            representation = "<unrepresentable>"
        snapshot = {
            "type": "unknown",
            "className": type(value).__name__,
            "repr": representation,
        }
        if truncated:
            snapshot["truncated"] = True
        return snapshot

    def serialize(self, value, depth=0):
        if value is None:
            return {"type": "none", "value": None}
        if isinstance(value, bool):
            return {"type": "bool", "value": value}
        if isinstance(value, int):
            return {"type": "int", "value": str(value)}
        if isinstance(value, float):
            if math.isnan(value):
                encoded = "NaN"
            elif math.isinf(value):
                encoded = "Infinity" if value > 0 else "-Infinity"
            else:
                encoded = value
            return {"type": "float", "value": encoded}
        if isinstance(value, str):
            return {
                "type": "str",
                "value": value,
                "length": len(value),
                "truncated": False,
            }

        if depth >= self.max_nesting_depth:
            return self._unknown(value, truncated=True)

        object_id = id(value)
        if object_id in self.active_objects:
            return self._cycle(value)

        if isinstance(value, (list, tuple)):
            self.active_objects.add(object_id)
            try:
                items = [
                    self.serialize(item, depth + 1)
                    for item in value[: self.max_container_items]
                ]
            finally:
                self.active_objects.discard(object_id)
            return {
                "type": "tuple" if isinstance(value, tuple) else "list",
                "length": len(value),
                "items": items,
                "truncated": len(value) > self.max_container_items,
            }

        if isinstance(value, dict):
            self.active_objects.add(object_id)
            try:
                entries = [
                    {
                        "key": self.serialize(key, depth + 1),
                        "value": self.serialize(item, depth + 1),
                    }
                    for key, item in list(value.items())[: self.max_container_items]
                ]
            finally:
                self.active_objects.discard(object_id)
            return {
                "type": "dict",
                "length": len(value),
                "entries": entries,
                "truncated": len(value) > self.max_container_items,
            }

        if isinstance(value, (set, frozenset)):
            values = list(value)
            values.sort(key=lambda item: repr(item))
            self.active_objects.add(object_id)
            try:
                items = [
                    self.serialize(item, depth + 1)
                    for item in values[: self.max_container_items]
                ]
            finally:
                self.active_objects.discard(object_id)
            return {
                "type": "set",
                "length": len(value),
                "items": items,
                "truncated": len(value) > self.max_container_items,
            }

        return self._unknown(value)


class TraceCollector:
    def __init__(
        self,
        limits,
        stdout_buffer,
        baseline_global_names=None,
        session_id="session",
        emit_batch=None,
    ):
        self.limits = limits
        self.stdout_buffer = stdout_buffer
        self.baseline_global_names = set(baseline_global_names or ())
        self.session_id = session_id
        self.emit_batch = emit_batch
        self.events = []
        self.pending_events = []
        self.step_count = 0
        self.session_bytes = 0
        self.frame_ids = {}
        self.frame_info = {}
        self.frame_stack = []
        self.next_frame_id = 1
        self.previous_trace = None
        self.stdout_offset = 0
        self.last_exception = None

    def _max_trace_steps(self):
        return max(0, int(_limit(self.limits, "max_trace_steps", "maxTraceSteps", 10000)))

    def _max_session_bytes(self):
        return max(
            0,
            int(_limit(self.limits, "max_session_bytes", "maxSessionBytes", 8_000_000)),
        )

    def _max_stdout_bytes(self):
        return max(
            0,
            int(_limit(self.limits, "max_stdout_bytes", "maxStdoutBytes", 64_000)),
        )

    def _stdout_delta(self):
        current = self.stdout_buffer.getvalue()
        delta = current[self.stdout_offset :]
        self.stdout_offset = len(current)
        return delta

    def _exception_info(self, frame, argument, frame_id):
        exception_type, exception_value, exception_traceback = argument
        try:
            stack = traceback.format_tb(exception_traceback)
        except Exception:
            stack = []
        return {
            "type": getattr(exception_type, "__name__", str(exception_type)),
            "message": str(exception_value),
            "line": frame.f_lineno,
            "stack": stack,
            "frame_id": frame_id,
        }

    def _frame_id_for(self, frame):
        object_id = id(frame)
        if object_id not in self.frame_ids:
            self.frame_ids[object_id] = self.next_frame_id
            self.next_frame_id += 1
        return self.frame_ids[object_id]

    def _record(self, frame, event_name, argument, info):
        self.step_count += 1
        if self.step_count > self._max_trace_steps():
            raise TraceLimitExceeded("step_limit")

        serializer = ValueSerializer(self.limits)
        try:
            locals_snapshot = {
                name: serializer.serialize(value)
                for name, value in frame.f_locals.items()
                if not name.startswith("__lc_")
                and not (
                    frame.f_code.co_name == "<module>"
                    and (name == "__builtins__" or name in self.baseline_global_names)
                )
            }
        except Exception as error:
            raise TraceLimitExceeded("trace_byte_limit") from error

        frame_id = info["frame_id"]
        payload = None
        if event_name == "return":
            payload = {"return_value": serializer.serialize(argument)}
        elif event_name == "exception":
            exception = self._exception_info(frame, argument, frame_id)
            self.last_exception = exception
            payload = {"exception": exception}

        event = {
            "step": self.step_count,
            "event": event_name,
            "frame_id": frame_id,
            "parent_frame_id": info["parent_frame_id"],
            "function": frame.f_code.co_name,
            "line": frame.f_lineno,
            "call_depth": info["call_depth"],
            "locals": locals_snapshot,
            "stdout_delta": self._stdout_delta(),
        }
        if payload is not None:
            event["event_payload"] = payload

        event_size = len(json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        stdout_size = len(self.stdout_buffer.getvalue().encode("utf-8"))
        if stdout_size > self._max_stdout_bytes():
            raise TraceLimitExceeded("stdout_limit")
        if self.session_bytes + event_size > self._max_session_bytes():
            raise TraceLimitExceeded("trace_byte_limit")

        self.session_bytes += event_size
        self.events.append(event)
        self.pending_events.append(event)
        if len(self.pending_events) >= 50:
            self.flush()

    def flush(self):
        if not self.pending_events or self.emit_batch is None:
            return
        events = self.pending_events
        self.pending_events = []
        try:
            self.emit_batch(
                self.session_id,
                json.dumps(events, ensure_ascii=False, separators=(",", ":")),
            )
        except Exception:
            # Streaming is best effort. The terminal result still contains the
            # complete trace when the worker finishes normally.
            pass

    def trace(self, frame, event_name, argument):
        if frame.f_code.co_filename != USER_CODE_FILENAME:
            return self.trace

        object_id = id(frame)
        if event_name == "call":
            frame_id = self._frame_id_for(frame)
            parent_frame_id = self.frame_stack[-1] if self.frame_stack else None
            call_depth = len(self.frame_stack) + 1
            info = {
                "frame_id": frame_id,
                "parent_frame_id": parent_frame_id,
                "call_depth": call_depth,
            }
            self.frame_info[object_id] = info
            self.frame_stack.append(frame_id)
        else:
            info = self.frame_info.get(object_id)
            if info is None:
                return self.trace

        if event_name in ("call", "line", "return", "exception"):
            self._record(frame, event_name, argument, info)

        if event_name == "return":
            if self.frame_stack and self.frame_stack[-1] == info["frame_id"]:
                self.frame_stack.pop()
            self.frame_info.pop(object_id, None)
        return self.trace

    def start(self):
        self.previous_trace = sys.gettrace()
        sys.settrace(self.trace)

    def stop(self):
        sys.settrace(self.previous_trace)

    def serialize_value(self, value):
        return ValueSerializer(self.limits).serialize(value)

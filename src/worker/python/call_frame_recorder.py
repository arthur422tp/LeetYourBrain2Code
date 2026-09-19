import copy
import json

from tracer import _limit


class CallFrameRecorder:
    """Bounded storage for factual user-frame entry and exit updates."""

    _FLUSH_SIZE = 64

    def __init__(self, limits, session_id="session", emit_batch=None):
        self.limits = limits
        self.session_id = session_id
        self.emit_batch = emit_batch
        self.status = "complete"
        self.reason = None
        self.next_update_id = 1
        self.next_batch_id = 1
        self.pending_updates = []
        self.all_batches = []
        self.active_frames = set()
        self.active_frame_order = []
        self.terminal_frames = set()
        self.pending_exception_by_frame = {}
        self.event_count = 0
        self.byte_count = 0

    def _max_events(self):
        return max(0, int(_limit(
            self.limits, "max_call_frame_events", "maxCallFrameEvents", 20_000
        )))

    def _max_bytes(self):
        return max(0, int(_limit(
            self.limits, "max_call_frame_bytes", "maxCallFrameBytes", 2_000_000
        )))

    @staticmethod
    def _encoded_size(value):
        return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    def _accept_update(self, update):
        if self.status != "complete":
            return False
        if self.event_count + 1 > self._max_events():
            self.status = "truncated"
            self.reason = "call_frame_event_limit"
            return False
        try:
            update_size = self._encoded_size(update)
        except Exception:
            self.status = "truncated"
            self.reason = "call_frame_byte_limit"
            return False
        if self.byte_count + update_size > self._max_bytes():
            self.status = "truncated"
            self.reason = "call_frame_byte_limit"
            return False
        self.event_count += 1
        self.byte_count += update_size
        return True

    def _append(self, kind, **fields):
        update = {
            "update_id": self.next_update_id,
            "kind": kind,
            **fields,
        }
        if not self._accept_update(update):
            return False
        self.next_update_id += 1
        self.pending_updates.append(copy.deepcopy(update))
        if len(self.pending_updates) >= self._FLUSH_SIZE:
            self.flush()
        return True

    def frame_enter(
        self,
        frame_id,
        parent_frame_id,
        function_name,
        function_id=None,
        call_step=None,
        depth=None,
        arguments=None,
    ):
        if self.status != "complete" or frame_id in self.active_frames or frame_id in self.terminal_frames:
            return None
        if self._append(
            "frame_enter",
            frame_id=frame_id,
            parent_frame_id=parent_frame_id,
            function_name=function_name,
            **({"function_id": function_id} if function_id is not None else {}),
            call_step=call_step,
            depth=depth,
            arguments=copy.deepcopy(arguments or []),
        ):
            self.active_frames.add(frame_id)
            self.active_frame_order.append(frame_id)
        return None

    def exception_observed(self, frame_id, exception_snapshot):
        if self.status != "complete" or frame_id not in self.active_frames:
            return None
        if exception_snapshot is not None:
            self.pending_exception_by_frame[frame_id] = copy.deepcopy(exception_snapshot)
        return None

    def frame_resumed(self, frame_id):
        self.pending_exception_by_frame.pop(frame_id, None)

    def _mark_terminal(self, frame_id):
        self.active_frames.discard(frame_id)
        self.pending_exception_by_frame.pop(frame_id, None)
        self.terminal_frames.add(frame_id)

    def frame_return(self, frame_id, exit_step, value_snapshot):
        if self.status != "complete" or frame_id not in self.active_frames:
            return None
        self._append(
            "frame_return",
            frame_id=frame_id,
            exit_step=exit_step,
            value=copy.deepcopy(value_snapshot),
        )
        self._mark_terminal(frame_id)
        return None

    def frame_unwind(self, frame_id, exit_step):
        if self.status != "complete" or frame_id not in self.active_frames:
            return None
        exception_snapshot = self.pending_exception_by_frame.get(frame_id)
        if exception_snapshot is None:
            self._append(
                "frame_trace_ended",
                frame_id=frame_id,
                reason="unresolved_exception_unwind",
                exit_step=exit_step,
            )
        else:
            self._append(
                "frame_exception",
                frame_id=frame_id,
                exit_step=exit_step,
                exception=copy.deepcopy(exception_snapshot),
            )
        self._mark_terminal(frame_id)
        return None

    def finalize_active(self, reason, exit_step_by_frame=None):
        if self.status != "complete":
            return None
        exit_steps = exit_step_by_frame or {}
        for frame_id in reversed(self.active_frame_order):
            if frame_id not in self.active_frames:
                continue
            self._append(
                "frame_trace_ended",
                frame_id=frame_id,
                reason=reason,
                **({"exit_step": exit_steps[frame_id]} if frame_id in exit_steps else {}),
            )
            self._mark_terminal(frame_id)
        return None

    def flush(self):
        if not self.pending_updates:
            return None
        batch = {
            "batch_id": self.next_batch_id,
            "updates": copy.deepcopy(self.pending_updates),
        }
        self.next_batch_id += 1
        self.pending_updates.clear()
        self.all_batches.append(batch)
        if self.emit_batch is not None:
            try:
                self.emit_batch(
                    self.session_id,
                    json.dumps([batch], ensure_ascii=False, separators=(",", ":")),
                )
            except Exception:
                pass
        return None

    def result_batches(self):
        self.flush()
        return copy.deepcopy(self.all_batches)

    def tracing_state(self):
        return {
            "status": self.status,
            **({"reason": self.reason} if self.reason is not None else {}),
        }

    def result_dict(self):
        return {
            "call_frame_batches": self.result_batches(),
            "call_frame_tracing": self.tracing_state(),
        }

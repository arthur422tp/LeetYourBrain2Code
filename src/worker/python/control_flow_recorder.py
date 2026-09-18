import json
import sys

from tracer import _limit


class ControlFlowRecorder:
    def __init__(self, limits, session_id="session", emit_batch=None):
        self.limits = limits
        self.session_id = session_id
        self.emit_batch = emit_batch
        self.serializer_factory = None
        self.frame_id_for = None
        self.anchor_step_for = None
        self.next_batch_id = 1
        self.next_event_id = 1
        self.next_action_id = 1
        self.iteration_counts = {}
        self.active_loop_stacks = {}
        self.unresolved_transfers = {}
        self.natural_exit_seen = set()
        self.completed_batches = []
        self.control_flow_event_count = 0
        self.control_flow_bytes = 0
        self.status = "complete"
        self.reason = None

    def _max_events(self):
        return max(0, int(_limit(self.limits, "max_control_flow_events", "maxControlFlowEvents", 20_000)))

    def _max_bytes(self):
        return max(0, int(_limit(self.limits, "max_control_flow_bytes", "maxControlFlowBytes", 2_000_000)))

    @classmethod
    def _is_builtin_snapshot_value(cls, value, active_ids):
        value_type = type(value)
        if value_type in {type(None), bool, int, float, str}:
            return True
        if value_type not in {list, tuple, dict, set, frozenset}:
            return False
        value_id = id(value)
        if value_id in active_ids:
            return True
        active_ids.add(value_id)
        try:
            if value_type is dict:
                return all(
                    cls._is_builtin_snapshot_value(key, active_ids)
                    and cls._is_builtin_snapshot_value(item, active_ids)
                    for key, item in value.items()
                )
            return all(cls._is_builtin_snapshot_value(item, active_ids) for item in value)
        finally:
            active_ids.discard(value_id)

    def _serialize(self, value):
        if not self._is_builtin_snapshot_value(value, set()):
            return {
                "type": "unknown",
                "className": "unsupported",
                "repr": "<unsupported control-flow binding>",
            }
        try:
            serializer = self.serializer_factory() if self.serializer_factory is not None else None
            if serializer is None:
                return {"type": "unknown", "className": type(value).__name__, "repr": "<unavailable>"}
            if hasattr(serializer, "serialize"):
                return serializer.serialize(value)
            return serializer(value)
        except Exception:
            return {
                "type": "unknown",
                "className": "unsupported",
                "repr": "<unsupported control-flow binding>",
            }

    @staticmethod
    def _encoded_size(value):
        return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    def _current_frame_id(self):
        if self.frame_id_for is None:
            return None
        try:
            return self.frame_id_for(sys._getframe(2))
        except Exception:
            return None

    def _anchor(self, frame_id):
        if frame_id is None or self.anchor_step_for is None:
            return 1
        try:
            value = self.anchor_step_for(frame_id)
            return value if isinstance(value, int) and value > 0 else 1
        except Exception:
            return 1

    @staticmethod
    def _copy_context(stack):
        return {"loop_stack": [
            {"loop_id": item["loop_id"], "iteration": item["iteration"]}
            for item in stack
        ]}

    def current_execution_context(self, frame_id):
        if self.status != "complete":
            return None
        stack = self.active_loop_stacks.get(frame_id)
        if not stack:
            return None
        return self._copy_context(stack)

    def _event(self, frame_id, kind, **fields):
        return {
            "event_id": self.next_event_id,
            "anchor_step": self._anchor(frame_id),
            "frame_id": frame_id,
            "context": self._copy_context(self.active_loop_stacks.get(frame_id, [])),
            "kind": kind,
            **fields,
        }

    def _emit(self, events):
        if self.status != "complete" or not events:
            return
        accepted = []
        try:
            for event in events:
                if self.control_flow_event_count + 1 > self._max_events():
                    self.status = "truncated"
                    self.reason = "control_flow_event_limit"
                    break
                event_size = self._encoded_size(event)
                if self.control_flow_bytes + event_size > self._max_bytes():
                    self.status = "truncated"
                    self.reason = "control_flow_byte_limit"
                    break
                event["event_id"] = self.next_event_id
                self.next_event_id += 1
                self.control_flow_event_count += 1
                self.control_flow_bytes += event_size
                accepted.append(event)
            if not accepted:
                return
            batch = {"batch_id": self.next_batch_id, "events": accepted}
            self.next_batch_id += 1
            self.completed_batches.append(batch)
            if self.emit_batch is not None:
                try:
                    self.emit_batch(self.session_id, json.dumps([batch], ensure_ascii=False, separators=(",", ":")))
                except Exception:
                    pass
        except Exception:
            # Evidence must never change user semantics.
            return

    def _pop_active_loop(self, frame_id, loop_id):
        stack = self.active_loop_stacks.get(frame_id, [])
        if stack and stack[-1]["loop_id"] == loop_id:
            occurrence = stack.pop()
            if not stack:
                self.active_loop_stacks.pop(frame_id, None)
            return occurrence
        return None

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

    def iteration_begin(self, loop_id, loop_kind, binding_names, binding_values):
        if self.status != "complete":
            return None
        frame_id = self._current_frame_id()
        if frame_id is None:
            return None
        winner = self._resolve_loop_transfer(frame_id, loop_id, "continue")
        if winner is not None:
            self._pop_active_loop(frame_id, loop_id)
        key = (frame_id, loop_id)
        iteration = self.iteration_counts.get(key, 0) + 1
        self.iteration_counts[key] = iteration
        stack = self.active_loop_stacks.setdefault(frame_id, [])
        stack.append({"loop_id": loop_id, "loop_kind": loop_kind, "iteration": iteration})
        bindings = []
        if len(binding_names) == len(binding_values):
            for name, value in zip(binding_names, binding_values):
                bindings.append({"name": name, "value": self._serialize(value)})
        self._emit([self._event(
            frame_id,
            "iteration_begin",
            loop_id=loop_id,
            loop_kind=loop_kind,
            iteration=iteration,
            bindings=bindings,
        )])

    def iteration_complete(self, loop_id):
        if self.status != "complete":
            return None
        frame_id = self._current_frame_id()
        if frame_id is None:
            return None
        stack = self.active_loop_stacks.get(frame_id, [])
        if not stack or stack[-1]["loop_id"] != loop_id:
            return None
        iteration = stack[-1]["iteration"]
        self._emit([self._event(frame_id, "iteration_complete", loop_id=loop_id, iteration=iteration)])
        self._pop_active_loop(frame_id, loop_id)

    def _observe_transfer(self, frame_id, transfer_id, transfer_kind, target_loop_id=None):
        if self.status != "complete":
            return True
        if frame_id is None:
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
            "observed_context": self._copy_context(self.active_loop_stacks.get(frame_id, [])),
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

    def transfer_observed(self, transfer_id, transfer_kind, target_loop_id=None):
        return self._observe_transfer(
            self._current_frame_id(), transfer_id, transfer_kind, target_loop_id
        )

    def return_observed(self, transfer_id, value):
        self._observe_transfer(self._current_frame_id(), transfer_id, "return")
        return value

    def loop_natural_exit(self, loop_id, loop_kind):
        if self.status != "complete":
            return None
        frame_id = self._current_frame_id()
        if frame_id is None:
            return None
        winner = self._resolve_loop_transfer(frame_id, loop_id, "continue")
        if winner is not None:
            self._pop_active_loop(frame_id, loop_id)
        self._emit([self._event(
            frame_id,
            "loop_exit",
            loop_id=loop_id,
            loop_kind=loop_kind,
            reason="exhausted" if loop_kind == "for" else "condition_false",
        )])
        self.natural_exit_seen.add((frame_id, loop_id))

    def loop_after(self, loop_id, loop_kind):
        if self.status != "complete":
            return None
        frame_id = self._current_frame_id()
        if frame_id is None:
            return None
        marker = (frame_id, loop_id)
        if marker in self.natural_exit_seen:
            self.natural_exit_seen.discard(marker)
            return None
        winner = self._resolve_loop_transfer(frame_id, loop_id, "break")
        if winner is None:
            return None
        self._pop_active_loop(frame_id, loop_id)
        self._emit([self._event(frame_id, "loop_exit", loop_id=loop_id, loop_kind=loop_kind, reason="break")])

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
            self._emit_transfer_status(frame_id, action, "superseded", winner["action_id"])
        self.unresolved_transfers.pop(frame_id, None)
        return winner

    def _interrupt_frame(self, frame_id):
        ledger = self.unresolved_transfers.pop(frame_id, [])
        for action in ledger:
            self._emit_transfer_status(frame_id, action, "interrupted")

    def on_frame_return(self, frame_id, anchor_step):
        if self.status != "complete":
            return None
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

    def _finalize(self, reason):
        if self.status != "complete":
            return
        for frame_id in list(self.unresolved_transfers):
            self._interrupt_frame(frame_id)
        for frame_id, stack in list(self.active_loop_stacks.items()):
            for occurrence in reversed(stack):
                self._emit([self._event(
                    frame_id,
                    "loop_exit",
                    loop_id=occurrence["loop_id"],
                    loop_kind=occurrence["loop_kind"],
                    reason=reason,
                )])
        self.active_loop_stacks.clear()

    def finalize_exception(self):
        self._finalize("exception")

    def finalize_trace_ended(self):
        self._finalize("trace_ended")

    def result_dict(self):
        return {
            "control_flow_batches": self.completed_batches,
            "control_flow_tracing": {
                "status": self.status,
                **({"reason": self.reason} if self.reason is not None else {}),
            },
        }

import builtins
import json
import math

from tracer import _limit


_ORIGINAL_MIN = builtins.min
_ORIGINAL_MAX = builtins.max


class ExpressionRecorder:
    def __init__(self, limits, serializer_factory, session_id="session", emit_batch=None):
        self.limits = limits
        self.serializer_factory = serializer_factory
        self.session_id = session_id
        self.emit_batch = emit_batch
        self.active_anchors = {}
        self.pending_roots = {}
        self.completed_batches = []
        self.next_evaluation_id = 1
        self.next_batch_id = 1
        self.expression_event_count = 0
        self.expression_bytes = 0
        self.status = "complete"
        self.reason = None
        self.frame_id_for = None
        self.root_expression_ids = {}

    def _max_events(self):
        return max(0, int(_limit(
            self.limits, "max_expression_events", "maxExpressionEvents", 20_000
        )))

    def _max_bytes(self):
        return max(0, int(_limit(
            self.limits, "max_expression_bytes", "maxExpressionBytes", 2_000_000
        )))

    def _serialize(self, value):
        if not self._is_builtin_snapshot_value(value, set()):
            return {
                "type": "unknown",
                "className": "unsupported",
                "repr": "<unsupported expression value>",
            }
        serializer = self.serializer_factory()
        return serializer.serialize(value) if hasattr(serializer, "serialize") else serializer(value)

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

    @staticmethod
    def _encoded_size(value):
        return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    def _accept_evaluation(self, snapshot):
        if self.status != "complete":
            return False
        if self.expression_event_count + 1 > self._max_events():
            self.status = "truncated"
            self.reason = "expression_event_limit"
            return False
        snapshot_size = self._encoded_size(snapshot)
        if self.expression_bytes + snapshot_size > self._max_bytes():
            self.status = "truncated"
            self.reason = "expression_byte_limit"
            return False
        self.expression_event_count += 1
        self.expression_bytes += snapshot_size
        return True

    def set_anchor(self, frame_id, step, line):
        if self.status == "complete":
            self.active_anchors[frame_id] = {"step": step, "line": line}

    def _root_for(self, frame_id, root_id):
        anchor = self.active_anchors.get(frame_id)
        if anchor is None:
            return None
        key = (frame_id, anchor["step"], root_id)
        if key not in self.pending_roots:
            self.pending_roots[key] = {
                "root_id": root_id,
                "status": "partial",
                "evaluations": [],
            }
        return self.pending_roots[key]

    def record_value(self, root_id, expr_id, value):
        if self.status != "complete":
            return value
        frame_id = self._current_frame_id()
        root = self._root_for(frame_id, root_id) if frame_id is not None else None
        if root is None:
            return value
        try:
            snapshot = self._serialize(value)
        except Exception:
            return value
        if not self._accept_evaluation(snapshot):
            return value
        root["evaluations"].append({
            "evaluation_id": self.next_evaluation_id,
            "expr_id": expr_id,
            "order": len(root["evaluations"]) + 1,
            "value": snapshot,
        })
        self.next_evaluation_id += 1
        if self.root_expression_ids.get(root_id) == expr_id:
            root["result_expr_id"] = expr_id
            root["status"] = "completed"
        return value

    def _current_frame_id(self):
        if self.frame_id_for is None:
            return None
        try:
            import sys
            return self.frame_id_for(sys._getframe(2))
        except Exception:
            return None

    def record_minmax_call(
        self,
        root_id,
        call_expr_id,
        function_obj,
        candidate_expr_ids,
        candidate_values,
        function_name=None,
    ):
        result = function_obj(*candidate_values)
        if self.status != "complete":
            return result
        frame_id = self._current_frame_id()
        root = self._root_for(frame_id, root_id) if frame_id is not None else None
        if root is None:
            return result
        try:
            result_snapshot = self._serialize(result)
            candidate_snapshots = [self._serialize(value) for value in candidate_values]
        except Exception:
            return result
        self._record_selection(
            root_id,
            call_expr_id,
            function_obj,
            candidate_expr_ids,
            result_snapshot,
            candidate_snapshots,
            root,
            function_name,
        )
        return result

    def _record_selection(
        self,
        root_id,
        call_expr_id,
        function_obj,
        candidate_expr_ids,
        result_snapshot,
        candidate_snapshots,
        root,
        function_name=None,
    ):
        status = "unsupported_call_shape"
        selected_index = None
        function = None
        if function_name == "min" and function_obj is _ORIGINAL_MIN:
            function = "min"
        elif function_name == "max" and function_obj is _ORIGINAL_MAX:
            function = "max"
        elif function_name not in {"min", "max"}:
            function = "min" if function_obj is _ORIGINAL_MIN else "max" if function_obj is _ORIGINAL_MAX else None
        if function is not None and len(candidate_expr_ids) >= 2 and len(candidate_expr_ids) == len(candidate_snapshots):
            if all(self._is_safe_snapshot(snapshot) for snapshot in candidate_snapshots) and self._is_safe_snapshot(result_snapshot):
                status = "resolved"
                for index, candidate in enumerate(candidate_snapshots):
                    if candidate == result_snapshot:
                        selected_index = index
                        break
                if selected_index is None:
                    status = "ambiguous"
            else:
                status = "unsupported_value"
        root.setdefault("selection_evidence", []).append({
            "call_expr_id": call_expr_id,
            "function": function_name if function_name in {"min", "max"} else function or "min",
            "candidate_expr_ids": candidate_expr_ids,
            "result": result_snapshot,
            "selected_candidate_index": selected_index,
            "status": status,
        })

    @staticmethod
    def _is_safe_snapshot(snapshot):
        if snapshot.get("type") in {"int", "bool", "str"}:
            return True
        return snapshot.get("type") == "float" and isinstance(snapshot.get("value"), float) and math.isfinite(snapshot["value"])

    def flush_frame(self, frame_id):
        anchor = self.active_anchors.pop(frame_id, None)
        if anchor is None:
            return
        roots = []
        for key in list(self.pending_roots):
            if key[0] == frame_id and key[1] == anchor["step"]:
                roots.append(self.pending_roots.pop(key))
        if not roots:
            return
        batch = {
            "batch_id": self.next_batch_id,
            "anchor_step": anchor["step"],
            "frame_id": frame_id,
            "line": anchor["line"],
            "roots": roots,
        }
        self.completed_batches.append(batch)
        self.next_batch_id += 1
        if self.emit_batch is not None:
            try:
                self.emit_batch(
                    self.session_id,
                    json.dumps([batch], ensure_ascii=False, separators=(",", ":")),
                )
            except Exception:
                pass

    def flush_all(self):
        for frame_id in list(self.active_anchors):
            self.flush_frame(frame_id)

    def result_dict(self):
        return {
            "expression_batches": self.completed_batches,
            "expression_tracing": {
                "status": self.status,
                **({"reason": self.reason} if self.reason is not None else {}),
            },
        }

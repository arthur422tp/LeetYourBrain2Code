import json
import sys

from tracer import _limit


class DecisionRecorder:
    def __init__(self, limits, serializer_factory, session_id="session", emit_batch=None):
        self.limits = limits
        self.serializer_factory = serializer_factory
        self.session_id = session_id
        self.emit_batch = emit_batch
        self.active_anchors = {}
        self.active_occurrences = {}
        self.occurrence_counts = {}
        self.completed_batches = []
        self.next_batch_id = 1
        self.decision_event_count = 0
        self.decision_bytes = 0
        self.status = "complete"
        self.reason = None
        self.frame_id_for = None

    def _max_events(self):
        return max(0, int(_limit(
            self.limits, "max_decision_events", "maxDecisionEvents", 20_000
        )))

    def _max_bytes(self):
        return max(0, int(_limit(
            self.limits, "max_decision_bytes", "maxDecisionBytes", 2_000_000
        )))

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
                "repr": "<unsupported decision value>",
            }
        serializer = self.serializer_factory()
        if hasattr(serializer, "serialize"):
            return serializer.serialize(value)
        return serializer(value)

    @staticmethod
    def _encoded_size(value):
        return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    def _accept_event(self, value):
        if self.status != "complete":
            return False
        if self.decision_event_count + 1 > self._max_events():
            self.status = "truncated"
            self.reason = "decision_event_limit"
            return False
        value_size = self._encoded_size(value)
        if self.decision_bytes + value_size > self._max_bytes():
            self.status = "truncated"
            self.reason = "decision_byte_limit"
            return False
        self.decision_event_count += 1
        self.decision_bytes += value_size
        return True

    def set_anchor(self, frame_id, step, line):
        if self.status == "complete":
            self.active_anchors[frame_id] = {"step": step, "line": line}

    def _current_frame_id(self, extra_depth=0):
        if self.frame_id_for is None:
            return None
        try:
            return self.frame_id_for(sys._getframe(2 + extra_depth))
        except Exception:
            return None

    def _active_occurrence(self, site_id):
        frame_id = self._current_frame_id(1)
        if frame_id is None:
            return None
        return self.active_occurrences.get((frame_id, site_id))

    def begin(self, site_id, root_condition_id):
        frame_id = self._current_frame_id()
        if frame_id is None:
            return True
        anchor = self.active_anchors.get(frame_id)
        if anchor is None:
            return True
        key = (frame_id, site_id)
        occurrence = self.occurrence_counts.get(key, 0) + 1
        self.occurrence_counts[key] = occurrence
        self.active_occurrences[key] = {
            "frame_id": frame_id,
            "site_id": site_id,
            "root_condition_id": root_condition_id,
            "occurrence": occurrence,
            "anchor": anchor,
            "status": "partial",
            "evaluations": [],
            "condition_results": [],
            "truth": None,
        }
        return True

    def record_operand(self, site_id, condition_id, operand_id, value):
        occurrence = self._active_occurrence(site_id)
        if occurrence is None or self.status != "complete":
            return value
        try:
            snapshot = self._serialize(value)
        except Exception:
            return value
        if self._accept_event(snapshot):
            occurrence["evaluations"].append({
                "operand_id": operand_id,
                "order": len(occurrence["evaluations"]) + 1,
                "value": snapshot,
            })
        return value

    def record_truth(self, site_id, condition_id, value):
        truth = bool(value)
        occurrence = self._active_occurrence(site_id)
        if occurrence is not None and self.status == "complete":
            result = {
                "condition_id": condition_id,
                "order": len(occurrence["condition_results"]) + 1,
                "truth": truth,
            }
            if self._accept_event(result):
                occurrence["condition_results"].append(result)
        return truth

    def complete(self, site_id, site_kind, root_condition_id, truth):
        occurrence = self._active_occurrence(site_id)
        if occurrence is not None and self.status == "complete":
            results = occurrence["condition_results"]
            if not results or results[-1]["condition_id"] != root_condition_id:
                result = {
                    "condition_id": root_condition_id,
                    "order": len(results) + 1,
                    "truth": truth is True,
                }
                if self._accept_event(result):
                    results.append(result)
            occurrence["truth"] = truth is True
            occurrence["site_kind"] = site_kind
            occurrence["status"] = "complete"
        return truth

    def flush_frame(self, frame_id):
        self.active_anchors.pop(frame_id, None)
        keys = [key for key in self.active_occurrences if key[0] == frame_id]
        for key in keys:
            occurrence = self.active_occurrences.pop(key)
            condition = {
                "condition_id": occurrence["root_condition_id"],
                "evaluations": occurrence["evaluations"],
                "condition_results": occurrence["condition_results"],
            }
            if occurrence["truth"] is not None:
                condition["truth"] = occurrence["truth"]
            batch = {
                "batch_id": self.next_batch_id,
                "anchor_step": occurrence["anchor"]["step"],
                "frame_id": frame_id,
                "site_id": occurrence["site_id"],
                "occurrence": occurrence["occurrence"],
                "status": "completed" if occurrence["status"] == "complete" else "partial",
                "condition": condition,
            }
            if occurrence["status"] == "complete":
                if occurrence.get("site_kind") == "while":
                    batch["outcome"] = "loop_body_entered" if occurrence["truth"] is True else "loop_exited"
                else:
                    batch["outcome"] = "branch_entered" if occurrence["truth"] is True else "branch_not_entered"
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
            "decision_batches": self.completed_batches,
            "decision_tracing": {
                "status": self.status,
                **({"reason": self.reason} if self.reason is not None else {}),
            },
        }

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from decision_recorder import DecisionRecorder
from runner import run_request


LIMITS = {
    "max_decision_events": 100,
    "max_decision_bytes": 10_000,
}


def snapshot(value):
    if value is None:
        return {"type": "none", "value": None}
    if isinstance(value, bool):
        return {"type": "bool", "value": value}
    if isinstance(value, int):
        return {"type": "int", "value": str(value)}
    return {"type": "str", "value": str(value), "length": len(str(value)), "truncated": False}


class DecisionRecorderTests(unittest.TestCase):
    def recorder(self, limits=None):
        recorder = DecisionRecorder(limits or LIMITS, lambda: snapshot)
        recorder.frame_id_for = lambda _frame: 1
        recorder.set_anchor(1, 4, 7)
        return recorder

    def test_flushes_completed_if_with_root_truth_and_outcome(self):
        recorder = self.recorder()

        self.assertTrue(recorder.begin("d1", "d1.c0"))
        self.assertFalse(recorder.record_truth("d1", "d1.c0", 0))
        self.assertFalse(recorder.complete("d1", "if", "d1.c0", False))

        recorder.flush_frame(1)
        batch = recorder.completed_batches[0]
        self.assertEqual(batch["status"], "completed")
        self.assertEqual(batch["occurrence"], 1)
        self.assertEqual(batch["outcome"], "branch_not_entered")
        self.assertEqual(batch["condition"]["condition_results"], [
            {"condition_id": "d1.c0", "order": 1, "truth": False},
        ])
        self.assertIs(batch["condition"]["truth"], False)

    def test_records_child_truths_in_order_and_adds_root_once_on_completion(self):
        recorder = self.recorder()

        recorder.begin("d1", "d1.c0")
        self.assertTrue(recorder.record_truth("d1", "d1.c0.0", True))
        self.assertFalse(recorder.record_truth("d1", "d1.c0.1", False))
        self.assertFalse(recorder.complete("d1", "if", "d1.c0", False))
        recorder.flush_all()

        self.assertEqual(
            recorder.completed_batches[0]["condition"]["condition_results"],
            [
                {"condition_id": "d1.c0.0", "order": 1, "truth": True},
                {"condition_id": "d1.c0.1", "order": 2, "truth": False},
                {"condition_id": "d1.c0", "order": 3, "truth": False},
            ],
        )

    def test_uncompleted_occurrence_is_partial_without_fabricated_outcome(self):
        recorder = self.recorder()
        recorder.begin("d1", "d1.c0")
        recorder.record_truth("d1", "d1.c0.0", True)
        recorder.flush_all()

        batch = recorder.completed_batches[0]
        self.assertEqual(batch["status"], "partial")
        self.assertNotIn("outcome", batch)

    def test_truth_exception_does_not_append_a_result(self):
        recorder = self.recorder()
        recorder.begin("d1", "d1.c0")

        class Exploding:
            def __bool__(self):
                raise RuntimeError("boom")

        with self.assertRaisesRegex(RuntimeError, "boom"):
            recorder.record_truth("d1", "d1.c0", Exploding())
        recorder.flush_all()
        self.assertEqual(recorder.completed_batches[0]["condition"]["condition_results"], [])

    def test_occurrences_are_independent_per_frame_and_site(self):
        recorder = DecisionRecorder(LIMITS, lambda: snapshot)
        recorder.frame_id_for = lambda frame: 10 if frame.f_code.co_name == "first" else 20

        def first():
            recorder.set_anchor(10, 10, 1)
            recorder.begin("d1", "d1.c0")
            recorder.complete("d1", "while", "d1.c0", True)
            recorder.flush_frame(10)

        def second():
            recorder.set_anchor(20, 20, 1)
            recorder.begin("d1", "d1.c0")
            recorder.complete("d1", "while", "d1.c0", True)
            recorder.flush_frame(20)

        first()
        first()
        second()
        self.assertEqual([batch["occurrence"] for batch in recorder.completed_batches], [1, 2, 1])
        self.assertEqual([batch["frame_id"] for batch in recorder.completed_batches], [10, 10, 20])

    def test_soft_event_limit_preserves_user_result_and_marks_tracing_truncated(self):
        recorder = self.recorder({"max_decision_events": 0, "max_decision_bytes": 10_000})
        recorder.begin("d1", "d1.c0")
        self.assertEqual(recorder.record_operand("d1", "d1.c0", "d1.c0.o0", 3), 3)
        self.assertEqual(recorder.status, "truncated")
        self.assertEqual(recorder.reason, "decision_event_limit")
        self.assertTrue(recorder.record_truth("d1", "d1.c0", True))

    def test_runner_records_a_decision_batch_with_the_authoritative_trace_anchor(self):
        result = run_request(
            """class Solution:
    def choose(self, value):
        if value:
            return 1
        return 0
""",
            "0",
            {"class_name": "Solution", "method_name": "choose", "parameter_count": 1},
            {
                **LIMITS,
                "max_trace_steps": 100,
                "max_session_bytes": 100_000,
                "max_stdout_bytes": 1_000,
                "max_snapshot_bytes": 10_000,
            },
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(len(result["decision_batches"]), 1)
        batch = result["decision_batches"][0]
        self.assertEqual(batch["site_id"], "d1")
        self.assertEqual(batch["anchor_step"], next(
            event["step"] for event in result["events"] if event["line"] == 3
        ))
        self.assertEqual(batch["condition"]["condition_results"][-1]["truth"], False)
        self.assertEqual(batch["outcome"], "branch_not_entered")


if __name__ == "__main__":
    unittest.main()

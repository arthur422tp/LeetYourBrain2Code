import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from control_flow_recorder import ControlFlowRecorder
from runner import run_request


LIMITS = {
    "max_trace_steps": 500,
    "max_session_bytes": 200_000,
    "max_stdout_bytes": 10_000,
    "max_snapshot_bytes": 20_000,
    "max_expression_events": 500,
    "max_expression_bytes": 100_000,
    "max_decision_events": 500,
    "max_decision_bytes": 100_000,
    "max_control_flow_events": 500,
    "max_control_flow_bytes": 100_000,
}


class ControlFlowRecorderTests(unittest.TestCase):
    def make_recorder(self):
        recorder = ControlFlowRecorder({"max_control_flow_events": 100, "max_control_flow_bytes": 100_000})
        recorder.frame_id_for = lambda _frame: 7
        recorder.anchor_step_for = lambda _frame_id: 10
        recorder.serializer_factory = lambda: lambda value: {"type": "int", "value": str(value)}
        return recorder

    def events(self, recorder):
        return [event for batch in recorder.completed_batches for event in batch["events"]]

    def status_by_action(self, recorder):
        return {
            event["action_id"]: event["status"]
            for event in self.events(recorder)
            if event["kind"] == "transfer_status"
        }

    def test_records_iteration_lifecycle_and_context(self):
        recorder = self.make_recorder()
        recorder.iteration_begin("f1", "for", ("x",), (7,))
        self.assertEqual(recorder.current_execution_context(7), {"loop_stack": [{"loop_id": "f1", "iteration": 1}]})
        recorder.iteration_complete("f1")
        self.assertIsNone(recorder.current_execution_context(7))
        recorder.loop_natural_exit("f1", "for")
        recorder.loop_after("f1", "for")

        self.assertEqual([event["kind"] for event in self.events(recorder)], ["iteration_begin", "iteration_complete", "loop_exit"])
        self.assertEqual(self.events(recorder)[0]["bindings"], [{"name": "x", "value": {"type": "int", "value": "7"}}])
        self.assertEqual(self.events(recorder)[-1]["reason"], "exhausted")

    def test_same_loop_continue_supersedes_older_break_when_next_iteration_begins(self):
        recorder = self.make_recorder()
        recorder.iteration_begin("f1", "for", (), ())
        recorder.transfer_observed("t_break", "break", "f1")
        recorder.transfer_observed("t_continue", "continue", "f1")
        recorder.iteration_begin("f1", "for", (), ())
        self.assertEqual(self.status_by_action(recorder), {"a1": "superseded", "a2": "committed"})

    def test_inner_break_commits_without_superseding_outer_return(self):
        recorder = self.make_recorder()

        self.assertEqual(recorder.return_observed("t_return", 1), 1)
        recorder.iteration_begin("f2", "for", (), ())
        recorder.transfer_observed("t_inner_break", "break", "f2")
        recorder.loop_after("f2", "for")
        recorder.on_frame_return(7, 20)

        self.assertEqual(self.status_by_action(recorder), {"a1": "committed", "a2": "committed"})

    def test_outer_break_survives_inner_break_until_outer_boundary(self):
        recorder = self.make_recorder()

        recorder.iteration_begin("f1", "for", (), ())
        recorder.transfer_observed("t_outer_break", "break", "f1")
        recorder.iteration_begin("f2", "for", (), ())
        recorder.transfer_observed("t_inner_break", "break", "f2")

        recorder.loop_after("f2", "for")
        self.assertNotIn("a1", self.status_by_action(recorder))

        recorder.loop_after("f1", "for")
        self.assertEqual(self.status_by_action(recorder), {"a1": "committed", "a2": "committed"})

    def test_same_loop_break_supersedes_older_continue_at_loop_after(self):
        recorder = self.make_recorder()

        recorder.iteration_begin("f1", "for", (), ())
        recorder.transfer_observed("t_continue", "continue", "f1")
        recorder.transfer_observed("t_break", "break", "f1")
        recorder.loop_after("f1", "for")

        self.assertEqual(self.status_by_action(recorder), {"a1": "superseded", "a2": "committed"})

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

        self.assertEqual(self.status_by_action(recorder), {"a1": "committed", "a2": "committed"})

    def test_outer_continue_supersedes_return_when_next_outer_iteration_begins(self):
        recorder = self.make_recorder()

        recorder.iteration_begin("f1", "for", (), ())
        self.assertEqual(recorder.return_observed("t_return", 1), 1)
        recorder.transfer_observed("t_continue", "continue", "f1")
        recorder.iteration_begin("f1", "for", (), ())

        self.assertEqual(self.status_by_action(recorder), {"a1": "superseded", "a2": "committed"})

    def test_frame_return_supersedes_older_break(self):
        recorder = self.make_recorder()

        recorder.iteration_begin("f1", "for", (), ())
        recorder.transfer_observed("t_break", "break", "f1")
        self.assertEqual(recorder.return_observed("t_return", 2), 2)
        recorder.on_frame_return(7, 20)

        self.assertEqual(self.status_by_action(recorder), {"a1": "superseded", "a2": "committed"})

    def test_return_override_commits_only_the_final_return(self):
        recorder = self.make_recorder()
        self.assertIsNone(recorder.return_observed("t1", None))
        self.assertEqual(recorder.return_observed("t2", 2), 2)
        recorder.on_frame_return(7, 11)
        statuses = [
            (event["action_id"], event["status"])
            for event in self.events(recorder)
            if event["kind"] == "transfer_status"
        ]
        self.assertEqual(statuses, [("a2", "committed"), ("a1", "superseded")])

    def test_exception_finalization_interrupts_pending_return_and_active_loop(self):
        recorder = self.make_recorder()
        recorder.iteration_begin("f1", "while", (), ())
        recorder.return_observed("t1", None)
        recorder.finalize_exception()
        events = self.events(recorder)
        self.assertEqual([(event["kind"], event.get("status")) for event in events[-2:]], [
            ("transfer_status", "interrupted"),
            ("loop_exit", None),
        ])
        self.assertEqual(events[-1]["reason"], "exception")

    def test_normal_bare_return_commits_from_normal_return_opcode(self):
        result = run_request(
            """class Solution:
    def solve(self):
        return None
""",
            "",
            {"class_name": "Solution", "method_name": "solve", "parameter_count": 0},
            LIMITS,
        )
        events = [event for batch in result["control_flow_batches"] for event in batch["events"]]
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["return_value"], {"type": "none", "value": None})
        self.assertIn(("transfer_status", "committed"), [(event["kind"], event.get("status")) for event in events])

    def test_exception_unwind_does_not_commit_return_none(self):
        result = run_request(
            """class Solution:
    def solve(self):
        try:
            return None
        finally:
            raise ValueError("boom")
""",
            "",
            {"class_name": "Solution", "method_name": "solve", "parameter_count": 0},
            LIMITS,
        )
        events = [event for batch in result["control_flow_batches"] for event in batch["events"]]
        statuses = [event["status"] for event in events if event["kind"] == "transfer_status"]
        self.assertEqual(result["status"], "exception")
        self.assertNotIn("committed", statuses)
        self.assertIn("interrupted", statuses)

    def test_caught_exception_in_finally_preserves_original_return(self):
        result = run_request(
            """class Solution:
    def solve(self):
        try:
            return None
        finally:
            try:
                1 / 0
            except ZeroDivisionError:
                pass
""",
            "",
            {"class_name": "Solution", "method_name": "solve", "parameter_count": 0},
            LIMITS,
        )
        events = [event for batch in result["control_flow_batches"] for event in batch["events"]]
        statuses = [event["status"] for event in events if event["kind"] == "transfer_status"]
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["return_value"], {"type": "none", "value": None})
        self.assertEqual(statuses, ["committed"])

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
        statuses = {
            event["action_id"]: event["status"]
            for event in events
            if event["kind"] == "transfer_status"
        }
        first_return = next(event for event in observed if event["transfer_kind"] == "return")
        committed_break = next(event for event in observed if event["transfer_kind"] == "break")

        self.assertEqual(result["return_value"], {"type": "int", "value": "2"})
        self.assertEqual(statuses[first_return["action_id"]], "superseded")
        self.assertEqual(statuses[committed_break["action_id"]], "committed")


if __name__ == "__main__":
    unittest.main()

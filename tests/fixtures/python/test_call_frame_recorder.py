import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from call_frame_recorder import CallFrameRecorder


NONE = {"type": "none", "value": None}
EXCEPTION = {
    "type": "ValueError",
    "message": "boom",
    "line": 4,
    "stack": ["frame"],
    "frame_id": 2,
}


class CallFrameRecorderTests(unittest.TestCase):
    def make_recorder(self, **limits):
        return CallFrameRecorder({
            "max_call_frame_events": 20_000,
            "max_call_frame_bytes": 2_000_000,
            **limits,
        })

    @staticmethod
    def updates(recorder):
        return [
            update
            for batch in recorder.result_batches()
            for update in batch["updates"]
        ]

    def enter(self, recorder, frame_id=2, parent_frame_id=1):
        recorder.frame_enter(
            frame_id=frame_id,
            parent_frame_id=parent_frame_id,
            function_name="depth",
            function_id="fn2",
            call_step=7,
            depth=2,
            arguments=[{"name": "node", "kind": "positional_or_keyword", "value": NONE}],
        )

    def test_frame_entry_preserves_runtime_identity_and_bound_arguments(self):
        recorder = self.make_recorder()

        self.enter(recorder)

        self.assertEqual(self.updates(recorder), [{
            "update_id": 1,
            "kind": "frame_enter",
            "frame_id": 2,
            "parent_frame_id": 1,
            "function_name": "depth",
            "function_id": "fn2",
            "call_step": 7,
            "depth": 2,
            "arguments": [{"name": "node", "kind": "positional_or_keyword", "value": NONE}],
        }])

    def test_normal_return_is_terminal_and_duplicate_returns_are_ignored(self):
        recorder = self.make_recorder()
        self.enter(recorder)

        recorder.frame_return(2, 12, {"type": "int", "value": "1"})
        recorder.frame_return(2, 13, {"type": "int", "value": "2"})

        updates = self.updates(recorder)
        self.assertEqual([update["kind"] for update in updates], ["frame_enter", "frame_return"])
        self.assertEqual(updates[-1]["value"], {"type": "int", "value": "1"})

    def test_handled_exception_is_cleared_before_normal_return(self):
        recorder = self.make_recorder()
        self.enter(recorder)

        recorder.exception_observed(2, EXCEPTION)
        recorder.frame_resumed(2)
        recorder.frame_return(2, 12, NONE)

        self.assertEqual([update["kind"] for update in self.updates(recorder)], [
            "frame_enter",
            "frame_return",
        ])

    def test_unwinding_exception_emits_exception_terminal_update(self):
        recorder = self.make_recorder()
        self.enter(recorder)

        recorder.exception_observed(2, EXCEPTION)
        recorder.frame_unwind(2, 12)

        update = self.updates(recorder)[-1]
        self.assertEqual(update["kind"], "frame_exception")
        self.assertEqual(update["exit_step"], 12)
        self.assertEqual(update["exception"], EXCEPTION)

    def test_event_limit_truncates_without_raising_or_emitting_later_updates(self):
        recorder = self.make_recorder(max_call_frame_events=1)

        self.enter(recorder)
        recorder.frame_return(2, 12, NONE)
        recorder.exception_observed(2, EXCEPTION)
        recorder.frame_unwind(2, 13)
        recorder.finalize_active("trace_limit")

        self.assertEqual([update["kind"] for update in self.updates(recorder)], ["frame_enter"])
        self.assertEqual(recorder.tracing_state(), {
            "status": "truncated",
            "reason": "call_frame_event_limit",
        })

    def test_finalize_active_frames_only_and_preserves_terminal_frames(self):
        recorder = self.make_recorder()
        self.enter(recorder, frame_id=1, parent_frame_id=None)
        self.enter(recorder, frame_id=2, parent_frame_id=1)
        recorder.frame_return(2, 12, NONE)
        recorder.frame_enter(
            frame_id=3,
            parent_frame_id=1,
            function_name="helper",
            function_id="fn3",
            call_step=13,
            depth=2,
            arguments=[],
        )

        recorder.finalize_active("timeout", {1: 15, 3: 16})

        updates = self.updates(recorder)
        self.assertEqual([update["kind"] for update in updates], [
            "frame_enter",
            "frame_enter",
            "frame_return",
            "frame_enter",
            "frame_trace_ended",
            "frame_trace_ended",
        ])
        ended = [update for update in updates if update["kind"] == "frame_trace_ended"]
        self.assertEqual([(item["frame_id"], item["exit_step"]) for item in ended], [(3, 16), (1, 15)])

    def test_byte_limit_can_use_camel_case_request_key(self):
        recorder = CallFrameRecorder({"maxCallFrameEvents": 20_000, "maxCallFrameBytes": 1})

        self.enter(recorder)

        self.assertEqual(recorder.tracing_state(), {
            "status": "truncated",
            "reason": "call_frame_byte_limit",
        })
        self.assertEqual(self.updates(recorder), [])


if __name__ == "__main__":
    unittest.main()

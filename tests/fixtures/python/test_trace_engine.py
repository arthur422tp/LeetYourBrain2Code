import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from runner import run_request


LIMITS = {
    "max_trace_steps": 200,
    "max_container_items": 20,
    "max_nesting_depth": 8,
    "max_snapshot_bytes": 20_000,
    "max_session_bytes": 100_000,
    "max_stdout_bytes": 2_000,
}


def request(source: str, method_name: str, parameter_count: int, testcase: str) -> dict:
    return run_request(
        source,
        testcase,
        {
            "class_name": "Solution",
            "method_name": method_name,
            "parameter_count": parameter_count,
        },
        LIMITS,
    )


def function_events(result: dict, function_name: str) -> list[dict]:
    return [event for event in result["events"] if event["function"] == function_name]


def test_line_trace_records_call_lines_and_return_with_pre_line_locals():
    result = request(
        """class Solution:
    def f(self, x):
        y = x + 1
        return y
""",
        "f",
        1,
        "2",
    )

    events = function_events(result, "f")
    assert [event["event"] for event in events] == ["call", "line", "line", "return"]
    assert events[1]["line"] == 3
    assert events[1]["locals"]["x"] == {"type": "int", "value": "2"}
    assert "y" not in events[1]["locals"]
    assert events[2]["locals"]["y"] == {"type": "int", "value": "3"}
    assert result["status"] == "completed"


def test_recursive_calls_receive_distinct_monotonic_frame_ids():
    result = request(
        """class Solution:
    def f(self, n):
        if n == 0:
            return 0
        return self.f(n - 1)
""",
        "f",
        1,
        "3",
    )

    call_events = [event for event in function_events(result, "f") if event["event"] == "call"]
    frame_ids = [event["frame_id"] for event in call_events]
    assert len(frame_ids) == 4
    assert len(set(frame_ids)) == 4
    assert frame_ids == sorted(frame_ids)
    assert call_events[0]["parent_frame_id"] is None
    assert [event["parent_frame_id"] for event in call_events[1:]] == frame_ids[:-1]
    assert [event["call_depth"] for event in call_events] == [1, 2, 3, 4]


def test_unhandled_exception_preserves_exception_event_and_trace_prefix():
    result = request(
        """class Solution:
    def f(self, values):
        return values[4]
""",
        "f",
        1,
        "[1]",
    )

    assert result["status"] == "exception"
    assert result["termination_reason"] == "runtime_exception"
    exception_events = [event for event in result["events"] if event["event"] == "exception"]
    assert exception_events
    assert exception_events[-1]["event_payload"]["exception"]["type"] == "IndexError"
    assert any(event["event"] == "line" for event in result["events"])


def test_trace_step_limit_stops_execution_and_keeps_prefix():
    limits = {**LIMITS, "max_trace_steps": 4}
    result = run_request(
        """class Solution:
    def loop(self):
        while True:
            pass
""",
        "",
        {"class_name": "Solution", "method_name": "loop", "parameter_count": 0},
        limits,
    )

    assert result["status"] == "trace_limit"
    assert result["termination_reason"] == "step_limit"
    assert 0 < len(result["events"]) <= 4


def test_syntax_error_has_no_execution_trace():
    result = request("class Solution:\n    def broken(self, :\n        pass", "broken", 0, "")

    assert result["status"] == "parse_error"
    assert result["termination_reason"] == "syntax_error"
    assert result["events"] == []


def test_runtime_baseline_globals_are_not_copied_into_user_module_snapshots():
    source = "class Solution:\n    def one(self):\n        return List\n"
    result = run_request(
        source,
        "",
        {"class_name": "Solution", "method_name": "one", "parameter_count": 0},
        LIMITS,
        runtime_globals={"List": "prelude value"},
    )

    module_events = [event for event in result["events"] if event["function"] == "<module>"]
    assert module_events
    assert "List" not in module_events[0]["locals"]
    assert "__builtins__" not in module_events[0]["locals"]

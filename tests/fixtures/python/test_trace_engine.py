import sys
import json
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from runner import run_request
import runtime_prelude
from runtime_prelude import TreeNode


LIMITS = {
    "max_trace_steps": 200,
    "max_container_items": 20,
    "max_nesting_depth": 8,
    "max_snapshot_bytes": 20_000,
    "max_session_bytes": 100_000,
    "max_stdout_bytes": 2_000,
    "max_object_nodes": 200,
    "max_object_attributes": 20,
    "max_object_depth": 32,
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


def test_two_sum_normal_case_returns_result_without_line_offset():
    result = request(
        """class Solution:
    def twoSum(self, numbers, target):
        for index, value in enumerate(numbers):
            for other in range(index + 1, len(numbers)):
                if value + numbers[other] == target:
                    return [index, other]
        return []
""",
        "twoSum",
        2,
        "[2,7,11,15]\n9",
    )

    assert result["status"] == "completed"
    assert result["termination_reason"] == "normal_return"
    assert result["return_value"] == {
        "type": "list",
        "length": 2,
        "items": [
            {"type": "int", "value": "0"},
            {"type": "int", "value": "1"},
        ],
        "truncated": False,
    }
    assert any(event["function"] == "twoSum" and event["line"] == 3 for event in result["events"])


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


def test_trace_events_are_streamed_in_bounded_batches_during_execution():
    emitted = []

    def emit_batch(session_id, events_json):
        emitted.append((session_id, json.loads(events_json)))

    result = run_request(
        """class Solution:
    def loop(self):
        total = 0
        for index in range(40):
            total += index
        return total
""",
        "",
        {"class_name": "Solution", "method_name": "loop", "parameter_count": 0},
        LIMITS,
        session_id="stream-session",
        emit_batch=emit_batch,
    )

    assert result["status"] == "completed"
    assert emitted
    assert all(session_id == "stream-session" for session_id, _ in emitted)
    assert all(len(events) <= 50 for _, events in emitted)
    assert len(emitted[0][1]) == 50
    streamed_steps = [event["step"] for _, events in emitted for event in events]
    assert streamed_steps == list(range(1, len(streamed_steps) + 1))


def test_trace_stream_flushes_large_batches_before_fifty_events():
    emitted = []

    def emit_batch(session_id, events_json):
        emitted.append((session_id, json.loads(events_json)))

    result = run_request(
        """class Solution:
    def large_trace(self):
        payload = "x" * 20000
        for index in range(30):
            payload = payload
        return len(payload)
""",
        "",
        {"class_name": "Solution", "method_name": "large_trace", "parameter_count": 0},
        {**LIMITS, "max_session_bytes": 2_000_000, "max_snapshot_bytes": 250_000},
        session_id="large-stream-session",
        emit_batch=emit_batch,
    )

    assert result["status"] == "completed"
    assert len(emitted) >= 2
    assert len(emitted[0][1]) < 50


def test_value_snapshots_respect_max_snapshot_bytes():
    result = run_request(
        """class Solution:
    def snapshot(self):
        payload = "x" * 10000
        return payload
""",
        "",
        {"class_name": "Solution", "method_name": "snapshot", "parameter_count": 0},
        {**LIMITS, "max_snapshot_bytes": 128, "max_session_bytes": 2_000_000},
    )

    assert result["status"] == "completed"
    payload_snapshots = [
        event["locals"]["payload"]
        for event in result["events"]
        if "payload" in event["locals"]
    ]
    assert payload_snapshots
    assert payload_snapshots[-1]["truncated"] is True
    assert len(json.dumps(payload_snapshots[-1], separators=(",", ":")).encode("utf-8")) <= 128


def test_trace_stream_flushes_after_latency_before_user_execution_resumes():
    markers = []

    def emit_batch(_session_id, _events_json):
        markers.append("batch")

    result = run_request(
        """import time
class Solution:
    def delayed(self):
        time.sleep(0.06)
        stream_markers.append("after")
        return 1
""",
        "",
        {"class_name": "Solution", "method_name": "delayed", "parameter_count": 0},
        {**LIMITS, "max_session_bytes": 2_000_000},
        runtime_globals={"stream_markers": markers},
        session_id="latency-stream-session",
        emit_batch=emit_batch,
    )

    assert result["status"] == "completed"
    assert markers[:2] == ["batch", "after"]


def test_linked_list_parameter_builds_a_user_defined_node_chain_and_captures_topology():
    result = run_request(
        """class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class Solution:
    def reverseList(self, head: ListNode | None):
        return head
""",
        "[1,2,3]",
        {
            "class_name": "Solution",
            "method_name": "reverseList",
            "parameter_count": 1,
            "parameter_kinds": ["linked_list"],
        },
        LIMITS,
    )

    assert result["status"] == "completed"
    assert result["return_value"]["type"] == "reference"
    assert result["return_value"]["className"] == "ListNode"
    assert any(event["objects"] for event in result["events"])
    assert any(
        object_snapshot["attributes"]["next"]["type"] == "reference"
        for event in result["events"]
        for object_snapshot in event["objects"]
        if "next" in object_snapshot["attributes"]
    )


def test_graph_parameter_builds_a_user_defined_adjacency_graph_and_captures_neighbors():
    result = run_request(
        """from typing import Optional

class Node:
    def __init__(self, val=0, neighbors=None):
        self.val = val
        self.neighbors = neighbors if neighbors is not None else []

class Solution:
    def cloneGraph(self, node: Optional['Node']) -> Optional['Node']:
        if node is None:
            return None
        print(node.val, [neighbor.val for neighbor in node.neighbors])
        return node
""",
        "[[2,4],[1,3],[2,4],[1,3]]",
        {
            "class_name": "Solution",
            "method_name": "cloneGraph",
            "parameter_count": 1,
            "parameter_kinds": ["graph_node"],
        },
        LIMITS,
    )

    assert result["status"] == "completed"
    assert "1 [2, 4]" in result["stdout"]
    graph_objects = [
        object_snapshot
        for event in result["events"]
        for object_snapshot in event.get("objects", [])
        if object_snapshot["className"] == "Node"
    ]
    assert graph_objects
    root = next(
        object_snapshot
        for object_snapshot in graph_objects
        if object_snapshot["attributes"].get("val") == {"type": "int", "value": "1"}
        and object_snapshot["attributes"].get("neighbors", {}).get("length") == 2
    )
    object_id_by_value = {
        object_snapshot["attributes"]["val"]["value"]: object_snapshot["objectId"]
        for object_snapshot in graph_objects
        if "val" in object_snapshot["attributes"]
    }
    assert [
        item["objectId"] for item in root["attributes"]["neighbors"]["items"]
    ] == [object_id_by_value["2"], object_id_by_value["4"]]


def test_graph_template_uses_the_runtime_node_definition_when_it_is_documented_only():
    source = '''"""
# Definition for a Node.
class Node:
    def __init__(self, val = 0, neighbors = None):
        self.val = val
        self.neighbors = neighbors if neighbors is not None else []
"""
class Solution:
    def cloneGraph(self, node: 'Node') -> 'Node':
        if not node:
            return None

        copies = {}

        def dfs(cur):
            if cur in copies:
                return copies[cur]

            copy = Node(cur.val)
            copies[cur] = copy

            for neighbor in cur.neighbors:
                copy.neighbors.append(dfs(neighbor))

            return copy

        return dfs(node)
'''

    assert hasattr(runtime_prelude, "Node")
    result = run_request(
        source,
        "[[2,4],[1,3],[2,4],[1,3]]",
        {
            "class_name": "Solution",
            "method_name": "cloneGraph",
            "parameter_count": 1,
            "parameter_kinds": ["graph_node"],
        },
        {**LIMITS, "max_session_bytes": 2_000_000},
        runtime_globals={"Node": runtime_prelude.Node},
    )

    assert result["status"] == "completed"
    assert result["termination_reason"] == "normal_return"
    assert result["return_value"]["type"] == "reference"
    assert result["return_value"]["className"] == "Node"


def test_graph_empty_adjacency_input_reaches_solution_as_none():
    result = run_request(
        """from typing import Optional

class Solution:
    def cloneGraph(self, node: Optional['Node']) -> Optional['Node']:
        return node
""",
        "[]",
        {
            "class_name": "Solution",
            "method_name": "cloneGraph",
            "parameter_count": 1,
            "parameter_kinds": ["graph_node"],
        },
        LIMITS,
    )

    assert result["status"] == "completed"
    assert result["return_value"] == {"type": "none", "value": None}


def test_graph_malformed_adjacency_input_fails_closed():
    source = """class Solution:
    def cloneGraph(self, node):
        return node
"""
    request_data = {
        "class_name": "Solution",
        "method_name": "cloneGraph",
        "parameter_count": 1,
        "parameter_kinds": ["graph_node"],
    }

    for testcase in ("[[2],[3]]", '[["2"],[1]]'):
        result = run_request(source, testcase, request_data, LIMITS)
        assert result["status"] == "input_error"
        assert result["termination_reason"] == "unsupported_testcase_format"


def test_binary_tree_parameter_builds_level_order_tree_and_captures_topology():
    result = run_request(
        """from typing import Optional

class Solution:
    def isSymmetric(self, root: Optional[TreeNode]) -> bool:
        return (
            root is not None
            and root.left is not None
            and root.right is not None
            and root.left.val == root.right.val
            and root.left.left.val == root.right.right.val
        )
""",
        "[1,2,2,3,4,4,3]",
        {
            "class_name": "Solution",
            "method_name": "isSymmetric",
            "parameter_count": 1,
            "parameter_kinds": ["binary_tree"],
        },
        LIMITS,
        runtime_globals={"TreeNode": TreeNode},
    )

    assert result["status"] == "completed"
    assert result["return_value"] == {"type": "bool", "value": True}
    tree_objects = [
        object_snapshot
        for event in result["events"]
        for object_snapshot in event.get("objects", [])
        if object_snapshot["className"] == "TreeNode"
    ]
    assert tree_objects
    root = next(
        object_snapshot
        for object_snapshot in tree_objects
        if object_snapshot["attributes"]["val"] == {"type": "int", "value": "1"}
    )
    assert root["attributes"]["left"]["type"] == "reference"
    assert root["attributes"]["right"]["type"] == "reference"


def test_recursive_binary_tree_frames_keep_ancestor_topology_visible():
    result = run_request(
        """from typing import Optional

class Solution:
    def mirror(self, left, right):
        if not left and not right:
            return True
        if not left or not right:
            return False
        return self.mirror(left.left, right.right)

    def isSymmetric(self, root: Optional[TreeNode]) -> bool:
        if not root:
            return True
        return self.mirror(root.left, root.right)
""",
        "[1,2,2,3,4,4,3]",
        {
            "class_name": "Solution",
            "method_name": "isSymmetric",
            "parameter_count": 1,
            "parameter_kinds": ["binary_tree"],
        },
        LIMITS,
        runtime_globals={"TreeNode": TreeNode},
    )

    assert result["status"] == "completed"
    recursive_base_events = [
        event
        for event in result["events"]
        if event["function"] == "mirror"
        and event["locals"].get("left", {}).get("type") == "none"
        and event["locals"].get("right", {}).get("type") == "none"
    ]
    assert recursive_base_events
    assert all(
        len([
            object_snapshot
            for object_snapshot in event.get("objects", [])
            if object_snapshot["className"] == "TreeNode"
        ]) == 7
        for event in recursive_base_events
    )


def test_binary_tree_builder_uses_queue_order_after_a_missing_child():
    result = run_request(
        """from typing import Optional

class Solution:
    def child_value(self, root: Optional[TreeNode]) -> int:
        return root.right.left.val
""",
        "[1,None,2,3]",
        {
            "class_name": "Solution",
            "method_name": "child_value",
            "parameter_count": 1,
            "parameter_kinds": ["binary_tree"],
        },
        LIMITS,
        runtime_globals={"TreeNode": TreeNode},
    )

    assert result["status"] == "completed"
    assert result["return_value"] == {"type": "int", "value": "3"}


def test_binary_tree_builder_accepts_leetcode_null_markers():
    result = run_request(
        """from typing import Optional

class Solution:
    def child_sum(self, root: Optional[TreeNode]) -> int:
        return root.left.right.val + root.right.right.val
""",
        "[1,2,2,null,3,null,3]",
        {
            "class_name": "Solution",
            "method_name": "child_sum",
            "parameter_count": 1,
            "parameter_kinds": ["binary_tree"],
        },
        LIMITS,
        runtime_globals={"TreeNode": TreeNode},
    )

    assert result["status"] == "completed"
    assert result["return_value"] == {"type": "int", "value": "6"}


def test_value_parameter_keeps_a_literal_list_as_a_builtin_list():
    result = run_request(
        """class Solution:
    def keep(self, values: list[int]):
        return values
""",
        "[1,2,3]",
        {
            "class_name": "Solution",
            "method_name": "keep",
            "parameter_count": 1,
            "parameter_kinds": ["value"],
        },
        LIMITS,
    )

    assert result["status"] == "completed"
    assert result["return_value"]["type"] == "list"


def test_object_topology_respects_node_bound_and_marks_truncation():
    result = run_request(
        """class Node:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class Solution:
    def build(self):
        head = Node(0)
        tail = head
        for value in range(12):
            tail.next = Node(value + 1)
            tail = tail.next
        return head
""",
        "",
        {"class_name": "Solution", "method_name": "build", "parameter_count": 0},
        {**LIMITS, "max_object_nodes": 5},
    )

    assert result["status"] == "completed"
    bounded_events = [
        event for event in result["events"]
        if event.get("objects_truncated") is True
    ]
    assert bounded_events
    assert all(len(event["objects"]) <= 5 for event in bounded_events)

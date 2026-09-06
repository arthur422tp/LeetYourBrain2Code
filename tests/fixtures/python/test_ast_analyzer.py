import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from ast_analyzer import analyze_subscript_relations
from runner import run_request


def as_dicts(relations):
    return [
        {key: value for key, value in relation.__dict__.items() if value is not None}
        for relation in relations
    ]


def test_extracts_two_pointer_relations_with_qualified_method_scope():
    source = """class Solution:
    def twoSum(self, nums, target):
        while left < right:
            total = nums[left] + nums[right]
            return total
"""

    assert as_dicts(analyze_subscript_relations(source)) == [
        {"scope": "Solution.twoSum", "line": 4, "container": "nums", "index": "left"},
        {"scope": "Solution.twoSum", "line": 4, "container": "nums", "index": "right"},
    ]


def test_extracts_binary_search_and_dynamic_programming_index_relations():
    source = """class Solution:
    def search(self, nums, dp, matrix, i, row):
        value = nums[mid]
        value = dp[i]
        value = matrix[row]
        return value
"""

    assert as_dicts(analyze_subscript_relations(source)) == [
        {"scope": "Solution.search", "line": 3, "container": "nums", "index": "mid"},
        {"scope": "Solution.search", "line": 4, "container": "dp", "index": "i"},
        {"scope": "Solution.search", "line": 5, "container": "matrix", "index": "row"},
    ]


def test_tracks_nested_function_lexical_scope():
    source = """class Solution:
    def outer(self, values):
        def inner(i):
            return values[i]
        return inner(0)
"""

    assert as_dicts(analyze_subscript_relations(source)) == [
        {"scope": "Solution.outer.inner", "line": 4, "container": "values", "index": "i"}
    ]


def test_same_index_name_in_different_functions_keeps_distinct_scopes():
    source = """class Solution:
    def first(self, nums, i):
        return nums[i]

    def second(self, nums, i):
        return nums[i]
"""

    assert as_dicts(analyze_subscript_relations(source)) == [
        {"scope": "Solution.first", "line": 3, "container": "nums", "index": "i"},
        {"scope": "Solution.second", "line": 6, "container": "nums", "index": "i"},
    ]


def test_ignores_non_name_index_or_container_expressions_without_failing():
    source = """class Solution:
    def inspect(self, nums, obj, i, left):
        a = nums[i + 1]
        b = nums[left:right]
        c = obj.values[i]
        d = nums[0]
        return a, b, c, d
"""

    assert as_dicts(analyze_subscript_relations(source)) == []


def test_invalid_python_source_returns_no_relations():
    assert analyze_subscript_relations("class Solution:\n    def broken(self, :\n        pass") == []


def test_runner_returns_static_relations_alongside_the_trace():
    result = run_request(
        """class Solution:
    def twoSum(self, nums, left):
        return nums[left]
""",
        "[1, 2]\n1",
        {"class_name": "Solution", "method_name": "twoSum", "parameter_count": 2},
        {
            "max_trace_steps": 50,
            "max_container_items": 20,
            "max_nesting_depth": 8,
            "max_snapshot_bytes": 20_000,
            "max_session_bytes": 100_000,
            "max_stdout_bytes": 2_000,
        },
    )

    assert result["subscript_relations"] == [
        {"scope": "Solution.twoSum", "line": 3, "container": "nums", "index": "left"}
    ]


def test_extracts_enumerate_cursor_relations():
    source = """class Solution:
    def twoSum(self, nums, target):
        for i, x in enumerate(nums):
            need = target - x
            if need in seen:
                return [i, x]
"""

    assert as_dicts(analyze_subscript_relations(source)) == [
        {
            "kind": "iteration",
            "scope": "Solution.twoSum",
            "line": 3,
            "container": "nums",
            "index": "i",
            "value": "x",
        },
        {
            "kind": "membership",
            "scope": "Solution.twoSum",
            "line": 5,
            "container": "seen",
            "index": "need",
        },
    ]


def test_extracts_range_cursor_relations_without_nonzero_enumerate_offsets():
    source = """class Solution:
    def search(self, nums):
        for i in range(len(nums)):
            return nums[i]
        for j, value in enumerate(nums, 1):
            return value
"""

    assert as_dicts(analyze_subscript_relations(source)) == [
        {
            "kind": "iteration",
            "scope": "Solution.search",
            "line": 3,
            "container": "nums",
            "index": "i",
        },
        {
            "scope": "Solution.search",
            "line": 4,
            "container": "nums",
            "index": "i",
        },
    ]

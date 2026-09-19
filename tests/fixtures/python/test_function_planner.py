import json
import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from function_planner import build_runtime_function_mapper, plan_user_functions
from runner import run_request


LIMITS = {
    "max_trace_steps": 100,
    "max_container_items": 20,
    "max_nesting_depth": 8,
    "max_snapshot_bytes": 20_000,
    "max_session_bytes": 100_000,
    "max_stdout_bytes": 2_000,
    "max_call_frame_events": 20_000,
    "max_call_frame_bytes": 2_000_000,
}


class FunctionPlannerTests(unittest.TestCase):
    def test_top_level_function_has_stable_identity_and_original_span(self):
        source = "def solve(x):\n    return x\n"

        first = plan_user_functions(source)
        second = plan_user_functions(source)

        self.assertTrue(first.available)
        self.assertEqual(
            json.dumps(first.plan_dict, sort_keys=True),
            json.dumps(second.plan_dict, sort_keys=True),
        )
        self.assertEqual(first.plan_dict["version"], 1)
        self.assertEqual(len(first.plan_dict["functions"]), 1)
        descriptor = first.plan_dict["functions"][0]
        self.assertEqual(descriptor["kind"], "function")
        self.assertEqual(descriptor["name"], "solve")
        self.assertEqual(descriptor["qualifiedName"], "solve")
        self.assertEqual(descriptor["span"]["line"], 1)
        self.assertEqual(descriptor["span"]["column"], 0)
        self.assertEqual(descriptor["firstBodyLine"], 2)

    def test_methods_have_class_identity_and_parameter_metadata(self):
        source = """class Solution:
    def solve(self, x, /, y, *args, flag=True, **kwargs):
        return self.helper(x)

    def helper(self, x):
        return x
"""

        result = plan_user_functions(source)

        self.assertTrue(result.available)
        functions = result.plan_dict["functions"]
        self.assertEqual([item["qualifiedName"] for item in functions], [
            "Solution.solve",
            "Solution.helper",
        ])
        solve = functions[0]
        self.assertEqual(solve["kind"], "method")
        self.assertEqual(solve["parentClassName"], "Solution")
        self.assertEqual(solve["parameterNames"], ["self", "x", "y", "args", "flag", "kwargs"])
        self.assertEqual(solve["parameterKinds"], [
            "positional_only",
            "positional_only",
            "positional_or_keyword",
            "varargs",
            "keyword_only",
            "varkw",
        ])
        self.assertEqual(solve["firstBodyLine"], 3)
        self.assertEqual(functions[1]["firstBodyLine"], 6)

    def test_same_named_nested_functions_keep_lexical_parent_identity(self):
        source = """def outer(x):
    def visit(y):
        return y
    return visit(x)

def other(x):
    def visit(y):
        return y + 1
    return visit(x)
"""

        result = plan_user_functions(source)

        self.assertTrue(result.available)
        functions = result.plan_dict["functions"]
        visits = [item for item in functions if item["name"] == "visit"]
        self.assertEqual([item["qualifiedName"] for item in visits], ["outer.visit", "other.visit"])
        self.assertEqual(len({item["functionId"] for item in visits}), 2)
        outer_id = next(item["functionId"] for item in functions if item["qualifiedName"] == "outer")
        other_id = next(item["functionId"] for item in functions if item["qualifiedName"] == "other")
        self.assertEqual(visits[0]["parentFunctionId"], outer_id)
        self.assertEqual(visits[1]["parentFunctionId"], other_id)
        self.assertEqual([item["span"]["line"] for item in visits], [2, 7])
        self.assertEqual([item["firstBodyLine"] for item in visits], [3, 8])

    def test_pass_only_function_has_no_first_executable_body_line(self):
        result = plan_user_functions("def placeholder():\n    pass\n")

        self.assertTrue(result.available)
        self.assertIsNone(result.plan_dict["functions"][0]["firstBodyLine"])

    def test_planner_fails_open_for_unexpected_input(self):
        result = plan_user_functions(None)

        self.assertFalse(result.available)
        self.assertEqual(result.plan_dict, {"version": 1, "functions": []})
        self.assertIsInstance(result.reason, str)

    def test_runner_exposes_the_plan_without_changing_execution(self):
        source = """class Solution:
    def solve(self, value):
        return value + 1
"""

        result = run_request(
            source,
            "4",
            {"class_name": "Solution", "method_name": "solve", "parameter_count": 1},
            LIMITS,
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["return_value"], {"type": "int", "value": "5"})
        self.assertEqual(result["function_plan"], plan_user_functions(source).plan_dict)

    def test_runner_maps_methods_and_recursive_helpers_after_instrumentation(self):
        source = """class Solution:
    def solve(self, n):
        return self.helper(n)

    def helper(self, n):
        if n <= 0:
            return 0
        return self.helper(n - 1) + 1
"""

        result = run_request(
            source,
            "3",
            {"class_name": "Solution", "method_name": "solve", "parameter_count": 1},
            LIMITS,
        )

        self.assertEqual(result["status"], "completed")
        function_ids = [
            update.get("function_id")
            for batch in result["call_frame_batches"]
            for update in batch["updates"]
            if update["kind"] == "frame_enter"
        ]
        descriptors = {item["functionId"]: item["qualifiedName"] for item in result["function_plan"]["functions"]}
        self.assertEqual(descriptors[function_ids[0]], "Solution.solve")
        self.assertEqual([descriptors[item] for item in function_ids[1:]], [
            "Solution.helper", "Solution.helper", "Solution.helper", "Solution.helper"
        ])

    def test_runner_maps_nested_function_identity_after_instrumentation(self):
        source = """class Solution:
    def solve(self, n):
        def helper(k):
            if k == 0:
                return 1
            return helper(k - 1)
        return helper(n)
"""

        result = run_request(
            source,
            "2",
            {"class_name": "Solution", "method_name": "solve", "parameter_count": 1},
            LIMITS,
        )
        descriptors = {item["functionId"]: item["qualifiedName"] for item in result["function_plan"]["functions"]}
        enters = [
            update for batch in result["call_frame_batches"] for update in batch["updates"]
            if update["kind"] == "frame_enter"
        ]
        self.assertEqual([descriptors[update["function_id"]] for update in enters], [
            "Solution.solve", "Solution.solve.helper", "Solution.solve.helper", "Solution.solve.helper"
        ])

    def test_runtime_mapper_fails_closed_when_static_identity_is_ambiguous(self):
        source = "def visit(value):\n    return value\n"
        code = compile(source, "<leetcode-user-code>", "exec")
        function_code = next(item for item in code.co_consts if isinstance(item, types.CodeType))
        descriptor = plan_user_functions(source).plan_dict["functions"][0]
        ambiguous = {
            "version": 1,
            "functions": [descriptor, {**descriptor, "functionId": "ambiguous"}],
        }
        mapper = build_runtime_function_mapper(ambiguous, code)

        self.assertIsNone(mapper(types.SimpleNamespace(f_code=function_code)))

    def test_runner_keeps_same_named_nested_helpers_in_separate_lexical_parents(self):
        source = """def outer(value):
    def visit(item):
        return item + 1
    return visit(value)

def other(value):
    def visit(item):
        return item + 2
    return visit(value)

class Solution:
    def solve(self, value):
        return outer(value) + other(value)
"""

        result = run_request(
            source,
            "3",
            {"class_name": "Solution", "method_name": "solve", "parameter_count": 1},
            LIMITS,
        )
        descriptors = {item["functionId"]: item["qualifiedName"] for item in result["function_plan"]["functions"]}
        enters = [
            update for batch in result["call_frame_batches"] for update in batch["updates"]
            if update["kind"] == "frame_enter"
        ]
        self.assertEqual([descriptors[update["function_id"]] for update in enters], [
            "Solution.solve", "outer", "outer.visit", "other", "other.visit"
        ])


if __name__ == "__main__":
    unittest.main()

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from function_planner import plan_user_functions
from runner import run_request


LIMITS = {
    "max_trace_steps": 100,
    "max_container_items": 20,
    "max_nesting_depth": 8,
    "max_snapshot_bytes": 20_000,
    "max_session_bytes": 100_000,
    "max_stdout_bytes": 2_000,
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


if __name__ == "__main__":
    unittest.main()

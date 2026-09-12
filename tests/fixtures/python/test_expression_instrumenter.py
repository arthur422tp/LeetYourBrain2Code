import ast
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from expression_instrumenter import instrument_expression_roots


class ExpressionInstrumenterTests(unittest.TestCase):
    def test_builds_a_deterministic_plan_for_supported_assignment_and_return_roots(self):
        source = """def solve(a, b, dp):
    x = a + b
    return dp[-1]
"""

        first = instrument_expression_roots(source)
        second = instrument_expression_roots(source)

        self.assertTrue(first.available)
        self.assertEqual(first.plan_dict, second.plan_dict)
        self.assertEqual([root["kind"] for root in first.plan_dict["roots"]], ["assignment", "return"])
        self.assertEqual(
            [expression["kind"] for expression in first.plan_dict["expressions"]],
            ["binary", "name", "name", "subscript", "name", "unary", "literal"],
        )

    def test_assigns_distinct_ids_to_duplicate_source_at_distinct_ast_locations(self):
        source = """def solve(a, b):
    first = a + b
    second = a + b
    return second
"""

        result = instrument_expression_roots(source)
        duplicate_ids = [
            expression["exprId"]
            for expression in result.plan_dict["expressions"]
            if expression["source"] == "a + b"
        ]

        self.assertEqual(len(duplicate_ids), 2)
        self.assertNotEqual(*duplicate_ids)

    def test_omits_unsupported_roots_without_making_instrumentation_unavailable(self):
        source = """def solve(a, b, nums, cond):
    comparison = a < b
    logical = a and b
    doubled = [n * 2 for n in nums]
    return a if cond else b
"""

        result = instrument_expression_roots(source)

        self.assertTrue(result.available)
        self.assertEqual(result.plan_dict, {"version": 1, "roots": [], "expressions": []})

    def test_records_original_metadata_and_direct_matrix_target_hints(self):
        source = """def solve(dp, grid, i, j):
    dp[i][j] = min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j]
"""

        result = instrument_expression_roots(source)
        root = result.plan_dict["roots"][0]
        expressions = {expression["exprId"]: expression for expression in result.plan_dict["expressions"]}
        root_expression = expressions[root["expressionExprId"]]

        self.assertEqual(root["target"]["source"], "dp[i][j]")
        self.assertEqual(root["target"]["span"], {
            "line": 2,
            "column": 4,
            "endLine": 2,
            "endColumn": 12,
        })
        self.assertEqual(root["target"]["structureHint"], {
            "kind": "matrix_cell",
            "variableName": "dp",
            "rowSource": "i",
            "columnSource": "j",
        })
        self.assertEqual(root_expression["source"], "min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j]")
        self.assertEqual(root_expression["span"], {
            "line": 2,
            "column": 15,
            "endLine": 2,
            "endColumn": 59,
        })

    def test_rewrites_supported_loads_without_rewriting_store_targets_or_binary_operands(self):
        source = """def solve(dp, grid, i, j):
    dp[i][j] = min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j]
"""

        result = instrument_expression_roots(source)

        compile(result.instrumented_tree, "<leetcode-user-code>", "exec")
        assignment = next(node for node in ast.walk(result.instrumented_tree) if isinstance(node, ast.Assign))
        self.assertIsInstance(assignment.value, ast.Call)
        self.assertEqual(assignment.value.func.id, "__lc_expr_record")
        self.assertEqual((assignment.value.lineno, assignment.value.col_offset), (2, 15))
        self.assertFalse(any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "__lc_expr_record"
            for node in ast.walk(assignment.targets[0])
        ))
        subtraction_operands = [
            node
            for node in ast.walk(assignment.value)
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Sub)
        ]
        self.assertEqual(len(subtraction_operands), 2)

    def test_routes_direct_positional_min_calls_through_single_call_helper(self):
        source = """def solve(events):
    def mark(label, value):
        events.append(label)
        return value
    result = min(mark("first", 3), mark("second", 1))
    return result
"""
        result = instrument_expression_roots(source)
        records = []
        helper_calls = []
        namespace = {
            "__lc_expr_record": lambda root_id, expr_id, value: records.append(expr_id) or value,
            "__lc_minmax_call": lambda root_id, expr_id, function, candidate_ids, values: (
                helper_calls.append((root_id, expr_id, candidate_ids, list(values))) or function(*values)
            ),
        }

        exec(compile(result.instrumented_tree, "<leetcode-user-code>", "exec"), namespace, namespace)
        events = []
        self.assertEqual(namespace["solve"](events), 1)

        self.assertEqual(events, ["first", "second"])
        self.assertEqual(len(helper_calls), 1)
        self.assertEqual(len(helper_calls[0][2]), 2)
        self.assertGreater(len(records), 0)


if __name__ == "__main__":
    unittest.main()

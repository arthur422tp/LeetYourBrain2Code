import ast
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from condition_instrumenter import instrument_condition_sites
from expression_instrumenter import instrument_expression_roots


def instrument(source):
    return instrument_condition_sites(
        source,
        ast.parse(source),
        "__lc_decision_begin",
        "__lc_condition_truth",
        "__lc_condition_operand",
        "__lc_decision_complete",
    )


class ConditionInstrumenterTests(unittest.TestCase):
    def test_plans_sites_chains_and_evaluation_order_deterministically(self):
        source = """def solve(node, left, right, nums, i, target, x):
    if left < right and nums[i] != target:
        pass
    if x < 0:
        pass
    elif x == 0:
        pass
    else:
        pass
    while left <= right:
        left += 1
"""

        first = instrument(source)
        second = instrument(source)

        self.assertTrue(first.available)
        self.assertEqual(first.plan_dict, second.plan_dict)
        self.assertEqual([site["kind"] for site in first.plan_dict["sites"]], ["if", "if", "elif", "while"])
        self.assertEqual(first.plan_dict["chains"], [
            {
                "chainId": "chain1",
                "branches": [
                    {"branchIndex": 0, "kind": "if", "siteId": "d2"},
                    {"branchIndex": 1, "kind": "elif", "siteId": "d3"},
                    {"branchIndex": 2, "kind": "else"},
                ],
            }
        ])
        logical = next(condition for condition in first.plan_dict["conditions"] if condition["kind"] == "and")
        self.assertEqual(logical["childConditionIds"], ["d1.c0.0", "d1.c0.1"])
        self.assertNotEqual(
            first.plan_dict["sites"][1]["conditionId"],
            first.plan_dict["sites"][2]["conditionId"],
        )

    def test_keeps_risky_comparisons_opaque(self):
        result = instrument("""def solve(a, b, i, n, sentinel):
    if 0 <= i < n:
        pass
    if (a and b) is sentinel:
        pass
""")

        self.assertTrue(result.available)
        opaque = [condition for condition in result.plan_dict["conditions"] if condition["kind"] == "opaque"]
        self.assertEqual(len(opaque), 2)
        self.assertEqual(opaque[0]["source"], "0 <= i < n")
        self.assertEqual(opaque[1]["source"], "(a and b) is sentinel")
        self.assertEqual(opaque[0]["childConditionIds"], [])

    def test_creates_captured_coordinate_operands_for_list_and_matrix_subscripts(self):
        result = instrument("""def solve(nums, left, grid, r, c, target):
    if nums[left] != target:
        pass
    if grid[r][c] == 1:
        pass
    if nums[-1] == target:
        pass
""")

        operands = {operand["operandId"]: operand for operand in result.plan_dict["operands"]}
        list_operand = next(operand for operand in operands.values() if operand["source"] == "nums[left]")
        row_operand = next(operand for operand in operands.values() if operand["source"] == "r")
        column_operand = next(operand for operand in operands.values() if operand["source"] == "c")
        negative_operand = next(operand for operand in operands.values() if operand["source"] == "-1")

        self.assertEqual(list_operand["structureHint"], {
            "kind": "list_index",
            "variableName": "nums",
            "indexOperandId": next(operand_id for operand_id, operand in operands.items() if operand["source"] == "left"),
        })
        matrix_operand = next(operand for operand in operands.values() if operand["source"] == "grid[r][c]")
        self.assertEqual(matrix_operand["structureHint"], {
            "kind": "matrix_cell",
            "variableName": "grid",
            "rowOperandId": row_operand["operandId"],
            "columnOperandId": column_operand["operandId"],
        })
        self.assertEqual(negative_operand["source"], "-1")

    def test_composes_with_expression_instrumented_tree_without_re_evaluating_condition_operands(self):
        source = """def solve(nums, i, total):
    if i < len(nums):
        total = total + nums[i]
    return total
"""
        expression = instrument_expression_roots(source)
        condition = instrument_condition_sites(
            source,
            expression.instrumented_tree,
            "__lc_decision_begin",
            "__lc_condition_truth",
            "__lc_condition_operand",
            "__lc_decision_complete",
        )

        self.assertTrue(condition.available)
        compile(condition.instrumented_tree, "<leetcode-user-code>", "exec")
        self.assertTrue(any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "__lc_expr_record"
            for node in ast.walk(condition.instrumented_tree)
        ))
        self.assertTrue(any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "__lc_decision_complete"
            for node in ast.walk(condition.instrumented_tree)
        ))


if __name__ == "__main__":
    unittest.main()

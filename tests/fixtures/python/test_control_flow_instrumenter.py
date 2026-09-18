import ast
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from control_flow_instrumenter import instrument_control_flow


class ControlFlowInstrumenterTests(unittest.TestCase):
    def test_break_and_continue_are_not_gated_by_observer_return_value(self):
        for transfer, observer_value, expected in [("break", False, []), ("continue", None, [2])]:
            with self.subTest(transfer=transfer):
                source = f"def solve(xs):\n    seen = []\n    for x in xs:\n        if x == 1:\n            {transfer}\n        seen.append(x)\n    return seen\n"
                result = instrument_control_flow(source, ast.parse(source), "ib", "ic", "to", "ro", "ne", "after")
                namespace = {"ib": lambda *_: None, "ic": lambda *_: None,
                             "to": lambda *_: observer_value, "ro": lambda _site, value: value,
                             "ne": lambda *_: None, "after": lambda *_: None}
                exec(compile(result.instrumented_tree, "<test>", "exec"), namespace, namespace)
                self.assertEqual(namespace["solve"]([1, 2]), expected)

    def test_allocates_global_ids_and_respects_lexical_loop_ownership(self):
        source = """def solve(xs, ready):
    for x in xs:
        while ready:
            break
        continue
    return x
"""
        first = instrument_control_flow(source, ast.parse(source), "ib", "ic", "to", "ro", "ne", "after")
        second = instrument_control_flow(source, ast.parse(source), "ib", "ic", "to", "ro", "ne", "after")

        self.assertTrue(first.available)
        self.assertEqual(first.plan_dict, second.plan_dict)
        self.assertEqual([(loop["loopId"], loop["kind"]) for loop in first.plan_dict["loops"]], [("f1", "for"), ("w2", "while")])
        transfers = {item["kind"]: item for item in first.plan_dict["transfers"]}
        self.assertEqual(transfers["break"]["targetLoopId"], "w2")
        self.assertEqual(transfers["continue"]["targetLoopId"], "f1")
        self.assertNotIn("targetLoopId", transfers["return"])

    def test_nested_function_cannot_target_outer_loop(self):
        source = """def outer(xs):
    for x in xs:
        def inner(ys):
            for y in ys:
                break
        continue
"""
        result = instrument_control_flow(source, ast.parse(source), "ib", "ic", "to", "ro", "ne", "after")
        self.assertEqual([(loop["loopId"], loop["kind"]) for loop in result.plan_dict["loops"]], [("f1", "for"), ("f2", "for")])
        self.assertEqual([item["targetLoopId"] for item in result.plan_dict["transfers"]], ["f2", "f1"])

    def test_rewrites_lifecycle_and_transfers_without_extra_iterator_reads(self):
        source = """def solve(xs):
    seen = []
    for x in xs:
        seen.append(x)
    return seen
"""
        calls = []
        result = instrument_control_flow(source, ast.parse(source), "ib", "ic", "to", "ro", "ne", "after")
        namespace = {
            "ib": lambda *_args: calls.append("begin"),
            "ic": lambda *_args: calls.append("complete"),
            "to": lambda *_args: True,
            "ro": lambda _site, value: value,
            "ne": lambda *_args: calls.append("natural"),
            "after": lambda *_args: calls.append("after"),
        }
        exec(compile(result.instrumented_tree, "<test>", "exec"), namespace, namespace)
        iterator = iter([1, 2])
        self.assertEqual(namespace["solve"](iterator), [1, 2])
        self.assertEqual(calls.count("begin"), 2)
        self.assertEqual(calls.count("complete"), 2)

    def test_loop_without_source_else_still_marks_natural_exit(self):
        source = """def solve(xs):
    for x in xs:
        pass
"""
        calls = []
        result = instrument_control_flow(
            source, ast.parse(source),
            "ib", "ic", "to", "ro", "ne", "after"
        )
        namespace = {
            "ib": lambda *_args: calls.append("begin"),
            "ic": lambda *_args: calls.append("complete"),
            "to": lambda *_args: True,
            "ro": lambda _site, value: value,
            "ne": lambda *_args: calls.append("natural"),
            "after": lambda *_args: calls.append("after"),
        }
        exec(compile(result.instrumented_tree, "<test>", "exec"), namespace, namespace)
        namespace["solve"]([1])

        self.assertEqual(calls, ["begin", "complete", "natural", "after"])

    def test_break_skips_synthetic_natural_exit(self):
        source = """def solve(xs):
    for x in xs:
        break
"""
        calls = []
        result = instrument_control_flow(
            source, ast.parse(source),
            "ib", "ic", "to", "ro", "ne", "after"
        )
        namespace = {
            "ib": lambda *_args: calls.append("begin"),
            "ic": lambda *_args: calls.append("complete"),
            "to": lambda *_args: calls.append("transfer") or True,
            "ro": lambda _site, value: value,
            "ne": lambda *_args: calls.append("natural"),
            "after": lambda *_args: calls.append("after"),
        }
        exec(compile(result.instrumented_tree, "<test>", "exec"), namespace, namespace)
        namespace["solve"]([1])

        self.assertEqual(calls, ["begin", "transfer", "after"])

    def test_unsupported_for_target_still_gets_iteration_probe_without_bindings(self):
        source = "def solve(xs, obj):\n    for obj.value in xs:\n        pass\n"
        result = instrument_control_flow(source, ast.parse(source), "ib", "ic", "to", "ro", "ne", "after")
        target = result.plan_dict["loops"][0]["target"]
        self.assertFalse(target["capturable"])
        self.assertEqual(target["bindingNames"], [])
        self.assertEqual(result.synthetic_line_map, {1003: 2, 1004: 2, 1005: 2, 1006: 2})


if __name__ == "__main__":
    unittest.main()

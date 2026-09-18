import ast
from dataclasses import dataclass


@dataclass
class ControlFlowInstrumentationResult:
    instrumented_tree: ast.AST | None
    plan_dict: dict
    synthetic_line_map: dict[int, int]
    available: bool
    reason: str | None = None


_EMPTY_PLAN = {"version": 1, "loops": [], "transfers": []}


def _span(node):
    return {
        "line": node.lineno,
        "column": node.col_offset,
        "endLine": node.end_lineno,
        "endColumn": node.end_col_offset,
    }


def _key(node):
    return (node.lineno, node.col_offset, node.end_lineno, node.end_col_offset)


def _capturable_binding_names(target):
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        names = []
        for element in target.elts:
            child = _capturable_binding_names(element)
            if child is None:
                return None
            names.extend(child)
        return list(dict.fromkeys(names))
    return None


class _Planner(ast.NodeVisitor):
    def __init__(self, source_code):
        self.source_code = source_code
        self.plan = {"version": 1, "loops": [], "transfers": []}
        self.loop_ordinal = 0
        self.transfer_ordinal = 0
        self.loop_stack = []

    def _visit_function_body(self, node):
        saved = self.loop_stack
        self.loop_stack = []
        try:
            for statement in node.body:
                self.visit(statement)
        finally:
            self.loop_stack = saved

    def visit_FunctionDef(self, node):
        self._visit_function_body(node)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_For(self, node):
        self.loop_ordinal += 1
        loop_id = f"f{self.loop_ordinal}"
        names = _capturable_binding_names(node.target)
        self.plan["loops"].append({
            "loopId": loop_id,
            "kind": "for",
            "span": _span(node),
            "target": {
                "source": ast.get_source_segment(self.source_code, node.target) or "",
                "span": _span(node.target),
                "bindingNames": names or [],
                "capturable": names is not None,
            },
        })
        # A loop in an iterable expression is evaluated before this loop's
        # lexical target scope exists.
        self.visit(node.iter)
        self.loop_stack.append(loop_id)
        try:
            for statement in node.body:
                self.visit(statement)
        finally:
            self.loop_stack.pop()
        # The loop target is intentionally not in scope while its else suite
        # is being planned; nested loops there own their own transfers.
        for statement in node.orelse:
            self.visit(statement)

    def visit_While(self, node):
        self.loop_ordinal += 1
        loop_id = f"w{self.loop_ordinal}"
        self.plan["loops"].append({
            "loopId": loop_id,
            "kind": "while",
            "span": _span(node),
        })
        self.visit(node.test)
        self.loop_stack.append(loop_id)
        try:
            for statement in node.body:
                self.visit(statement)
        finally:
            self.loop_stack.pop()
        for statement in node.orelse:
            self.visit(statement)

    def _add_transfer(self, node, kind):
        self.transfer_ordinal += 1
        descriptor = {
            "transferId": f"t{self.transfer_ordinal}",
            "kind": kind,
            "span": _span(node),
        }
        if kind in {"break", "continue"} and self.loop_stack:
            descriptor["targetLoopId"] = self.loop_stack[-1]
        self.plan["transfers"].append(descriptor)

    def visit_Break(self, node):
        self._add_transfer(node, "break")

    def visit_Continue(self, node):
        self._add_transfer(node, "continue")

    def visit_Return(self, node):
        self._add_transfer(node, "return")
        self.generic_visit(node)


class _Instrumenter(ast.NodeTransformer):
    def __init__(self, source_code, plan, helper_names, synthetic_base):
        self.source_code = source_code
        self.plan = plan
        self.iteration_begin_name, self.iteration_complete_name, self.transfer_observed_name, self.return_observed_name, self.loop_natural_exit_name, self.loop_after_name = helper_names
        self.transfer_by_key = {
            (item["kind"], tuple(item["span"][field] for field in ("line", "column", "endLine", "endColumn"))): item
            for item in plan["transfers"]
        }
        self.loop_by_key = {
            tuple(item["span"][field] for field in ("line", "column", "endLine", "endColumn")): item
            for item in plan["loops"]
        }
        self.synthetic_base = synthetic_base
        self.next_synthetic_line = synthetic_base
        self.synthetic_line_map = {}

    def _location(self, node, synthetic=False, original_line=None):
        if synthetic:
            line = self.next_synthetic_line
            self.next_synthetic_line += 1
            self.synthetic_line_map[line] = original_line if original_line is not None else node.lineno
            return line
        return node.lineno

    def _call(self, name, args, node, synthetic=False, original_line=None):
        call = ast.Call(func=ast.Name(id=name, ctx=ast.Load()), args=args, keywords=[])
        if synthetic:
            line = self._location(node, True, original_line)
            call.lineno = line
            call.end_lineno = line
            call.col_offset = 0
            call.end_col_offset = 1
        else:
            ast.copy_location(call, node)
        return call

    def _synthetic_expr(self, name, args, loop_node):
        call = self._call(name, args, loop_node, True, loop_node.lineno)
        expression = ast.Expr(value=call)
        expression.lineno = call.lineno
        expression.end_lineno = call.end_lineno
        expression.col_offset = call.col_offset
        expression.end_col_offset = call.end_col_offset
        return expression

    def _transfer(self, node, kind):
        descriptor = self.transfer_by_key.get((kind, _key(node)))
        if descriptor is None:
            return node
        target_loop_id = descriptor.get("targetLoopId")
        args = [ast.Constant(descriptor["transferId"]), ast.Constant(kind)]
        if target_loop_id is not None:
            args.append(ast.Constant(target_loop_id))
        condition = self._call(self.transfer_observed_name, args, node)
        guarded = ast.If(test=condition, body=[node], orelse=[])
        return ast.copy_location(guarded, node)

    def visit_Break(self, node):
        return self._transfer(node, "break")

    def visit_Continue(self, node):
        return self._transfer(node, "continue")

    def visit_Return(self, node):
        descriptor = self.transfer_by_key.get(("return", _key(node)))
        if descriptor is None:
            return self.generic_visit(node)
        value = self.visit(node.value) if node.value is not None else ast.Constant(value=None)
        ast.copy_location(value, node)
        wrapped = self._call(
            self.return_observed_name,
            [ast.Constant(descriptor["transferId"]), value],
            node,
        )
        rewritten = ast.Return(value=wrapped)
        return ast.copy_location(rewritten, node)

    def _loop_lifecycle(self, node, descriptor, body):
        loop_id = descriptor["loopId"]
        loop_kind = descriptor["kind"]
        if loop_kind == "for" and descriptor.get("target", {}).get("capturable"):
            names = descriptor["target"]["bindingNames"]
            values = [ast.Name(id=name, ctx=ast.Load()) for name in names]
        else:
            names = []
            values = []
        begin = self._synthetic_expr(
            self.iteration_begin_name,
            [ast.Constant(loop_id), ast.Constant(loop_kind), ast.Tuple(elts=[ast.Constant(name) for name in names], ctx=ast.Load()), ast.Tuple(elts=values, ctx=ast.Load())],
            node,
        )
        complete = self._synthetic_expr(
            self.iteration_complete_name,
            [ast.Constant(loop_id)],
            node,
        )
        return [begin, *body, complete]

    def _rewrite_loop(self, node, descriptor):
        # Rewrite children first so transfers and nested loops retain original
        # source spans, then add lifecycle probes around the rewritten body.
        if isinstance(node, ast.For):
            node.iter = self.visit(node.iter)
        if isinstance(node, ast.While):
            node.test = self.visit(node.test)

        def visit_statements(statements):
            rewritten = []
            for statement in statements:
                result = self.visit(statement)
                rewritten.extend(result if isinstance(result, list) else [result])
            return rewritten

        node.body = visit_statements(node.body)
        node.orelse = visit_statements(node.orelse)
        node.body = self._loop_lifecycle(node, descriptor, node.body)
        natural_exit = self._synthetic_expr(
            self.loop_natural_exit_name,
            [ast.Constant(descriptor["loopId"]), ast.Constant(descriptor["kind"])],
            node,
        )
        node.orelse = [natural_exit, *node.orelse]
        after = self._synthetic_expr(
            self.loop_after_name,
            [ast.Constant(descriptor["loopId"]), ast.Constant(descriptor["kind"])],
            node,
        )
        return [node, after]

    def visit_For(self, node):
        descriptor = self.loop_by_key.get(_key(node))
        if descriptor is None:
            return self.generic_visit(node)
        return self._rewrite_loop(node, descriptor)

    def visit_While(self, node):
        descriptor = self.loop_by_key.get(_key(node))
        if descriptor is None:
            return self.generic_visit(node)
        return self._rewrite_loop(node, descriptor)


def instrument_control_flow(
    source_code,
    base_tree,
    iteration_begin_name,
    iteration_complete_name,
    transfer_observed_name,
    return_observed_name,
    loop_natural_exit_name,
    loop_after_name,
):
    try:
        original_tree = ast.parse(source_code)
    except (SyntaxError, TypeError, ValueError) as error:
        return ControlFlowInstrumentationResult(None, _EMPTY_PLAN.copy(), {}, False, type(error).__name__)

    planner = _Planner(source_code)
    try:
        planner.visit(original_tree)
    except Exception:
        return ControlFlowInstrumentationResult(base_tree, planner.plan, {}, False, "planning_failed")
    if base_tree is None:
        return ControlFlowInstrumentationResult(None, planner.plan, {}, False, "missing_base_tree")

    try:
        source_lines = source_code.splitlines()
        synthetic_base = len(source_lines) + 1000
        instrumenter = _Instrumenter(
            source_code,
            planner.plan,
            (iteration_begin_name, iteration_complete_name, transfer_observed_name, return_observed_name, loop_natural_exit_name, loop_after_name),
            synthetic_base,
        )
        instrumented_tree = instrumenter.visit(base_tree)
        if isinstance(instrumented_tree, list):
            instrumented_tree = ast.Module(body=instrumented_tree, type_ignores=[])
        ast.fix_missing_locations(instrumented_tree)
        return ControlFlowInstrumentationResult(
            instrumented_tree,
            planner.plan,
            instrumenter.synthetic_line_map,
            True,
        )
    except Exception:
        return ControlFlowInstrumentationResult(base_tree, planner.plan, {}, False, "instrumentation_failed")

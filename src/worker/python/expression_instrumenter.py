import ast
from dataclasses import dataclass


@dataclass
class InstrumentationResult:
    instrumented_tree: ast.AST | None
    plan_dict: dict
    available: bool
    reason: str | None = None


_EMPTY_PLAN = {"version": 1, "roots": [], "expressions": []}


def _span(node):
    return {
        "line": node.lineno,
        "column": node.col_offset,
        "endLine": node.end_lineno,
        "endColumn": node.end_col_offset,
    }


def _kind(node):
    if isinstance(node, ast.Name):
        return "name"
    if isinstance(node, ast.Constant):
        return "literal"
    if isinstance(node, ast.Subscript):
        return "subscript"
    if isinstance(node, ast.Attribute):
        return "attribute"
    if isinstance(node, ast.UnaryOp):
        return "unary"
    if isinstance(node, ast.BinOp):
        return "binary"
    if isinstance(node, ast.Call):
        return "call"
    raise TypeError(f"unsupported expression node: {type(node).__name__}")


def _expression_children(node):
    children = []
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.Slice):
            children.extend(_expression_children(child))
        elif isinstance(child, ast.keyword):
            children.extend(_expression_children(child))
        elif isinstance(child, ast.expr):
            children.append(child)
    return children


def _supports_fragment(node):
    if isinstance(node, ast.Slice):
        return all(_supports_fragment(child) for child in ast.iter_child_nodes(node))
    if isinstance(node, ast.keyword):
        return (
            node.arg is not None
            and node.value is not None
            and _supports_expression(node.value)
        )
    if isinstance(node, ast.expr):
        return _supports_expression(node)
    return False


def _supports_expression(node):
    if isinstance(node, ast.Name):
        return isinstance(node.ctx, ast.Load)
    if isinstance(node, ast.Constant):
        return True
    if isinstance(node, ast.Attribute):
        return isinstance(node.ctx, ast.Load) and _supports_expression(node.value)
    if isinstance(node, ast.Subscript):
        return (
            isinstance(node.ctx, ast.Load)
            and _supports_expression(node.value)
            and _supports_fragment(node.slice)
        )
    if isinstance(node, ast.UnaryOp):
        return _supports_expression(node.operand)
    if isinstance(node, ast.BinOp):
        return _supports_expression(node.left) and _supports_expression(node.right)
    if isinstance(node, ast.Call):
        return (
            _supports_expression(node.func)
            and not any(isinstance(argument, ast.Starred) for argument in node.args)
            and all(_supports_expression(argument) for argument in node.args)
            and all(_supports_fragment(keyword) for keyword in node.keywords)
        )
    return False


def _target_descriptor(target, source_code):
    descriptor = {
        "source": ast.get_source_segment(source_code, target) or "",
        "span": _span(target),
    }
    if not isinstance(target, ast.Subscript):
        return descriptor

    if (
        isinstance(target.value, ast.Name)
        and isinstance(target.slice, ast.expr)
        and not isinstance(target.slice, ast.Slice)
    ):
        descriptor["structureHint"] = {
            "kind": "list_index",
            "variableName": target.value.id,
            "indexSource": ast.get_source_segment(source_code, target.slice) or "",
        }
        return descriptor

    inner = target.value
    if (
        isinstance(inner, ast.Subscript)
        and isinstance(inner.value, ast.Name)
        and isinstance(inner.slice, ast.expr)
        and not isinstance(inner.slice, ast.Slice)
        and isinstance(target.slice, ast.expr)
        and not isinstance(target.slice, ast.Slice)
    ):
        descriptor["structureHint"] = {
            "kind": "matrix_cell",
            "variableName": inner.value.id,
            "rowSource": ast.get_source_segment(source_code, inner.slice) or "",
            "columnSource": ast.get_source_segment(source_code, target.slice) or "",
        }
    return descriptor


class _Planner(ast.NodeVisitor):
    def __init__(self, source_code):
        self.source_code = source_code
        self.plan = {"version": 1, "roots": [], "expressions": []}
        self.expression_metadata = {}
        self.minmax_call_nodes = set()
        self.root_ordinal = 0

    def visit_Assign(self, node):
        self._add_assignment_root(node.value, node.targets)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        self._add_assignment_root(node.value, [node.target])
        self.generic_visit(node)

    def visit_Return(self, node):
        self.root_ordinal += 1
        if node.value is not None and _supports_expression(node.value):
            root_id = f"r{self.root_ordinal}"
            expression_id = self._add_expression(root_id, node.value, None, (0,))
            self.plan["roots"].append(
                {
                    "rootId": root_id,
                    "kind": "return",
                    "expressionExprId": expression_id,
                    "span": _span(node.value),
                }
            )
        self.generic_visit(node)

    def _add_assignment_root(self, value, targets):
        self.root_ordinal += 1
        if (
            len(targets) != 1
            or value is None
            or not _supports_expression(value)
        ):
            return
        root_id = f"r{self.root_ordinal}"
        expression_id = self._add_expression(root_id, value, None, (0,))
        self.plan["roots"].append(
            {
                "rootId": root_id,
                "kind": "assignment",
                "expressionExprId": expression_id,
                "target": _target_descriptor(targets[0], self.source_code),
                "span": _span(value),
            }
        )

    def _add_expression(self, root_id, node, parent_expr_id, path):
        expression_id = f"{root_id}." + ".".join(str(part) for part in path)
        descriptor = {
            "exprId": expression_id,
            "rootId": root_id,
            "parentExprId": parent_expr_id,
            "kind": _kind(node),
            "span": _span(node),
            "source": ast.get_source_segment(self.source_code, node) or "",
            "childExprIds": [],
        }
        self.plan["expressions"].append(descriptor)
        self.expression_metadata[node] = (root_id, expression_id)

        child_nodes = _expression_children(node)
        for child_index, child in enumerate(child_nodes):
            child_id = self._add_expression(
                root_id, child, expression_id, path + (child_index,)
            )
            descriptor["childExprIds"].append(child_id)

        if isinstance(node, ast.Subscript):
            self._add_structure_hint(node, descriptor)
        if self._is_direct_minmax_call(node):
            self.minmax_call_nodes.add(node)
        return expression_id

    def _add_structure_hint(self, node, descriptor):
        if (
            isinstance(node.value, ast.Name)
            and isinstance(node.slice, ast.expr)
            and not isinstance(node.slice, ast.Slice)
        ):
            descriptor["structureHint"] = {
                "kind": "list_index",
                "variableName": node.value.id,
                "indexExprId": self.expression_metadata[node.slice][1],
            }
            return
        inner = node.value
        if (
            isinstance(inner, ast.Subscript)
            and isinstance(inner.value, ast.Name)
            and isinstance(inner.slice, ast.expr)
            and not isinstance(inner.slice, ast.Slice)
            and isinstance(node.slice, ast.expr)
            and not isinstance(node.slice, ast.Slice)
        ):
            descriptor["structureHint"] = {
                "kind": "matrix_cell",
                "variableName": inner.value.id,
                "rowExprId": self.expression_metadata[inner.slice][1],
                "columnExprId": self.expression_metadata[node.slice][1],
            }

    @staticmethod
    def _is_direct_minmax_call(node):
        return (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in {"min", "max"}
            and len(node.args) >= 2
            and not node.keywords
            and not any(isinstance(argument, ast.Starred) for argument in node.args)
        )


class _Instrumenter(ast.NodeTransformer):
    def __init__(
        self,
        expression_metadata,
        minmax_call_nodes,
        expression_record_name="__lc_expr_record",
        minmax_call_name="__lc_minmax_call",
    ):
        self.expression_metadata = expression_metadata
        self.minmax_call_nodes = minmax_call_nodes
        self.expression_record_name = expression_record_name
        self.minmax_call_name = minmax_call_name

    def _wrap(self, original_node, rewritten_node):
        metadata = self.expression_metadata.get(original_node)
        if metadata is None:
            return rewritten_node
        root_id, expression_id = metadata
        wrapped = ast.Call(
            func=ast.Name(id=self.expression_record_name, ctx=ast.Load()),
            args=[ast.Constant(root_id), ast.Constant(expression_id), rewritten_node],
            keywords=[],
        )
        return ast.copy_location(wrapped, original_node)

    def _visit_expression(self, node):
        return self._wrap(node, self.generic_visit(node))

    visit_Name = _visit_expression
    visit_Constant = _visit_expression
    visit_Attribute = _visit_expression
    visit_UnaryOp = _visit_expression
    visit_BinOp = _visit_expression
    visit_Subscript = _visit_expression

    def visit_Call(self, node):
        direct_minmax = node in self.minmax_call_nodes
        function_name = node.func.id if direct_minmax else None
        candidate_ids = (
            [self.expression_metadata[argument][1] for argument in node.args]
            if direct_minmax
            else []
        )
        rewritten = self.generic_visit(node)
        if direct_minmax:
            root_id, expression_id = self.expression_metadata[node]
            rewritten = ast.copy_location(
                ast.Call(
                    func=ast.Name(id=self.minmax_call_name, ctx=ast.Load()),
                    args=[
                        ast.Constant(root_id),
                        ast.Constant(expression_id),
                        rewritten.func,
                        ast.List(
                            elts=[ast.Constant(candidate_id) for candidate_id in candidate_ids],
                            ctx=ast.Load(),
                        ),
                        ast.List(elts=rewritten.args, ctx=ast.Load()),
                        ast.Constant(function_name),
                    ],
                    keywords=[],
                ),
                node,
            )
        return self._wrap(node, rewritten)


def instrument_expression_roots(
    source_code,
    expression_record_name="__lc_expr_record",
    minmax_call_name="__lc_minmax_call",
):
    try:
        original_tree = ast.parse(source_code)
    except (SyntaxError, TypeError, ValueError) as error:
        return InstrumentationResult(None, _EMPTY_PLAN.copy(), False, type(error).__name__)

    try:
        planner = _Planner(source_code)
        planner.visit(original_tree)
        instrumented_tree = _Instrumenter(
            planner.expression_metadata,
            planner.minmax_call_nodes,
            expression_record_name,
            minmax_call_name,
        ).visit(original_tree)
        ast.fix_missing_locations(instrumented_tree)
        return InstrumentationResult(instrumented_tree, planner.plan, True)
    except Exception:
        return InstrumentationResult(
            ast.parse(source_code), _EMPTY_PLAN.copy(), False, "instrumentation_failed"
        )

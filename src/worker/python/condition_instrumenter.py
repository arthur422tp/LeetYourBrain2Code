import ast
from dataclasses import dataclass


@dataclass
class ConditionInstrumentationResult:
    instrumented_tree: ast.AST | None
    plan_dict: dict
    available: bool
    reason: str | None = None


_EMPTY_PLAN = {"version": 1, "sites": [], "conditions": [], "operands": [], "chains": []}
_COMPARISON_OPERATORS = (
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
    ast.Is, ast.IsNot, ast.In, ast.NotIn,
)


def _span(node):
    return {
        "line": node.lineno,
        "column": node.col_offset,
        "endLine": node.end_lineno,
        "endColumn": node.end_col_offset,
    }


def _key(node):
    return (node.lineno, node.col_offset, node.end_lineno, node.end_col_offset)


def _source(source_code, node):
    return ast.get_source_segment(source_code, node) or ""


def _is_safe_index(node):
    if isinstance(node, ast.Name):
        return isinstance(node.ctx, ast.Load)
    if isinstance(node, ast.Constant):
        return type(node.value) is int
    return (
        isinstance(node, ast.UnaryOp)
        and isinstance(node.op, (ast.USub, ast.UAdd))
        and isinstance(node.operand, ast.Constant)
        and type(node.operand.value) is int
    )


def _is_safe_operand(node):
    if isinstance(node, ast.Name):
        return isinstance(node.ctx, ast.Load)
    if isinstance(node, ast.Constant):
        return True
    if isinstance(node, ast.Attribute):
        return isinstance(node.ctx, ast.Load) and _is_safe_operand(node.value)
    if isinstance(node, ast.Subscript):
        return (
            isinstance(node.ctx, ast.Load)
            and _is_safe_operand(node.value)
            and _is_safe_index(node.slice)
        )
    return False


def _condition_kind(node):
    if isinstance(node, ast.BoolOp):
        return "and" if isinstance(node.op, ast.And) else "or"
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return "not"
    if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], _COMPARISON_OPERATORS):
        if any(isinstance(item, ast.BoolOp) for item in [node.left, *node.comparators]):
            return "opaque"
        return "comparison"
    if isinstance(node, (ast.Name, ast.Constant, ast.Attribute, ast.Subscript)):
        return "truth_test"
    return "opaque"


class _Planner:
    def __init__(self, source_code):
        self.source_code = source_code
        self.plan = {"version": 1, "sites": [], "conditions": [], "operands": [], "chains": []}
        self.site_ordinal = 0
        self.chain_ordinal = 0

    def plan_tree(self, tree):
        self._visit_statements(tree.body)
        return self.plan

    def _visit_statements(self, statements):
        for statement in statements:
            if isinstance(statement, ast.If):
                self._visit_if_chain(statement)
            elif isinstance(statement, ast.While):
                self._visit_while(statement)
            else:
                self._visit_nested_statements(statement)

    def _visit_nested_statements(self, node):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.stmt):
                if isinstance(child, ast.If):
                    self._visit_if_chain(child)
                elif isinstance(child, ast.While):
                    self._visit_while(child)
                else:
                    self._visit_nested_statements(child)

    def _visit_while(self, node):
        self.site_ordinal += 1
        site_id = f"d{self.site_ordinal}"
        condition_id = self._add_condition(node.test, site_id, (0,))
        self.plan["sites"].append({
            "siteId": site_id,
            "kind": "while",
            "conditionId": condition_id,
            "span": _span(node.test),
        })
        self._visit_statements(node.body)
        self._visit_statements(node.orelse)

    def _visit_if_chain(self, node):
        has_chain = bool(node.orelse)
        if has_chain:
            self.chain_ordinal += 1
        chain_id = f"chain{self.chain_ordinal}" if has_chain else None
        branches = []
        current = node
        branch_index = 0
        while isinstance(current, ast.If):
            self.site_ordinal += 1
            site_id = f"d{self.site_ordinal}"
            condition_id = self._add_condition(current.test, site_id, (0,))
            site = {
                "siteId": site_id,
                "kind": "if" if branch_index == 0 else "elif",
                "branchIndex": branch_index,
                "conditionId": condition_id,
                "span": _span(current.test),
            }
            if chain_id is not None:
                site["chainId"] = chain_id
            self.plan["sites"].append(site)
            branches.append({
                "branchIndex": branch_index,
                "kind": "if" if branch_index == 0 else "elif",
                "siteId": site_id,
            })
            self._visit_statements(current.body)
            if len(current.orelse) == 1 and isinstance(current.orelse[0], ast.If) and current.orelse[0].col_offset == current.col_offset:
                current = current.orelse[0]
                branch_index += 1
                continue
            if current.orelse:
                branches.append({"branchIndex": branch_index + 1, "kind": "else"})
                self._visit_statements(current.orelse)
            current = None
        if has_chain:
            self.plan["chains"].append({"chainId": chain_id, "branches": branches})

    def _add_condition(self, node, site_id, path):
        condition_id = f"{site_id}.c" + ".".join(str(part) for part in path)
        kind = _condition_kind(node)
        descriptor = {
            "conditionId": condition_id,
            "siteId": site_id,
            "kind": kind,
            "source": _source(self.source_code, node),
            "span": _span(node),
            "childConditionIds": [],
            "operandIds": [],
        }
        self.plan["conditions"].append(descriptor)

        if kind in {"and", "or"}:
            for index, child in enumerate(node.values):
                descriptor["childConditionIds"].append(
                    self._add_condition(child, site_id, path + (index,))
                )
        elif kind == "not":
            descriptor["childConditionIds"].append(
                self._add_condition(node.operand, site_id, path + (0,))
            )
        elif kind == "comparison":
            self._add_atomic_operand(descriptor, node.left)
            self._add_atomic_operand(descriptor, node.comparators[0])
        elif kind == "truth_test" and _is_safe_operand(node):
            self._add_operand_with_structure(descriptor, node)
        return condition_id

    def _add_atomic_operand(self, condition, node):
        if _is_safe_operand(node):
            self._add_operand_with_structure(condition, node)

    def _add_operand(self, condition, node, structure_hint=None):
        operand_id = f"{condition['conditionId']}.o{len(condition['operandIds'])}"
        descriptor = {
            "operandId": operand_id,
            "conditionId": condition["conditionId"],
            "source": _source(self.source_code, node),
            "span": _span(node),
        }
        if structure_hint is not None:
            descriptor["structureHint"] = structure_hint
        self.plan["operands"].append(descriptor)
        condition["operandIds"].append(operand_id)
        return operand_id

    def _add_operand_with_structure(self, condition, node):
        if (
            isinstance(node, ast.Subscript)
            and isinstance(node.value, ast.Name)
            and _is_safe_index(node.slice)
        ):
            index_id = self._add_operand(condition, node.slice)
            return self._add_operand(condition, node, {
                "kind": "list_index",
                "variableName": node.value.id,
                "indexOperandId": index_id,
            })
        if (
            isinstance(node, ast.Subscript)
            and isinstance(node.value, ast.Subscript)
            and isinstance(node.value.value, ast.Name)
            and _is_safe_index(node.value.slice)
            and _is_safe_index(node.slice)
        ):
            row_id = self._add_operand(condition, node.value.slice)
            column_id = self._add_operand(condition, node.slice)
            return self._add_operand(condition, node, {
                "kind": "matrix_cell",
                "variableName": node.value.value.id,
                "rowOperandId": row_id,
                "columnOperandId": column_id,
            })
        return self._add_operand(condition, node)


class _Instrumenter(ast.NodeTransformer):
    def __init__(self, plan, begin_name, truth_name, operand_name, complete_name):
        self.plan = plan
        self.begin_name = begin_name
        self.truth_name = truth_name
        self.operand_name = operand_name
        self.complete_name = complete_name
        self.conditions = {item["conditionId"]: item for item in plan["conditions"]}
        self.operands = {item["operandId"]: item for item in plan["operands"]}
        self.sites = {_key_from_span(item["span"]): item for item in plan["sites"]}
        self.operands_by_span = {_key_from_span(item["span"]): item for item in plan["operands"]}

    def visit_If(self, node):
        site = self.sites.get(_key(node.test))
        node.body = [self.visit(statement) for statement in node.body]
        node.orelse = [self.visit(statement) for statement in node.orelse]
        if site is not None:
            rewritten = self._rewrite_condition(node.test, site["conditionId"], site["siteId"])
            node.test = self._complete(site, rewritten)
        return node

    def visit_While(self, node):
        site = self.sites.get(_key(node.test))
        node.body = [self.visit(statement) for statement in node.body]
        node.orelse = [self.visit(statement) for statement in node.orelse]
        if site is not None:
            rewritten = self._rewrite_condition(node.test, site["conditionId"], site["siteId"])
            node.test = self._complete(site, rewritten)
        return node

    def _call(self, name, args, location):
        return ast.copy_location(ast.Call(func=ast.Name(id=name, ctx=ast.Load()), args=args, keywords=[]), location)

    def _complete(self, site, rewritten):
        begin = self._call(self.begin_name, [ast.Constant(site["siteId"]), ast.Constant(site["conditionId"])], rewritten)
        guarded = ast.BoolOp(op=ast.And(), values=[begin, rewritten])
        guarded = ast.copy_location(guarded, rewritten)
        return self._call(
            self.complete_name,
            [ast.Constant(site["siteId"]), ast.Constant(site["kind"]), ast.Constant(site["conditionId"]), guarded],
            rewritten,
        )

    def _rewrite_condition(self, node, condition_id, site_id):
        descriptor = self.conditions.get(condition_id)
        if descriptor is None:
            return node
        kind = descriptor["kind"]
        if kind in {"and", "or"} and isinstance(node, ast.BoolOp):
            values = [
                self._rewrite_condition(child, child_id, site_id)
                for child, child_id in zip(node.values, descriptor["childConditionIds"])
            ]
            return ast.copy_location(ast.BoolOp(op=node.op, values=values), node)
        if kind == "not" and isinstance(node, ast.UnaryOp):
            child = self._rewrite_condition(node.operand, descriptor["childConditionIds"][0], site_id)
            return ast.copy_location(ast.UnaryOp(op=node.op, operand=child), node)
        if kind == "comparison" and isinstance(node, ast.Compare) and len(node.comparators) == 1:
            left = self._rewrite_operand(node.left, descriptor, site_id)
            right = self._rewrite_operand(node.comparators[0], descriptor, site_id)
            comparison = ast.copy_location(ast.Compare(left=left, ops=node.ops, comparators=[right]), node)
            return self._truth(site_id, condition_id, comparison)
        if kind == "truth_test":
            return self._truth(site_id, condition_id, self._rewrite_operand(node, descriptor, site_id))
        return self._truth(site_id, condition_id, node)

    def _rewrite_operand(self, node, condition, site_id):
        operand = self.operands_by_span.get(_key(node))
        if operand is None or operand["conditionId"] != condition["conditionId"]:
            return node
        rewritten = node
        hint = operand.get("structureHint")
        if hint and hint["kind"] == "list_index" and isinstance(node, ast.Subscript):
            index = self._coordinate(node.slice, hint["indexOperandId"], site_id, condition["conditionId"])
            rewritten = ast.copy_location(ast.Subscript(value=node.value, slice=index, ctx=node.ctx), node)
        elif hint and hint["kind"] == "matrix_cell" and isinstance(node, ast.Subscript) and isinstance(node.value, ast.Subscript):
            row = self._coordinate(node.value.slice, hint["rowOperandId"], site_id, condition["conditionId"])
            column = self._coordinate(node.slice, hint["columnOperandId"], site_id, condition["conditionId"])
            inner = ast.copy_location(ast.Subscript(value=node.value.value, slice=row, ctx=node.value.ctx), node.value)
            rewritten = ast.copy_location(ast.Subscript(value=inner, slice=column, ctx=node.ctx), node)
        return self._call(
            self.operand_name,
            [ast.Constant(site_id), ast.Constant(condition["conditionId"]), ast.Constant(operand["operandId"]), rewritten],
            node,
        )

    def _coordinate(self, node, operand_id, site_id, condition_id):
        return self._call(
            self.operand_name,
            [ast.Constant(site_id), ast.Constant(condition_id), ast.Constant(operand_id), node],
            node,
        )

    def _truth(self, site_id, condition_id, node):
        return self._call(
            self.truth_name,
            [ast.Constant(site_id), ast.Constant(condition_id), node],
            node,
        )


def _key_from_span(span):
    return (span["line"], span["column"], span["endLine"], span["endColumn"])


def instrument_condition_sites(source_code, base_tree, begin_name, truth_name, operand_name, complete_name):
    try:
        original_tree = ast.parse(source_code)
    except (SyntaxError, TypeError, ValueError) as error:
        return ConditionInstrumentationResult(base_tree, _EMPTY_PLAN.copy(), False, type(error).__name__)
    if base_tree is None:
        return ConditionInstrumentationResult(None, _EMPTY_PLAN.copy(), False, "missing_base_tree")
    try:
        planner = _Planner(source_code)
        plan = planner.plan_tree(original_tree)
        instrumented_tree = _Instrumenter(
            plan, begin_name, truth_name, operand_name, complete_name
        ).visit(base_tree)
        ast.fix_missing_locations(instrumented_tree)
        return ConditionInstrumentationResult(instrumented_tree, plan, True)
    except Exception:
        return ConditionInstrumentationResult(base_tree, _EMPTY_PLAN.copy(), False, "instrumentation_failed")

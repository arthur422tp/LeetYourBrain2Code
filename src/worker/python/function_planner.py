import ast
from dataclasses import dataclass, field
from types import CodeType


@dataclass
class FunctionPlanningResult:
    plan_dict: dict
    available: bool
    reason: str | None = None
    runtime_lookup: dict[tuple[str, int], str | None] = field(default_factory=dict)


def _span(node):
    return {
        "line": node.lineno,
        "column": node.col_offset,
        "endLine": node.end_lineno,
        "endColumn": node.end_col_offset,
    }


def _first_body_line(node):
    meaningful_statements = [
        statement for statement in node.body if not isinstance(statement, ast.Pass)
    ]
    if not meaningful_statements:
        return None
    return meaningful_statements[0].lineno


def _parameters(node):
    arguments = node.args
    names = []
    kinds = []

    for argument in arguments.posonlyargs:
        names.append(argument.arg)
        kinds.append("positional_only")
    for argument in arguments.args:
        names.append(argument.arg)
        kinds.append("positional_or_keyword")
    if arguments.vararg is not None:
        names.append(arguments.vararg.arg)
        kinds.append("varargs")
    for argument in arguments.kwonlyargs:
        names.append(argument.arg)
        kinds.append("keyword_only")
    if arguments.kwarg is not None:
        names.append(arguments.kwarg.arg)
        kinds.append("varkw")

    return names, kinds


class _FunctionPlanner(ast.NodeVisitor):
    def __init__(self):
        self.functions = []
        self.class_stack = []
        self.function_stack = []
        self.function_name_stack = []
        self.function_ordinal = 0
        self.runtime_lookup = {}

    def visit_ClassDef(self, node):
        self.class_stack.append(node.name)
        for statement in node.body:
            self.visit(statement)
        self.class_stack.pop()

    def visit_FunctionDef(self, node):
        self._record_function(node)

    def visit_AsyncFunctionDef(self, node):
        self._record_function(node)

    def _record_function(self, node):
        self.function_ordinal += 1
        if self.function_stack:
            kind = "nested_function"
        elif self.class_stack:
            kind = "method"
        else:
            kind = "function"

        lexical_path = [*self.class_stack, *self.function_name_stack, node.name]
        qualified_name = ".".join(lexical_path)
        function_id = (
            f"{kind}:{qualified_name}:{node.lineno}:{node.col_offset}:"
            f"{self.function_ordinal}"
        )
        parameter_names, parameter_kinds = _parameters(node)
        descriptor = {
            "functionId": function_id,
            "kind": kind,
            "name": node.name,
            "qualifiedName": qualified_name,
            "span": _span(node),
            "firstBodyLine": _first_body_line(node),
            "parameterNames": parameter_names,
            "parameterKinds": parameter_kinds,
        }
        if self.function_stack:
            descriptor["parentFunctionId"] = self.function_stack[-1]
        if self.class_stack:
            descriptor["parentClassName"] = ".".join(self.class_stack)

        self.functions.append(descriptor)
        lookup_key = (node.name, node.lineno)
        if lookup_key in self.runtime_lookup:
            self.runtime_lookup[lookup_key] = None
        else:
            self.runtime_lookup[lookup_key] = function_id

        self.function_stack.append(function_id)
        self.function_name_stack.append(node.name)
        for statement in node.body:
            self.visit(statement)
        self.function_name_stack.pop()
        self.function_stack.pop()


def plan_user_functions(source_code: str) -> FunctionPlanningResult:
    try:
        tree = ast.parse(source_code)
        planner = _FunctionPlanner()
        planner.visit(tree)
        return FunctionPlanningResult(
            plan_dict={"version": 1, "functions": planner.functions},
            available=True,
            runtime_lookup=planner.runtime_lookup,
        )
    except SyntaxError:
        raise
    except Exception as error:
        return FunctionPlanningResult(
            plan_dict={"version": 1, "functions": []},
            available=False,
            reason=f"{type(error).__name__}: {error}",
        )


def _normalized_qualified_name(value):
    return value.replace(".<locals>.", ".")


def _code_objects(code):
    yield code
    for constant in code.co_consts:
        if isinstance(constant, CodeType):
            yield from _code_objects(constant)


def build_runtime_function_mapper(function_plan, user_code):
    """Map compiled user code objects to static descriptors without guessing."""
    if not isinstance(function_plan, dict) or not isinstance(user_code, CodeType):
        return lambda _frame: None

    descriptors = function_plan.get("functions")
    if not isinstance(descriptors, list):
        return lambda _frame: None

    by_identity = {}
    ambiguous = set()
    for descriptor in descriptors:
        if not isinstance(descriptor, dict):
            continue
        name = descriptor.get("name")
        qualified_name = descriptor.get("qualifiedName", descriptor.get("qualified_name"))
        span = descriptor.get("span")
        line = span.get("line") if isinstance(span, dict) else None
        if not isinstance(name, str) or not isinstance(qualified_name, str) or not isinstance(line, int):
            continue
        key = (name, _normalized_qualified_name(qualified_name), line)
        if key in by_identity:
            ambiguous.add(key)
        else:
            by_identity[key] = descriptor

    mapped = {}
    for code in _code_objects(user_code):
        key = (
            code.co_name,
            _normalized_qualified_name(code.co_qualname),
            code.co_firstlineno,
        )
        if key in ambiguous:
            continue
        descriptor = by_identity.get(key)
        if descriptor is not None:
            mapped[id(code)] = descriptor

    return lambda frame: mapped.get(id(frame.f_code))

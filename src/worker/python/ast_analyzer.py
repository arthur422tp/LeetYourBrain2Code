import ast
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class SubscriptRelation:
    scope: str
    line: int
    container: str
    index: str


@dataclass(frozen=True)
class MatrixIndexOperand:
    kind: str
    name: str | None = None
    value: int | None = None


@dataclass(frozen=True)
class MatrixSubscriptRelation:
    kind: str
    scope: str
    line: int
    container: str
    rowIndex: MatrixIndexOperand
    columnIndex: MatrixIndexOperand


@dataclass(frozen=True)
class IterationRelation:
    kind: str
    scope: str
    line: int
    container: str
    index: str
    value: str | None = None


@dataclass(frozen=True)
class MembershipRelation:
    kind: str
    scope: str
    line: int
    container: str
    index: str


class _SubscriptRelationVisitor(ast.NodeVisitor):
    def __init__(self):
        self.scope = []
        self.relations = []

    def _scope_name(self):
        return ".".join(self.scope) if self.scope else "<module>"

    def _visit_scoped_body(self, name, body):
        self.scope.append(name)
        try:
            for statement in body:
                self.visit(statement)
        finally:
            self.scope.pop()

    def visit_ClassDef(self, node):
        self._visit_scoped_body(node.name, node.body)

    def visit_FunctionDef(self, node):
        self._visit_scoped_body(node.name, node.body)

    def visit_AsyncFunctionDef(self, node):
        self._visit_scoped_body(node.name, node.body)

    def visit_Lambda(self, node):
        self._visit_scoped_body("<lambda>", [node.body])

    def visit_For(self, node):
        iterator = node.iter
        target = node.target
        if isinstance(iterator, ast.Call) and isinstance(iterator.func, ast.Name):
            if (
                iterator.func.id == "enumerate"
                and len(iterator.args) in (1, 2)
                and isinstance(iterator.args[0], ast.Name)
                and (
                    len(iterator.args) == 1
                    or (
                        isinstance(iterator.args[1], ast.Constant)
                        and iterator.args[1].value == 0
                    )
                )
                and isinstance(target, (ast.Tuple, ast.List))
                and len(target.elts) == 2
                and all(isinstance(element, ast.Name) for element in target.elts)
            ):
                self.relations.append(
                    IterationRelation(
                        kind="iteration",
                        scope=self._scope_name(),
                        line=node.lineno,
                        container=iterator.args[0].id,
                        index=target.elts[0].id,
                        value=target.elts[1].id,
                    )
                )
            elif (
                iterator.func.id == "range"
                and len(iterator.args) == 1
                and isinstance(iterator.args[0], ast.Call)
                and isinstance(iterator.args[0].func, ast.Name)
                and iterator.args[0].func.id == "len"
                and len(iterator.args[0].args) == 1
                and isinstance(iterator.args[0].args[0], ast.Name)
                and isinstance(target, ast.Name)
            ):
                self.relations.append(
                    IterationRelation(
                        kind="iteration",
                        scope=self._scope_name(),
                        line=node.lineno,
                        container=iterator.args[0].args[0].id,
                        index=target.id,
                    )
                )
        self.generic_visit(node)

    def visit_Compare(self, node):
        if (
            len(node.ops) == 1
            and isinstance(node.ops[0], ast.In)
            and isinstance(node.left, ast.Name)
            and len(node.comparators) == 1
            and isinstance(node.comparators[0], ast.Name)
        ):
            self.relations.append(
                MembershipRelation(
                    kind="membership",
                    scope=self._scope_name(),
                    line=node.lineno,
                    container=node.comparators[0].id,
                    index=node.left.id,
                )
            )
        self.generic_visit(node)

    def visit_Subscript(self, node):
        if isinstance(node.value, ast.Subscript) and isinstance(node.value.value, ast.Name):
            row_index = _matrix_index_operand(node.value.slice)
            column_index = _matrix_index_operand(node.slice)
            if row_index is not None and column_index is not None:
                self.relations.append(
                    MatrixSubscriptRelation(
                        kind="matrix_subscript",
                        scope=self._scope_name(),
                        line=node.lineno,
                        container=node.value.value.id,
                        rowIndex=row_index,
                        columnIndex=column_index,
                    )
                )
        if isinstance(node.value, ast.Name) and isinstance(node.slice, ast.Name):
            self.relations.append(
                SubscriptRelation(
                    scope=self._scope_name(),
                    line=node.lineno,
                    container=node.value.id,
                    index=node.slice.id,
                )
            )
        self.generic_visit(node)


def _matrix_index_operand(node):
    if isinstance(node, ast.Name):
        return MatrixIndexOperand(kind="variable", name=node.id)
    if isinstance(node, ast.Constant) and type(node.value) is int:
        return MatrixIndexOperand(kind="literal", value=node.value)
    if (
        isinstance(node, ast.UnaryOp)
        and isinstance(node.op, (ast.USub, ast.UAdd))
        and isinstance(node.operand, ast.Constant)
        and type(node.operand.value) is int
    ):
        sign = -1 if isinstance(node.op, ast.USub) else 1
        return MatrixIndexOperand(kind="literal", value=sign * node.operand.value)
    return None


def analyze_subscript_relations(source_code):
    try:
        tree = ast.parse(source_code, filename="<leetcode-user-code>")
    except (SyntaxError, TypeError, ValueError, MemoryError):
        return []

    visitor = _SubscriptRelationVisitor()
    visitor.visit(tree)
    return visitor.relations


def extract_subscript_relations(source_code):
    return analyze_subscript_relations(source_code)


def relations_as_dicts(relations):
    return [
        {key: value for key, value in asdict(relation).items() if value is not None}
        for relation in relations
    ]

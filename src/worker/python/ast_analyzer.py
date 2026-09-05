import ast
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class SubscriptRelation:
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

    def visit_Subscript(self, node):
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
    return [asdict(relation) for relation in relations]

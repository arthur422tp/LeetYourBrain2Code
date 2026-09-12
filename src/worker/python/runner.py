import ast
import contextlib
import io
import time
import traceback

from tracer import TraceCollector, TraceLimitExceeded, USER_CODE_FILENAME, _limit
from ast_analyzer import analyze_subscript_relations, relations_as_dicts


class UnsupportedTestcaseFormat(Exception):
    pass


class _FallbackListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next


class _FallbackTreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


class _FallbackGraphNode:
    def __init__(self, val=0, neighbors=None):
        self.val = val
        self.neighbors = neighbors if neighbors is not None else []


class _LeetCodeNullTransformer(ast.NodeTransformer):
    def visit_Name(self, node):
        if node.id == "null":
            return ast.copy_location(ast.Constant(value=None), node)
        return node


def _literal_eval_argument(line, parameter_kind):
    if parameter_kind != "binary_tree":
        return ast.literal_eval(line)

    expression = ast.parse(line, mode="eval")
    expression = _LeetCodeNullTransformer().visit(expression)
    ast.fix_missing_locations(expression)
    return ast.literal_eval(expression)


def _build_linked_list(values, node_class):
    head = None
    tail = None
    for value in values:
        node = node_class(value)
        if head is None:
            head = node
        else:
            tail.next = node
        tail = node
    return head


def _build_binary_tree(values, node_class):
    if values is None:
        return None
    if not isinstance(values, list):
        raise UnsupportedTestcaseFormat(
            "binary-tree parameters require a literal list or None"
        )
    if len(values) == 0:
        return None
    if values[0] is None:
        if any(value is not None for value in values[1:]):
            raise UnsupportedTestcaseFormat(
                "binary-tree input cannot contain nodes after an empty root"
            )
        return None

    try:
        root = node_class(values[0])
    except Exception as error:
        raise UnsupportedTestcaseFormat(
            "binary-tree values could not construct a TreeNode"
        ) from error

    nodes = [root]
    value_index = 1
    parent_index = 0
    while parent_index < len(nodes) and value_index < len(values):
        parent = nodes[parent_index]

        left_value = values[value_index]
        value_index += 1
        if left_value is not None:
            try:
                parent.left = node_class(left_value)
            except Exception as error:
                raise UnsupportedTestcaseFormat(
                    "binary-tree values could not construct a TreeNode"
                ) from error
            nodes.append(parent.left)

        if value_index < len(values):
            right_value = values[value_index]
            value_index += 1
            if right_value is not None:
                try:
                    parent.right = node_class(right_value)
                except Exception as error:
                    raise UnsupportedTestcaseFormat(
                        "binary-tree values could not construct a TreeNode"
                    ) from error
                nodes.append(parent.right)

        parent_index += 1

    if any(value is not None for value in values[value_index:]):
        raise UnsupportedTestcaseFormat(
            "binary-tree input contains unreachable level-order values"
        )
    return root


def _build_graph(adjacency, node_class):
    if adjacency is None:
        return None
    if not isinstance(adjacency, list):
        raise UnsupportedTestcaseFormat(
            "graph parameters require an adjacency-list literal"
        )
    if len(adjacency) == 0:
        return None
    if any(not isinstance(row, list) for row in adjacency):
        raise UnsupportedTestcaseFormat("graph adjacency entries must be lists")

    nodes = []
    try:
        for index in range(len(adjacency)):
            nodes.append(node_class(index + 1))
    except Exception as error:
        raise UnsupportedTestcaseFormat(
            "graph values could not construct a Node"
        ) from error

    for source_index, row in enumerate(adjacency):
        neighbors = []
        for neighbor in row:
            if isinstance(neighbor, bool) or not isinstance(neighbor, int):
                raise UnsupportedTestcaseFormat(
                    "graph neighbor indexes must be integers"
                )
            if neighbor < 1 or neighbor > len(nodes):
                raise UnsupportedTestcaseFormat(
                    "graph neighbor index is out of range"
                )
            neighbors.append(nodes[neighbor - 1])
        nodes[source_index].neighbors = neighbors

    return nodes[0]


def _exception_info(error):
    line = getattr(error, "lineno", None)
    if line is None:
        traceback_object = error.__traceback__
        while traceback_object is not None:
            if traceback_object.tb_frame.f_code.co_filename == USER_CODE_FILENAME:
                line = traceback_object.tb_lineno
            traceback_object = traceback_object.tb_next
    return {
        "type": type(error).__name__,
        "message": str(error),
        "line": line,
        "stack": traceback.format_tb(error.__traceback__),
        "frame_id": None,
    }


def _empty_result(status, termination_reason, stdout="", events=None, **extra):
    result = {
        "status": status,
        "termination_reason": termination_reason,
        "stdout": stdout,
        "events": events or [],
    }
    result.update(extra)
    return result


def _argument_lines(raw_testcase):
    return [
        line.strip()
        for line in raw_testcase.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        if line.strip()
    ]


def _truncate_stdout(stdout, limits):
    max_bytes = max(0, int(_limit(limits, "max_stdout_bytes", "maxStdoutBytes", 64_000)))
    encoded = stdout.encode("utf-8")
    if len(encoded) <= max_bytes:
        return stdout
    return encoded[:max_bytes].decode("utf-8", errors="ignore")


def run_request(
    source_code,
    raw_testcase,
    entrypoint,
    limits,
    runtime_globals=None,
    session_id="session",
    emit_batch=None,
):
    started_at = time.monotonic()
    lines = _argument_lines(raw_testcase)
    parameter_count = int(entrypoint.get("parameter_count", entrypoint.get("parameterCount", -1)))
    parameter_kinds = entrypoint.get("parameter_kinds", entrypoint.get("parameterKinds", []))
    if not isinstance(parameter_kinds, list):
        parameter_kinds = []

    try:
        arguments = [
            _literal_eval_argument(
                line,
                parameter_kinds[index] if index < len(parameter_kinds) else "value",
            )
            for index, line in enumerate(lines)
        ]
    except (SyntaxError, ValueError, TypeError, MemoryError) as error:
        return _empty_result(
            "input_error",
            "unsupported_testcase_format",
            exception=_exception_info(error),
        )

    if len(arguments) != parameter_count:
        return _empty_result("input_error", "unsupported_testcase_format")

    try:
        user_code = compile(source_code, USER_CODE_FILENAME, "exec")
    except SyntaxError as error:
        return _empty_result(
            "parse_error",
            "syntax_error",
            exception=_exception_info(error),
        )

    subscript_relations = relations_as_dicts(analyze_subscript_relations(source_code))

    namespace = runtime_globals if runtime_globals is not None else {}
    baseline_global_names = set(namespace)
    stdout_buffer = io.StringIO()
    collector = TraceCollector(
        limits,
        stdout_buffer,
        baseline_global_names,
        session_id=session_id,
        emit_batch=emit_batch,
    )
    return_value = None

    collector.start()
    try:
        with contextlib.redirect_stdout(stdout_buffer):
            exec(user_code, namespace, namespace)
            node_class = namespace.get("ListNode", _FallbackListNode)
            tree_node_class = namespace.get("TreeNode", _FallbackTreeNode)
            graph_node_class = namespace.get("Node", _FallbackGraphNode)
            converted_arguments = []
            for index, argument in enumerate(arguments):
                parameter_kind = parameter_kinds[index] if index < len(parameter_kinds) else "value"
                if parameter_kind == "binary_tree":
                    converted_arguments.append(_build_binary_tree(argument, tree_node_class))
                    continue
                if parameter_kind == "graph_node":
                    converted_arguments.append(_build_graph(argument, graph_node_class))
                    continue
                if parameter_kind != "linked_list":
                    converted_arguments.append(argument)
                    continue
                if argument is None:
                    converted_arguments.append(None)
                elif isinstance(argument, list):
                    converted_arguments.append(_build_linked_list(argument, node_class))
                else:
                    raise UnsupportedTestcaseFormat(
                        "linked-list parameters require a literal list or None"
                    )
            instance = namespace[entrypoint["class_name"]]
            method = getattr(instance(), entrypoint["method_name"])
            return_value = method(*converted_arguments)
    except TraceLimitExceeded as error:
        return _empty_result(
            "trace_limit",
            error.reason,
            stdout=_truncate_stdout(stdout_buffer.getvalue(), limits),
            events=collector.events,
            subscript_relations=subscript_relations,
        )
    except UnsupportedTestcaseFormat as error:
        return _empty_result(
            "input_error",
            "unsupported_testcase_format",
            stdout=_truncate_stdout(stdout_buffer.getvalue(), limits),
            events=collector.events,
            subscript_relations=subscript_relations,
            exception=_exception_info(error),
        )
    except Exception as error:
        exception = collector.last_exception or _exception_info(error)
        return _empty_result(
            "exception",
            "runtime_exception",
            stdout=_truncate_stdout(stdout_buffer.getvalue(), limits),
            events=collector.events,
            subscript_relations=subscript_relations,
            exception=exception,
        )
    finally:
        collector.stop()
        collector.flush()

    return _empty_result(
        "completed",
        "normal_return",
        stdout=_truncate_stdout(stdout_buffer.getvalue(), limits),
        events=collector.events,
        subscript_relations=subscript_relations,
        return_value=collector.serialize_value(return_value),
        duration_ms=(time.monotonic() - started_at) * 1000,
    )

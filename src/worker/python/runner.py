import ast
import contextlib
import io
import json
import secrets
import time
import traceback
import types
import warnings

from tracer import TraceCollector, TraceLimitExceeded, USER_CODE_FILENAME, _limit
from ast_analyzer import analyze_subscript_relations, relations_as_dicts
from expression_instrumenter import instrument_expression_roots
from expression_recorder import ExpressionRecorder
from condition_instrumenter import instrument_condition_sites
from decision_recorder import DecisionRecorder
from control_flow_instrumenter import instrument_control_flow
from control_flow_recorder import ControlFlowRecorder
from function_planner import plan_user_functions


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


class _ExpressionHelperLookupTransformer(ast.NodeTransformer):
    def __init__(self, capabilities):
        self.capabilities = capabilities

    def visit_Name(self, node):
        if not isinstance(node.ctx, ast.Load) or node.id not in self.capabilities:
            return node
        return ast.copy_location(ast.Constant(value=self.capabilities[node.id][0]), node)


def _bind_expression_capabilities(code, capabilities):
    constants = []
    changed = False
    for value in code.co_consts:
        if isinstance(value, types.CodeType):
            bound_value = _bind_expression_capabilities(value, capabilities)
        else:
            bound_value = capabilities.get(value, value)
        changed = changed or bound_value is not value
        constants.append(bound_value)
    return code.replace(co_consts=tuple(constants)) if changed else code


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


def _emit_expression_plan(emit_plan, session_id, plan):
    if emit_plan is None:
        return
    try:
        emit_plan(session_id, json.dumps(plan, ensure_ascii=False, separators=(",", ":")))
    except Exception:
        pass


def _emit_condition_plan(emit_plan, session_id, plan):
    if emit_plan is None:
        return
    try:
        emit_plan(session_id, json.dumps(plan, ensure_ascii=False, separators=(",", ":")))
    except Exception:
        pass


def _emit_control_flow_plan(emit_plan, session_id, plan):
    if emit_plan is None:
        return
    try:
        emit_plan(session_id, json.dumps(plan, ensure_ascii=False, separators=(",", ":")))
    except Exception:
        pass


def run_request(
    source_code,
    raw_testcase,
    entrypoint,
    limits,
    runtime_globals=None,
    session_id="session",
    emit_batch=None,
    emit_expression_plan=None,
    emit_expression_batch=None,
    emit_condition_plan=None,
    emit_decision_batch=None,
    emit_control_flow_plan=None,
    emit_control_flow_batch=None,
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

    recorder = ExpressionRecorder(
        limits,
        lambda: None,
        session_id=session_id,
        emit_batch=emit_expression_batch,
    )
    decision_recorder = DecisionRecorder(
        limits,
        lambda: None,
        session_id=session_id,
        emit_batch=emit_decision_batch,
    )
    control_recorder = ControlFlowRecorder(
        limits,
        session_id=session_id,
        emit_batch=emit_control_flow_batch,
    )
    expression_record_name = f"_lc_internal_expr_record_{secrets.token_hex(16)}"
    minmax_call_name = f"_lc_internal_minmax_call_{secrets.token_hex(16)}"
    decision_begin_name = f"_lc_internal_decision_begin_{secrets.token_hex(16)}"
    condition_truth_name = f"_lc_internal_condition_truth_{secrets.token_hex(16)}"
    condition_operand_name = f"_lc_internal_condition_operand_{secrets.token_hex(16)}"
    decision_complete_name = f"_lc_internal_decision_complete_{secrets.token_hex(16)}"
    control_iteration_begin_name = f"_lc_internal_control_iteration_begin_{secrets.token_hex(16)}"
    control_iteration_complete_name = f"_lc_internal_control_iteration_complete_{secrets.token_hex(16)}"
    control_transfer_observed_name = f"_lc_internal_control_transfer_observed_{secrets.token_hex(16)}"
    control_return_observed_name = f"_lc_internal_control_return_observed_{secrets.token_hex(16)}"
    control_loop_natural_exit_name = f"_lc_internal_control_loop_natural_exit_{secrets.token_hex(16)}"
    control_loop_after_name = f"_lc_internal_control_loop_after_{secrets.token_hex(16)}"
    instrumentation = instrument_expression_roots(
        source_code,
        expression_record_name=expression_record_name,
        minmax_call_name=minmax_call_name,
    )
    expression_plan = instrumentation.plan_dict
    try:
        expression_tree = instrumentation.instrumented_tree if instrumentation.available else ast.parse(source_code)
    except (SyntaxError, TypeError, ValueError) as error:
        return _empty_result(
            "parse_error",
            "syntax_error",
            exception=_exception_info(error),
            expression_plan=expression_plan,
        )
    condition = instrument_condition_sites(
        source_code,
        expression_tree,
        decision_begin_name,
        condition_truth_name,
        condition_operand_name,
        decision_complete_name,
    )
    condition_plan = condition.plan_dict if condition.available else None
    function_plan = plan_user_functions(source_code).plan_dict
    try:
        decision_tree = condition.instrumented_tree if condition.available else expression_tree
        control = instrument_control_flow(
            source_code,
            decision_tree,
            control_iteration_begin_name,
            control_iteration_complete_name,
            control_transfer_observed_name,
            control_return_observed_name,
            control_loop_natural_exit_name,
            control_loop_after_name,
        )
        control_plan = control.plan_dict
        instrumented_tree = control.instrumented_tree if control.available else decision_tree
        capabilities = {}
        if instrumentation.available:
            capabilities = {
                expression_record_name: (f"<lc-expr-{secrets.token_hex(16)}>", recorder.record_value),
                minmax_call_name: (f"<lc-minmax-{secrets.token_hex(16)}>", recorder.record_minmax_call),
            }
        if condition.available:
            capabilities.update({
                decision_begin_name: (f"<lc-decision-begin-{secrets.token_hex(16)}>", decision_recorder.begin),
                condition_truth_name: (f"<lc-condition-truth-{secrets.token_hex(16)}>", decision_recorder.record_truth),
                condition_operand_name: (f"<lc-condition-operand-{secrets.token_hex(16)}>", decision_recorder.record_operand),
                decision_complete_name: (f"<lc-decision-complete-{secrets.token_hex(16)}>", decision_recorder.complete),
            })
        if control.available:
            capabilities.update({
                control_iteration_begin_name: (f"<lc-control-iteration-begin-{secrets.token_hex(16)}>", control_recorder.iteration_begin),
                control_iteration_complete_name: (f"<lc-control-iteration-complete-{secrets.token_hex(16)}>", control_recorder.iteration_complete),
                control_transfer_observed_name: (f"<lc-control-transfer-observed-{secrets.token_hex(16)}>", control_recorder.transfer_observed),
                control_return_observed_name: (f"<lc-control-return-observed-{secrets.token_hex(16)}>", control_recorder.return_observed),
                control_loop_natural_exit_name: (f"<lc-control-loop-natural-exit-{secrets.token_hex(16)}>", control_recorder.loop_natural_exit),
                control_loop_after_name: (f"<lc-control-loop-after-{secrets.token_hex(16)}>", control_recorder.loop_after),
            })
        if capabilities:
            instrumented_tree = _ExpressionHelperLookupTransformer(capabilities).visit(instrumented_tree)
            ast.fix_missing_locations(instrumented_tree)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", SyntaxWarning)
            user_code = compile(
                instrumented_tree,
                USER_CODE_FILENAME,
                "exec",
            )
        if capabilities:
            user_code = _bind_expression_capabilities(
                user_code,
                {marker: helper for marker, helper in capabilities.values()},
            )
    except SyntaxError as error:
        return _empty_result(
            "parse_error",
            "syntax_error",
            exception=_exception_info(error),
            control_flow_plan=control_plan,
            function_plan=function_plan,
        )

    subscript_relations = relations_as_dicts(analyze_subscript_relations(source_code))

    namespace = runtime_globals if runtime_globals is not None else {}
    if not instrumentation.available:
        recorder.status = "unavailable"
        recorder.reason = instrumentation.reason
    if not control.available:
        control_recorder.status = "unavailable"
        control_recorder.reason = control.reason
    baseline_global_names = set(namespace)
    stdout_buffer = io.StringIO()
    collector = TraceCollector(
        limits,
        stdout_buffer,
        baseline_global_names,
        session_id=session_id,
        emit_batch=emit_batch,
        expression_recorder=recorder,
        decision_recorder=decision_recorder,
        control_flow_recorder=control_recorder,
        synthetic_line_map=control.synthetic_line_map if control.available else {},
    )
    recorder.serializer_factory = lambda: collector.serialize_value
    recorder.frame_id_for = collector.expression_frame_id
    recorder.root_expression_ids = {
        root["rootId"]: root["expressionExprId"]
        for root in expression_plan["roots"]
    }
    decision_recorder.serializer_factory = lambda: collector.serialize_value
    decision_recorder.frame_id_for = collector.expression_frame_id
    control_recorder.serializer_factory = lambda: collector.serialize_value
    control_recorder.frame_id_for = collector.expression_frame_id
    control_recorder.anchor_step_for = collector.control_flow_anchor_step
    decision_recorder.context_provider = control_recorder.current_execution_context
    if not condition.available:
        decision_recorder.status = "unavailable"
        decision_recorder.reason = condition.reason
    return_value = None

    if instrumentation.available:
        _emit_expression_plan(emit_expression_plan, session_id, expression_plan)
    if condition.available:
        _emit_condition_plan(emit_condition_plan, session_id, condition_plan)
    if control.available:
        _emit_control_flow_plan(emit_control_flow_plan, session_id, control_plan)

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
        control_recorder.finalize_trace_ended()
        recorder.flush_all()
        decision_recorder.flush_all()
        return _empty_result(
            "trace_limit",
            error.reason,
            stdout=_truncate_stdout(stdout_buffer.getvalue(), limits),
            events=collector.events,
            subscript_relations=subscript_relations,
            expression_plan=expression_plan,
            control_flow_plan=control_plan,
            function_plan=function_plan,
            **({"condition_plan": condition_plan} if condition_plan is not None else {}),
            **recorder.result_dict(),
            **decision_recorder.result_dict(),
            **control_recorder.result_dict(),
        )
    except UnsupportedTestcaseFormat as error:
        control_recorder.finalize_exception()
        recorder.flush_all()
        decision_recorder.flush_all()
        return _empty_result(
            "input_error",
            "unsupported_testcase_format",
            stdout=_truncate_stdout(stdout_buffer.getvalue(), limits),
            events=collector.events,
            subscript_relations=subscript_relations,
            exception=_exception_info(error),
            expression_plan=expression_plan,
            control_flow_plan=control_plan,
            function_plan=function_plan,
            **({"condition_plan": condition_plan} if condition_plan is not None else {}),
            **recorder.result_dict(),
            **decision_recorder.result_dict(),
            **control_recorder.result_dict(),
        )
    except Exception as error:
        control_recorder.finalize_exception()
        recorder.flush_all()
        decision_recorder.flush_all()
        exception = collector.last_exception or _exception_info(error)
        return _empty_result(
            "exception",
            "runtime_exception",
            stdout=_truncate_stdout(stdout_buffer.getvalue(), limits),
            events=collector.events,
            subscript_relations=subscript_relations,
            exception=exception,
            expression_plan=expression_plan,
            control_flow_plan=control_plan,
            function_plan=function_plan,
            **({"condition_plan": condition_plan} if condition_plan is not None else {}),
            **recorder.result_dict(),
            **decision_recorder.result_dict(),
            **control_recorder.result_dict(),
        )
    finally:
        collector.stop()
        collector.flush()
        recorder.flush_all()
        decision_recorder.flush_all()

    return _empty_result(
        "completed",
        "normal_return",
        stdout=_truncate_stdout(stdout_buffer.getvalue(), limits),
        events=collector.events,
        subscript_relations=subscript_relations,
        expression_plan=expression_plan,
        control_flow_plan=control_plan,
        function_plan=function_plan,
        **({"condition_plan": condition_plan} if condition_plan is not None else {}),
        **recorder.result_dict(),
        **decision_recorder.result_dict(),
        **control_recorder.result_dict(),
        return_value=collector.serialize_value(return_value),
        duration_ms=(time.monotonic() - started_at) * 1000,
    )

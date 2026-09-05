import ast
import contextlib
import io
import time
import traceback

from tracer import TraceCollector, TraceLimitExceeded, USER_CODE_FILENAME, _limit
from ast_analyzer import analyze_subscript_relations, relations_as_dicts


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

    try:
        arguments = [ast.literal_eval(line) for line in lines]
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
            instance = namespace[entrypoint["class_name"]]
            method = getattr(instance(), entrypoint["method_name"])
            return_value = method(*arguments)
    except TraceLimitExceeded as error:
        return _empty_result(
            "trace_limit",
            error.reason,
            stdout=_truncate_stdout(stdout_buffer.getvalue(), limits),
            events=collector.events,
            subscript_relations=subscript_relations,
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

import { loadPyodide as bundledLoadPyodide } from "pyodide";

import { normalizeSubscriptRelation } from "../core/ast-relations";
import type {
  ExceptionInfo,
  ExecutionRequest,
  ExecutionTerminalResult
} from "../shared/execution-types";
import type { ObjectSnapshot, TraceEvent, ValueSnapshot } from "../shared/trace-types";
import runtimePrelude from "./python/runtime_prelude.py?raw";
import astAnalyzerSource from "./python/ast_analyzer.py?raw";
import runnerSource from "./python/runner.py?raw";
import serializerSource from "./python/serializer.py?raw";
import tracerSource from "./python/tracer.py?raw";
import objectIdentitySource from "./python/object_identity.py?raw";
import objectTopologySource from "./python/object_topology.py?raw";

export const USER_CODE_FILENAME = "<leetcode-user-code>";
const RUNTIME_PRELUDE_FILENAME = "<leetcode-runtime-prelude>";

export interface PyodideApi {
  runPythonAsync(code: string): Promise<unknown>;
  globals?: {
    set?(name: string, value: unknown): void;
    delete?(name: string): void;
  };
  version?: string;
}

export interface PyodideLoadOptions {
  indexURL: string;
}

export type PyodideLoader = (options: PyodideLoadOptions) => Promise<PyodideApi>;

export interface PyodideRuntimeOptions {
  indexURL?: string;
  loadPyodide?: PyodideLoader;
  onTraceBatch?: (sessionId: string, events: TraceEvent[]) => void;
  onFinished?: (result: ExecutionTerminalResult) => void;
}

export interface PyodideRuntime {
  initialize(): Promise<void>;
  execute(request: ExecutionRequest): Promise<void>;
}

export const DEFAULT_PYODIDE_INDEX_URL = new URL(
  /* @vite-ignore */ "../pyodide/",
  import.meta.url
).href;

function quotePython(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

export function buildExecutionScript(request: ExecutionRequest): string {
  return `
import sys
import types

__lc_runtime_namespace = {}
exec(compile(${quotePython(runtimePrelude)}, ${quotePython(
    RUNTIME_PRELUDE_FILENAME
  )}, "exec"), __lc_runtime_namespace, __lc_runtime_namespace)

__lc_ast_analyzer_module = types.ModuleType("ast_analyzer")
exec(compile(${quotePython(astAnalyzerSource)}, "<leetcode-ast-analyzer>", "exec"), vars(__lc_ast_analyzer_module), vars(__lc_ast_analyzer_module))
sys.modules["ast_analyzer"] = __lc_ast_analyzer_module

__lc_object_identity_module = types.ModuleType("object_identity")
exec(compile(${quotePython(objectIdentitySource)}, "<leetcode-object-identity>", "exec"), vars(__lc_object_identity_module), vars(__lc_object_identity_module))
sys.modules["object_identity"] = __lc_object_identity_module

__lc_object_topology_module = types.ModuleType("object_topology")
exec(compile(${quotePython(objectTopologySource)}, "<leetcode-object-topology>", "exec"), vars(__lc_object_topology_module), vars(__lc_object_topology_module))
sys.modules["object_topology"] = __lc_object_topology_module

__lc_serializer_module = types.ModuleType("serializer")
exec(compile(${quotePython(serializerSource)}, "<leetcode-serializer>", "exec"), vars(__lc_serializer_module), vars(__lc_serializer_module))
sys.modules["serializer"] = __lc_serializer_module

__lc_tracer_module = types.ModuleType("tracer")
exec(compile(${quotePython(tracerSource)}, "<leetcode-tracer>", "exec"), vars(__lc_tracer_module), vars(__lc_tracer_module))
sys.modules["tracer"] = __lc_tracer_module

__lc_runner_module = types.ModuleType("runner")
exec(compile(${quotePython(runnerSource)}, "<leetcode-runner>", "exec"), vars(__lc_runner_module), vars(__lc_runner_module))

__lc_runner_module.run_request(
    ${quotePython(request.sourceCode)},
    ${quotePython(request.rawTestcase)},
    {
        "class_name": ${quotePython(request.entrypoint.className)},
        "method_name": ${quotePython(request.entrypoint.methodName)},
        "parameter_count": ${request.entrypoint.parameterCount},
        "parameter_kinds": ${quotePython(request.entrypoint.parameterKinds)},
    },
    {
        "max_trace_steps": ${request.limits.maxTraceSteps},
        "max_container_items": ${request.limits.maxContainerItems},
        "max_nesting_depth": ${request.limits.maxNestingDepth},
        "max_snapshot_bytes": ${request.limits.maxSnapshotBytes},
        "max_session_bytes": ${request.limits.maxSessionBytes},
        "max_stdout_bytes": ${request.limits.maxStdoutBytes},
        "max_object_nodes": ${request.limits.maxObjectNodes},
        "max_object_attributes": ${request.limits.maxObjectAttributes},
        "max_object_depth": ${request.limits.maxObjectDepth},
    },
    runtime_globals=__lc_runtime_namespace,
    session_id=${quotePython(request.sessionId)},
    emit_batch=globals().get("__lc_emit_trace_batch"),
)
`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapPyodideValue(value: unknown): unknown {
  if (!isRecord(value) || typeof value.toJs !== "function") {
    return value;
  }

  const proxy = value as {
    toJs: (options?: unknown) => unknown;
    destroy?: () => void;
  };
  try {
    return proxy.toJs({ dict_converter: Object.fromEntries });
  } finally {
    proxy.destroy?.();
  }
}

export function toValueSnapshot(value: unknown, depth = 0): ValueSnapshot {
  const unwrapped = unwrapPyodideValue(value);
  if (unwrapped === null || unwrapped === undefined) {
    return { type: "none", value: null };
  }
  if (typeof unwrapped === "boolean") {
    return { type: "bool", value: unwrapped };
  }
  if (typeof unwrapped === "bigint") {
    return { type: "int", value: unwrapped.toString(10) };
  }
  if (typeof unwrapped === "number") {
    if (Number.isInteger(unwrapped) && Number.isFinite(unwrapped)) {
      return { type: "int", value: String(unwrapped) };
    }
    if (Number.isNaN(unwrapped)) {
      return { type: "float", value: "NaN" };
    }
    if (unwrapped === Infinity) {
      return { type: "float", value: "Infinity" };
    }
    if (unwrapped === -Infinity) {
      return { type: "float", value: "-Infinity" };
    }
    return { type: "float", value: unwrapped };
  }
  if (typeof unwrapped === "string") {
    return { type: "str", value: unwrapped, length: unwrapped.length, truncated: false };
  }

  if (depth >= 12) {
    return { type: "unknown", className: typeof unwrapped, repr: String(unwrapped) };
  }
  if (Array.isArray(unwrapped)) {
    const isTuple = isRecord(value) && value.constructor?.name === "PyProxyTuple";
    return {
      type: isTuple ? "tuple" : "list",
      length: unwrapped.length,
      items: unwrapped.map((item) => toValueSnapshot(item, depth + 1)),
      truncated: false
    };
  }
  if (unwrapped instanceof Set) {
    return {
      type: "set",
      length: unwrapped.size,
      items: Array.from(unwrapped, (item) => toValueSnapshot(item, depth + 1)),
      truncated: false
    };
  }
  if (unwrapped instanceof Map) {
    return {
      type: "dict",
      length: unwrapped.size,
      entries: Array.from(unwrapped, ([key, item]) => ({
        key: toValueSnapshot(key, depth + 1),
        value: toValueSnapshot(item, depth + 1)
      })),
      truncated: false
    };
  }
  if (isRecord(unwrapped)) {
    return {
      type: "dict",
      length: Object.keys(unwrapped).length,
      entries: Object.entries(unwrapped).map(([key, item]) => ({
        key: { type: "str", value: key, length: key.length, truncated: false },
        value: toValueSnapshot(item, depth + 1)
      })),
      truncated: false
    };
  }

  return { type: "unknown", className: typeof unwrapped, repr: String(unwrapped) };
}

function errorLine(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/line\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function errorResult(error: unknown, durationMs: number): ExecutionTerminalResult {
  const message = error instanceof Error ? error.message : String(error);
  const type = error instanceof Error && error.name ? error.name : "Error";
  const isSyntaxError = type === "SyntaxError" || /SyntaxError/i.test(message);
  const exception: ExceptionInfo = {
    type,
    message,
    line: errorLine(error),
    stack: error instanceof Error && error.stack ? error.stack.split("\n") : [],
    frameId: null
  };

  return {
    status: isSyntaxError ? "parse_error" : "exception",
    terminationReason: isSyntaxError ? "syntax_error" : "runtime_exception",
    stdout: "",
    durationMs,
    exception
  };
}

function isValueSnapshot(value: unknown): value is ValueSnapshot {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "int":
      return typeof value.value === "string";
    case "float":
      return (
        (typeof value.value === "number" && Number.isFinite(value.value)) ||
        value.value === "NaN" ||
        value.value === "Infinity" ||
        value.value === "-Infinity"
      );
    case "bool":
      return typeof value.value === "boolean";
    case "str":
      return (
        typeof value.value === "string" &&
        typeof value.length === "number" &&
        Number.isInteger(value.length) &&
        value.length >= 0 &&
        typeof value.truncated === "boolean"
      );
    case "none":
      return value.value === null;
    case "list":
    case "tuple":
      return (
        typeof value.length === "number" &&
        Number.isInteger(value.length) &&
        value.length >= 0 &&
        Array.isArray(value.items) &&
        value.items.every((item) => isValueSnapshot(item)) &&
        typeof value.truncated === "boolean"
      );
    case "dict":
      return (
        typeof value.length === "number" &&
        Number.isInteger(value.length) &&
        value.length >= 0 &&
        Array.isArray(value.entries) &&
        value.entries.every(
          (entry) =>
            isRecord(entry) &&
            isValueSnapshot(entry.key) &&
            isValueSnapshot(entry.value)
        ) &&
        typeof value.truncated === "boolean"
      );
    case "set":
      return (
        typeof value.length === "number" &&
        Number.isInteger(value.length) &&
        value.length >= 0 &&
        Array.isArray(value.items) &&
        value.items.every((item) => isValueSnapshot(item)) &&
        typeof value.truncated === "boolean"
      );
    case "unknown":
      return (
        typeof value.className === "string" &&
        typeof value.repr === "string" &&
        (value.truncated === undefined || typeof value.truncated === "boolean")
      );
    case "cycle":
      return typeof value.referenceId === "string";
    case "reference":
      return typeof value.objectId === "string" && typeof value.className === "string";
    default:
      return false;
  }
}

function isObjectSnapshot(value: unknown): value is ObjectSnapshot {
  return (
    isRecord(value) &&
    typeof value.objectId === "string" &&
    typeof value.className === "string" &&
    isRecord(value.attributes) &&
    Object.values(value.attributes).every((attribute) => isValueSnapshot(attribute))
  );
}

function normalizeException(value: unknown): ExceptionInfo | undefined {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.message !== "string") {
    return undefined;
  }

  const frameId = value.frame_id ?? value.frameId;
  return {
    type: value.type,
    message: value.message,
    line: typeof value.line === "number" ? value.line : null,
    stack: Array.isArray(value.stack) ? value.stack.filter((item): item is string => typeof item === "string") : [],
    frameId: typeof frameId === "number" ? frameId : null
  };
}

export function normalizePythonTraceEvent(value: unknown): TraceEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const eventName = value.event;
  if (
    eventName !== "call" &&
    eventName !== "line" &&
    eventName !== "return" &&
    eventName !== "exception"
  ) {
    return null;
  }
  if (
    typeof value.step !== "number" ||
    typeof value.frame_id !== "number" ||
    typeof value.function !== "string" ||
    typeof value.call_depth !== "number" ||
    !isRecord(value.locals) ||
    typeof value.stdout_delta !== "string" ||
    !Object.values(value.locals).every((local) => isValueSnapshot(local))
  ) {
    return null;
  }

  const eventPayload = isRecord(value.event_payload) ? value.event_payload : undefined;
  let normalizedPayload: TraceEvent["eventPayload"];
  if (eventName === "return" && eventPayload && "return_value" in eventPayload) {
    normalizedPayload = {
      type: "return",
      value: isValueSnapshot(eventPayload.return_value) ? eventPayload.return_value : null
    };
  } else if (eventName === "exception" && eventPayload) {
    const exception = normalizeException(eventPayload.exception);
    if (exception) {
      normalizedPayload = { type: "exception", exception };
    }
  }

  const parentFrameId = value.parent_frame_id ?? value.parentFrameId;
  const objects = Array.isArray(value.objects)
    ? value.objects.filter((object): object is ObjectSnapshot => isObjectSnapshot(object))
    : undefined;
  const objectsTruncated = value.objects_truncated ?? value.objectsTruncated;
  return {
    step: value.step,
    event: eventName,
    frameId: value.frame_id,
    parentFrameId: typeof parentFrameId === "number" ? parentFrameId : null,
    function: value.function,
    line: typeof value.line === "number" ? value.line : null,
    callDepth: value.call_depth,
    locals: value.locals as Record<string, ValueSnapshot>,
    stdoutDelta: value.stdout_delta,
    ...(objects ? { objects } : {}),
    ...(typeof objectsTruncated === "boolean" ? { objectsTruncated } : {}),
    ...(normalizedPayload ? { eventPayload: normalizedPayload } : {})
  };
}

function normalizePythonExecutionResult(
  value: unknown,
  durationMs: number
): { result: ExecutionTerminalResult; events: TraceEvent[] } {
  if (Array.isArray(value)) {
    const [returnValue, stdout] = value;
    return {
      result: {
        status: "completed",
        terminationReason: "normal_return",
        stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
        durationMs,
        returnValue: toValueSnapshot(returnValue)
      },
      events: []
    };
  }

  if (!isRecord(value)) {
    return {
      result: {
        status: "internal_error",
        terminationReason: "tracer_internal_error",
        stdout: "",
        durationMs,
        exception: {
          type: "RuntimeProtocolError",
          message: "Python runner returned a non-object result",
          line: null,
          stack: [],
          frameId: null
        }
      },
      events: []
    };
  }

  const events = Array.isArray(value.events)
    ? value.events
        .map((event) => normalizePythonTraceEvent(event))
        .filter((event): event is TraceEvent => event !== null)
    : [];
  const status = value.status;
  const terminationReason = value.termination_reason;
  const terminalStatuses = new Set([
    "completed",
    "exception",
    "trace_limit",
    "timeout",
    "parse_error",
    "input_error",
    "internal_error"
  ]);
  const allowedReasons = new Set([
    "normal_return",
    "runtime_exception",
    "step_limit",
    "trace_byte_limit",
    "stdout_limit",
    "hard_timeout",
    "syntax_error",
    "unsupported_testcase_format",
    "entrypoint_resolution_failed",
    "worker_initialization_failed",
    "pyodide_initialization_failed",
    "tracer_internal_error"
  ]);
  const normalizedStatus =
    typeof status === "string" && terminalStatuses.has(status)
      ? (status as ExecutionTerminalResult["status"])
      : "internal_error";
  const normalizedReason =
    typeof terminationReason === "string" && allowedReasons.has(terminationReason)
    ? (terminationReason as ExecutionTerminalResult["terminationReason"])
    : "tracer_internal_error";
  const returnValue = value.return_value;
  const exception = normalizeException(value.exception);
  const subscriptRelations = Array.isArray(value.subscript_relations)
    ? value.subscript_relations
        .map((relation) => normalizeSubscriptRelation(relation))
        .filter((relation): relation is NonNullable<typeof relation> => relation !== null)
    : [];

  return {
    events,
    result: {
      status: normalizedStatus,
      terminationReason: normalizedReason,
      stdout: typeof value.stdout === "string" ? value.stdout : "",
      durationMs: typeof value.duration_ms === "number" ? value.duration_ms : durationMs,
      ...(subscriptRelations.length > 0 ? { subscriptRelations } : {}),
      ...(isValueSnapshot(returnValue) ? { returnValue } : {}),
      ...(exception ? { exception } : {})
    }
  };
}

export function createPyodideRuntime(options: PyodideRuntimeOptions = {}): PyodideRuntime {
  const loadPyodide = options.loadPyodide ?? (bundledLoadPyodide as PyodideLoader);
  const indexURL = options.indexURL ?? DEFAULT_PYODIDE_INDEX_URL;
  let pyodide: PyodideApi | null = null;
  let initialization: Promise<void> | null = null;

  const initialize = async (): Promise<void> => {
    if (pyodide) {
      return;
    }
    if (!initialization) {
      initialization = loadPyodide({ indexURL }).then((loaded) => {
        pyodide = loaded;
      });
    }
    await initialization;
  };

  return {
    initialize,
    async execute(request: ExecutionRequest): Promise<void> {
      await initialize();
      if (!pyodide) {
        throw new Error("Pyodide did not initialize");
      }

      const startedAt = Date.now();
      let streamedEventCount = 0;
      let callbackInstalled = false;
      const emitTraceBatch = (sessionId: string, eventsJson: string): void => {
        if (sessionId !== request.sessionId) {
          return;
        }
        try {
          const parsed = JSON.parse(eventsJson) as unknown;
          const events = Array.isArray(parsed)
            ? parsed
                .map((event) => normalizePythonTraceEvent(event))
                .filter((event): event is TraceEvent => event !== null)
            : [];
          if (events.length === 0) {
            return;
          }
          streamedEventCount += events.length;
          options.onTraceBatch?.(sessionId, events);
        } catch {
          // A malformed optional stream must not interrupt the Python run.
        }
      };

      try {
        if (options.onTraceBatch && typeof pyodide.globals?.set === "function") {
          pyodide.globals.set("__lc_emit_trace_batch", emitTraceBatch);
          callbackInstalled = true;
        }
        const rawResult = await pyodide.runPythonAsync(buildExecutionScript(request));
        const normalized = normalizePythonExecutionResult(
          unwrapPyodideValue(rawResult),
          Date.now() - startedAt
        );
        if (streamedEventCount === 0) {
          const batchSize = 50;
          for (let index = 0; index < normalized.events.length; index += batchSize) {
            options.onTraceBatch?.(
              request.sessionId,
              normalized.events.slice(index, index + batchSize)
            );
          }
        }
        options.onFinished?.(normalized.result);
      } catch (error) {
        options.onFinished?.(errorResult(error, Date.now() - startedAt));
      } finally {
        if (callbackInstalled) {
          pyodide.globals?.delete?.("__lc_emit_trace_batch");
        }
      }
    }
  };
}

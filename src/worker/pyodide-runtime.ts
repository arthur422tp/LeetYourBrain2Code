import { loadPyodide as bundledLoadPyodide } from "pyodide";

import type {
  ExceptionInfo,
  ExecutionRequest,
  ExecutionTerminalResult
} from "../shared/execution-types";
import type { ValueSnapshot } from "../shared/trace-types";
import runtimePrelude from "./python/runtime_prelude.py?raw";

export const USER_CODE_FILENAME = "<leetcode-user-code>";
const RUNTIME_PRELUDE_FILENAME = "<leetcode-runtime-prelude>";

export interface PyodideApi {
  runPythonAsync(code: string): Promise<unknown>;
  version?: string;
}

export interface PyodideLoadOptions {
  indexURL: string;
}

export type PyodideLoader = (options: PyodideLoadOptions) => Promise<PyodideApi>;

export interface PyodideRuntimeOptions {
  indexURL?: string;
  loadPyodide?: PyodideLoader;
  onFinished?: (result: ExecutionTerminalResult) => void;
}

export interface PyodideRuntime {
  initialize(): Promise<void>;
  execute(request: ExecutionRequest): Promise<void>;
}

export const DEFAULT_PYODIDE_INDEX_URL = new URL("../pyodide/", import.meta.url).href;

function quotePython(value: string): string {
  return JSON.stringify(value);
}

export function buildExecutionScript(request: ExecutionRequest): string {
  return `
import ast
import contextlib
import io

__lc_namespace = {}
exec(compile(${quotePython(runtimePrelude)}, ${quotePython(
    RUNTIME_PRELUDE_FILENAME
  )}, "exec"), __lc_namespace, __lc_namespace)
__lc_arguments = [
    ast.literal_eval(line)
    for line in ${quotePython(request.rawTestcase)}.splitlines()
    if line.strip()
]
exec(compile(${quotePython(request.sourceCode)}, ${quotePython(
    USER_CODE_FILENAME
  )}, "exec"), __lc_namespace, __lc_namespace)
__lc_stdout = io.StringIO()
with contextlib.redirect_stdout(__lc_stdout):
    __lc_instance = __lc_namespace[${quotePython(request.entrypoint.className)}]()
    __lc_return = getattr(__lc_instance, ${quotePython(
      request.entrypoint.methodName
    )})(*__lc_arguments)
(__lc_return, __lc_stdout.getvalue())
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
      try {
        const rawResult = await pyodide.runPythonAsync(buildExecutionScript(request));
        const result = unwrapPyodideValue(rawResult);
        const [returnValue, stdout] = Array.isArray(result) ? result : [result, ""];
        options.onFinished?.({
          status: "completed",
          terminationReason: "normal_return",
          stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
          durationMs: Date.now() - startedAt,
          returnValue: toValueSnapshot(returnValue)
        });
      } catch (error) {
        options.onFinished?.(errorResult(error, Date.now() - startedAt));
      }
    }
  };
}

import { describe, expect, it } from "vitest";

import type { ExecutionRequest, ExecutionTerminalResult } from "../../src/shared/execution-types";
import type { TraceEvent } from "../../src/shared/trace-types";
import {
  buildExecutionScript,
  createPyodideRuntime,
  normalizePythonTraceEvent,
  USER_CODE_FILENAME
} from "../../src/worker/pyodide-runtime";

const request: ExecutionRequest = {
  sessionId: "runtime-session",
  sourceCode: `class Solution:
    def add(self, a: int, b: int):
        return a + b
`,
  rawTestcase: "2\n3",
  entrypoint: {
    className: "Solution",
    methodName: "add",
    parameterCount: 2,
    parameterKinds: ["value", "value"]
  },
  limits: {
    maxTraceSteps: 100,
    maxContainerItems: 100,
    maxNestingDepth: 8,
    maxSnapshotBytes: 10_000,
    maxSessionBytes: 100_000,
    maxStdoutBytes: 1_000,
    hardTimeoutMs: 1_000,
    maxObjectNodes: 200,
    maxObjectAttributes: 20,
    maxObjectDepth: 32
  }
};

describe("Pyodide runtime", () => {
  it("compiles the prelude and user source independently", () => {
    const script = buildExecutionScript(request);

    expect(script).toContain(`compile(`);
    expect(script).toContain(USER_CODE_FILENAME);
    expect(script).toContain("leetcode-runtime-prelude");
    expect(script).toContain("leetcode-serializer");
    expect(script).toContain("leetcode-tracer");
    expect(script).toContain('sys.modules["serializer"]');
    expect(script).toContain("leetcode-object-identity");
    expect(script).toContain('sys.modules["object_identity"]');
    expect(script).toContain("leetcode-object-topology");
    expect(script).toContain('sys.modules["object_topology"]');
    expect(script).toContain("leetcode-ast-analyzer");
    expect(script).toContain('sys.modules["ast_analyzer"]');
    expect(script).toContain("leetcode-runner");
    expect(script).toContain("run_request");
    expect(script).toContain(JSON.stringify(request.sourceCode));
    expect(script).not.toContain(`${JSON.stringify(request.sourceCode)} +`);
  });

  it("normalizes object references and bounded topology fields", () => {
    const event = normalizePythonTraceEvent({
      step: 1,
      event: "line",
      frame_id: 1,
      parent_frame_id: null,
      function: "reverseList",
      line: 4,
      call_depth: 1,
      locals: {
        head: { type: "reference", objectId: "obj-1", className: "ListNode" }
      },
      objects: [
        {
          objectId: "obj-1",
          className: "ListNode",
          attributes: {
            val: { type: "int", value: "1" },
            next: { type: "none", value: null }
          }
        }
      ],
      objects_truncated: false,
      stdout_delta: ""
    });

    expect(event).toEqual(expect.objectContaining({
      objects: [
        expect.objectContaining({ objectId: "obj-1", className: "ListNode" })
      ],
      objectsTruncated: false
    }));
  });

  it("initializes from a local index URL and reports a simple return value", async () => {
    const calls: string[] = [];
    const loadedIndexUrls: string[] = [];
    const finished: ExecutionTerminalResult[] = [];

    const runtime = createPyodideRuntime({
      indexURL: "/extension/pyodide/",
      loadPyodide: async ({ indexURL }) => {
        loadedIndexUrls.push(indexURL);
        return {
          runPythonAsync: async (code: string) => {
            calls.push(code);
            return [5, ""];
          }
        };
      },
      onFinished: (result) => finished.push(result)
    });

    await runtime.initialize();
    await runtime.execute(request);

    expect(loadedIndexUrls).toEqual(["/extension/pyodide/"]);
    expect(calls).toHaveLength(1);
    expect(finished).toEqual([
      expect.objectContaining({
        status: "completed",
        terminationReason: "normal_return",
        returnValue: { type: "int", value: "5" },
        stdout: ""
      })
    ]);
  });

  it("normalizes Python trace events and forwards them before the terminal result", async () => {
    const batches: TraceEvent[][] = [];
    const finished: ExecutionTerminalResult[] = [];
    const runtime = createPyodideRuntime({
      loadPyodide: async () => ({
        runPythonAsync: async () => ({
          status: "completed",
          termination_reason: "normal_return",
          stdout: "",
          duration_ms: 12,
          events: [
            {
              step: 1,
              event: "line",
              frame_id: 2,
              parent_frame_id: null,
              function: "add",
              line: 3,
              call_depth: 1,
              locals: { value: { type: "int", value: "5" } },
              stdout_delta: ""
            }
          ],
          return_value: { type: "int", value: "5" }
        })
      }),
      onTraceBatch: (_sessionId, events) => batches.push(events),
      onFinished: (result) => finished.push(result)
    });

    await runtime.execute(request);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([
      {
        step: 1,
        event: "line",
        frameId: 2,
        parentFrameId: null,
        function: "add",
        line: 3,
        callDepth: 1,
        locals: { value: { type: "int", value: "5" } },
        stdoutDelta: ""
      }
    ]);
    expect(finished[0]).toEqual(
      expect.objectContaining({ status: "completed", returnValue: { type: "int", value: "5" } })
    );
  });

  it("installs a JSON trace callback while Python is still running", async () => {
    const batches: TraceEvent[][] = [];
    let callback: ((sessionId: string, eventsJson: string) => void) | undefined;
    const globals = {
      set: (name: string, value: unknown) => {
        if (name === "__lc_emit_trace_batch") {
          callback = value as (sessionId: string, eventsJson: string) => void;
        }
      },
      delete: () => undefined
    };
    const runtime = createPyodideRuntime({
      loadPyodide: async () => ({
        globals,
        runPythonAsync: async () => {
          callback?.(
            "runtime-session",
            JSON.stringify([
              {
                step: 1,
                event: "line",
                frame_id: 1,
                parent_frame_id: null,
                function: "add",
                line: 3,
                call_depth: 1,
                locals: {},
                stdout_delta: ""
              }
            ])
          );
          return {
            status: "completed",
            termination_reason: "normal_return",
            stdout: "",
            events: [],
            return_value: { type: "int", value: "5" }
          };
        }
      }),
      onTraceBatch: (_sessionId, events) => batches.push(events)
    });

    await runtime.execute(request);

    expect(batches).toEqual([
      [
        {
          step: 1,
          event: "line",
          frameId: 1,
          parentFrameId: null,
          function: "add",
          line: 3,
          callDepth: 1,
          locals: {},
          stdoutDelta: ""
        }
      ]
    ]);
  });

  it("rejects trace events whose locals contain a raw non-snapshot value", () => {
    expect(normalizePythonTraceEvent({
      step: 1,
      event: "line",
      frame_id: 1,
      parent_frame_id: null,
      function: "add",
      line: 3,
      call_depth: 1,
      locals: { value: 5 },
      stdout_delta: ""
    })).toBeNull();
  });

  it("normalizes static subscript relations returned by the Python runner", async () => {
    const finished: ExecutionTerminalResult[] = [];
    const runtime = createPyodideRuntime({
      loadPyodide: async () => ({
        runPythonAsync: async () => ({
          status: "completed",
          termination_reason: "normal_return",
          stdout: "",
          events: [],
          subscript_relations: [
            { scope: "Solution.twoSum", line: 7, container: "nums", index: "left" }
          ]
        })
      }),
      onFinished: (result) => finished.push(result)
    });

    await runtime.execute(request);

    expect(finished[0]).toEqual(expect.objectContaining({
      subscriptRelations: [
        { scope: "Solution.twoSum", line: 7, container: "nums", index: "left" }
      ]
    }));
  });

  it("loads Pyodide once while rebuilding a fresh runtime namespace for every request", async () => {
    let loadCount = 0;
    const scripts: string[] = [];
    const runtime = createPyodideRuntime({
      loadPyodide: async () => {
        loadCount += 1;
        return {
          runPythonAsync: async (code: string) => {
            scripts.push(code);
            return [1, ""];
          }
        };
      }
    });

    await runtime.initialize();
    await runtime.execute({ ...request, sessionId: "first" });
    await runtime.execute({ ...request, sessionId: "second" });

    expect(loadCount).toBe(1);
    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toContain("__lc_runtime_namespace = {}");
    expect(scripts[1]).toContain("__lc_runtime_namespace = {}");
    expect(scripts[0]).toContain(JSON.stringify("first"));
    expect(scripts[1]).toContain(JSON.stringify("second"));
  });
});

import { describe, expect, it } from "vitest";

import type { ExecutionRequest, ExecutionTerminalResult } from "../../src/shared/execution-types";
import type { TraceEvent } from "../../src/shared/trace-types";
import type { ExpressionBatch, ExpressionPlan } from "../../src/shared/expression-types";
import type { ControlFlowBatch, ControlFlowPlan } from "../../src/shared/control-flow-types";
import type { CallFrameBatch, FunctionPlan } from "../../src/shared/call-frame-types";
import { interpretTrace } from "../../src/core/trace-interpreter";
import { createTraceVisualizer } from "../../src/sidepanel/components/TraceVisualizer";
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
    maxObjectDepth: 32,
    maxExpressionEvents: 20_000,
    maxExpressionBytes: 2_000_000,
    maxDecisionEvents: 20_000,
  maxDecisionBytes: 2_000_000,
  maxControlFlowEvents: 20_000,
  maxControlFlowBytes: 2_000_000,
  maxCallFrameEvents: 20_000,
  maxCallFrameBytes: 2_000_000
  }
};

const streamedExpressionPlan: ExpressionPlan = {
  version: 1,
  roots: [],
  expressions: []
};

const streamedExpressionBatch: ExpressionBatch = {
  batchId: 1,
  anchorStep: 1,
  frameId: 1,
  line: 3,
  roots: []
};
const streamedControlFlowPlan: ControlFlowPlan = { version: 1, loops: [], transfers: [] };
const streamedControlFlowBatch: ControlFlowBatch = {
  batchId: 1,
  events: [{
    eventId: 1,
    kind: "loop_exit",
    anchorStep: 1,
    frameId: 1,
    context: { loopStack: [] },
    loopId: "f1",
    loopKind: "for",
    reason: "exhausted"
  }]
};
const streamedFunctionPlan: FunctionPlan = { version: 1, functions: [] };
const streamedCallFrameBatch: CallFrameBatch = {
  batchId: 1,
  updates: [{
    updateId: 1,
    kind: "frame_enter",
    frameId: 1,
    parentFrameId: null,
    functionName: "add",
    callStep: 1,
    depth: 1,
    arguments: []
  }]
};

describe("Pyodide runtime", () => {
  it("compiles the prelude and user source independently", () => {
    const script = buildExecutionScript(request);

    expect(script).toContain(`compile(`);
    expect(script).toContain(USER_CODE_FILENAME);
    expect(script).toContain("leetcode-runtime-prelude");
    expect(script).toContain("class TreeNode");
    expect(script).toContain("class ListNode");
    expect(script).toContain("leetcode-serializer");
    expect(script).toContain("leetcode-tracer");
    expect(script).toContain('sys.modules["serializer"]');
    expect(script).toContain("leetcode-object-identity");
    expect(script).toContain('sys.modules["object_identity"]');
    expect(script).toContain("leetcode-object-topology");
    expect(script).toContain('sys.modules["object_topology"]');
    expect(script).toContain("leetcode-ast-analyzer");
    expect(script).toContain('sys.modules["ast_analyzer"]');
    expect(script).toContain("leetcode-expression-instrumenter");
    expect(script).toContain('sys.modules["expression_instrumenter"]');
    expect(script).toContain("leetcode-expression-recorder");
    expect(script).toContain('sys.modules["expression_recorder"]');
    expect(script).toContain("leetcode-runner");
    expect(script).toContain("function_planner");
    expect(script).toContain("call_frame_recorder");
    expect(script).toContain("run_request");
    expect(script).toContain("parameter_kinds");
    expect(script).toContain("ObjectIdentityRegistry");
    expect(script).toContain("ObjectTopologyCollector");
    expect(script).toContain("topology_collector");
    expect(script).toContain("max_container_items");
    expect(script).toContain("max_expression_events");
    expect(script).toContain("max_expression_bytes");
    expect(script).toContain("max_call_frame_events");
    expect(script).toContain("max_call_frame_bytes");
    expect(script).toContain("_is_traversal_container");
    expect(script).toContain("_container_children");
    expect(script).toContain(JSON.stringify(request.sourceCode));
    expect(script).not.toContain(`${JSON.stringify(request.sourceCode)} +`);
  });

  it("normalizes and forwards decision plan and batch callback payloads", async () => {
    const callbacks: string[] = [];
    const globals: Record<string, (sessionId: string, payload: string) => void> = {};
    const runtime = createPyodideRuntime({
      loadPyodide: async () => ({
        runPythonAsync: async () => {
          globals.__lc_emit_condition_plan!("runtime-session", JSON.stringify({
            version: 1, sites: [], conditions: [], operands: [], chains: []
          }));
          globals.__lc_emit_decision_batch!("runtime-session", JSON.stringify([{
            batch_id: 1,
            anchor_step: 1,
            frame_id: 1,
            site_id: "d1",
            occurrence: 1,
            status: "completed",
            condition: {
              condition_id: "d1.c0",
              evaluations: [],
              condition_results: [{ condition_id: "d1.c0", order: 1, truth: true }],
              truth: true
            },
            outcome: "branch_entered"
          }]));
          return { status: "completed", termination_reason: "normal_return", stdout: "", duration_ms: 1, events: [] };
        },
        globals: {
          set: (name, value) => { globals[name] = value as (sessionId: string, payload: string) => void; },
          delete: () => undefined
        }
      }),
      onConditionPlan: (_sessionId, plan) => callbacks.push(`plan:${plan.version}`),
      onDecisionBatch: (_sessionId, batches) => callbacks.push(`batch:${batches[0]!.siteId}`)
    });

    await runtime.execute(request);
    expect(callbacks).toEqual(["plan:1", "batch:d1"]);
  });

  it("normalizes and forwards control-flow plan and batch callback payloads", async () => {
    const callbacks: string[] = [];
    const globals: Record<string, (sessionId: string, payload: string) => void> = {};
    const runtime = createPyodideRuntime({
      loadPyodide: async () => ({
        runPythonAsync: async () => {
          globals.__lc_emit_control_flow_plan!("runtime-session", JSON.stringify({ version: 1, loops: [], transfers: [] }));
          globals.__lc_emit_control_flow_batch!("runtime-session", JSON.stringify([{ batch_id: 1, events: [{ event_id: 1, kind: "loop_exit", anchor_step: 1, frame_id: 1, context: { loop_stack: [] }, loop_id: "f1", loop_kind: "for", reason: "exhausted" }] }]));
          return { status: "completed", termination_reason: "normal_return", stdout: "", duration_ms: 1, events: [] };
        },
        globals: { set: (name, value) => { globals[name] = value as (sessionId: string, payload: string) => void; }, delete: () => undefined }
      }),
      onControlFlowPlan: (_sessionId, plan) => callbacks.push(`plan:${plan.version}`),
      onControlFlowBatch: (_sessionId, batches) => callbacks.push(`batch:${batches[0]!.batchId}`)
    });
    await runtime.execute(request);
    expect(callbacks).toEqual(["plan:1", "batch:1"]);
  });

  it("normalizes and forwards function plans and call-frame batches", async () => {
    const callbacks: string[] = [];
    const finished: ExecutionTerminalResult[] = [];
    const globals: Record<string, (sessionId: string, payload: string) => void> = {};
    const runtime = createPyodideRuntime({
      loadPyodide: async () => ({
        runPythonAsync: async () => {
          globals.__lc_emit_function_plan!("runtime-session", JSON.stringify(streamedFunctionPlan));
          globals.__lc_emit_call_frame_batch!("runtime-session", JSON.stringify([{
            batch_id: 1,
            updates: [{
              update_id: 1,
              kind: "frame_enter",
              frame_id: 1,
              parent_frame_id: null,
              function_name: "add",
              call_step: 1,
              depth: 1,
              arguments: []
            }]
          }]));
          return {
            status: "completed",
            termination_reason: "normal_return",
            stdout: "",
            events: [],
            function_plan: streamedFunctionPlan,
            call_frame_batches: [{
              batch_id: 1,
              updates: [{
                update_id: 1,
                kind: "frame_enter",
                frame_id: 1,
                parent_frame_id: null,
                function_name: "add",
                call_step: 1,
                depth: 1,
                arguments: []
              }]
            }],
            call_frame_tracing: { status: "complete" }
          };
        },
        globals: {
          set: (name, value) => { globals[name] = value as (sessionId: string, payload: string) => void; },
          delete: () => undefined
        }
      }),
      onFunctionPlan: (_sessionId, plan) => callbacks.push(`plan:${plan.version}`),
      onCallFrameBatch: (_sessionId, batches) => callbacks.push(`batch:${batches[0]!.batchId}`),
      onFinished: (result) => finished.push(result)
    });

    await runtime.execute(request);

    expect(callbacks).toEqual(["plan:1", "batch:1"]);
    expect(finished[0]?.functionPlan).toEqual(streamedFunctionPlan);
    expect(finished[0]?.callFrameBatches).toEqual([streamedCallFrameBatch]);
    expect(finished[0]?.callFrameTracing).toEqual({ status: "complete" });
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

  it("preserves stable object ids and return topology across an event sequence", () => {
    const rawEvents = [
      {
        step: 1,
        event: "line",
        frame_id: 1,
        parent_frame_id: null,
        function: "reverseList",
        line: 4,
        call_depth: 1,
        locals: { head: { type: "reference", objectId: "obj-1", className: "ListNode" } },
        objects: [{
          objectId: "obj-1",
          className: "ListNode",
          attributes: {
            val: { type: "int", value: "1" },
            next: { type: "none", value: null }
          }
        }],
        objects_truncated: false,
        stdout_delta: ""
      },
      {
        step: 2,
        event: "return",
        frame_id: 1,
        parent_frame_id: null,
        function: "reverseList",
        line: 5,
        call_depth: 1,
        locals: {},
        objects: [{
          objectId: "obj-1",
          className: "ListNode",
          attributes: {
            val: { type: "int", value: "1" },
            next: { type: "none", value: null }
          }
        }],
        objects_truncated: false,
        stdout_delta: "",
        event_payload: {
          return_value: { type: "reference", objectId: "obj-1", className: "ListNode" }
        }
      }
    ];

    const events = rawEvents.map(normalizePythonTraceEvent);

    expect(events[0]?.locals.head).toEqual({
      type: "reference",
      objectId: "obj-1",
      className: "ListNode"
    });
    expect(events[1]?.eventPayload).toEqual({
      type: "return",
      value: { type: "reference", objectId: "obj-1", className: "ListNode" }
    });
    expect(events[1]?.objects?.[0]?.objectId).toBe(events[0]?.objects?.[0]?.objectId);
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

  it("normalizes terminal expression evidence from Python snake_case fields", async () => {
    const finished: ExecutionTerminalResult[] = [];
    const runtime = createPyodideRuntime({
      loadPyodide: async () => ({
        runPythonAsync: async () => ({
          status: "completed",
          termination_reason: "normal_return",
          stdout: "",
          events: [],
          expression_plan: {
            version: 1,
            roots: [{
              rootId: "r1",
              kind: "assignment",
              expressionExprId: "r1.0",
              target: {
                source: "x",
                span: { line: 3, column: 8, endLine: 3, endColumn: 21 }
              },
              span: { line: 3, column: 8, endLine: 3, endColumn: 21 }
            }],
            expressions: [{
              exprId: "r1.0",
              rootId: "r1",
              parentExprId: null,
              kind: "call",
              span: { line: 3, column: 8, endLine: 3, endColumn: 21 },
              source: "min(3, 3, 5)",
              childExprIds: ["r1.0.0", "r1.0.1", "r1.0.2"]
            }]
          },
          expression_batches: [{
            batch_id: 1,
            anchor_step: 4,
            frame_id: 2,
            line: 3,
            roots: [{
              root_id: "r1",
              status: "completed",
              evaluations: [{
                evaluation_id: 1,
                expr_id: "r1.0",
                order: 1,
                value: { type: "int", value: "3" }
              }],
              result_expr_id: "r1.0",
              selection_evidence: [{
                call_expr_id: "r1.0",
                function: "min",
                candidate_expr_ids: ["r1.0.0", "r1.0.1", "r1.0.2"],
                result: { type: "int", value: "3" },
                selected_candidate_index: 0,
                status: "resolved"
              }]
            }]
          }, {
            batch_id: 2,
            anchor_step: 5,
            frame_id: 2,
            line: 4,
            roots: [{ root_id: "r2", status: "partial", evaluations: [] }]
          }],
          expression_tracing: { status: "truncated", reason: "expression_event_limit" }
        })
      }),
      onFinished: (result) => finished.push(result)
    });

    await runtime.execute(request);

    expect(finished[0]?.expressionPlan).toEqual(expect.objectContaining({ version: 1 }));
    expect(finished[0]?.expressionBatches).toEqual([
      expect.objectContaining({
        batchId: 1,
        anchorStep: 4,
        frameId: 2,
        roots: [expect.objectContaining({
          rootId: "r1",
          resultExprId: "r1.0",
          selectionEvidence: [expect.objectContaining({
            callExprId: "r1.0",
            candidateExprIds: ["r1.0.0", "r1.0.1", "r1.0.2"],
            selectedCandidateIndex: 0
          })]
        })]
      }),
      expect.objectContaining({
        batchId: 2,
        anchorStep: 5,
        roots: [expect.objectContaining({ rootId: "r2", status: "partial" })]
      })
    ]);
    expect(finished[0]?.expressionTracing).toEqual({
      status: "truncated",
      reason: "expression_event_limit"
    });
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

  it("streams expression plan and batches before finishing and cleans up callbacks", async () => {
    const callbackNames: string[] = [];
    const deletedNames: string[] = [];
    let emitPlan: ((sessionId: string, planJson: string) => void) | undefined;
    let emitBatch: ((sessionId: string, batchesJson: string) => void) | undefined;
    const order: string[] = [];
    const runtime = createPyodideRuntime({
      loadPyodide: async () => ({
        globals: {
          set: (name, value) => {
            callbackNames.push(name);
            if (name === "__lc_emit_expression_plan") {
              emitPlan = value as (sessionId: string, planJson: string) => void;
            }
            if (name === "__lc_emit_expression_batch") {
              emitBatch = value as (sessionId: string, batchesJson: string) => void;
            }
          },
          delete: (name) => deletedNames.push(name)
        },
        runPythonAsync: async () => {
          emitPlan?.("runtime-session", JSON.stringify(streamedExpressionPlan));
          emitBatch?.("runtime-session", JSON.stringify([streamedExpressionBatch]));
          return {
            status: "completed",
            termination_reason: "normal_return",
            stdout: "",
            events: []
          };
        }
      }),
      onExpressionPlan: (_sessionId, plan) => {
        expect(plan).toEqual(streamedExpressionPlan);
        order.push("plan");
      },
      onExpressionBatch: (_sessionId, batches) => {
        expect(batches).toEqual([streamedExpressionBatch]);
        order.push("batch");
      },
      onFinished: () => order.push("finished")
    });

    await runtime.execute(request);

    expect(callbackNames).toEqual(expect.arrayContaining([
      "__lc_emit_expression_plan",
      "__lc_emit_expression_batch"
    ]));
    expect(order).toEqual(["plan", "batch", "finished"]);
    expect(deletedNames).toEqual(expect.arrayContaining([
      "__lc_emit_expression_plan",
      "__lc_emit_expression_batch"
    ]));
  });

  it("forwards terminal expression evidence only when no stream copy arrived", async () => {
    const plans: ExpressionPlan[] = [];
    const batches: ExpressionBatch[][] = [];
    const runtime = createPyodideRuntime({
      loadPyodide: async () => ({
        runPythonAsync: async () => ({
          status: "completed",
          termination_reason: "normal_return",
          stdout: "",
          events: [],
          expression_plan: streamedExpressionPlan,
          expression_batches: [{
            batch_id: 1,
            anchor_step: 1,
            frame_id: 1,
            line: 3,
            roots: []
          }]
        })
      }),
      onExpressionPlan: (_sessionId, plan) => plans.push(plan),
      onExpressionBatch: (_sessionId, values) => batches.push(values)
    });

    await runtime.execute(request);

    expect(plans).toEqual([streamedExpressionPlan]);
    expect(batches).toEqual([[streamedExpressionBatch]]);
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

  it("extracts strict matrix subscript relations from a real Pyodide execution", async () => {
    const finished: ExecutionTerminalResult[] = [];
    const runtime = createPyodideRuntime({
      indexURL: `${process.cwd()}/node_modules/pyodide/`,
      onFinished: (result) => finished.push(result)
    });

    await runtime.execute({
      ...request,
      sessionId: "matrix-runtime-session",
      sourceCode: `class Solution:
    def inspect(self, matrix: list[list[int]], i: int, j: int):
        a = matrix[i][j]
        b = matrix[0][-1]
        c = matrix[i + 1][j]
        return a + b + c
`,
      rawTestcase: "[[1, 2], [3, 4]]\n0\n0",
      entrypoint: {
        className: "Solution",
        methodName: "inspect",
        parameterCount: 3,
        parameterKinds: ["value", "value", "value"]
      }
    });

    expect(finished[0]).toEqual(expect.objectContaining({
      status: "completed",
      subscriptRelations: expect.arrayContaining([
        {
          kind: "matrix_subscript",
          scope: "Solution.inspect",
          line: 3,
          container: "matrix",
          rowIndex: { kind: "variable", name: "i" },
          columnIndex: { kind: "variable", name: "j" }
        },
        {
          kind: "matrix_subscript",
          scope: "Solution.inspect",
          line: 4,
          container: "matrix",
          rowIndex: { kind: "literal", value: 0 },
          columnIndex: { kind: "literal", value: -1 }
        }
      ])
    }));
    expect(finished[0]?.subscriptRelations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "matrix_subscript",
          rowIndex: { kind: "variable", name: "i" },
          columnIndex: { kind: "variable", name: "j" },
          line: 5
        })
      ])
    );
  });

  it("captures Matrix relations while executing a nested-loop grid fixture in real Pyodide", async () => {
    const finished: ExecutionTerminalResult[] = [];
    const runtime = createPyodideRuntime({
      indexURL: `${process.cwd()}/node_modules/pyodide/`,
      onFinished: (result) => finished.push(result)
    });

    await runtime.execute({
      ...request,
      sessionId: "matrix-min-path-session",
      sourceCode: `class Solution:
    def minPathSum(self, grid):
        m, n = len(grid), len(grid[0])
        dp = [[0] * n for _ in range(m)]
        for i in range(m):
            for j in range(n):
                dp[i][j] = grid[i][j]
        return dp[-1][-1]
`,
      rawTestcase: "[[1, 3, 1], [1, 5, 1], [4, 2, 1]]",
      entrypoint: {
        className: "Solution",
        methodName: "minPathSum",
        parameterCount: 1,
        parameterKinds: ["value"]
      }
    });

    expect(finished[0]).toEqual(expect.objectContaining({
      status: "completed",
      returnValue: { type: "int", value: "1" },
      subscriptRelations: expect.arrayContaining([
        expect.objectContaining({
          kind: "matrix_subscript",
          scope: "Solution.minPathSum",
          container: "dp",
          rowIndex: { kind: "variable", name: "i" },
          columnIndex: { kind: "variable", name: "j" }
        })
      ])
    }));
  });

  it.each([false, true])("captures Minimum Path Sum choices and paths with hidden matrices: %s", async (hideMatrices) => {
    const finished: ExecutionTerminalResult[] = [];
    const traceBatches: TraceEvent[][] = [];
    const expressionPlans: ExpressionPlan[] = [];
    const runtime = createPyodideRuntime({
      indexURL: `${process.cwd()}/node_modules/pyodide/`,
      onTraceBatch: (_sessionId, events) => traceBatches.push(events),
      onExpressionPlan: (_sessionId, plan) => expressionPlans.push(plan),
      onFinished: (result) => finished.push(result)
    });

    await runtime.execute({
      ...request,
      sessionId: "expression-min-path-session",
      sourceCode: `class Solution:
    def minPathSum(self, grid):
        m, n = len(grid), len(grid[0])
        dp = [[0] * n for _ in range(m)]
${hideMatrices ? "        aa, bb, cc = [1], [2], [3]\n" : ""}\
        for i in range(m):
            for j in range(n):
                if i == 0 and j == 0:
                    dp[i][j] = grid[i][j]
                elif i == 0:
                    dp[i][j] = dp[i][j - 1] + grid[i][j]
                elif j == 0:
                    dp[i][j] = dp[i - 1][j] + grid[i][j]
                else:
                    dp[i][j] = min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j]
${hideMatrices ? "        del aa, bb, cc\n" : ""}\
        return dp[-1][-1]
`,
      rawTestcase: "[[1,3,1],[1,5,1],[4,2,1]]",
      entrypoint: {
        className: "Solution",
        methodName: "minPathSum",
        parameterCount: 1,
        parameterKinds: ["value"]
      }
    });

    const terminal = finished[0]!;
    expect(terminal).toEqual(expect.objectContaining({
      status: "completed",
      returnValue: { type: "int", value: "7" }
    }));
    const plan = expressionPlans[0] ?? terminal.expressionPlan!;
    const targetRoot = plan.roots.find((root) =>
      root.kind === "assignment" &&
      root.target.source === "dp[i][j]" &&
      plan.expressions.find((expression) => expression.exprId === root.expressionExprId)?.source.startsWith("min(")
    );
    expect(targetRoot).toBeDefined();
    const rootExpression = plan.expressions.find((expression) => expression.exprId === targetRoot?.expressionExprId);
    expect(rootExpression).toEqual(expect.objectContaining({
      kind: "binary",
      source: "min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j]"
    }));

    const traceEvents = traceBatches.flat();
    const matchingBatch = terminal.expressionBatches
      ?.flatMap((batch) => batch.roots.map((root) => ({ batch, root })))
      .find(({ batch, root }) => {
        const resultEvaluation = root.evaluations.find((evaluation) => evaluation.exprId === targetRoot?.expressionExprId);
        const anchorEvent = traceEvents.find((event) => event.step === batch.anchorStep);
        return root.rootId === targetRoot?.rootId &&
          resultEvaluation?.value.type === "int" &&
          resultEvaluation.value.value === "7" &&
          anchorEvent?.locals.i?.type === "int" &&
          anchorEvent.locals.i.value === "2" &&
          anchorEvent.locals.j?.type === "int" &&
          anchorEvent.locals.j.value === "2" &&
          root.selectionEvidence?.some((selection) =>
            selection.function === "min" && selection.status === "resolved"
          );
      });
    expect(matchingBatch).toBeDefined();
    const selection = matchingBatch?.root.selectionEvidence?.find((item) => item.function === "min");
    expect(selection).toEqual(expect.objectContaining({
      candidateExprIds: expect.arrayContaining([
        expect.any(String),
        expect.any(String)
      ]),
      selectedCandidateIndex: expect.any(Number),
      status: "resolved"
    }));
    expect(selection?.candidateExprIds).toHaveLength(2);

    const interpretation = interpretTrace(
      traceEvents,
      terminal.subscriptRelations ?? [],
      plan,
      terminal.expressionBatches ?? []
    );
    const evidenceRoot = interpretation.expressionEvidence
      .get(matchingBatch!.batch.anchorStep)?.roots
      .find((root) => root.rootId === targetRoot?.rootId);
    const finalMatrices = interpretation.visualStates.at(-1)!.visuals
      .filter((visual) => visual.kind === "matrix");
    for (const name of ["grid", "dp"]) {
      const path = finalMatrices.find((visual) => visual.variableName === name)?.path;
      expect(path, `${name} keeps its recorded path on return`).toBeDefined();
      const coordinates: number[][] = [];
      let node = path?.nodes.get("2:2");
      expect(node?.complete).toBe(true);
      while (node) {
        coordinates.unshift([node.row, node.column]);
        node = node.previous;
      }
      expect(coordinates).toEqual([[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]);
    }
    const beforeLastWrite = interpretation.visualStates.find((state) => state.step === matchingBatch!.batch.anchorStep)!;
    const earlyDp = beforeLastWrite.visuals.find((visual) => visual.kind === "matrix" && visual.variableName === "dp");
    expect(earlyDp?.kind === "matrix" && earlyDp.path?.nodes.has("2:2")).not.toBe(true);
    const view = createTraceVisualizer({
      schemaVersion: 2, sessionId: "matrix-path-ui", sourceCode: "", rawTestcase: "",
      entrypoint: request.entrypoint, executionEnvironment: { runtime: "pyodide", pythonVersion: "3.13" },
      status: "completed", terminationReason: "normal_return", events: traceEvents,
      stdout: "", limits: request.limits, expressionPlan: plan,
      expressionBatches: terminal.expressionBatches, subscriptRelations: terminal.subscriptRelations
    });
    view.setStep(traceEvents.length - 1);
    const gridView = () => view.element.querySelector<HTMLElement>('[data-variable-name="grid"]')!;
    const dpView = () => view.element.querySelector<HTMLElement>('[data-variable-name="dp"]')!;
    expect(gridView().querySelectorAll("[data-path-cell]")).toHaveLength(5);
    gridView().querySelector<HTMLElement>('[data-cell-row="0"][data-cell-column="1"]')!.click();
    expect(dpView().querySelectorAll("[data-path-cell]")).toHaveLength(2);
    dpView().querySelector<HTMLElement>('[data-matrix-action="follow-path"]')!.click();
    expect(gridView().querySelectorAll("[data-path-cell]")).toHaveLength(5);
    view.setStep(traceEvents.findIndex((event) => event.step === matchingBatch!.batch.anchorStep));
    if (earlyDp?.kind === "matrix") {
      expect(dpView().querySelector('[data-cell-row="2"][data-cell-column="2"][data-path-cell]')).toBeNull();
    }
    view.dispose();
    expect(evidenceRoot?.structureReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        variableName: "dp",
        kind: "matrix_cell",
        row: 1,
        column: 2,
        role: "selected_operand"
      }),
      expect.objectContaining({
        variableName: "dp",
        kind: "matrix_cell",
        row: 2,
        column: 1,
        role: "operand"
      }),
      expect.objectContaining({
        variableName: "grid",
        kind: "matrix_cell",
        row: 2,
        column: 2,
        role: "operand"
      }),
      expect.objectContaining({
        variableName: "dp",
        kind: "matrix_cell",
        row: 2,
        column: 2,
        role: "assignment_target"
      })
    ]));

    const dpMutation = interpretation.mutationBatches
      .flatMap((batch) => batch.mutations)
      .find((mutation) =>
        mutation.kind === "sequence_element" &&
        mutation.containerName === "dp" &&
        mutation.index === 2 &&
        mutation.after?.type === "list" &&
        mutation.after.items[2]?.type === "int" &&
        mutation.after.items[2].value === "7"
      );
    expect(dpMutation).toBeDefined();
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

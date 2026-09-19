import { describe, expect, it } from "vitest";

import {
  isTerminationReason,
  isTraceSessionStatus,
  isWorkerOutboundMessage
} from "../../src/shared/worker-protocol";

describe("worker protocol", () => {
  it("accepts every legal trace session status and rejects unknown values", () => {
    const statuses = [
      "running",
      "completed",
      "exception",
      "trace_limit",
      "timeout",
      "parse_error",
      "input_error",
      "internal_error"
    ];

    for (const status of statuses) {
      expect(isTraceSessionStatus(status)).toBe(true);
    }
    expect(isTraceSessionStatus("accepted")).toBe(false);
  });

  it("accepts every legal termination reason and rejects unknown values", () => {
    const reasons = [
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
    ];

    for (const reason of reasons) {
      expect(isTerminationReason(reason)).toBe(true);
    }
    expect(isTerminationReason("leetcode_tle")).toBe(false);
  });

  it("keeps the session id on trace batches and separates terminal results", () => {
    const traceBatch = {
      type: "trace_batch",
      sessionId: "session-1",
      events: []
    };
    const terminal = {
      type: "execution_finished",
      sessionId: "session-1",
      result: {
        status: "timeout",
        terminationReason: "hard_timeout",
        stdout: "",
        durationMs: 100
      }
    };

    expect(isWorkerOutboundMessage(traceBatch)).toBe(true);
    expect(traceBatch.sessionId).toBe("session-1");
    expect(isWorkerOutboundMessage(terminal)).toBe(true);
    expect("events" in terminal).toBe(false);
  });

  it("allows a timeout terminal result without a final trace batch", () => {
    expect(
      isWorkerOutboundMessage({
        type: "execution_finished",
        sessionId: "session-2",
        result: {
          status: "timeout",
          terminationReason: "hard_timeout",
          stdout: "partial output",
          durationMs: 200
        }
      })
    ).toBe(true);
  });

  it("accepts trace batches containing object topology snapshots", () => {
    const traceBatch = {
      type: "trace_batch",
      sessionId: "session-3",
      events: [
        {
          step: 1,
          event: "line",
          frameId: 1,
          parentFrameId: null,
          function: "reverseList",
          line: 4,
          callDepth: 1,
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
          objectsTruncated: false,
          stdoutDelta: ""
        }
      ]
    };

    expect(isWorkerOutboundMessage(traceBatch)).toBe(true);
  });

  it("accepts expression plans and batches with deterministic batch ids", () => {
    expect(
      isWorkerOutboundMessage({
        type: "expression_plan",
        sessionId: "s1",
        plan: { version: 1, roots: [], expressions: [] }
      })
    ).toBe(true);

    expect(
      isWorkerOutboundMessage({
        type: "expression_batch",
        sessionId: "s1",
        batches: [
          {
            batchId: 1,
            anchorStep: 4,
            frameId: 2,
            line: 9,
            roots: []
          }
        ]
      })
    ).toBe(true);
  });

  it("accepts condition plans and completed decision batches with ordered truth results", () => {
    expect(
      isWorkerOutboundMessage({
        type: "condition_plan",
        sessionId: "s1",
        plan: { version: 1, sites: [], conditions: [], operands: [], chains: [] }
      })
    ).toBe(true);

    expect(
      isWorkerOutboundMessage({
        type: "decision_batch",
        sessionId: "s1",
        batches: [{
          batchId: 1,
          anchorStep: 4,
          frameId: 2,
          siteId: "d1",
          occurrence: 1,
          status: "completed",
          condition: {
            conditionId: "d1.c0",
            evaluations: [],
            conditionResults: [{ conditionId: "d1.c0", order: 1, truth: false }],
            truth: false
          },
          outcome: "branch_not_entered"
        }]
      })
    ).toBe(true);
  });

  it("accepts partial decision batches without an outcome", () => {
    expect(
      isWorkerOutboundMessage({
        type: "decision_batch",
        sessionId: "s1",
        batches: [{
          batchId: 2,
          anchorStep: 5,
          frameId: 2,
          siteId: "d1",
          occurrence: 2,
          status: "partial",
          condition: {
            conditionId: "d1.c0",
            evaluations: [],
            conditionResults: []
          }
        }]
      })
    ).toBe(true);
  });

  it("accepts control-flow plans and runtime batches", () => {
    expect(isWorkerOutboundMessage({
      type: "control_flow_plan",
      sessionId: "s1",
      plan: {
        version: 1,
        loops: [{
          loopId: "f1",
          kind: "for",
          span: { line: 2, column: 4, endLine: 4, endColumn: 12 },
          target: {
            source: "x",
            span: { line: 2, column: 8, endLine: 2, endColumn: 9 },
            bindingNames: ["x"],
            capturable: true
          }
        }],
        transfers: []
      }
    })).toBe(true);

    expect(isWorkerOutboundMessage({
      type: "control_flow_batch",
      sessionId: "s1",
      batches: [{
        batchId: 1,
        events: [{
          eventId: 1,
          kind: "iteration_begin",
          anchorStep: 4,
          frameId: 2,
          context: { loopStack: [{ loopId: "f1", iteration: 1 }] },
          loopId: "f1",
          loopKind: "for",
          iteration: 1,
          bindings: [{ name: "x", value: { type: "int", value: "7" } }]
        }]
      }]
    })).toBe(true);
  });

  it("accepts function plans and call-frame batches with bound arguments", () => {
    expect(isWorkerOutboundMessage({
      type: "function_plan",
      sessionId: "s1",
      plan: {
        version: 1,
        functions: [{
          functionId: "fn1",
          kind: "method",
          name: "maxDepth",
          qualifiedName: "Solution.maxDepth",
          span: { line: 2, column: 4, endLine: 6, endColumn: 20 },
          firstBodyLine: 3,
          parameterNames: ["self", "root"],
          parameterKinds: ["positional_or_keyword", "positional_or_keyword"],
          parentClassName: "Solution"
        }]
      }
    })).toBe(true);

    expect(isWorkerOutboundMessage({
      type: "call_frame_batch",
      sessionId: "s1",
      batches: [{
        batchId: 1,
        updates: [{
          updateId: 1,
          kind: "frame_enter",
          frameId: 2,
          parentFrameId: 1,
          functionName: "depth",
          functionId: "fn2",
          callStep: 7,
          depth: 2,
          arguments: [{
            name: "node",
            kind: "positional_or_keyword",
            value: { type: "none", value: null }
          }]
        }]
      }]
    })).toBe(true);
  });

  it("rejects malformed function plans and call-frame updates", () => {
    const plan = {
      type: "function_plan",
      sessionId: "s1",
      plan: {
        version: 1,
        functions: [{
          functionId: "fn1",
          kind: "function",
          name: "f",
          qualifiedName: "f",
          span: { line: 1, column: 0, endLine: 2, endColumn: 10 },
          firstBodyLine: 1,
          parameterNames: ["value"],
          parameterKinds: ["positional_or_keyword"]
        }]
      }
    } as const;

    expect(isWorkerOutboundMessage({
      ...plan,
      plan: { ...plan.plan, version: 2 }
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...plan,
      plan: {
        ...plan.plan,
        functions: [plan.plan.functions[0], plan.plan.functions[0]]
      }
    })).toBe(false);

    const enter = {
      updateId: 1,
      kind: "frame_enter",
      frameId: 2,
      parentFrameId: 1,
      functionName: "f",
      callStep: 7,
      depth: 2,
      arguments: [{
        name: "value",
        kind: "positional_or_keyword",
        value: { type: "int", value: "1" }
      }]
    } as const;
    const base = {
      type: "call_frame_batch",
      sessionId: "s1",
      batches: [{ batchId: 1, updates: [enter] }]
    } as const;

    expect(isWorkerOutboundMessage({
      ...base,
      batches: [{ batchId: 1, updates: [{ ...enter, frameId: 0 }] }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...base,
      batches: [{ batchId: 1, updates: [{ ...enter, parentFrameId: enter.frameId }] }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...base,
      batches: [{ batchId: 1, updates: [{ ...enter, callStep: 0 }] }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...base,
      batches: [{ batchId: 1, updates: [{ ...enter, arguments: [{ ...enter.arguments[0], kind: "invalid" } as never] }] }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...base,
      batches: [{ batchId: 1, updates: [
        enter,
        { ...enter, updateId: 1, frameId: 3 }
      ] }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...base,
      batches: [{ batchId: 1, updates: [{
        updateId: 2,
        kind: "frame_return",
        frameId: 2,
        exitStep: 0
      }] }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...base,
      batches: [{ batchId: 1, updates: [{
        updateId: 2,
        kind: "frame_return",
        frameId: 2,
        exitStep: 8
      }] }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...base,
      batches: [{ batchId: 1, updates: [{
        updateId: 2,
        kind: "frame_exception",
        frameId: 2,
        exitStep: 8
      }] }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...base,
      batches: [{ batchId: 1, updates: [{
        updateId: 2,
        kind: "frame_trace_ended",
        frameId: 2
      }] }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...base,
      batches: [{ batchId: 1, updates: [{ ...enter, kind: "unknown" } as never] }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...base,
      batches: [{ batchId: 1, updates: [{ ...enter, recursionDepth: 0 }] }]
    })).toBe(false);
  });

  it("rejects malformed control-flow protocol fields", () => {
    const plan = {
      type: "control_flow_plan",
      sessionId: "s1",
      plan: {
        version: 1,
        loops: [],
        transfers: []
      }
    } as const;
    expect(isWorkerOutboundMessage({ ...plan, plan: { ...plan.plan, version: 2 } })).toBe(false);

    const batch = {
      type: "control_flow_batch",
      sessionId: "s1",
      batches: [{
        batchId: 1,
        events: [{
          eventId: 1,
          kind: "transfer_status",
          anchorStep: 4,
          frameId: 2,
          context: { loopStack: [] },
          actionId: "a1",
          status: "observed"
        }]
      }]
    } as const;
    expect(isWorkerOutboundMessage(batch)).toBe(false);
    expect(isWorkerOutboundMessage({
      ...batch,
      batches: [{ ...batch.batches[0], events: [{ ...batch.batches[0].events[0], kind: "loop_exit", loopId: "f1", loopKind: "for", reason: "unknown" } as const] }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...batch,
      batches: [{ ...batch.batches[0], events: [{ ...batch.batches[0].events[0], kind: "iteration_begin", anchorStep: 0, loopId: "f1", loopKind: "for", iteration: 0, bindings: [] } as const] }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...batch,
      batches: [{ ...batch.batches[0], events: [
        { ...batch.batches[0].events[0], kind: "iteration_complete", eventId: 2, loopId: "f1", iteration: 1 } as const,
        { ...batch.batches[0].events[0], kind: "iteration_complete", eventId: 1, loopId: "f1", iteration: 1 } as const
      ] }]
    })).toBe(false);
  });

  it("accepts decision context and rejects malformed loop stacks", () => {
    const decisionBatch = {
      type: "decision_batch",
      sessionId: "s1",
      batches: [{
        batchId: 1,
        anchorStep: 4,
        frameId: 2,
        siteId: "d1",
        occurrence: 1,
        status: "completed",
        context: { loopStack: [{ loopId: "f1", iteration: 1 }] },
        condition: {
          conditionId: "d1.c0",
          evaluations: [],
          conditionResults: [{ conditionId: "d1.c0", order: 1, truth: false }],
          truth: false
        },
        outcome: "branch_not_entered"
      }]
    };
    expect(isWorkerOutboundMessage(decisionBatch)).toBe(true);
    expect(isWorkerOutboundMessage({
      ...decisionBatch,
      batches: [{ ...decisionBatch.batches[0], context: { loopStack: [{ loopId: "f1", iteration: 0 }] } }]
    })).toBe(false);
  });

  it("rejects malformed decision protocol fields", () => {
    const base = {
      type: "decision_batch",
      sessionId: "s1",
      batches: [{
        batchId: 1,
        anchorStep: 4,
        frameId: 2,
        siteId: "d1",
        occurrence: 1,
        status: "completed",
        condition: {
          conditionId: "d1.c0",
          evaluations: [],
          conditionResults: [{ conditionId: "d1.c0", order: 1, truth: false }],
          truth: false
        },
        outcome: "branch_not_entered"
      }]
    } as const;

    expect(isWorkerOutboundMessage({ ...base, batches: [{ ...base.batches[0], batchId: undefined }] })).toBe(false);
    expect(isWorkerOutboundMessage({ ...base, batches: [{ ...base.batches[0], occurrence: 1.5 }] })).toBe(false);
    expect(isWorkerOutboundMessage({ ...base, batches: [{ ...base.batches[0], status: "partial" }] })).toBe(false);
    expect(isWorkerOutboundMessage({ ...base, batches: [{ ...base.batches[0], status: "unknown" }] })).toBe(false);
    expect(isWorkerOutboundMessage({
      ...base,
      batches: [{ ...base.batches[0], condition: { ...base.batches[0].condition, conditionResults: [{ conditionId: "d1.c0", order: 2, truth: false }, { conditionId: "d1.c1", order: 1, truth: true }] } }]
    })).toBe(false);
    expect(isWorkerOutboundMessage({
      type: "condition_plan",
      sessionId: "s1",
      plan: { version: 2, sites: [], conditions: [], operands: [], chains: [] }
    })).toBe(false);
  });

  it("rejects malformed expression plans and batches", () => {
    expect(
      isWorkerOutboundMessage({
        type: "expression_batch",
        sessionId: "s1",
        batches: [{ anchorStep: 4, frameId: 2, line: 9, roots: [] }]
      })
    ).toBe(false);

    expect(
      isWorkerOutboundMessage({
        type: "expression_batch",
        sessionId: "s1",
        batches: [
          {
            batchId: 1,
            anchorStep: 4.5,
            frameId: 2,
            line: 9,
            roots: []
          }
        ]
      })
    ).toBe(false);

    expect(
      isWorkerOutboundMessage({
        type: "expression_plan",
        sessionId: "s1",
        plan: { version: 2, roots: [], expressions: [] }
      })
    ).toBe(false);
  });
});

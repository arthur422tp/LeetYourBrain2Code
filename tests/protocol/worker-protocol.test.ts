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

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
});

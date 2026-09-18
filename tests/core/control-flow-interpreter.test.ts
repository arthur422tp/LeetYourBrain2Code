import { describe, expect, it } from "vitest";

import { buildControlFlowEvidence } from "../../src/core/control-flow-interpreter";
import { reconstructStates } from "../../src/core/state-reconstructor";
import type { ControlFlowBatch, ControlFlowPlan } from "../../src/shared/control-flow-types";
import type { TraceEvent, ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const plan: ControlFlowPlan = { version: 1, loops: [{ loopId: "f1", kind: "for", span: { line: 2, column: 0, endLine: 3, endColumn: 1 } }], transfers: [] };

function rawEvent(step: number): TraceEvent {
  return { step, event: "line", frameId: 1, parentFrameId: null, function: "solve", line: 2, callDepth: 1, locals: { x: int(step) }, stdoutDelta: "" };
}

function batch(events: ControlFlowBatch["events"]): ControlFlowBatch {
  return { batchId: events[0]!.eventId, events };
}

function baseEvent(eventId: number, anchorStep: number, context = { loopStack: [{ loopId: "f1", iteration: 1 }] }) {
  return { eventId, anchorStep, frameId: 1, context };
}

describe("control-flow-interpreter", () => {
  it("reconstructs completed iteration anchors and status", () => {
    const result = buildControlFlowEvidence(plan, [batch([
      { ...baseEvent(1, 3), kind: "iteration_begin", loopId: "f1", loopKind: "for", iteration: 1, bindings: [] },
      { ...baseEvent(2, 8), kind: "iteration_complete", loopId: "f1", iteration: 1 }
    ])], reconstructStates([rawEvent(3), rawEvent(8)]));
    expect(result.iterations).toEqual([expect.objectContaining({ status: "completed", anchorStepStart: 3, anchorStepEnd: 8 })]);
  });

  it("marks continue and break from committed actions without fabricating unknown actions", () => {
    const result = buildControlFlowEvidence(plan, [batch([
      { ...baseEvent(1, 3), kind: "iteration_begin", loopId: "f1", loopKind: "for", iteration: 1, bindings: [] },
      { ...baseEvent(2, 4), kind: "transfer_observed", actionId: "a1", transferId: "t1", transferKind: "continue", targetLoopId: "f1" },
      { ...baseEvent(3, 5), kind: "transfer_status", actionId: "a1", status: "committed" },
      { ...baseEvent(4, 6, { loopStack: [{ loopId: "f1", iteration: 2 }] }), kind: "iteration_begin", loopId: "f1", loopKind: "for", iteration: 2, bindings: [] },
      { ...baseEvent(5, 7, { loopStack: [{ loopId: "f1", iteration: 2 }] }), kind: "transfer_observed", actionId: "a2", transferId: "t2", transferKind: "break", targetLoopId: "f1" },
      { ...baseEvent(6, 8, { loopStack: [{ loopId: "f1", iteration: 2 }] }), kind: "transfer_status", actionId: "a2", status: "committed" },
      { ...baseEvent(7, 9, { loopStack: [{ loopId: "f1", iteration: 2 }] }), kind: "loop_exit", loopId: "f1", loopKind: "for", reason: "break" },
      { ...baseEvent(8, 10), kind: "transfer_status", actionId: "unknown", status: "committed" }
    ])], reconstructStates(Array.from({ length: 8 }, (_, index) => rawEvent(index + 3))));
    expect(result.actions.map((action) => action.status)).toEqual(["committed", "committed"]);
    expect(result.iterations.map((iteration) => iteration.status)).toEqual(["continued", "broke"]);
    expect(result.loopExits).toHaveLength(1);
    expect(result.loopExits[0]).toMatchObject({ reason: "break", loopId: "f1" });
  });

  it("projects open iterations as interrupted only with terminal context", () => {
    const result = buildControlFlowEvidence(plan, [batch([
      { ...baseEvent(1, 3), kind: "iteration_begin", loopId: "f1", loopKind: "for", iteration: 1, bindings: [] }
    ])], reconstructStates([rawEvent(3)]), { status: "timeout", terminationReason: "hard_timeout" });
    expect(result.iterations[0]).toMatchObject({ status: "interrupted", anchorStepEnd: 3 });
    expect(result.loopExits).toEqual([expect.objectContaining({ reason: "trace_ended", loopId: "f1" })]);
  });

  it("chooses the deepest runtime occurrence context for each raw step", () => {
    const nested = { loopStack: [{ loopId: "f1", iteration: 2 }, { loopId: "w2", iteration: 3 }] };
    const nestedPlan = { ...plan, loops: [...plan.loops, { loopId: "w2", kind: "while" as const, span: { line: 4, column: 0, endLine: 5, endColumn: 1 } }] };
    const result = buildControlFlowEvidence(nestedPlan, [batch([
      { eventId: 1, anchorStep: 3, frameId: 1, context: nested, kind: "iteration_begin", loopId: "f1", loopKind: "for", iteration: 2, bindings: [] },
      { eventId: 2, anchorStep: 4, frameId: 1, context: nested, kind: "iteration_begin", loopId: "w2", loopKind: "while", iteration: 3, bindings: [] },
      { eventId: 3, anchorStep: 5, frameId: 1, context: nested, kind: "iteration_complete", loopId: "w2", iteration: 3 },
      { eventId: 4, anchorStep: 6, frameId: 1, context: { loopStack: [{ loopId: "f1", iteration: 2 }] }, kind: "iteration_complete", loopId: "f1", iteration: 2 }
    ])], reconstructStates([rawEvent(3), rawEvent(4), rawEvent(5), rawEvent(6)]));
    expect(result.contextByStep.get(5)).toEqual(nested);
  });

  it("does not re-finalize an exhausted loop when the frame later throws", () => {
    const result = buildControlFlowEvidence(
      plan,
      [batch([
        {
          ...baseEvent(1, 3),
          kind: "iteration_begin",
          loopId: "f1",
          loopKind: "for",
          iteration: 1,
          bindings: []
        },
        {
          ...baseEvent(2, 4),
          kind: "iteration_complete",
          loopId: "f1",
          iteration: 1
        },
        {
          ...baseEvent(3, 5, { loopStack: [] }),
          kind: "loop_exit",
          loopId: "f1",
          loopKind: "for",
          reason: "exhausted"
        }
      ])],
      reconstructStates([rawEvent(3), rawEvent(4), rawEvent(5), rawEvent(6)]),
      { status: "exception", terminationReason: "exception" }
    );

    expect(result.iterations).toEqual([
      expect.objectContaining({ loopId: "f1", iteration: 1, status: "completed" })
    ]);
    expect(result.loopExits).toEqual([
      expect.objectContaining({ loopId: "f1", reason: "exhausted" })
    ]);
  });

  it("finalizes only the second active loop when an earlier loop already exited", () => {
    const twoLoopPlan: ControlFlowPlan = {
      version: 1,
      loops: [
        { loopId: "f1", kind: "for", span: { line: 2, column: 0, endLine: 3, endColumn: 1 } },
        { loopId: "w2", kind: "while", span: { line: 5, column: 0, endLine: 6, endColumn: 1 } }
      ],
      transfers: []
    };

    const result = buildControlFlowEvidence(
      twoLoopPlan,
      [batch([
        {
          eventId: 1,
          anchorStep: 2,
          frameId: 1,
          context: { loopStack: [{ loopId: "f1", iteration: 1 }] },
          kind: "iteration_begin",
          loopId: "f1",
          loopKind: "for",
          iteration: 1,
          bindings: []
        },
        {
          eventId: 2,
          anchorStep: 3,
          frameId: 1,
          context: { loopStack: [{ loopId: "f1", iteration: 1 }] },
          kind: "iteration_complete",
          loopId: "f1",
          iteration: 1
        },
        {
          eventId: 3,
          anchorStep: 4,
          frameId: 1,
          context: { loopStack: [] },
          kind: "loop_exit",
          loopId: "f1",
          loopKind: "for",
          reason: "exhausted"
        },
        {
          eventId: 4,
          anchorStep: 6,
          frameId: 1,
          context: { loopStack: [{ loopId: "w2", iteration: 1 }] },
          kind: "iteration_begin",
          loopId: "w2",
          loopKind: "while",
          iteration: 1,
          bindings: []
        }
      ])],
      reconstructStates([2, 3, 4, 5, 6].map(rawEvent)),
      { status: "timeout", terminationReason: "hard_timeout" }
    );

    expect(result.loopExits.filter((item) => item.loopId === "f1"))
      .toEqual([expect.objectContaining({ reason: "exhausted" })]);
    expect(result.loopExits.filter((item) => item.loopId === "w2"))
      .toEqual([expect.objectContaining({ reason: "trace_ended" })]);
    expect(result.iterations.find((item) => item.loopId === "w2"))
      .toMatchObject({ status: "interrupted" });
  });

  it("finalizes nested active loops from inner to outer", () => {
    const nestedPlan: ControlFlowPlan = {
      version: 1,
      loops: [
        { loopId: "f1", kind: "for", span: { line: 2, column: 0, endLine: 6, endColumn: 1 } },
        { loopId: "w2", kind: "while", span: { line: 3, column: 0, endLine: 5, endColumn: 1 } }
      ],
      transfers: []
    };
    const nestedContext = {
      loopStack: [
        { loopId: "f1", iteration: 1 },
        { loopId: "w2", iteration: 1 }
      ]
    };

    const result = buildControlFlowEvidence(
      nestedPlan,
      [batch([
        {
          eventId: 1,
          anchorStep: 2,
          frameId: 1,
          context: { loopStack: [{ loopId: "f1", iteration: 1 }] },
          kind: "iteration_begin",
          loopId: "f1",
          loopKind: "for",
          iteration: 1,
          bindings: []
        },
        {
          eventId: 2,
          anchorStep: 3,
          frameId: 1,
          context: nestedContext,
          kind: "iteration_begin",
          loopId: "w2",
          loopKind: "while",
          iteration: 1,
          bindings: []
        }
      ])],
      reconstructStates([rawEvent(2), rawEvent(3)]),
      { status: "exception", terminationReason: "exception" }
    );

    expect(result.loopExits.map((exit) => exit.loopId)).toEqual(["w2", "f1"]);
    expect(result.loopExits.map((exit) => exit.reason)).toEqual(["exception", "exception"]);
  });
});

import { describe, expect, it } from "vitest";

import { interpretTraceSession } from "../../src/core/trace-session-interpreter";
import { buildCrossRunFunctionIdentityIndex } from "../../src/core/cross-run-alignment";
import {
  BEHAVIORAL_CHECKPOINT_PRECEDENCE,
  projectCrossRunFrames,
  behavioralCheckpointPrecedence,
  type CrossRunFrameProjection
} from "../../src/core/cross-run-checkpoints";
import { DEFAULT_EXECUTION_LIMITS } from "../../src/shared/execution-types";
import type { FunctionPlan } from "../../src/shared/call-frame-types";
import type { ConditionPlan } from "../../src/shared/decision-types";
import type { ControlFlowPlan } from "../../src/shared/control-flow-types";
import type { ExpressionPlan } from "../../src/shared/expression-types";
import type { TraceSession, ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const values = (value: number): ValueSnapshot => ({
  type: "list",
  length: 1,
  items: [int(value)],
  truncated: false
});

function fixtureSession(): TraceSession {
  const sourceCode = [
    "class Solution:",
    "    def solve(self, values):",
    "        for item in values:",
    "            if item:",
    "                total = item",
    "        return total",
    ""
  ].join("\n");
  const span = (line: number, column: number, endColumn: number) => ({
    line,
    column,
    endLine: line,
    endColumn
  });
  const expressionPlan: ExpressionPlan = {
    version: 1,
    roots: [{
      rootId: "assignment-1",
      kind: "assignment",
      expressionExprId: "assignment-1.0",
      target: { source: "total", span: span(5, 16, 21) },
      span: span(5, 16, 28)
    }],
    expressions: [{
      exprId: "assignment-1.0",
      rootId: "assignment-1",
      parentExprId: null,
      kind: "name",
      span: span(5, 24, 28),
      source: "item",
      childExprIds: []
    }]
  };
  const conditionPlan: ConditionPlan = {
    version: 1,
    sites: [{
      siteId: "decision-1",
      kind: "if",
      conditionId: "condition-1",
      span: span(4, 12, 20)
    }],
    conditions: [{
      conditionId: "condition-1",
      siteId: "decision-1",
      kind: "truth_test",
      source: "item",
      span: span(4, 15, 19),
      childConditionIds: [],
      operandIds: []
    }],
    operands: [],
    chains: []
  };
  const controlFlowPlan: ControlFlowPlan = {
    version: 1,
    loops: [{ loopId: "loop-1", kind: "for", span: span(3, 8, 28) }],
    transfers: []
  };
  const functionPlan: FunctionPlan = {
    version: 1,
    functions: [{
      functionId: "method:Solution.solve",
      kind: "method",
      name: "solve",
      qualifiedName: "Solution.solve",
      span: span(2, 4, 31),
      firstBodyLine: 3,
      parameterNames: ["self", "values"],
      parameterKinds: ["positional_or_keyword", "positional_or_keyword"]
    }, {
      functionId: "function:helper",
      kind: "function",
      name: "helper",
      qualifiedName: "helper",
      span: span(7, 0, 10),
      firstBodyLine: 8,
      parameterNames: ["value"],
      parameterKinds: ["positional_or_keyword"]
    }]
  };

  return {
    schemaVersion: 6,
    sessionId: "checkpoint-session",
    sourceCode,
    rawTestcase: "[1]",
    entrypoint: {
      className: "Solution",
      methodName: "solve",
      parameterCount: 1,
      parameterKinds: ["value"]
    },
    executionEnvironment: { runtime: "pyodide", pythonVersion: "3.13" },
    status: "completed",
    terminationReason: "normal_return",
    events: [
      {
        step: 10,
        event: "line",
        frameId: 1,
        parentFrameId: null,
        function: "solve",
        line: 3,
        callDepth: 1,
        locals: { values: values(1), item: int(1) },
        objects: [{ objectId: "obj-1", className: "Node", attributes: { value: int(1) } }],
        stdoutDelta: ""
      },
      {
        step: 20,
        event: "line",
        frameId: 1,
        parentFrameId: null,
        function: "solve",
        line: 4,
        callDepth: 1,
        locals: { values: values(1), item: int(1) },
        objects: [{ objectId: "obj-1", className: "Node", attributes: { value: int(2) } }],
        stdoutDelta: ""
      },
      {
        step: 25,
        event: "call",
        frameId: 2,
        parentFrameId: 1,
        function: "helper",
        line: 8,
        callDepth: 2,
        locals: { value: int(1) },
        objects: [{ objectId: "obj-1", className: "Node", attributes: { value: int(2) } }],
        stdoutDelta: ""
      },
      {
        step: 30,
        event: "line",
        frameId: 1,
        parentFrameId: null,
        function: "solve",
        line: 5,
        callDepth: 1,
        locals: { values: values(1), item: int(1), total: int(1) },
        objects: [{ objectId: "obj-1", className: "Node", attributes: { value: int(2) } }],
        stdoutDelta: ""
      },
      {
        step: 40,
        event: "line",
        frameId: 1,
        parentFrameId: null,
        function: "solve",
        line: 6,
        callDepth: 1,
        locals: { values: values(1), item: int(1), total: int(1) },
        objects: [{ objectId: "obj-1", className: "Node", attributes: { value: int(2) } }],
        stdoutDelta: ""
      }
    ],
    stdout: "",
    limits: DEFAULT_EXECUTION_LIMITS,
    expressionPlan,
    expressionBatches: [{
      batchId: 1,
      anchorStep: 30,
      frameId: 1,
      line: 5,
      roots: [{
        rootId: "assignment-1",
        status: "completed",
        evaluations: [{ evaluationId: 1, exprId: "assignment-1.0", order: 1, value: int(1) }],
        resultExprId: "assignment-1.0"
      }]
    }],
    expressionTracing: { status: "complete" },
    conditionPlan,
    decisionBatches: [{
      batchId: 1,
      anchorStep: 20,
      frameId: 1,
      siteId: "decision-1",
      occurrence: 1,
      status: "completed",
      condition: {
        conditionId: "condition-1",
        evaluations: [],
        conditionResults: [{ conditionId: "condition-1", order: 1, truth: true }],
        truth: true
      },
      outcome: "branch_entered"
    }],
    decisionTracing: { status: "complete" },
    controlFlowPlan,
    controlFlowBatches: [{
      batchId: 1,
      events: [{
        eventId: 1,
        anchorStep: 10,
        frameId: 1,
        context: { loopStack: [{ loopId: "loop-1", iteration: 1 }] },
        kind: "iteration_begin",
        loopId: "loop-1",
        loopKind: "for",
        iteration: 1,
        bindings: [{ name: "item", value: int(1) }]
      }, {
        eventId: 2,
        anchorStep: 20,
        frameId: 1,
        context: { loopStack: [{ loopId: "loop-1", iteration: 1 }] },
        kind: "iteration_complete",
        loopId: "loop-1",
        iteration: 1
      }, {
        eventId: 3,
        anchorStep: 40,
        frameId: 1,
        context: { loopStack: [] },
        kind: "loop_exit",
        loopId: "loop-1",
        loopKind: "for",
        reason: "exhausted"
      }]
    }],
    controlFlowTracing: { status: "complete" },
    functionPlan,
    callFrameBatches: [{
      batchId: 1,
      updates: [{
        updateId: 1,
        kind: "frame_enter",
        frameId: 1,
        parentFrameId: null,
        functionName: "solve",
        functionId: "method:Solution.solve",
        callStep: 10,
        depth: 1,
        arguments: [{ name: "values", kind: "positional_or_keyword", value: values(1) }]
      }, {
        updateId: 2,
        kind: "frame_enter",
        frameId: 2,
        parentFrameId: 1,
        functionName: "helper",
        functionId: "function:helper",
        callStep: 25,
        depth: 2,
        arguments: [{ name: "value", kind: "positional_or_keyword", value: int(1) }]
      }, {
        updateId: 3,
        kind: "frame_return",
        frameId: 2,
        exitStep: 30,
        value: int(1)
      }, {
        updateId: 4,
        kind: "frame_return",
        frameId: 1,
        exitStep: 40,
        value: int(1)
      }]
    }],
    callFrameTracing: { status: "complete" },
    returnValue: int(1)
  };
}

describe("projectCrossRunFrames", () => {
  it("projects all supported evidence into deterministic frame-local checkpoints", () => {
    const session = fixtureSession();
    const interpretation = interpretTraceSession(session);
    const identities = buildCrossRunFunctionIdentityIndex(
      interpretation.callFrames,
      session.functionPlan
    );
    const projection = projectCrossRunFrames(session, interpretation, identities);
    const solve = projection.frames.get(1) as CrossRunFrameProjection;

    expect(solve.entry.arguments[0]?.name).toBe("values");
    expect(solve.childFrameIds).toEqual([2]);
    expect(solve.exit.exit).toMatchObject({ status: "returned", step: 40 });
    expect(solve.checkpoints.map((checkpoint) => checkpoint.kind)).toEqual([
      "loop_iteration",
      "mutation",
      "mutation",
      "decision",
      "child_call",
      "expression",
      "mutation",
      "loop_exit"
    ]);
    expect(solve.checkpoints.find((checkpoint) => checkpoint.kind === "decision")).toMatchObject({
      semanticKey: expect.stringContaining("item"),
      truth: true,
      outcome: "branch_entered"
    });
    expect(solve.checkpoints.find((checkpoint) => checkpoint.kind === "child_call")).toMatchObject({
      childFrameId: 2,
      callee: expect.objectContaining({ displayName: "helper" })
    });
    expect(projection.coverage.skippedUnstableObjectMutations).toBeGreaterThan(0);
  });

  it("uses source-span text and stable precedence without cross-run local IDs", () => {
    expect(behavioralCheckpointPrecedence("decision")).toBe(BEHAVIORAL_CHECKPOINT_PRECEDENCE.decision);
    expect(behavioralCheckpointPrecedence("child_call"))
      .toBeGreaterThan(behavioralCheckpointPrecedence("mutation"));
    const session = fixtureSession();
    const interpretation = interpretTraceSession(session);
    const identities = buildCrossRunFunctionIdentityIndex(interpretation.callFrames, session.functionPlan);
    const checkpoint = projectCrossRunFrames(session, interpretation, identities)
      .frames.get(1)!.checkpoints.find((item) => item.kind === "loop_iteration");

    expect(checkpoint?.semanticKey).toContain("for");
    expect(checkpoint?.semanticKey).toContain("for item in values:");
    expect(checkpoint?.semanticKey).not.toContain("loop-1");
    expect(checkpoint?.semanticKey).not.toContain("frameId");
  });
});

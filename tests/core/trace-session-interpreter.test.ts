import { describe, expect, it } from "vitest";

import { interpretTraceSession } from "../../src/core/trace-session-interpreter";
import type { ConditionPlan, DecisionBatch } from "../../src/shared/decision-types";
import type { ControlFlowBatch, ControlFlowPlan } from "../../src/shared/control-flow-types";
import type { CallFrameBatch, FunctionPlan } from "../../src/shared/call-frame-types";
import type { ExpressionBatch, ExpressionPlan } from "../../src/shared/expression-types";
import type { TraceSession, ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

const span = { line: 3, column: 8, endLine: 3, endColumn: 13 };

function sessionWithAllEvidence(): TraceSession {
  const expressionPlan: ExpressionPlan = {
    version: 1,
    roots: [{
      rootId: "return-1",
      kind: "return",
      expressionExprId: "return-1.0",
      span
    }],
    expressions: [{
      exprId: "return-1.0",
      rootId: "return-1",
      parentExprId: null,
      kind: "name",
      span,
      source: "value",
      childExprIds: []
    }]
  };
  const expressionBatches: ExpressionBatch[] = [{
    batchId: 1,
    anchorStep: 1,
    frameId: 1,
    line: 3,
    roots: [{
      rootId: "return-1",
      status: "completed",
      evaluations: [{
        evaluationId: 1,
        exprId: "return-1.0",
        order: 1,
        value: int(3)
      }],
      resultExprId: "return-1.0"
    }]
  }];

  const conditionPlan: ConditionPlan = {
    version: 1,
    sites: [{ siteId: "decision-1", kind: "if", conditionId: "condition-1", span }],
    conditions: [{
      conditionId: "condition-1",
      siteId: "decision-1",
      kind: "truth_test",
      source: "value",
      span,
      childConditionIds: [],
      operandIds: ["operand-1"]
    }],
    operands: [{
      operandId: "operand-1",
      conditionId: "condition-1",
      source: "value",
      span
    }],
    chains: []
  };
  const decisionBatches: DecisionBatch[] = [{
    batchId: 1,
    anchorStep: 1,
    frameId: 1,
    siteId: "decision-1",
    occurrence: 1,
    status: "completed",
    condition: {
      conditionId: "condition-1",
      evaluations: [{ operandId: "operand-1", order: 1, value: int(3) }],
      conditionResults: [{ conditionId: "condition-1", order: 1, truth: true }],
      truth: true
    },
    outcome: "branch_entered"
  }];

  const controlFlowPlan: ControlFlowPlan = {
    version: 1,
    loops: [{ loopId: "loop-1", kind: "for", span }],
    transfers: []
  };
  const controlFlowBatches: ControlFlowBatch[] = [{
    batchId: 1,
    events: [{
      eventId: 1,
      anchorStep: 1,
      frameId: 1,
      context: { loopStack: [{ loopId: "loop-1", iteration: 1 }] },
      kind: "iteration_begin",
      loopId: "loop-1",
      loopKind: "for",
      iteration: 1,
      bindings: []
    }]
  }];

  const functionPlan: FunctionPlan = {
    version: 1,
    functions: [{
      functionId: "method:Solution.solve",
      kind: "method",
      name: "solve",
      qualifiedName: "Solution.solve",
      span,
      firstBodyLine: 3,
      parameterNames: ["value"],
      parameterKinds: ["positional_or_keyword"]
    }]
  };
  const callFrameBatches: CallFrameBatch[] = [{
    batchId: 1,
    updates: [{
      updateId: 1,
      kind: "frame_enter",
      frameId: 1,
      parentFrameId: null,
      functionName: "solve",
      functionId: "method:Solution.solve",
      callStep: 1,
      depth: 1,
      arguments: [{
        name: "value",
        kind: "positional_or_keyword",
        value: int(3)
      }]
    }]
  }];

  return {
    schemaVersion: 6,
    sessionId: "session-with-all-evidence",
    sourceCode: "class Solution:\n    def solve(self, value):\n        return value\n",
    rawTestcase: "3",
    entrypoint: {
      className: "Solution",
      methodName: "solve",
      parameterCount: 1,
      parameterKinds: ["value"]
    },
    executionEnvironment: { runtime: "pyodide", pythonVersion: "3.13" },
    status: "timeout",
    terminationReason: "hard_timeout",
    events: [{
      step: 1,
      event: "line",
      frameId: 1,
      parentFrameId: null,
      function: "solve",
      line: 3,
      callDepth: 1,
      locals: { value: int(3) },
      stdoutDelta: ""
    }],
    stdout: "",
    limits: {
      maxTraceSteps: 10,
      maxContainerItems: 10,
      maxNestingDepth: 4,
      maxSnapshotBytes: 1000,
      maxSessionBytes: 10000,
      maxStdoutBytes: 1000,
      hardTimeoutMs: 100,
      maxObjectNodes: 10,
      maxObjectAttributes: 10,
      maxObjectDepth: 4,
      maxExpressionEvents: 10,
      maxExpressionBytes: 1000,
      maxDecisionEvents: 10,
      maxDecisionBytes: 1000,
      maxControlFlowEvents: 10,
      maxControlFlowBytes: 1000,
      maxCallFrameEvents: 10,
      maxCallFrameBytes: 1000
    },
    expressionPlan,
    expressionBatches,
    conditionPlan,
    decisionBatches,
    controlFlowPlan,
    controlFlowBatches,
    functionPlan,
    callFrameBatches,
    callFrameTracing: { status: "complete" }
  };
}

describe("interpretTraceSession", () => {
  it("forwards every optional evidence channel and termination context", () => {
    const interpretation = interpretTraceSession(sessionWithAllEvidence());

    expect(interpretation.expressionEvidence.get(1)?.roots[0]?.tree.value).toEqual(int(3));
    expect(interpretation.decisionEvidence.get(1)?.condition.truth).toBe(true);
    expect(interpretation.controlFlow.iterations).toMatchObject([{
      loopId: "loop-1",
      status: "interrupted"
    }]);
    expect(interpretation.controlFlow.loopExits).toMatchObject([{
      loopId: "loop-1",
      reason: "trace_ended"
    }]);
    expect(interpretation.callFrames.byFrameId.get(1)).toMatchObject({
      functionId: "method:Solution.solve",
      exit: { status: "trace_ended", reason: "hard_timeout" }
    });
  });
});

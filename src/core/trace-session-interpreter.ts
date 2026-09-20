import { interpretTrace, type TraceInterpretation } from "./trace-interpreter";
import type { TraceSession } from "../shared/trace-types";

export function interpretTraceSession(session: TraceSession): TraceInterpretation {
  return interpretTrace(
    session.events,
    session.subscriptRelations ?? [],
    session.expressionPlan,
    session.expressionBatches ?? [],
    session.conditionPlan,
    session.decisionBatches ?? [],
    session.controlFlowPlan,
    session.controlFlowBatches ?? [],
    { status: session.status, terminationReason: session.terminationReason },
    session.functionPlan,
    session.callFrameBatches ?? [],
    session.callFrameTracing
  );
}

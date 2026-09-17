import type {
  EntryPoint,
  ExecutionLimits,
  ExecutionTerminalResult
} from "../shared/execution-types";
import {
  TRACE_SCHEMA_VERSION,
  type ExecutionEnvironment,
  type TraceEvent,
  type TraceSession
} from "../shared/trace-types";
import type {
  ExpressionBatch,
  ExpressionPlan,
  ExpressionTracingState
} from "../shared/expression-types";
import type {
  ConditionPlan,
  DecisionBatch,
  DecisionTracingState
} from "../shared/decision-types";
import type {
  ControlFlowBatch,
  ControlFlowPlan,
  ControlFlowTracingState
} from "../shared/control-flow-types";

export interface TraceSessionCollectorOptions {
  sessionId: string;
  sourceCode: string;
  rawTestcase: string;
  entrypoint: EntryPoint;
  limits: ExecutionLimits;
  executionEnvironment?: ExecutionEnvironment;
}

export class TraceSessionCollector {
  private readonly options: TraceSessionCollectorOptions;
  private readonly events: TraceEvent[] = [];
  private readonly encodedEventBytes = new TextEncoder();
  private stdout = "";
  private lastStep: number | null = null;
  private resourceLimitReached = false;
  private expressionPlan: ExpressionPlan | undefined;
  private readonly expressionBatches: ExpressionBatch[] = [];
  private readonly expressionBatchIds = new Set<number>();
  private expressionTracing: ExpressionTracingState | undefined;
  private expressionBytes = 0;
  private conditionPlan: ConditionPlan | undefined;
  private readonly decisionBatches: DecisionBatch[] = [];
  private readonly decisionBatchIds = new Set<number>();
  private decisionTracing: DecisionTracingState | undefined;
  private decisionBytes = 0;
  private controlFlowPlan: ControlFlowPlan | undefined;
  private readonly controlFlowBatches: ControlFlowBatch[] = [];
  private readonly controlFlowBatchIds = new Set<number>();
  private controlFlowTracing: ControlFlowTracingState | undefined;
  private controlFlowBytes = 0;
  private terminalSession: TraceSession | null = null;

  public constructor(options: TraceSessionCollectorOptions) {
    this.options = options;
  }

  public append(events: TraceEvent[]): void {
    if (this.terminalSession || this.resourceLimitReached) {
      return;
    }

    for (const event of events) {
      if (this.lastStep !== null && event.step <= this.lastStep) {
        continue;
      }

      const eventBytes = this.encodedEventBytes.encode(JSON.stringify(event)).byteLength;
      const currentBytes = this.encodedEventBytes.encode(JSON.stringify(this.events)).byteLength;
      if (currentBytes + eventBytes > this.options.limits.maxSessionBytes) {
        this.resourceLimitReached = true;
        return;
      }

      this.events.push(event);
      this.lastStep = event.step;
      this.stdout += event.stdoutDelta;
    }
  }

  public setExpressionPlan(plan: ExpressionPlan): void {
    if (!this.terminalSession) {
      this.expressionPlan = plan;
    }
  }

  public appendExpressionBatches(batches: ExpressionBatch[]): void {
    if (this.terminalSession || this.expressionTracing?.status === "truncated") {
      return;
    }

    for (const batch of batches) {
      if (this.expressionBatchIds.has(batch.batchId)) continue;
      const batchBytes = this.encodedEventBytes.encode(JSON.stringify(batch)).byteLength;
      if (this.expressionBytes + batchBytes > this.options.limits.maxExpressionBytes) {
        this.expressionTracing = {
          status: "truncated",
          reason: "expression_byte_limit"
        };
        return;
      }
      this.expressionBytes += batchBytes;
      this.expressionBatchIds.add(batch.batchId);
      this.expressionBatches.push(batch);
    }
  }

  public setExpressionTracingState(state: ExpressionTracingState): void {
    if (this.terminalSession || this.expressionTracing?.status === "truncated") {
      return;
    }
    this.expressionTracing = state;
  }

  public setConditionPlan(plan: ConditionPlan): void {
    if (!this.terminalSession) {
      this.conditionPlan = plan;
    }
  }

  public appendDecisionBatches(batches: DecisionBatch[]): void {
    if (this.terminalSession || this.decisionTracing?.status === "truncated") {
      return;
    }
    for (const batch of batches) {
      if (this.decisionBatchIds.has(batch.batchId)) continue;
      const batchBytes = this.encodedEventBytes.encode(JSON.stringify(batch)).byteLength;
      if (this.decisionBytes + batchBytes > this.options.limits.maxDecisionBytes) {
        this.decisionTracing = { status: "truncated", reason: "decision_byte_limit" };
        return;
      }
      this.decisionBytes += batchBytes;
      this.decisionBatchIds.add(batch.batchId);
      this.decisionBatches.push(batch);
    }
  }

  public setDecisionTracingState(state: DecisionTracingState): void {
    if (this.terminalSession || this.decisionTracing?.status === "truncated") return;
    this.decisionTracing = state;
  }

  public setControlFlowPlan(plan: ControlFlowPlan): void {
    if (!this.terminalSession) this.controlFlowPlan = plan;
  }

  public appendControlFlowBatches(batches: ControlFlowBatch[]): void {
    if (this.terminalSession || this.controlFlowTracing?.status === "truncated") return;
    for (const batch of batches) {
      if (this.controlFlowBatchIds.has(batch.batchId)) continue;
      const batchBytes = this.encodedEventBytes.encode(JSON.stringify(batch)).byteLength;
      if (this.controlFlowBytes + batchBytes > this.options.limits.maxControlFlowBytes) {
        this.controlFlowTracing = { status: "truncated", reason: "control_flow_byte_limit" };
        return;
      }
      this.controlFlowBytes += batchBytes;
      this.controlFlowBatchIds.add(batch.batchId);
      this.controlFlowBatches.push(batch);
    }
  }

  public setControlFlowTracingState(state: ControlFlowTracingState): void {
    if (this.terminalSession || this.controlFlowTracing?.status === "truncated") return;
    this.controlFlowTracing = state;
  }

  public finish(result: ExecutionTerminalResult): TraceSession {
    if (this.terminalSession) {
      return this.terminalSession;
    }

    if (result.controlFlowPlan) this.setControlFlowPlan(result.controlFlowPlan);
    if (result.controlFlowBatches) this.appendControlFlowBatches(result.controlFlowBatches);
    if (result.controlFlowTracing) this.setControlFlowTracingState(result.controlFlowTracing);

    const terminalResult = this.resourceLimitReached
      ? {
          ...result,
          status: "trace_limit" as const,
          terminationReason: "trace_byte_limit" as const
        }
      : result;
    this.terminalSession = this.createSession(terminalResult);
    return this.terminalSession;
  }

  public forceTimeout(): TraceSession {
    if (this.terminalSession) {
      return this.terminalSession;
    }

    this.terminalSession = this.createSession({
      status: "timeout",
      terminationReason: "hard_timeout",
      stdout: this.stdout,
      durationMs: 0
    });
    return this.terminalSession;
  }

  private createSession(result: ExecutionTerminalResult): TraceSession {
    return {
      schemaVersion: TRACE_SCHEMA_VERSION,
      sessionId: this.options.sessionId,
      sourceCode: this.options.sourceCode,
      rawTestcase: this.options.rawTestcase,
      entrypoint: this.options.entrypoint,
      executionEnvironment: this.options.executionEnvironment ?? {
        runtime: "pyodide",
        pythonVersion: "unknown"
      },
      status: result.status,
      terminationReason: result.terminationReason,
      events: [...this.events],
      stdout: result.stdout || this.stdout,
      limits: this.options.limits,
      ...(result.subscriptRelations
        ? { subscriptRelations: result.subscriptRelations.map((relation) => ({ ...relation })) }
        : {}),
      ...(result.returnValue !== undefined ? { returnValue: result.returnValue } : {}),
      ...(result.exception ? { exception: result.exception } : {}),
      ...(this.expressionPlan ? { expressionPlan: this.expressionPlan } : {}),
      ...(this.expressionBatches.length > 0
        ? { expressionBatches: [...this.expressionBatches] }
        : {}),
      ...(this.expressionTracing ? { expressionTracing: this.expressionTracing } : {}),
      ...(this.conditionPlan ? { conditionPlan: this.conditionPlan } : {}),
      ...(this.decisionBatches.length > 0 ? { decisionBatches: [...this.decisionBatches] } : {}),
      ...(this.decisionTracing ? { decisionTracing: this.decisionTracing } : {}),
      ...(this.controlFlowPlan ? { controlFlowPlan: this.controlFlowPlan } : {}),
      ...(this.controlFlowBatches.length > 0 ? { controlFlowBatches: [...this.controlFlowBatches] } : {}),
      ...(this.controlFlowTracing ? { controlFlowTracing: this.controlFlowTracing } : {})
    };
  }
}

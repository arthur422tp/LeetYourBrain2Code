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

  public finish(result: ExecutionTerminalResult): TraceSession {
    if (this.terminalSession) {
      return this.terminalSession;
    }

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
      ...(result.returnValue !== undefined ? { returnValue: result.returnValue } : {}),
      ...(result.exception ? { exception: result.exception } : {})
    };
  }
}

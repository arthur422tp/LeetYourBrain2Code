import type { ExecutionRequest } from "../shared/execution-types";
import type { TraceSession } from "../shared/trace-types";
import { createExecutionRequest } from "./execution-request";
import { getSelectedTestcase } from "./testcase-selection";

export const DEFAULT_LIVE_DEBOUNCE_MS = 200;

export type LiveStatus =
  | "editing"
  | "updating"
  | "synced"
  | "runtime_error"
  | "timeout";

export interface LiveExecutionInput {
  language: string;
  sourceCode: string;
  rawTestcase: string;
  selectedCaseIndex: number;
}

export interface LiveExecutionRunner {
  execute(request: ExecutionRequest): Promise<TraceSession>;
}

export interface LiveExecutionSchedulerOptions {
  runner: LiveExecutionRunner;
  createSessionId: () => string;
  debounceMs?: number;
  onStatusChange?: (status: LiveStatus) => void;
  onSession?: (session: TraceSession) => void;
}

export interface LiveScheduleOptions {
  immediate?: boolean;
  force?: boolean;
}

interface AcceptedRun {
  revision: number;
  request: ExecutionRequest;
}

function inputKey(input: LiveExecutionInput): string {
  return JSON.stringify([
    input.language,
    input.sourceCode,
    input.rawTestcase,
    input.selectedCaseIndex
  ]);
}

function liveStatusFor(session: TraceSession): LiveStatus {
  if (session.status === "completed") return "synced";
  if (session.status === "timeout") return "timeout";
  return "runtime_error";
}

export class LiveExecutionScheduler {
  private readonly runner: LiveExecutionRunner;
  private readonly createSessionId: () => string;
  private readonly debounceMs: number;
  private readonly onStatusChange?: (status: LiveStatus) => void;
  private readonly onSession?: (session: TraceSession) => void;

  private revision = 0;
  private latestRevision = 0;
  private latestRunnableRevision = 0;
  private latestInputKey: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: AcceptedRun | null = null;
  private pending: AcceptedRun | null = null;
  private currentStatus: LiveStatus | null = null;
  private disposed = false;

  public constructor(options: LiveExecutionSchedulerOptions) {
    this.runner = options.runner;
    this.createSessionId = options.createSessionId;
    this.debounceMs = options.debounceMs ?? DEFAULT_LIVE_DEBOUNCE_MS;
    this.onStatusChange = options.onStatusChange;
    this.onSession = options.onSession;
  }

  public schedule(
    input: LiveExecutionInput,
    options: LiveScheduleOptions = {}
  ): number {
    if (this.disposed) return this.latestRevision;

    const key = inputKey(input);
    if (!options.force && key === this.latestInputKey) {
      return this.latestRevision;
    }

    this.latestInputKey = key;
    const revision = ++this.revision;
    this.latestRevision = revision;
    this.clearTimer();
    this.emitStatus("updating");

    if (options.immediate) {
      this.accept(revision, input);
    } else {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.accept(revision, input);
      }, this.debounceMs);
    }
    return revision;
  }

  public dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.pending = null;
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private emitStatus(status: LiveStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    this.onStatusChange?.(status);
  }

  private accept(revision: number, input: LiveExecutionInput): void {
    if (this.disposed || revision !== this.latestRevision) return;

    if (input.language !== "python") {
      this.pending = null;
      this.emitStatus("editing");
      return;
    }

    const selectedTestcase = getSelectedTestcase(
      input.sourceCode,
      input.rawTestcase,
      input.selectedCaseIndex
    );
    if (selectedTestcase === null) {
      this.pending = null;
      this.emitStatus("editing");
      return;
    }

    const built = createExecutionRequest({
      sessionId: this.createSessionId(),
      sourceCode: input.sourceCode,
      rawTestcase: selectedTestcase
    });
    if (!built.ok) {
      this.pending = null;
      this.emitStatus("editing");
      return;
    }

    this.latestRunnableRevision = revision;
    this.pending = { revision, request: built.request };
    this.emitStatus("updating");
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.running !== null || this.pending === null) return;

    const run = this.pending;
    this.pending = null;
    this.running = run;

    try {
      const session = await this.runner.execute(run.request);
      if (this.disposed) return;

      if (run.revision === this.latestRunnableRevision) {
        this.onSession?.(session);
      }
      if (run.revision === this.latestRevision) {
        this.emitStatus(liveStatusFor(session));
      }
    } catch {
      if (!this.disposed && run.revision === this.latestRevision) {
        this.emitStatus("runtime_error");
      }
    } finally {
      if (this.running?.revision === run.revision) {
        this.running = null;
      }
      if (!this.disposed && this.pending !== null) {
        this.emitStatus("updating");
        void this.drain();
      }
    }
  }
}

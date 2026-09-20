import { TRACE_SCHEMA_VERSION } from "../shared/trace-types";
import type { EntryPoint } from "../shared/execution-types";
import type { TraceSession } from "../shared/trace-types";
import type { AcceptedLiveSession } from "../execution/live-execution-scheduler";

export interface RunContext {
  problemSlug: string | null;
  problemTitle: string | null;
  selectedCaseIndex: number;
  language: string;
}

export interface RunRecord {
  session: TraceSession;
  context: RunContext;
}

export function runRecordFromAcceptedSession(
  session: TraceSession,
  accepted: AcceptedLiveSession
): RunRecord {
  return {
    session,
    context: {
      problemSlug: accepted.input.problemSlug,
      problemTitle: accepted.input.problemTitle,
      selectedCaseIndex: accepted.input.selectedCaseIndex,
      language: accepted.input.language
    }
  };
}

export type ComparisonCompatibility =
  | { status: "compatible" }
  | { status: "no_baseline" }
  | { status: "no_current" }
  | { status: "same_run" }
  | { status: "different_problem" }
  | { status: "different_testcase" }
  | { status: "different_entrypoint" }
  | { status: "unsupported_schema" }
  | { status: "unsupported_runtime" };

export function normalizeExecutedTestcase(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function entrypointsCompatible(left: EntryPoint, right: EntryPoint): boolean {
  return left.className === right.className
    && left.methodName === right.methodName
    && left.parameterCount === right.parameterCount
    && left.parameterKinds.length === right.parameterKinds.length
    && left.parameterKinds.every((kind, index) => kind === right.parameterKinds[index]);
}

function supportedSchema(session: TraceSession): boolean {
  return Number.isInteger(session.schemaVersion)
    && session.schemaVersion > 0
    && session.schemaVersion <= TRACE_SCHEMA_VERSION;
}

function supportedRuntime(session: TraceSession): boolean {
  return session.executionEnvironment.runtime === "pyodide";
}

export function compareRunCompatibility(
  baseline: RunRecord | null,
  current: RunRecord | null
): ComparisonCompatibility {
  if (baseline === null) return { status: "no_baseline" };
  if (current === null) return { status: "no_current" };
  if (baseline.session.sessionId === current.session.sessionId) return { status: "same_run" };
  if (!supportedSchema(baseline.session) || !supportedSchema(current.session)) {
    return { status: "unsupported_schema" };
  }
  if (!supportedRuntime(baseline.session) || !supportedRuntime(current.session)) {
    return { status: "unsupported_runtime" };
  }
  if (baseline.context.problemSlug !== current.context.problemSlug) {
    return { status: "different_problem" };
  }
  if (normalizeExecutedTestcase(baseline.session.rawTestcase) !== normalizeExecutedTestcase(current.session.rawTestcase)) {
    return { status: "different_testcase" };
  }
  if (!entrypointsCompatible(baseline.session.entrypoint, current.session.entrypoint)) {
    return { status: "different_entrypoint" };
  }
  return { status: "compatible" };
}

export interface RunComparisonState {
  baseline: RunRecord | null;
  current: RunRecord | null;
}

export interface RunComparisonStateController {
  get(): RunComparisonState;
  setCurrent(run: RunRecord): void;
  pinCurrent(): boolean;
  replaceBaseline(): boolean;
  clearBaseline(): void;
  clearForProblemChange(): void;
}

export function createRunComparisonState(): RunComparisonStateController {
  let baseline: RunRecord | null = null;
  let current: RunRecord | null = null;

  return {
    get: () => ({ baseline, current }),
    setCurrent(run) {
      current = run;
    },
    pinCurrent() {
      if (current === null) return false;
      baseline = current;
      return true;
    },
    replaceBaseline() {
      if (current === null) return false;
      baseline = current;
      return true;
    },
    clearBaseline() {
      baseline = null;
    },
    clearForProblemChange() {
      baseline = null;
      current = null;
    }
  };
}

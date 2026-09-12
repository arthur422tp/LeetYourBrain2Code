import {
  DEFAULT_EXECUTION_LIMITS,
  type ExecutionLimits,
  type ExecutionRequest
} from "../shared/execution-types";
import { resolveEntrypointForTestcase } from "./entrypoint-resolver";
import { validateTestcaseLineCount } from "./testcase-parser";

export interface ExecutionRequestInput {
  sessionId: string;
  sourceCode: string;
  rawTestcase: string;
  limits?: Partial<ExecutionLimits>;
}

export type ExecutionRequestResult =
  | { ok: true; request: ExecutionRequest }
  | { ok: false; reason: "entrypoint_resolution_failed" | "input_error" };

export function createExecutionRequest(
  input: ExecutionRequestInput
): ExecutionRequestResult {
  if (input.sessionId.trim().length === 0) {
    return { ok: false, reason: "input_error" };
  }

  const resolution = resolveEntrypointForTestcase(input.sourceCode, input.rawTestcase);
  if (!resolution.ok) {
    return resolution;
  }

  const testcaseValidation = validateTestcaseLineCount(
    input.rawTestcase,
    resolution.entrypoint.parameterCount
  );
  if (!testcaseValidation.ok) {
    return testcaseValidation;
  }

  return {
    ok: true,
    request: {
      sessionId: input.sessionId,
      sourceCode: input.sourceCode,
      rawTestcase: input.rawTestcase,
      entrypoint: resolution.entrypoint,
      limits: { ...DEFAULT_EXECUTION_LIMITS, ...input.limits }
    }
  };
}

import { resolveEntrypointForTestcase } from "./entrypoint-resolver";
import { splitTestcaseIntoCases } from "./testcase-parser";

export function getTestcaseCases(
  sourceCode: string,
  rawTestcase: string
): string[] {
  const resolution = resolveEntrypointForTestcase(sourceCode, rawTestcase);
  if (!resolution.ok) {
    return [];
  }

  const result = splitTestcaseIntoCases(
    rawTestcase,
    resolution.entrypoint.parameterCount
  );
  return result.ok ? result.cases : [];
}

export function getSelectedTestcase(
  sourceCode: string,
  rawTestcase: string,
  selectedCaseIndex: number
): string | null {
  return getTestcaseCases(sourceCode, rawTestcase)[selectedCaseIndex] ?? null;
}

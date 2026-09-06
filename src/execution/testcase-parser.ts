export type TestcaseLineValidation =
  | { ok: true; argumentLines: string[] }
  | { ok: false; reason: "input_error" };

export type TestcaseCasesValidation =
  | { ok: true; cases: string[] }
  | { ok: false; reason: "input_error" };

export function getTestcaseArgumentLines(rawTestcase: string): string[] {
  const normalized = rawTestcase.replace(/\r\n?/g, "\n");
  if (normalized.trim().length === 0) {
    return [];
  }

  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function validateTestcaseLineCount(
  rawTestcase: string,
  parameterCount: number
): TestcaseLineValidation {
  const argumentLines = getTestcaseArgumentLines(rawTestcase);
  return argumentLines.length === parameterCount
    ? { ok: true, argumentLines }
    : { ok: false, reason: "input_error" };
}

export function splitTestcaseIntoCases(
  rawTestcase: string,
  parameterCount: number
): TestcaseCasesValidation {
  const argumentLines = getTestcaseArgumentLines(rawTestcase);

  if (!Number.isInteger(parameterCount) || parameterCount < 0) {
    return { ok: false, reason: "input_error" };
  }

  if (parameterCount === 0) {
    return argumentLines.length === 0
      ? { ok: true, cases: [""] }
      : { ok: false, reason: "input_error" };
  }

  if (argumentLines.length === 0 || argumentLines.length % parameterCount !== 0) {
    return { ok: false, reason: "input_error" };
  }

  const cases: string[] = [];
  for (let index = 0; index < argumentLines.length; index += parameterCount) {
    cases.push(argumentLines.slice(index, index + parameterCount).join("\n"));
  }
  return { ok: true, cases };
}

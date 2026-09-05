export type TestcaseLineValidation =
  | { ok: true; argumentLines: string[] }
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

const MAX_CODE_LENGTH = 1_000_000;
const MAX_TESTCASE_LENGTH = 100_000;
const MAX_LANGUAGE_LENGTH = 64;

export interface ProblemMetadata {
  slug: string | null;
  title: string | null;
}

export interface LeetCodePageState {
  code: string | null;
  language: string | null;
  testcase: string | null;
  metadata: ProblemMetadata;
}

export interface LeetCodeSnapshot {
  code: string;
  language: string;
  testcase: string;
  metadata: ProblemMetadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validNullableString(value: unknown, maxLength: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function validMetadata(value: unknown): value is ProblemMetadata {
  return (
    isRecord(value) &&
    (value.slug === null || typeof value.slug === "string") &&
    (value.title === null || typeof value.title === "string")
  );
}

export function validatePageState(value: unknown): value is LeetCodePageState {
  return (
    isRecord(value) &&
    validNullableString(value.code, MAX_CODE_LENGTH) &&
    validNullableString(value.language, MAX_LANGUAGE_LENGTH) &&
    validNullableString(value.testcase, MAX_TESTCASE_LENGTH) &&
    validMetadata(value.metadata)
  );
}

export function validateSnapshot(value: unknown): value is LeetCodeSnapshot {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    value.code.length <= MAX_CODE_LENGTH &&
    typeof value.language === "string" &&
    value.language.length > 0 &&
    value.language.length <= MAX_LANGUAGE_LENGTH &&
    typeof value.testcase === "string" &&
    value.testcase.length <= MAX_TESTCASE_LENGTH &&
    validMetadata(value.metadata)
  );
}

export function toRunnableSnapshot(state: LeetCodePageState): LeetCodeSnapshot | null {
  if (
    state.code === null ||
    state.code.length === 0 ||
    state.language === null ||
    state.language.length === 0 ||
    state.testcase === null
  ) {
    return null;
  }

  return {
    code: state.code,
    language: state.language,
    testcase: state.testcase,
    metadata: state.metadata
  };
}

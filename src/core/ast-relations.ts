import type {
  MatrixIndexOperand,
  MatrixSubscriptRelation,
  StaticRelation,
  SubscriptRelation
} from "../shared/trace-types";

export type {
  IterationRelation,
  MatrixIndexOperand,
  MatrixSubscriptRelation,
  MembershipRelation,
  StaticRelation,
  SubscriptRelation
} from "../shared/trace-types";

function hasBaseRelationFields(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.scope === "string" &&
    typeof candidate.line === "number" &&
    Number.isInteger(candidate.line) &&
    typeof candidate.container === "string"
  );
}

function isMatrixIndexOperand(value: unknown): value is MatrixIndexOperand {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "variable") {
    return typeof candidate.name === "string";
  }
  return candidate.kind === "literal" &&
    typeof candidate.value === "number" &&
    Number.isSafeInteger(candidate.value);
}

export function isSubscriptRelation(value: unknown): value is SubscriptRelation {
  return hasBaseRelationFields(value) &&
    typeof value.index === "string" &&
    (value.kind === undefined || value.kind === "subscript");
}

export function isStaticRelation(value: unknown): value is StaticRelation {
  if (!hasBaseRelationFields(value)) {
    return false;
  }
  if (value.kind === undefined || value.kind === "subscript") {
    return typeof value.index === "string";
  }
  if (value.kind === "membership") {
    return typeof value.index === "string";
  }
  if (value.kind === "iteration") {
    return typeof value.index === "string" &&
    (value.value === undefined || typeof value.value === "string");
  }
  return value.kind === "matrix_subscript" &&
    isMatrixIndexOperand(value.rowIndex) &&
    isMatrixIndexOperand(value.columnIndex);
}

export function normalizeSubscriptRelation(value: unknown): StaticRelation | null {
  return isStaticRelation(value) ? { ...value } as StaticRelation : null;
}

export function relationMatchesFrameScope(
  relation: StaticRelation,
  functionName: string
): boolean {
  if (relation.scope === functionName) {
    return true;
  }
  const scopeParts = relation.scope.split(".");
  return scopeParts.at(-1) === functionName;
}

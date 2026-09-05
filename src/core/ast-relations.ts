import type { SubscriptRelation } from "../shared/trace-types";

export type { SubscriptRelation } from "../shared/trace-types";

export function isSubscriptRelation(value: unknown): value is SubscriptRelation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.scope === "string" &&
    typeof candidate.line === "number" &&
    Number.isInteger(candidate.line) &&
    typeof candidate.container === "string" &&
    typeof candidate.index === "string"
  );
}

export function normalizeSubscriptRelation(value: unknown): SubscriptRelation | null {
  return isSubscriptRelation(value) ? { ...value } : null;
}

export function relationMatchesFrameScope(
  relation: SubscriptRelation,
  functionName: string
): boolean {
  if (relation.scope === functionName) {
    return true;
  }
  const scopeParts = relation.scope.split(".");
  return scopeParts.at(-1) === functionName;
}

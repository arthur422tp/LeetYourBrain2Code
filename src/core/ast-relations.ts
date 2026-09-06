import type { StaticRelation, SubscriptRelation } from "../shared/trace-types";

export type {
  IterationRelation,
  MembershipRelation,
  StaticRelation,
  SubscriptRelation
} from "../shared/trace-types";

function hasRelationFields(value: unknown): value is Record<string, unknown> {
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

export function isSubscriptRelation(value: unknown): value is SubscriptRelation {
  return hasRelationFields(value) &&
    (value.kind === undefined || value.kind === "subscript");
}

export function isStaticRelation(value: unknown): value is StaticRelation {
  if (!hasRelationFields(value)) {
    return false;
  }
  if (value.kind === undefined || value.kind === "subscript") {
    return true;
  }
  if (value.kind === "membership") {
    return true;
  }
  return value.kind === "iteration" &&
    (value.value === undefined || typeof value.value === "string");
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

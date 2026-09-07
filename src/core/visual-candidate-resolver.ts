import type {
  VisualCandidate,
  VisualKind,
  VisualPriority,
  VisualSelection
} from "./visual-candidate";

export type { VisualCandidate, VisualKind, VisualPriority, VisualSelection } from "./visual-candidate";

function comparePriority(left: VisualPriority, right: VisualPriority): number {
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === rightValue) {
      continue;
    }
    return leftValue > rightValue ? -1 : 1;
  }
  return 0;
}

function compareCandidates(left: VisualCandidate, right: VisualCandidate): number {
  return comparePriority(left.priority, right.priority) ||
    left.kind.localeCompare(right.kind) ||
    left.visualId.localeCompare(right.visualId);
}

export function resolveVisualCandidates(candidates: VisualCandidate[]): VisualSelection {
  const visible = [...candidates].sort(compareCandidates).slice(0, 3);
  return {
    primary: visible[0] ?? null,
    visible
  };
}

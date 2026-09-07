export type VisualKind = "list" | "dict" | "linked_list";

export type VisualPriority = readonly [
  activeLineRelevant: boolean,
  mutated: boolean,
  pointerRelevant: boolean,
  rootReferenceCount: number
];

export interface VisualCandidate {
  visualId: string;
  kind: VisualKind;
  priority: VisualPriority;
}

export interface VisualSelection {
  primary: VisualCandidate | null;
  visible: VisualCandidate[];
}

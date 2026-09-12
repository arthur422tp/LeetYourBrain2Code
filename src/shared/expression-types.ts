import type { ValueSnapshot } from "./trace-types";

export interface SourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export type ExpressionKind =
  | "name"
  | "literal"
  | "subscript"
  | "attribute"
  | "unary"
  | "binary"
  | "call";

export type StaticStructureHint =
  | { kind: "list_index"; variableName: string; indexExprId: string }
  | {
      kind: "matrix_cell";
      variableName: string;
      rowExprId: string;
      columnExprId: string;
    };

export interface ExpressionDescriptor {
  exprId: string;
  rootId: string;
  parentExprId: string | null;
  kind: ExpressionKind;
  span: SourceSpan;
  source: string;
  childExprIds: string[];
  structureHint?: StaticStructureHint;
}

export interface AssignmentTargetDescriptor {
  source: string;
  span: SourceSpan;
  structureHint?:
    | { kind: "list_index"; variableName: string; indexSource: string }
    | {
        kind: "matrix_cell";
        variableName: string;
        rowSource: string;
        columnSource: string;
      };
}

export type ExpressionRootDescriptor =
  | {
      rootId: string;
      kind: "assignment";
      expressionExprId: string;
      target: AssignmentTargetDescriptor;
      span: SourceSpan;
    }
  | {
      rootId: string;
      kind: "return";
      expressionExprId: string;
      span: SourceSpan;
    };

export interface ExpressionPlan {
  version: 1;
  roots: ExpressionRootDescriptor[];
  expressions: ExpressionDescriptor[];
}

export interface ExpressionEvaluation {
  evaluationId: number;
  exprId: string;
  order: number;
  value: ValueSnapshot;
}

export interface SelectionEvidence {
  callExprId: string;
  function: "min" | "max";
  candidateExprIds: string[];
  result: ValueSnapshot;
  selectedCandidateIndex: number | null;
  status: "resolved" | "unsupported_call_shape" | "unsupported_value" | "ambiguous";
}

export interface ExpressionRootEvaluation {
  rootId: string;
  status: "completed" | "partial";
  evaluations: ExpressionEvaluation[];
  resultExprId?: string;
  selectionEvidence?: SelectionEvidence[];
}

export interface ExpressionBatch {
  batchId: number;
  anchorStep: number;
  frameId: number;
  line: number;
  roots: ExpressionRootEvaluation[];
}

export interface ExpressionTracingState {
  status: "complete" | "truncated" | "unavailable";
  reason?: string;
}

export type StructureOperandReference =
  | {
      exprId: string;
      variableName: string;
      kind: "list_index";
      index: number;
      rawIndex: number;
      role: "operand" | "selected_operand" | "assignment_target";
    }
  | {
      exprId: string;
      variableName: string;
      kind: "matrix_cell";
      row: number;
      column: number;
      rawRow: number;
      rawColumn: number;
      role: "operand" | "selected_operand" | "assignment_target";
    };

export interface ExpressionEvidenceNode {
  exprId: string;
  kind: ExpressionKind;
  source: string;
  value?: ValueSnapshot;
  children: ExpressionEvidenceNode[];
}

export interface ExpressionEvidenceRoot {
  rootId: string;
  kind: "assignment" | "return";
  status: "completed" | "partial";
  target?: AssignmentTargetDescriptor;
  tree: ExpressionEvidenceNode;
  selections: SelectionEvidence[];
  structureReferences: StructureOperandReference[];
}

export interface ExpressionStepEvidence {
  anchorStep: number;
  frameId: number;
  roots: ExpressionEvidenceRoot[];
}

export type ExpressionEvidenceByStep = Map<number, ExpressionStepEvidence>;

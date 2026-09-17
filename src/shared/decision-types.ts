import type { SourceSpan } from "./expression-types";
import type { ValueSnapshot } from "./trace-types";
import type { ExecutionContextRef } from "./control-flow-types";

export type DecisionSiteKind = "if" | "elif" | "while";
export type ConditionKind =
  | "truth_test"
  | "comparison"
  | "not"
  | "and"
  | "or"
  | "opaque";

export type ConditionStructureHint =
  | { kind: "list_index"; variableName: string; indexOperandId: string }
  | {
      kind: "matrix_cell";
      variableName: string;
      rowOperandId: string;
      columnOperandId: string;
    };

export interface ConditionOperandDescriptor {
  operandId: string;
  conditionId: string;
  source: string;
  span: SourceSpan;
  structureHint?: ConditionStructureHint;
}

export interface ConditionDescriptor {
  conditionId: string;
  siteId: string;
  kind: ConditionKind;
  source: string;
  span: SourceSpan;
  childConditionIds: string[];
  operandIds: string[];
}

export interface DecisionSiteDescriptor {
  siteId: string;
  kind: DecisionSiteKind;
  chainId?: string;
  branchIndex?: number;
  conditionId: string;
  span: SourceSpan;
}

export interface DecisionChainDescriptor {
  chainId: string;
  branches: Array<{
    branchIndex: number;
    kind: "if" | "elif" | "else";
    siteId?: string;
  }>;
}

export interface ConditionPlan {
  version: 1;
  sites: DecisionSiteDescriptor[];
  conditions: ConditionDescriptor[];
  operands: ConditionOperandDescriptor[];
  chains: DecisionChainDescriptor[];
}

export interface DecisionOperandEvaluation {
  operandId: string;
  order: number;
  value: ValueSnapshot;
}

export interface ConditionResult {
  conditionId: string;
  order: number;
  truth: boolean;
}

export interface ConditionEvaluation {
  conditionId: string;
  evaluations: DecisionOperandEvaluation[];
  conditionResults: ConditionResult[];
  truth?: boolean;
}

export type DecisionOutcome =
  | "branch_entered"
  | "branch_not_entered"
  | "loop_body_entered"
  | "loop_exited";

export interface DecisionBatch {
  batchId: number;
  anchorStep: number;
  frameId: number;
  siteId: string;
  occurrence: number;
  status: "completed" | "partial";
  condition: ConditionEvaluation;
  outcome?: DecisionOutcome;
  context?: ExecutionContextRef;
}

export interface DecisionChainOccurrence extends DecisionChainEvidence {
  occurrenceId: string;
  frameId: number;
  context: ExecutionContextRef;
  anchorStepStart: number;
  anchorStepEnd: number;
}

export interface DecisionTracingState {
  status: "complete" | "truncated" | "unavailable";
  reason?: string;
}

export type DecisionStructureReference =
  | {
      operandId: string;
      variableName: string;
      kind: "list_index";
      index: number;
      rawIndex: number;
      role: "condition_operand";
    }
  | {
      operandId: string;
      variableName: string;
      kind: "matrix_cell";
      row: number;
      column: number;
      rawRow: number;
      rawColumn: number;
      role: "condition_operand";
    };

export interface ConditionEvidenceNode {
  conditionId: string;
  kind: ConditionKind;
  source: string;
  status: "evaluated" | "short_circuited" | "not_reached" | "partial";
  truth?: boolean;
  operands: Array<{
    operandId: string;
    source: string;
    value?: ValueSnapshot;
  }>;
  children: ConditionEvidenceNode[];
  skipReason?: "and_short_circuit" | "or_short_circuit" | "earlier_branch_selected";
}

export interface DecisionStepEvidence {
  anchorStep: number;
  frameId: number;
  siteId: string;
  occurrence: number;
  status: "completed" | "partial";
  outcome?: DecisionOutcome;
  condition: ConditionEvidenceNode;
  structureReferences: DecisionStructureReference[];
}

export interface DecisionChainEvidence {
  chainId: string;
  branches: Array<{
    branchIndex: number;
    kind: "if" | "elif" | "else";
    status: "selected" | "rejected" | "not_reached";
    siteId?: string;
    condition?: ConditionEvidenceNode;
    anchorStep?: number;
  }>;
  selectedBranchIndex: number | null;
}

export interface DecisionHistoryEntry {
  siteId: string;
  occurrence: number;
  anchorStep: number;
  frameId: number;
  status: "completed" | "partial";
  truth?: boolean;
  outcome?: DecisionOutcome;
  condition: ConditionEvidenceNode;
}

export type DecisionEvidenceByStep = Map<number, DecisionStepEvidence>;
export type DecisionHistoryBySite = Map<string, DecisionHistoryEntry[]>;

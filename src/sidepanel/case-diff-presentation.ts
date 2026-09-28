import type {
  CrossRunDivergence,
  CrossRunDivergenceKind
} from "../core/cross-run-diff";
import type { AlignmentConfidence } from "../core/cross-run-alignment";

export type CaseDiffCategory =
  | "decision"
  | "mutation"
  | "call"
  | "control_flow"
  | "expression"
  | "termination";

export interface CaseDivergencePresentation {
  category: CaseDiffCategory;
  title: string;
  detail?: string;
  left: {
    caseLabel: string;
    factualText?: string;
    step?: number;
  };
  right: {
    caseLabel: string;
    factualText?: string;
    step?: number;
  };
  confidence: AlignmentConfidence;
}

const DIVERGENCE_PRESENTATION: Record<
  CrossRunDivergenceKind,
  { category: CaseDiffCategory; title: string }
> = {
  frame_argument_changed: { category: "call", title: "Call behavior differs" },
  child_call_changed: { category: "call", title: "Call behavior differs" },
  child_call_missing: { category: "call", title: "Call behavior differs" },
  child_call_extra: { category: "call", title: "Call behavior differs" },
  decision_truth_changed: { category: "decision", title: "Decision differs" },
  decision_outcome_changed: { category: "decision", title: "Decision differs" },
  decision_completion_changed: { category: "decision", title: "Decision differs" },
  decision_operand_changed: { category: "decision", title: "Decision differs" },
  decision_structure_changed: { category: "decision", title: "Decision differs" },
  expression_value_changed: { category: "expression", title: "Expression differs" },
  expression_selection_changed: { category: "expression", title: "Expression differs" },
  expression_structure_changed: { category: "expression", title: "Expression differs" },
  loop_iteration_binding_changed: { category: "control_flow", title: "Control flow differs" },
  iteration_status_changed: { category: "control_flow", title: "Control flow differs" },
  transfer_presence_changed: { category: "control_flow", title: "Control flow differs" },
  transfer_status_changed: { category: "control_flow", title: "Control flow differs" },
  loop_exit_reason_changed: { category: "control_flow", title: "Control flow differs" },
  mutation_value_changed: { category: "mutation", title: "State change differs" },
  mutation_presence_changed: { category: "mutation", title: "State change differs" },
  frame_exit_status_changed: { category: "termination", title: "Termination differs" },
  return_value_changed: { category: "termination", title: "Termination differs" },
  exception_type_changed: { category: "termination", title: "Termination differs" },
  trace_end_reason_changed: { category: "termination", title: "Termination differs" },
  session_outcome_changed: { category: "termination", title: "Termination differs" }
};

function caseLabel(selectedCaseIndex: number): string {
  return `Case ${selectedCaseIndex + 1}`;
}

function side(
  label: string,
  anchor: CrossRunDivergence["baseline"]
): CaseDivergencePresentation["left"] {
  return {
    caseLabel: label,
    ...(anchor?.factualText !== undefined ? { factualText: anchor.factualText } : {}),
    ...(anchor?.step !== undefined ? { step: anchor.step } : {})
  };
}

export function buildCaseDivergencePresentation(
  divergence: CrossRunDivergence | undefined,
  leftCaseIndex: number,
  rightCaseIndex: number
): CaseDivergencePresentation | undefined {
  if (!divergence || divergence.alignmentConfidence === "ambiguous") return undefined;

  const copy = DIVERGENCE_PRESENTATION[divergence.kind];
  return {
    category: copy.category,
    title: copy.title,
    ...(divergence.alignmentConfidence === "fallback"
      ? { detail: "Evidence alignment used a fallback function match." }
      : {}),
    left: side(caseLabel(leftCaseIndex), divergence.baseline),
    right: side(caseLabel(rightCaseIndex), divergence.current),
    confidence: divergence.alignmentConfidence
  };
}

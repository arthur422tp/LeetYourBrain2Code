import type { RuntimeState } from "./runtime-state";
import type {
  ExpressionPlan,
  ExpressionRootDescriptor,
  ExpressionRootEvaluation,
  StructureOperandReference
} from "../shared/expression-types";
import type { ValueSnapshot } from "../shared/trace-types";

function integerSnapshot(snapshot: ValueSnapshot | undefined): number | null {
  if (snapshot?.type !== "int" || !/^-?\d+$/.test(snapshot.value)) {
    return null;
  }
  const value = Number(snapshot.value);
  return Number.isSafeInteger(value) ? value : null;
}

function frameLocals(runtime: RuntimeState): Record<string, ValueSnapshot> | null {
  if (runtime.activeFrameId === null) {
    return null;
  }
  return runtime.frames.get(runtime.activeFrameId)?.locals ?? null;
}

function sequenceLength(snapshot: ValueSnapshot | undefined): number | null {
  if (
    (snapshot?.type !== "list" && snapshot?.type !== "tuple") ||
    !Number.isSafeInteger(snapshot.length) ||
    snapshot.length < 0
  ) {
    return null;
  }
  return snapshot.length;
}

function normalizeIndex(rawIndex: number, length: number): number | null {
  const index = rawIndex < 0 ? length + rawIndex : rawIndex;
  return index >= 0 && index < length ? index : null;
}

function targetIndex(source: string, locals: Record<string, ValueSnapshot>): number | null {
  if (/^-?\d+$/.test(source)) {
    const value = Number(source);
    return Number.isSafeInteger(value) ? value : null;
  }
  if (!/^[A-Za-z_]\w*$/.test(source)) {
    return null;
  }
  return integerSnapshot(locals[source]);
}

function selectedOperandIds(rootEvaluation: ExpressionRootEvaluation): Set<string> {
  return new Set(rootEvaluation.selectionEvidence?.flatMap((selection) => {
    if (selection.status !== "resolved" || selection.selectedCandidateIndex === null) {
      return [];
    }
    const exprId = selection.candidateExprIds[selection.selectedCandidateIndex];
    return exprId === undefined ? [] : [exprId];
  }) ?? []);
}

export function projectStructureReferences(
  plan: ExpressionPlan,
  root: ExpressionRootDescriptor,
  rootEvaluation: ExpressionRootEvaluation,
  runtime: RuntimeState
): StructureOperandReference[] {
  const locals = frameLocals(runtime);
  if (!locals) {
    return [];
  }

  const evaluations = new Map(rootEvaluation.evaluations.map((evaluation) => [
    evaluation.exprId,
    evaluation.value
  ]));
  const selectedIds = selectedOperandIds(rootEvaluation);
  const references: StructureOperandReference[] = [];

  for (const expression of plan.expressions) {
    if (expression.rootId !== root.rootId || !expression.structureHint) {
      continue;
    }
    const hint = expression.structureHint;
    const structure = locals[hint.variableName];
    const rowCount = sequenceLength(structure);
    if (rowCount === null) {
      continue;
    }
    const role = selectedIds.has(expression.exprId) ? "selected_operand" as const : "operand" as const;

    if (hint.kind === "list_index") {
      const rawIndex = integerSnapshot(evaluations.get(hint.indexExprId));
      const index = rawIndex === null ? null : normalizeIndex(rawIndex, rowCount);
      if (index !== null && rawIndex !== null) {
        references.push({ exprId: expression.exprId, variableName: hint.variableName, kind: hint.kind, index, rawIndex, role });
      }
      continue;
    }

    const rawRow = integerSnapshot(evaluations.get(hint.rowExprId));
    const row = rawRow === null ? null : normalizeIndex(rawRow, rowCount);
    const columnCount = row === null
      ? null
      : sequenceLength((structure.type === "list" || structure.type === "tuple") ? structure.items[row] : undefined);
    const rawColumn = integerSnapshot(evaluations.get(hint.columnExprId));
    const column = rawColumn === null || columnCount === null ? null : normalizeIndex(rawColumn, columnCount);
    if (row !== null && column !== null && rawRow !== null && rawColumn !== null) {
      references.push({
        exprId: expression.exprId,
        variableName: hint.variableName,
        kind: hint.kind,
        row,
        column,
        rawRow,
        rawColumn,
        role
      });
    }
  }

  const targetHint = root.kind === "assignment" ? root.target.structureHint : undefined;
  if (!targetHint) {
    return references;
  }
  const structure = locals[targetHint.variableName];
  const rowCount = sequenceLength(structure);
  if (rowCount === null) {
    return references;
  }
  if (targetHint.kind === "list_index") {
    const rawIndex = targetIndex(targetHint.indexSource, locals);
    const index = rawIndex === null ? null : normalizeIndex(rawIndex, rowCount);
    if (index !== null && rawIndex !== null) {
      references.push({
        exprId: `${root.rootId}:target`, variableName: targetHint.variableName, kind: targetHint.kind,
        index, rawIndex, role: "assignment_target"
      });
    }
    return references;
  }

  const rawRow = targetIndex(targetHint.rowSource, locals);
  const row = rawRow === null ? null : normalizeIndex(rawRow, rowCount);
  const columnCount = row === null || (structure.type !== "list" && structure.type !== "tuple")
    ? null
    : sequenceLength(structure.items[row]);
  const rawColumn = targetIndex(targetHint.columnSource, locals);
  const column = rawColumn === null || columnCount === null ? null : normalizeIndex(rawColumn, columnCount);
  if (row !== null && column !== null && rawRow !== null && rawColumn !== null) {
    references.push({
      exprId: `${root.rootId}:target`, variableName: targetHint.variableName, kind: targetHint.kind,
      row, column, rawRow, rawColumn, role: "assignment_target"
    });
  }
  return references;
}

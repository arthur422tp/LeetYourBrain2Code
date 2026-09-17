import type { RuntimeState } from "./runtime-state";
import type {
  ConditionPlan,
  DecisionBatch,
  DecisionStructureReference
} from "../shared/decision-types";
import type { ValueSnapshot } from "../shared/trace-types";

function integerSnapshot(snapshot: ValueSnapshot | undefined): number | null {
  if (snapshot?.type !== "int" || !/^-?\d+$/.test(snapshot.value)) return null;
  const value = Number(snapshot.value);
  return Number.isSafeInteger(value) ? value : null;
}

function normalizeIndex(rawIndex: number, length: number): number | null {
  const index = rawIndex < 0 ? length + rawIndex : rawIndex;
  return index >= 0 && index < length ? index : null;
}

function sequenceLength(snapshot: ValueSnapshot | undefined): number | null {
  if ((snapshot?.type !== "list" && snapshot?.type !== "tuple") || snapshot.truncated ||
    !Number.isSafeInteger(snapshot.length) || snapshot.length < 0 || snapshot.items.length !== snapshot.length) return null;
  return snapshot.length;
}

function frameLocals(runtime: RuntimeState): Record<string, ValueSnapshot> | null {
  if (runtime.activeFrameId === null) return null;
  return runtime.frames.get(runtime.activeFrameId)?.locals ?? null;
}

function rectangularMatrix(snapshot: ValueSnapshot | undefined): { rows: number; columns: number } | null {
  const rows = sequenceLength(snapshot);
  if (rows === null || rows === 0 || snapshot?.type !== "list" && snapshot?.type !== "tuple") return null;
  const rowLengths = snapshot.items.map((row) => sequenceLength(row));
  if (rowLengths.some((length) => length === null) || new Set(rowLengths).size !== 1 || rowLengths[0] === 0) return null;
  return { rows, columns: rowLengths[0]! };
}

export function projectDecisionStructureReferences(
  plan: ConditionPlan,
  batch: DecisionBatch,
  runtime: RuntimeState
): DecisionStructureReference[] {
  const locals = frameLocals(runtime);
  if (!locals) return [];
  const evaluations = new Map(batch.condition.evaluations.map((evaluation) => [evaluation.operandId, evaluation.value]));
  const references: DecisionStructureReference[] = [];

  for (const operand of plan.operands) {
    const hint = operand.structureHint;
    if (!hint || !evaluations.has(operand.operandId)) continue;
    if (hint.kind === "list_index") {
      const rawIndex = integerSnapshot(evaluations.get(hint.indexOperandId));
      const length = sequenceLength(locals[hint.variableName]);
      if (rawIndex === null || length === null || !evaluations.has(hint.indexOperandId)) continue;
      const index = normalizeIndex(rawIndex, length);
      if (index === null) continue;
      references.push({
        operandId: operand.operandId,
        variableName: hint.variableName,
        kind: "list_index",
        index,
        rawIndex,
        role: "condition_operand"
      });
      continue;
    }

    if (!evaluations.has(hint.rowOperandId) || !evaluations.has(hint.columnOperandId)) continue;
    const rawRow = integerSnapshot(evaluations.get(hint.rowOperandId));
    const rawColumn = integerSnapshot(evaluations.get(hint.columnOperandId));
    const shape = rectangularMatrix(locals[hint.variableName]);
    if (rawRow === null || rawColumn === null || shape === null) continue;
    const row = normalizeIndex(rawRow, shape.rows);
    const column = normalizeIndex(rawColumn, shape.columns);
    if (row === null || column === null) continue;
    references.push({
      operandId: operand.operandId,
      variableName: hint.variableName,
      kind: "matrix_cell",
      row,
      column,
      rawRow,
      rawColumn,
      role: "condition_operand"
    });
  }
  return references;
}

import type {
  MatrixIndexOperand,
  StaticRelation,
  ValueSnapshot
} from "../shared/trace-types";
import { relationMatchesFrameScope } from "./ast-relations";
import type { RuntimeMutation } from "./runtime-mutation";
import type { RuntimeState } from "./runtime-state";
import { cloneValueSnapshot, valueSnapshotsEqual } from "./value-snapshot";

export interface MatrixCellChange {
  row: number;
  column: number;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export interface MatrixFocus {
  rawRow: number;
  rawColumn: number;
  effectiveRow: number | null;
  effectiveColumn: number | null;
  rowOutOfBounds: boolean;
  columnOutOfBounds: boolean;
  rowSource: "variable" | "literal";
  columnSource: "variable" | "literal";
  rowVariable?: string;
  columnVariable?: string;
}

export interface MatrixVisualModel {
  kind: "matrix";
  visualId: string;
  variableName: string;
  rowCount: number;
  columnCount: number;
  cells: ValueSnapshot[][];
  focuses: MatrixFocus[];
  changedCells: MatrixCellChange[];
}

function isCompleteScalar(snapshot: ValueSnapshot): boolean {
  if (snapshot.type === "str") {
    return !snapshot.truncated;
  }
  return snapshot.type === "int" ||
    snapshot.type === "float" ||
    snapshot.type === "bool" ||
    snapshot.type === "none";
}

function isCompleteRow(snapshot: ValueSnapshot): snapshot is Extract<ValueSnapshot, { type: "list" | "tuple" }> {
  return (
    (snapshot.type === "list" || snapshot.type === "tuple") &&
    !snapshot.truncated &&
    Number.isInteger(snapshot.length) &&
    snapshot.length > 0 &&
    snapshot.length === snapshot.items.length &&
    snapshot.items.every(isCompleteScalar)
  );
}

function matrixRows(
  snapshot: ValueSnapshot | undefined
): Array<Extract<ValueSnapshot, { type: "list" | "tuple" }>> | null {
  if (
    !snapshot ||
    (snapshot.type !== "list" && snapshot.type !== "tuple") ||
    snapshot.truncated ||
    !Number.isInteger(snapshot.length) ||
    snapshot.length <= 0 ||
    snapshot.length !== snapshot.items.length
  ) {
    return null;
  }
  if (!snapshot.items.every(isCompleteRow)) {
    return null;
  }
  const rows = snapshot.items as Array<Extract<ValueSnapshot, { type: "list" | "tuple" }>>;
  const columnCount = rows[0]?.items.length ?? 0;
  if (columnCount <= 0 || rows.some((row) => row.items.length !== columnCount)) {
    return null;
  }
  return rows;
}

function buildMatrixFocuses(
  runtime: RuntimeState,
  frameFunctionName: string,
  variableName: string,
  rowCount: number,
  columnCount: number,
  relations: StaticRelation[]
): MatrixFocus[] {
  if (runtime.activeFrameId === null || runtime.currentLine === null) {
    return [];
  }
  const frame = runtime.frames.get(runtime.activeFrameId);
  if (!frame) {
    return [];
  }
  const readOperand = (operand: MatrixIndexOperand): number | null => {
    if (operand.kind === "literal") {
      return Number.isSafeInteger(operand.value) ? operand.value : null;
    }
    const snapshot = frame.locals[operand.name];
    if (snapshot?.type !== "int" || !/^-?\d+$/.test(snapshot.value)) {
      return null;
    }
    const value = Number(snapshot.value);
    return Number.isSafeInteger(value) ? value : null;
  };
  const normalize = (raw: number, length: number): number | null => {
    const candidate = raw < 0 ? length + raw : raw;
    return candidate >= 0 && candidate < length ? candidate : null;
  };

  return relations.flatMap((relation) => {
    if (
      relation.kind !== "matrix_subscript" ||
      relation.container !== variableName ||
      relation.line !== runtime.currentLine ||
      !relationMatchesFrameScope(relation, frameFunctionName)
    ) {
      return [];
    }
    const rawRow = readOperand(relation.rowIndex);
    const rawColumn = readOperand(relation.columnIndex);
    if (rawRow === null || rawColumn === null) {
      return [];
    }
    const effectiveRow = normalize(rawRow, rowCount);
    const effectiveColumn = normalize(rawColumn, columnCount);
    return [{
      rawRow,
      rawColumn,
      effectiveRow,
      effectiveColumn,
      rowOutOfBounds: effectiveRow === null,
      columnOutOfBounds: effectiveColumn === null,
      rowSource: relation.rowIndex.kind,
      columnSource: relation.columnIndex.kind,
      ...(relation.rowIndex.kind === "variable" ? { rowVariable: relation.rowIndex.name } : {}),
      ...(relation.columnIndex.kind === "variable" ? { columnVariable: relation.columnIndex.name } : {})
    }];
  });
}

function projectMatrixChanges(
  runtime: RuntimeState,
  variableName: string,
  mutations: RuntimeMutation[]
): MatrixCellChange[] {
  if (runtime.activeFrameId === null) {
    return [];
  }
  const frame = runtime.frames.get(runtime.activeFrameId);
  if (!frame) {
    return [];
  }

  const changes: MatrixCellChange[] = [];
  for (const mutation of mutations) {
    if (
      mutation.kind !== "sequence_element" ||
      mutation.frameId !== frame.frameId ||
      mutation.containerName !== variableName
    ) {
      continue;
    }
    const before = mutation.before && isCompleteRow(mutation.before) ? mutation.before : undefined;
    const after = mutation.after && isCompleteRow(mutation.after) ? mutation.after : undefined;
    const columnCount = Math.max(before?.items.length ?? 0, after?.items.length ?? 0);
    for (let column = 0; column < columnCount; column += 1) {
      const beforeCell = before?.items[column];
      const afterCell = after?.items[column];
      if (beforeCell === undefined && afterCell === undefined) {
        continue;
      }
      if (beforeCell === undefined) {
        changes.push({
          row: mutation.index,
          column,
          action: "added",
          after: cloneValueSnapshot(afterCell!)
        });
      } else if (afterCell === undefined) {
        changes.push({
          row: mutation.index,
          column,
          action: "removed",
          before: cloneValueSnapshot(beforeCell)
        });
      } else if (!valueSnapshotsEqual(beforeCell, afterCell)) {
        changes.push({
          row: mutation.index,
          column,
          action: "changed",
          before: cloneValueSnapshot(beforeCell),
          after: cloneValueSnapshot(afterCell)
        });
      }
    }
  }
  return changes.sort((left, right) => left.row - right.row || left.column - right.column);
}

export function buildMatrixVisuals(
  runtime: RuntimeState,
  _relations: StaticRelation[],
  _mutations: RuntimeMutation[] = []
): MatrixVisualModel[] {
  if (runtime.activeFrameId === null) {
    return [];
  }
  const frame = runtime.frames.get(runtime.activeFrameId);
  if (!frame) {
    return [];
  }

  return Object.keys(frame.locals)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((variableName) => {
      const rows = matrixRows(frame.locals[variableName]);
      if (!rows) {
        return [];
      }
      const rowCount = rows.length;
      const columnCount = rows[0]?.items.length ?? 0;
      return [{
        kind: "matrix" as const,
        visualId: `matrix:${variableName}`,
        variableName,
        rowCount,
        columnCount,
        cells: rows.map((row) => row.items.map(cloneValueSnapshot)),
        focuses: buildMatrixFocuses(
          runtime,
          frame.functionName,
          variableName,
          rowCount,
          columnCount,
          _relations
        ),
        changedCells: projectMatrixChanges(runtime, variableName, _mutations)
      }];
    });
}

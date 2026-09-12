export const MATRIX_VIEWPORT_ROWS = 12;
export const MATRIX_VIEWPORT_COLUMNS = 12;

export interface MatrixViewport {
  rowStart: number;
  columnStart: number;
  rowCount: number;
  columnCount: number;
}

export type MatrixPanDirection = "up" | "down" | "left" | "right";

function nonNegativeInteger(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function clampStart(start: number, total: number, visible: number): number {
  return Math.min(Math.max(0, start), Math.max(0, total - visible));
}

function normalizeViewport(
  viewport: MatrixViewport,
  totalRows: number,
  totalColumns: number
): MatrixViewport {
  const rows = nonNegativeInteger(totalRows);
  const columns = nonNegativeInteger(totalColumns);
  const rowCount = Math.min(nonNegativeInteger(viewport.rowCount), rows);
  const columnCount = Math.min(nonNegativeInteger(viewport.columnCount), columns);
  return {
    rowStart: clampStart(viewport.rowStart, rows, rowCount),
    columnStart: clampStart(viewport.columnStart, columns, columnCount),
    rowCount,
    columnCount
  };
}

export function initialMatrixViewport(totalRows: number, totalColumns: number): MatrixViewport {
  const rows = nonNegativeInteger(totalRows);
  const columns = nonNegativeInteger(totalColumns);
  return {
    rowStart: 0,
    columnStart: 0,
    rowCount: Math.min(rows, MATRIX_VIEWPORT_ROWS),
    columnCount: Math.min(columns, MATRIX_VIEWPORT_COLUMNS)
  };
}

export function matrixViewportContains(
  viewport: MatrixViewport,
  row: number,
  column: number
): boolean {
  return row >= viewport.rowStart &&
    row < viewport.rowStart + viewport.rowCount &&
    column >= viewport.columnStart &&
    column < viewport.columnStart + viewport.columnCount;
}

export function revealMatrixCell(
  viewport: MatrixViewport,
  row: number,
  column: number,
  totalRows: number,
  totalColumns: number
): MatrixViewport {
  const normalized = normalizeViewport(viewport, totalRows, totalColumns);
  let rowStart = normalized.rowStart;
  let columnStart = normalized.columnStart;
  if (row >= 0 && row < totalRows && normalized.rowCount > 0) {
    if (row < rowStart) {
      rowStart = row;
    } else if (row >= rowStart + normalized.rowCount) {
      rowStart = row - normalized.rowCount + 1;
    }
  }
  if (column >= 0 && column < totalColumns && normalized.columnCount > 0) {
    if (column < columnStart) {
      columnStart = column;
    } else if (column >= columnStart + normalized.columnCount) {
      columnStart = column - normalized.columnCount + 1;
    }
  }
  return {
    ...normalized,
    rowStart: clampStart(rowStart, totalRows, normalized.rowCount),
    columnStart: clampStart(columnStart, totalColumns, normalized.columnCount)
  };
}

export function panMatrixViewport(
  viewport: MatrixViewport,
  direction: MatrixPanDirection,
  totalRows: number,
  totalColumns: number
): MatrixViewport {
  const normalized = normalizeViewport(viewport, totalRows, totalColumns);
  const rowDelta = direction === "up"
    ? -normalized.rowCount
    : direction === "down" ? normalized.rowCount : 0;
  const columnDelta = direction === "left"
    ? -normalized.columnCount
    : direction === "right" ? normalized.columnCount : 0;
  return {
    ...normalized,
    rowStart: clampStart(normalized.rowStart + rowDelta, totalRows, normalized.rowCount),
    columnStart: clampStart(normalized.columnStart + columnDelta, totalColumns, normalized.columnCount)
  };
}

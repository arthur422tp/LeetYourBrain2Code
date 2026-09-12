import { describe, expect, it } from "vitest";

import type {
  MatrixCellChange,
  MatrixFocus,
  MatrixVisualModel
} from "../../src/core/matrix-interpreter";
import type { ValueSnapshot } from "../../src/shared/trace-types";
import { createMatrixVisualizer } from "../../src/sidepanel/components/MatrixVisualizer";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function cells(rowCount: number, columnCount: number): ValueSnapshot[][] {
  return Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: columnCount }, (_, column) => int(row * columnCount + column))
  );
}

function focus(
  row: number,
  column: number,
  overrides: Partial<MatrixFocus> = {}
): MatrixFocus {
  return {
    rawRow: row,
    rawColumn: column,
    effectiveRow: row,
    effectiveColumn: column,
    rowOutOfBounds: false,
    columnOutOfBounds: false,
    rowSource: "variable",
    columnSource: "variable",
    rowVariable: "i",
    columnVariable: "j",
    ...overrides
  };
}

function model(overrides: Partial<MatrixVisualModel> = {}): MatrixVisualModel {
  const rowCount = overrides.rowCount ?? 2;
  const columnCount = overrides.columnCount ?? 3;
  return {
    kind: "matrix",
    visualId: "matrix:dp",
    variableName: "dp",
    rowCount,
    columnCount,
    cells: overrides.cells ?? cells(rowCount, columnCount),
    focuses: overrides.focuses ?? [],
    changedCells: overrides.changedCells ?? [],
    ...overrides
  };
}

function cell(element: HTMLElement, row: number, column: number): HTMLElement | null {
  return element.querySelector(`[data-cell-row="${row}"][data-cell-column="${column}"]`);
}

describe("MatrixVisualizer", () => {
  it("renders cells with independent focus/change states and factual inspection details", () => {
    const changed: MatrixCellChange = {
      row: 1,
      column: 1,
      action: "changed",
      before: int(0),
      after: int(2)
    };
    const handle = createMatrixVisualizer(model({
      focuses: [focus(1, 1)],
      changedCells: [changed]
    }));

    expect(handle.element.querySelectorAll("[data-cell-row]")).toHaveLength(6);
    const combined = cell(handle.element, 1, 1)!;
    expect(combined.classList.contains("is-focus")).toBe(true);
    expect(combined.classList.contains("is-changed")).toBe(true);

    combined.click();
    const details = handle.element.querySelector(".visualizer-inspector")!.textContent!;
    expect(details).toContain("dp[1][1]");
    expect(details).toContain("value");
    expect(details).toContain("row");
    expect(details).toContain("column");
    expect(details).toContain("focus");
    expect(details).toContain("changed");
    expect(details).toContain("before");
    expect(details).toContain("after");
    expect(details).toContain("row binding");
    expect(details).toContain("i = 1");
    expect(details).toContain("column binding");
    expect(details).toContain("j = 1");

    handle.update(model({ focuses: [focus(1, 1)] }));
    expect(cell(handle.element, 1, 1)?.classList.contains("is-focus")).toBe(true);
    expect(cell(handle.element, 1, 1)?.classList.contains("is-changed")).toBe(false);
    expect(handle.element.querySelector(".visualizer-inspector")!.textContent).not.toContain("before");
    expect(handle.element.querySelector(".visualizer-inspector")!.textContent).not.toContain("after");
    handle.dispose();
  });

  it("shows out-of-bounds requested coordinates without inventing cells", () => {
    const handle = createMatrixVisualizer(model({
      focuses: [focus(8, 3, {
        effectiveRow: null,
        effectiveColumn: null,
        rowOutOfBounds: true,
        columnOutOfBounds: true
      })]
    }));

    expect(handle.element.querySelectorAll("[data-cell-row]")).toHaveLength(6);
    expect(cell(handle.element, 8, 3)).toBeNull();
    expect(handle.element.textContent).toContain("requested");
    expect(handle.element.textContent).toContain("dp[8][3]");
    expect(handle.element.textContent).toContain("row out of bounds");
    expect(handle.element.textContent).toContain("shape");
    expect(handle.element.textContent).toContain("2×3");
    handle.dispose();
  });

  it("mounts a bounded viewport, follows focus conservatively, and supports manual re-follow", () => {
    const handle = createMatrixVisualizer(model({
      rowCount: 30,
      columnCount: 30,
      focuses: [focus(3, 3)]
    }));
    const viewport = () => handle.element.querySelector<HTMLElement>("[data-matrix-viewport]")!;

    expect(handle.element.querySelectorAll("[data-cell-row]")).toHaveLength(144);
    expect(viewport().dataset.rowStart).toBe("0");
    expect(viewport().dataset.columnStart).toBe("0");

    handle.update(model({ rowCount: 30, columnCount: 30, focuses: [focus(3, 4)] }));
    expect(viewport().dataset.columnStart).toBe("0");

    handle.update(model({ rowCount: 30, columnCount: 30, focuses: [focus(3, 12)] }));
    expect(viewport().dataset.columnStart).toBe("1");

    handle.element.querySelector<HTMLButtonElement>('[data-matrix-action="pan-right"]')!.click();
    const manuallyPannedColumnStart = viewport().dataset.columnStart;
    handle.update(model({ rowCount: 30, columnCount: 30, focuses: [focus(3, 29)] }));
    expect(viewport().dataset.columnStart).toBe(manuallyPannedColumnStart);

    handle.element.querySelector<HTMLButtonElement>('[data-matrix-action="follow-current"]')!.click();
    expect(viewport().dataset.columnStart).toBe("18");
    handle.dispose();
  });

  it("retains a valid offscreen cell selection while the viewport is virtualized", () => {
    const handle = createMatrixVisualizer(model({ rowCount: 30, columnCount: 30 }));
    const selected = cell(handle.element, 0, 0)!;
    selected.click();
    handle.element.querySelector<HTMLButtonElement>('[data-matrix-action="pan-right"]')!.click();

    expect(cell(handle.element, 0, 0)).toBeNull();
    const details = handle.element.querySelector(".visualizer-inspector")!.textContent!;
    expect(details).toContain("dp[0][0]");
    expect(details).toContain("0");
    handle.dispose();
  });

  it("keeps the root stable and clears stale runtime states on update", () => {
    const handle = createMatrixVisualizer(model({ focuses: [focus(0, 0)], changedCells: [{
      row: 0,
      column: 0,
      action: "changed",
      before: int(0),
      after: int(1)
    }] }));
    const root = handle.element;
    handle.update(model());

    expect(handle.element).toBe(root);
    expect(cell(root, 0, 0)?.classList.contains("is-focus")).toBe(false);
    expect(cell(root, 0, 0)?.classList.contains("is-changed")).toBe(false);
    handle.dispose();
  });
});

import { describe, expect, it } from "vitest";

import type {
  MatrixCellChange,
  MatrixFocus,
  MatrixVisualModel
} from "../../src/core/matrix-interpreter";
import type { ValueSnapshot } from "../../src/shared/trace-types";
import { createMatrixVisualizer } from "../../src/sidepanel/components/MatrixVisualizer";
import type { MatrixPathModel, MatrixPathNode } from "../../src/core/matrix-path";

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
    expressionReferences: overrides.expressionReferences ?? [],
    focuses: overrides.focuses ?? [],
    changedCells: overrides.changedCells ?? [],
    ...overrides
  };
}

function cell(element: HTMLElement, row: number, column: number): HTMLElement | null {
  return element.querySelector(`[data-cell-row="${row}"][data-cell-column="${column}"]`);
}

describe("MatrixVisualizer", () => {
  it("shows the recorded path, arrows and candidates, and clears future cells when stepping back", () => {
    const start: MatrixPathNode = { row: 0, column: 0, value: int(1), complete: true };
    const right: MatrixPathNode = { row: 0, column: 1, value: int(4), complete: true, previous: start };
    const down: MatrixPathNode = { row: 1, column: 1, value: int(7), complete: true, previous: right };
    const path: MatrixPathModel = {
      groupId: "4:dp:grid", tableVariable: "dp", sourceVariable: "grid",
      nodes: new Map([["0:0", start], ["0:1", right], ["1:1", down]]),
      endpoint: { row: 1, column: 1 },
      decision: { target: down, candidates: [right, { row: 1, column: 0 }], selected: right }
    };
    const handle = createMatrixVisualizer(model({ path, expressionReferences: [{
      exprId: "upcoming-choice", variableName: "dp", kind: "matrix_cell",
      row: 0, column: 2, rawRow: 0, rawColumn: 2, role: "selected_operand"
    }] }));
    expect(cell(handle.element, 0, 2)?.classList.contains("is-expression-selected")).toBe(false);
    expect(handle.element.querySelectorAll("[data-path-cell]")).toHaveLength(3);
    expect(cell(handle.element, 0, 0)?.querySelector("[data-path-direction]")?.textContent).toBe("→");
    expect(cell(handle.element, 0, 1)?.querySelector("[data-path-direction]")?.textContent).toBe("↓");
    expect(cell(handle.element, 1, 0)?.dataset.pathCandidate).toBe("true");
    expect(handle.element.querySelector("[data-path-summary]")?.textContent).toContain("7");
    cell(handle.element, 0, 1)!.click();
    expect(handle.element.querySelectorAll("[data-path-cell]")).toHaveLength(2);
    handle.update(model({ path: { ...path, nodes: new Map([["0:0", start]]), endpoint: start, decision: undefined } }));
    expect(handle.element.querySelectorAll("[data-path-cell]")).toHaveLength(0);
    expect(handle.element.querySelector("[data-path-summary]")?.textContent).toContain("not captured");
    handle.element.querySelector<HTMLButtonElement>('[data-matrix-action="follow-path"]')!.click();
    expect(handle.element.querySelectorAll("[data-path-cell]")).toHaveLength(1);
    handle.update(model());
    expect(handle.element.querySelectorAll("[data-path-cell]")).toHaveLength(0);
    handle.dispose();
  });

  it("supports keyboard path selection, synchronized selection, and incomplete path notices", () => {
    const node: MatrixPathNode = { row: 1, column: 1, value: int(7), complete: false, reason: "Earlier choices missing." };
    const path: MatrixPathModel = {
      groupId: "4:dp:grid", tableVariable: "dp", sourceVariable: "grid",
      nodes: new Map([["1:1", node]]), endpoint: node
    };
    const handle = createMatrixVisualizer(model({ path }));
    expect(handle.element.querySelector("[data-path-summary]")?.textContent).toContain("Incomplete");
    let selected: unknown;
    handle.element.addEventListener("matrix-path-select", (event) => { selected = (event as CustomEvent).detail; });
    cell(handle.element, 0, 0)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(selected).toEqual({ groupId: path.groupId, coordinate: { row: 0, column: 0 } });
    handle.element.dispatchEvent(new CustomEvent("matrix-path-sync", { detail: { groupId: path.groupId, coordinate: node } }));
    expect(cell(handle.element, 1, 1)?.dataset.pathCell).toBe("true");
    handle.dispose();
  });
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

  it("renders expression roles without changing focus, change, or viewport behavior", () => {
    const view = createMatrixVisualizer(model({
      rowCount: 3,
      columnCount: 4,
      expressionReferences: [
        {
          exprId: "r1.operand",
          variableName: "dp",
          kind: "matrix_cell",
          row: 1,
          column: 3,
          rawRow: 1,
          rawColumn: 3,
          role: "operand"
        },
        {
          exprId: "r1.selected",
          variableName: "dp",
          kind: "matrix_cell",
          row: 2,
          column: 2,
          rawRow: 2,
          rawColumn: 2,
          role: "selected_operand"
        },
        {
          exprId: "r1:target",
          variableName: "dp",
          kind: "matrix_cell",
          row: 2,
          column: 3,
          rawRow: 2,
          rawColumn: 3,
          role: "assignment_target"
        }
      ]
    }));

    const operand = view.element.querySelector<HTMLElement>('[data-cell-row="1"][data-cell-column="3"]');
    expect(operand?.classList.contains("is-expression-operand")).toBe(true);
    expect(operand?.dataset.expressionOperand).toBe("true");

    const selected = view.element.querySelector<HTMLElement>('[data-cell-row="2"][data-cell-column="2"]');
    expect(selected?.classList.contains("is-expression-operand")).toBe(true);
    expect(selected?.classList.contains("is-expression-selected")).toBe(true);
    expect(selected?.dataset.expressionSelected).toBe("true");

    const target = view.element.querySelector<HTMLElement>('[data-cell-row="2"][data-cell-column="3"]');
    expect(target?.classList.contains("is-expression-target")).toBe(true);
    expect(target?.dataset.expressionTarget).toBe("true");
    expect(view.element.querySelector('[data-matrix-action="follow-current"]')?.getAttribute("aria-pressed"))
      .toBe("true");
    view.dispose();
  });

  it("renders decision operand overlays independently from expression overlays", () => {
    const view = createMatrixVisualizer(model({
      expressionReferences: [{
        exprId: "r1.value",
        variableName: "dp",
        kind: "matrix_cell",
        row: 1,
        column: 1,
        rawRow: 1,
        rawColumn: 1,
        role: "selected_operand"
      }],
      decisionReferences: [{
        operandId: "d1.c0.o1",
        variableName: "dp",
        kind: "matrix_cell",
        row: 1,
        column: 1,
        rawRow: 1,
        rawColumn: 1,
        role: "condition_operand"
      }]
    }));

    const target = cell(view.element, 1, 1)!;
    expect(target.classList.contains("is-expression-selected")).toBe(true);
    expect(target.classList.contains("is-decision-operand")).toBe(true);
    expect(target.dataset.expressionSelected).toBe("true");
    expect(target.dataset.decisionOperand).toBe("true");
    view.dispose();
  });

  it("does not auto-pan for expression references outside the current viewport", () => {
    const view = createMatrixVisualizer(model({
      rowCount: 20,
      columnCount: 20,
      expressionReferences: [{
        exprId: "r1.outside",
        variableName: "dp",
        kind: "matrix_cell",
        row: 19,
        column: 19,
        rawRow: 19,
        rawColumn: 19,
        role: "operand"
      }]
    }));

    const viewport = view.element.querySelector<HTMLElement>("[data-matrix-viewport]")!;
    expect(viewport.dataset.rowStart).toBe("0");
    expect(viewport.dataset.columnStart).toBe("0");
    expect(view.element.querySelector('[data-expression-operand="true"]')).toBeNull();
    expect(view.element.textContent).not.toContain("outside");
    view.dispose();
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

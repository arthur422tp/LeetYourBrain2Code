import { describe, expect, it } from "vitest";

import {
  initialMatrixViewport,
  matrixViewportContains,
  panMatrixViewport,
  revealMatrixCell,
  type MatrixViewport
} from "../../src/sidepanel/components/matrix-viewport";

describe("matrix viewport geometry", () => {
  it("renders small matrices fully and bounds large matrices to 12 by 12", () => {
    expect(initialMatrixViewport(5, 6)).toEqual({
      rowStart: 0,
      columnStart: 0,
      rowCount: 5,
      columnCount: 6
    });
    expect(initialMatrixViewport(30, 40)).toEqual({
      rowStart: 0,
      columnStart: 0,
      rowCount: 12,
      columnCount: 12
    });
  });

  it("reports visible cells without treating shape bounds as viewport state", () => {
    const viewport: MatrixViewport = {
      rowStart: 4,
      columnStart: 6,
      rowCount: 12,
      columnCount: 12
    };

    expect(matrixViewportContains(viewport, 4, 6)).toBe(true);
    expect(matrixViewportContains(viewport, 15, 17)).toBe(true);
    expect(matrixViewportContains(viewport, 16, 17)).toBe(false);
    expect(matrixViewportContains(viewport, 15, 18)).toBe(false);
  });

  it("reveals a focus with the minimum shift and preserves a visible viewport", () => {
    const initial = initialMatrixViewport(30, 40);

    expect(revealMatrixCell(initial, 3, 3, 30, 40)).toEqual(initial);
    expect(revealMatrixCell(initial, 3, 12, 30, 40)).toEqual({
      rowStart: 0,
      columnStart: 1,
      rowCount: 12,
      columnCount: 12
    });
    expect(revealMatrixCell(initial, 12, 3, 30, 40)).toEqual({
      rowStart: 1,
      columnStart: 0,
      rowCount: 12,
      columnCount: 12
    });
    expect(revealMatrixCell(initial, 29, 39, 30, 40)).toEqual({
      rowStart: 18,
      columnStart: 28,
      rowCount: 12,
      columnCount: 12
    });
  });

  it("pans by one viewport and clamps at every boundary", () => {
    const initial = initialMatrixViewport(30, 40);

    expect(panMatrixViewport(initial, "up", 30, 40)).toEqual(initial);
    expect(panMatrixViewport(initial, "left", 30, 40)).toEqual(initial);
    expect(panMatrixViewport(initial, "down", 30, 40)).toEqual({
      rowStart: 12,
      columnStart: 0,
      rowCount: 12,
      columnCount: 12
    });
    expect(panMatrixViewport(initial, "right", 30, 40)).toEqual({
      rowStart: 0,
      columnStart: 12,
      rowCount: 12,
      columnCount: 12
    });
    expect(panMatrixViewport({ ...initial, rowStart: 18, columnStart: 28 }, "down", 30, 40)).toEqual({
      rowStart: 18,
      columnStart: 28,
      rowCount: 12,
      columnCount: 12
    });
    expect(panMatrixViewport({ ...initial, rowStart: 18, columnStart: 28 }, "right", 30, 40)).toEqual({
      rowStart: 18,
      columnStart: 28,
      rowCount: 12,
      columnCount: 12
    });
  });
});

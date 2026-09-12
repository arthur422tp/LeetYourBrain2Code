import { describe, expect, it } from "vitest";

import type { RuntimeState } from "../../src/core/runtime-state";
import type { RuntimeMutation } from "../../src/core/runtime-mutation";
import type {
  MatrixIndexOperand,
  MatrixSubscriptRelation,
  ValueSnapshot
} from "../../src/shared/trace-types";
import { buildMatrixVisuals } from "../../src/core/matrix-interpreter";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const string = (value: string, truncated = false): ValueSnapshot => ({
  type: "str",
  value,
  length: value.length,
  truncated
});

function row(values: ValueSnapshot[], type: "list" | "tuple" = "list"): ValueSnapshot {
  return { type, length: values.length, items: values, truncated: false };
}

function matrix(rows: ValueSnapshot[], type: "list" | "tuple" = "list"): ValueSnapshot {
  return { type, length: rows.length, items: rows, truncated: false };
}

function runtime(
  locals: Record<string, ValueSnapshot>,
  options: { line?: number | null; functionName?: string } = {}
): RuntimeState {
  const line = options.line === undefined ? 7 : options.line;
  return {
    step: 1,
    activeFrameId: 4,
    frames: new Map([[
      4,
      {
        frameId: 4,
        parentFrameId: null,
        functionName: options.functionName ?? "solve",
        line,
        locals
      }
    ]]),
    callStack: [4],
    currentLine: line,
    stdout: "",
    objectTopology: { objects: new Map(), truncated: false }
  };
}

function matrixRelation(
  rowIndex: MatrixIndexOperand,
  columnIndex: MatrixIndexOperand,
  options: { line?: number; scope?: string } = {}
): MatrixSubscriptRelation {
  return {
    kind: "matrix_subscript",
    scope: options.scope ?? "Solution.solve",
    line: options.line ?? 7,
    container: "dp",
    rowIndex,
    columnIndex
  };
}

const invalidMatrices: Array<[string, ValueSnapshot]> = [
  ["empty outer", matrix([])],
  ["zero-column rows", matrix([row([]), row([])])],
  ["ragged rows", matrix([row([int(1), int(2)]), row([int(3)])])],
  ["truncated outer", { ...matrix([row([int(1)])]), truncated: true } as ValueSnapshot],
  ["truncated row", matrix([{ ...row([int(1)]), truncated: true } as ValueSnapshot])],
  ["outer length mismatch", { ...matrix([row([int(1)])]), length: 2 } as ValueSnapshot],
  ["row length mismatch", matrix([{ ...row([int(1)]), length: 2 } as ValueSnapshot])],
  ["non-scalar cell", matrix([row([{ type: "dict", length: 0, entries: [], truncated: false }])])],
  ["truncated scalar cell", matrix([row([string("hidden", true)])])]
];

describe("buildMatrixVisuals", () => {
  it("builds a matrix model from complete rectangular list and tuple rows", () => {
    const visuals = buildMatrixVisuals(
      runtime({
        dp: matrix([
          row([int(0), int(1)], "tuple"),
          row([int(2), int(3)], "list")
        ], "tuple")
      }),
      [],
      []
    );

    expect(visuals).toHaveLength(1);
    expect(visuals[0]).toEqual(expect.objectContaining({
      kind: "matrix",
      visualId: "matrix:dp",
      variableName: "dp",
      rowCount: 2,
      columnCount: 2
    }));
  });

  it.each(invalidMatrices)("rejects %s matrices", (_name, snapshot) => {
    expect(buildMatrixVisuals(runtime({ dp: snapshot }), [], [])).toEqual([]);
  });

  it("resolves variable and literal focus operands only on the active line and scope", () => {
    const visuals = buildMatrixVisuals(
      runtime({
        dp: matrix([
          row([int(0), int(1), int(2), int(3)]),
          row([int(4), int(5), int(6), int(7)]),
          row([int(8), int(9), int(10), int(11)]),
          row([int(12), int(13), int(14), int(15)]),
          row([int(16), int(17), int(18), int(19)])
        ]),
        i: int(-1),
        j: int(2),
        bad: { type: "float", value: 1.5 }
      }),
      [
        matrixRelation(
          { kind: "variable", name: "i" },
          { kind: "variable", name: "j" }
        ),
        matrixRelation(
          { kind: "literal", value: 0 },
          { kind: "literal", value: -1 }
        ),
        matrixRelation(
          { kind: "variable", name: "bad" },
          { kind: "literal", value: 0 }
        ),
        matrixRelation(
          { kind: "literal", value: 1 },
          { kind: "literal", value: 1 },
          { line: 8 }
        ),
        matrixRelation(
          { kind: "literal", value: 1 },
          { kind: "literal", value: 1 },
          { scope: "Solution.other" }
        )
      ],
      []
    );

    expect(visuals[0]?.focuses).toEqual([
      {
        rawRow: -1,
        rawColumn: 2,
        effectiveRow: 4,
        effectiveColumn: 2,
        rowOutOfBounds: false,
        columnOutOfBounds: false,
        rowSource: "variable",
        columnSource: "variable",
        rowVariable: "i",
        columnVariable: "j"
      },
      {
        rawRow: 0,
        rawColumn: -1,
        effectiveRow: 0,
        effectiveColumn: 3,
        rowOutOfBounds: false,
        columnOutOfBounds: false,
        rowSource: "literal",
        columnSource: "literal"
      }
    ]);
  });

  it("keeps out-of-bounds focus evidence without creating a cell", () => {
    const visuals = buildMatrixVisuals(
      runtime({ dp: matrix([row([int(1), int(2)]), row([int(3), int(4)])]) }),
      [matrixRelation(
        { kind: "literal", value: -3 },
        { kind: "literal", value: 2 }
      )],
      []
    );

    expect(visuals[0]?.focuses).toEqual([{
      rawRow: -3,
      rawColumn: 2,
      effectiveRow: null,
      effectiveColumn: null,
      rowOutOfBounds: true,
      columnOutOfBounds: true,
      rowSource: "literal",
      columnSource: "literal"
    }]);
    expect(visuals[0]?.cells).toHaveLength(2);
    expect(visuals[0]?.cells[0]).toHaveLength(2);
  });

  it("projects changed cells only from authoritative row snapshots", () => {
    const before = row([int(1), int(2), int(3)]);
    const after = row([int(1), int(4), int(5)]);
    const mutations: RuntimeMutation[] = [{
      kind: "sequence_element",
      origin: "transition",
      frameId: 4,
      containerName: "dp",
      containerKind: "list",
      index: 0,
      action: "changed",
      before,
      after
    }];

    const visuals = buildMatrixVisuals(
      runtime({ dp: matrix([after, row([int(6), int(7), int(8)])]) }),
      [],
      mutations
    );

    expect(visuals[0]?.changedCells).toEqual([
      { row: 0, column: 1, action: "changed", before: int(2), after: int(4) },
      { row: 0, column: 2, action: "changed", before: int(3), after: int(5) }
    ]);
  });

  it("projects added and removed row entries and ignores unrelated mutations", () => {
    const mutations: RuntimeMutation[] = [
      {
        kind: "sequence_element",
        origin: "transition",
        frameId: 4,
        containerName: "dp",
        containerKind: "list",
        index: 1,
        action: "added",
        after: row([int(7), int(8)])
      },
      {
        kind: "sequence_element",
        origin: "transition",
        frameId: 4,
        containerName: "dp",
        containerKind: "list",
        index: 2,
        action: "removed",
        before: row([int(9), int(10)])
      },
      {
        kind: "variable",
        origin: "transition",
        frameId: 4,
        variableName: "dp",
        action: "changed",
        before: matrix([row([int(0), int(0)])]),
        after: matrix([row([int(1), int(1)])])
      },
      {
        kind: "sequence_element",
        origin: "transition",
        frameId: 5,
        containerName: "dp",
        containerKind: "list",
        index: 0,
        action: "changed",
        before: row([int(1), int(2)]),
        after: row([int(3), int(4)])
      },
      {
        kind: "sequence_element",
        origin: "transition",
        frameId: 4,
        containerName: "other",
        containerKind: "list",
        index: 0,
        action: "changed",
        before: row([int(1), int(2)]),
        after: row([int(3), int(4)])
      }
    ];

    const visuals = buildMatrixVisuals(
      runtime({ dp: matrix([row([int(1), int(2)]), row([int(7), int(8)])]) }),
      [],
      mutations
    );

    expect(visuals[0]?.changedCells).toEqual([
      { row: 1, column: 0, action: "added", after: int(7) },
      { row: 1, column: 1, action: "added", after: int(8) },
      { row: 2, column: 0, action: "removed", before: int(9) },
      { row: 2, column: 1, action: "removed", before: int(10) }
    ]);
  });

  it("suppresses Matrix interpretation when the current snapshot is invalid", () => {
    const visuals = buildMatrixVisuals(
      runtime({ dp: matrix([row([int(1), int(2)]), row([int(3)])]) }),
      [],
      [{
        kind: "sequence_element",
        origin: "transition",
        frameId: 4,
        containerName: "dp",
        containerKind: "list",
        index: 0,
        action: "changed",
        before: row([int(1), int(2)]),
        after: row([int(4), int(5)])
      }]
    );

    expect(visuals).toEqual([]);
  });
});

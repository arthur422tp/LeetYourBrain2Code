import type { ExpressionEvidenceNode, ExpressionEvidenceRoot } from "../shared/expression-types";
import type { ValueSnapshot } from "../shared/trace-types";
import type { MatrixVisualModel } from "./matrix-interpreter";
import { valueSnapshotsEqual } from "./value-snapshot";

export interface MatrixCoordinate { row: number; column: number }

/** A version of a cell's provenance, captured when its assignment takes effect. */
export interface MatrixPathNode extends MatrixCoordinate {
  value: ValueSnapshot;
  previous?: MatrixPathNode;
  complete: boolean;
  reason?: string;
}

export interface MatrixPathDecision {
  target: MatrixCoordinate;
  candidates: MatrixCoordinate[];
  selected?: MatrixCoordinate;
}

export interface MatrixPathModel {
  groupId: string;
  tableVariable: string;
  sourceVariable: string;
  nodes: ReadonlyMap<string, MatrixPathNode>;
  endpoint: MatrixCoordinate;
  decision?: MatrixPathDecision;
}

export const matrixCoordinateKey = ({ row, column }: MatrixCoordinate): string => `${row}:${column}`;

export function matrixPathTo(path: MatrixPathModel, endpoint: MatrixCoordinate): MatrixPathNode[] {
  const result: MatrixPathNode[] = [];
  let node = path.nodes.get(matrixCoordinateKey(endpoint));
  while (node) {
    result.push(node);
    node = node.previous;
  }
  return result.reverse();
}

type CellReference = Extract<ExpressionEvidenceRoot["structureReferences"][number], { kind: "matrix_cell" }>;
interface Assignment {
  target: CellReference;
  source: CellReference;
  result: ValueSnapshot;
  predecessor?: CellReference;
  candidates: CellReference[];
  base: boolean;
  reason?: string;
}
interface History {
  model: MatrixPathModel;
  rows: number;
  columns: number;
}

function coordinateEqual(a: MatrixCoordinate, b: MatrixCoordinate): boolean {
  return a.row === b.row && a.column === b.column;
}

function numeric(value: ValueSnapshot | undefined): value is ValueSnapshot {
  return value?.type === "int" || (value?.type === "float" && Number.isFinite(value.value));
}

// Accept only an explicit cell copy or (predecessor / min / max) + source cell.
// No variable-name, table-value, or problem-title heuristic is involved.
function readAssignment(root: ExpressionEvidenceRoot): Assignment | undefined {
  if (root.kind !== "assignment" || root.status !== "completed" || !numeric(root.tree.value)) return;
  const refs = root.structureReferences.filter((ref): ref is CellReference => ref.kind === "matrix_cell");
  const target = refs.find((ref) => ref.role === "assignment_target");
  if (!target) return;
  const reference = (node: ExpressionEvidenceNode): CellReference | undefined =>
    refs.find((ref) => ref.exprId === node.exprId && ref.role !== "assignment_target");
  const sourceAtTarget = (node: ExpressionEvidenceNode): CellReference | undefined => {
    const ref = reference(node);
    return ref && ref.variableName !== target.variableName && coordinateEqual(ref, target) ? ref : undefined;
  };
  const base = sourceAtTarget(root.tree);
  if (base) return { target, source: base, result: root.tree.value!, candidates: [], base: true };
  if (root.tree.kind !== "binary" || root.tree.children.length !== 2) return;
  const [left, right] = root.tree.children;
  const compact = (source: string): string => source.replace(/[\s()]/g, "");
  if (compact(root.tree.source) !== compact(`${left.source}+${right.source}`)) return;
  const source = sourceAtTarget(right) ?? sourceAtTarget(left);
  if (!source) return;
  const input = sourceAtTarget(right) ? left : right;
  const adjacentPredecessor = (ref: CellReference | undefined): ref is CellReference =>
    ref !== undefined && ref.variableName === target.variableName &&
    ((ref.row === target.row - 1 && ref.column === target.column) ||
      (ref.row === target.row && ref.column === target.column - 1));
  const direct = reference(input);
  if (adjacentPredecessor(direct)) {
    return { target, source, result: root.tree.value!, predecessor: direct, candidates: [direct], base: false };
  }
  const selection = root.selections.find((item) => item.callExprId === input.exprId);
  if (!selection) return;
  const candidates = selection.candidateExprIds.map((id) => refs.find((ref) => ref.exprId === id));
  if (candidates.length < 2 || !candidates.every(adjacentPredecessor)) return;
  const predecessor = selection.status === "resolved" && selection.selectedCandidateIndex !== null
    ? candidates[selection.selectedCandidateIndex] : undefined;
  return {
    target, source, result: root.tree.value!, candidates, predecessor, base: false,
    ...(!predecessor ? { reason: "Selection could not be determined from the trace." } : {})
  };
}

/** One instance per interpretation; never mutated by playback or UI selection. */
export function createMatrixPathTracker(): {
  update(frameId: number, matrices: MatrixVisualModel[], roots: ExpressionEvidenceRoot[]): void;
} {
  const frames = new Map<number, { histories: Map<string, History>; pending: Assignment[]; writes: CellReference[] }>();
  return {
    update(frameId, matrices, roots) {
      const frame = frames.get(frameId) ?? { histories: new Map<string, History>(), pending: [], writes: [] };
      frames.set(frameId, frame);
      const byName = new Map(matrices.map((matrix) => [matrix.variableName, matrix]));
      for (const [name, history] of frame.histories) {
        const table = byName.get(name);
        const source = byName.get(history.model.sourceVariable);
        if (!table || !source || table.rowCount !== history.rows || table.columnCount !== history.columns ||
          source.rowCount !== history.rows || source.columnCount !== history.columns || source.changedCells.length > 0) {
          frame.histories.delete(name);
          continue;
        }
        // Remove stale endpoints on untraced writes, but keep immutable predecessor versions.
        const nodes = new Map(history.model.nodes);
        for (const write of frame.writes) {
          if (write.variableName === name) nodes.delete(matrixCoordinateKey(write));
        }
        for (const [key, node] of nodes) {
          const value = table.cells[node.row]?.[node.column];
          if (!value || !valueSnapshotsEqual(value, node.value)) nodes.delete(key);
        }
        history.model = { ...history.model, nodes, decision: undefined };
      }
      for (const assignment of frame.pending) {
        const table = byName.get(assignment.target.variableName);
        const source = byName.get(assignment.source.variableName);
        const currentValue = table?.cells[assignment.target.row]?.[assignment.target.column];
        // RHS evidence belongs to the preceding line event; only publish a path after
        // its result is visible in the next snapshot of the same frame (including zero writes).
        if (!table || !source || !currentValue || !valueSnapshotsEqual(currentValue, assignment.result) ||
          table.rowCount !== source.rowCount || table.columnCount !== source.columnCount) continue;
        let history = frame.histories.get(table.variableName);
        if (history && history.model.sourceVariable !== source.variableName) {
          frame.histories.delete(table.variableName);
          history = undefined;
        }
        const nodes = new Map(history?.model.nodes);
        const previous = assignment.predecessor
          ? nodes.get(matrixCoordinateKey(assignment.predecessor)) : undefined;
        const complete = assignment.base || (previous?.complete === true && assignment.predecessor !== undefined);
        const node: MatrixPathNode = {
          row: assignment.target.row, column: assignment.target.column,
          value: assignment.result, previous, complete,
          ...(!complete ? { reason: assignment.reason ?? "Earlier path choices were not captured." } : {})
        };
        nodes.set(matrixCoordinateKey(node), node);
        const model: MatrixPathModel = {
          groupId: `${frameId}:${table.variableName}:${source.variableName}`,
          tableVariable: table.variableName, sourceVariable: source.variableName,
          nodes, endpoint: { row: node.row, column: node.column },
          decision: {
            target: { row: node.row, column: node.column },
            candidates: assignment.candidates.map(({ row, column }) => ({ row, column })),
            selected: assignment.predecessor && { row: assignment.predecessor.row, column: assignment.predecessor.column }
          }
        };
        frame.histories.set(table.variableName, { model, rows: table.rowCount, columns: table.columnCount });
      }
      for (const root of roots) {
        if (root.kind !== "return" || root.status !== "completed") continue;
        const returned = root.structureReferences.find((ref): ref is CellReference =>
          ref.kind === "matrix_cell" && ref.exprId === root.tree.exprId);
        const history = returned && frame.histories.get(returned.variableName);
        if (returned && history) {
          history.model = { ...history.model, endpoint: { row: returned.row, column: returned.column }, decision: undefined };
        }
      }
      // A source can be paired only when exactly one table supplies its provenance.
      const sourceCounts = new Map<string, number>();
      for (const { model } of frame.histories.values()) {
        sourceCounts.set(model.sourceVariable, (sourceCounts.get(model.sourceVariable) ?? 0) + 1);
      }
      for (const { model } of frame.histories.values()) {
        const table = byName.get(model.tableVariable);
        const source = byName.get(model.sourceVariable);
        if (table) table.path = model;
        if (source && sourceCounts.get(model.sourceVariable) === 1 && !frame.histories.has(source.variableName)) source.path = model;
      }
      frame.pending = roots.flatMap((root, index) => {
        const assignment = readAssignment(root);
        // Multiple statements can share a line batch. A later unsupported write
        // must supersede an earlier supported assignment, even for equal values.
        if (assignment && roots.slice(index + 1).some((later) => later.kind === "assignment" &&
          later.structureReferences.some((ref) => ref.kind === "matrix_cell" &&
            ref.role === "assignment_target" && ref.variableName === assignment.target.variableName &&
            coordinateEqual(ref, assignment.target)))) return [];
        return assignment ? [assignment] : [];
      });
      for (const assignment of frame.pending) {
        const table = byName.get(assignment.target.variableName);
        if (table && !table.path) {
          table.expressionReferences = table.expressionReferences.map((ref) =>
            ref.role === "selected_operand" ? { ...ref, role: "operand" } : ref);
        }
      }
      frame.writes = roots.filter((root) => root.kind === "assignment").flatMap((root) =>
        root.structureReferences.filter((ref): ref is CellReference =>
          ref.kind === "matrix_cell" && ref.role === "assignment_target"));
    }
  };
}

import type {
  MatrixCellChange,
  MatrixFocus,
  MatrixVisualModel
} from "../../core/matrix-interpreter";
import { formatValue } from "./value-format";
import {
  createSelectionInspector,
  inspectionButton,
  type InspectionDetails
} from "./SelectionInspector";
import {
  initialMatrixViewport,
  matrixViewportContains,
  panMatrixViewport,
  revealMatrixCell,
  type MatrixViewport,
  type MatrixPanDirection
} from "./matrix-viewport";

export interface MatrixVisualizerHandle {
  element: HTMLElement;
  update(model: MatrixVisualModel): void;
  dispose(): void;
}

interface CellCoordinate {
  row: number;
  column: number;
}

function cellKey(row: number, column: number): string {
  return `cell:${row}:${column}`;
}

function parseCellKey(key: string): CellCoordinate | null {
  const match = /^cell:(\d+):(\d+)$/.exec(key);
  if (!match) {
    return null;
  }
  return { row: Number(match[1]), column: Number(match[2]) };
}

function isValidCoordinate(model: MatrixVisualModel, coordinate: CellCoordinate): boolean {
  return coordinate.row >= 0 &&
    coordinate.row < model.rowCount &&
    coordinate.column >= 0 &&
    coordinate.column < model.columnCount;
}

function validFocusesAt(
  model: MatrixVisualModel,
  row: number,
  column: number
): MatrixFocus[] {
  return model.focuses.filter((focus) =>
    !focus.rowOutOfBounds &&
    !focus.columnOutOfBounds &&
    focus.effectiveRow === row &&
    focus.effectiveColumn === column
  );
}

function changeAt(
  model: MatrixVisualModel,
  row: number,
  column: number
): MatrixCellChange | undefined {
  return model.changedCells.find((change) => change.row === row && change.column === column);
}

function focusBinding(
  focuses: MatrixFocus[],
  axis: "row" | "column"
): string {
  const bindings = focuses.map((focus) => {
    const source = axis === "row" ? focus.rowSource : focus.columnSource;
    const raw = axis === "row" ? focus.rawRow : focus.rawColumn;
    const variable = axis === "row" ? focus.rowVariable : focus.columnVariable;
    return source === "variable" && variable !== undefined
      ? `${variable} = ${raw}`
      : `literal ${raw}`;
  });
  return [...new Set(bindings)].join("; ") || "None";
}

function inBoundsFocus(model: MatrixVisualModel): MatrixFocus | undefined {
  return model.focuses.find((focus) =>
    !focus.rowOutOfBounds &&
    !focus.columnOutOfBounds &&
    focus.effectiveRow !== null &&
    focus.effectiveColumn !== null
  );
}

function renderControls(
  viewport: MatrixViewport,
  model: MatrixVisualModel,
  autoFollowEnabled: boolean
): HTMLElement {
  const controls = document.createElement("div");
  controls.className = "matrix-visualizer__controls";
  controls.dataset.autoFollow = String(autoFollowEnabled);
  const buttons: Array<[MatrixPanDirection, string]> = [
    ["up", "Pan up"],
    ["down", "Pan down"],
    ["left", "Pan left"],
    ["right", "Pan right"]
  ];
  for (const [direction, label] of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "matrix-visualizer__control";
    button.dataset.matrixAction = `pan-${direction}`;
    button.textContent = label;
    button.disabled = direction === "up"
      ? viewport.rowStart === 0
      : direction === "down"
        ? viewport.rowStart + viewport.rowCount >= model.rowCount
        : direction === "left"
          ? viewport.columnStart === 0
          : viewport.columnStart + viewport.columnCount >= model.columnCount;
    controls.append(button);
  }
  const follow = document.createElement("button");
  follow.type = "button";
  follow.className = "matrix-visualizer__control";
  follow.dataset.matrixAction = "follow-current";
  follow.textContent = "Follow current cell";
  follow.setAttribute("aria-pressed", String(autoFollowEnabled));
  controls.append(follow);
  return controls;
}

function renderNotices(model: MatrixVisualModel, viewport: MatrixViewport): HTMLElement {
  const notices = document.createElement("div");
  notices.className = "matrix-visualizer__notices";
  for (const focus of model.focuses.filter((candidate) =>
    candidate.rowOutOfBounds || candidate.columnOutOfBounds
  )) {
    const notice = document.createElement("p");
    notice.className = "matrix-visualizer__notice matrix-visualizer__notice--requested";
    const statuses = [
      ...(focus.rowOutOfBounds ? ["row out of bounds"] : []),
      ...(focus.columnOutOfBounds ? ["column out of bounds"] : [])
    ];
    notice.textContent = `requested ${model.variableName}[${focus.rawRow}][${focus.rawColumn}] · ${statuses.join(", ")} · shape ${model.rowCount}×${model.columnCount}`;
    notices.append(notice);
  }
  const outsideCount = model.changedCells.filter((change) =>
    !matrixViewportContains(viewport, change.row, change.column)
  ).length;
  if (outsideCount > 0) {
    const notice = document.createElement("p");
    notice.className = "matrix-visualizer__notice matrix-visualizer__notice--changed-outside";
    notice.textContent = `${outsideCount} changed cell${outsideCount === 1 ? "" : "s"} outside current view`;
    notices.append(notice);
  }
  return notices;
}

function renderGrid(model: MatrixVisualModel, viewport: MatrixViewport): HTMLElement {
  const viewportElement = document.createElement("div");
  viewportElement.className = "matrix-visualizer__viewport";
  viewportElement.dataset.matrixViewport = "true";
  viewportElement.dataset.rowStart = String(viewport.rowStart);
  viewportElement.dataset.columnStart = String(viewport.columnStart);
  viewportElement.dataset.rowCount = String(viewport.rowCount);
  viewportElement.dataset.columnCount = String(viewport.columnCount);

  const grid = document.createElement("div");
  grid.className = "matrix-visualizer__grid";
  grid.style.setProperty("--matrix-column-count", String(viewport.columnCount));
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-rowcount", String(model.rowCount));
  grid.setAttribute("aria-colcount", String(model.columnCount));

  const corner = document.createElement("span");
  corner.className = "matrix-visualizer__corner";
  grid.append(corner);
  for (let column = viewport.columnStart; column < viewport.columnStart + viewport.columnCount; column += 1) {
    const header = document.createElement("span");
    header.className = "matrix-visualizer__column-label";
    header.dataset.column = String(column);
    header.textContent = String(column);
    header.setAttribute("role", "columnheader");
    grid.append(header);
  }

  for (let row = viewport.rowStart; row < viewport.rowStart + viewport.rowCount; row += 1) {
    const rowLabel = document.createElement("span");
    rowLabel.className = "matrix-visualizer__row-label";
    rowLabel.dataset.row = String(row);
    rowLabel.textContent = String(row);
    rowLabel.setAttribute("role", "rowheader");
    grid.append(rowLabel);
    for (let column = viewport.columnStart; column < viewport.columnStart + viewport.columnCount; column += 1) {
      const value = model.cells[row]?.[column];
      if (value === undefined) {
        continue;
      }
      const focuses = validFocusesAt(model, row, column);
      const change = changeAt(model, row, column);
      const target = inspectionButton(cellKey(row, column), `Inspect ${model.variableName}[${row}][${column}]`);
      target.classList.add("matrix-visualizer__cell");
      target.dataset.matrixCell = "true";
      target.dataset.cellRow = String(row);
      target.dataset.cellColumn = String(column);
      target.setAttribute("role", "gridcell");
      target.setAttribute("aria-label", `${model.variableName}[${row}][${column}] = ${formatValue(value)}`);
      target.textContent = formatValue(value);
      target.classList.toggle("is-focus", focuses.length > 0);
      target.classList.toggle("is-changed", change !== undefined);
      if (focuses.length > 0) {
        target.dataset.focus = "true";
      }
      if (change) {
        target.dataset.changed = "true";
        target.dataset.changeAction = change.action;
      }
      if (focuses.length > 0 && change) {
        target.classList.add("is-focus-and-changed");
      }
      grid.append(target);
    }
  }
  viewportElement.append(grid);
  return viewportElement;
}

function renderContents(
  section: HTMLElement,
  model: MatrixVisualModel,
  viewport: MatrixViewport,
  autoFollowEnabled: boolean
): void {
  const header = document.createElement("header");
  header.className = "matrix-visualizer__header";
  const title = document.createElement("h2");
  title.className = "matrix-visualizer__title";
  title.textContent = model.variableName;
  const shape = document.createElement("span");
  shape.className = "matrix-visualizer__shape";
  shape.dataset.matrixShape = "true";
  shape.textContent = `${model.rowCount}×${model.columnCount}`;
  header.append(title, shape);

  section.dataset.variableName = model.variableName;
  section.setAttribute("aria-label", `${model.variableName} matrix visualization`);
  section.replaceChildren(
    header,
    renderControls(viewport, model, autoFollowEnabled),
    renderNotices(model, viewport),
    renderGrid(model, viewport)
  );
}

export function createMatrixVisualizer(initialModel: MatrixVisualModel): MatrixVisualizerHandle {
  const section = document.createElement("section");
  section.className = "matrix-visualizer";
  let currentModel = initialModel;
  let viewport = initialMatrixViewport(initialModel.rowCount, initialModel.columnCount);
  let autoFollowEnabled = true;

  const revealCurrentFocus = (): void => {
    const focus = inBoundsFocus(currentModel);
    if (focus && focus.effectiveRow !== null && focus.effectiveColumn !== null) {
      viewport = revealMatrixCell(
        viewport,
        focus.effectiveRow,
        focus.effectiveColumn,
        currentModel.rowCount,
        currentModel.columnCount
      );
    }
  };

  const getDetails = (key: string): InspectionDetails | null => {
    const coordinate = parseCellKey(key);
    if (!coordinate || !isValidCoordinate(currentModel, coordinate)) {
      return null;
    }
    const value = currentModel.cells[coordinate.row]?.[coordinate.column];
    if (!value) {
      return null;
    }
    const focuses = validFocusesAt(currentModel, coordinate.row, coordinate.column);
    const change = changeAt(currentModel, coordinate.row, coordinate.column);
    const fields: Array<[string, string]> = [
      ["value", formatValue(value)],
      ["type", value.type],
      ["row", String(coordinate.row)],
      ["column", String(coordinate.column)],
      ["focus", focuses.length > 0 ? "yes" : "no"],
      ["changed", change ? "yes" : "no"]
    ];
    if (change) {
      fields.push(["action", change.action]);
      if (change.before !== undefined) {
        fields.push(["before", formatValue(change.before)]);
      }
      if (change.after !== undefined) {
        fields.push(["after", formatValue(change.after)]);
      }
    }
    if (focuses.length > 0) {
      fields.push(["row binding", focusBinding(focuses, "row")]);
      fields.push(["column binding", focusBinding(focuses, "column")]);
    }
    return {
      title: `${currentModel.variableName}[${coordinate.row}][${coordinate.column}]`,
      fields
    };
  };

  const inspector = createSelectionInspector(section, getDetails, {
    retainMissingSelection: (key) => {
      const coordinate = parseCellKey(key);
      return coordinate !== null && isValidCoordinate(currentModel, coordinate);
    }
  });

  const render = (): void => {
    renderContents(section, currentModel, viewport, autoFollowEnabled);
    inspector.refresh();
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-matrix-action]")
      : null;
    const action = target?.dataset.matrixAction;
    if (!action) {
      return;
    }
    if (action === "follow-current") {
      autoFollowEnabled = true;
      revealCurrentFocus();
      render();
      return;
    }
    if (action.startsWith("pan-")) {
      autoFollowEnabled = false;
      viewport = panMatrixViewport(
        viewport,
        action.slice("pan-".length) as MatrixPanDirection,
        currentModel.rowCount,
        currentModel.columnCount
      );
      render();
    }
  };
  section.addEventListener("click", onClick);

  render();
  return {
    element: section,
    update(model) {
      currentModel = model;
      viewport = revealMatrixCell(
        viewport,
        -1,
        -1,
        currentModel.rowCount,
        currentModel.columnCount
      );
      if (autoFollowEnabled) {
        revealCurrentFocus();
      }
      render();
    },
    dispose() {
      section.removeEventListener("click", onClick);
      inspector.dispose();
    }
  };
}

export function renderMatrixVisualizer(model: MatrixVisualModel): HTMLElement {
  return createMatrixVisualizer(model).element;
}

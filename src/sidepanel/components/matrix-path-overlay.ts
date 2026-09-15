import { matrixCoordinateKey, matrixPathTo, type MatrixCoordinate } from "../../core/matrix-path";
import type { MatrixVisualModel } from "../../core/matrix-interpreter";
import { formatValue } from "./value-format";

export interface MatrixPathSelection {
  groupId: string;
  coordinate?: MatrixCoordinate;
}

export function renderMatrixPathOverlay(
  section: HTMLElement,
  model: MatrixVisualModel,
  selectedEndpoint?: MatrixCoordinate
): void {
  const path = model.path;
  if (!path) return;
  const endpoint = selectedEndpoint ?? path.endpoint;
  const route = matrixPathTo(path, endpoint);
  const positions = new Map(route.map((node, index) => [matrixCoordinateKey(node), index]));
  const decision = selectedEndpoint ? undefined : path.decision;
  const candidates = new Set(decision?.candidates.map(matrixCoordinateKey));
  const selectedKey = decision?.selected && matrixCoordinateKey(decision.selected);
  for (const cell of section.querySelectorAll<HTMLElement>("[data-matrix-cell]")) {
    const coordinate = { row: Number(cell.dataset.cellRow), column: Number(cell.dataset.cellColumn) };
    const key = matrixCoordinateKey(coordinate);
    const index = positions.get(key);
    if (candidates.has(key)) {
      cell.dataset.pathCandidate = "true";
      cell.classList.add("is-path-candidate");
    }
    if (key === selectedKey) {
      cell.dataset.pathSelected = "true";
      cell.classList.add("is-path-selected");
    }
    if (index === undefined) continue;
    cell.dataset.pathCell = "true";
    cell.classList.add("is-path-cell");
    cell.setAttribute("aria-label", `${cell.getAttribute("aria-label")} · recorded path, position ${index + 1} of ${route.length}`);
    const next = route[index + 1];
    if (next) {
      const arrow = document.createElement("span");
      arrow.className = "matrix-visualizer__path-arrow";
      arrow.dataset.pathDirection = next.row > coordinate.row ? "down" : "right";
      arrow.textContent = next.row > coordinate.row ? "↓" : "→";
      arrow.setAttribute("aria-hidden", "true");
      cell.append(arrow);
    } else {
      cell.classList.add("is-path-endpoint");
    }
  }

  const summary = document.createElement("div");
  summary.className = "matrix-visualizer__path-summary";
  summary.dataset.pathSummary = "true";
  const title = document.createElement("strong");
  const last = route.at(-1);
  const label = `${path.tableVariable}[${endpoint.row}][${endpoint.column}]`;
  title.textContent = !last ? `Path not captured for ${label}`
    : `${last.complete ? "Recorded path" : "Incomplete path"} · ${label} = ${formatValue(last.value)}`;
  const caption = document.createElement("span");
  caption.textContent = !last ? "Choose a computed cell or follow the current path."
    : !last.complete ? last.reason ?? "Earlier path choices were not captured."
    : `${route.length} cell${route.length === 1 ? "" : "s"} · Orange: path · Dashed: candidates · Blue: chosen source`;
  summary.append(title, caption);
  if (decision && decision.candidates.length > 0) {
    const choice = document.createElement("span");
    const name = (coordinate: MatrixCoordinate): string => `${path.tableVariable}[${coordinate.row}][${coordinate.column}]`;
    choice.textContent = decision.selected
      ? `${name(decision.selected)} → ${name(decision.target)}`
      : `Choice unavailable for ${name(decision.target)}`;
    summary.append(choice);
  }
  const follow = document.createElement("button");
  follow.type = "button";
  follow.className = "matrix-visualizer__control";
  follow.dataset.matrixAction = "follow-path";
  follow.setAttribute("aria-pressed", String(!selectedEndpoint));
  follow.textContent = selectedEndpoint ? "Follow current path" : "Following current path";
  summary.append(follow);
  section.querySelector("[data-matrix-viewport]")?.before(summary);
}

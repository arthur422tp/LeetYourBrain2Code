import type { DictVisualModel } from "../../core/visual-model";
import { formatValue } from "./value-format";

export function renderDictVisualizer(model: DictVisualModel): HTMLElement {
  const section = document.createElement("section");
  section.className = "dict-visualizer";
  section.dataset.variableName = model.variableName;
  section.setAttribute("aria-label", `${model.variableName} dictionary visualization`);

  const heading = document.createElement("h2");
  heading.className = "dict-visualizer__title";
  heading.textContent = model.variableName;

  const table = document.createElement("div");
  table.className = "dict-visualizer__table";
  table.setAttribute("role", "table");

  const header = document.createElement("div");
  header.className = "dict-visualizer__row dict-visualizer__header";
  header.setAttribute("role", "row");
  for (const label of ["key", "value"]) {
    const cell = document.createElement("span");
    cell.className = "dict-visualizer__cell";
    cell.textContent = label;
    header.append(cell);
  }
  table.append(header);

  for (const entry of model.entries) {
    const row = document.createElement("div");
    row.className = `dict-visualizer__row is-${entry.status}`;
    row.dataset.dictEntryKey = formatValue(entry.key);
    row.setAttribute("role", "row");

    const key = document.createElement("code");
    key.className = "dict-visualizer__cell dict-visualizer__key";
    key.textContent = formatValue(entry.key);

    const value = document.createElement("code");
    value.className = "dict-visualizer__cell dict-visualizer__value";
    value.textContent = formatValue(entry.value);

    row.append(key, value);
    table.append(row);
  }

  section.append(heading, table);
  return section;
}

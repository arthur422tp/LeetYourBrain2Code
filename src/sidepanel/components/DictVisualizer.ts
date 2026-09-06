import type { DictVisualModel } from "../../core/visual-model";
import { formatValue } from "./value-format";

export interface DictVisualizerHandle {
  element: HTMLElement;
  update(model: DictVisualModel): void;
  dispose(): void;
}

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

  const probes = document.createElement("div");
  probes.className = "dict-visualizer__probes";
  for (const probe of model.probes ?? []) {
    const row = document.createElement("div");
    row.className = `dict-visualizer__probe is-${probe.status}`;
    row.dataset.dictProbeKeyVariable = probe.keyVariable;
    row.dataset.dictProbeStatus = probe.status;
    row.setAttribute(
      "aria-label",
      `${probe.operation} ${probe.keyVariable} = ${formatValue(probe.key)}: ${probe.status}`
    );

    const label = document.createElement("span");
    label.className = "dict-visualizer__probe-label";
    label.textContent = `${probe.operation === "membership" ? "lookup" : "access"} ${probe.keyVariable}`;

    const key = document.createElement("code");
    key.className = "dict-visualizer__probe-key";
    key.textContent = formatValue(probe.key);

    const status = document.createElement("span");
    status.className = "dict-visualizer__probe-status";
    status.textContent = probe.status;

    row.append(label, key, status);
    probes.append(row);
  }

  section.append(heading, table);
  if (model.probes && model.probes.length > 0) {
    section.append(probes);
  }
  return section;
}

export function createDictVisualizer(initialModel: DictVisualModel): DictVisualizerHandle {
  const section = renderDictVisualizer(initialModel);

  return {
    element: section,
    update(model) {
      const replacement = renderDictVisualizer(model);
      section.dataset.variableName = model.variableName;
      section.setAttribute("aria-label", `${model.variableName} dictionary visualization`);
      section.replaceChildren(...Array.from(replacement.children));
    },
    dispose() {
      // Dictionary rows are recreated per step; there are no long-lived resources.
    }
  };
}

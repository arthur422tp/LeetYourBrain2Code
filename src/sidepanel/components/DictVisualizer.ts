import type { DictVisualModel } from "../../core/visual-model";
import { formatValue } from "./value-format";
import { valueSnapshotKey } from "../../core/value-snapshot";
import { createSelectionInspector, inspectionButton } from "./SelectionInspector";

export interface DictVisualizerHandle {
  element: HTMLElement;
  update(model: DictVisualModel): void;
  dispose(): void;
}

function probeKey(probe: NonNullable<DictVisualModel["probes"]>[number]): string {
  return `probe:${JSON.stringify([probe.keyVariable, probe.operation, valueSnapshotKey(probe.key)])}`;
}

function renderDictContents(model: DictVisualModel): HTMLElement {
  const section = document.createElement("section");
  section.className = "dict-visualizer";
  section.dataset.variableName = model.variableName;
  section.setAttribute("aria-label", `${model.variableName} dictionary visualization`);

  const heading = document.createElement("h2");
  heading.className = "dict-visualizer__title";
  heading.textContent = model.variableName;

  const table = document.createElement("div");
  table.className = "dict-visualizer__table";
  table.setAttribute("role", "group");

  const header = document.createElement("div");
  header.className = "dict-visualizer__row dict-visualizer__header";

  for (const label of ["key", "value"]) {
    const cell = document.createElement("span");
    cell.className = "dict-visualizer__cell";
    cell.textContent = label;
    header.append(cell);
  }
  table.append(header);

  for (const entry of model.entries) {
    const row = inspectionButton(valueSnapshotKey(entry.key), `Inspect key ${formatValue(entry.key)}`);
    row.classList.add("dict-visualizer__row", `is-${entry.status}`);
    row.dataset.dictEntryKey = formatValue(entry.key);


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
    const row = inspectionButton(probeKey(probe), `Inspect ${probe.keyVariable} lookup`);
    row.classList.add("dict-visualizer__probe", `is-${probe.status}`);
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
  const section = renderDictContents(initialModel);
  let currentModel = initialModel;
  const inspector = createSelectionInspector(section, (key) => {
    const probe = currentModel.probes?.find((probe) => probeKey(probe) === key);
    if (probe) {
      return {title: `${currentModel.variableName} lookup`, fields: [
        ["key", formatValue(probe.key)], ["key type", probe.key.type],
        ["variable", probe.keyVariable], ["operation", probe.operation], ["result", probe.status]
      ]};
    }
    const entry = currentModel.entries.find((entry) => valueSnapshotKey(entry.key) === key);
    if (!entry) return null;
    const probes = currentModel.probes?.filter((probe) => valueSnapshotKey(probe.key) === key) ?? [];
    return {title: `${currentModel.variableName}[${formatValue(entry.key)}]`, fields: [
      ["key", formatValue(entry.key)], ["key type", entry.key.type],
      ["value", formatValue(entry.value)], ["value type", entry.value.type], ["status", entry.status],
      ["lookup", probes.map((probe) => `${probe.keyVariable}: ${probe.operation} · ${probe.status}`).join("; ") || "None"]
    ]};
  });

  return {
    element: section,
    update(model) {
      currentModel = model;
      const replacement = renderDictContents(model);
      section.dataset.variableName = model.variableName;
      section.setAttribute("aria-label", `${model.variableName} dictionary visualization`);
      section.replaceChildren(...Array.from(replacement.children));
      inspector.refresh();
    },
    dispose() {
      inspector.dispose();
    }
  };
}

export function renderDictVisualizer(model: DictVisualModel): HTMLElement {
  return createDictVisualizer(model).element;
}

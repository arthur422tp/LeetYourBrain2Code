import type { ListVisualModel } from "../../core/visual-model";
import { formatValue } from "./value-format";

function createPointerMarker(
  pointer: ListVisualModel["pointers"][number]
): HTMLSpanElement {
  const marker = document.createElement("span");
  marker.className = "list-visualizer__pointer";
  marker.dataset.pointerName = pointer.name;
  marker.title = `${pointer.name} = ${pointer.index}`;
  marker.setAttribute("aria-label", `${pointer.name} pointer at index ${pointer.index}`);

  const name = document.createElement("span");
  name.className = "list-visualizer__pointer-name";
  name.textContent = pointer.name;

  const arrow = document.createElement("span");
  arrow.className = "list-visualizer__pointer-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "↓";

  marker.append(name, arrow);
  return marker;
}

function createListItem(
  model: ListVisualModel,
  index: number,
  pointers: ListVisualModel["pointers"]
): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "list-visualizer__item";
  item.dataset.listItemIndex = String(index);
  item.setAttribute("role", "group");
  item.setAttribute("aria-label", `Index ${index}: ${formatValue(model.items[index]!)}`);

  const pointerRow = document.createElement("div");
  pointerRow.className = "list-visualizer__pointers";
  pointerRow.append(...pointers.map(createPointerMarker));

  const value = document.createElement("div");
  value.className = "list-visualizer__value";
  value.textContent = `[${formatValue(model.items[index]!)}]`;

  const itemIndex = document.createElement("div");
  itemIndex.className = "list-visualizer__index";
  itemIndex.textContent = String(index);

  if (model.changedIndexes.includes(index)) {
    item.classList.add("is-changed");
    item.dataset.changed = "true";
  }

  item.append(pointerRow, value, itemIndex);
  return item;
}

function createRequestedItem(
  pointer: ListVisualModel["pointers"][number],
  pointers: ListVisualModel["pointers"]
): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "list-visualizer__requested-item";
  item.dataset.requestedIndex = String(pointer.index);
  item.setAttribute("role", "group");
  item.setAttribute("aria-label", `Requested index ${pointer.index}`);

  const pointerRow = document.createElement("div");
  pointerRow.className = "list-visualizer__pointers";
  pointerRow.append(...pointers.map(createPointerMarker));

  const value = document.createElement("div");
  value.className = "list-visualizer__value";
  value.textContent = `[${pointer.index}]`;

  const requested = document.createElement("div");
  requested.className = "list-visualizer__requested-label";
  requested.textContent = "requested";

  item.append(pointerRow, value, requested);
  return item;
}

function effectiveIndex(index: number, itemCount: number): number {
  return index < 0 ? itemCount + index : index;
}

export function renderListVisualizer(model: ListVisualModel): HTMLElement {
  const section = document.createElement("section");
  section.id = "list-visualizer";
  section.className = "list-visualizer";
  section.dataset.variableName = model.variableName;
  section.setAttribute("aria-label", `${model.variableName} list visualization`);

  const heading = document.createElement("h2");
  heading.className = "list-visualizer__title";
  heading.textContent = model.variableName;

  const list = document.createElement("div");
  list.className = "list-visualizer__list";
  list.setAttribute("role", "list");

  const pointersByIndex = new Map<number, ListVisualModel["pointers"]>();
  for (const pointer of model.pointers) {
    if (pointer.outOfBounds) {
      continue;
    }
    const index = effectiveIndex(pointer.index, model.items.length);
    const pointers = pointersByIndex.get(index) ?? [];
    pointers.push(pointer);
    pointersByIndex.set(index, pointers);
  }

  for (let index = 0; index < model.items.length; index += 1) {
    list.append(createListItem(model, index, pointersByIndex.get(index) ?? []));
  }

  const requestedByIndex = new Map<number, ListVisualModel["pointers"]>();
  for (const pointer of model.pointers) {
    if (!pointer.outOfBounds) {
      continue;
    }
    const pointers = requestedByIndex.get(pointer.index) ?? [];
    pointers.push(pointer);
    requestedByIndex.set(pointer.index, pointers);
  }
  for (const [index, pointers] of requestedByIndex) {
    list.append(createRequestedItem(pointers[0]!, pointers));
  }

  section.append(heading, list);
  return section;
}

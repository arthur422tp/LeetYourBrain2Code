import type { ListVisualModel } from "../../core/visual-model";
import { formatValue } from "./value-format";
import { createSelectionInspector, inspectionButton, type InspectionDetails } from "./SelectionInspector";

export interface ListVisualizerHandle {
  element: HTMLElement;
  update(model: ListVisualModel): void;
  dispose(): void;
}

type ListPointer = ListVisualModel["pointers"][number];

function createPointerMarker(
  pointer: ListPointer,
  pointedValue?: ListVisualModel["items"][number]
): HTMLSpanElement {
  const marker = document.createElement("span");
  marker.className = "list-visualizer__pointer";
  marker.dataset.pointerName = pointer.name;
  marker.dataset.pointerIndex = String(pointer.index);
  if (pointer.source) {
    marker.dataset.pointerSource = pointer.source;
  }
  if (pointer.valueVariable) {
    marker.dataset.pointerValueVariable = pointer.valueVariable;
  }
  marker.title = `${pointer.name} = ${pointer.index}`;
  const pointedValueLabel = pointer.valueVariable && pointedValue !== undefined
    ? `, ${pointer.valueVariable} = ${formatValue(pointedValue)}`
    : "";
  marker.setAttribute(
    "aria-label",
    `${pointer.name} pointer at index ${pointer.index}${pointedValueLabel}`
  );

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

function updatePointerMarker(
  marker: HTMLSpanElement,
  pointer: ListPointer,
  pointedValue?: ListVisualModel["items"][number]
): void {
  marker.dataset.pointerName = pointer.name;
  marker.dataset.pointerIndex = String(pointer.index);
  if (pointer.source) {
    marker.dataset.pointerSource = pointer.source;
  } else {
    delete marker.dataset.pointerSource;
  }
  if (pointer.valueVariable) {
    marker.dataset.pointerValueVariable = pointer.valueVariable;
  } else {
    delete marker.dataset.pointerValueVariable;
  }
  marker.title = `${pointer.name} = ${pointer.index}`;
  const pointedValueLabel = pointer.valueVariable && pointedValue !== undefined
    ? `, ${pointer.valueVariable} = ${formatValue(pointedValue)}`
    : "";
  marker.setAttribute(
    "aria-label",
    `${pointer.name} pointer at index ${pointer.index}${pointedValueLabel}`
  );
  marker.querySelector<HTMLElement>(".list-visualizer__pointer-name")!.textContent = pointer.name;
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
  pointerRow.append(...pointers.map((pointer) => createPointerMarker(
    pointer,
    model.items[effectiveIndex(pointer.index, model.items.length)]
  )));

  const value = inspectionButton(`index:${index}`, `Inspect index ${index}`);
  value.classList.add("list-visualizer__value");
  value.textContent = `[${formatValue(model.items[index]!)}]`;

  const itemIndex = document.createElement("div");
  itemIndex.className = "list-visualizer__index";
  itemIndex.textContent = String(index);

  if (model.changedIndexes.includes(index)) {
    item.classList.add("is-changed");
    item.dataset.changed = "true";
  }
  if (pointers.length > 0) {
    item.classList.add("is-pointer-target");
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
  pointerRow.append(...pointers.map((pointer) => createPointerMarker(pointer)));

  const value = inspectionButton(`requested:${pointer.index}`, `Inspect requested index ${pointer.index}`);
  value.classList.add("list-visualizer__value");
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

function renderListContents(model: ListVisualModel): HTMLElement {
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

function requestedPointerSignature(model: ListVisualModel): string {
  return model.pointers
    .filter((pointer) => pointer.outOfBounds)
    .map((pointer) => `${pointer.name}:${pointer.index}`)
    .sort()
    .join("|");
}

function currentRequestedPointerSignature(list: HTMLElement): string {
  return [...list.querySelectorAll<HTMLElement>("[data-requested-index]")]
    .flatMap((item) => [...item.querySelectorAll<HTMLElement>("[data-pointer-name]")]
      .map((pointer) => `${pointer.dataset.pointerName}:${item.dataset.requestedIndex}`))
    .sort()
    .join("|");
}

function updateListItems(list: HTMLElement, model: ListVisualModel): void {
  const pointerIndexes = new Set(
    model.pointers
      .filter((pointer) => !pointer.outOfBounds)
      .map((pointer) => effectiveIndex(pointer.index, model.items.length))
  );
  for (let index = 0; index < model.items.length; index += 1) {
    const item = list.querySelector<HTMLElement>(`[data-list-item-index="${index}"]`);
    if (!item) {
      continue;
    }
    item.setAttribute("aria-label", `Index ${index}: ${formatValue(model.items[index]!)}`);
    item.classList.toggle("is-changed", model.changedIndexes.includes(index));
    if (model.changedIndexes.includes(index)) {
      item.dataset.changed = "true";
    } else {
      delete item.dataset.changed;
    }
    item.classList.toggle("is-pointer-target", pointerIndexes.has(index));
    if (pointerIndexes.has(index)) {
      item.classList.remove("is-pointer-focus");
      void item.offsetWidth;
      item.classList.add("is-pointer-focus");
    }
    item.querySelector<HTMLElement>(".list-visualizer__value")!.textContent =
      `[${formatValue(model.items[index]!)}]`;
  }
}

function animatePointerMove(
  marker: HTMLSpanElement,
  from: DOMRect,
  to: DOMRect,
  animations: Animation[]
): void {
  const deltaX = from.left - to.left;
  const deltaY = from.top - to.top;
  if (
    deltaX === 0 && deltaY === 0 ||
    typeof marker.animate !== "function" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  const animation = marker.animate(
    [
      { transform: `translate(${deltaX}px, ${deltaY}px)` },
      { transform: "translate(0, 0)" }
    ],
    { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
  );
  animations.push(animation);
  animation.finished.finally(() => {
    const index = animations.indexOf(animation);
    if (index >= 0) {
      animations.splice(index, 1);
    }
  }).catch(() => undefined);
}

export function createListVisualizer(initialModel: ListVisualModel): ListVisualizerHandle {
  const section = renderListContents(initialModel);
  let currentModel = initialModel;
  const inspector = createSelectionInspector(section, (key): InspectionDetails | null => {
    const index = Number(key.slice(key.indexOf(":") + 1));
    if (key.startsWith("requested:")) {
      const pointers = currentModel.pointers.filter((pointer) => pointer.outOfBounds && pointer.index === index);
      return {title: "Requested index", fields: [
        ["index", String(index)], ["status", "out of bounds"],
        ["length", String(currentModel.items.length)],
        ["pointers", pointers.map((pointer) => `${pointer.name} = ${pointer.index}`).join(", ")]
      ]};
    }
    const value = currentModel.items[index];
    if (!value) return null;
    const pointers = currentModel.pointers.filter((pointer) => !pointer.outOfBounds && effectiveIndex(pointer.index, currentModel.items.length) === index);
    return {title: `${currentModel.variableName}[${index}]`, fields: [
      ["value", formatValue(value)], ["type", value.type], ["index", String(index)],
      ["status", currentModel.changedIndexes.includes(index) ? "changed" : "unchanged"],
      ["pointers", pointers.map((pointer) => `${pointer.name} = ${pointer.index}${pointer.valueVariable ? `, ${pointer.valueVariable} = ${formatValue(value)}` : ""}`).join("; ") || "None"]
    ]};
  });
  const list = section.querySelector<HTMLElement>(".list-visualizer__list")!;
  const animations: Animation[] = [];

  const updateItems = (model: ListVisualModel): void => {
    const requiresRebuild =
      list.querySelectorAll("[data-list-item-index]").length !== model.items.length ||
      currentRequestedPointerSignature(list) !== requestedPointerSignature(model);

    if (requiresRebuild) {
      const replacement = renderListContents(model);
      list.replaceChildren(...Array.from(replacement.querySelector(".list-visualizer__list")!.children));
      return;
    }

    updateListItems(list, model);

    const desiredPointers = new Map(model.pointers.map((pointer) => [pointer.name, pointer]));
    const existingPointers = new Map(
      [...list.querySelectorAll<HTMLSpanElement>("[data-pointer-name]")]
        .map((pointer) => [pointer.dataset.pointerName!, pointer] as const)
    );

    for (const [name, marker] of existingPointers) {
      if (!desiredPointers.has(name)) {
        marker.remove();
      }
    }

    for (const pointer of model.pointers) {
      if (pointer.outOfBounds) {
        continue;
      }
      const targetIndex = effectiveIndex(pointer.index, model.items.length);
      const targetItem = list.querySelector<HTMLElement>(`[data-list-item-index="${targetIndex}"]`);
      const targetRow = targetItem?.querySelector<HTMLElement>(".list-visualizer__pointers");
      if (!targetRow) {
        continue;
      }

      let marker = existingPointers.get(pointer.name);
      if (!marker) {
        marker = createPointerMarker(pointer, model.items[targetIndex]);
      } else {
        const fromItem = marker.closest<HTMLElement>("[data-list-item-index]");
        const from = fromItem ? marker.getBoundingClientRect() : new DOMRect();
        updatePointerMarker(marker, pointer, model.items[targetIndex]);
        if (fromItem !== targetItem) {
          targetRow.append(marker);
          animatePointerMove(marker, from, marker.getBoundingClientRect(), animations);
          continue;
        }
      }
      targetRow.append(marker);
    }
  };

  return {
    element: section,
    update(model) {
      currentModel = model;
      section.dataset.variableName = model.variableName;
      section.setAttribute("aria-label", `${model.variableName} list visualization`);
      section.querySelector(".list-visualizer__title")!.textContent = model.variableName;
      updateItems(model);
      inspector.refresh();
    },
    dispose: () => {
      inspector.dispose();
      for (const animation of animations) {
        animation.cancel();
      }
      animations.splice(0);
    }
  };
}

export function renderListVisualizer(model: ListVisualModel): HTMLElement {
  return createListVisualizer(model).element;
}

import type { LinkedListVisualModel } from "../../core/linked-list-interpreter";
import { formatValue } from "./value-format";

export interface LinkedListVisualizerHandle {
  element: HTMLElement;
  update(model: LinkedListVisualModel): void;
  dispose(): void;
}

function render(model: LinkedListVisualModel): HTMLElement {
  const section = document.createElement("section");
  section.className = "linked-list-visualizer";
  section.dataset.visualId = model.visualId;
  section.setAttribute("aria-label", `${model.visualId} linked list visualization`);

  const title = document.createElement("h2");
  title.className = "linked-list-visualizer__title";
  title.textContent = "Linked list";
  section.append(title);

  const nodeById = new Map(model.nodes.map((node) => [node.objectId, node]));
  const pointersByNode = new Map<string, typeof model.pointers>();
  for (const pointer of model.pointers) {
    if (pointer.objectId === null) {
      continue;
    }
    const pointers = pointersByNode.get(pointer.objectId) ?? [];
    pointers.push(pointer);
    pointersByNode.set(pointer.objectId, pointers);
  }
  for (const pointers of pointersByNode.values()) {
    pointers.sort((left, right) => left.variableName.localeCompare(right.variableName));
  }

  for (const component of model.components) {
    const row = document.createElement("div");
    row.className = "linked-list-visualizer__component";
    row.dataset.componentId = component.componentId;
    for (const objectId of component.nodeIds) {
      const node = model.nodes.find((item) => item.objectId === objectId);
      if (!node) {
        continue;
      }
      const item = document.createElement("div");
      item.className = `linked-list-visualizer__node is-${node.status}`;
      item.dataset.nodeId = node.objectId;
      item.dataset.nodeStatus = node.status;

      const pointerRow = document.createElement("div");
      pointerRow.className = "linked-list-visualizer__pointers";
      for (const pointer of pointersByNode.get(node.objectId) ?? []) {
        const marker = document.createElement("span");
        marker.className = `linked-list-visualizer__pointer is-${pointer.status}`;
        marker.dataset.pointerName = pointer.variableName;
        marker.dataset.pointerStatus = pointer.status;
        marker.textContent = `${pointer.variableName}${pointer.status === "moved" ? " →" : ""}`;
        pointerRow.append(marker);
      }

      const value = document.createElement("code");
      value.className = "linked-list-visualizer__value";
      value.textContent = formatValue(node.label ?? { type: "none", value: null });

      const next = document.createElement("span");
      next.className = `linked-list-visualizer__next is-${node.nextStatus}`;
      next.dataset.nextStatus = node.nextStatus;
      const nextTarget = node.nextObjectId === null
        ? "None"
        : nodeById.has(node.nextObjectId)
          ? node.nextObjectId
          : "…";
      next.textContent = `next -> ${nextTarget}`;

      item.append(pointerRow, value, next);
      row.append(item);
    }
    section.append(row);
  }

  const removedPointers = model.pointers.filter((pointer) => pointer.objectId === null);
  if (removedPointers.length > 0) {
    const removed = document.createElement("div");
    removed.className = "linked-list-visualizer__removed-pointers";
    for (const pointer of removedPointers) {
      const marker = document.createElement("span");
      marker.dataset.pointerName = pointer.variableName;
      marker.dataset.pointerStatus = pointer.status;
      marker.textContent = `${pointer.variableName} -> None`;
      removed.append(marker);
    }
    section.append(removed);
  }

  if (model.cyclic) {
    const cycle = document.createElement("div");
    cycle.className = "linked-list-visualizer__cycle";
    cycle.dataset.cycleIndicator = "true";
    cycle.textContent = "cycle: back-edge detected";
    section.append(cycle);
  }
  if (model.truncated) {
    const truncated = document.createElement("div");
    truncated.className = "linked-list-visualizer__truncated";
    truncated.dataset.truncated = "true";
    truncated.textContent = "Topology truncated";
    section.append(truncated);
  }
  return section;
}

export function createLinkedListVisualizer(
  initialModel: LinkedListVisualModel
): LinkedListVisualizerHandle {
  const section = render(initialModel);
  return {
    element: section,
    update(model) {
      const replacement = render(model);
      section.dataset.visualId = model.visualId;
      section.replaceChildren(...Array.from(replacement.children));
    },
    dispose() {
      // This renderer owns no external resources.
    }
  };
}

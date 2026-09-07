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
      item.className = "linked-list-visualizer__node";
      item.dataset.nodeId = node.objectId;
      item.textContent = `${formatValue(node.label ?? { type: "none", value: null })}`;
      row.append(item);
    }
    section.append(row);
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

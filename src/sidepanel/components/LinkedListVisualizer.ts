import { appendPointerName, pointerLabelHeight } from "./pointer-label";
import type { LinkedListVisualModel } from "../../core/linked-list-interpreter";
import { formatValue } from "./value-format";
import { createSelectionInspector, inspectionButton } from "./SelectionInspector";

export interface LinkedListVisualizerHandle {
  element: HTMLElement;
  update(model: LinkedListVisualModel): void;
  dispose(): void;
}

function orderedNodeIds(
  component: LinkedListVisualModel["components"][number],
  nodeById: Map<string, LinkedListVisualModel["nodes"][number]>
): string[] {
  const componentNodeIds = new Set(component.nodeIds);
  const ordered: string[] = [];
  const visited = new Set<string>();

  const visit = (startObjectId: string): void => {
    let currentObjectId: string | null = startObjectId;
    while (
      currentObjectId !== null &&
      componentNodeIds.has(currentObjectId) &&
      nodeById.has(currentObjectId) &&
      !visited.has(currentObjectId)
    ) {
      visited.add(currentObjectId);
      ordered.push(currentObjectId);
      const nextObjectId: string | null = nodeById.get(currentObjectId)!.nextObjectId;
      currentObjectId = nextObjectId !== null &&
          componentNodeIds.has(nextObjectId) &&
          !visited.has(nextObjectId)
        ? nextObjectId
        : null;
    }
  };

  for (const entryNodeId of component.entryNodeIds) {
    visit(entryNodeId);
  }
  for (const nodeId of [...component.nodeIds].sort((left, right) => left.localeCompare(right))) {
    visit(nodeId);
  }
  return ordered;
}

function cycleEdgeSources(
  component: LinkedListVisualModel["components"][number],
  nodeById: Map<string, LinkedListVisualModel["nodes"][number]>
): Set<string> {
  const componentNodeIds = new Set(component.nodeIds);
  const visited = new Set<string>();
  const cycleSources = new Set<string>();

  for (const startObjectId of component.nodeIds) {
    let currentObjectId: string | null = startObjectId;
    const path = new Set<string>();
    while (
      currentObjectId !== null &&
      componentNodeIds.has(currentObjectId) &&
      nodeById.has(currentObjectId)
    ) {
      if (path.has(currentObjectId)) {
        const cycleStartIndex = [...path.keys()].indexOf(currentObjectId);
        for (const cycleObjectId of [...path.keys()].slice(cycleStartIndex)) {
          cycleSources.add(cycleObjectId);
        }
        break;
      }
      if (visited.has(currentObjectId)) {
        break;
      }
      path.add(currentObjectId);
      visited.add(currentObjectId);
      currentObjectId = nodeById.get(currentObjectId)!.nextObjectId;
    }
  }
  return cycleSources;
}

function appendEdge(
  track: HTMLElement,
  node: LinkedListVisualModel["nodes"][number],
  nextNode: LinkedListVisualModel["nodes"][number] | undefined,
  nextNodeIndex: number | undefined,
  componentNodeIds: Set<string>,
  nodeIndexById: Map<string, number>,
  cycleSources: Set<string>,
  nodeById: Map<string, LinkedListVisualModel["nodes"][number]>
): void {
  const edge = document.createElement("div");
  edge.className = `linked-list-visualizer__edge is-${node.nextStatus}`;
  edge.dataset.edgeFrom = node.objectId;

  const label = document.createElement("span");
  label.className = "linked-list-visualizer__edge-label";
  label.textContent = "next";

  const line = document.createElement("span");
  line.className = "linked-list-visualizer__edge-line";

  const target = document.createElement("code");
  target.className = "linked-list-visualizer__edge-target";

  if (node.nextObjectId === null) {
    edge.dataset.edgeKind = "terminal";
    edge.dataset.edgeTo = "None";
    target.textContent = "None";
  } else if (
    nextNode &&
    nextNodeIndex !== undefined &&
    nextNode.objectId === node.nextObjectId &&
    nodeIndexById.get(node.objectId)! + 1 === nextNodeIndex
  ) {
    edge.dataset.edgeKind = "next";
    edge.dataset.edgeTo = nextNode.objectId;
    target.textContent = `Node ${nextNodeIndex + 1}`;
  } else if (componentNodeIds.has(node.nextObjectId) && nodeIndexById.has(node.nextObjectId)) {
    const targetNodeIndex = nodeIndexById.get(node.nextObjectId)!;
    const isCycle = cycleSources.has(node.objectId);
    edge.classList.add(isCycle ? "is-cycle" : "is-branch");
    edge.dataset.edgeKind = isCycle ? "cycle" : "branch";
    edge.dataset.edgeTo = node.nextObjectId;
    target.textContent = `${isCycle ? "↩" : "↗"} Node ${targetNodeIndex + 1}`;
  } else {
    edge.classList.add(nodeById.has(node.nextObjectId) ? "is-external" : "is-dangling");
    edge.dataset.edgeKind = nodeById.has(node.nextObjectId) ? "external" : "dangling";
    edge.dataset.edgeTo = node.nextObjectId;
    target.textContent = node.nextObjectId;
  }

  if (edge.dataset.edgeKind === "next" || edge.dataset.edgeKind === "terminal") {
    target.hidden = true;
  }
  edge.title = `next → ${node.nextObjectId ?? "None"}`;
  edge.append(label, line, target);
  track.append(edge);

  if (node.nextObjectId === null) {
    const terminal = document.createElement("div");
    terminal.className = "linked-list-visualizer__terminal";
    terminal.dataset.terminal = "None";

    const terminalLabel = document.createElement("span");
    terminalLabel.className = "linked-list-visualizer__terminal-label";
    terminalLabel.textContent = "end";

    const terminalValue = document.createElement("code");
    terminalValue.textContent = "None";
    terminal.append(terminalLabel, terminalValue);
    track.append(terminal);
  }
}

function renderNode(
  node: LinkedListVisualModel["nodes"][number],
  nodeIndex: number,
  pointers: LinkedListVisualModel["pointers"]
): HTMLElement {
  const item = document.createElement("div");
  item.className = `linked-list-visualizer__node is-${node.status}`;
  item.dataset.nodeId = node.objectId;
  item.dataset.nodeStatus = node.status;

  const pointerRow = document.createElement("div");
  pointerRow.className = "linked-list-visualizer__pointers";
  for (const pointer of pointers) {
    const marker = document.createElement("span");
    marker.className = `linked-list-visualizer__pointer is-${pointer.status}`;
    marker.dataset.pointerName = pointer.variableName;
    marker.dataset.pointerStatus = pointer.status;
    appendPointerName(marker, pointer.variableName);
    marker.setAttribute("aria-label", `${pointer.variableName} pointer ${pointer.status}`);
    pointerRow.append(marker);
  }

  const value = inspectionButton(node.objectId, `Inspect ListNode ${node.objectId}`);
  value.classList.add("linked-list-visualizer__node-button");
  value.textContent = formatValue(node.label ?? { type: "none", value: null });
  item.dataset.nextStatus = node.nextStatus;
  const index = document.createElement("span");
  index.className = "linked-list-visualizer__index";
  index.textContent = `Node ${nodeIndex + 1}`;
  pointerRow.title = pointers.map((pointer) => pointer.variableName).join(", ");
  item.append(pointerRow, value, index);
  return item;
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
    const track = document.createElement("div");
    track.className = "linked-list-visualizer__track";
    const orderedIds = orderedNodeIds(component, nodeById);
    const componentNodeIds = new Set(component.nodeIds);
    const nodeIndexById = new Map(orderedIds.map((objectId, index) => [objectId, index]));
    const cycleSources = cycleEdgeSources(component, nodeById);
    const labelHeight = Math.max(28, ...orderedIds.map((id) =>
      pointerLabelHeight((pointersByNode.get(id) ?? []).map((pointer) => pointer.variableName), 28)));
    track.style.setProperty("--pointer-band-height", `${labelHeight}px`);

    orderedIds.forEach((objectId, index) => {
      const node = nodeById.get(objectId);
      if (!node) {
        return;
      }
      const nextNode = node.nextObjectId === null ? undefined : nodeById.get(node.nextObjectId);
      track.append(renderNode(
        node,
        index,
        pointersByNode.get(node.objectId) ?? []
      ));
      appendEdge(
        track,
        node,
        nextNode,
        nextNode ? nodeIndexById.get(nextNode.objectId) : undefined,
        componentNodeIds,
        nodeIndexById,
        cycleSources,
        nodeById
      );
    });
    if (orderedIds.length === 0) {
      row.textContent = "No nodes in this component.";
    } else {
      row.append(track);
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
  let currentModel = initialModel;
  const inspector = createSelectionInspector(section, (key) => {
    const node = currentModel.nodes.find((node) => node.objectId === key);
    if (!node) return null;
    const pointers = currentModel.pointers.filter((pointer) => pointer.objectId === key);
    return {title: node.className, fields: [
      ["val", formatValue(node.label ?? { type: "none", value: null })], ["object ID", node.objectId],
      ["next", node.nextObjectId ?? "None"], ["next status", node.nextStatus], ["status", node.status],
      ["pointers", pointers.map((pointer) => `${pointer.variableName} (${pointer.status})`).join(", ") || "None"]
    ]};
  });
  return {
    element: section,
    update(model) {
      const scrollPositions = new Map([...section.querySelectorAll<HTMLElement>("[data-component-id]")]
        .map((row) => [row.dataset.componentId, row.scrollLeft]));
      currentModel = model;
      const replacement = render(model);
      section.dataset.visualId = model.visualId;
      section.replaceChildren(...Array.from(replacement.children));
      for (const row of section.querySelectorAll<HTMLElement>("[data-component-id]")) {
        row.scrollLeft = scrollPositions.get(row.dataset.componentId) ?? 0;
      }
      inspector.refresh();
    },
    dispose() {
      inspector.dispose();
    }
  };
}

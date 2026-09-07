import type { LinkedListVisualModel } from "../../core/linked-list-interpreter";
import { formatValue } from "./value-format";

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
  pointers: LinkedListVisualModel["pointers"],
  nextTarget: string
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
    marker.textContent = `${pointer.variableName}${pointer.status === "moved" ? " →" : ""}`;
    pointerRow.append(marker);
  }

  const identity = document.createElement("div");
  identity.className = "linked-list-visualizer__identity";

  const index = document.createElement("span");
  index.className = "linked-list-visualizer__index";
  index.textContent = `Node ${nodeIndex + 1}`;

  const objectId = document.createElement("code");
  objectId.className = "linked-list-visualizer__object-id";
  objectId.textContent = node.objectId;
  identity.append(index, objectId);

  const value = document.createElement("div");
  value.className = "linked-list-visualizer__value";

  const valueLabel = document.createElement("span");
  valueLabel.className = "linked-list-visualizer__field-label";
  valueLabel.textContent = "val";

  const valueCode = document.createElement("code");
  valueCode.textContent = formatValue(node.label ?? { type: "none", value: null });
  value.append(valueLabel, valueCode);

  const next = document.createElement("div");
  next.className = `linked-list-visualizer__next is-${node.nextStatus}`;
  next.dataset.nextStatus = node.nextStatus;

  const nextLabel = document.createElement("span");
  nextLabel.className = "linked-list-visualizer__field-label";
  nextLabel.textContent = "next";

  const nextCode = document.createElement("code");
  nextCode.textContent = nextTarget;
  next.append(nextLabel, nextCode);

  item.append(pointerRow, identity, value, next);
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

    orderedIds.forEach((objectId, index) => {
      const node = nodeById.get(objectId);
      if (!node) {
        return;
      }
      const nextNode = node.nextObjectId === null ? undefined : nodeById.get(node.nextObjectId);
      const nextTarget = node.nextObjectId === null
        ? "None"
        : node.nextObjectId;
      track.append(renderNode(
        node,
        index,
        pointersByNode.get(node.objectId) ?? [],
        nextTarget
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

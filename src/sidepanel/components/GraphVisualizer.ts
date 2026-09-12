import type {
  GraphEdgeVisual,
  GraphNodeVisual,
  GraphVisualModel
} from "../../core/graph-interpreter";
import { formatValue } from "./value-format";
import { appendPointerName } from "./pointer-label";
import {
  createSelectionInspector,
  inspectionTarget,
  type InspectionDetails
} from "./SelectionInspector";
import {
  layoutGraph,
  type GraphComponentLayout,
  type GraphLayoutConnection
} from "./graph-layout";

export interface GraphVisualizerHandle {
  element: HTMLElement;
  update(model: GraphVisualModel): void;
  dispose(): void;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function graphNodeLabel(node: GraphNodeVisual): string {
  return formatValue(node.label ?? { type: "none", value: null });
}

function renderPointerBadge(
  pointer: GraphVisualModel["pointers"][number]
): HTMLSpanElement {
  const badge = createTextElement(
    "span",
    `graph-visualizer__pointer is-${pointer.status}`,
    ""
  );
  appendPointerName(badge, pointer.variableName);
  badge.dataset.pointerName = pointer.variableName;
  badge.dataset.pointerStatus = pointer.status;
  badge.setAttribute("aria-label", `${pointer.variableName} pointer ${pointer.status}`);
  return badge;
}

function renderNode(
  node: GraphNodeVisual,
  pointers: GraphVisualModel["pointers"]
): HTMLDivElement {
  const item = document.createElement("div");
  item.className = `graph-visualizer__node is-${node.status}`;
  item.dataset.nodeId = node.objectId;
  item.dataset.nodeStatus = node.status;

  const pointerRow = document.createElement("div");
  pointerRow.className = "graph-visualizer__pointers";
  pointerRow.title = pointers.map((pointer) => pointer.variableName).join(", ");
  pointerRow.append(...pointers.map(renderPointerBadge));

  const button = inspectionTarget(
    document.createElement("button"),
    `node:${node.objectId}`,
    `Inspect Graph Node ${node.objectId}, value ${graphNodeLabel(node)}`
  );
  button.type = "button";
  button.className = "graph-visualizer__node-button";
  button.textContent = graphNodeLabel(node);
  button.dataset.nodeStatus = node.status;
  button.title = `Node ${graphNodeLabel(node)} · ${node.objectId}`;

  item.append(pointerRow, button);
  return item;
}

function connectionEdges(
  model: GraphVisualModel,
  connection: GraphLayoutConnection
): GraphEdgeVisual[] {
  return model.edges
    .filter((edge) => {
      if (connection.reciprocal) {
        return (
          edge.fromObjectId === connection.fromObjectId && edge.toObjectId === connection.toObjectId
        ) || (
          edge.fromObjectId === connection.reverseFromObjectId && edge.toObjectId === connection.reverseToObjectId
        );
      }
      return edge.fromObjectId === connection.fromObjectId && edge.toObjectId === connection.toObjectId;
    })
    .sort((left, right) =>
      left.fromObjectId.localeCompare(right.fromObjectId) ||
      left.toObjectId.localeCompare(right.toObjectId)
    );
}

function connectionStatus(edges: readonly GraphEdgeVisual[]): string {
  if (edges.some((edge) => edge.status === "added")) {
    return "added";
  }
  if (edges.some((edge) => edge.status === "removed")) {
    return "removed";
  }
  return "unchanged";
}

function renderConnection(
  connection: GraphLayoutConnection,
  model: GraphVisualModel,
  markerId: string
): SVGGElement {
  const group = document.createElementNS(SVG_NAMESPACE, "g");
  const edges = connectionEdges(model, connection);
  const status = connectionStatus(edges);
  group.classList.add("graph-visualizer__connection", `is-${status}`);
  group.dataset.connectionKey = connection.key;
  group.dataset.reciprocal = String(connection.reciprocal);
  group.dataset.edgeForward = `${connection.fromObjectId}→${connection.toObjectId}`;
  if (connection.reciprocal && connection.reverseFromObjectId && connection.reverseToObjectId) {
    group.dataset.edgeReverse = `${connection.reverseFromObjectId}→${connection.reverseToObjectId}`;
  }
  group.dataset.connectionStatus = status;

  const pathData = `M ${connection.x1} ${connection.y1} L ${connection.x2} ${connection.y2}`;
  const line = document.createElementNS(SVG_NAMESPACE, "path");
  line.classList.add("graph-visualizer__connection-line", `is-${status}`);
  line.setAttribute("d", pathData);
  line.setAttribute("fill", "none");
  if (!connection.reciprocal) {
    line.setAttribute("marker-end", `url(#${markerId})`);
  }

  const hit = document.createElementNS(SVG_NAMESPACE, "path");
  hit.classList.add("graph-visualizer__connection-hit");
  hit.setAttribute("d", pathData);
  hit.setAttribute("fill", "none");
  hit.setAttribute("stroke", "transparent");
  hit.setAttribute("stroke-width", "18");
  hit.setAttribute("pointer-events", "stroke");
  inspectionTarget(
    hit,
    `connection:${connection.key}`,
    connection.reciprocal
      ? `Inspect reciprocal connection ${connection.fromObjectId} to ${connection.toObjectId}`
      : `Inspect connection ${connection.fromObjectId} to ${connection.toObjectId}`
  );

  group.append(line, hit);
  return group;
}

function renderMarker(svg: SVGSVGElement, markerId: string): void {
  const defs = document.createElementNS(SVG_NAMESPACE, "defs");
  const marker = document.createElementNS(SVG_NAMESPACE, "marker");
  marker.id = markerId;
  marker.setAttribute("viewBox", "0 0 8 8");
  marker.setAttribute("refX", "7");
  marker.setAttribute("refY", "4");
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "8");
  marker.setAttribute("orient", "auto-start-reverse");
  const arrow = document.createElementNS(SVG_NAMESPACE, "path");
  arrow.setAttribute("d", "M 0 0 L 8 4 L 0 8 Z");
  arrow.setAttribute("fill", "currentColor");
  marker.append(arrow);
  defs.append(marker);
  svg.append(defs);
}

function renderComponent(
  component: GraphVisualModel["components"][number],
  layout: GraphComponentLayout,
  nodeById: ReadonlyMap<string, GraphNodeVisual>,
  pointersByNode: ReadonlyMap<string, GraphVisualModel["pointers"]>,
  model: GraphVisualModel,
  componentIndex: number
): HTMLElement {
  const section = document.createElement("section");
  section.className = `graph-visualizer__component is-${component.role}`;
  section.dataset.componentId = component.componentId;
  section.dataset.componentRole = component.role;
  section.setAttribute(
    "aria-label",
    component.role === "main" ? "Main graph component" : "Secondary graph component"
  );

  section.append(createTextElement(
    "h3",
    "graph-visualizer__component-title",
    `${component.role === "main" ? "Main graph" : "Secondary component"} · ${component.nodeIds.length} node${component.nodeIds.length === 1 ? "" : "s"}`
  ));

  const canvas = document.createElement("div");
  canvas.className = "graph-visualizer__canvas";
  canvas.dataset.layoutMode = layout.mode;
  canvas.style.width = `${Math.max(layout.width, 1)}px`;
  canvas.style.height = `${Math.max(layout.height, 1)}px`;

  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.classList.add("graph-visualizer__connections");
  svg.setAttribute("aria-label", `${component.componentId} connections`);
  svg.setAttribute("width", String(Math.max(layout.width, 1)));
  svg.setAttribute("height", String(Math.max(layout.height, 1)));
  svg.setAttribute("viewBox", `0 0 ${Math.max(layout.width, 1)} ${Math.max(layout.height, 1)}`);
  const markerId = `graph-arrow-${componentIndex}`;
  renderMarker(svg, markerId);
  svg.append(...layout.connections.map((connection) =>
    renderConnection(connection, model, markerId)
  ));

  const nodes = document.createElement("div");
  nodes.className = "graph-visualizer__nodes";
  const layoutById = new Map(layout.nodes.map((node) => [node.objectId, node]));
  for (const objectId of component.nodeIds.slice().sort((left, right) => left.localeCompare(right))) {
    const node = nodeById.get(objectId);
    const position = layoutById.get(objectId);
    if (!node || !position) {
      continue;
    }
    const item = renderNode(node, pointersByNode.get(objectId) ?? []);
    item.style.left = `${position.x}px`;
    item.style.top = `${position.y}px`;
    item.style.width = `${position.width}px`;
    item.style.height = `${position.height}px`;
    nodes.append(item);
  }

  canvas.append(svg, nodes);
  section.append(canvas);
  return section;
}

function renderNotices(model: GraphVisualModel): HTMLElement | null {
  const notices = document.createElement("div");
  notices.className = "graph-visualizer__notices";
  if (model.truncated) {
    notices.append(createTextElement(
      "div",
      "graph-visualizer__notice is-truncated",
      "Topology truncated"
    ));
  }
  if (model.nodes.some((node) => node.neighbors.some((neighbor) => neighbor.targetKind === "unresolved"))) {
    notices.append(createTextElement(
      "div",
      "graph-visualizer__notice is-unresolved",
      "Reference target not present in captured topology"
    ));
  }
  if (model.components.some((component) => component.role === "secondary")) {
    notices.append(createTextElement(
      "div",
      "graph-visualizer__notice is-secondary",
      "Secondary graph component present"
    ));
  }
  return notices.childElementCount > 0 ? notices : null;
}

function render(model: GraphVisualModel): HTMLElement {
  const section = document.createElement("section");
  section.className = "graph-visualizer";
  section.dataset.visualId = model.visualId;
  section.setAttribute("aria-label", "Graph visualization");

  const title = createTextElement("h2", "graph-visualizer__title", "Graph");
  const viewport = document.createElement("div");
  viewport.className = "graph-visualizer__viewport";

  const nodeById = new Map(model.nodes.map((node) => [node.objectId, node]));
  const pointersByNode = new Map<string, GraphVisualModel["pointers"]>();
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

  const layouts = layoutGraph(model);
  const componentById = new Map(model.components.map((component) => [component.componentId, component]));
  layouts.forEach((layout, index) => {
    const component = componentById.get(layout.componentId);
    if (component) {
      viewport.append(renderComponent(component, layout, nodeById, pointersByNode, model, index));
    }
  });

  const removedPointers = model.pointers.filter((pointer) => pointer.objectId === null);
  if (removedPointers.length > 0) {
    const removed = document.createElement("div");
    removed.className = "graph-visualizer__removed-pointers";
    removed.append(...removedPointers.map(renderPointerBadge));
    viewport.append(removed);
  }

  section.append(title, viewport);
  const notices = renderNotices(model);
  if (notices) {
    section.append(notices);
  }
  return section;
}

function preferredNodeKey(model: GraphVisualModel): string | undefined {
  const main = model.components.find((component) => component.role === "main");
  const objectId = main?.nodeIds.slice().sort((left, right) => left.localeCompare(right))[0]
    ?? model.nodes.slice().sort((left, right) => left.objectId.localeCompare(right.objectId))[0]?.objectId;
  return objectId ? `node:${objectId}` : undefined;
}

function nodeDetails(model: GraphVisualModel, key: string): InspectionDetails | null {
  if (!key.startsWith("node:")) {
    return null;
  }
  const objectId = key.slice("node:".length);
  const node = model.nodes.find((candidate) => candidate.objectId === objectId);
  if (!node) {
    return null;
  }
  const pointers = model.pointers.filter((pointer) => pointer.objectId === objectId);
  return {
    title: `Node ${graphNodeLabel(node)}`,
    fields: [
      ["value", graphNodeLabel(node)],
      ["object ID", node.objectId],
      ["status", node.status],
      ["pointers", pointers.map((pointer) => `${pointer.variableName} (${pointer.status})`).join(", ") || "None"],
      ["outgoing references", String(node.neighbors.length)],
      ["neighbors", node.neighbors.map((neighbor, index) =>
        `${index} → ${neighbor.objectId} (${neighbor.targetKind})`
      ).join("; ") || "None"]
    ]
  };
}

function connectionDetails(model: GraphVisualModel, key: string): InspectionDetails | null {
  if (!key.startsWith("connection:")) {
    return null;
  }
  const connectionKey = key.slice("connection:".length);
  const connection = layoutGraph(model)
    .flatMap((layout) => layout.connections)
    .find((candidate) => candidate.key === connectionKey);
  if (!connection) {
    return null;
  }
  const edges = connectionEdges(model, connection);
  return {
    title: "Connection",
    fields: [
      ...edges.map((edge) => [`${edge.fromObjectId} → ${edge.toObjectId}`, edge.status] as [string, string]),
      ["presentation", connection.reciprocal ? "reciprocal" : "directed"]
    ]
  };
}

export function createGraphVisualizer(initialModel: GraphVisualModel): GraphVisualizerHandle {
  const section = render(initialModel);
  let currentModel = initialModel;
  const inspector = createSelectionInspector(
    section,
    (key) => nodeDetails(currentModel, key) ?? connectionDetails(currentModel, key),
    { preferredFallbackKey: () => preferredNodeKey(currentModel) }
  );

  return {
    element: section,
    update(model) {
      const viewport = section.querySelector<HTMLElement>(".graph-visualizer__viewport");
      const scrollLeft = viewport?.scrollLeft ?? 0;
      const scrollTop = viewport?.scrollTop ?? 0;
      currentModel = model;
      const replacement = render(model);
      section.dataset.visualId = model.visualId;
      section.setAttribute("aria-label", "Graph visualization");
      section.replaceChildren(...Array.from(replacement.children));
      const updatedViewport = section.querySelector<HTMLElement>(".graph-visualizer__viewport");
      if (updatedViewport) {
        updatedViewport.scrollLeft = scrollLeft;
        updatedViewport.scrollTop = scrollTop;
      }
      inspector.refresh();
    },
    dispose() {
      inspector.dispose();
    }
  };
}

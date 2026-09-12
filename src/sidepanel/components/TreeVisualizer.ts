import { appendPointerName } from "./pointer-label";
import type {
  TreeNodeVisual,
  TreeVisualModel
} from "../../core/tree-interpreter";
import { formatValue } from "./value-format";
import {
  layoutTree,
  type TreeComponentLayout,
  type TreeLayoutEdge
} from "./tree-layout";
import {
  createSelectionInspector,
  inspectionTarget
} from "./SelectionInspector";

export interface TreeVisualizerHandle {
  element: HTMLElement;
  update(model: TreeVisualModel): void;
  dispose(): void;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

type TreeField = "left" | "right";

function fieldObjectId(node: TreeNodeVisual, field: TreeField): string | null {
  return field === "left" ? node.leftObjectId : node.rightObjectId;
}

function fieldTargetKind(node: TreeNodeVisual, field: TreeField): TreeNodeVisual["leftTargetKind"] {
  return field === "left" ? node.leftTargetKind : node.rightTargetKind;
}

function fieldStatus(node: TreeNodeVisual, field: TreeField): TreeNodeVisual["leftStatus"] {
  return field === "left" ? node.leftStatus : node.rightStatus;
}

function fieldTargetLabel(node: TreeNodeVisual, field: TreeField): string {
  const objectId = fieldObjectId(node, field);
  return objectId === null ? "None" : objectId;
}

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

function renderPointerBadge(
  pointer: TreeVisualModel["pointers"][number]
): HTMLSpanElement {
  const badge = createTextElement(
    "span",
    `tree-visualizer__pointer is-${pointer.status}`,
    ""
  );
  appendPointerName(badge, pointer.variableName);
  badge.dataset.pointerName = pointer.variableName;
  badge.dataset.pointerStatus = pointer.status;
  badge.setAttribute("aria-label", `${pointer.variableName} pointer ${pointer.status}`);
  return badge;
}

function renderField(
  node: TreeNodeVisual,
  field: TreeField
): HTMLDivElement {
  const row = createTextElement("div", `tree-visualizer__field is-${fieldStatus(node, field)}`, "");
  row.dataset.field = field;
  row.dataset.fieldStatus = fieldStatus(node, field);
  row.append(
    createTextElement("span", "tree-visualizer__field-label", field),
    createTextElement("code", "tree-visualizer__field-value", fieldTargetLabel(node, field))
  );
  return row;
}

function renderNode(
  node: TreeNodeVisual,
  pointers: TreeVisualModel["pointers"]
): HTMLDivElement {
  const item = document.createElement("div");
  item.className = `tree-visualizer__node is-${node.status}`;
  item.dataset.nodeId = node.objectId;
  item.dataset.nodeStatus = node.status;

  const button = inspectionTarget(
    createTextElement("button", "tree-visualizer__node-button", formatValue(node.label ?? undefined)),
    `node:${node.objectId}`,
    `Inspect TreeNode ${node.objectId}, value ${formatValue(node.label ?? undefined)}`
  );
  button.type = "button";
  button.dataset.valueStatus = node.valueStatus;
  const hasTerminal = (["left", "right"] as const).some((field) =>
    fieldTargetKind(node, field) === "external" || fieldTargetKind(node, field) === "unresolved" ||
    fieldStatus(node, field) === "removed");
  if (hasTerminal) {
    item.classList.add("has-terminal");
    button.title = "Select to inspect changed or uncaptured references";
  }

  const pointerRow = document.createElement("div");
  pointerRow.className = "tree-visualizer__pointers";
  pointerRow.append(...pointers.map(renderPointerBadge));
  pointerRow.title = pointers.map((pointer) => pointer.variableName).join(", ");

  const value = document.createElement("div");
  value.className = `tree-visualizer__value is-${node.valueStatus}`;
  value.dataset.valueStatus = node.valueStatus;
  value.append(
    createTextElement("span", "tree-visualizer__field-label", "val"),
    createTextElement("code", "tree-visualizer__value-code", formatValue(node.label ?? undefined))
  );

  const identity = document.createElement("div");
  identity.className = "tree-visualizer__identity";
  identity.append(
    createTextElement("span", "tree-visualizer__identity-label", "TreeNode"),
    createTextElement("code", "tree-visualizer__object-id", node.objectId)
  );

  const details = document.createElement("div");
  details.className = "tree-visualizer__node-details";
  details.hidden = true;
  details.append(value, identity, renderField(node, "left"), renderField(node, "right"));
  item.append(pointerRow, button, details);
  return item;
}

function renderInternalEdge(
  edge: TreeLayoutEdge,
  nodeById: Map<string, TreeNodeVisual>
): SVGLineElement {
  const line = document.createElementNS(SVG_NAMESPACE, "line");
  const source = nodeById.get(edge.fromObjectId)!;
  const status = fieldStatus(source, edge.field);
  line.classList.add("tree-visualizer__edge", `is-${status}`);
  line.dataset.edgeFrom = edge.fromObjectId;
  line.dataset.edgeTo = edge.toObjectId;
  line.dataset.edgeField = edge.field;
  line.dataset.edgeStatus = status;
  line.dataset.edgeTargetKind = "tree_node";
  line.setAttribute("x1", String(edge.x1));
  line.setAttribute("y1", String(edge.y1));
  line.setAttribute("x2", String(edge.x2));
  line.setAttribute("y2", String(edge.y2));
  return line;
}

function renderTerminal(
  node: TreeNodeVisual,
  field: TreeField
): HTMLDivElement | null {
  const targetKind = fieldTargetKind(node, field);
  const status = fieldStatus(node, field);
  if (targetKind === "tree_node" || targetKind === "none" && status !== "removed") {
    return null;
  }

  const target = fieldObjectId(node, field);
  const marker = createTextElement("div", `tree-visualizer__terminal is-${status}`, "");
  marker.dataset.edgeFrom = node.objectId;
  marker.dataset.edgeTo = target ?? "None";
  marker.dataset.edgeField = field;
  marker.dataset.edgeStatus = status;
  marker.dataset.edgeTargetKind = targetKind;

  const targetText = targetKind === "none"
    ? "None"
    : targetKind === "unresolved"
      ? `${target} (target not present in captured topology)`
      : `${target} (external)`;
  marker.textContent = `${field} → ${targetText}`;
  return marker;
}

function centerMainEntry(
  viewport: HTMLElement,
  model: TreeVisualModel,
  layouts: TreeComponentLayout[]
): void {
  const mainComponent = model.components.find((component) => component.role === "main");
  if (!mainComponent || viewport.clientWidth <= 0) {
    return;
  }

  const layout = layouts.find((candidate) => candidate.componentId === mainComponent.componentId);
  const entryObjectId = mainComponent.entryNodeIds[0] ?? mainComponent.nodeIds[0];
  const entry = layout?.nodes.find((node) => node.objectId === entryObjectId);
  if (!entry) {
    return;
  }

  const target = entry.x + entry.width / 2 - viewport.clientWidth / 2;
  viewport.scrollLeft = Math.max(0, target);
}

function renderComponent(
  component: TreeVisualModel["components"][number],
  layout: TreeComponentLayout,
  nodeById: Map<string, TreeNodeVisual>,
  pointersByNode: Map<string, TreeVisualModel["pointers"]>
): HTMLElement {
  const section = document.createElement("section");
  section.className = `tree-visualizer__component is-${component.role}`;
  section.dataset.componentId = component.componentId;
  section.dataset.componentRole = component.role;
  section.setAttribute(
    "aria-label",
    component.role === "main" ? "Main tree component" : "Detached TreeNode component"
  );

  const heading = createTextElement(
    "h3",
    "tree-visualizer__component-title",
    component.role === "main" ? "Main tree" : "Detached component"
  );
  section.append(heading);

  const canvas = document.createElement("div");
  canvas.className = "tree-visualizer__canvas";
  canvas.dataset.layoutMode = layout.mode;
  canvas.style.setProperty("--pointer-band-height", `${(layout.nodes[0]?.height ?? 68) - 44}px`);
  canvas.style.width = `${Math.max(layout.width, 1)}px`;
  canvas.style.height = `${Math.max(layout.height, 1)}px`;

  const edges = document.createElementNS(SVG_NAMESPACE, "svg");
  edges.classList.add("tree-visualizer__edges");
  edges.setAttribute("aria-hidden", "true");
  edges.setAttribute("width", String(Math.max(layout.width, 1)));
  edges.setAttribute("height", String(Math.max(layout.height, 1)));
  edges.setAttribute("viewBox", `0 0 ${Math.max(layout.width, 1)} ${Math.max(layout.height, 1)}`);
  edges.append(...layout.edges.map((edge) => renderInternalEdge(edge, nodeById)));

  const nodesLayer = document.createElement("div");
  nodesLayer.className = "tree-visualizer__nodes";
  const layoutById = new Map(layout.nodes.map((node) => [node.objectId, node]));
  for (const nodeId of component.nodeIds.slice().sort((left, right) => left.localeCompare(right))) {
    const node = nodeById.get(nodeId);
    const position = layoutById.get(nodeId);
    if (!node || !position) {
      continue;
    }
    const item = renderNode(node, pointersByNode.get(node.objectId) ?? []);
    item.style.left = `${position.x}px`;
    item.style.top = `${position.y}px`;
    item.style.width = `${position.width}px`;
    item.style.minHeight = `${position.height}px`;
    nodesLayer.append(item);

    for (const field of ["left", "right"] as const) {
      const terminal = renderTerminal(node, field);
      if (terminal) {
        item.querySelector(".tree-visualizer__node-details")!.append(terminal);
      }
    }
  }

  canvas.append(edges, nodesLayer);
  section.append(canvas);
  return section;
}

function incomingCounts(model: TreeVisualModel): Map<string, number> {
  const incoming = new Map(model.nodes.map((node) => [node.objectId, 0]));
  for (const node of model.nodes) {
    for (const field of ["left", "right"] as const) {
      const target = fieldObjectId(node, field);
      if (fieldTargetKind(node, field) === "tree_node" && target !== null && incoming.has(target)) {
        incoming.set(target, (incoming.get(target) ?? 0) + 1);
      }
    }
  }
  return incoming;
}

function renderNotices(model: TreeVisualModel): HTMLDivElement | null {
  const notices = document.createElement("div");
  notices.className = "tree-visualizer__notices";
  const incoming = incomingCounts(model);
  for (const component of model.components) {
    if (component.cyclic) {
      notices.append(createTextElement(
        "div",
        "tree-visualizer__notice is-cycle",
        "Cycle detected in TreeNode references"
      ));
    }
    for (const objectId of component.sharedChildNodeIds.slice().sort((left, right) => left.localeCompare(right))) {
      notices.append(createTextElement(
        "div",
        "tree-visualizer__notice is-shared",
        `Shared child: ${objectId} has ${incoming.get(objectId) ?? 0} incoming TreeNode references`
      ));
    }
  }
  if (model.truncated) {
    notices.append(createTextElement(
      "div",
      "tree-visualizer__notice is-truncated",
      "Topology truncated"
    ));
  }
  return notices.childElementCount > 0 ? notices : null;
}

function render(model: TreeVisualModel): HTMLElement {
  const section = document.createElement("section");
  section.className = "tree-visualizer";
  section.dataset.visualId = model.visualId;
  section.setAttribute("aria-label", "TreeNode visualization");

  const title = createTextElement("h2", "tree-visualizer__title", "TreeNode");
  const viewport = document.createElement("div");
  viewport.className = "tree-visualizer__viewport";

  const nodeById = new Map(model.nodes.map((node) => [node.objectId, node]));
  const pointersByNode = new Map<string, TreeVisualModel["pointers"]>();
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

  const layouts = layoutTree(model);
  const componentById = new Map(model.components.map((component) => [component.componentId, component]));
  for (const layout of layouts) {
    const component = componentById.get(layout.componentId);
    if (component) {
      viewport.append(renderComponent(component, layout, nodeById, pointersByNode));
    }
  }

  const removedPointers = model.pointers.filter((pointer) => pointer.objectId === null);
  if (removedPointers.length > 0) {
    const removed = document.createElement("div");
    removed.className = "tree-visualizer__removed-pointers";
    for (const pointer of removedPointers) {
      removed.append(renderPointerBadge(pointer));
    }
    viewport.append(removed);
  }

  section.append(title, viewport);
  centerMainEntry(viewport, model, layouts);
  const notices = renderNotices(model);
  if (notices) {
    section.append(notices);
  }
  return section;
}

function centerRenderedMainEntry(section: HTMLElement, model: TreeVisualModel): void {
  const viewport = section.querySelector<HTMLElement>(".tree-visualizer__viewport");
  if (viewport) {
    centerMainEntry(viewport, model, layoutTree(model));
  }
}

export function createTreeVisualizer(initialModel: TreeVisualModel): TreeVisualizerHandle {
  const section = render(initialModel);
  let currentModel = initialModel;
  const inspector = createSelectionInspector(
    section,
    (key) => {
      if (!key.startsWith("node:")) {
        return null;
      }
      const objectId = key.slice("node:".length);
      const node = currentModel.nodes.find((candidate) => candidate.objectId === objectId);
      if (!node) {
        return null;
      }
      const pointers = currentModel.pointers.filter((pointer) => pointer.objectId === objectId);
      return {
        title: node.className,
        fields: [
          ["val", formatValue(node.label ?? undefined)],
          ["object ID", node.objectId],
          ["status", node.status],
          ["pointers", pointers.map((pointer) => `${pointer.variableName} (${pointer.status})`).join(", ") || "None"],
          ["left", node.leftObjectId ?? "None"],
          ["right", node.rightObjectId ?? "None"]
        ]
      };
    },
    {
      preferredFallbackKey: () => {
        const main = currentModel.components.find((component) => component.role === "main");
        const objectId = main?.entryNodeIds[0] ?? main?.nodeIds[0] ?? currentModel.nodes[0]?.objectId;
        return objectId ? `node:${objectId}` : undefined;
      }
    }
  );
  section.querySelector(".visualizer-inspector")?.classList.add("tree-visualizer__inspector");
  let centeringFrame: number | null = null;

  const centerAfterMount = (): void => {
    centeringFrame = null;
    centerRenderedMainEntry(section, currentModel);
  };

  const scheduleCenterAfterMount = (): void => {
    if (centeringFrame !== null) {
      window.cancelAnimationFrame(centeringFrame);
    }
    if (typeof window.requestAnimationFrame === "function") {
      centeringFrame = window.requestAnimationFrame(centerAfterMount);
    } else {
      queueMicrotask(centerAfterMount);
    }
  };

  scheduleCenterAfterMount();

  return {
    element: section,
    update(model) {
      currentModel = model;
      const previousViewport = section.querySelector<HTMLElement>(".tree-visualizer__viewport");
      const scrollLeft = previousViewport?.scrollLeft ?? 0;
      const scrollTop = previousViewport?.scrollTop ?? 0;
      const replacement = render(model);
      section.dataset.visualId = model.visualId;
      section.setAttribute("aria-label", "TreeNode visualization");
      section.replaceChildren(...Array.from(replacement.children));
      const viewport = section.querySelector<HTMLElement>(".tree-visualizer__viewport")!;
      viewport.scrollLeft = scrollLeft;
      viewport.scrollTop = scrollTop;
      inspector.refresh();
    },
    dispose() {
      if (centeringFrame !== null) {
        window.cancelAnimationFrame(centeringFrame);
        centeringFrame = null;
      }
      inspector.dispose();
    }
  };
}

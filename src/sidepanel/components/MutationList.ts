import type {
  ReferenceMutation,
  RuntimeMutation
} from "../../core/runtime-mutation";
import { formatValue } from "./value-format";

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function referenceOwnerLabel(mutation: ReferenceMutation): string {
  return mutation.owner.scope === "local"
    ? mutation.owner.variableName
    : `${mutation.owner.objectId}.${mutation.owner.attribute}`;
}

function mutationLabel(mutation: RuntimeMutation): string {
  switch (mutation.kind) {
    case "variable":
      return mutation.variableName;
    case "reference":
      return referenceOwnerLabel(mutation);
    case "sequence_element":
      return `${mutation.containerName}[${mutation.index}]`;
    case "mapping_entry":
      return `${mutation.containerName}[${formatValue(mutation.key)}]`;
    case "set_membership":
      return `${mutation.containerName} · ${formatValue(mutation.member)}`;
    case "object_attribute":
      return `${mutation.objectId}.${mutation.attribute}`;
    case "object_visibility":
      return mutation.objectId;
  }
}

function changeText(
  action: "added" | "removed" | "changed",
  before: Parameters<typeof formatValue>[0],
  after: Parameters<typeof formatValue>[0]
): string {
  if (action === "changed") {
    return `${formatValue(before)} → ${formatValue(after)}`;
  }
  if (action === "added") {
    return `+ ${formatValue(after)}`;
  }
  return `− ${formatValue(before)}`;
}

function mutationValue(mutation: RuntimeMutation): string {
  switch (mutation.kind) {
    case "variable":
    case "sequence_element":
    case "mapping_entry":
    case "object_attribute":
      return changeText(mutation.action, mutation.before, mutation.after);
    case "reference":
      if (mutation.action === "redirected") {
        return `${mutation.beforeObjectId ?? "—"} → ${mutation.afterObjectId ?? "—"}`;
      }
      return mutation.action === "bound"
        ? `+ ${mutation.afterObjectId ?? "—"}`
        : `− ${mutation.beforeObjectId ?? "—"}`;
    case "set_membership":
      return mutation.action;
    case "object_visibility":
      return mutation.action === "appeared"
        ? "appeared in captured topology"
        : "disappeared from captured topology";
  }
}

function renderMutation(mutation: RuntimeMutation): HTMLDivElement {
  const row = createElement("div", `trace-viewer__mutation-row is-${mutation.kind}`);
  row.dataset.mutationKind = mutation.kind;
  row.dataset.mutationOrigin = mutation.origin;
  row.append(
    createElement("span", "trace-viewer__mutation-name", mutationLabel(mutation)),
    createElement("code", "trace-viewer__mutation-value", mutationValue(mutation))
  );
  if (mutation.origin === "initial_snapshot") {
    row.append(createElement(
      "span",
      "trace-viewer__mutation-origin",
      "initial observation"
    ));
  }
  return row;
}

export function createMutationList(mutations: RuntimeMutation[]): HTMLDivElement {
  const body = createElement("div", "trace-viewer__mutations");
  if (mutations.length === 0) {
    body.append(createElement(
      "div",
      "trace-viewer__empty",
      "No observed state change at this step."
    ));
    return body;
  }

  if (mutations.every((mutation) => mutation.origin === "initial_snapshot")) {
    body.append(createElement(
      "div",
      "trace-viewer__mutation-group-title",
      "Initial observations"
    ));
  }
  body.append(...mutations.map(renderMutation));
  return body;
}

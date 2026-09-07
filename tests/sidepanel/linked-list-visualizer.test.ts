import { describe, expect, it } from "vitest";

import type {
  LinkedListNodeVisual,
  LinkedListVisualModel
} from "../../src/core/linked-list-interpreter";
import type { ValueSnapshot } from "../../src/shared/trace-types";
import { createLinkedListVisualizer } from "../../src/sidepanel/components/LinkedListVisualizer";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function nodeVisual(
  objectId: string,
  value: number,
  nextObjectId: string | null
): LinkedListNodeVisual {
  return {
    objectId,
    className: "ListNode",
    label: int(value),
    nextObjectId,
    status: "unchanged",
    nextStatus: "unchanged"
  };
}

function model(overrides: Partial<LinkedListVisualModel> = {}): LinkedListVisualModel {
  return {
    kind: "linked_list",
    visualId: "linked_list:obj-1",
    nodes: [nodeVisual("obj-1", 1, "obj-2"), nodeVisual("obj-2", 2, null)],
    components: [{
      componentId: "component:obj-1",
      nodeIds: ["obj-1", "obj-2"],
      entryNodeIds: ["obj-1"]
    }],
    pointers: [],
    cyclic: false,
    truncated: false,
    ...overrides
  };
}

describe("createLinkedListVisualizer", () => {
  it("orders nodes by next edges and renders visible connectors to the terminal", () => {
    const handle = createLinkedListVisualizer(model({
      nodes: [
        nodeVisual("obj-2", 2, "obj-3"),
        nodeVisual("obj-1", 1, "obj-2"),
        nodeVisual("obj-3", 3, null)
      ],
      components: [{
        componentId: "component:obj-1",
        nodeIds: ["obj-2", "obj-1", "obj-3"],
        entryNodeIds: ["obj-1"]
      }]
    }));

    expect([...handle.element.querySelectorAll<HTMLElement>("[data-node-id]")]
      .map((item) => item.dataset.nodeId)).toEqual(["obj-1", "obj-2", "obj-3"]);

    expect([...handle.element.querySelectorAll<HTMLElement>("[data-edge-from]")]
      .map((item) => [item.dataset.edgeFrom, item.dataset.edgeTo])).toEqual([
      ["obj-1", "obj-2"],
      ["obj-2", "obj-3"],
      ["obj-3", "None"]
    ]);
    expect(handle.element.querySelector('[data-edge-from="obj-1"]')?.textContent)
      .toContain("next");
    expect(handle.element.querySelector('[data-terminal="None"]')).not.toBeNull();
  });

  it("renders non-linear next targets as explicit cycle or dangling edges", () => {
    const cycleHandle = createLinkedListVisualizer(model({
      nodes: [nodeVisual("obj-1", 1, "obj-2"), nodeVisual("obj-2", 2, "obj-1")],
      components: [{
        componentId: "component:obj-1",
        nodeIds: ["obj-1", "obj-2"],
        entryNodeIds: []
      }],
      cyclic: true
    }));

    expect(cycleHandle.element.querySelector(
      '[data-edge-from="obj-2"][data-edge-to="obj-1"][data-edge-kind="cycle"]'
    )).not.toBeNull();

    const danglingHandle = createLinkedListVisualizer(model({
      nodes: [nodeVisual("obj-1", 1, "obj-missing")],
      components: [{
        componentId: "component:obj-1",
        nodeIds: ["obj-1"],
        entryNodeIds: ["obj-1"]
      }],
      truncated: true
    }));

    expect(danglingHandle.element.querySelector(
      '[data-edge-from="obj-1"][data-edge-to="obj-missing"][data-edge-kind="dangling"]'
    )).not.toBeNull();
  });

  it("does not label a shared tail as a cycle", () => {
    const handle = createLinkedListVisualizer(model({
      nodes: [
        nodeVisual("obj-1", 1, "obj-3"),
        nodeVisual("obj-2", 2, "obj-3"),
        nodeVisual("obj-3", 3, null)
      ],
      components: [{
        componentId: "component:obj-1",
        nodeIds: ["obj-1", "obj-2", "obj-3"],
        entryNodeIds: ["obj-1", "obj-2"]
      }]
    }));

    expect(handle.element.querySelector(
      '[data-edge-from="obj-2"][data-edge-to="obj-3"][data-edge-kind="branch"]'
    )).not.toBeNull();
    expect(handle.element.querySelector(
      '[data-edge-from="obj-2"][data-edge-kind="cycle"]'
    )).toBeNull();
  });

  it("only labels edges that belong to a cycle when a component has an incoming branch", () => {
    const handle = createLinkedListVisualizer(model({
      nodes: [
        nodeVisual("obj-1", 1, "obj-2"),
        nodeVisual("obj-2", 2, "obj-3"),
        nodeVisual("obj-3", 3, "obj-2"),
        nodeVisual("obj-4", 4, "obj-3")
      ],
      components: [{
        componentId: "component:obj-1",
        nodeIds: ["obj-1", "obj-2", "obj-3", "obj-4"],
        entryNodeIds: ["obj-1", "obj-4"]
      }],
      cyclic: true
    }));

    expect(handle.element.querySelector(
      '[data-edge-from="obj-3"][data-edge-to="obj-2"][data-edge-kind="cycle"]'
    )).not.toBeNull();
    expect(handle.element.querySelector(
      '[data-edge-from="obj-4"][data-edge-to="obj-3"][data-edge-kind="branch"]'
    )).not.toBeNull();
  });

  it("renders nodes, pointer aliases, next links, and mutation markers", () => {
    const handle = createLinkedListVisualizer(model({
      nodes: [
        nodeVisual("obj-1", 1, "obj-2"),
        { ...nodeVisual("obj-2", 2, null), nextStatus: "changed" }
      ],
      pointers: [
        { variableName: "head", objectId: "obj-1", status: "unchanged" },
        { variableName: "curr", objectId: "obj-2", status: "moved" },
        { variableName: "slow", objectId: "obj-2", status: "unchanged" }
      ]
    }));

    expect(handle.element.dataset.visualId).toBe("linked_list:obj-1");
    expect(handle.element.querySelectorAll("[data-node-id]")).toHaveLength(2);
    expect(handle.element.querySelector('[data-node-id="obj-2"]')?.textContent).toContain("curr");
    expect(handle.element.querySelector('[data-node-id="obj-2"]')?.textContent).toContain("slow");
    expect(handle.element.querySelector('[data-next-status="changed"]')).not.toBeNull();
  });

  it("renders disconnected component rows in deterministic order", () => {
    const handle = createLinkedListVisualizer(model({
      nodes: [nodeVisual("obj-1", 1, null), nodeVisual("obj-2", 2, null)],
      components: [
        { componentId: "component:obj-1", nodeIds: ["obj-1"], entryNodeIds: ["obj-1"] },
        { componentId: "component:obj-2", nodeIds: ["obj-2"], entryNodeIds: ["obj-2"] }
      ]
    }));

    expect([...handle.element.querySelectorAll<HTMLElement>("[data-component-id]")]
      .map((item) => item.dataset.componentId)).toEqual([
      "component:obj-1",
      "component:obj-2"
    ]);
  });

  it("shows cycle and truncation indicators", () => {
    const handle = createLinkedListVisualizer(model({ cyclic: true, truncated: true }));

    expect(handle.element.querySelector('[data-cycle-indicator="true"]')?.textContent)
      .toContain("cycle");
    expect(handle.element.querySelector('[data-truncated="true"]')?.textContent)
      .toContain("Topology truncated");
  });

  it("removes stale nodes when a stable visual is updated", () => {
    const handle = createLinkedListVisualizer(model());

    handle.update(model({
      nodes: [nodeVisual("obj-1", 1, null)],
      components: [{
        componentId: "component:obj-1",
        nodeIds: ["obj-1"],
        entryNodeIds: ["obj-1"]
      }]
    }));

    expect(handle.element.querySelectorAll("[data-node-id]")).toHaveLength(1);
    expect(handle.element.querySelector('[data-node-id="obj-2"]')).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import type { ListVisualModel } from "../../src/core/visual-model";
import type { ValueSnapshot } from "../../src/shared/trace-types";
import { renderListVisualizer } from "../../src/sidepanel/components/ListVisualizer";

const int = (value: number): ValueSnapshot => ({
  type: "int",
  value: String(value)
});

function model(overrides: Partial<ListVisualModel> = {}): ListVisualModel {
  return {
    kind: "list",
    variableName: "nums",
    items: [int(2), int(7), int(11), int(15)],
    pointers: [
      { name: "left", index: 1, outOfBounds: false },
      { name: "right", index: 3, outOfBounds: false }
    ],
    changedIndexes: [],
    ...overrides
  };
}

describe("renderListVisualizer", () => {
  it("renders list values, indexes, and pointers on their matching items", () => {
    const view = renderListVisualizer(model());

    expect(view.textContent).toContain("nums");
    expect(view.querySelectorAll("[data-list-item-index]")).toHaveLength(4);
    expect(view.querySelector('[data-list-item-index="0"]')?.textContent).toContain("2");
    expect(view.querySelector('[data-list-item-index="3"]')?.textContent).toContain("3");

    const leftPointer = view.querySelector('[data-pointer-name="left"]');
    const rightPointer = view.querySelector('[data-pointer-name="right"]');
    expect(leftPointer?.closest("[data-list-item-index]")?.getAttribute("data-list-item-index"))
      .toBe("1");
    expect(rightPointer?.closest("[data-list-item-index]")?.getAttribute("data-list-item-index"))
      .toBe("3");
  });

  it("marks every item whose index is reported as changed", () => {
    const view = renderListVisualizer(model({ changedIndexes: [0, 2] }));

    expect(view.querySelector('[data-list-item-index="0"]')?.classList.contains("is-changed"))
      .toBe(true);
    expect(view.querySelector('[data-list-item-index="2"]')?.classList.contains("is-changed"))
      .toBe(true);
    expect(view.querySelector('[data-list-item-index="1"]')?.classList.contains("is-changed"))
      .toBe(false);
  });

  it("keeps an out-of-bounds pointer visible as a requested index", () => {
    const view = renderListVisualizer(model({
      pointers: [{ name: "left", index: 5, outOfBounds: true }]
    }));

    const requested = view.querySelector('[data-requested-index="5"]');
    expect(requested).not.toBeNull();
    expect(requested?.textContent).toContain("requested");
    expect(requested?.querySelector('[data-pointer-name="left"]')).not.toBeNull();
    expect(view.textContent).toContain("left");
  });
});

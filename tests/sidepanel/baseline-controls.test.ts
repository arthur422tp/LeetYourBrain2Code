import { describe, expect, it, vi } from "vitest";

import {
  createBaselineControls,
  type BaselineControlsModel
} from "../../src/sidepanel/components/BaselineControls";

function model(overrides: Partial<BaselineControlsModel> = {}): BaselineControlsModel {
  return {
    hasCurrent: false,
    hasBaseline: false,
    sourceDiffers: false,
    ...overrides
  };
}

describe("BaselineControls", () => {
  it("keeps a persistent handle and disables pinning without an accepted run", () => {
    const onPin = vi.fn();
    const handle = createBaselineControls({
      model: model(),
      onPin,
      onReplace: vi.fn(),
      onClear: vi.fn()
    });

    const element = handle.element;
    const pin = element.querySelector<HTMLButtonElement>("#baseline-pin")!;
    expect(pin.disabled).toBe(true);
    expect(element.textContent).toContain("Pin baseline");

    handle.update(model({ hasCurrent: true }));
    expect(handle.element).toBe(element);
    expect(pin.disabled).toBe(false);
    pin.click();
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  it("renders pinned metadata and invokes replace or clear without correctness labels", () => {
    const onReplace = vi.fn();
    const onClear = vi.fn();
    const handle = createBaselineControls({
      model: model({
        hasCurrent: true,
        hasBaseline: true,
        caseLabel: "Case 2",
        baselineStatus: "timeout",
        sourceDiffers: true
      }),
      onPin: vi.fn(),
      onReplace,
      onClear
    });

    expect(handle.element.textContent).toContain("Baseline pinned · Case 2");
    expect(handle.element.textContent).toContain("timeout");
    expect(handle.element.textContent).toContain("Source differs from baseline");
    expect(handle.element.textContent?.toLowerCase()).not.toMatch(/good|correct|passing|expected/);

    handle.element.querySelector<HTMLButtonElement>("#baseline-replace")?.click();
    handle.element.querySelector<HTMLButtonElement>("#baseline-clear")?.click();
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("keeps clear available while disabling replace when there is no current run", () => {
    const handle = createBaselineControls({
      model: model({ hasBaseline: true, caseLabel: "Case 1" }),
      onPin: vi.fn(),
      onReplace: vi.fn(),
      onClear: vi.fn()
    });

    expect(handle.element.querySelector<HTMLButtonElement>("#baseline-replace")?.disabled).toBe(true);
    expect(handle.element.querySelector<HTMLButtonElement>("#baseline-clear")?.disabled).toBe(false);
  });
});

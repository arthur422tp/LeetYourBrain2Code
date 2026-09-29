import { describe, expect, it, vi } from "vitest";

import {
  createCaseComparisonControls,
  type CaseComparisonControlsModel
} from "../../src/sidepanel/components/CaseComparisonControls";

function model(overrides: Partial<CaseComparisonControlsModel> = {}): CaseComparisonControlsModel {
  return {
    hasCurrent: false,
    currentCaseIndex: null,
    caseAIndex: null,
    caseBIndex: null,
    ...overrides
  };
}

describe("CaseComparisonControls", () => {
  it("disables selection without an accepted current run", () => {
    const handle = createCaseComparisonControls({
      model: model(),
      onSelectLeft: vi.fn(),
      onSelectRight: vi.fn(),
      onClear: vi.fn()
    });

    expect(handle.element.querySelector<HTMLButtonElement>("#case-comparison-select-left")?.disabled).toBe(true);
    expect(handle.element.querySelector<HTMLButtonElement>("#case-comparison-select-right")?.disabled).toBe(true);
    expect(handle.element.textContent).toContain("Current: No accepted run");
    handle.dispose();
  });

  it("shows the current Case and selects it as Case A", () => {
    const onSelectLeft = vi.fn();
    const handle = createCaseComparisonControls({
      model: model({ hasCurrent: true, currentCaseIndex: 0 }),
      onSelectLeft,
      onSelectRight: vi.fn(),
      onClear: vi.fn()
    });

    expect(handle.element.textContent).toContain("Current: Case 1");
    handle.element.querySelector<HTMLButtonElement>("#case-comparison-select-left")?.click();

    expect(onSelectLeft).toHaveBeenCalledOnce();
    handle.dispose();
  });

  it("updates the current Case without mutating the selected Case A", () => {
    const handle = createCaseComparisonControls({
      model: model({ hasCurrent: true, currentCaseIndex: 0, caseAIndex: 0 }),
      onSelectLeft: vi.fn(),
      onSelectRight: vi.fn(),
      onClear: vi.fn()
    });

    handle.update(model({ hasCurrent: true, currentCaseIndex: 2, caseAIndex: 0 }));

    expect(handle.element.textContent).toContain("Current: Case 3");
    expect(handle.element.textContent).toContain("Case A: Case 1");
    expect(handle.element.textContent).not.toContain("Case A: Case 3");
    handle.dispose();
  });

  it("compares the current Case with Case A when explicitly requested", () => {
    const onSelectRight = vi.fn();
    const handle = createCaseComparisonControls({
      model: model({ hasCurrent: true, currentCaseIndex: 2, caseAIndex: 0 }),
      onSelectLeft: vi.fn(),
      onSelectRight,
      onClear: vi.fn()
    });

    const compare = handle.element.querySelector<HTMLButtonElement>("#case-comparison-select-right")!;
    expect(compare.disabled).toBe(false);
    compare.click();

    expect(onSelectRight).toHaveBeenCalledOnce();
    handle.dispose();
  });

  it("shows actionable guidance for the same Case and different source", () => {
    const handle = createCaseComparisonControls({
      model: model({
        hasCurrent: true,
        currentCaseIndex: 0,
        caseAIndex: 0,
        compatibility: { status: "same_case" }
      }),
      onSelectLeft: vi.fn(),
      onSelectRight: vi.fn(),
      onClear: vi.fn()
    });
    expect(handle.element.textContent).toContain("Select a different Case before comparing.");

    handle.update(model({
      hasCurrent: true,
      currentCaseIndex: 2,
      caseAIndex: 0,
      compatibility: { status: "different_source" }
    }));
    expect(handle.element.textContent).toContain("Run both Cases again with the same code.");
    handle.dispose();
  });

  it("clears explicitly and keeps actions as keyboard-accessible buttons", () => {
    const onClear = vi.fn();
    const handle = createCaseComparisonControls({
      model: model({ hasCurrent: true, currentCaseIndex: 2, caseAIndex: 0, caseBIndex: 2 }),
      onSelectLeft: vi.fn(),
      onSelectRight: vi.fn(),
      onClear
    });

    const buttons = [...handle.element.querySelectorAll("button")];
    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => button.type === "button")).toBe(true);
    expect(handle.element.querySelector("select")).toBeNull();
    handle.element.querySelector<HTMLButtonElement>("#case-comparison-clear")?.click();
    expect(onClear).toHaveBeenCalledOnce();
    handle.dispose();
  });

  it("does not expose raw testcase content or automatically select a Case", () => {
    const onSelectLeft = vi.fn();
    const onSelectRight = vi.fn();
    const handle = createCaseComparisonControls({
      model: model({ hasCurrent: true, currentCaseIndex: 1 }),
      onSelectLeft,
      onSelectRight,
      onClear: vi.fn()
    });

    expect(handle.element.textContent).not.toContain("[1, 2, 3]");
    expect(onSelectLeft).not.toHaveBeenCalled();
    expect(onSelectRight).not.toHaveBeenCalled();
    handle.dispose();
  });
});

import { describe, expect, it } from "vitest";

import {
  createReleaseOnboarding,
  type ReleaseOnboardingState
} from "../../src/sidepanel/components/ReleaseOnboarding";

describe("ReleaseOnboarding", () => {
  function render(state: ReleaseOnboardingState, stale = false) {
    const handle = createReleaseOnboarding();
    handle.update(state, { stale });
    return handle;
  }

  it("explains how to recover when there is no active LeetCode tab", () => {
    const handle = render("no_active_leetcode");

    expect(handle.element.textContent).toContain(
      "Open a LeetCode problem to start visualizing Python execution."
    );
  });

  it("explains that the editor is still loading", () => {
    const handle = render("waiting_for_editor");

    expect(handle.element.textContent).toContain(
      "Waiting for the LeetCode editor to load…"
    );
  });

  it("distinguishes a missing language from an unsupported language", () => {
    const missing = render("waiting_for_language");
    const unsupported = render("unsupported_language");

    expect(missing.element.textContent).toContain(
      "Waiting for LeetCode to identify the editor language…"
    );
    expect(unsupported.element.textContent).toContain("Python required");
    expect(unsupported.element.textContent).toContain(
      "This release visualizes Python solutions only."
    );
    expect(unsupported.element.textContent).toContain(
      "Switch the LeetCode editor language to Python to continue."
    );
  });

  it("explains how to provide a testcase", () => {
    const handle = render("waiting_for_testcase");

    expect(handle.element.textContent).toContain("Code synced");
    expect(handle.element.textContent).toContain(
      "Open or enter a testcase on LeetCode to start visualization."
    );
  });

  it("gives a short first-run recipe for a runnable Python draft", () => {
    const handle = render("ready");

    expect(handle.element.querySelectorAll("li")).toHaveLength(4);
    expect(handle.element.textContent).toContain("Use Python.");
    expect(handle.element.textContent).toContain("Choose or enter a testcase.");
    expect(handle.element.textContent).toContain("Start typing.");
    expect(handle.element.textContent).toContain(
      "The visualization updates automatically."
    );
    expect(handle.element.textContent).toContain("Runs locally in your browser.");
  });

  it("marks a preserved trace as stale without replacing the onboarding element", () => {
    const handle = createReleaseOnboarding();
    const element = handle.element;

    handle.update("waiting_for_testcase", { stale: true });

    expect(handle.element).toBe(element);
    expect(element.dataset.stale).toBe("true");
    expect(element.textContent).toContain(
      "Showing the last captured visualization while this page state is waiting."
    );
  });
});

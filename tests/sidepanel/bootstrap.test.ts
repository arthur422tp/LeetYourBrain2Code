import { describe, expect, it } from "vitest";

import { renderSidePanel } from "../../src/sidepanel/bootstrap";

describe("renderSidePanel", () => {
  it("renders the initial runtime status", () => {
    const root = document.createElement("main");

    renderSidePanel(root);

    expect(root.textContent).toContain("LeetCode Python Visualizer");
    expect(root.textContent).toContain("Runtime: not started");
  });
});

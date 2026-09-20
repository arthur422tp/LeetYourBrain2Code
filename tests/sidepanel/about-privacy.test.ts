import { describe, expect, it } from "vitest";

import { createAboutPrivacy } from "../../src/sidepanel/components/AboutPrivacy";

describe("About & privacy disclosure", () => {
  it("renders a collapsed local-processing disclosure with a privacy policy link", () => {
    const disclosure = createAboutPrivacy();

    expect(disclosure.element.open).toBe(false);
    expect(disclosure.element.querySelector("summary")?.textContent)
      .toBe("About & privacy");
    expect(disclosure.element.textContent).toContain("Runs locally");
    expect(disclosure.element.textContent).toContain(
      "This extension reads the Python code and testcase on the active LeetCode page to build the visualization. Execution uses bundled Pyodide in your browser. Your code and testcase are not sent to a backend."
    );

    const link = disclosure.element.querySelector<HTMLAnchorElement>(
      "a[href*='PRIVACY.md']"
    );
    expect(link?.textContent).toBe("Privacy Policy");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toContain("noopener");
  });
});

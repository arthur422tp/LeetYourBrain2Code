import { describe, expect, it, vi } from "vitest";

describe("background service worker", () => {
  it("opens the Side Panel when the toolbar action is clicked", async () => {
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      sidePanel: { setPanelBehavior }
    });
    vi.resetModules();

    await import("../../src/background/service-worker");
    await Promise.resolve();

    expect(setPanelBehavior).toHaveBeenCalledTimes(1);
    expect(setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true
    });

    vi.unstubAllGlobals();
  });
});

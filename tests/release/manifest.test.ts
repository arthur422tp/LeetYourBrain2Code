import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type ReleaseManifest = {
  manifest_version: number;
  name: string;
  short_name?: string;
  version: string;
  minimum_chrome_version?: string;
  description?: string;
  permissions?: string[];
  host_permissions?: string[];
  side_panel?: { default_path?: string };
  background?: { service_worker?: string; type?: string };
  icons?: Record<string, string>;
  action?: {
    default_title?: string;
    default_icon?: Record<string, string>;
  };
};

function readManifest(): ReleaseManifest {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "public/manifest.json"), "utf8")
  ) as ReleaseManifest;
}

describe("release manifest", () => {
  it("declares a Manifest V3 semver product identity", () => {
    const manifest = readManifest();

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("LeetCode Python Execution Visualizer");
    expect(manifest.short_name).toBe("LC Visualizer");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description).toBe(
      "Visualize how your Python code actually executes on LeetCode with local step-by-step runtime evidence."
    );
  });

  it("declares the verified minimum Chrome version for shipping APIs", () => {
    const manifest = readManifest();

    expect(manifest.minimum_chrome_version).toBe("114");
  });

  it("keeps permissions limited to the LeetCode visualizer surface", () => {
    const manifest = readManifest();

    expect(manifest.permissions).toEqual(["sidePanel", "scripting"]);
    expect(manifest.host_permissions).toEqual(["https://leetcode.com/*"]);
  });

  it("declares the Side Panel and toolbar icon entry points", () => {
    const manifest = readManifest();

    expect(manifest.side_panel).toEqual({ default_path: "sidepanel/index.html" });
    expect(manifest.background).toEqual({
      service_worker: "background/service-worker.js",
      type: "module"
    });
    expect(manifest.icons).toEqual({
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    });
    expect(manifest.action).toEqual({
      default_title: "Open LeetCode Python Execution Visualizer",
      default_icon: {
        "16": "icons/icon16.png",
        "32": "icons/icon32.png"
      }
    });
  });
});

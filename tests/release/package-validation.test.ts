import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

type ReleaseCheckApi = {
  REQUIRED_DIST_FILES: readonly string[];
  findRemoteExecutableUrls(relativePath: string, contents: string): string[];
  listReleaseFiles(root: string): string[];
  assertReleaseRootIsSafe(root: string): void;
  validateSourceManifest(projectRoot?: string): { version: string };
};

type ReleaseZipApi = {
  createDeterministicZip(root: string): Buffer;
};

const releaseCheck = (await import("../../scripts/release-check.mjs")) as unknown as ReleaseCheckApi;
const releaseZip = (await import("../../scripts/release-zip.mjs")) as unknown as ReleaseZipApi;

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "lc-release-test-"));
}

describe("release package validation", () => {
  it("keeps the source manifest aligned with the package identity", () => {
    const result = releaseCheck.validateSourceManifest(resolve(process.cwd()));

    expect(result.version).toBe("0.1.0");
    expect(releaseCheck.REQUIRED_DIST_FILES).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "sidepanel/index.html",
        "worker/pyodide-worker.js",
        "content/leetcode-adapter.js",
        "page-bridge/leetcode-main-world.js",
        "background/service-worker.js",
        "pyodide/pyodide.asm.js",
        "pyodide/pyodide.asm.wasm",
        "pyodide/python_stdlib.zip",
        "pyodide/pyodide-lock.json"
      ])
    );
  });

  it("detects executable remote code but ignores ordinary documentation text", () => {
    expect(
      releaseCheck.findRemoteExecutableUrls(
        "sidepanel/index.html",
        '<script src="https://cdn.example.test/runtime.js"></script>'
      )
    ).toHaveLength(1);
    expect(
      releaseCheck.findRemoteExecutableUrls(
        "worker/runtime.js",
        'import("https://cdn.example.test/runtime.js");'
      )
    ).toHaveLength(1);
    expect(
      releaseCheck.findRemoteExecutableUrls(
        "worker/runtime.js",
        'const note = "import(\\\"https://docs.example.test/example\\\")";'
      )
    ).toEqual([]);
    expect(
      releaseCheck.findRemoteExecutableUrls(
        "docs/example.md",
        '<script src="https://docs.example.test/example.js"></script>'
      )
    ).toEqual([]);
  });

  it("rejects source and repository metadata inside a release root", () => {
    const root = temporaryDirectory();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "unexpected.js"), "export {};");

    expect(() => releaseCheck.assertReleaseRootIsSafe(root)).toThrow(/src/);
  });

  it("sorts release files and produces byte-identical ZIPs", () => {
    const root = temporaryDirectory();
    mkdirSync(join(root, "nested"), { recursive: true });
    writeFileSync(join(root, "z.txt"), "last");
    writeFileSync(join(root, "nested", "a.txt"), "first");

    expect(releaseCheck.listReleaseFiles(root)).toEqual(["nested/a.txt", "z.txt"]);
    expect(releaseZip.createDeterministicZip(root)).toEqual(
      releaseZip.createDeterministicZip(root)
    );
  });

  it("declares non-silent release commands", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.validate).toBe("npm test && npm run typecheck && npm run build");
    expect(packageJson.scripts["release:check"]).toBe("node scripts/release-check.mjs");
    expect(packageJson.scripts["release:zip"]).toBe("node scripts/release-zip.mjs");
  });
});

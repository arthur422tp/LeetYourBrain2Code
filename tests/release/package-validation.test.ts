import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
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
    const projectRoot = resolve(process.cwd());
    const result = releaseCheck.validateSourceManifest(projectRoot);
    const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      version: string;
    };

    expect(result.version).toBe(packageJson.version);
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

  it("rejects generated diagnostics and secret-like files inside a release root", () => {
    for (const fileName of ["diagnostic-report.txt", ".env.production", "credentials.json"]) {
      const root = temporaryDirectory();
      writeFileSync(join(root, fileName), "should not ship\n");

      expect(() => releaseCheck.assertReleaseRootIsSafe(root)).toThrow();
    }
  });

  it("rejects a package and manifest version mismatch before packaging", () => {
    const root = temporaryDirectory();
    mkdirSync(join(root, "public"), { recursive: true });
    copyFileSync(
      resolve(process.cwd(), "public/manifest.json"),
      join(root, "public/manifest.json")
    );
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));

    expect(() => releaseCheck.validateSourceManifest(root)).toThrow(/version mismatch/);
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
    expect(packageJson.scripts["test:compat"]).toBe("vitest run tests/compatibility");
    expect(packageJson.scripts["release:check"]).toBe("node scripts/release-check.mjs");
    expect(packageJson.scripts["release:zip"]).toBe("node scripts/release-zip.mjs");
  });
});

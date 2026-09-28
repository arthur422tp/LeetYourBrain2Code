import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

type ReleaseZipApi = {
  RELEASE_PREFIX: string;
  getReleaseZipPath(projectRoot: string, version: string): string;
  createDeterministicZip(root: string): Buffer;
};

const releaseZip = (await import("../../scripts/release-zip.mjs")) as unknown as ReleaseZipApi;

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "lc-release-zip-test-"));
}

function centralDirectoryNames(archive: Buffer): string[] {
  const names: string[] = [];
  const signature = 0x02014b50;
  let offset = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));

  while (offset + 46 <= archive.length && archive.readUInt32LE(offset) === signature) {
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    names.push(archive.toString("utf8", offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return names;
}

describe("release ZIP automation", () => {
  it("derives the artifact path from the release version", () => {
    expect(releaseZip.RELEASE_PREFIX).toBe("leetyourbrain2code");
    expect(releaseZip.getReleaseZipPath("/tmp/project", "0.1.1")).toBe(
      "/tmp/project/release/leetyourbrain2code-v0.1.1.zip"
    );
  });

  it("stores dist contents at the extension root", () => {
    const dist = temporaryDirectory();
    writeFileSync(join(dist, "manifest.json"), "{}\n");
    writeFileSync(join(dist, "sidepanel.js"), "export {};\n");

    const archive = releaseZip.createDeterministicZip(dist);

    expect(centralDirectoryNames(archive)).toEqual(["manifest.json", "sidepanel.js"]);
    expect(centralDirectoryNames(archive).some((name) => name.startsWith("dist/"))).toBe(false);
  });

  it("keeps generated ZIPs ignored by git", () => {
    expect(readFileSync(resolve(process.cwd(), ".gitignore"), "utf8")).toContain(
      "release/*.zip"
    );
  });
});

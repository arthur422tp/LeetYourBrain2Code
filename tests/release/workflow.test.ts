import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/release-artifact.yml"),
  "utf8"
);

function lineOf(text: string): number {
  const line = workflow.split("\n").findIndex((candidate) => candidate.includes(text));
  expect(line).toBeGreaterThanOrEqual(0);
  return line;
}

describe("release artifact workflow", () => {
  it("keeps every release validation gate in the workflow", () => {
    for (const required of [
      "npm ci",
      "python3 -m unittest discover -s tests/fixtures/python",
      "npm test",
      "npm run test:compat",
      "npm run typecheck",
      "npm run build",
      "npm run release:check",
      "npm run release:zip",
      "sha256sum",
      "actions/upload-artifact@v4"
    ]) {
      expect(workflow).toContain(required);
    }
  });

  it("uploads only after all validation and checksum steps", () => {
    expect(lineOf("npm run release:check")).toBeLessThan(lineOf("npm run release:zip"));
    expect(lineOf("npm run release:zip")).toBeLessThan(lineOf("sha256sum \"$ZIP_PATH\""));
    expect(lineOf("sha256sum \"$ZIP_PATH\"")).toBeLessThan(
      lineOf("actions/upload-artifact@v4")
    );
  });

  it("does not introduce automatic Chrome Web Store publishing credentials", () => {
    expect(workflow).not.toMatch(/chrome[_ -]?web[_ -]?store/i);
    expect(workflow).not.toMatch(/client[_-]?id|client[_-]?secret|refresh[_-]?token/i);
    expect(workflow).not.toMatch(/secrets\./i);
    expect(workflow).not.toMatch(/publish|upload.*store/i);
  });
});

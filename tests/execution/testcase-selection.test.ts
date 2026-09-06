import { describe, expect, it } from "vitest";

import {
  getSelectedTestcase,
  getTestcaseCases
} from "../../src/execution/testcase-selection";

const oneArgSource = `class Solution:
    def one(self, value):
        return value
`;

const twoArgSource = `class Solution:
    def add(self, left, right):
        return left + right
`;

describe("testcase selection", () => {
  it("groups testcase text using the resolved parameter count", () => {
    expect(getTestcaseCases(oneArgSource, "7\n8\n9")).toEqual(["7", "8", "9"]);
    expect(getTestcaseCases(twoArgSource, "1\n2\n3\n4")).toEqual(["1\n2", "3\n4"]);
  });

  it("returns the selected case or null for an unavailable index", () => {
    expect(getSelectedTestcase(oneArgSource, "7\n8\n9", 1)).toBe("8");
    expect(getSelectedTestcase(oneArgSource, "7\n8\n9", 3)).toBeNull();
  });

  it("returns no cases while the Solution entrypoint is incomplete", () => {
    expect(getTestcaseCases("class Solution:\n    pass", "7")).toEqual([]);
    expect(getSelectedTestcase("class Solution:\n    pass", "7", 0)).toBeNull();
  });

  it("returns no cases when argument lines cannot form complete groups", () => {
    expect(getTestcaseCases(twoArgSource, "1\n2\n3")).toEqual([]);
  });
});

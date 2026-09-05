import { describe, expect, it } from "vitest";

import { resolveEntrypoint } from "../../src/execution/entrypoint-resolver";

describe("resolveEntrypoint", () => {
  it("resolves a unique Solution method and excludes self", () => {
    const result = resolveEntrypoint(`class Solution:
    def twoSum(
        self,
        numbers: List[int],
        target: int,
    ) -> List[int]:
        return []
`);

    expect(result).toEqual({
      ok: true,
      entrypoint: {
        className: "Solution",
        methodName: "twoSum",
        parameterCount: 2
      }
    });
  });

  it("handles a single-line binary search signature", () => {
    expect(
      resolveEntrypoint(`class Solution:
    def binarySearch(self, nums: list[int], target: int):
        return -1
`)
    ).toEqual({
      ok: true,
      entrypoint: {
        className: "Solution",
        methodName: "binarySearch",
        parameterCount: 2
      }
    });
  });

  it("ignores private helpers but rejects multiple public candidates", () => {
    expect(
      resolveEntrypoint(`class Solution:
    def _helper(self, value):
        return value

    def twoSum(self, nums, target):
        return self._helper(nums)
`)
    ).toEqual({
      ok: true,
      entrypoint: {
        className: "Solution",
        methodName: "twoSum",
        parameterCount: 2
      }
    });

    expect(
      resolveEntrypoint(`class Solution:
    def twoSum(self, nums, target):
        return []

    def another(self, nums):
        return nums
`)
    ).toEqual({ ok: false, reason: "entrypoint_resolution_failed" });
  });

  it("returns a typed failure when Solution or a candidate method is missing", () => {
    expect(resolveEntrypoint("def twoSum(nums, target):\n    return []")).toEqual({
      ok: false,
      reason: "entrypoint_resolution_failed"
    });
    expect(resolveEntrypoint("class Solution:\n    pass")).toEqual({
      ok: false,
      reason: "entrypoint_resolution_failed"
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  resolveEntrypoint,
  resolveEntrypointForTestcase
} from "../../src/execution/entrypoint-resolver";

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
        parameterCount: 2,
        parameterKinds: ["value", "value"]
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
        parameterCount: 2,
        parameterKinds: ["value", "value"]
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
      parameterCount: 2,
      parameterKinds: ["value", "value"]
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

  it("rejects a method signature whose body is still incomplete", () => {
    expect(resolveEntrypoint(`class Solution:
    def one(self, value):`)).toEqual({
      ok: false,
      reason: "entrypoint_resolution_failed"
    });
  });

  it("does not select another public method around an incomplete draft", () => {
    expect(resolveEntrypoint(`class Solution:
    def helper(self, value):
    def one(self, value):
        return value
`)).toEqual({
      ok: false,
      reason: "entrypoint_resolution_failed"
    });
  });

  it("classifies ListNode annotations without using the problem title", () => {
    const result = resolveEntrypoint(`class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        return head
`);

    expect(result).toEqual({
      ok: true,
      entrypoint: {
        className: "Solution",
        methodName: "reverseList",
        parameterCount: 1,
        parameterKinds: ["linked_list"]
      }
    });
  });

  it.each([
    "Node",
    "Optional[Node]",
    "Optional['Node']",
    "'Node'",
    "Node | None",
    "None | Node"
  ])("classifies %s as graph_node", (annotation) => {
    const result = resolveEntrypoint(`class Solution:
    def cloneGraph(self, node: ${annotation}):
        return node
`);

    expect(result).toEqual({
      ok: true,
      entrypoint: {
        className: "Solution",
        methodName: "cloneGraph",
        parameterCount: 1,
        parameterKinds: ["graph_node"]
      }
    });
  });

  it("prefers a public typed Graph entrypoint over an equally arity helper", () => {
    const result = resolveEntrypointForTestcase(`class Solution:
    def helper(self, value):
        return value

    def cloneGraph(self, node: Optional['Node']):
        return node
`, "[[2],[1]]");

    expect(result).toEqual({
      ok: true,
      entrypoint: {
        className: "Solution",
        methodName: "cloneGraph",
        parameterCount: 1,
        parameterKinds: ["graph_node"]
      }
    });
  });

  it("keeps ordinary list annotations as value parameters", () => {
    const result = resolveEntrypoint(`class Solution:
    def twoSum(self, nums: list[int], target: int):
        return []
`);

    expect(result.ok && result.entrypoint.parameterKinds).toEqual(["value", "value"]);
  });
});

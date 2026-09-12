import { describe, expect, it } from "vitest";

import { createExecutionRequest } from "../../src/execution/execution-request";

describe("createExecutionRequest", () => {
  it("builds a request with a resolved entrypoint and default limits", () => {
    const sourceCode = `class Solution:
    def twoSum(self, nums, target):
        return [0, 1]
`;

    const result = createExecutionRequest({
      sessionId: "session-1",
      sourceCode,
      rawTestcase: "[2,7,11,15]\n9"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.sessionId).toBe("session-1");
      expect(result.request.sourceCode).toBe(sourceCode);
      expect(result.request.rawTestcase).toBe("[2,7,11,15]\n9");
      expect(result.request.entrypoint).toEqual({
        className: "Solution",
        methodName: "twoSum",
        parameterCount: 2,
        parameterKinds: ["value", "value"]
      });
      expect(result.request.limits.maxTraceSteps).toBeGreaterThan(0);
    }
  });

  it("returns the resolver failure without guessing an entrypoint", () => {
    expect(
      createExecutionRequest({
        sessionId: "session-2",
        sourceCode: "class Solution:\n    pass",
        rawTestcase: ""
      })
    ).toEqual({ ok: false, reason: "entrypoint_resolution_failed" });
  });

  it("returns an input failure for a wrong argument count", () => {
    expect(
      createExecutionRequest({
        sessionId: "session-3",
        sourceCode: "class Solution:\n    def add(self, a, b):\n        return a + b",
        rawTestcase: "2"
      })
    ).toEqual({ ok: false, reason: "input_error" });
  });

  it("allows caller limits to override individual defaults", () => {
    const result = createExecutionRequest({
      sessionId: "session-4",
      sourceCode: "class Solution:\n    def one(self, value):\n        return value",
      rawTestcase: "None",
      limits: { maxTraceSteps: 25, hardTimeoutMs: 100 }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.limits.maxTraceSteps).toBe(25);
      expect(result.request.limits.hardTimeoutMs).toBe(100);
      expect(result.request.limits.maxSessionBytes).toBeGreaterThan(0);
    }
  });

  it("preserves linked-list parameter kinds on the execution request", () => {
    const result = createExecutionRequest({
      sessionId: "session-5",
      sourceCode: `class Solution:
    def reverseList(self, head: ListNode | None):
        return head
`,
      rawTestcase: "[1,2,3]"
    });

    expect(result.ok && result.request.entrypoint.parameterKinds).toEqual(["linked_list"]);
  });

  it("preserves binary-tree parameter kinds on the execution request", () => {
    const result = createExecutionRequest({
      sessionId: "session-6",
      sourceCode: `from typing import Optional

class Solution:
    def mirror(self, left, right):
        return True

    def isSymmetric(self, root: Optional[TreeNode]) -> bool:
        return True
`,
      rawTestcase: "[1,2,2,3,4,4,3]"
    });

    expect(result.ok && result.request.entrypoint).toEqual({
      className: "Solution",
      methodName: "isSymmetric",
      parameterCount: 1,
      parameterKinds: ["binary_tree"]
    });
  });
});

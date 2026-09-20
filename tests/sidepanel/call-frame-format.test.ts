import { describe, expect, it } from "vitest";

import {
  compactFrameExitSuffix,
  frameExitSummary,
  frameSignature,
  visibleFrameArguments
} from "../../src/sidepanel/call-frame-format";
import type { CallFrameStoryNode } from "../../src/core/call-frame-story";
import type { BoundArgumentSnapshot, FrameExit } from "../../src/shared/call-frame-types";
import type { ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function argument(name: string, value: ValueSnapshot): BoundArgumentSnapshot {
  return { name, kind: "positional_or_keyword", value };
}

function node(args: BoundArgumentSnapshot[]): CallFrameStoryNode {
  return {
    frameId: 5,
    functionId: "method:Solution.maxDepth",
    functionName: "maxDepth",
    qualifiedName: "Solution.maxDepth",
    displayName: "Solution.maxDepth",
    depth: 2,
    arguments: args,
    callStep: 18,
    exit: { status: "active" },
    atCursor: "active",
    recursion: { isRecursive: false, recursionDepth: 1 },
    childFrameIds: [],
    evidenceCounts: { decisions: 0, loopIterations: 0, expressions: 0, mutations: 0 }
  };
}

describe("call-frame-format", () => {
  it("suppresses self and cls only in compact visible arguments", () => {
    const args = [argument("self", int(99)), argument("n", int(3))];
    const result = visibleFrameArguments(args);

    expect(result.visible.map((item) => item.name)).toEqual(["n"]);
    expect(result.hiddenCount).toBe(0);
    expect(args).toEqual([argument("self", int(99)), argument("n", int(3))]);
    expect(visibleFrameArguments([argument("cls", int(99)), argument("value", int(7))]).visible.map((item) => item.name))
      .toEqual(["value"]);
  });

  it("preserves argument order and adds a bounded overflow marker", () => {
    const args = [argument("a", int(1)), argument("b", int(2)), argument("c", int(3)), argument("d", int(4))];
    const result = visibleFrameArguments(args);

    expect(result.visible.map((item) => item.name)).toEqual(["a", "b", "c"]);
    expect(result.hiddenCount).toBe(1);
    expect(frameSignature(node(args))).toBe("Solution.maxDepth(a=1, b=2, c=3, …)");
  });

  it("formats qualified and compact function signatures with existing value formatting", () => {
    const root = {
      type: "reference" as const,
      objectId: "obj-3",
      className: "TreeNode"
    };
    const args = [argument("self", int(0)), argument("root", root), argument("limit", int(2))];
    expect(frameSignature(node(args))).toBe("Solution.maxDepth(root=TreeNode@obj-3, limit=2)");
    expect(frameSignature(node([argument("root", { type: "none", value: null })]), { preferShortName: true }))
      .toBe("maxDepth(root=None)");
  });

  it("summarizes factual frame exits without diagnostic language", () => {
    const exits: Array<[FrameExit, string, string]> = [
      [{ status: "returned", step: 20, value: int(0) }, "Returned 0", "→ 0"],
      [{ status: "returned", step: 20, value: { type: "none", value: null } }, "Returned None", "→ None"],
      [{ status: "exception", step: 20, exception: { type: "ValueError", message: "boom", line: 4, stack: [], frameId: 5 } }, "Raised ValueError", "⚠ ValueError"],
      [{ status: "trace_ended", reason: "hard_timeout" }, "Trace ended · hard_timeout", "… trace ended"],
      [{ status: "active" }, "Active", "active"]
    ];

    for (const [exit, summary, suffix] of exits) {
      expect(frameExitSummary(exit)).toBe(summary);
      expect(compactFrameExitSuffix(exit)).toBe(suffix);
    }
  });

  it("keeps a truncated container snapshot bounded by the existing formatter", () => {
    const snapshot: ValueSnapshot = {
      type: "list",
      length: 100,
      items: [int(1), int(2), int(3)],
      truncated: true
    };
    expect(frameSignature(node([argument("items", snapshot)])))
      .toBe("Solution.maxDepth(items=[1, 2, 3, …])");
  });
});

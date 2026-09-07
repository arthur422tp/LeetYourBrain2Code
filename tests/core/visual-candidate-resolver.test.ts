import { describe, expect, it } from "vitest";

import {
  resolveVisualCandidates,
  type VisualCandidate,
  type VisualKind,
  type VisualPriority
} from "../../src/core/visual-candidate-resolver";

function candidate(
  visualId: string,
  kind: VisualKind,
  priority: VisualPriority
): VisualCandidate {
  return { visualId, kind, priority };
}

describe("resolveVisualCandidates", () => {
  it("prioritizes a mutated linked list over an unrelated unchanged list", () => {
    const selection = resolveVisualCandidates([
      candidate("list:nums", "list", [false, false, true, 1]),
      candidate("linked_list:obj-1", "linked_list", [false, true, true, 2])
    ]);

    expect(selection.primary?.visualId).toBe("linked_list:obj-1");
  });

  it("uses deterministic kind/id tie breakers", () => {
    const selection = resolveVisualCandidates([
      candidate("list:z", "list", [false, false, false, 1]),
      candidate("dict:a", "dict", [false, false, false, 1])
    ]);

    expect(selection.visible.map((item) => item.visualId)).toEqual(["dict:a", "list:z"]);
  });

  it("caps visible candidates at three", () => {
    const selection = resolveVisualCandidates([
      candidate("list:a", "list", [true, false, false, 0]),
      candidate("list:b", "list", [false, true, false, 0]),
      candidate("dict:c", "dict", [false, false, true, 0]),
      candidate("linked_list:d", "linked_list", [false, false, false, 4])
    ]);

    expect(selection.visible).toHaveLength(3);
    expect(selection.primary?.visualId).toBe("list:a");
  });
});

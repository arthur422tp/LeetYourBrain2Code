import { describe, expect, it, vi } from "vitest";

import type { SubscriptRelation } from "../../src/core/ast-relations";
import type { TraceSession } from "../../src/shared/trace-types";
import { createTraceVisualizer } from "../../src/sidepanel/components/TraceVisualizer";

const int = (value: number) => ({ type: "int" as const, value: String(value) });

const list = (values: number[]) => ({
  type: "list" as const,
  length: values.length,
  items: values.map(int),
  truncated: false
});

const dict = (entries: Array<[number, number]>) => ({
  type: "dict" as const,
  length: entries.length,
  entries: entries.map(([key, value]) => ({ key: int(key), value: int(value) })),
  truncated: false
});

const relations: SubscriptRelation[] = [
  { scope: "Solution.twoSum", line: 5, container: "nums", index: "left" },
  { scope: "Solution.twoSum", line: 5, container: "nums", index: "right" }
];

function session(): TraceSession {
  return {
    schemaVersion: 1,
    sessionId: "session-1",
    sourceCode: "class Solution:\n    def twoSum(self, nums, target):\n        left = 0\n        right = len(nums) - 1\n        total = nums[left] + nums[right]\n        left += 1\n",
    rawTestcase: "[2, 7]\n9",
    entrypoint: { className: "Solution", methodName: "twoSum", parameterCount: 2 },
    executionEnvironment: { runtime: "pyodide", pythonVersion: "3.13" },
    status: "completed",
    terminationReason: "normal_return",
    events: [
      {
        step: 1,
        event: "line",
        frameId: 1,
        parentFrameId: null,
        function: "twoSum",
        line: 5,
        callDepth: 1,
        locals: { nums: list([2, 7]), left: int(0), right: int(1), target: int(9), total: int(9) },
        stdoutDelta: ""
      },
      {
        step: 2,
        event: "line",
        frameId: 1,
        parentFrameId: null,
        function: "twoSum",
        line: 6,
        callDepth: 1,
        locals: { nums: list([2, 7]), left: int(1), right: int(1), target: int(9), total: int(9) },
        stdoutDelta: ""
      }
    ],
    stdout: "",
    limits: {
      maxTraceSteps: 100,
      maxContainerItems: 100,
      maxNestingDepth: 4,
      maxSnapshotBytes: 10000,
      maxSessionBytes: 100000,
      maxStdoutBytes: 10000,
      hardTimeoutMs: 1000,
      maxObjectNodes: 200,
      maxObjectAttributes: 20,
      maxObjectDepth: 32
    },
    subscriptRelations: relations,
    returnValue: null
  };
}

function twoSumSession(): TraceSession {
  return {
    ...session(),
    sourceCode: "class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, x in enumerate(nums):\n            need = target - x\n            if need in seen:\n                return [seen[need], i]\n            seen[x] = i\n        return []\n",
    rawTestcase: "[2, 7, 11, 15]\n9",
    subscriptRelations: [],
    events: [{
      step: 1,
      event: "line",
      frameId: 1,
      parentFrameId: null,
      function: "twoSum",
      line: 7,
      callDepth: 1,
      locals: {
        nums: list([2, 7, 11, 15]),
        seen: dict([[2, 0]]),
        i: int(1),
        x: int(7),
        target: int(9),
        need: int(2)
      },
      stdoutDelta: ""
    }]
  };
}

describe("createTraceVisualizer", () => {
  it("renders readable trace state and keeps raw JSON in a collapsed debug section", () => {
    const view = createTraceVisualizer(session());

    expect(view.element.id).toBe("trace-viewer");
    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
      .toBe("Step 1 / 2");
    expect(view.element.querySelector(".trace-viewer__code-line.is-active")?.textContent)
      .toContain("total = nums[left] + nums[right]");
    expect(view.element.querySelector("#list-visualizer")).not.toBeNull();
    expect(view.element.querySelector('[data-pointer-name="left"]')).not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__inspector-grid")).not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__locals")?.textContent)
      .toContain("left");

    const debug = view.element.querySelector<HTMLDetailsElement>(".trace-viewer__debug");
    expect(debug?.open).toBe(false);
    expect(view.element.querySelector("#trace-output")?.textContent)
      .toContain('"event": "line"');
  });

  it("moves between steps and updates the visual state", () => {
    const view = createTraceVisualizer(session());
    const next = view.element.querySelector<HTMLButtonElement>("#trace-next");
    const previous = view.element.querySelector<HTMLButtonElement>("#trace-previous");

    next?.click();

    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
      .toBe("Step 2 / 2");
    expect(view.element.querySelector(".trace-viewer__code-line.is-active")?.textContent)
      .toContain("left += 1");
    expect(view.element.querySelector('[data-variable-name="left"] .trace-viewer__change-before')?.textContent)
      .toBe("0");
    expect(view.element.querySelector('[data-variable-name="left"] .trace-viewer__change-after')?.textContent)
      .toBe("1");
    expect(next?.disabled).toBe(true);

    previous?.click();
    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
      .toBe("Step 1 / 2");
  });

  it("keeps the list visualizer mounted while stepping through a trace", () => {
    const view = createTraceVisualizer(session());
    const list = view.element.querySelector("#list-visualizer");
    const pointer = view.element.querySelector('[data-pointer-name="left"]');
    const next = view.element.querySelector<HTMLButtonElement>("#trace-next");

    next?.click();

    expect(view.element.querySelector("#list-visualizer")).toBe(list);
    expect(view.element.querySelector('[data-pointer-name="left"]')).toBe(pointer);
    expect(pointer?.getAttribute("data-pointer-index")).toBe("1");
  });

  it("keeps an empty trace readable when execution fails before the first event", () => {
    const view = createTraceVisualizer({
      ...session(),
      status: "parse_error",
      terminationReason: "syntax_error",
      events: [],
      exception: {
        type: "SyntaxError",
        message: "invalid syntax",
        line: 3,
        stack: [],
        frameId: null
      }
    });

    expect(view.element.querySelector(".trace-viewer__visual-state-body")?.textContent ?? "")
      .toContain("No execution steps");
    expect(view.element.querySelector(".trace-viewer__changes")?.textContent ?? "")
      .toContain("No state change");
    expect(view.element.querySelector(".trace-viewer__locals")?.textContent ?? "")
      .toContain("No local variables");
    expect(view.element.querySelector(".trace-viewer__exception")?.textContent ?? "")
      .toContain("invalid syntax");
  });

  it("renders array and hash-map visuals for Two Sum without pointer relations", () => {
    const view = createTraceVisualizer(twoSumSession());

    expect(view.element.querySelector(".list-visualizer")).not.toBeNull();
    expect(view.element.querySelector('[data-variable-name="nums"]')).not.toBeNull();
    expect(view.element.querySelector(".dict-visualizer")).not.toBeNull();
    expect(view.element.querySelector('[data-dict-entry-key]')).not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__visual-state-body")?.textContent)
      .toContain("seen");
  });

  it("renders an enumerate cursor and dictionary membership probe for Two Sum", () => {
    const view = createTraceVisualizer({
      ...twoSumSession(),
      subscriptRelations: [
        {
          kind: "iteration",
          scope: "Solution.twoSum",
          line: 4,
          container: "nums",
          index: "i",
          value: "x"
        },
        {
          kind: "membership",
          scope: "Solution.twoSum",
          line: 7,
          container: "seen",
          index: "need"
        }
      ] as unknown as SubscriptRelation[]
    });

    expect(view.element.querySelector('[data-pointer-name="i"]')).not.toBeNull();
    expect(view.element.querySelector('[data-pointer-source="iteration"]')).not.toBeNull();
    expect(view.element.querySelector('[data-dict-probe-key-variable="need"]')).not.toBeNull();
    expect(view.element.querySelector('[data-dict-probe-status="hit"]')).not.toBeNull();
  });

  it("plays forward and stops when it reaches the final step", () => {
    vi.useFakeTimers();
    try {
      const view = createTraceVisualizer(session());
      const play = view.element.querySelector<HTMLButtonElement>("#trace-play");

      play?.click();
      expect(view.element.dataset.playing).toBe("true");

      vi.advanceTimersByTime(700);

      expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
        .toBe("Step 2 / 2");
      expect(view.element.dataset.playing).toBe("false");
      expect(play?.textContent).toBe("▶ Play");
      view.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

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
    schemaVersion: 2,
    sessionId: "session-1",
    sourceCode: "class Solution:\n    def twoSum(self, nums, target):\n        left = 0\n        right = len(nums) - 1\n        total = nums[left] + nums[right]\n        left += 1\n",
    rawTestcase: "[2, 7]\n9",
    entrypoint: {
      className: "Solution",
      methodName: "twoSum",
      parameterCount: 2,
      parameterKinds: ["value", "value"]
    },
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

function alternatingRepeatedStateSession(): TraceSession {
  const base = session();
  const events = [0, 1, 0, 1, 0].map((left, index) => ({
    ...base.events[0]!,
    step: index + 1,
    line: index % 2 === 0 ? 5 : 6,
    locals: {
      nums: list([2, 7]),
      left: int(left),
      right: int(1),
      target: int(9),
      total: int(9)
    }
  }));
  return { ...base, events };
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

function linkedListSession(): TraceSession {
  const reference = (objectId: string) => ({
    type: "reference" as const,
    objectId,
    className: "ListNode"
  });
  const node = (objectId: string, value: number, next: ReturnType<typeof reference> | null) => ({
    objectId,
    className: "ListNode",
    attributes: {
      val: int(value),
      next: next ?? { type: "none" as const, value: null }
    }
  });

  return {
    ...session(),
    sourceCode: "class Solution:\n    def reverseList(self, head):\n        return head\n",
    rawTestcase: "[1, 2]",
    entrypoint: {
      className: "Solution",
      methodName: "reverseList",
      parameterCount: 1,
      parameterKinds: ["linked_list"]
    },
    subscriptRelations: [],
    events: [
      {
        step: 1,
        event: "line",
        frameId: 1,
        parentFrameId: null,
        function: "reverseList",
        line: 2,
        callDepth: 1,
        locals: { head: reference("obj-1"), nums: list([1, 2]) },
        objects: [node("obj-1", 1, reference("obj-2")), node("obj-2", 2, null)],
        objectsTruncated: false,
        stdoutDelta: ""
      },
      {
        step: 2,
        event: "line",
        frameId: 1,
        parentFrameId: null,
        function: "reverseList",
        line: 3,
        callDepth: 1,
        locals: { head: reference("obj-1"), nums: list([1, 2]) },
        objects: [node("obj-1", 1, reference("obj-2")), node("obj-2", 2, null)],
        objectsTruncated: false,
        stdoutDelta: ""
      }
    ]
  };
}

function cyclicLinkedListSession(): TraceSession {
  const base = linkedListSession();
  const finalEvent = base.events.at(-1)!;
  return {
    ...base,
    events: [
      ...base.events,
      {
        ...finalEvent,
        step: finalEvent.step + 1,
        line: 4,
        objects: finalEvent.objects?.map((object) => object.objectId === "obj-2"
          ? {
              ...object,
              attributes: {
                ...object.attributes,
                next: { type: "reference" as const, objectId: "obj-1", className: "ListNode" }
              }
            }
          : object),
        event: "exception" as const,
        eventPayload: {
          type: "exception" as const,
          exception: {
            type: "RuntimeError",
            message: "cycle detected while traversing",
            line: 4,
            stack: [],
            frameId: 1
          }
        }
      }
    ],
    status: "exception",
    terminationReason: "runtime_exception",
    exception: {
      type: "RuntimeError",
      message: "cycle detected while traversing",
      line: 4,
      stack: [],
      frameId: 1
    }
  };
}

describe("createTraceVisualizer", () => {
  it("renders What Changed from mutations without unchanged-variable groups", () => {
    const view = createTraceVisualizer(session());
    const panelTitles = [...view.element.querySelectorAll(".trace-viewer__panel-title")]
      .map((element) => element.textContent);
    const changes = view.element.querySelector(".trace-viewer__mutations");

    expect(panelTitles).toContain("What Changed");
    expect(panelTitles).toContain("Behavioral Signals");
    expect(panelTitles).not.toContain("State Changes");
    expect(view.element.querySelector(".trace-viewer__change-group")).toBeNull();
    expect(changes?.textContent).toContain("Initial observations");
    expect(changes?.textContent).toContain("initial observation");
    expect(view.element.querySelector(".trace-viewer__locals-panel")).not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__call-stack-panel")).not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__output-panel")).not.toBeNull();
  });

  it("renders repeated behavioral evidence without changing raw step navigation", () => {
    const base = session();
    const repeatedEvents = [1, 2, 3].map((step) => ({
      ...base.events[0]!,
      step,
      locals: {
        nums: list([2, 7]),
        left: int(0),
        right: int(1),
        target: int(9),
        total: int(9)
      }
    }));
    const view = createTraceVisualizer({
      ...base,
      events: repeatedEvents
    });

    expect(view.element.querySelector(".trace-viewer__behavioral-signals")?.textContent)
      .toContain("No observable progress");
    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
      .toBe("Step 1 / 3");

    view.element.querySelector<HTMLButtonElement>("#trace-next")?.click();

    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
      .toBe("Step 2 / 3");
    expect(view.element.querySelector(".trace-viewer__behavioral-signals")?.textContent)
      .toContain("No observable progress");
  });

  it("routes Next evidence through the same raw step state owner", () => {
    const view = createTraceVisualizer(alternatingRepeatedStateSession());
    const row = view.element.querySelector('[data-pattern-kind="repeated_state"]')!;

    row.querySelector<HTMLButtonElement>('[data-behavior-action="next"]')!.click();

    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
      .toBe("Step 3 / 5");
    expect(view.element.querySelector(".trace-viewer__code-line.is-active")?.textContent)
      .toContain("total = nums[left] + nums[right]");
    expect(view.element.querySelector(".trace-viewer__locals")?.textContent)
      .toContain("left");
  });

  it("stops autoplay when the user directly navigates behavioral evidence", () => {
    vi.useFakeTimers();
    try {
      const view = createTraceVisualizer(alternatingRepeatedStateSession());
      const play = view.element.querySelector<HTMLButtonElement>("#trace-play")!;

      view.setStep(1);
      play.click();
      expect(view.element.dataset.playing).toBe("true");

      const row = view.element.querySelector('[data-pattern-kind="repeated_state"]')!;
      row.querySelector<HTMLButtonElement>('[data-behavior-action="previous"]')!.click();

      expect(view.element.dataset.playing).toBe("false");
      expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
        .toBe("Step 1 / 5");
      view.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows repeated transitions for a finite changing loop without no-progress wording", () => {
    const base = session();
    const finiteEvents = [0, 1, 2, 3].map((value, index) => ({
      ...base.events[0]!,
      step: index + 1,
      locals: {
        nums: list([2, 7]),
        left: int(value),
        right: int(1),
        target: int(9),
        total: int(9)
      }
    }));
    const view = createTraceVisualizer({ ...base, events: finiteEvents });
    const text = view.element.querySelector(".trace-viewer__behavioral-signals")?.textContent ?? "";

    expect(text).toContain("Repeated transition motif");
    expect(text).not.toContain("No observable progress");
  });

  it("keeps repeated behavioral evidence in a hard-timeout trace prefix", () => {
    const base = session();
    const repeatedEvents = [1, 2, 3].map((step) => ({
      ...base.events[0]!,
      step,
      locals: {
        nums: list([2, 7]),
        left: int(0),
        right: int(1),
        target: int(9),
        total: int(9)
      }
    }));
    const view = createTraceVisualizer({
      ...base,
      status: "timeout",
      terminationReason: "hard_timeout",
      events: repeatedEvents
    });

    expect(view.element.textContent).toContain("hard timeout");
    expect(view.element.textContent).toContain("Behavioral Signals");
    expect(view.element.textContent).toContain("No observable progress");
    expect(view.element.textContent).not.toContain("LeetCode TLE");
  });

  it("replaces mutation content when navigating to the current step", () => {
    const view = createTraceVisualizer(session());
    const next = view.element.querySelector<HTMLButtonElement>("#trace-next");

    expect(view.element.querySelector(".trace-viewer__mutation-row")?.textContent)
      .toContain("left");
    next?.click();

    const changes = view.element.querySelector(".trace-viewer__mutations");
    expect(changes?.textContent).toContain("left");
    expect(changes?.textContent).toContain("0 → 1");
    expect(view.element.querySelector(".trace-viewer__mutation-row"))
      .not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__change-group")).toBeNull();
  });

  it("renders a neutral empty mutation state while preserving the other panels", () => {
    const view = createTraceVisualizer({
      ...session(),
      events: [],
      status: "parse_error",
      terminationReason: "syntax_error"
    });

    expect(view.element.querySelector(".trace-viewer__mutations")?.textContent)
      .toBe("No observed state change at this step.");
    expect(view.element.querySelector(".trace-viewer__behavioral-signals")?.textContent)
      .toBe("No repeated behavioral signal in the captured trace.");
    expect(view.element.querySelector(".trace-viewer__change-group")).toBeNull();
    expect(view.element.querySelector(".trace-viewer__locals-panel")).not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__call-stack-panel")).not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__output-panel")).not.toBeNull();
  });

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
    const leftMutation = view.element.querySelector('[data-mutation-kind="variable"]');
    expect(leftMutation?.textContent).toContain("left");
    expect(leftMutation?.textContent).toContain("0 → 1");
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
    expect(view.element.querySelector(".trace-viewer__mutations")?.textContent ?? "")
      .toContain("No observed state change");
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

  it("renders distinct visual ids through the registry and reuses stable handles", () => {
    const view = createTraceVisualizer(linkedListSession());
    const visuals = view.element.querySelectorAll("[data-visual-id]");
    const listElement = view.element.querySelector('[data-visual-id="list:nums"]');

    expect(visuals).toHaveLength(2);
    expect(view.element.querySelector('[data-visual-id="linked_list:obj-1"]')).not.toBeNull();
    expect(listElement).not.toBeNull();

    view.setStep(1);

    expect(view.element.querySelector('[data-visual-id="list:nums"]')).toBe(listElement);
    view.dispose();
  });

  it("renders a cycle marker and preserves the linked-list visual on an exception step", () => {
    const view = createTraceVisualizer(cyclicLinkedListSession());

    view.setStep(2);

    expect(view.element.querySelector('[data-cycle-indicator="true"]')?.textContent)
      .toContain("back-edge");
    expect(view.element.querySelector('[data-next-status="added"]')).not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__exception")?.textContent)
      .toContain("cycle detected while traversing");
    expect(view.element.querySelector('[data-visual-id="linked_list:obj-1"]')).not.toBeNull();
    view.dispose();
  });

  it("keeps a captured linked-list visual readable when execution times out", () => {
    const view = createTraceVisualizer({
      ...linkedListSession(),
      status: "timeout",
      terminationReason: "hard_timeout"
    });

    expect(view.element.querySelector('[data-visual-id="linked_list:obj-1"]')).not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__summary-detail")?.textContent)
      .toContain("hard timeout");
    view.dispose();
  });
});

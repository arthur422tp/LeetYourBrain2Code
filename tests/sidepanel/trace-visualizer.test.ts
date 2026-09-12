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

function repeatedTransitionFoldSession(): TraceSession {
  const base = session();
  const values = [0, 1, 0, 1, 0, 1];
  const primingEvent = {
    ...base.events[0]!,
    step: 1,
    line: 6,
    locals: {
      nums: list([2, 7]),
      left: int(9),
      right: int(1),
      target: int(9),
      total: int(9)
    }
  };
  const motifEvents = values.map((value, index) => ({
    ...base.events[0]!,
    step: index + 2,
    line: index % 2 === 0 ? 5 : 6,
    locals: {
      nums: list([2, 7]),
      left: int(value),
      right: int(1),
      target: int(9),
      total: int(9)
    }
  }));
  return { ...base, events: [primingEvent, ...motifEvents] };
}

function failureFirstSession(
  status: "timeout" | "trace_limit" | "exception"
): TraceSession {
  const base = repeatedTransitionFoldSession();
  return {
    ...base,
    status,
    terminationReason:
      status === "timeout" ? "hard_timeout" :
      status === "trace_limit" ? "step_limit" :
      "runtime_exception",
    ...(status === "exception"
      ? {
          exception: {
            type: "RuntimeError",
            message: "boom",
            line: 5,
            stack: [],
            frameId: 1
          }
        }
      : {})
  };
}

function outOfWindowFailureFirstSession(): TraceSession {
  const base = failureFirstSession("timeout");
  const trailingEvents = Array.from({ length: 40 }, (_, index) => ({
    ...base.events[0]!,
    step: base.events.length + index + 1,
    line: 100 + index,
    locals: {
      [`value${index}`]: int(index)
    }
  }));
  return { ...base, events: [...base.events, ...trailingEvents] };
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

const treeReference = (objectId: string) => ({
  type: "reference" as const,
  objectId,
  className: "TreeNode"
});

const treeObject = (
  objectId: string,
  value: number,
  left: string | null = null,
  right: string | null = null
) => ({
  objectId,
  className: "TreeNode",
  attributes: {
    val: int(value),
    left: left === null ? { type: "none" as const, value: null } : treeReference(left),
    right: right === null ? { type: "none" as const, value: null } : treeReference(right)
  }
});

function treeSession(): TraceSession {
  const base = session();
  return {
    ...base,
    sourceCode: "class Solution:\n    def solve(self, root):\n        child = TreeNode(2)\n        root.left = child\n        return root\n",
    rawTestcase: "[4]",
    subscriptRelations: [],
    events: [
      {
        ...base.events[0]!,
        step: 1,
        function: "solve",
        line: 2,
        locals: { root: treeReference("obj-1") },
        objects: [treeObject("obj-1", 4)],
        objectsTruncated: false
      },
      {
        ...base.events[0]!,
        step: 2,
        function: "solve",
        line: 4,
        locals: { root: treeReference("obj-1"), child: treeReference("obj-2") },
        objects: [treeObject("obj-1", 4, "obj-2"), treeObject("obj-2", 2)],
        objectsTruncated: false
      }
    ]
  };
}

function treeBehaviorSession(): TraceSession {
  const base = alternatingRepeatedStateSession();
  return {
    ...base,
    events: base.events.map((event) => ({
      ...event,
      locals: { ...event.locals, root: treeReference("obj-1") },
      objects: [treeObject("obj-1", 4, "obj-2"), treeObject("obj-2", 2)],
      objectsTruncated: false
    }))
  };
}

function treeFailureFirstSession(): TraceSession {
  const base = failureFirstSession("timeout");
  return {
    ...base,
    events: base.events.map((event) => ({
      ...event,
      locals: { ...event.locals, root: treeReference("obj-1") },
      objects: [treeObject("obj-1", 4, "obj-2"), treeObject("obj-2", 2)],
      objectsTruncated: false
    }))
  };
}

const graphReference = (objectId: string) => ({
  type: "reference" as const,
  objectId,
  className: "Node"
});

const graphObject = (
  objectId: string,
  value: number,
  neighbors: string[]
) => ({
  objectId,
  className: "Node",
  attributes: {
    val: int(value),
    neighbors: {
      type: "list" as const,
      length: neighbors.length,
      items: neighbors.map(graphReference),
      truncated: false
    }
  }
});

function graphObjects(reciprocal: boolean) {
  return [
    graphObject("obj-1", 1, ["obj-2"]),
    graphObject("obj-2", 2, reciprocal ? ["obj-1"] : [])
  ];
}

function graphSession(): TraceSession {
  const base = session();
  const firstEvent = {
    ...base.events[0]!,
    step: 1,
    function: "cloneGraph",
    line: 4,
    locals: { root: graphReference("obj-1") },
    objects: graphObjects(false),
    objectsTruncated: false
  };
  const secondEvent = {
    ...firstEvent,
    step: 2,
    line: 5,
    objects: graphObjects(true)
  };
  return {
    ...base,
    sourceCode: "class Solution:\n    def cloneGraph(self, node):\n        node.neighbors = [node]\n        return node\n",
    rawTestcase: "[[1, 2], [2, 1]]\n",
    entrypoint: {
      className: "Solution",
      methodName: "cloneGraph",
      parameterCount: 1,
      parameterKinds: ["graph_node"]
    },
    subscriptRelations: [],
    events: [firstEvent, secondEvent]
  };
}

function graphWithMappingSession(): TraceSession {
  const base = session();
  const copies = (objectIds: string[]) => ({
    type: "dict" as const,
    length: objectIds.length,
    entries: objectIds.map((objectId) => ({
      key: graphReference(objectId),
      value: graphReference(objectId)
    })),
    truncated: false
  });
  const firstEvent = {
    ...base.events[0]!,
    step: 1,
    function: "cloneGraph",
    line: 20,
    locals: {
      copies: copies(["obj-1"]),
      cur: graphReference("obj-1")
    },
    objects: graphObjects(false),
    objectsTruncated: false
  };
  const secondEvent = {
    ...firstEvent,
    step: 2,
    line: 23,
    locals: {
      ...firstEvent.locals,
      copies: copies(["obj-1", "obj-2"])
    },
    objects: graphObjects(false)
  };
  return {
    ...base,
    sourceCode: "class Solution:\n    def cloneGraph(self, node):\n        copy = Node(node.val)\n        for neighbor in node.neighbors:\n            copy.neighbors.append(neighbor)\n        return copy\n",
    rawTestcase: "[[2], []]\n",
    entrypoint: {
      className: "Solution",
      methodName: "cloneGraph",
      parameterCount: 1,
      parameterKinds: ["graph_node"]
    },
    subscriptRelations: [],
    events: [firstEvent, secondEvent]
  };
}

function graphPatternSession(
  status: TraceSession["status"] = "completed"
): TraceSession {
  const base = session();
  const primingEvent = {
    ...base.events[0]!,
    step: 1,
    function: "cloneGraph",
    line: 6,
    locals: { root: graphReference("obj-1"), left: int(9) },
    objects: graphObjects(false),
    objectsTruncated: false
  };
  const motifEvents = [0, 1, 0, 1, 0, 1].map((value, index) => ({
    ...primingEvent,
    step: index + 2,
    line: index % 2 === 0 ? 5 : 6,
    locals: { root: graphReference("obj-1"), left: int(value) },
    objects: graphObjects(index % 2 === 0)
  }));
  return {
    ...base,
    sourceCode: "class Solution:\n    def cloneGraph(self, node):\n        node.neighbors = [node]\n        return node\n",
    rawTestcase: "[[1, 2], [2, 1]]\n",
    entrypoint: {
      className: "Solution",
      methodName: "cloneGraph",
      parameterCount: 1,
      parameterKinds: ["graph_node"]
    },
    status,
    terminationReason: status === "timeout" ? "hard_timeout" : "normal_return",
    subscriptRelations: [],
    events: [primingEvent, ...motifEvents]
  };
}

function graphConnection(view: HTMLElement): SVGGElement {
  return view.querySelector<SVGGElement>(".graph-visualizer__connection")!;
}

describe("createTraceVisualizer", () => {
  it.each(["timeout", "trace_limit", "exception"] as const)(
    "%s renders exactly one Failure-First entry",
    (status) => {
      const view = createTraceVisualizer(failureFirstSession(status));

      expect(view.element.querySelectorAll(".trace-viewer__failure-first")).toHaveLength(1);
    }
  );

  it("does not render Failure-First for a completed session", () => {
    const view = createTraceVisualizer(repeatedTransitionFoldSession());

    expect(view.element.querySelector(".trace-viewer__failure-first")).toBeNull();
  });

  it("renders Failure-First without moving the raw cursor", () => {
    const view = createTraceVisualizer(failureFirstSession("timeout"));

    expect(view.element.dataset.stepIndex).toBe("0");
    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
      .toContain("Step 1");
  });

  it("lands Inspect on the first raw index of the final repeated motif", () => {
    const view = createTraceVisualizer(failureFirstSession("timeout"));
    const inspect = view.element.querySelector<HTMLButtonElement>(
      ".trace-viewer__failure-first-inspect"
    )!;

    inspect.click();

    expect(view.element.dataset.stepIndex).toBe("5");
    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
      .toBe("Step 6 / 7");
  });

  it("stops autoplay when Failure-First Inspect navigates", () => {
    vi.useFakeTimers();
    try {
      const view = createTraceVisualizer(failureFirstSession("timeout"));
      const play = view.element.querySelector<HTMLButtonElement>("#trace-play")!;
      play.click();

      expect(view.element.dataset.playing).toBe("true");

      view.element.querySelector<HTMLButtonElement>(
        ".trace-viewer__failure-first-inspect"
      )!.click();

      expect(view.element.dataset.playing).toBe("false");
      expect(play.textContent).toBe("▶ Play");
      vi.advanceTimersByTime(1400);
      expect(view.element.dataset.stepIndex).toBe("5");
      view.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps every synchronized view on the inspected raw step", () => {
    const base = failureFirstSession("timeout");
    const captured: TraceSession = {
      ...base,
      events: base.events.map((event) => ({
        ...event,
        stdoutDelta: `captured ${event.step}\n`
      })),
      stdout: base.events.map((event) => `captured ${event.step}\n`).join("")
    };
    const view = createTraceVisualizer(captured);

    view.element.querySelector<HTMLButtonElement>(
      ".trace-viewer__failure-first-inspect"
    )!.click();

    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
      .toBe("Step 6 / 7");
    expect(view.element.querySelector<HTMLElement>(".trace-viewer__code-line.is-active")?.dataset.line)
      .toBe("5");
    expect(view.element.querySelector(".trace-viewer__visual-state-body .trace-viewer__state-meta")?.textContent)
      .toBe("Line 5");
    expect(view.element.querySelector(".trace-viewer__mutations")?.textContent)
      .toContain("1 → 0");
    expect(view.element.querySelector('[data-pattern-kind="repeated_transition"]')?.classList.contains("is-active"))
      .toBe(true);
    expect(view.element.querySelector(".trace-viewer__locals")?.textContent)
      .toContain("left");
    expect(view.element.querySelector(".trace-viewer__call-frame.is-active .trace-viewer__call-line")?.textContent)
      .toBe("line 5");
    expect(view.element.querySelector(".trace-viewer__stdout pre")?.textContent)
      .toBe("captured 1\ncaptured 2\ncaptured 3\ncaptured 4\ncaptured 5\ncaptured 6\n");
    expect(view.element.querySelector(".trace-viewer__outline-segment.is-active[data-segment-kind=\"repeated_transition_fold\"]"))
      .not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__timeline-current")?.textContent)
      .toBe("Step 6 / 7");
  });

  it("keeps behavioral signals while suppressing an out-of-window recommendation", () => {
    const view = createTraceVisualizer(outOfWindowFailureFirstSession());

    expect(view.element.querySelector(".trace-viewer__failure-first")).toBeNull();
    expect(view.element.querySelector('[data-pattern-kind="repeated_transition"]'))
      .not.toBeNull();
  });

  it("fixture exposes a repeated-transition fold candidate", () => {
    const view = createTraceVisualizer(repeatedTransitionFoldSession());
    expect(view.element.querySelector('[data-pattern-kind="repeated_transition"]')).not.toBeNull();
  });

  it("mounts Trace Outline for non-empty traces", () => {
    const view = createTraceVisualizer(repeatedTransitionFoldSession());
    expect(view.element.querySelector(".trace-viewer__outline")).not.toBeNull();
  });

  it("routes fold Inspect through the existing raw step owner", () => {
    const view = createTraceVisualizer(repeatedTransitionFoldSession());
    const inspect = view.element.querySelector<HTMLButtonElement>(
      '[data-segment-kind="repeated_transition_fold"] [data-outline-action="inspect"]'
    )!;
    inspect.click();

    expect(view.element.querySelector('.trace-viewer__outline-segment.is-active[data-segment-kind="repeated_transition_fold"]'))
      .not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__code-line.is-active")).not.toBeNull();
    expect(view.element.querySelector(".trace-viewer__locals")?.textContent).toContain("left");
  });

  it("preserves the raw cursor and playback deadline across expansion and collapse until Inspect", () => {
    vi.useFakeTimers();
    const view = createTraceVisualizer(repeatedTransitionFoldSession());
    const schedulePlayback = vi.spyOn(window, "setInterval");
    const clearPlayback = vi.spyOn(window, "clearInterval");
    try {
      view.setStep(1);
      view.element.querySelector<HTMLButtonElement>("#trace-play")!.click();
      expect(view.element.dataset.playing).toBe("true");
      expect(schedulePlayback).toHaveBeenCalledTimes(1);
      const playbackTimer = schedulePlayback.mock.results[0]!.value;

      const toggle = view.element.querySelector<HTMLButtonElement>(
        '[data-segment-kind="repeated_transition_fold"] [data-outline-action="toggle"]'
      )!;
      vi.advanceTimersByTime(200);
      toggle.click();
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(view.element.dataset.stepIndex).toBe("1");
      expect(view.element.dataset.playing).toBe("true");
      expect(schedulePlayback).toHaveBeenCalledTimes(1);
      expect(clearPlayback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      toggle.click();
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(view.element.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(0);
      expect(view.element.dataset.stepIndex).toBe("1");
      expect(view.element.dataset.playing).toBe("true");
      expect(schedulePlayback).toHaveBeenCalledTimes(1);
      expect(clearPlayback).not.toHaveBeenCalled();

      // The original 700 ms deadline survives both toggles; neither restarts the interval.
      vi.advanceTimersByTime(299);
      expect(view.element.dataset.stepIndex).toBe("1");
      vi.advanceTimersByTime(1);
      expect(view.element.dataset.stepIndex).toBe("2");
      expect(view.element.querySelector(".trace-viewer__step-label")?.textContent).toBe("Step 3 / 7");
      vi.advanceTimersByTime(700);
      expect(view.element.dataset.stepIndex).toBe("3");
      expect(view.element.dataset.playing).toBe("true");
      expect(schedulePlayback).toHaveBeenCalledTimes(1);
      expect(clearPlayback).not.toHaveBeenCalled();

      toggle.click();
      view.element.querySelector<HTMLButtonElement>(
        '[data-iteration="3"] [data-outline-action="inspect"]'
      )!.click();
      expect(view.element.dataset.playing).toBe("false");
      expect(view.element.dataset.stepIndex).toBe("5");
      expect(clearPlayback).toHaveBeenCalledExactlyOnceWith(playbackTimer);
      vi.advanceTimersByTime(1400);
      expect(view.element.dataset.stepIndex).toBe("5");
      expect(view.element.querySelector(".trace-viewer__step-label")?.textContent).toBe("Step 6 / 7");
    } finally {
      view.dispose();
      schedulePlayback.mockRestore();
      clearPlayback.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps raw Previous and Next one-step navigation when folds exist", () => {
    const view = createTraceVisualizer(repeatedTransitionFoldSession());
    view.setStep(2);
    view.element.querySelector<HTMLButtonElement>("#trace-next")!.click();
    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent).toContain("Step 4 /");
    view.element.querySelector<HTMLButtonElement>("#trace-previous")!.click();
    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent).toContain("Step 3 /");
  });

  it("synchronizes expanded motif repetition navigation to one raw step", () => {
    const base = repeatedTransitionFoldSession();
    // Preserve the accepted priming event and six-event motif; add captured output
    // to distinguish the destination's accumulated stdout from adjacent steps.
    const captured: TraceSession = {
      ...base,
      events: base.events.map((event) => ({ ...event, stdoutDelta: `captured ${event.step}\n` })),
      stdout: "captured 1\ncaptured 2\ncaptured 3\ncaptured 4\ncaptured 5\ncaptured 6\ncaptured 7\n"
    };
    const view = createTraceVisualizer(captured);
    view.setStep(2);
    expect(view.element.querySelector('[data-pointer-name="left"]')?.getAttribute("data-pointer-index")).toBe("1");
    expect(view.element.querySelector('[data-local-name="left"] .trace-viewer__local-value')?.textContent).toBe("1");
    expect(view.element.querySelector(".trace-viewer__mutations")?.textContent).toContain("0 → 1");
    expect(view.element.querySelector(".trace-viewer__call-line")?.textContent).toBe("line 6");
    expect(view.element.querySelector(".trace-viewer__stdout pre")?.textContent).toBe("captured 1\ncaptured 2\ncaptured 3\n");
    view.element.querySelector<HTMLButtonElement>(
      '[data-segment-kind="repeated_transition_fold"] [data-outline-action="toggle"]'
    )!.click();
    view.element.querySelector<HTMLButtonElement>(
      '[data-iteration="2"] [data-outline-action="inspect"]'
    )!.click();

    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent).toBe("Step 4 / 7");
    expect(view.element.querySelector(".trace-viewer__timeline-current")?.textContent).toBe("Step 4 / 7");
    expect(view.element.querySelector<HTMLElement>(".trace-viewer__code-line.is-active")?.dataset.line).toBe("5");
    expect(view.element.querySelector('[data-iteration="2"]')?.classList.contains("is-active")).toBe(true);
    expect(view.element.dataset.stepIndex).toBe("3");
    expect(view.element.querySelector(".trace-viewer__visual-state-body .trace-viewer__state-meta")?.textContent).toBe("Line 5");
    expect(view.element.querySelector('[data-pointer-name="left"]')?.getAttribute("data-pointer-index")).toBe("0");
    const mutations = view.element.querySelectorAll(".trace-viewer__mutation-row");
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.querySelector(".trace-viewer__mutation-name")?.textContent).toBe("left");
    expect(mutations[0]?.querySelector(".trace-viewer__mutation-value")?.textContent).toBe("1 → 0");
    expect(view.element.querySelector('[data-local-name="left"] .trace-viewer__local-value')?.textContent).toBe("0");
    expect(view.element.querySelectorAll(".trace-viewer__call-frame")).toHaveLength(1);
    expect(view.element.querySelector(".trace-viewer__call-frame.is-active code")?.textContent).toBe("twoSum");
    expect(view.element.querySelector(".trace-viewer__call-frame.is-active .trace-viewer__call-line")?.textContent).toBe("line 5");
    expect(view.element.querySelector(".trace-viewer__stdout pre")?.textContent).toBe("captured 1\ncaptured 2\ncaptured 3\ncaptured 4\n");
    view.dispose();
  });

  it("renders one raw-only outline when no fold is eligible", () => {
    const view = createTraceVisualizer(session());
    expect(view.element.querySelectorAll('[data-segment-kind="raw_range"]')).toHaveLength(1);
    expect(view.element.querySelector('[data-segment-kind="repeated_transition_fold"]')).toBeNull();
  });

  it("keeps timeout-prefix fold wording factual", () => {
    const timedOut: TraceSession = {
      ...repeatedTransitionFoldSession(),
      status: "timeout",
      terminationReason: "hard_timeout"
    };
    const text = createTraceVisualizer(timedOut).element.textContent ?? "";
    expect(text).not.toMatch(/LeetCode TLE|root cause|caused the timeout|infinite loop/i);
  });

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

  it("scrubs the raw timeline through setStep", () => {
    const view = createTraceVisualizer(alternatingRepeatedStateSession());
    const range = view.element.querySelector<HTMLInputElement>('[data-role="trace-range"]')!;
    range.value = "4";

    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
      .toBe("Step 5 / 5");
  });

  it("navigates a behavioral timeline band to its first evidence", () => {
    const view = createTraceVisualizer(alternatingRepeatedStateSession());
    view.setStep(4);
    const band = view.element.querySelector<HTMLButtonElement>(
      '.trace-viewer__timeline-band[data-pattern-kind="repeated_state"]'
    )!;

    band.click();

    expect(view.element.querySelector(".trace-viewer__step-label")?.textContent)
      .toBe("Step 1 / 5");
  });

  it("keeps timeline position synchronized with raw Previous and Next navigation", () => {
    const view = createTraceVisualizer(alternatingRepeatedStateSession());
    const range = view.element.querySelector<HTMLInputElement>('[data-role="trace-range"]')!;

    view.element.querySelector<HTMLButtonElement>("#trace-next")!.click();

    expect(range.value).toBe("1");
    expect(view.element.querySelector(".trace-viewer__timeline-current")?.textContent)
      .toBe("Step 2 / 5");
  });

  it("keeps a raw scrubber when no behavioral pattern exists", () => {
    const view = createTraceVisualizer(session());

    expect(view.element.querySelector('[data-role="trace-range"]')).not.toBeNull();
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

  it("keeps Tree state synchronized with direct raw-step navigation", () => {
    const view = createTraceVisualizer(treeSession());
    expect(view.element.querySelector('[data-node-id="obj-2"]')).toBeNull();

    view.setStep(1);

    expect(view.element.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
    expect(view.element.querySelector(
      '[data-edge-from="obj-1"][data-edge-to="obj-2"][data-edge-field="left"]'
    )).not.toBeNull();
    expect(view.element.querySelector('[data-pointer-name="child"]')).not.toBeNull();
  });

  it("updates Tree through the existing autoplay cursor", () => {
    vi.useFakeTimers();
    try {
      const view = createTraceVisualizer(treeSession());
      view.element.querySelector<HTMLButtonElement>("#trace-play")!.click();
      vi.advanceTimersByTime(700);
      expect(view.element.dataset.stepIndex).toBe("1");
      expect(view.element.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
      view.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates Tree when a behavioral timeline band navigates the raw cursor", () => {
    const view = createTraceVisualizer(treeBehaviorSession());
    view.setStep(4);
    const band = view.element.querySelector<HTMLButtonElement>(
      '.trace-viewer__timeline-band[data-pattern-kind="repeated_state"]'
    )!;
    band.click();

    expect(view.element.dataset.stepIndex).toBe("0");
    expect(view.element.querySelector('[data-node-id="obj-1"]')).not.toBeNull();
    expect(view.element.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
    expect(view.element.querySelector('[data-edge-from="obj-1"][data-edge-to="obj-2"]')).not.toBeNull();
  });

  it("updates Tree when Failure-First Inspect navigates through the existing owner", () => {
    const view = createTraceVisualizer(treeFailureFirstSession());
    view.element.querySelector<HTMLButtonElement>(
      ".trace-viewer__failure-first-inspect"
    )!.click();

    expect(view.element.dataset.stepIndex).toBe("5");
    expect(view.element.querySelector('[data-node-id="obj-1"]')).not.toBeNull();
    expect(view.element.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
    expect(view.element.querySelector('[data-edge-from="obj-1"][data-edge-to="obj-2"]')).not.toBeNull();
  });

  it("keeps one Graph visualizer handle while direct raw-step navigation updates connections", () => {
    const view = createTraceVisualizer(graphSession());
    const graph = view.element.querySelector<HTMLElement>(".graph-visualizer");

    expect(graphConnection(view.element).dataset.reciprocal).toBe("false");
    expect(graphConnection(view.element).dataset.edgeForward).toBe("obj-1→obj-2");

    view.setStep(1);

    expect(view.element.querySelector<HTMLElement>(".graph-visualizer")).toBe(graph);
    expect(graphConnection(view.element).dataset.reciprocal).toBe("true");
    expect(graphConnection(view.element).dataset.edgeReverse).toBe("obj-2→obj-1");
    view.dispose();
  });

  it("keeps visualizer positions stable when runtime ranking changes", () => {
    const view = createTraceVisualizer(graphWithMappingSession());
    const initialOrder = [...view.element.querySelectorAll<HTMLElement>("[data-visual-id]")]
      .map((element) => element.dataset.visualId);
    expect(initialOrder).toEqual(["graph:Node", "dict:copies"]);

    view.setStep(1);

    const updatedOrder = [...view.element.querySelectorAll<HTMLElement>("[data-visual-id]")]
      .map((element) => element.dataset.visualId);
    expect(updatedOrder).toEqual(initialOrder);
    view.dispose();
  });

  it("keeps Graph state synchronized with the existing autoplay cursor", () => {
    vi.useFakeTimers();
    try {
      const view = createTraceVisualizer(graphSession());
      view.element.querySelector<HTMLButtonElement>("#trace-play")!.click();
      vi.advanceTimersByTime(700);

      expect(view.element.dataset.stepIndex).toBe("1");
      expect(graphConnection(view.element).dataset.reciprocal).toBe("true");
      expect(view.element.querySelector('[data-node-id="obj-2"]')).not.toBeNull();
      view.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconstructs Graph state when Behavioral Timeline navigates to a raw step", () => {
    const view = createTraceVisualizer(graphPatternSession());
    const band = view.element.querySelector<HTMLButtonElement>(
      '.trace-viewer__timeline-band[data-pattern-kind="repeated_transition"]'
    );

    expect(band).not.toBeNull();
    band!.click();

    expect(view.element.dataset.stepIndex).toBe("1");
    expect(graphConnection(view.element).dataset.reciprocal).toBe("true");
    expect(graphConnection(view.element).dataset.edgeForward).toBe("obj-1→obj-2");
    view.dispose();
  });

  it("reconstructs Graph state when Failure-First Inspect lands on terminal evidence", () => {
    const view = createTraceVisualizer(graphPatternSession("timeout"));
    const inspect = view.element.querySelector<HTMLButtonElement>(
      ".trace-viewer__failure-first-inspect"
    );

    expect(inspect).not.toBeNull();
    inspect!.click();

    expect(view.element.dataset.stepIndex).toBe("5");
    expect(graphConnection(view.element).dataset.reciprocal).toBe("true");
    expect(graphConnection(view.element).dataset.edgeForward).toBe("obj-1→obj-2");
    view.dispose();
  });

  it("reconstructs Graph state when a folded Outline iteration is inspected", () => {
    const view = createTraceVisualizer(graphPatternSession());
    const toggle = view.element.querySelector<HTMLButtonElement>(
      ".trace-viewer__outline-toggle"
    );

    expect(toggle).not.toBeNull();
    toggle!.click();
    const lastIteration = view.element.querySelector<HTMLButtonElement>(
      '[data-iteration="3"] .trace-viewer__outline-inspect'
    );

    expect(lastIteration).not.toBeNull();
    lastIteration!.click();

    expect(view.element.dataset.stepIndex).toBe("5");
    expect(graphConnection(view.element).dataset.reciprocal).toBe("true");
    expect(graphConnection(view.element).dataset.edgeForward).toBe("obj-1→obj-2");
    view.dispose();
  });
});

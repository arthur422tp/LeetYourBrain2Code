import { describe, expect, it, vi } from "vitest";

import type { BehavioralAnalysis } from "../../src/core/behavioral-pattern";
import {
  buildTraceStepIndex,
  resolveBehavioralEvidenceMap
} from "../../src/sidepanel/behavioral-navigation";
import { createBehavioralTimeline } from "../../src/sidepanel/components/BehavioralTimeline";

const analysis: BehavioralAnalysis = {
  patterns: [
    {
      kind: "repeated_state",
      patternId: "state",
      startStep: 10,
      endStep: 70,
      repeatCount: 3,
      evidenceSteps: [10, 30, 70],
      location: { frameId: 1, functionName: "solve", line: 5 },
      stateFingerprintKey: "hash"
    },
    {
      kind: "no_progress",
      patternId: "progress",
      startStep: 30,
      endStep: 70,
      repeatCount: 3,
      revisitCount: 2,
      evidenceSteps: [30, 50, 70],
      location: { frameId: 1, functionName: "solve", line: 5 }
    },
    {
      kind: "repeated_transition",
      patternId: "transition",
      startStep: 10,
      endStep: 70,
      repeatCount: 3,
      evidenceSteps: [10, 30, 50, 70],
      periodSteps: 2,
      motifKeys: ["A", "B"]
    }
  ],
  stepAnnotations: []
};

function overlappingRepeatedStateAnalysis(): BehavioralAnalysis {
  return {
    patterns: [
      {
        kind: "repeated_state",
        patternId: "a",
        startStep: 10,
        endStep: 50,
        repeatCount: 3,
        evidenceSteps: [10, 30, 50],
        location: { frameId: 1, functionName: "solve", line: 5 },
        stateFingerprintKey: "a"
      },
      {
        kind: "repeated_state",
        patternId: "b",
        startStep: 30,
        endStep: 70,
        repeatCount: 3,
        evidenceSteps: [30, 50, 70],
        location: { frameId: 1, functionName: "solve", line: 8 },
        stateFingerprintKey: "b"
      }
    ],
    stepAnnotations: []
  };
}

function nonOverlappingRepeatedStateAnalysis(): BehavioralAnalysis {
  return {
    patterns: [
      {
        kind: "repeated_state",
        patternId: "a",
        startStep: 10,
        endStep: 30,
        repeatCount: 2,
        evidenceSteps: [10, 30],
        location: { frameId: 1, functionName: "solve", line: 5 },
        stateFingerprintKey: "a"
      },
      {
        kind: "repeated_state",
        patternId: "b",
        startStep: 50,
        endStep: 70,
        repeatCount: 2,
        evidenceSteps: [50, 70],
        location: { frameId: 1, functionName: "solve", line: 8 },
        stateFingerprintKey: "b"
      }
    ],
    stepAnnotations: []
  };
}

function touchingRepeatedStateAnalysis(): BehavioralAnalysis {
  return {
    patterns: [
      {
        kind: "repeated_state",
        patternId: "a",
        startStep: 10,
        endStep: 30,
        repeatCount: 2,
        evidenceSteps: [10, 30],
        location: { frameId: 1, functionName: "solve", line: 5 },
        stateFingerprintKey: "a"
      },
      {
        kind: "repeated_state",
        patternId: "b",
        startStep: 30,
        endStep: 50,
        repeatCount: 2,
        evidenceSteps: [30, 50],
        location: { frameId: 1, functionName: "solve", line: 8 },
        stateFingerprintKey: "b"
      }
    ],
    stepAnnotations: []
  };
}

function shuffledRepeatedStateAnalysis(): BehavioralAnalysis {
  return {
    patterns: [
      {
        kind: "repeated_state",
        patternId: "later",
        startStep: 50,
        endStep: 70,
        repeatCount: 2,
        evidenceSteps: [50, 70],
        location: { frameId: 1, functionName: "solve", line: 11 },
        stateFingerprintKey: "later"
      },
      {
        kind: "repeated_state",
        patternId: "zeta",
        startStep: 10,
        endStep: 30,
        repeatCount: 2,
        evidenceSteps: [10, 30],
        location: { frameId: 1, functionName: "solve", line: 8 },
        stateFingerprintKey: "zeta"
      },
      {
        kind: "repeated_state",
        patternId: "beta",
        startStep: 10,
        endStep: 30,
        repeatCount: 2,
        evidenceSteps: [10, 30],
        location: { frameId: 1, functionName: "solve", line: 5 },
        stateFingerprintKey: "beta"
      }
    ],
    stepAnnotations: []
  };
}

function render(currentIndex = 0, onNavigate = vi.fn()) {
  const traceIndex = buildTraceStepIndex([10, 30, 50, 70]);
  const evidenceByPatternId = resolveBehavioralEvidenceMap(analysis.patterns, traceIndex);
  return {
    handle: createBehavioralTimeline({
      analysis,
      traceIndex,
      evidenceByPatternId,
      currentIndex,
      onNavigate
    }),
    onNavigate
  };
}

describe("createBehavioralTimeline", () => {
  it("renders a raw trace range and current position", () => {
    const { handle } = render(1);
    const range = handle.element.querySelector<HTMLInputElement>('[data-role="trace-range"]')!;

    expect(range.min).toBe("0");
    expect(range.max).toBe("3");
    expect(range.value).toBe("1");
    expect(handle.element.textContent).toContain("Step 2 / 4");
  });

  it("emits the requested raw index when the range changes", () => {
    const { handle, onNavigate } = render();
    const range = handle.element.querySelector<HTMLInputElement>('[data-role="trace-range"]')!;
    range.value = "2";

    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onNavigate).toHaveBeenCalledWith(2);
  });

  it("renders one lane for every pattern kind present", () => {
    const { handle } = render();

    expect(handle.element.querySelectorAll('[data-timeline-kind="repeated_state"]')).toHaveLength(1);
    expect(handle.element.querySelectorAll('[data-timeline-kind="no_progress"]')).toHaveLength(1);
    expect(handle.element.querySelectorAll('[data-timeline-kind="repeated_transition"]')).toHaveLength(1);
  });

  it("puts overlapping same-kind bands on separate subtracks", () => {
    const analysis = overlappingRepeatedStateAnalysis();
    const traceIndex = buildTraceStepIndex([10, 30, 50, 70]);
    const handle = createBehavioralTimeline({
      analysis,
      traceIndex,
      evidenceByPatternId: resolveBehavioralEvidenceMap(analysis.patterns, traceIndex),
      currentIndex: 0,
      onNavigate: vi.fn()
    });

    const bands = [...handle.element.querySelectorAll<HTMLButtonElement>(
      '[data-timeline-kind="repeated_state"] .trace-viewer__timeline-band'
    )];
    expect(bands.map((band) => band.dataset.subtrack)).toEqual(["0", "1"]);
    expect(handle.element.querySelector('[data-timeline-kind="repeated_state"]')?.getAttribute("data-subtrack-count"))
      .toBe("2");
  });

  it("keeps stacked bands above non-interactive subtrack backgrounds", () => {
    const analysis = overlappingRepeatedStateAnalysis();
    const traceIndex = buildTraceStepIndex([10, 30, 50, 70]);
    const handle = createBehavioralTimeline({
      analysis,
      traceIndex,
      evidenceByPatternId: resolveBehavioralEvidenceMap(analysis.patterns, traceIndex),
      currentIndex: 0,
      onNavigate: vi.fn()
    });

    const lane = handle.element.querySelector('[data-timeline-kind="repeated_state"]')!;
    const bands = [...lane.querySelectorAll<HTMLButtonElement>(".trace-viewer__timeline-band")];
    const subtracks = [...lane.querySelectorAll<HTMLDivElement>(".trace-viewer__timeline-subtrack")];

    expect(bands.map((band) => band.style.zIndex)).toEqual(["1", "1"]);
    expect(subtracks.map((subtrack) => subtrack.style.pointerEvents)).toEqual(["none", "none"]);
  });

  it("uses resolved interval order and pattern ID as deterministic layout tie-breakers", () => {
    const analysis = shuffledRepeatedStateAnalysis();
    const traceIndex = buildTraceStepIndex([10, 30, 50, 70]);
    const handle = createBehavioralTimeline({
      analysis,
      traceIndex,
      evidenceByPatternId: resolveBehavioralEvidenceMap(analysis.patterns, traceIndex),
      currentIndex: 1,
      onNavigate: vi.fn()
    });

    const bands = [...handle.element.querySelectorAll<HTMLButtonElement>(
      '[data-timeline-kind="repeated_state"] .trace-viewer__timeline-band'
    )];
    expect(bands.map((band) => band.dataset.patternId)).toEqual(["beta", "zeta", "later"]);
    expect(bands.filter((band) => band.classList.contains("is-active"))).toHaveLength(2);
  });

  it("separates bands that share a closed-interval endpoint", () => {
    const analysis = touchingRepeatedStateAnalysis();
    const traceIndex = buildTraceStepIndex([10, 30, 50, 70]);
    const handle = createBehavioralTimeline({
      analysis,
      traceIndex,
      evidenceByPatternId: resolveBehavioralEvidenceMap(analysis.patterns, traceIndex),
      currentIndex: 0,
      onNavigate: vi.fn()
    });

    const bands = [...handle.element.querySelectorAll<HTMLButtonElement>(
      '[data-timeline-kind="repeated_state"] .trace-viewer__timeline-band'
    )];
    expect(bands.map((band) => band.dataset.subtrack)).toEqual(["0", "1"]);
  });

  it("reuses a subtrack for non-overlapping same-kind bands", () => {
    const analysis = nonOverlappingRepeatedStateAnalysis();
    const traceIndex = buildTraceStepIndex([10, 30, 50, 70]);
    const handle = createBehavioralTimeline({
      analysis,
      traceIndex,
      evidenceByPatternId: resolveBehavioralEvidenceMap(analysis.patterns, traceIndex),
      currentIndex: 0,
      onNavigate: vi.fn()
    });

    const bands = [...handle.element.querySelectorAll<HTMLButtonElement>(
      '[data-timeline-kind="repeated_state"] .trace-viewer__timeline-band'
    )];
    expect(bands.map((band) => band.dataset.subtrack)).toEqual(["0", "0"]);
  });

  it("positions a band from first valid evidence to last valid evidence", () => {
    const { handle } = render();
    const band = handle.element.querySelector<HTMLButtonElement>('[data-pattern-id="state"]')!;

    expect(band.style.left).toBe("0%");
    expect(band.style.width).toBe("100%");
  });

  it("navigates a band to its first valid evidence index", () => {
    const { handle, onNavigate } = render(3);

    handle.element.querySelector<HTMLButtonElement>('[data-pattern-id="state"]')!.click();

    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it("updates current position and exact active-band evidence without rebuilding", () => {
    const { handle } = render(0);
    const stateBand = handle.element.querySelector<HTMLButtonElement>('[data-pattern-id="state"]')!;

    handle.setCurrentIndex(2); // step 50 is not repeated-state evidence
    expect(handle.element.textContent).toContain("Step 3 / 4");
    expect(stateBand.classList.contains("is-active")).toBe(false);

    handle.setCurrentIndex(3); // step 70 is repeated-state evidence
    expect(stateBand.classList.contains("is-active")).toBe(true);
  });

  it("renders raw scrubbing but a neutral behavioral message when no patterns exist", () => {
    const traceIndex = buildTraceStepIndex([1, 2]);
    const handle = createBehavioralTimeline({
      analysis: { patterns: [], stepAnnotations: [] },
      traceIndex,
      evidenceByPatternId: new Map(),
      currentIndex: 0,
      onNavigate: vi.fn()
    });

    expect(handle.element.querySelector('[data-role="trace-range"]')).not.toBeNull();
    expect(handle.element.textContent).toContain("No repeated behavioral regions in the captured trace.");
  });

  it("renders no invalid range for an empty trace", () => {
    const handle = createBehavioralTimeline({
      analysis: { patterns: [], stepAnnotations: [] },
      traceIndex: buildTraceStepIndex([]),
      evidenceByPatternId: new Map(),
      currentIndex: 0,
      onNavigate: vi.fn()
    });

    expect(handle.element.querySelector('[data-role="trace-range"]')).toBeNull();
    expect(handle.element.textContent).toContain("No execution steps were captured.");
  });

  it("gives every band an accessible evidence label", () => {
    const { handle } = render();
    const labels = [...handle.element.querySelectorAll<HTMLButtonElement>(".trace-viewer__timeline-band")]
      .map((button) => button.getAttribute("aria-label"));

    expect(labels.every((label) => label?.includes("evidence span"))).toBe(true);
  });
});

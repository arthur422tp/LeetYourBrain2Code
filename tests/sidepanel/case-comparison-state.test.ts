import { describe, expect, it } from "vitest";

import type { TraceSession } from "../../src/shared/trace-types";
import {
  createCaseComparisonState,
  type CaseComparisonSelection
} from "../../src/sidepanel/case-comparison-state";
import type { RunRecord } from "../../src/sidepanel/run-comparison-state";

function run(sessionId: string, selectedCaseIndex: number): RunRecord {
  return {
    session: { sessionId } as TraceSession,
    context: {
      problemSlug: "two-sum",
      problemTitle: "Two Sum",
      selectedCaseIndex,
      language: "python"
    }
  };
}

function selection(left: RunRecord | null, right: RunRecord | null): CaseComparisonSelection {
  return { left, right };
}

describe("case comparison selection state", () => {
  it("starts with no selected cases", () => {
    expect(createCaseComparisonState().get()).toEqual(selection(null, null));
  });

  it("selects a left case explicitly", () => {
    const state = createCaseComparisonState();
    const left = run("left", 0);

    state.selectLeft(left);

    expect(state.get()).toEqual(selection(left, null));
  });

  it("selects a right case explicitly", () => {
    const state = createCaseComparisonState();
    const right = run("right", 2);

    state.selectRight(right);

    expect(state.get()).toEqual(selection(null, right));
  });

  it("replaces only the left selection when a new left case is chosen", () => {
    const state = createCaseComparisonState();
    const right = run("right", 2);
    const firstLeft = run("left-1", 0);
    const secondLeft = run("left-2", 1);
    state.selectRight(right);
    state.selectLeft(firstLeft);

    state.selectLeft(secondLeft);

    expect(state.get()).toEqual(selection(secondLeft, right));
  });

  it("replaces only the right selection when a new right case is chosen", () => {
    const state = createCaseComparisonState();
    const left = run("left", 0);
    const firstRight = run("right-1", 1);
    const secondRight = run("right-2", 2);
    state.selectLeft(left);
    state.selectRight(firstRight);

    state.selectRight(secondRight);

    expect(state.get()).toEqual(selection(left, secondRight));
  });

  it("clears each side independently", () => {
    const state = createCaseComparisonState();
    const left = run("left", 0);
    const right = run("right", 2);
    state.selectLeft(left);
    state.selectRight(right);

    state.clearLeft();
    expect(state.get()).toEqual(selection(null, right));

    state.clearRight();
    expect(state.get()).toEqual(selection(null, null));
  });

  it("clears both sides explicitly", () => {
    const state = createCaseComparisonState();
    state.selectLeft(run("left", 0));
    state.selectRight(run("right", 2));

    state.clear();

    expect(state.get()).toEqual(selection(null, null));
  });

  it("clears both sides when the active problem changes", () => {
    const state = createCaseComparisonState();
    state.selectLeft(run("left", 0));
    state.selectRight(run("right", 2));

    state.clearForProblemChange();

    expect(state.get()).toEqual(selection(null, null));
  });

  it("keeps selected accepted snapshots stable while a separate live run changes", () => {
    const state = createCaseComparisonState();
    const left = run("left", 0);
    const right = run("right", 2);
    const live = run("live", 1);
    state.selectLeft(left);
    state.selectRight(right);

    live.context.selectedCaseIndex = 3;

    expect(state.get()).toEqual(selection(left, right));
    expect(state.get().left).toBe(left);
    expect(state.get().right).toBe(right);
  });
});

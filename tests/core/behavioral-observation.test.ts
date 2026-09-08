import { describe, expect, it } from "vitest";

import type { RuntimeMutation, RuntimeMutationBatch } from "../../src/core/runtime-mutation";
import type { FrameState, RuntimeState } from "../../src/core/runtime-state";
import type { ObjectSnapshot, ValueSnapshot } from "../../src/shared/trace-types";
import { buildBehavioralObservations } from "../../src/core/behavioral-observation";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function frame(
  frameId: number,
  locals: Record<string, ValueSnapshot> = { left: int(2) },
  overrides: Partial<FrameState> = {}
): FrameState {
  return {
    frameId,
    parentFrameId: null,
    functionName: "solve",
    line: 5,
    locals,
    ...overrides
  };
}

function state(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    step: 1,
    activeFrameId: 1,
    frames: new Map([[1, frame(1)]]),
    callStack: [1],
    currentLine: 5,
    stdout: "",
    objectTopology: { objects: new Map(), truncated: false },
    ...overrides
  };
}

function batch(
  step: number,
  mutations: RuntimeMutation[] = []
): RuntimeMutationBatch {
  return { step, frameId: 1, currentLine: 5, mutations };
}

describe("buildBehavioralObservations state fingerprints", () => {
  it("gives exact-equal states equal normalized keys", () => {
    const values = buildBehavioralObservations(
      [state({ step: 1 }), state({ step: 2 })],
      [batch(1), batch(2)]
    );

    expect(values[0]!.normalizedStateKey).toBe(values[1]!.normalizedStateKey);
    expect(values[0]!.stateFingerprint?.key).toBe(values[1]!.stateFingerprint?.key);
  });

  it("treats stdout growth as observable progress", () => {
    const values = buildBehavioralObservations(
      [state({ step: 1, stdout: "" }), state({ step: 2, stdout: "x" })],
      [batch(1), batch(2)]
    );

    expect(values[0]!.normalizedStateKey).not.toBe(values[1]!.normalizedStateKey);
  });

  it("keeps frame identity in the location key", () => {
    const values = buildBehavioralObservations(
      [
        state({ step: 1 }),
        state({
          step: 2,
          activeFrameId: 2,
          frames: new Map([[2, frame(2)]]),
          callStack: [2]
        })
      ],
      [batch(1), { ...batch(2), frameId: 2 }]
    );

    expect(values[0]!.locationKey).toBe("1:solve:5");
    expect(values[1]!.locationKey).toBe("2:solve:5");
    expect(values[0]!.locationKey).not.toBe(values[1]!.locationKey);
  });

  it("does not include the current anchor line in normalized state equality", () => {
    const values = buildBehavioralObservations(
      [
        state({ step: 1, currentLine: 5 }),
        state({ step: 2, currentLine: 8, frames: new Map([[1, frame(1, { left: int(2) }, { line: 8 })]]) })
      ],
      [batch(1), { ...batch(2), currentLine: 8 }]
    );

    expect(values[0]!.normalizedStateKey).toBe(values[1]!.normalizedStateKey);
  });

  it("marks truncated topology incomplete", () => {
    const [value] = buildBehavioralObservations([
      state({ objectTopology: { objects: new Map(), truncated: true } })
    ], [batch(1)]);

    expect(value!.stateFingerprint?.complete).toBe(false);
  });

  it("marks recursively truncated locals, returns, and object attributes incomplete", () => {
    const truncatedList: ValueSnapshot = {
      type: "list",
      length: 1,
      items: [{ type: "int", value: "1" }],
      truncated: true
    };
    const values = buildBehavioralObservations([
      state({
        frames: new Map([[1, frame(1, { values: truncatedList }, {
          returnValue: truncatedList
        })]]),
        objectTopology: {
          truncated: false,
          objects: new Map([[
            "obj-1",
            {
              objectId: "obj-1",
              className: "Node",
              attributes: { child: truncatedList }
            }
          ]])
        }
      })
    ], [batch(1)]);

    expect(values[0]!.stateFingerprint?.complete).toBe(false);
  });

  it("canonicalizes frame and object insertion order", () => {
    const firstObject: ObjectSnapshot = {
      objectId: "obj-1",
      className: "Node",
      attributes: { b: int(2), a: int(1) }
    };
    const secondObject: ObjectSnapshot = {
      objectId: "obj-2",
      className: "Node",
      attributes: { value: int(3) }
    };
    const values = buildBehavioralObservations([
      state({
        step: 1,
        objectTopology: {
          truncated: false,
          objects: new Map([["obj-2", secondObject], ["obj-1", firstObject]])
        }
      }),
      state({
        step: 2,
        objectTopology: {
          truncated: false,
          objects: new Map([["obj-1", { ...firstObject, attributes: { a: int(1), b: int(2) } }], ["obj-2", secondObject]])
        }
      })
    ], [batch(1), batch(2)]);

    expect(values[0]!.normalizedStateKey).toBe(values[1]!.normalizedStateKey);
  });
});

describe("buildBehavioralObservations transition fingerprints", () => {
  it("normalizes changing scalar values to one mutation shape", () => {
    const mutation = (before: number, after: number): RuntimeMutation => ({
      kind: "variable",
      origin: "transition",
      frameId: 1,
      variableName: "i",
      action: "changed",
      before: int(before),
      after: int(after)
    });
    const values = buildBehavioralObservations(
      [state({ step: 1, frames: new Map([[1, frame(1, { i: int(0) })]]) }), state({ step: 2, frames: new Map([[1, frame(1, { i: int(1) })]]) })],
      [batch(1, [mutation(0, 1)]), batch(2, [mutation(1, 2)])]
    );

    expect(values[0]!.transitionFingerprint.key).toBe(values[1]!.transitionFingerprint.key);
  });

  it("wildcards sequence indexes and object reference identities", () => {
    const first = buildBehavioralObservations([
      state({ step: 1 }),
      state({ step: 2 })
    ], [
      batch(1, [{
        kind: "sequence_element",
        origin: "transition",
        frameId: 1,
        containerName: "nums",
        containerKind: "list",
        index: 0,
        action: "changed",
        before: int(1),
        after: int(2)
      }]),
      batch(2, [{
        kind: "sequence_element",
        origin: "transition",
        frameId: 1,
        containerName: "nums",
        containerKind: "list",
        index: 1,
        action: "changed",
        before: int(2),
        after: int(3)
      }])
    ]);
    const second = buildBehavioralObservations([
      state({ step: 1 }),
      state({ step: 2 })
    ], [
      batch(1, [{
        kind: "reference",
        origin: "transition",
        owner: { scope: "object_attribute", objectId: "obj-1", attribute: "next" },
        action: "redirected",
        beforeObjectId: "obj-2",
        afterObjectId: "obj-3"
      }]),
      batch(2, [{
        kind: "reference",
        origin: "transition",
        owner: { scope: "object_attribute", objectId: "obj-4", attribute: "next" },
        action: "redirected",
        beforeObjectId: "obj-5",
        afterObjectId: "obj-6"
      }])
    ]);

    expect(first[0]!.transitionFingerprint.key).toBe(first[1]!.transitionFingerprint.key);
    expect(second[0]!.transitionFingerprint.key).toBe(second[1]!.transitionFingerprint.key);
  });

  it("keeps an empty transition explicit and excludes initialization", () => {
    const values = buildBehavioralObservations(
      [state({ step: 1 }), state({ step: 2 }), state({ step: 3 })],
      [
        batch(1, []),
        batch(2, [{
          kind: "variable",
          origin: "initial_snapshot",
          frameId: 1,
          variableName: "i",
          action: "added",
          after: int(0)
        }]),
        batch(3, [])
      ]
    );

    expect(values[0]!.transitionFingerprint.key).toContain("|none");
    expect(values[0]!.transitionFingerprint.eligible).toBe(true);
    expect(values[1]!.transitionFingerprint.eligible).toBe(false);
    expect(values[2]!.transitionFingerprint.eligible).toBe(true);
  });
});

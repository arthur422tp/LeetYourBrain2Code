import { describe, expect, it } from "vitest";
import { controlFlowActivationKey, iterationActivationKey } from "../../src/core/control-flow-scope";
import { buildControlFlowEvidence } from "../../src/core/control-flow-interpreter";

describe("activation scope", () => {
  it("retains top-level activation across raw iterations and separates frames", () => {
    for (const iteration of [1, 2]) expect(controlFlowActivationKey(3, "f1", { loopStack: [{ loopId: "f1", iteration }] })).toBe("3:root>f1");
    expect(controlFlowActivationKey(4, "f1", { loopStack: [] })).toBe("4:root>f1");
  });
  it("groups repeated inner loops by their parent occurrence", () => {
    const contexts = [1, 2].map(iteration => ({ loopStack: [{ loopId: "f1", iteration }, { loopId: "f2", iteration }] }));
    const result = buildControlFlowEvidence(undefined, [{
batchId: 1, events: contexts.flatMap((context, i) => [
        { kind: "iteration_begin" as const, eventId: i * 2, anchorStep: i * 3, frameId: 1, context, loopId: "f2", loopKind: "for" as const, iteration: i + 1, bindings: [] },
        { kind: "iteration_complete" as const, eventId: i * 2 + 1, anchorStep: i * 3 + 1, frameId: 1, context, loopId: "f2", iteration: i + 1 }
      ])
}], []);
    expect([...result.iterationsByActivation.keys()]).toEqual(["1:f1#1>f2", "1:f1#2>f2"]);
    expect(iterationActivationKey(result.iterations[1]!)).toBe("1:f1#2>f2");
    expect(result.iterationsByActivation.get("1:f1#1>f2")).toHaveLength(1);
  });
});

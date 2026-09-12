import { describe, expect, it } from "vitest";

import {
  connectedComponents,
  type TopologyComponentBase
} from "../../src/core/topology/components";
import {
  buildActiveObjectPointers,
  type ObjectPointerVisual
} from "../../src/core/topology/pointers";
import { rankComponentsByPointerCoverage } from "../../src/core/topology/ranking";
import type { RuntimeState } from "../../src/core/runtime-state";
import type { RuntimeMutation } from "../../src/core/runtime-mutation";
import type { ObjectSnapshot, ValueSnapshot } from "../../src/shared/trace-types";

const reference = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "Node"
});

function runtimeWithLocals(locals: Record<string, ValueSnapshot>): RuntimeState {
  return {
    step: 1,
    activeFrameId: 4,
    frames: new Map([[
      4,
      {
        frameId: 4,
        parentFrameId: null,
        functionName: "solve",
        line: 2,
        locals
      }
    ]]),
    callStack: [4],
    currentLine: 2,
    stdout: "",
    objectTopology: {
      objects: new Map<string, ObjectSnapshot>(),
      truncated: false
    }
  };
}

describe("topology helpers", () => {
  it("partitions weakly connected components deterministically", () => {
    expect(connectedComponents(
      ["obj-4", "obj-1", "obj-3", "obj-2"],
      [
        { fromObjectId: "obj-2", toObjectId: "obj-1" },
        { fromObjectId: "obj-4", toObjectId: "obj-3" }
      ],
      "graph-component"
    )).toEqual([
      { componentId: "graph-component:obj-1", nodeIds: ["obj-1", "obj-2"] },
      { componentId: "graph-component:obj-3", nodeIds: ["obj-3", "obj-4"] }
    ]);
  });

  it("collects active-frame pointers and materializes an unbound candidate", () => {
    const pointers = buildActiveObjectPointers(
      runtimeWithLocals({ current: reference("obj-2"), alias: reference("obj-1") }),
      new Set(["obj-1", "obj-2"]),
      [
        {
          kind: "reference",
          origin: "transition",
          owner: { scope: "local", frameId: 4, variableName: "current" },
          action: "redirected",
          beforeObjectId: "obj-1",
          afterObjectId: "obj-2"
        },
        {
          kind: "reference",
          origin: "transition",
          owner: { scope: "local", frameId: 4, variableName: "removed" },
          action: "unbound",
          beforeObjectId: "obj-1",
          afterObjectId: null
        }
      ]
    );

    expect(pointers).toEqual([
      { variableName: "alias", objectId: "obj-1", status: "unchanged" },
      { variableName: "current", objectId: "obj-2", status: "moved" },
      { variableName: "removed", objectId: null, status: "removed" }
    ]);
  });

  it("ranks components by pointer coverage, size, then component id", () => {
    const components: TopologyComponentBase[] = [
      { componentId: "graph-component:obj-9", nodeIds: ["obj-9"] },
      { componentId: "graph-component:obj-1", nodeIds: ["obj-1", "obj-2"] },
      { componentId: "graph-component:obj-4", nodeIds: ["obj-4", "obj-5"] }
    ];
    const pointers: ObjectPointerVisual[] = [
      { variableName: "a", objectId: "obj-9", status: "unchanged" },
      { variableName: "b", objectId: "obj-9", status: "unchanged" },
      { variableName: "c", objectId: "obj-1", status: "unchanged" },
      { variableName: "d", objectId: null, status: "removed" }
    ];

    expect(rankComponentsByPointerCoverage(components, pointers)).toEqual([
      {
        componentId: "graph-component:obj-9",
        nodeIds: ["obj-9"],
        pointerCount: 2,
        role: "main"
      },
      {
        componentId: "graph-component:obj-1",
        nodeIds: ["obj-1", "obj-2"],
        pointerCount: 1,
        role: "secondary"
      },
      {
        componentId: "graph-component:obj-4",
        nodeIds: ["obj-4", "obj-5"],
        pointerCount: 0,
        role: "secondary"
      }
    ]);

    expect(rankComponentsByPointerCoverage(
      [
        { componentId: "graph-component:obj-9", nodeIds: ["obj-9"] },
        { componentId: "graph-component:obj-1", nodeIds: ["obj-1", "obj-2"] }
      ],
      []
    )[0]?.componentId).toBe("graph-component:obj-1");

    expect(rankComponentsByPointerCoverage(
      [
        { componentId: "graph-component:obj-9", nodeIds: ["obj-9"] },
        { componentId: "graph-component:obj-1", nodeIds: ["obj-1"] }
      ],
      []
    )[0]?.componentId).toBe("graph-component:obj-1");
  });
});

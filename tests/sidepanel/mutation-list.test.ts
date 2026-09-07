import { describe, expect, it } from "vitest";

import type { RuntimeMutation } from "../../src/core/runtime-mutation";
import type { ValueSnapshot } from "../../src/shared/trace-types";
import { createMutationList } from "../../src/sidepanel/components/MutationList";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

const ref = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "ListNode"
});

const string = (value: string): ValueSnapshot => ({
  type: "str",
  value,
  length: value.length,
  truncated: false
});

describe("createMutationList", () => {
  it("renders factual scalar and sequence changes", () => {
    const mutations: RuntimeMutation[] = [
      {
        kind: "variable",
        origin: "transition",
        frameId: 1,
        variableName: "left",
        action: "changed",
        before: int(2),
        after: int(3)
      },
      {
        kind: "sequence_element",
        origin: "transition",
        frameId: 1,
        containerName: "nums",
        containerKind: "list",
        index: 4,
        action: "changed",
        before: int(7),
        after: int(9)
      }
    ];

    const element = createMutationList(mutations);
    expect(element.textContent).toContain("left");
    expect(element.textContent).toContain("2 → 3");
    expect(element.textContent).toContain("nums[4]");
    expect(element.textContent).toContain("7 → 9");
  });

  it("renders mapping and set membership changes", () => {
    const element = createMutationList([
      {
        kind: "mapping_entry",
        origin: "transition",
        frameId: 1,
        containerName: "mapping",
        key: string("a"),
        action: "added",
        after: int(1)
      },
      {
        kind: "mapping_entry",
        origin: "transition",
        frameId: 1,
        containerName: "mapping",
        key: int(2),
        action: "removed",
        before: int(3)
      },
      {
        kind: "mapping_entry",
        origin: "transition",
        frameId: 1,
        containerName: "mapping",
        key: int(4),
        action: "changed",
        before: int(5),
        after: int(6)
      },
      {
        kind: "set_membership",
        origin: "transition",
        frameId: 1,
        containerName: "seen",
        action: "added",
        member: int(7)
      },
      {
        kind: "set_membership",
        origin: "transition",
        frameId: 1,
        containerName: "seen",
        action: "removed",
        member: int(8)
      }
    ]);
    const text = element.textContent ?? "";

    expect(text).toContain('mapping["a"]');
    expect(text).toContain("mapping[2]");
    expect(text).toContain("mapping[4]");
    expect(text).toContain("+ 1");
    expect(text).toContain("− 3");
    expect(text).toContain("5 → 6");
    expect(text).toContain("seen · 7");
    expect(text).toContain("seen · 8");
    expect(text).toContain("added");
    expect(text).toContain("removed");
  });

  it("renders local and object-attribute reference changes", () => {
    const element = createMutationList([
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 1, variableName: "head" },
        action: "bound",
        beforeObjectId: null,
        afterObjectId: "obj-1"
      },
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 1, variableName: "curr" },
        action: "unbound",
        beforeObjectId: "obj-2",
        afterObjectId: null
      },
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 1, variableName: "tail" },
        action: "redirected",
        beforeObjectId: "obj-2",
        afterObjectId: "obj-3"
      },
      {
        kind: "reference",
        origin: "transition",
        owner: { scope: "object_attribute", objectId: "obj-4", attribute: "next" },
        action: "redirected",
        beforeObjectId: "obj-5",
        afterObjectId: "obj-6"
      }
    ]);
    const text = element.textContent ?? "";

    expect(text).toContain("head");
    expect(text).toContain("+ obj-1");
    expect(text).toContain("curr");
    expect(text).toContain("− obj-2");
    expect(text).toContain("tail");
    expect(text).toContain("obj-2 → obj-3");
    expect(text).toContain("obj-4.next");
    expect(text).toContain("obj-5 → obj-6");
  });

  it("renders scalar object attributes and capture visibility", () => {
    const element = createMutationList([
      {
        kind: "object_attribute",
        origin: "transition",
        objectId: "obj-2",
        attribute: "val",
        action: "changed",
        before: int(2),
        after: int(4)
      },
      {
        kind: "object_visibility",
        origin: "transition",
        objectId: "obj-4",
        action: "appeared"
      },
      {
        kind: "object_visibility",
        origin: "transition",
        objectId: "obj-7",
        action: "disappeared"
      }
    ]);
    const text = element.textContent ?? "";

    expect(text).toContain("obj-2.val");
    expect(text).toContain("2 → 4");
    expect(text).toContain("obj-4");
    expect(text).toContain("appeared in captured topology");
    expect(text).toContain("obj-7");
    expect(text).toContain("disappeared from captured topology");
    expect(text).not.toMatch(/allocated|deleted|freed|garbage/i);
  });

  it("distinguishes initial observations from transition rows", () => {
    const initial = createMutationList([{
      kind: "variable",
      origin: "initial_snapshot",
      frameId: 1,
      variableName: "head",
      action: "added",
      after: ref("obj-1")
    }]);
    expect(initial.textContent).toContain("Initial observations");
    expect(initial.textContent).toContain("initial observation");

    const mixed = createMutationList([
      {
        kind: "variable",
        origin: "initial_snapshot",
        frameId: 1,
        variableName: "head",
        action: "added",
        after: ref("obj-1")
      },
      {
        kind: "variable",
        origin: "transition",
        frameId: 1,
        variableName: "count",
        action: "changed",
        before: int(1),
        after: int(2)
      }
    ]);
    expect(mixed.textContent).toContain("head");
    expect(mixed.textContent).toContain("initial observation");
    expect(mixed.textContent).toContain("count");
  });

  it("renders a neutral empty state and makes no causal source-line claim", () => {
    expect(createMutationList([]).textContent).toBe("No observed state change at this step.");

    const text = createMutationList([{
      kind: "variable",
      origin: "transition",
      frameId: 1,
      variableName: "x",
      action: "changed",
      before: int(1),
      after: int(2)
    }]).textContent ?? "";
    expect(text).not.toMatch(/line \d+ (caused|changed|moved|wrote)/i);
  });
});

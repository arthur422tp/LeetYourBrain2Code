import { describe, expect, it } from "vitest";

import {
  compareCrossRunValues,
  stableCrossRunValueKey
} from "../../src/core/cross-run-value";
import type { ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const float = (value: number | "NaN" | "Infinity" | "-Infinity"): ValueSnapshot => ({ type: "float", value });
const bool = (value: boolean): ValueSnapshot => ({ type: "bool", value });
const string = (value: string, options: Partial<Pick<Extract<ValueSnapshot, { type: "str" }>, "length" | "truncated">> = {}): ValueSnapshot => ({
  type: "str",
  value,
  length: options.length ?? value.length,
  truncated: options.truncated ?? false
});
const list = (items: ValueSnapshot[], options: Partial<Pick<Extract<ValueSnapshot, { type: "list" }>, "length" | "truncated">> = {}): ValueSnapshot => ({
  type: "list",
  length: options.length ?? items.length,
  items,
  truncated: options.truncated ?? false
});
const tuple = (items: ValueSnapshot[], options: Partial<Pick<Extract<ValueSnapshot, { type: "tuple" }>, "length" | "truncated">> = {}): ValueSnapshot => ({
  type: "tuple",
  length: options.length ?? items.length,
  items,
  truncated: options.truncated ?? false
});
const dict = (entries: Array<[ValueSnapshot, ValueSnapshot]>, options: Partial<Pick<Extract<ValueSnapshot, { type: "dict" }>, "length" | "truncated">> = {}): ValueSnapshot => ({
  type: "dict",
  length: options.length ?? entries.length,
  entries: entries.map(([key, value]) => ({ key, value })),
  truncated: options.truncated ?? false
});
const set = (items: ValueSnapshot[], options: Partial<Pick<Extract<ValueSnapshot, { type: "set" }>, "length" | "truncated">> = {}): ValueSnapshot => ({
  type: "set",
  length: options.length ?? items.length,
  items,
  truncated: options.truncated ?? false
});

describe("compareCrossRunValues", () => {
  it("compares factual scalar values and keeps snapshot types significant", () => {
    expect(compareCrossRunValues(int(1), int(1))).toEqual({ status: "equal" });
    expect(compareCrossRunValues(int(1), int(2))).toMatchObject({ status: "different" });
    expect(compareCrossRunValues(float("NaN"), float("NaN"))).toEqual({ status: "equal" });
    expect(compareCrossRunValues(float(1), int(1))).toMatchObject({ status: "different" });
    expect(compareCrossRunValues(bool(true), bool(false))).toMatchObject({ status: "different" });
    expect(compareCrossRunValues({ type: "none", value: null }, { type: "none", value: null }))
      .toEqual({ status: "equal" });
  });

  it("compares complete strings but treats a matching truncated prefix as incomparable", () => {
    expect(compareCrossRunValues(string("same"), string("same"))).toEqual({ status: "equal" });
    expect(compareCrossRunValues(string("same"), string("different"))).toMatchObject({ status: "different" });
    expect(compareCrossRunValues(
      string("prefix", { length: 20, truncated: true }),
      string("prefix", { length: 20, truncated: true })
    )).toMatchObject({ status: "incomparable" });
    expect(compareCrossRunValues(
      string("prefix", { length: 20, truncated: true }),
      string("other", { length: 20, truncated: true })
    )).toMatchObject({ status: "different" });
    expect(compareCrossRunValues(
      string("prefix", { length: 20, truncated: true }),
      string("prefix", { length: 21, truncated: true })
    )).toMatchObject({ status: "different" });
  });

  it("recurses through complete lists and tuples while propagating uncertainty", () => {
    expect(compareCrossRunValues(list([int(1), tuple([bool(true)])]), list([int(1), tuple([bool(true)])])))
      .toEqual({ status: "equal" });
    expect(compareCrossRunValues(list([int(1)]), list([int(1), int(2)])))
      .toMatchObject({ status: "different" });
    expect(compareCrossRunValues(list([int(1)]), list([int(2)])))
      .toMatchObject({ status: "different" });
    expect(compareCrossRunValues(
      list([string("prefix")], { length: 2, truncated: true }),
      list([string("prefix")], { length: 2, truncated: true })
    )).toMatchObject({ status: "incomparable" });
    expect(compareCrossRunValues(
      list([string("prefix")], { length: 2, truncated: true }),
      list([string("other")], { length: 2, truncated: true })
    )).toMatchObject({ status: "different" });
  });

  it("compares dictionaries independently of entry order using safe keys", () => {
    expect(compareCrossRunValues(
      dict([[int(1), string("one")], [int(2), string("two")]]),
      dict([[int(2), string("two")], [int(1), string("one")]])
    )).toEqual({ status: "equal" });
    expect(compareCrossRunValues(
      dict([[int(1), string("one")]]),
      dict([[int(1), string("other")]])
    )).toMatchObject({ status: "different" });
    expect(compareCrossRunValues(
      dict([[int(1), string("one")]], { length: 2, truncated: true }),
      dict([[int(1), string("one")]], { length: 2, truncated: true })
    )).toMatchObject({ status: "incomparable" });
    expect(compareCrossRunValues(
      dict([[{ type: "reference", objectId: "obj-1", className: "Node" }, int(1)]]),
      dict([[{ type: "reference", objectId: "obj-2", className: "Node" }, int(1)]])
    )).toMatchObject({ status: "incomparable" });
  });

  it("compares complete sets as unordered safe members", () => {
    expect(compareCrossRunValues(set([int(1), string("two")]), set([string("two"), int(1)])))
      .toEqual({ status: "equal" });
    expect(compareCrossRunValues(set([int(1)]), set([int(2)]))).toMatchObject({ status: "different" });
    expect(compareCrossRunValues(
      set([int(1)], { length: 2, truncated: true }),
      set([int(1)], { length: 2, truncated: true })
    )).toMatchObject({ status: "incomparable" });
  });

  it("never treats object IDs as cross-run identity", () => {
    expect(compareCrossRunValues(
      { type: "reference", objectId: "obj-1", className: "TreeNode" },
      { type: "reference", objectId: "obj-1", className: "TreeNode" }
    )).toEqual(expect.objectContaining({ status: "incomparable" }));
    expect(compareCrossRunValues(
      { type: "reference", objectId: "obj-1", className: "TreeNode" },
      { type: "reference", objectId: "obj-2", className: "TreeNode" }
    )).toMatchObject({ status: "incomparable" });
    expect(compareCrossRunValues(
      { type: "reference", objectId: "obj-1", className: "TreeNode" },
      { type: "reference", objectId: "obj-2", className: "ListNode" }
    )).toMatchObject({ status: "different" });
  });

  it("keeps unknown and cycle snapshots conservative", () => {
    expect(compareCrossRunValues(
      { type: "unknown", className: "Thing", repr: "<Thing at 0x1>" },
      { type: "unknown", className: "Thing", repr: "<Thing at 0x2>" }
    )).toMatchObject({ status: "incomparable" });
    expect(compareCrossRunValues(
      { type: "cycle", referenceId: "ref-1" },
      { type: "cycle", referenceId: "ref-1" }
    )).toMatchObject({ status: "incomparable" });
    expect(compareCrossRunValues(
      { type: "unknown", className: "Thing", repr: "x" },
      { type: "cycle", referenceId: "ref-1" }
    )).toMatchObject({ status: "incomparable" });
  });
});

describe("stableCrossRunValueKey", () => {
  it("canonicalizes only complete safe scalar and container values", () => {
    expect(stableCrossRunValueKey(int(1))).toBe(stableCrossRunValueKey(int(1)));
    expect(stableCrossRunValueKey(list([int(1), string("two")]))).toBe(
      stableCrossRunValueKey(list([int(1), string("two")]))
    );
    expect(stableCrossRunValueKey(dict([[int(1), string("one")], [int(2), string("two")]]))).toBe(
      stableCrossRunValueKey(dict([[int(2), string("two")], [int(1), string("one")]]))
    );
    expect(stableCrossRunValueKey(set([int(1), int(2)]))).toBe(
      stableCrossRunValueKey(set([int(2), int(1)]))
    );
  });

  it.each([
    { type: "reference", objectId: "obj-1", className: "Node" },
    { type: "unknown", className: "Thing", repr: "x" },
    { type: "cycle", referenceId: "ref-1" },
    string("prefix", { length: 10, truncated: true })
  ] as ValueSnapshot[])("returns null for unsafe value %#", (value) => {
    expect(stableCrossRunValueKey(value)).toBeNull();
  });
});

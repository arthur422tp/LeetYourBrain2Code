import { describe, expect, it } from "vitest";

import {
  getTestcaseArgumentLines,
  splitTestcaseIntoCases,
  validateTestcaseLineCount
} from "../../src/execution/testcase-parser";

describe("testcase parser", () => {
  it("preserves one Python literal per non-empty line", () => {
    expect(getTestcaseArgumentLines("[2,7,11,15]\n9\n")).toEqual([
      "[2,7,11,15]",
      "9"
    ]);
    expect(getTestcaseArgumentLines("'hello world'")).toEqual(["'hello world'"]);
    expect(getTestcaseArgumentLines("None")).toEqual(["None"]);
  });

  it("does not evaluate malformed literals in TypeScript", () => {
    expect(getTestcaseArgumentLines("[2,\nnot-python")).toEqual(["[2,", "not-python"]);
  });

  it("accepts matching argument counts and returns a typed input failure otherwise", () => {
    expect(validateTestcaseLineCount("[2,7,11,15]\n9", 2)).toEqual({
      ok: true,
      argumentLines: ["[2,7,11,15]", "9"]
    });
    expect(validateTestcaseLineCount("[2,7,11,15]", 2)).toEqual({
      ok: false,
      reason: "input_error"
    });
  });

  it("groups consecutive argument lines into deterministic testcase cases", () => {
    expect(splitTestcaseIntoCases("[2,7,11,15]\n9\n[3,2,4]\n6\n[3,3]\n6", 2)).toEqual({
      ok: true,
      cases: ["[2,7,11,15]\n9", "[3,2,4]\n6", "[3,3]\n6"]
    });
  });

  it("rejects a testcase stream that cannot form complete cases", () => {
    expect(splitTestcaseIntoCases("[2,7,11,15]\n9\n[3,2,4]", 2)).toEqual({
      ok: false,
      reason: "input_error"
    });
  });
});

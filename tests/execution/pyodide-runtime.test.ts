import { describe, expect, it } from "vitest";

import type { ExecutionRequest, ExecutionTerminalResult } from "../../src/shared/execution-types";
import {
  buildExecutionScript,
  createPyodideRuntime,
  USER_CODE_FILENAME
} from "../../src/worker/pyodide-runtime";

const request: ExecutionRequest = {
  sessionId: "runtime-session",
  sourceCode: `class Solution:
    def add(self, a: int, b: int):
        return a + b
`,
  rawTestcase: "2\n3",
  entrypoint: { className: "Solution", methodName: "add", parameterCount: 2 },
  limits: {
    maxTraceSteps: 100,
    maxContainerItems: 100,
    maxNestingDepth: 8,
    maxSnapshotBytes: 10_000,
    maxSessionBytes: 100_000,
    maxStdoutBytes: 1_000,
    hardTimeoutMs: 1_000
  }
};

describe("Pyodide runtime", () => {
  it("compiles the prelude and user source independently", () => {
    const script = buildExecutionScript(request);

    expect(script).toContain(`compile(`);
    expect(script).toContain(USER_CODE_FILENAME);
    expect(script).toContain("leetcode-runtime-prelude");
    expect(script).toContain(JSON.stringify(request.sourceCode));
    expect(script).not.toContain(`${JSON.stringify(request.sourceCode)} +`);
  });

  it("initializes from a local index URL and reports a simple return value", async () => {
    const calls: string[] = [];
    const loadedIndexUrls: string[] = [];
    const finished: ExecutionTerminalResult[] = [];

    const runtime = createPyodideRuntime({
      indexURL: "/extension/pyodide/",
      loadPyodide: async ({ indexURL }) => {
        loadedIndexUrls.push(indexURL);
        return {
          runPythonAsync: async (code: string) => {
            calls.push(code);
            return [5, ""];
          }
        };
      },
      onFinished: (result) => finished.push(result)
    });

    await runtime.initialize();
    await runtime.execute(request);

    expect(loadedIndexUrls).toEqual(["/extension/pyodide/"]);
    expect(calls).toHaveLength(1);
    expect(finished).toEqual([
      expect.objectContaining({
        status: "completed",
        terminationReason: "normal_return",
        returnValue: { type: "int", value: "5" },
        stdout: ""
      })
    ]);
  });
});

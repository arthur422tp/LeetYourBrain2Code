import { describe, expect, it, vi } from "vitest";

import { DEFAULT_EXECUTION_LIMITS } from "../../src/shared/execution-types";
import type { ExecutionRequest } from "../../src/shared/execution-types";
import type { TraceSession } from "../../src/shared/trace-types";
import { renderSidePanel, type SidePanelController } from "../../src/sidepanel/bootstrap";

describe("renderSidePanel", () => {
  it("renders the initial runtime status", () => {
    const root = document.createElement("main");

    renderSidePanel(root);

    expect(root.textContent).toContain("LeetCode Python Visualizer");
    expect(root.textContent).toContain("Runtime: not started");
  });

  it("runs the temporary developer harness and renders the trace session", async () => {
    const root = document.createElement("main");
    const execute = vi.fn(async (request: ExecutionRequest): Promise<TraceSession> => ({
      schemaVersion: 1,
      sessionId: request.sessionId,
      sourceCode: request.sourceCode,
      rawTestcase: request.rawTestcase,
      entrypoint: request.entrypoint,
      executionEnvironment: { runtime: "pyodide", pythonVersion: "unknown" },
      status: "completed",
      terminationReason: "normal_return",
      events: [
        {
          step: 1,
          event: "call",
          frameId: 1,
          parentFrameId: null,
          function: "twoSum",
          line: 2,
          callDepth: 1,
          locals: {},
          stdoutDelta: ""
        }
      ],
      stdout: "",
      limits: request.limits,
      returnValue: { type: "int", value: "9" }
    }));
    const controller: SidePanelController = { execute };

    renderSidePanel(root, { controller });

    const source = root.querySelector<HTMLTextAreaElement>("#source-code");
    const testcase = root.querySelector<HTMLTextAreaElement>("#testcase");
    const runButton = root.querySelector<HTMLButtonElement>("#run");
    const traceOutput = root.querySelector<HTMLElement>("#trace-output");
    expect(source?.value).toContain("class Solution");
    expect(testcase?.value).toContain("[2, 7]");
    expect(runButton).not.toBeNull();
    expect(traceOutput).not.toBeNull();

    runButton?.click();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceCode: expect.stringContaining("class Solution"),
        rawTestcase: expect.stringContaining("[2, 7]"),
        entrypoint: { className: "Solution", methodName: "twoSum", parameterCount: 2 },
        limits: DEFAULT_EXECUTION_LIMITS
      })
    );
    expect(root.querySelector("#runtime-status")?.textContent).toBe("Runtime: completed");
    expect(traceOutput?.textContent).toContain('"event": "call"');
  });
});

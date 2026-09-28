import { describe, expect, it } from "vitest";

import {
  collectDiagnosticSnapshot,
  formatDiagnosticReport,
  getDiagnosticEnvironment,
  type DiagnosticEnvironment,
  type DiagnosticRuntimeView,
  type DiagnosticSnapshot,
} from "../../src/sidepanel/diagnostics";

function readySnapshot(): DiagnosticSnapshot {
  return {
    extension: {
      version: "0.1.1",
      manifestVersion: 3,
    },
    browser: {
      chrome: "153",
      platform: "Windows",
    },
    page: {
      activeContext: "leetcode",
      problemSlug: "two-sum",
      language: "python",
      pageState: "ready",
    },
    integration: {
      activeTabOwned: true,
      pageBridge: "ready",
      editorSync: "synced",
      testcaseState: "ready",
      selectedCase: 2,
    },
    execution: {
      status: "completed",
      traceEvents: 4,
      durationMs: 23,
      acceptedSnapshot: true,
    },
    visualization: {
      kind: "list",
      rawCursor: "3/4",
      baseline: "none",
      behavioralDiff: "unavailable",
    },
    generatedAt: "2026-09-28T03:00:00.000Z",
  };
}

function readyRuntime(overrides: Partial<DiagnosticRuntimeView> = {}): DiagnosticRuntimeView {
  return {
    activeContext: "leetcode",
    problemSlug: "two-sum",
    language: "python",
    pageState: "ready",
    activeTabOwned: true,
    pageBridge: "ready",
    editorSync: "synced",
    testcaseState: "ready",
    selectedCase: 2,
    executionStatus: "completed",
    traceEvents: 4,
    durationMs: 23,
    acceptedSnapshot: true,
    visualizerKind: "list",
    rawCursor: "3/4",
    baseline: "none",
    behavioralDiff: "unavailable",
    ...overrides,
  };
}

function readyEnvironment(): DiagnosticEnvironment {
  return {
    extensionVersion: "0.1.1",
    manifestVersion: 3,
    chrome: "153",
    platform: "Windows",
  };
}

describe("diagnostic report", () => {
  it("reads only manifest version and coarse browser fields for the environment", () => {
    expect(getDiagnosticEnvironment({
      manifest: { version: "0.1.1", manifest_version: 3 },
      userAgent: "Mozilla/5.0 Chrome/153.0.1.2 Safari/537.36",
      platform: "Win32"
    })).toEqual({
      extensionVersion: "0.1.1",
      manifestVersion: 3,
      chrome: "153",
      platform: "Windows"
    });
  });

  it("does not misclassify Darwin as Windows", () => {
    expect(getDiagnosticEnvironment({
      manifest: { version: "0.1.1", manifest_version: 3 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/153.0.1.2 Safari/537.36",
      platform: "Darwin"
    }).platform).toBe("macOS");
  });

  it("uses unavailable values when runtime environment details cannot be read", () => {
    expect(getDiagnosticEnvironment({
      manifest: undefined,
      userAgent: "",
      platform: ""
    })).toEqual({
      extensionVersion: "unavailable",
      manifestVersion: "unavailable",
      chrome: "unavailable",
      platform: "unavailable"
    });
  });

  it("projects authoritative runtime state into the safe snapshot schema", () => {
    expect(collectDiagnosticSnapshot(
      readyRuntime(),
      readyEnvironment(),
      new Date("2026-09-28T03:00:00.000Z")
    )).toEqual(readySnapshot());
  });

  it("preserves unavailable context without inventing page or visualizer data", () => {
    const snapshot = collectDiagnosticSnapshot(
      readyRuntime({
        activeContext: "non_leetcode",
        problemSlug: null,
        language: null,
        pageState: "unavailable",
        activeTabOwned: false,
        pageBridge: "unavailable",
        editorSync: "unavailable",
        testcaseState: "unavailable",
        selectedCase: null,
        acceptedSnapshot: false,
        visualizerKind: null,
        rawCursor: null,
      }),
      { ...readyEnvironment(), chrome: "unavailable", platform: "unavailable" },
      new Date("2026-09-28T03:00:00.000Z")
    );

    expect(snapshot.page).toEqual({
      activeContext: "non_leetcode",
      problemSlug: "unavailable",
      language: "unavailable",
      pageState: "unavailable",
    });
    expect(snapshot.integration).toEqual({
      activeTabOwned: false,
      pageBridge: "unavailable",
      editorSync: "unavailable",
      testcaseState: "unavailable",
      selectedCase: "unavailable",
    });
    expect(snapshot.visualization).toEqual({
      kind: "unavailable",
      rawCursor: "unavailable",
      baseline: "none",
      behavioralDiff: "unavailable",
    });
  });

  it.each([
    ["waiting editor", { pageState: "waiting_editor", language: "python", testcaseState: "unavailable" }],
    ["waiting testcase", { pageState: "waiting_testcase", language: "python", testcaseState: "unavailable" }],
    ["unsupported language", { pageState: "unsupported_language", language: "java" }],
    ["page bridge unavailable", { pageState: "disconnected", pageBridge: "unavailable" }],
    ["editor stale", { editorSync: "stale" }],
    ["editor unavailable", { editorSync: "unavailable" }],
    ["no visualizer", { visualizerKind: null, rawCursor: null }],
  ] as const)("projects %s status", (_label, overrides) => {
    const expected = overrides as Partial<DiagnosticRuntimeView>;
    const snapshot = collectDiagnosticSnapshot(
      readyRuntime(overrides),
      readyEnvironment(),
      new Date("2026-09-28T03:00:00.000Z")
    );

    expect(snapshot.page.pageState).toBe(expected.pageState ?? "ready");
    if (expected.language !== undefined) {
      expect(snapshot.page.language).toBe(expected.language);
    }
    if (expected.pageBridge !== undefined) {
      expect(snapshot.integration.pageBridge).toBe(expected.pageBridge);
    }
    if (expected.editorSync !== undefined) {
      expect(snapshot.integration.editorSync).toBe(expected.editorSync);
    }
    if (expected.visualizerKind === null) {
      expect(snapshot.visualization.kind).toBe("unavailable");
      expect(snapshot.visualization.rawCursor).toBe("unavailable");
    }
  });

  it.each(["running", "completed", "exception", "timeout", "trace_limit"] as const)(
    "projects %s execution state without exception details",
    (executionStatus) => {
      const snapshot = collectDiagnosticSnapshot(
        readyRuntime({ executionStatus }),
        readyEnvironment(),
        new Date("2026-09-28T03:00:00.000Z")
      );

      expect(snapshot.execution.status).toBe(executionStatus);
      expect(formatDiagnosticReport(snapshot)).not.toContain("exception.message");
    }
  );

  it.each(["none", "compatible", "incompatible"] as const)(
    "projects %s baseline state",
    (baseline) => {
      expect(collectDiagnosticSnapshot(
        readyRuntime({ baseline }),
        readyEnvironment(),
        new Date("2026-09-28T03:00:00.000Z")
      ).visualization.baseline).toBe(baseline);
    }
  );

  it("formats a ready snapshot with a deterministic safe field order", () => {
    expect(formatDiagnosticReport(readySnapshot())).toBe(
      [
        "LeetYourBrain2Code diagnostics",
        "",
        "Extension",
        "version: 0.1.1",
        "manifest: 3",
        "",
        "Browser",
        "chrome: 153",
        "platform: Windows",
        "",
        "Page",
        "active_context: leetcode",
        "problem_slug: two-sum",
        "language: python",
        "page_state: ready",
        "",
        "Integration",
        "active_tab_owned: true",
        "page_bridge: ready",
        "editor_sync: synced",
        "testcase_state: ready",
        "selected_case: 2",
        "",
        "Execution",
        "status: completed",
        "trace_events: 4",
        "duration_ms: 23",
        "accepted_snapshot: true",
        "",
        "Visualization",
        "kind: list",
        "raw_cursor: 3/4",
        "baseline: none",
        "behavioral_diff: unavailable",
        "",
        "Generated",
        "timestamp_utc: 2026-09-28T03:00:00.000Z",
      ].join("\n")
    );
  });

  it("represents unavailable values, zero events, timeout, and every baseline state", () => {
    const snapshot = readySnapshot();
    snapshot.browser.chrome = "unavailable";
    snapshot.browser.platform = "unavailable";
    snapshot.page.activeContext = "unavailable";
    snapshot.page.problemSlug = "unavailable";
    snapshot.page.language = "unavailable";
    snapshot.page.pageState = "waiting_testcase";
    snapshot.integration.activeTabOwned = "unavailable";
    snapshot.integration.pageBridge = "unavailable";
    snapshot.integration.editorSync = "stale";
    snapshot.integration.testcaseState = "unavailable";
    snapshot.integration.selectedCase = "unavailable";
    snapshot.execution.status = "timeout";
    snapshot.execution.traceEvents = 0;
    snapshot.execution.durationMs = "unavailable";
    snapshot.execution.acceptedSnapshot = false;
    snapshot.visualization.kind = "unavailable";
    snapshot.visualization.rawCursor = "unavailable";

    for (const baseline of ["none", "compatible", "incompatible"]) {
      snapshot.visualization.baseline = baseline;
      const report = formatDiagnosticReport(snapshot);

      expect(report).toContain("chrome: unavailable");
      expect(report).toContain("active_context: unavailable");
      expect(report).toContain("page_state: waiting_testcase");
      expect(report).toContain("active_tab_owned: unavailable");
      expect(report).toContain("selected_case: unavailable");
      expect(report).toContain("status: timeout");
      expect(report).toContain("trace_events: 0");
      expect(report).toContain("duration_ms: unavailable");
      expect(report).toContain(`baseline: ${baseline}`);
    }
  });

  it("clamps invalid and excessively large numeric fields", () => {
    const snapshot = readySnapshot() as DiagnosticSnapshot & {
      unsafeTraceEvents?: unknown;
    };
    snapshot.execution.traceEvents = -1;
    snapshot.execution.durationMs = Number.NaN;
    const hugeSnapshot = {
      ...snapshot,
      execution: {
        ...snapshot.execution,
        traceEvents: Number.MAX_SAFE_INTEGER,
        durationMs: Number.MAX_SAFE_INTEGER,
      },
    };

    expect(formatDiagnosticReport(snapshot)).toContain("trace_events: unavailable");
    expect(formatDiagnosticReport(snapshot)).toContain("duration_ms: unavailable");

    const hugeReport = formatDiagnosticReport(hugeSnapshot);
    expect(hugeReport).toContain("trace_events: 1000000");
    expect(hugeReport).toContain("duration_ms: 86400000");
    expect(hugeReport).not.toContain(String(Number.MAX_SAFE_INTEGER));
  });

  it("never serializes tempting source, testcase, trace, or identity values", () => {
    const unsafeValues = {
      sourceCode: "SECRET_SOURCE_7f0e",
      testcase: "SECRET_TESTCASE_9a1b",
      stdout: "SECRET_STDOUT_2c3d",
      exceptionMessage: "SECRET_EXCEPTION_4e5f",
      locals: "SECRET_LOCALS_6a7b",
      globals: "SECRET_GLOBALS_8c9d",
      variables: "SECRET_VARIABLES_0e1f",
      trace: "SECRET_TRACE_2a3b",
      rawTrace: "SECRET_RAW_TRACE_4c5d",
      objectSnapshot: "SECRET_OBJECT_6e7f",
      expressionValue: "SECRET_EXPRESSION_8a9b",
      decisionValue: "SECRET_DECISION_0c1d",
      mutationValue: "SECRET_MUTATION_2e3f",
      cookie: "SECRET_COOKIE_4a5b",
      token: "SECRET_TOKEN_6c7d",
      email: "SECRET_EMAIL_8e9f",
    };
    const unsafeSnapshot = Object.assign(readySnapshot(), unsafeValues) as DiagnosticSnapshot;

    const report = formatDiagnosticReport(unsafeSnapshot);

    for (const value of Object.values(unsafeValues)) {
      expect(report).not.toContain(value);
    }
    expect(report).not.toContain("sourceCode");
    expect(report).not.toContain("rawTrace");
    expect(report).not.toContain("cookie");
  });
});

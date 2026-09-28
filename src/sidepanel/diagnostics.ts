export type DiagnosticAvailability =
  | "ready"
  | "waiting"
  | "stale"
  | "unavailable"
  | "unknown";

export interface DiagnosticSnapshot {
  extension: {
    version: string;
    manifestVersion: number;
  };
  browser: {
    chrome: string | "unavailable";
    platform: string | "unavailable";
  };
  page: {
    activeContext: "leetcode" | "non_leetcode" | "unavailable";
    problemSlug: string | "unavailable";
    language: string | "unavailable";
    pageState: string;
  };
  integration: {
    activeTabOwned: boolean | "unavailable";
    pageBridge: string;
    editorSync: string;
    testcaseState: string;
    selectedCase: number | "unavailable";
  };
  execution: {
    status: string;
    traceEvents: number | "unavailable";
    durationMs: number | "unavailable";
    acceptedSnapshot: boolean;
  };
  visualization: {
    kind: string | "unavailable";
    rawCursor: string | "unavailable";
    baseline: string;
    behavioralDiff: string;
  };
  generatedAt: string;
}

const MAX_TRACE_EVENTS = 1_000_000;
const MAX_DURATION_MS = 86_400_000;
const MAX_STATUS_LENGTH = 160;

function safeStatus(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "unavailable";

  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, MAX_STATUS_LENGTH)
    .trim();

  return normalized.length > 0 ? normalized : "unavailable";
}

function safeBoolean(value: unknown): string {
  return typeof value === "boolean" ? String(value) : "unavailable";
}

function safeNonNegativeInteger(value: unknown, maximum: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "unavailable";
  }

  return String(Math.min(Math.floor(value), maximum));
}

function safeTimestamp(value: unknown): string {
  if (typeof value !== "string") return "unavailable";

  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : "unavailable";
}

export function formatDiagnosticReport(snapshot: DiagnosticSnapshot): string {
  return [
    "LeetYourBrain2Code diagnostics",
    "",
    "Extension",
    `version: ${safeStatus(snapshot.extension.version)}`,
    `manifest: ${safeNonNegativeInteger(snapshot.extension.manifestVersion, 10)}`,
    "",
    "Browser",
    `chrome: ${safeStatus(snapshot.browser.chrome)}`,
    `platform: ${safeStatus(snapshot.browser.platform)}`,
    "",
    "Page",
    `active_context: ${safeStatus(snapshot.page.activeContext)}`,
    `problem_slug: ${safeStatus(snapshot.page.problemSlug)}`,
    `language: ${safeStatus(snapshot.page.language)}`,
    `page_state: ${safeStatus(snapshot.page.pageState)}`,
    "",
    "Integration",
    `active_tab_owned: ${safeBoolean(snapshot.integration.activeTabOwned)}`,
    `page_bridge: ${safeStatus(snapshot.integration.pageBridge)}`,
    `editor_sync: ${safeStatus(snapshot.integration.editorSync)}`,
    `testcase_state: ${safeStatus(snapshot.integration.testcaseState)}`,
    `selected_case: ${snapshot.integration.selectedCase === "unavailable"
      ? "unavailable"
      : safeNonNegativeInteger(snapshot.integration.selectedCase, 10_000)}`,
    "",
    "Execution",
    `status: ${safeStatus(snapshot.execution.status)}`,
    `trace_events: ${snapshot.execution.traceEvents === "unavailable"
      ? "unavailable"
      : safeNonNegativeInteger(snapshot.execution.traceEvents, MAX_TRACE_EVENTS)}`,
    `duration_ms: ${snapshot.execution.durationMs === "unavailable"
      ? "unavailable"
      : safeNonNegativeInteger(snapshot.execution.durationMs, MAX_DURATION_MS)}`,
    `accepted_snapshot: ${safeBoolean(snapshot.execution.acceptedSnapshot)}`,
    "",
    "Visualization",
    `kind: ${safeStatus(snapshot.visualization.kind)}`,
    `raw_cursor: ${safeStatus(snapshot.visualization.rawCursor)}`,
    `baseline: ${safeStatus(snapshot.visualization.baseline)}`,
    `behavioral_diff: ${safeStatus(snapshot.visualization.behavioralDiff)}`,
    "",
    "Generated",
    `timestamp_utc: ${safeTimestamp(snapshot.generatedAt)}`,
  ].join("\n");
}

export type DiagnosticAvailability =
  | "ready"
  | "waiting"
  | "stale"
  | "unavailable"
  | "unknown";

export interface DiagnosticEnvironment {
  extensionVersion: string | "unavailable";
  manifestVersion: number | "unavailable";
  chrome: string | "unavailable";
  platform: string | "unavailable";
}

export interface DiagnosticEnvironmentSources {
  manifest?: unknown;
  userAgent?: string;
  platform?: string;
}

export interface DiagnosticRuntimeView {
  activeContext: DiagnosticSnapshot["page"]["activeContext"];
  problemSlug: string | null;
  language: string | null;
  pageState: string;
  activeTabOwned: boolean | "unavailable";
  pageBridge: string;
  editorSync: string;
  testcaseState: string;
  selectedCase: number | null;
  executionStatus: string;
  traceEvents: number | null;
  durationMs: number | null;
  acceptedSnapshot: boolean;
  visualizerKind: string | null;
  rawCursor: string | null;
  baseline: string;
  behavioralDiff: string;
}

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

function optionalText(value: unknown): string | "unavailable" {
  return typeof value === "string" && value.length > 0 ? value : "unavailable";
}

function optionalNumber(value: unknown): number | "unavailable" {
  return typeof value === "number" ? value : "unavailable";
}

function timestampFor(now: Date): string {
  return Number.isFinite(now.getTime()) ? now.toISOString() : "unavailable";
}

function objectValue(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  return key in source ? (source as Record<string, unknown>)[key] : undefined;
}

function chromeMajor(userAgent: string): string | "unavailable" {
  const match = userAgent.match(/(?:Chrome|Chromium)\/(\d+)/i);
  return match?.[1] ?? "unavailable";
}

function coarsePlatform(platform: string, userAgent: string): string | "unavailable" {
  const value = `${platform} ${userAgent}`.toLowerCase();
  if (/\b(?:windows|win(?:32|64)?)\b/.test(value)) return "Windows";
  if (value.includes("iphone") || value.includes("ipad") || value.includes("ios")) return "iOS";
  if (value.includes("android")) return "Android";
  if (value.includes("mac")) return "macOS";
  if (value.includes("linux")) return "Linux";
  return "unavailable";
}

export function getDiagnosticEnvironment(
  sources: DiagnosticEnvironmentSources = {}
): DiagnosticEnvironment {
  let manifest = sources.manifest;
  if (manifest === undefined && typeof chrome !== "undefined" && typeof chrome.runtime?.getManifest === "function") {
    try {
      manifest = chrome.runtime.getManifest();
    } catch {
      manifest = undefined;
    }
  }

  const userAgent = sources.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const platform = sources.platform ?? (typeof navigator !== "undefined" ? navigator.platform : "");
  const version = objectValue(manifest, "version");
  const manifestVersion = objectValue(manifest, "manifest_version");

  return {
    extensionVersion: typeof version === "string" && version.length > 0 ? version : "unavailable",
    manifestVersion: typeof manifestVersion === "number" && Number.isInteger(manifestVersion) && manifestVersion > 0
      ? manifestVersion
      : "unavailable",
    chrome: chromeMajor(userAgent),
    platform: coarsePlatform(platform, userAgent)
  };
}

export function collectDiagnosticSnapshot(
  runtime: DiagnosticRuntimeView,
  environment: DiagnosticEnvironment,
  now: Date
): DiagnosticSnapshot {
  return {
    extension: {
      version: optionalText(environment.extensionVersion),
      manifestVersion: typeof environment.manifestVersion === "number"
        ? environment.manifestVersion
        : 0
    },
    browser: {
      chrome: optionalText(environment.chrome),
      platform: optionalText(environment.platform)
    },
    page: {
      activeContext: runtime.activeContext,
      problemSlug: optionalText(runtime.problemSlug),
      language: optionalText(runtime.language),
      pageState: optionalText(runtime.pageState)
    },
    integration: {
      activeTabOwned: runtime.activeTabOwned,
      pageBridge: optionalText(runtime.pageBridge),
      editorSync: optionalText(runtime.editorSync),
      testcaseState: optionalText(runtime.testcaseState),
      selectedCase: optionalNumber(runtime.selectedCase)
    },
    execution: {
      status: optionalText(runtime.executionStatus),
      traceEvents: optionalNumber(runtime.traceEvents),
      durationMs: optionalNumber(runtime.durationMs),
      acceptedSnapshot: runtime.acceptedSnapshot
    },
    visualization: {
      kind: optionalText(runtime.visualizerKind),
      rawCursor: optionalText(runtime.rawCursor),
      baseline: optionalText(runtime.baseline),
      behavioralDiff: optionalText(runtime.behavioralDiff)
    },
    generatedAt: timestampFor(now)
  };
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

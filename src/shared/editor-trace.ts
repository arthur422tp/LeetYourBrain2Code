/** A cursor in the exact source snapshot used to record a trace. */
export interface EditorTraceLocation {
  sourceCode: string;
  problemSlug: string | null;
  line: number;
  follow: boolean;
}

export type EditorTraceStatus = "synced" | "stale" | "unavailable" | "cleared";

export function isEditorTraceLocation(value: unknown): value is EditorTraceLocation {
  if (typeof value !== "object" || value === null) return false;
  const location = value as Record<string, unknown>;
  return typeof location.sourceCode === "string" && location.sourceCode.length <= 1_000_000
    && (location.problemSlug === null || (typeof location.problemSlug === "string" && location.problemSlug.length <= 512))
    && typeof location.line === "number" && Number.isSafeInteger(location.line) && location.line > 0
    && location.line <= location.sourceCode.split("\n").length
    && typeof location.follow === "boolean";
}

export function isEditorTraceStatus(value: unknown): value is EditorTraceStatus {
  return value === "synced" || value === "stale" || value === "unavailable" || value === "cleared";
}

export function sameEditorSource(left: string, right: string): boolean {
  return left.replace(/\r\n/g, "\n") === right.replace(/\r\n/g, "\n");
}

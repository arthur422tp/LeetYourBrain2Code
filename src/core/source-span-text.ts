import type { SourceSpan } from "../shared/expression-types";

export function sliceSourceSpan(sourceCode: string, span: SourceSpan): string {
  const lines = sourceCode.replace(/\r\n?/g, "\n").split("\n");
  if (
    span.line < 1 ||
    span.endLine < span.line ||
    span.line > lines.length ||
    span.endLine > lines.length
  ) {
    return "";
  }

  const startLine = lines[span.line - 1] ?? "";
  const endLine = lines[span.endLine - 1] ?? "";
  const startColumn = Math.max(0, Math.min(span.column, startLine.length));
  const endColumn = Math.max(0, Math.min(span.endColumn, endLine.length));
  if (span.line === span.endLine) {
    return startLine.slice(startColumn, endColumn);
  }

  const parts = [startLine.slice(startColumn)];
  for (let line = span.line; line < span.endLine - 1; line += 1) {
    parts.push(lines[line] ?? "");
  }
  parts.push(endLine.slice(0, endColumn));
  return parts.join("\n");
}

export function normalizeCrossRunSource(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  let result = "";
  let pendingWhitespace = false;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const flushWhitespace = (): void => {
    if (pendingWhitespace && result.length > 0) result += " ";
    pendingWhitespace = false;
  };

  for (const character of normalized) {
    if (quote !== null) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      flushWhitespace();
      quote = character;
      result += character;
    } else if (/\s/.test(character)) {
      pendingWhitespace = true;
    } else {
      flushWhitespace();
      result += character;
    }
  }
  return result.trim();
}

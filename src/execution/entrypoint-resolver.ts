import type { EntryPoint, ParameterKind } from "../shared/execution-types";
import { getTestcaseArgumentLines } from "./testcase-parser";

export type EntrypointResolution =
  | { ok: true; entrypoint: EntryPoint }
  | { ok: false; reason: "entrypoint_resolution_failed" };

interface MethodCandidate {
  name: string;
  parameterSource: string;
  hasBody: boolean;
}

function indentationWidth(line: string): number {
  let width = 0;
  for (const character of line) {
    if (character === " ") {
      width += 1;
    } else if (character === "\t") {
      width += 4;
    } else {
      break;
    }
  }
  return width;
}

function findClosingParenthesis(source: string, openingIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
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
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitTopLevel(source: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
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
      quote = character;
    } else if (character === "(") {
      roundDepth += 1;
    } else if (character === ")") {
      roundDepth -= 1;
    } else if (character === "[") {
      squareDepth += 1;
    } else if (character === "]") {
      squareDepth -= 1;
    } else if (character === "{") {
      curlyDepth += 1;
    } else if (character === "}") {
      curlyDepth -= 1;
    } else if (
      character === delimiter &&
      roundDepth === 0 &&
      squareDepth === 0 &&
      curlyDepth === 0
    ) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(source.slice(start));
  return parts;
}

function findTopLevelEquals(source: string): number {
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
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
      quote = character;
    } else if (character === "(") {
      roundDepth += 1;
    } else if (character === ")") {
      roundDepth -= 1;
    } else if (character === "[") {
      squareDepth += 1;
    } else if (character === "]") {
      squareDepth -= 1;
    } else if (character === "{") {
      curlyDepth += 1;
    } else if (character === "}") {
      curlyDepth -= 1;
    } else if (
      character === "=" &&
      roundDepth === 0 &&
      squareDepth === 0 &&
      curlyDepth === 0
    ) {
      return index;
    }
  }
  return -1;
}

interface ParameterDescriptor {
  name: string;
  annotation: string | null;
}

function parseParameters(parameterSource: string): ParameterDescriptor[] {
  return splitTopLevel(parameterSource, ",")
    .map((parameter) => parameter.trim())
    .filter((parameter) => parameter.length > 0)
    .filter((parameter) => parameter !== "/" && parameter !== "*")
    .map((parameter) => {
    const equalsIndex = findTopLevelEquals(parameter);
    const withoutDefault = equalsIndex < 0 ? parameter : parameter.slice(0, equalsIndex);
    const colonIndex = withoutDefault.indexOf(":");
    const name = withoutDefault
      .slice(0, colonIndex < 0 ? withoutDefault.length : colonIndex)
      .replace(/^\*+/, "")
      .trim();
    const annotation = colonIndex < 0 ? null : withoutDefault.slice(colonIndex + 1).trim();
    return { name, annotation };
  })
    .filter(({ name }) => name !== "self" && name !== "cls" && name.length > 0);
}

function parameterKind(annotation: string | null): ParameterKind {
  if (annotation === null) {
    return "value";
  }
  const normalized = annotation.replace(/\s+/g, "");
  if (/^(?:ListNode|Optional\[ListNode\]|ListNode\|None|None\|ListNode)$/.test(normalized)) {
    return "linked_list";
  }
  if (/^(?:TreeNode|Optional\[TreeNode\]|TreeNode\|None|None\|TreeNode)$/.test(normalized)) {
    return "binary_tree";
  }
  return "value";
}

function findSolutionClass(lines: string[]): { indent: number; start: number } | null {
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*class\s+Solution\b[^:]*:\s*(?:#.*)?$/.test(lines[index])) {
      return { indent: indentationWidth(lines[index]), start: index + 1 };
    }
  }
  return null;
}

function findMethods(lines: string[], classInfo: { indent: number; start: number }): MethodCandidate[] {
  const methods: MethodCandidate[] = [];
  let methodIndent: number | null = null;

  for (let index = classInfo.start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length > 0 && indentationWidth(line) <= classInfo.indent) {
      break;
    }

    const methodMatch = line.match(/^(\s*)def\s+([A-Za-z_]\w*)\s*\(/);
    if (!methodMatch) {
      continue;
    }

    const currentIndent = indentationWidth(methodMatch[1]);
    if (methodIndent === null) {
      methodIndent = currentIndent;
    }
    if (currentIndent !== methodIndent) {
      continue;
    }

    const openingIndex = line.indexOf("(", methodMatch.index ?? 0);
    let signature = line.slice(openingIndex);
    let closingIndex = findClosingParenthesis(signature, 0);
    let nextLine = index + 1;
    while (closingIndex < 0 && nextLine < lines.length) {
      signature += `\n${lines[nextLine]}`;
      closingIndex = findClosingParenthesis(signature, 0);
      nextLine += 1;
    }

    if (closingIndex < 0) {
      continue;
    }

    const headerTail = signature.slice(closingIndex + 1);
    const colonIndex = headerTail.lastIndexOf(":");
    const inlineBody =
      colonIndex >= 0 &&
      headerTail.slice(colonIndex + 1).trim().length > 0 &&
      !headerTail.slice(colonIndex + 1).trim().startsWith("#");
    let hasBody = inlineBody;

    if (!hasBody) {
      for (let bodyIndex = nextLine; bodyIndex < lines.length; bodyIndex += 1) {
        const bodyLine = lines[bodyIndex];
        if (bodyLine.trim().length === 0) {
          continue;
        }
        hasBody = indentationWidth(bodyLine) > currentIndent;
        break;
      }
    }

    methods.push({
      name: methodMatch[2],
      parameterSource: signature.slice(1, closingIndex),
      hasBody
    });
  }

  return methods;
}

function entrypointForMethod(candidate: MethodCandidate): EntryPoint {
  const parameters = parseParameters(candidate.parameterSource);
  return {
    className: "Solution",
    methodName: candidate.name,
    parameterCount: parameters.length,
    parameterKinds: parameters.map(({ annotation }) => parameterKind(annotation))
  };
}

function resolveEntrypointCandidates(sourceCode: string): EntryPoint[] {
  const lines = sourceCode.replace(/\r\n?/g, "\n").split("\n");
  const classInfo = findSolutionClass(lines);
  if (!classInfo) return [];

  const candidates = findMethods(lines, classInfo).filter(
    (method) => method.name !== "__init__" && !method.name.startsWith("_")
  );
  if (candidates.some((method) => !method.hasBody)) return [];
  return candidates.map(entrypointForMethod);
}

function failedEntrypointResolution(): EntrypointResolution {
  return { ok: false, reason: "entrypoint_resolution_failed" };
}

export function resolveEntrypoint(sourceCode: string): EntrypointResolution {
  const candidates = resolveEntrypointCandidates(sourceCode);
  if (candidates.length !== 1) return failedEntrypointResolution();

  return { ok: true, entrypoint: candidates[0] };
}

export function resolveEntrypointForTestcase(
  sourceCode: string,
  rawTestcase: string
): EntrypointResolution {
  const candidates = resolveEntrypointCandidates(sourceCode);
  if (candidates.length === 0) return failedEntrypointResolution();
  if (candidates.length === 1) return { ok: true, entrypoint: candidates[0] };

  const argumentLineCount = getTestcaseArgumentLines(rawTestcase).length;
  const compatible = candidates.filter(({ parameterCount }) =>
    parameterCount === 0
      ? argumentLineCount === 0
      : argumentLineCount > 0 && argumentLineCount % parameterCount === 0
  );

  return compatible.length === 1
    ? { ok: true, entrypoint: compatible[0] }
    : failedEntrypointResolution();
}

import type { CallFrameStoryNode } from "../core/call-frame-story";
import type {
  BoundArgumentSnapshot,
  FrameExit
} from "../shared/call-frame-types";
import { formatValue } from "./components/value-format";

export function visibleFrameArguments(
  args: BoundArgumentSnapshot[],
  maxVisible = 3
): {
  visible: BoundArgumentSnapshot[];
  hiddenCount: number;
} {
  const compactArguments = args.filter((argument) => argument.name !== "self" && argument.name !== "cls");
  const visibleLimit = Math.max(0, Math.floor(maxVisible));
  return {
    visible: compactArguments.slice(0, visibleLimit),
    hiddenCount: Math.max(0, compactArguments.length - visibleLimit)
  };
}

function visibleFunctionName(node: CallFrameStoryNode, preferShortName: boolean): string {
  const name = node.qualifiedName ?? node.displayName ?? node.functionName;
  return preferShortName ? name.split(".").at(-1) ?? name : name;
}

export function frameSignature(
  node: CallFrameStoryNode,
  options: { preferShortName?: boolean } = {}
): string {
  const name = visibleFunctionName(node, options.preferShortName === true);
  const { visible, hiddenCount } = visibleFrameArguments(node.arguments);
  const parts = visible.map((argument) => `${argument.name}=${formatValue(argument.value)}`);
  if (hiddenCount > 0) parts.push("…");
  return `${name}(${parts.join(", ")})`;
}

export function frameExitSummary(exit: FrameExit): string {
  switch (exit.status) {
    case "returned":
      return `Returned ${formatValue(exit.value)}`;
    case "exception":
      return `Raised ${exit.exception.type}`;
    case "trace_ended":
      return `Trace ended · ${exit.reason}`;
    case "active":
      return "Active";
  }
}

export function compactFrameExitSuffix(exit: FrameExit): string {
  switch (exit.status) {
    case "returned":
      return `→ ${formatValue(exit.value)}`;
    case "exception":
      return `⚠ ${exit.exception.type}`;
    case "trace_ended":
      return "… trace ended";
    case "active":
      return "active";
  }
}


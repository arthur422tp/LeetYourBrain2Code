import type {
  CallFrameModel,
  FunctionDescriptor,
  FunctionPlan,
  FrameOccurrence
} from "../shared/call-frame-types";

export type AlignmentConfidence = "strong" | "structural" | "fallback" | "ambiguous";

export interface CrossRunFunctionIdentity {
  key: string;
  displayName: string;
  qualifiedName?: string;
  confidence: Exclude<AlignmentConfidence, "ambiguous">;
}

export interface CrossRunFunctionIdentityIndex {
  byFrameId: Map<number, CrossRunFunctionIdentity>;
  byKey: Map<string, CrossRunFunctionIdentity>;
}

export interface AlignedFramePair {
  baselineFrameId: number;
  currentFrameId: number;
  functionKey: string;
  confidence: AlignmentConfidence;
  baselineChildOrdinal: number;
  currentChildOrdinal: number;
}

export type CrossRunAlignmentStopReason = "ambiguous_fallback" | "unmatched_function";

export interface CrossRunAlignmentStop {
  reason: CrossRunAlignmentStopReason;
  baselineFrameIds?: number[];
  currentFrameIds?: number[];
}

export interface CrossRunFrameAlignment {
  pairs: AlignedFramePair[];
  stop?: CrossRunAlignmentStop;
}

function descriptorById(plan?: FunctionPlan): Map<string, FunctionDescriptor> {
  return new Map((plan?.functions ?? []).map((descriptor) => [descriptor.functionId, descriptor]));
}

function descriptorKey(descriptor: FunctionDescriptor): string {
  return JSON.stringify({
    kind: descriptor.kind,
    qualifiedName: descriptor.qualifiedName,
    parameterNames: descriptor.parameterNames,
    parameterKinds: descriptor.parameterKinds
  });
}

function identityForFrame(
  frame: FrameOccurrence,
  descriptors: Map<string, FunctionDescriptor>
): CrossRunFunctionIdentity {
  const descriptor = frame.functionId ? descriptors.get(frame.functionId) : undefined;
  if (descriptor) {
    return {
      key: descriptorKey(descriptor),
      displayName: descriptor.qualifiedName || descriptor.name,
      qualifiedName: descriptor.qualifiedName,
      confidence: "strong"
    };
  }
  return {
    key: `fallback:${frame.functionName}`,
    displayName: frame.functionName,
    confidence: "fallback"
  };
}

export function buildCrossRunFunctionIdentityIndex(
  model: CallFrameModel,
  functionPlan?: FunctionPlan
): CrossRunFunctionIdentityIndex {
  const descriptors = descriptorById(functionPlan);
  const byFrameId = new Map<number, CrossRunFunctionIdentity>();
  const byKey = new Map<string, CrossRunFunctionIdentity>();
  for (const frame of model.byFrameId.values()) {
    const identity = identityForFrame(frame, descriptors);
    byFrameId.set(frame.frameId, identity);
    byKey.set(identity.key, identity);
  }
  return { byFrameId, byKey };
}

function confidenceFor(
  baseline: CrossRunFunctionIdentity,
  current: CrossRunFunctionIdentity
): Exclude<AlignmentConfidence, "ambiguous"> {
  if (baseline.confidence === "strong" && current.confidence === "strong") return "strong";
  if (baseline.confidence === "fallback" && current.confidence === "fallback") return "fallback";
  return "structural";
}

function groupByKey(
  frameIds: number[],
  identities: CrossRunFunctionIdentityIndex
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const frameId of frameIds) {
    const identity = identities.byFrameId.get(frameId);
    if (!identity) continue;
    const group = groups.get(identity.key) ?? [];
    group.push(frameId);
    groups.set(identity.key, group);
  }
  return groups;
}

function firstFallbackDuplicate(
  frameIds: number[],
  identities: CrossRunFunctionIdentityIndex
): number[] | null {
  const groups = groupByKey(frameIds, identities);
  for (const [key, ids] of groups) {
    if (ids.length > 1 && identities.byKey.get(key)?.confidence === "fallback") return ids;
  }
  return null;
}

export function alignCrossRunFrames(
  baseline: CallFrameModel,
  current: CallFrameModel,
  baselineFunctionPlan?: FunctionPlan,
  currentFunctionPlan?: FunctionPlan
): CrossRunFrameAlignment {
  const baselineIdentities = buildCrossRunFunctionIdentityIndex(baseline, baselineFunctionPlan);
  const currentIdentities = buildCrossRunFunctionIdentityIndex(current, currentFunctionPlan);
  const baselineAmbiguousRoots = firstFallbackDuplicate(baseline.roots, baselineIdentities);
  const currentAmbiguousRoots = firstFallbackDuplicate(current.roots, currentIdentities);
  if (baselineAmbiguousRoots || currentAmbiguousRoots) {
    return {
      pairs: [],
      stop: {
        reason: "ambiguous_fallback",
        ...(baselineAmbiguousRoots ? { baselineFrameIds: baselineAmbiguousRoots } : {}),
        ...(currentAmbiguousRoots ? { currentFrameIds: currentAmbiguousRoots } : {})
      }
    };
  }

  const pairs: AlignedFramePair[] = [];
  const visited = new Set<string>();
  let stop: CrossRunAlignmentStop | undefined;

  const recordStop = (next: CrossRunAlignmentStop): void => {
    if (!stop) stop = next;
  };

  const alignGroups = (baselineIds: number[], currentIds: number[]): void => {
    const baselineGroups = groupByKey(baselineIds, baselineIdentities);
    const currentGroups = groupByKey(currentIds, currentIdentities);
    const keys = [...new Set([...baselineGroups.keys(), ...currentGroups.keys()])];

    for (const key of keys) {
      const left = baselineGroups.get(key) ?? [];
      const right = currentGroups.get(key) ?? [];
      const commonCount = Math.min(left.length, right.length);
      for (let ordinal = 0; ordinal < commonCount; ordinal += 1) {
        const baselineFrameId = left[ordinal]!;
        const currentFrameId = right[ordinal]!;
        const visitKey = `${baselineFrameId}:${currentFrameId}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);
        const baselineIdentity = baselineIdentities.byFrameId.get(baselineFrameId)!;
        const currentIdentity = currentIdentities.byFrameId.get(currentFrameId)!;
        pairs.push({
          baselineFrameId,
          currentFrameId,
          functionKey: key,
          confidence: confidenceFor(baselineIdentity, currentIdentity),
          baselineChildOrdinal: ordinal + 1,
          currentChildOrdinal: ordinal + 1
        });
        const baselineFrame = baseline.byFrameId.get(baselineFrameId);
        const currentFrame = current.byFrameId.get(currentFrameId);
        if (baselineFrame && currentFrame) {
          alignGroups(baselineFrame.childFrameIds, currentFrame.childFrameIds);
        }
      }
      if (left.length !== right.length) {
        recordStop({
          reason: "unmatched_function",
          ...(left.length > commonCount ? { baselineFrameIds: left.slice(commonCount) } : {}),
          ...(right.length > commonCount ? { currentFrameIds: right.slice(commonCount) } : {})
        });
      }
    }
  };

  alignGroups(baseline.roots, current.roots);
  return stop ? { pairs, stop } : { pairs };
}

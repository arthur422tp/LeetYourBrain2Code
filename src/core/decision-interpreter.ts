import type { RuntimeState } from "./runtime-state";
import { projectDecisionStructureReferences } from "./decision-structure-projection";
import type {
  ConditionEvidenceNode,
  ConditionPlan,
  DecisionBatch,
  DecisionChainOccurrence,
  DecisionEvidenceByStep,
  DecisionHistoryBySite,
  DecisionStepEvidence
} from "../shared/decision-types";

export interface DecisionInterpretation {
  byStep: DecisionEvidenceByStep;
  historyBySite: DecisionHistoryBySite;
  chains: DecisionChainOccurrence[];
}

type ForcedStatus = "short_circuited" | "partial";
type SkipReason = "and_short_circuit" | "or_short_circuit";

export function buildDecisionEvidence(
  plan: ConditionPlan | undefined,
  batches: DecisionBatch[],
  runtimeStates: RuntimeState[]
): DecisionInterpretation {
  const byStep: DecisionEvidenceByStep = new Map();
  const historyBySite: DecisionHistoryBySite = new Map();
  if (!plan) return { byStep, historyBySite, chains: [] };

  const conditionsById = new Map(plan.conditions.map((condition) => [condition.conditionId, condition]));
  const operandsById = new Map(plan.operands.map((operand) => [operand.operandId, operand]));
  const runtimeByStep = new Map(runtimeStates.map((runtime) => [runtime.step, runtime]));
  const evidenceByBatch = new Map<number, DecisionStepEvidence>();
  const sortedBatches = [...batches].sort((left, right) => left.batchId - right.batchId);

  const buildNode = (
    conditionId: string,
    resultByConditionId: Map<string, boolean>,
    evaluationsByOperandId: Map<string, DecisionBatch["condition"]["evaluations"][number]["value"]>,
    batchStatus: DecisionBatch["status"],
    forced?: ForcedStatus,
    forcedReason?: SkipReason
  ): ConditionEvidenceNode | undefined => {
    const descriptor = conditionsById.get(conditionId);
    if (!descriptor) return undefined;
    const base = {
      conditionId: descriptor.conditionId,
      kind: descriptor.kind,
      source: descriptor.source,
      operands: descriptor.operandIds
        .map((operandId) => {
          const operand = operandsById.get(operandId);
          return operand ? {
            operandId,
            source: operand.source,
            ...(evaluationsByOperandId.has(operandId) ? { value: evaluationsByOperandId.get(operandId) } : {})
          } : null;
        })
        .filter((operand): operand is NonNullable<typeof operand> => operand !== null),
      children: [] as ConditionEvidenceNode[]
    };
    if (forced === "short_circuited") {
      return {
        ...base,
        status: "short_circuited",
        skipReason: forcedReason ?? (descriptor.kind === "or" ? "or_short_circuit" : "and_short_circuit"),
        children: descriptor.childConditionIds
          .map((childId) => buildNode(childId, resultByConditionId, evaluationsByOperandId, batchStatus, "short_circuited", forcedReason))
          .filter((child): child is ConditionEvidenceNode => child !== undefined)
      };
    }
    if (forced === "partial") {
      return {
        ...base,
        status: "partial",
        children: descriptor.childConditionIds
          .map((childId) => buildNode(childId, resultByConditionId, evaluationsByOperandId, batchStatus, "partial"))
          .filter((child): child is ConditionEvidenceNode => child !== undefined)
      };
    }

    const truth = resultByConditionId.get(conditionId);
    if (truth !== undefined) {
      return {
        ...base,
        status: "evaluated",
        truth,
        children: buildChildren(descriptor, resultByConditionId, evaluationsByOperandId, batchStatus)
      };
    }

    if (descriptor.kind === "and" || descriptor.kind === "or") {
      const children: ConditionEvidenceNode[] = [];
      let shortCircuitIndex: number | null = null;
      for (let index = 0; index < descriptor.childConditionIds.length; index += 1) {
        const childId = descriptor.childConditionIds[index]!;
        const childTruth = resultByConditionId.get(childId);
        if (shortCircuitIndex !== null && index > shortCircuitIndex) {
          const child = buildNode(childId, resultByConditionId, evaluationsByOperandId, batchStatus, "short_circuited", descriptor.kind === "or" ? "or_short_circuit" : "and_short_circuit");
          if (child) children.push(child);
          continue;
        }
        const child = buildNode(childId, resultByConditionId, evaluationsByOperandId, batchStatus,
          batchStatus === "partial" && childTruth === undefined && index === children.length ? "partial" : undefined);
        if (child) children.push(child);
        if ((descriptor.kind === "and" && childTruth === false) || (descriptor.kind === "or" && childTruth === true)) {
          shortCircuitIndex = index;
        }
      }
      return {
        ...base,
        status: batchStatus === "partial" ? (children.some((child) => child.status === "partial") ? "partial" : "not_reached") : "not_reached",
        children
      };
    }

    return {
      ...base,
      status: batchStatus === "partial" ? "partial" : "not_reached"
    };
  };

  const buildChildren = (
    descriptor: ConditionPlan["conditions"][number],
    resultByConditionId: Map<string, boolean>,
    evaluationsByOperandId: Map<string, DecisionBatch["condition"]["evaluations"][number]["value"]>,
    batchStatus: DecisionBatch["status"]
  ): ConditionEvidenceNode[] => {
    if (descriptor.kind !== "and" && descriptor.kind !== "or" && descriptor.kind !== "not") return [];
    const children: ConditionEvidenceNode[] = [];
    let shortCircuitIndex: number | null = null;
    for (let index = 0; index < descriptor.childConditionIds.length; index += 1) {
      const childId = descriptor.childConditionIds[index]!;
      if (shortCircuitIndex !== null && index > shortCircuitIndex) {
        const child = buildNode(childId, resultByConditionId, evaluationsByOperandId, batchStatus, "short_circuited", descriptor.kind === "or" ? "or_short_circuit" : "and_short_circuit");
        if (child) children.push(child);
        continue;
      }
      const childTruth = resultByConditionId.get(childId);
      const child = buildNode(childId, resultByConditionId, evaluationsByOperandId, batchStatus,
        batchStatus === "partial" && childTruth === undefined ? "partial" : undefined);
      if (child) children.push(child);
      if ((descriptor.kind === "and" && childTruth === false) || (descriptor.kind === "or" && childTruth === true)) {
        shortCircuitIndex = index;
      }
    }
    return children;
  };

  for (const batch of sortedBatches) {
    const runtime = runtimeByStep.get(batch.anchorStep);
    if (!runtime || runtime.activeFrameId !== batch.frameId) continue;
    const resultByConditionId = new Map(batch.condition.conditionResults.map((result) => [result.conditionId, result.truth]));
    if (batch.condition.truth !== undefined && !resultByConditionId.has(batch.condition.conditionId)) {
      resultByConditionId.set(batch.condition.conditionId, batch.condition.truth);
    }
    const evaluationsByOperandId = new Map(batch.condition.evaluations.map((evaluation) => [evaluation.operandId, evaluation.value]));
    const condition = buildNode(batch.condition.conditionId, resultByConditionId, evaluationsByOperandId, batch.status);
    if (!condition) continue;
    const stepEvidence: DecisionStepEvidence = {
      context: batch.context ?? { loopStack: [] },
      anchorStep: batch.anchorStep,
      frameId: batch.frameId,
      siteId: batch.siteId,
      occurrence: batch.occurrence,
      status: batch.status,
      ...(batch.outcome ? { outcome: batch.outcome } : {}),
      condition,
      structureReferences: projectDecisionStructureReferences(plan, batch, runtime)
    };
    byStep.set(batch.anchorStep, stepEvidence);
    evidenceByBatch.set(batch.batchId, stepEvidence);
    const history = historyBySite.get(batch.siteId) ?? [];
    history.push({
      siteId: batch.siteId,
      occurrence: batch.occurrence,
      anchorStep: batch.anchorStep,
      frameId: batch.frameId,
      status: batch.status,
      ...(condition.truth !== undefined ? { truth: condition.truth } : {}),
      ...(batch.outcome ? { outcome: batch.outcome } : {}),
      condition
    });
    historyBySite.set(batch.siteId, history);
  }

  for (const history of historyBySite.values()) {
    history.sort((left, right) => left.occurrence - right.occurrence || left.anchorStep - right.anchorStep);
  }

  const chains: DecisionChainOccurrence[] = [];
  for (const chain of plan.chains) {
    const openOccurrences = new Map<string, DecisionChainOccurrence>();
    const sequenceByFrame = new Map<number, number>();
    const relevantBatches = sortedBatches.filter((batch) =>
      chain.branches.some((branch) => branch.siteId === batch.siteId) && evidenceByBatch.has(batch.batchId)
    );
    const contextFor = (batch: DecisionBatch) => batch.context ?? { loopStack: [] };
    const contextKey = (batch: DecisionBatch) => JSON.stringify(contextFor(batch).loopStack);
    const createOccurrence = (batch: DecisionBatch): DecisionChainOccurrence => {
      const sequence = (sequenceByFrame.get(batch.frameId) ?? 0) + 1;
      sequenceByFrame.set(batch.frameId, sequence);
      return {
        chainId: chain.chainId,
        occurrenceId: `${chain.chainId}:${batch.frameId}:${sequence}`,
        frameId: batch.frameId,
        context: contextFor(batch),
        anchorStepStart: batch.anchorStep,
        anchorStepEnd: batch.anchorStep,
        branches: chain.branches.map((branch) => ({
          branchIndex: branch.branchIndex,
          kind: branch.kind,
          status: "not_reached" as const,
          ...(branch.siteId ? { siteId: branch.siteId } : {})
        })),
        selectedBranchIndex: null
      };
    };
    const close = (key: string): void => {
      const occurrence = openOccurrences.get(key);
      if (!occurrence) return;
      chains.push(occurrence);
      openOccurrences.delete(key);
    };
    for (const batch of relevantBatches) {
      const branchIndex = chain.branches.find((branch) => branch.siteId === batch.siteId)?.branchIndex;
      if (branchIndex === undefined) continue;
      const key = `${batch.frameId}:${contextKey(batch)}`;
      if (branchIndex === 0) {
        close(key);
        openOccurrences.set(key, createOccurrence(batch));
      }
      const occurrence = openOccurrences.get(key);
      if (!occurrence) continue;
      occurrence.anchorStepEnd = Math.max(occurrence.anchorStepEnd, batch.anchorStep);
      const branch = occurrence.branches.find((item) => item.branchIndex === branchIndex);
      if (!branch) continue;
      const evidence = evidenceByBatch.get(batch.batchId);
      if (evidence) Object.assign(branch, { condition: evidence.condition, anchorStep: evidence.anchorStep });
      if (batch.status === "partial") {
        close(key);
        continue;
      }
      const truth = batch.condition.truth ?? batch.condition.conditionResults.find((result) => result.conditionId === batch.condition.conditionId)?.truth;
      if (truth === true) {
        branch.status = "selected";
        occurrence.selectedBranchIndex = branchIndex;
        close(key);
      } else if (truth === false) {
        branch.status = "rejected";
        const conditionalBranches = occurrence.branches.filter((item) => item.kind !== "else");
        const elseBranch = occurrence.branches.find((item) => item.kind === "else");
        if (elseBranch && conditionalBranches.every((item) => item.status === "rejected")) {
          elseBranch.status = "selected";
          occurrence.selectedBranchIndex = elseBranch.branchIndex;
          close(key);
        }
      }
    }
    for (const key of openOccurrences.keys()) close(key);
  }
  chains.sort((left, right) => left.frameId - right.frameId || left.anchorStepStart - right.anchorStepStart);

  return { byStep, historyBySite, chains };
}

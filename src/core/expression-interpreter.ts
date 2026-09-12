import type { RuntimeState } from "./runtime-state";
import { projectStructureReferences } from "./expression-structure-projection";
import type {
  ExpressionBatch,
  ExpressionEvidenceByStep,
  ExpressionEvidenceNode,
  ExpressionPlan,
  ExpressionRootEvaluation
} from "../shared/expression-types";

export function buildExpressionEvidence(
  plan: ExpressionPlan | undefined,
  batches: ExpressionBatch[],
  runtimeStates: RuntimeState[]
): ExpressionEvidenceByStep {
  const evidence: ExpressionEvidenceByStep = new Map();
  if (!plan) {
    return evidence;
  }

  const expressionById = new Map(plan.expressions.map((item) => [item.exprId, item]));
  const rootById = new Map(plan.roots.map((item) => [item.rootId, item]));
  const runtimeByStep = new Map(runtimeStates.map((state) => [state.step, state]));

  const buildNode = (
    exprId: string,
    evaluationsByExprId: Map<string, ExpressionRootEvaluation["evaluations"][number]>
  ): ExpressionEvidenceNode | undefined => {
    const descriptor = expressionById.get(exprId);
    if (!descriptor) {
      return undefined;
    }

    return {
      exprId: descriptor.exprId,
      kind: descriptor.kind,
      source: descriptor.source,
      value: evaluationsByExprId.get(descriptor.exprId)?.value,
      children: descriptor.childExprIds
        .map((childExprId) => buildNode(childExprId, evaluationsByExprId))
        .filter((child): child is ExpressionEvidenceNode => child !== undefined)
    };
  };

  for (const batch of batches) {
    const runtime = runtimeByStep.get(batch.anchorStep);
    if (!runtime || runtime.activeFrameId !== batch.frameId) {
      continue;
    }

    const stepEvidence = evidence.get(batch.anchorStep) ?? {
      anchorStep: batch.anchorStep,
      frameId: batch.frameId,
      roots: []
    };

    for (const rootEvaluation of batch.roots) {
      const root = rootById.get(rootEvaluation.rootId);
      if (!root) {
        continue;
      }
      const evaluationsByExprId = new Map(
        rootEvaluation.evaluations
          .filter((evaluation) => expressionById.has(evaluation.exprId))
          .map((evaluation) => [evaluation.exprId, evaluation])
      );
      const tree = buildNode(root.expressionExprId, evaluationsByExprId);
      if (!tree) {
        continue;
      }
      stepEvidence.roots.push({
        rootId: root.rootId,
        kind: root.kind,
        status: rootEvaluation.status,
        ...(root.kind === "assignment" ? { target: root.target } : {}),
        tree,
        selections: rootEvaluation.selectionEvidence ?? [],
        structureReferences: projectStructureReferences(plan, root, rootEvaluation, runtime)
      });
    }

    if (stepEvidence.roots.length > 0) {
      evidence.set(batch.anchorStep, stepEvidence);
    }
  }

  return evidence;
}

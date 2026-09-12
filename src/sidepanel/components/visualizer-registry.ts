import type {
  DictVisualModel,
  ListVisualModel,
  StructureVisualModel
} from "../../core/visual-model";
import { createLinkedListVisualizer } from "./LinkedListVisualizer";
import { createDictVisualizer } from "./DictVisualizer";
import { createListVisualizer } from "./ListVisualizer";
import { createTreeVisualizer } from "./TreeVisualizer";
import { createGraphVisualizer } from "./GraphVisualizer";

export interface VisualizerHandle {
  element: HTMLElement;
  kind: StructureVisualModel["kind"];
  update(model: StructureVisualModel): void;
  dispose(): void;
}

type ModelOf<K extends StructureVisualModel["kind"]> = Extract<StructureVisualModel, { kind: K }>;
type VisualizerFactory<K extends StructureVisualModel["kind"]> =
  (model: ModelOf<K>) => VisualizerHandle;

export type VisualizerRegistry = {
  [K in StructureVisualModel["kind"]]: VisualizerFactory<K>;
};

function withVisualId<K extends StructureVisualModel["kind"]>(
  model: ModelOf<K>,
  handle: { element: HTMLElement; update(model: ModelOf<K>): void; dispose(): void },
  kind: K
): VisualizerHandle {
  handle.element.dataset.visualId = model.visualId;
  return {
    kind,
    element: handle.element,
    update(nextModel) {
      if (nextModel.kind !== kind) {
        throw new Error(`Cannot update ${kind} visualizer with ${nextModel.kind}`);
      }
      handle.update(nextModel as ModelOf<K>);
      handle.element.dataset.visualId = nextModel.visualId;
    },
    dispose: handle.dispose
  };
}

const registry = {
  list: (model: ListVisualModel) => withVisualId(model, createListVisualizer(model), "list"),
  dict: (model: DictVisualModel) => withVisualId(model, createDictVisualizer(model), "dict"),
  linked_list: (model: ModelOf<"linked_list">) =>
    withVisualId(model, createLinkedListVisualizer(model), "linked_list"),
  tree: (model: ModelOf<"tree">) =>
    withVisualId(model, createTreeVisualizer(model), "tree"),
  graph: (model: ModelOf<"graph">) =>
    withVisualId(model, createGraphVisualizer(model), "graph")
} satisfies VisualizerRegistry;

export function createVisualizer(model: StructureVisualModel): VisualizerHandle {
  return registry[model.kind](model as never);
}

export function updateVisualizer(handle: VisualizerHandle, model: StructureVisualModel): void {
  if (handle.kind !== model.kind) {
    throw new Error(`Cannot update ${handle.kind} visualizer with ${model.kind}`);
  }
  handle.update(model);
}

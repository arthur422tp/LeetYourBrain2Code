import type { ObjectId, ValueSnapshot } from "../shared/trace-types";
import { cloneValueSnapshot } from "./value-snapshot";

export type MutationOrigin = "initial_snapshot" | "transition";

export interface VariableMutation {
  kind: "variable";
  origin: MutationOrigin;
  frameId: number;
  variableName: string;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export type ReferenceOwner =
  | { scope: "local"; frameId: number; variableName: string }
  | { scope: "object_attribute"; objectId: ObjectId; attribute: string };

export interface ReferenceMutation {
  kind: "reference";
  origin: MutationOrigin;
  owner: ReferenceOwner;
  action: "bound" | "unbound" | "redirected";
  beforeObjectId: ObjectId | null;
  afterObjectId: ObjectId | null;
}

export interface SequenceElementMutation {
  kind: "sequence_element";
  origin: MutationOrigin;
  frameId: number;
  containerName: string;
  containerKind: "list" | "tuple";
  index: number;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export interface MappingEntryMutation {
  kind: "mapping_entry";
  origin: MutationOrigin;
  frameId: number;
  containerName: string;
  key: ValueSnapshot;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export interface SetMembershipMutation {
  kind: "set_membership";
  origin: MutationOrigin;
  frameId: number;
  containerName: string;
  action: "added" | "removed";
  member: ValueSnapshot;
}

export interface ObjectAttributeMutation {
  kind: "object_attribute";
  origin: MutationOrigin;
  objectId: ObjectId;
  attribute: string;
  action: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export interface ObjectVisibilityMutation {
  kind: "object_visibility";
  origin: MutationOrigin;
  objectId: ObjectId;
  action: "appeared" | "disappeared";
}

export type RuntimeMutation =
  | VariableMutation
  | ReferenceMutation
  | SequenceElementMutation
  | MappingEntryMutation
  | SetMembershipMutation
  | ObjectAttributeMutation
  | ObjectVisibilityMutation;

export interface RuntimeMutationBatch {
  step: number;
  frameId: number | null;
  currentLine: number | null;
  mutations: RuntimeMutation[];
}

export function cloneRuntimeMutation(mutation: RuntimeMutation): RuntimeMutation {
  switch (mutation.kind) {
    case "variable":
      return {
        ...mutation,
        ...(mutation.before !== undefined ? { before: cloneValueSnapshot(mutation.before) } : {}),
        ...(mutation.after !== undefined ? { after: cloneValueSnapshot(mutation.after) } : {})
      };
    case "reference":
      return {
        ...mutation,
        owner: { ...mutation.owner }
      };
    case "sequence_element":
      return {
        ...mutation,
        ...(mutation.before !== undefined ? { before: cloneValueSnapshot(mutation.before) } : {}),
        ...(mutation.after !== undefined ? { after: cloneValueSnapshot(mutation.after) } : {})
      };
    case "mapping_entry":
      return {
        ...mutation,
        key: cloneValueSnapshot(mutation.key),
        ...(mutation.before !== undefined ? { before: cloneValueSnapshot(mutation.before) } : {}),
        ...(mutation.after !== undefined ? { after: cloneValueSnapshot(mutation.after) } : {})
      };
    case "set_membership":
      return {
        ...mutation,
        member: cloneValueSnapshot(mutation.member)
      };
    case "object_attribute":
      return {
        ...mutation,
        ...(mutation.before !== undefined ? { before: cloneValueSnapshot(mutation.before) } : {}),
        ...(mutation.after !== undefined ? { after: cloneValueSnapshot(mutation.after) } : {})
      };
    case "object_visibility":
      return { ...mutation };
  }
}

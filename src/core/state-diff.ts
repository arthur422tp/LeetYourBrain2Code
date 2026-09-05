import type { FrameState } from "./runtime-state";
import {
  cloneValueSnapshot,
  valueSnapshotKey,
  valueSnapshotsEqual
} from "./value-snapshot";
import type { ValueSnapshot } from "../shared/trace-types";

export type VariableDiffKind = "added" | "removed" | "changed" | "unchanged";

export interface VariableDiff {
  name: string;
  kind: VariableDiffKind;
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export interface ListElementDiff {
  index: number;
  kind: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export interface DictEntryDiff {
  key: ValueSnapshot;
  kind: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export interface SetMemberDiff {
  member: ValueSnapshot;
  kind: "added" | "removed";
}

export type ContainerDiff =
  | { container: string; kind: "list" | "tuple"; changes: ListElementDiff[] }
  | { container: string; kind: "dict"; changes: DictEntryDiff[] }
  | { container: string; kind: "set"; changes: SetMemberDiff[] };

export interface FrameDiff {
  frameId: number;
  variables: VariableDiff[];
  containerChanges: ContainerDiff[];
}

function listDiff(
  container: string,
  before: Extract<ValueSnapshot, { type: "list" | "tuple" }>,
  after: Extract<ValueSnapshot, { type: "list" | "tuple" }>
): ContainerDiff {
  const changes: ListElementDiff[] = [];
  const itemCount = Math.max(before.items.length, after.items.length);

  for (let index = 0; index < itemCount; index += 1) {
    const beforeItem = before.items[index];
    const afterItem = after.items[index];
    if (valueSnapshotsEqual(beforeItem, afterItem)) {
      continue;
    }
    if (beforeItem === undefined) {
      changes.push({ index, kind: "added", after: cloneValueSnapshot(afterItem!) });
    } else if (afterItem === undefined) {
      changes.push({ index, kind: "removed", before: cloneValueSnapshot(beforeItem) });
    } else {
      changes.push({
        index,
        kind: "changed",
        before: cloneValueSnapshot(beforeItem),
        after: cloneValueSnapshot(afterItem)
      });
    }
  }

  return { container, kind: before.type, changes };
}

function dictDiff(
  container: string,
  before: Extract<ValueSnapshot, { type: "dict" }>,
  after: Extract<ValueSnapshot, { type: "dict" }>
): ContainerDiff {
  const beforeEntries = new Map(
    before.entries.map((entry) => [valueSnapshotKey(entry.key), entry])
  );
  const afterEntries = new Map(
    after.entries.map((entry) => [valueSnapshotKey(entry.key), entry])
  );
  const keys = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])].sort();
  const changes: DictEntryDiff[] = [];

  for (const key of keys) {
    const beforeEntry = beforeEntries.get(key);
    const afterEntry = afterEntries.get(key);
    if (!beforeEntry && afterEntry) {
      changes.push({
        key: cloneValueSnapshot(afterEntry.key),
        kind: "added",
        after: cloneValueSnapshot(afterEntry.value)
      });
    } else if (beforeEntry && !afterEntry) {
      changes.push({
        key: cloneValueSnapshot(beforeEntry.key),
        kind: "removed",
        before: cloneValueSnapshot(beforeEntry.value)
      });
    } else if (beforeEntry && afterEntry && !valueSnapshotsEqual(beforeEntry.value, afterEntry.value)) {
      changes.push({
        key: cloneValueSnapshot(afterEntry.key),
        kind: "changed",
        before: cloneValueSnapshot(beforeEntry.value),
        after: cloneValueSnapshot(afterEntry.value)
      });
    }
  }

  return { container, kind: "dict", changes };
}

function setDiff(
  container: string,
  before: Extract<ValueSnapshot, { type: "set" }>,
  after: Extract<ValueSnapshot, { type: "set" }>
): ContainerDiff {
  const beforeMembers = new Map(before.items.map((member) => [valueSnapshotKey(member), member]));
  const afterMembers = new Map(after.items.map((member) => [valueSnapshotKey(member), member]));
  const keys = [...new Set([...beforeMembers.keys(), ...afterMembers.keys()])].sort();
  const changes: SetMemberDiff[] = [];

  for (const key of keys) {
    const beforeMember = beforeMembers.get(key);
    const afterMember = afterMembers.get(key);
    if (beforeMember === undefined && afterMember !== undefined) {
      changes.push({ member: cloneValueSnapshot(afterMember), kind: "added" });
    } else if (beforeMember !== undefined && afterMember === undefined) {
      changes.push({ member: cloneValueSnapshot(beforeMember), kind: "removed" });
    }
  }

  return { container, kind: "set", changes };
}

function structuralDiff(
  container: string,
  before: ValueSnapshot,
  after: ValueSnapshot
): ContainerDiff | undefined {
  if (
    (before.type === "list" || before.type === "tuple") &&
    (after.type === "list" || after.type === "tuple") &&
    before.type === after.type
  ) {
    return listDiff(container, before, after);
  }
  if (before.type === "dict" && after.type === "dict") {
    return dictDiff(container, before, after);
  }
  if (before.type === "set" && after.type === "set") {
    return setDiff(container, before, after);
  }
  return undefined;
}

export function diffFrameState(
  previous: FrameState | undefined,
  current: FrameState
): FrameDiff {
  const previousLocals = previous?.frameId === current.frameId ? previous.locals : undefined;
  const names = [...new Set([
    ...Object.keys(previousLocals ?? {}),
    ...Object.keys(current.locals)
  ])].sort();
  const variables: VariableDiff[] = [];
  const containerChanges: ContainerDiff[] = [];

  for (const name of names) {
    const before = previousLocals?.[name];
    const after = current.locals[name];
    if (before === undefined && after !== undefined) {
      variables.push({ name, kind: "added", after: cloneValueSnapshot(after) });
      continue;
    }
    if (before !== undefined && after === undefined) {
      variables.push({ name, kind: "removed", before: cloneValueSnapshot(before) });
      continue;
    }
    if (before === undefined || after === undefined) {
      continue;
    }

    const kind: VariableDiffKind = valueSnapshotsEqual(before, after)
      ? "unchanged"
      : "changed";
    variables.push({
      name,
      kind,
      before: cloneValueSnapshot(before),
      after: cloneValueSnapshot(after)
    });

    if (kind === "changed") {
      const change = structuralDiff(name, before, after);
      if (change && change.changes.length > 0) {
        containerChanges.push(change);
      }
    }
  }

  return { frameId: current.frameId, variables, containerChanges };
}

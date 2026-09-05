import type {
  BoolValueSnapshot,
  CycleValueSnapshot,
  DictEntrySnapshot,
  DictValueSnapshot,
  FloatValueSnapshot,
  IntValueSnapshot,
  ListValueSnapshot,
  NoneValueSnapshot,
  SetValueSnapshot,
  StringValueSnapshot,
  TupleValueSnapshot,
  UnknownValueSnapshot,
  ValueSnapshot
} from "../shared/trace-types";

export type {
  BoolValueSnapshot,
  CycleValueSnapshot,
  DictEntrySnapshot,
  DictValueSnapshot,
  FloatValueSnapshot,
  IntValueSnapshot,
  ListValueSnapshot,
  NoneValueSnapshot,
  SetValueSnapshot,
  StringValueSnapshot,
  TupleValueSnapshot,
  UnknownValueSnapshot,
  ValueSnapshot
} from "../shared/trace-types";

export function cloneValueSnapshot(snapshot: ValueSnapshot): ValueSnapshot {
  switch (snapshot.type) {
    case "list":
    case "tuple":
      return {
        ...snapshot,
        items: snapshot.items.map(cloneValueSnapshot)
      };
    case "dict":
      return {
        ...snapshot,
        entries: snapshot.entries.map((entry) => ({
          key: cloneValueSnapshot(entry.key),
          value: cloneValueSnapshot(entry.value)
        }))
      };
    case "set":
      return {
        ...snapshot,
        items: snapshot.items.map(cloneValueSnapshot)
      };
    default:
      return { ...snapshot };
  }
}

export function cloneLocals(
  locals: Record<string, ValueSnapshot>
): Record<string, ValueSnapshot> {
  return Object.fromEntries(
    Object.entries(locals).map(([name, snapshot]) => [name, cloneValueSnapshot(snapshot)])
  );
}

export function valueSnapshotKey(snapshot: ValueSnapshot): string {
  switch (snapshot.type) {
    case "list":
    case "tuple":
      return JSON.stringify({
        type: snapshot.type,
        length: snapshot.length,
        items: snapshot.items.map(valueSnapshotKey),
        truncated: snapshot.truncated
      });
    case "set":
      return JSON.stringify({
        type: snapshot.type,
        length: snapshot.length,
        items: snapshot.items.map(valueSnapshotKey).sort(),
        truncated: snapshot.truncated
      });
    case "dict":
      return JSON.stringify({
        type: snapshot.type,
        length: snapshot.length,
        entries: snapshot.entries
          .map((entry) => ({
            key: valueSnapshotKey(entry.key),
            value: valueSnapshotKey(entry.value)
          }))
          .sort((left, right) =>
            left.key.localeCompare(right.key) || left.value.localeCompare(right.value)
          ),
        truncated: snapshot.truncated
      });
    case "int":
      return JSON.stringify([snapshot.type, snapshot.value]);
    case "float":
      return JSON.stringify([snapshot.type, snapshot.value]);
    case "bool":
      return JSON.stringify([snapshot.type, snapshot.value]);
    case "str":
      return JSON.stringify([
        snapshot.type,
        snapshot.value,
        snapshot.length,
        snapshot.truncated
      ]);
    case "none":
      return JSON.stringify([snapshot.type]);
    case "unknown":
      return JSON.stringify([
        snapshot.type,
        snapshot.className,
        snapshot.repr,
        snapshot.truncated ?? false
      ]);
    case "cycle":
      return JSON.stringify([snapshot.type, snapshot.referenceId]);
  }
}

export function valueSnapshotsEqual(
  left: ValueSnapshot | undefined,
  right: ValueSnapshot | undefined
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return valueSnapshotKey(left) === valueSnapshotKey(right);
}

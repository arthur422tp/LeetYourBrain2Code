import type {
  DictEntrySnapshot,
  DictValueSnapshot,
  ListValueSnapshot,
  SetValueSnapshot,
  TupleValueSnapshot,
  ValueSnapshot
} from "../shared/trace-types";

export type CrossRunValueComparison =
  | { status: "equal" }
  | { status: "different"; detail?: string }
  | { status: "incomparable"; reason: string };

const equal = (): CrossRunValueComparison => ({ status: "equal" });
const different = (detail: string): CrossRunValueComparison => ({ status: "different", detail });
const incomparable = (reason: string): CrossRunValueComparison => ({ status: "incomparable", reason });

type OpaqueValue = Extract<ValueSnapshot, { type: "reference" | "unknown" | "cycle" }>;

function isOpaque(value: ValueSnapshot): value is OpaqueValue {
  return value.type === "reference" || value.type === "unknown" || value.type === "cycle";
}

function compareStrings(
  baseline: Extract<ValueSnapshot, { type: "str" }>,
  current: Extract<ValueSnapshot, { type: "str" }>
): CrossRunValueComparison {
  if (baseline.value !== current.value || baseline.length !== current.length) {
    return different("string content or length changed");
  }
  if (baseline.truncated || current.truncated) {
    return incomparable("at least one string snapshot is truncated");
  }
  return equal();
}

function compareSequences(
  baseline: ListValueSnapshot | TupleValueSnapshot,
  current: ListValueSnapshot | TupleValueSnapshot
): CrossRunValueComparison {
  if (baseline.length !== current.length) {
    return different("sequence length changed");
  }

  let uncertain = baseline.truncated || current.truncated;
  const sharedLength = Math.min(baseline.items.length, current.items.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const comparison = compareCrossRunValues(baseline.items[index]!, current.items[index]!);
    if (comparison.status === "different") return comparison;
    if (comparison.status === "incomparable") uncertain = true;
  }

  if (!baseline.truncated && !current.truncated && baseline.items.length !== current.items.length) {
    return different("complete sequence entries changed");
  }
  return uncertain ? incomparable("sequence snapshot is incomplete") : equal();
}

function safeEntryMap(entries: DictEntrySnapshot[]): Map<string, ValueSnapshot> | null {
  const map = new Map<string, ValueSnapshot>();
  for (const entry of entries) {
    const key = stableCrossRunValueKey(entry.key);
    if (key === null || map.has(key)) return null;
    map.set(key, entry.value);
  }
  return map;
}

function compareDictionaries(
  baseline: DictValueSnapshot,
  current: DictValueSnapshot
): CrossRunValueComparison {
  if (baseline.length !== current.length) return different("mapping length changed");

  const baselineEntries = safeEntryMap(baseline.entries);
  const currentEntries = safeEntryMap(current.entries);
  if (baselineEntries === null || currentEntries === null) {
    return incomparable("mapping contains an unsafe key");
  }

  let uncertain = baseline.truncated || current.truncated;
  for (const [key, baselineValue] of baselineEntries) {
    const currentValue = currentEntries.get(key);
    if (currentValue === undefined) {
      if (!baseline.truncated && !current.truncated) return different("mapping key set changed");
      uncertain = true;
      continue;
    }
    const comparison = compareCrossRunValues(baselineValue, currentValue);
    if (comparison.status === "different") return comparison;
    if (comparison.status === "incomparable") uncertain = true;
  }

  if (!baseline.truncated && !current.truncated && baselineEntries.size !== currentEntries.size) {
    return different("mapping key set changed");
  }
  if (baseline.truncated || current.truncated) {
    for (const key of currentEntries.keys()) {
      if (!baselineEntries.has(key)) uncertain = true;
    }
  }
  return uncertain ? incomparable("mapping snapshot is incomplete") : equal();
}

function safeSetKeys(value: SetValueSnapshot): string[] | null {
  const keys: string[] = [];
  for (const item of value.items) {
    const key = stableCrossRunValueKey(item);
    if (key === null || keys.includes(key)) return null;
    keys.push(key);
  }
  return keys.sort();
}

function compareSets(
  baseline: SetValueSnapshot,
  current: SetValueSnapshot
): CrossRunValueComparison {
  if (baseline.length !== current.length) return different("set length changed");
  const baselineKeys = safeSetKeys(baseline);
  const currentKeys = safeSetKeys(current);
  if (baselineKeys === null || currentKeys === null) {
    return incomparable("set contains an unsafe member");
  }
  if (baseline.truncated || current.truncated) {
    return incomparable("set snapshot is incomplete");
  }
  return baselineKeys.join("\u0000") === currentKeys.join("\u0000")
    ? equal()
    : different("set membership changed");
}

function compareOpaqueValues(baseline: OpaqueValue, current: OpaqueValue): CrossRunValueComparison {
  if (baseline.type === "reference" && current.type === "reference") {
    return baseline.className === current.className
      ? incomparable("object identity is run-local")
      : different("reference class changed");
  }
  if (baseline.type === "unknown" && current.type === "unknown") {
    return baseline.className === current.className
      ? incomparable("unknown value identity is unavailable")
      : different("unknown value class changed");
  }
  return incomparable("opaque value identity is unavailable");
}

export function compareCrossRunValues(
  baseline: ValueSnapshot,
  current: ValueSnapshot
): CrossRunValueComparison {
  if (isOpaque(baseline) || isOpaque(current)) {
    if (isOpaque(baseline) && isOpaque(current)) return compareOpaqueValues(baseline, current);
    return different("value category changed");
  }
  if (baseline.type !== current.type) return different("value type changed");

  switch (baseline.type) {
    case "int":
      return baseline.value === (current as Extract<ValueSnapshot, { type: "int" }>).value
        ? equal()
        : different("integer value changed");
    case "float": {
      const currentValue = (current as Extract<ValueSnapshot, { type: "float" }>).value;
      return Object.is(baseline.value, currentValue) ? equal() : different("float value changed");
    }
    case "bool":
      return baseline.value === (current as Extract<ValueSnapshot, { type: "bool" }>).value
        ? equal()
        : different("boolean value changed");
    case "str":
      return compareStrings(baseline, current as Extract<ValueSnapshot, { type: "str" }>);
    case "none":
      return equal();
    case "list":
      return compareSequences(baseline, current as ListValueSnapshot);
    case "tuple":
      return compareSequences(baseline, current as TupleValueSnapshot);
    case "dict":
      return compareDictionaries(baseline, current as DictValueSnapshot);
    case "set":
      return compareSets(baseline, current as SetValueSnapshot);
    default:
      return incomparable("value comparison is unsupported");
  }
}

export function stableCrossRunValueKey(value: ValueSnapshot): string | null {
  switch (value.type) {
    case "int":
      return `int:${value.value}`;
    case "float":
      return `float:${Object.is(value.value, -0) ? "-0" : String(value.value)}`;
    case "bool":
      return `bool:${value.value ? "true" : "false"}`;
    case "str":
      return value.truncated ? null : `str:${JSON.stringify(value.value)}`;
    case "none":
      return "none:null";
    case "list": {
      if (value.truncated) return null;
      const keys = value.items.map(stableCrossRunValueKey);
      return keys.every((key): key is string => key !== null)
        ? `list:[${keys.join(",")}]`
        : null;
    }
    case "tuple": {
      if (value.truncated) return null;
      const keys = value.items.map(stableCrossRunValueKey);
      return keys.every((key): key is string => key !== null)
        ? `tuple:[${keys.join(",")}]`
        : null;
    }
    case "dict": {
      if (value.truncated) return null;
      const entries: string[] = [];
      for (const entry of value.entries) {
        const key = stableCrossRunValueKey(entry.key);
        const entryValue = stableCrossRunValueKey(entry.value);
        if (key === null || entryValue === null) return null;
        entries.push(`${key}=>${entryValue}`);
      }
      return `dict:{${entries.sort().join(",")}}`;
    }
    case "set": {
      if (value.truncated) return null;
      const keys = value.items.map(stableCrossRunValueKey);
      return keys.every((key): key is string => key !== null)
        ? `set:{${keys.sort().join(",")}}`
        : null;
    }
    case "reference":
    case "unknown":
    case "cycle":
      return null;
  }
}

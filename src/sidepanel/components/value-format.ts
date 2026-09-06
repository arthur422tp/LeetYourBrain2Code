import type { ValueSnapshot } from "../../shared/trace-types";

export function formatValue(snapshot: ValueSnapshot | undefined): string {
  if (snapshot === undefined) {
    return "—";
  }

  switch (snapshot.type) {
    case "int":
      return snapshot.value;
    case "float":
      return String(snapshot.value);
    case "bool":
      return snapshot.value ? "True" : "False";
    case "str":
      return JSON.stringify(snapshot.value);
    case "none":
      return "None";
    case "list":
      return `[${snapshot.items.map((item) => formatValue(item)).join(", ")}${snapshot.truncated ? ", …" : ""}]`;
    case "tuple": {
      const values = snapshot.items.map((item) => formatValue(item)).join(", ");
      const suffix = snapshot.items.length === 1 ? "," : "";
      return `(${values}${suffix}${snapshot.truncated ? " …" : ""})`;
    }
    case "dict":
      return `{${snapshot.entries
        .map((entry) => `${formatValue(entry.key)}: ${formatValue(entry.value)}`)
        .join(", ")}${snapshot.truncated ? ", …" : ""}}`;
    case "set":
      return `{${snapshot.items.map((item) => formatValue(item)).join(", ")}${snapshot.truncated ? ", …" : ""}}`;
    case "unknown":
      return snapshot.repr || `<${snapshot.className}>`;
    case "cycle":
      return `<cycle ${snapshot.referenceId}>`;
  }
}

import json
import math


def _limit(limits, snake_name, camel_name, default):
    if snake_name in limits:
        return limits[snake_name]
    if camel_name in limits:
        return limits[camel_name]
    return default


class ValueSerializer:
    """Convert Python runtime values into bounded, JSON-safe snapshots."""

    def __init__(self, limits):
        self.max_container_items = max(
            0, int(_limit(limits, "max_container_items", "maxContainerItems", 1000))
        )
        self.max_nesting_depth = max(
            0, int(_limit(limits, "max_nesting_depth", "maxNestingDepth", 12))
        )
        self.max_snapshot_bytes = max(
            0, int(_limit(limits, "max_snapshot_bytes", "maxSnapshotBytes", 256_000))
        )
        self.active_objects = set()
        self.references = {}
        self.next_reference_id = 1

    def _cycle(self, value):
        object_id = id(value)
        reference_id = self.references.get(object_id)
        if reference_id is None:
            reference_id = f"ref-{self.next_reference_id}"
            self.next_reference_id += 1
            self.references[object_id] = reference_id
        return {"type": "cycle", "referenceId": reference_id}

    def _safe_class_name(self, value):
        try:
            return type(value).__name__
        except Exception:
            return "unknown"

    def _safe_repr(self, value):
        try:
            return repr(value)
        except Exception:
            return "<unrepresentable>"

    def _unknown(self, value, truncated=False):
        representation = self._truncate_text(
            self._safe_repr(value), self.max_snapshot_bytes
        )
        snapshot = {
            "type": "unknown",
            "className": self._safe_class_name(value),
            "repr": representation,
        }
        if truncated:
            snapshot["truncated"] = True
        return snapshot

    def _truncate_text(self, value, max_bytes):
        encoded = value.encode("utf-8", errors="surrogatepass")
        if len(encoded) <= max_bytes:
            return value
        return encoded[:max_bytes].decode("utf-8", errors="ignore")

    def _encoded_size(self, snapshot):
        try:
            encoded = json.dumps(
                snapshot, ensure_ascii=False, separators=(",", ":")
            ).encode("utf-8", errors="surrogatepass")
            return len(encoded)
        except Exception:
            return self.max_snapshot_bytes + 1

    def _truncated_snapshot(self, value):
        return {
            "type": "unknown",
            "className": self._safe_class_name(value),
            "repr": "<snapshot truncated>",
            "truncated": True,
        }

    def _container_candidate(self, snapshot, item_count):
        candidate = dict(snapshot)
        if snapshot["type"] == "dict":
            candidate["entries"] = snapshot["entries"][:item_count]
        else:
            candidate["items"] = snapshot["items"][:item_count]
        candidate["truncated"] = True
        return candidate

    def _fit_container(self, snapshot, value):
        items_key = "entries" if snapshot["type"] == "dict" else "items"
        items = snapshot[items_key]
        for item_count in range(len(items), -1, -1):
            candidate = self._container_candidate(snapshot, item_count)
            if self._encoded_size(candidate) <= self.max_snapshot_bytes:
                return candidate
        return self._truncated_snapshot(value)

    def _fit_string(self, snapshot, value):
        low = 0
        high = len(value)
        best = None
        while low <= high:
            middle = (low + high) // 2
            candidate = {
                "type": "str",
                "value": self._truncate_text(value, middle),
                "length": len(value),
                "truncated": True,
            }
            if self._encoded_size(candidate) <= self.max_snapshot_bytes:
                best = candidate
                low = middle + 1
            else:
                high = middle - 1
        return best if best is not None else self._truncated_snapshot(value)

    def _fit_snapshot(self, snapshot, value):
        if self.max_snapshot_bytes > 0 and self._encoded_size(snapshot) <= self.max_snapshot_bytes:
            return snapshot
        if snapshot.get("type") in {"list", "tuple", "dict", "set"}:
            return self._fit_container(snapshot, value)
        if snapshot.get("type") == "str":
            return self._fit_string(snapshot, value)
        return self._truncated_snapshot(value)

    def serialize(self, value, depth=0):
        return self._fit_snapshot(self._serialize(value, depth), value)

    def _canonical_snapshot_key(self, snapshot):
        try:
            return json.dumps(
                snapshot, ensure_ascii=True, sort_keys=True, separators=(",", ":")
            )
        except Exception:
            return self._safe_repr(snapshot)

    def _serialize_set_items(self, value, depth):
        if self.max_container_items == 0:
            return []

        selected = []
        for item in value:
            snapshot = self.serialize(item, depth + 1)
            selected.append((self._canonical_snapshot_key(snapshot), snapshot))
            selected.sort(key=lambda pair: pair[0])
            if len(selected) > self.max_container_items:
                selected.pop()
        return [snapshot for _key, snapshot in selected]

    def _serialize(self, value, depth=0):
        if value is None:
            return {"type": "none", "value": None}
        if isinstance(value, bool):
            return {"type": "bool", "value": value}
        if isinstance(value, int):
            return {"type": "int", "value": str(value)}
        if isinstance(value, float):
            if math.isnan(value):
                encoded = "NaN"
            elif math.isinf(value):
                encoded = "Infinity" if value > 0 else "-Infinity"
            else:
                encoded = value
            return {"type": "float", "value": encoded}
        if isinstance(value, str):
            return {
                "type": "str",
                "value": value,
                "length": len(value),
                "truncated": False,
            }

        if depth >= self.max_nesting_depth:
            return self._unknown(value, truncated=True)

        object_id = id(value)
        if object_id in self.active_objects:
            return self._cycle(value)

        if isinstance(value, (list, tuple)):
            self.active_objects.add(object_id)
            try:
                values = value[: self.max_container_items]
                items = [
                    self.serialize(item, depth + 1)
                    for item in values
                ]
                length = len(value)
            except Exception:
                return self._unknown(value)
            finally:
                self.active_objects.discard(object_id)
            return {
                "type": "tuple" if isinstance(value, tuple) else "list",
                "length": length,
                "items": items,
                "truncated": length > self.max_container_items,
            }

        if isinstance(value, dict):
            self.active_objects.add(object_id)
            try:
                entries = []
                if self.max_container_items > 0:
                    for key, item in value.items():
                        entry = {
                            "key": self.serialize(key, depth + 1),
                            "value": self.serialize(item, depth + 1),
                        }
                        entries.append(entry)
                        entries.sort(
                            key=lambda candidate: (
                                self._canonical_snapshot_key(candidate["key"]),
                                self._canonical_snapshot_key(candidate["value"]),
                            )
                        )
                        if len(entries) > self.max_container_items:
                            entries.pop()
                length = len(value)
            except Exception:
                return self._unknown(value)
            finally:
                self.active_objects.discard(object_id)
            return {
                "type": "dict",
                "length": length,
                "entries": entries,
                "truncated": length > self.max_container_items,
            }

        if isinstance(value, (set, frozenset)):
            self.active_objects.add(object_id)
            try:
                items = self._serialize_set_items(value, depth)
                length = len(value)
            except Exception:
                return self._unknown(value)
            finally:
                self.active_objects.discard(object_id)
            return {
                "type": "set",
                "length": length,
                "items": items,
                "truncated": length > self.max_container_items,
            }

        return self._unknown(value)

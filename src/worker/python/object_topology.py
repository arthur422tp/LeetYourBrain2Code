from collections import deque

from object_identity import ObjectIdentityRegistry


def _limit(limits, snake_name, camel_name, default):
    if snake_name in limits:
        return limits[snake_name]
    if camel_name in limits:
        return limits[camel_name]
    return default


class ObjectTopologyCollector:
    """Capture a bounded graph of safe user-defined instance attributes."""

    def __init__(self, limits, identity_registry=None):
        self.limits = limits
        self.identity_registry = identity_registry or ObjectIdentityRegistry()
        self.max_object_nodes = max(
            0, int(_limit(limits, "max_object_nodes", "maxObjectNodes", 200))
        )
        self.max_object_attributes = max(
            0, int(_limit(limits, "max_object_attributes", "maxObjectAttributes", 20))
        )
        self.max_object_depth = max(
            0, int(_limit(limits, "max_object_depth", "maxObjectDepth", 32))
        )

    def _safe_attributes(self, value):
        try:
            attributes = vars(value)
        except Exception:
            return None
        return attributes if isinstance(attributes, dict) else None

    def _is_object_node(self, value):
        if value is None or isinstance(value, (bool, int, float, str, bytes)):
            return False
        if isinstance(value, (list, tuple, dict, set, frozenset)):
            return False
        return self._safe_attributes(value) is not None

    def capture(self, roots):
        from serializer import ValueSerializer

        serializer = ValueSerializer(self.limits, identity_registry=self.identity_registry)
        queue = deque((root, 0) for root in roots)
        visited = set()
        objects = []
        truncated = False

        while queue:
            value, depth = queue.popleft()
            if not self._is_object_node(value):
                continue

            if depth > self.max_object_depth:
                truncated = True
                continue

            identity = id(value)
            if identity in visited:
                continue
            visited.add(identity)

            if len(objects) >= self.max_object_nodes:
                truncated = True
                break

            attributes = self._safe_attributes(value)
            if attributes is None:
                continue

            names = sorted(attributes)[: self.max_object_attributes]
            if len(attributes) > len(names):
                truncated = True

            serialized_attributes = {}
            for name in names:
                try:
                    attribute_value = attributes[name]
                    serialized_attributes[name] = serializer.serialize(attribute_value, depth + 1)
                except Exception:
                    truncated = True
                    continue
                if self._is_object_node(attribute_value):
                    queue.append((attribute_value, depth + 1))

            objects.append(
                {
                    "objectId": self.identity_registry.object_id(value),
                    "className": serializer._safe_class_name(value),
                    "attributes": serialized_attributes,
                }
            )

        return {"objects": objects, "truncated": truncated}

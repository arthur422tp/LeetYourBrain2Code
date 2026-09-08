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
        self.max_container_items = max(
            0, int(_limit(limits, "max_container_items", "maxContainerItems", 1000))
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

    def _is_traversal_container(self, value):
        return type(value) in (list, tuple, dict, set, frozenset)

    def _container_children(self, value):
        if type(value) in (list, tuple):
            items = list(value[: self.max_container_items])
            return items, len(value) > len(items)

        if type(value) is dict:
            entries = list(value.items())[: self.max_container_items]
            children = []
            for key, item in entries:
                children.extend((key, item))
            return children, len(value) > len(entries)

        if type(value) in (set, frozenset):
            items = []
            for item in value:
                if len(items) >= self.max_container_items:
                    break
                items.append(item)
            return items, len(value) > len(items)

        return [], False

    def capture(self, roots):
        from serializer import ValueSerializer

        serializer = ValueSerializer(self.limits, identity_registry=self.identity_registry)
        queue = deque((root, 0) for root in roots)
        visited_objects = set()
        visited_containers = set()
        objects = []
        truncated = False

        while queue:
            value, depth = queue.popleft()
            if depth > self.max_object_depth:
                truncated = True
                continue

            if self._is_traversal_container(value):
                identity = id(value)
                if identity in visited_containers:
                    continue
                visited_containers.add(identity)

                children, container_truncated = self._container_children(value)
                truncated = truncated or container_truncated
                for child in children:
                    queue.append((child, depth + 1))
                continue

            if not self._is_object_node(value):
                continue

            identity = id(value)
            if identity in visited_objects:
                continue
            visited_objects.add(identity)

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
                if self._is_object_node(attribute_value) or self._is_traversal_container(attribute_value):
                    queue.append((attribute_value, depth + 1))

            objects.append(
                {
                    "objectId": self.identity_registry.object_id(value),
                    "className": serializer._safe_class_name(value),
                    "attributes": serialized_attributes,
                }
            )

        return {"objects": objects, "truncated": truncated}

class ObjectIdentityRegistry:
    """Assign opaque, session-local ids to Python object identities."""

    def __init__(self):
        self._ids = {}
        self._next = 1

    def object_id(self, value):
        key = id(value)
        existing = self._ids.get(key)
        if existing is not None:
            return existing
        token = f"obj-{self._next}"
        self._next += 1
        self._ids[key] = token
        return token

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from object_topology import ObjectTopologyCollector


class Node:
    def __init__(self, value, next=None):
        self.value = value
        self.next = next


def collector(**overrides):
    limits = {
        "max_container_items": 20,
        "max_nesting_depth": 12,
        "max_snapshot_bytes": 256_000,
        "max_object_nodes": 200,
        "max_object_attributes": 20,
        "max_object_depth": 32,
    }
    limits.update(overrides)
    return ObjectTopologyCollector(limits)


def captured_values(topology):
    return sorted(
        int(obj["attributes"]["value"]["value"])
        for obj in topology["objects"]
    )


def test_list_root_discovers_user_objects_inside_container():
    first = Node(1)
    second = Node(2)

    topology = collector().capture([[first, second]])

    assert captured_values(topology) == [1, 2]
    assert topology["truncated"] is False


def test_nested_containers_discover_objects():
    node = Node(7)

    assert captured_values(collector().capture([{"nodes": ([node],)}])) == [7]


def test_dict_keys_and_values_are_traversed():
    key = Node(1)
    value = Node(2)

    assert captured_values(collector().capture([{key: value}])) == [1, 2]


def test_set_and_frozenset_are_traversed():
    left = Node(3)
    right = Node(4)

    assert captured_values(collector().capture([{left}, frozenset({right})])) == [3, 4]


def test_object_attribute_container_reaches_child_objects():
    parent = Node(1)
    child = Node(2)
    parent.children = [child]

    assert captured_values(collector().capture([parent])) == [1, 2]


def test_container_cycle_terminates():
    root = []
    root.append(root)

    assert collector().capture([root]) == {"objects": [], "truncated": False}


def test_container_item_bound_marks_topology_truncated():
    topology = collector(max_container_items=2).capture(
        [[Node(1), Node(2), Node(3)]]
    )

    assert captured_values(topology) == [1, 2]
    assert topology["truncated"] is True


def test_container_membership_consumes_topology_depth():
    topology = collector(max_object_depth=0).capture([[Node(9)]])

    assert topology["objects"] == []
    assert topology["truncated"] is True


def test_object_node_bound_remains_enforced_after_container_traversal():
    topology = collector(max_object_nodes=1).capture(
        [[Node(1), Node(2), Node(3)]]
    )

    assert len(topology["objects"]) == 1
    assert topology["truncated"] is True

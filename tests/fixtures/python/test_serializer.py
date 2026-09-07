import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src" / "worker" / "python"))

from serializer import ValueSerializer


def serializer(**overrides):
    limits = {
        "max_container_items": 20,
        "max_nesting_depth": 8,
        "max_snapshot_bytes": 20_000,
    }
    limits.update(overrides)
    return ValueSerializer(limits)


def test_small_snapshot_budget_preserves_list_shape_while_truncating_items():
    serializer = ValueSerializer(
        {
            "max_container_items": 20,
            "max_nesting_depth": 8,
            "max_snapshot_bytes": 96,
        }
    )

    snapshot = serializer.serialize([1, 2, 3, 4])

    assert snapshot["type"] == "list"
    assert snapshot["truncated"] is True
    assert len(json.dumps(snapshot, separators=(",", ":")).encode("utf-8")) <= 96


def test_big_integer_is_encoded_as_decimal_string_without_precision_loss():
    assert serializer().serialize(9_007_199_254_740_993) == {
        "type": "int",
        "value": "9007199254740993",
    }


def test_non_finite_floats_keep_explicit_json_safe_values():
    assert serializer().serialize(float("nan")) == {"type": "float", "value": "NaN"}
    assert serializer().serialize(float("inf")) == {
        "type": "float",
        "value": "Infinity",
    }
    assert serializer().serialize(float("-inf")) == {
        "type": "float",
        "value": "-Infinity",
    }


def test_nested_lists_and_tuples_keep_their_container_kinds():
    assert serializer().serialize([[1, 2], (3, 4)]) == {
        "type": "list",
        "length": 2,
        "items": [
            {
                "type": "list",
                "length": 2,
                "items": [
                    {"type": "int", "value": "1"},
                    {"type": "int", "value": "2"},
                ],
                "truncated": False,
            },
            {
                "type": "tuple",
                "length": 2,
                "items": [
                    {"type": "int", "value": "3"},
                    {"type": "int", "value": "4"},
                ],
                "truncated": False,
            },
        ],
        "truncated": False,
    }


def test_dict_preserves_tuple_keys_as_snapshots():
    assert serializer().serialize({("row", 1): "value"}) == {
        "type": "dict",
        "length": 1,
        "entries": [
            {
                "key": {
                    "type": "tuple",
                    "length": 2,
                    "items": [
                        {"type": "str", "value": "row", "length": 3, "truncated": False},
                        {"type": "int", "value": "1"},
                    ],
                    "truncated": False,
                },
                "value": {"type": "str", "value": "value", "length": 5, "truncated": False},
            }
        ],
        "truncated": False,
    }


def test_set_items_are_sorted_by_their_serialized_identity():
    assert serializer().serialize({3, 1, 2}) == {
        "type": "set",
        "length": 3,
        "items": [
            {"type": "int", "value": "1"},
            {"type": "int", "value": "2"},
            {"type": "int", "value": "3"},
        ],
        "truncated": False,
    }


def test_recursive_list_becomes_a_cycle_snapshot_instead_of_recursing_forever():
    value = []
    value.append(value)

    snapshot = serializer().serialize(value)

    assert snapshot["type"] == "list"
    assert snapshot["items"] == [{"type": "cycle", "referenceId": "ref-1"}]
    json.dumps(snapshot)


def test_container_item_limit_marks_large_lists_as_truncated():
    snapshot = serializer(max_container_items=3).serialize(list(range(10)))

    assert snapshot["length"] == 10
    assert snapshot["items"] == [
        {"type": "int", "value": "0"},
        {"type": "int", "value": "1"},
        {"type": "int", "value": "2"},
    ]
    assert snapshot["truncated"] is True


def test_truncated_dict_uses_canonical_key_order_instead_of_insertion_order():
    first = serializer(max_container_items=1).serialize({"b": 2, "a": 1})
    second = serializer(max_container_items=1).serialize({"a": 1, "b": 2})

    assert first == second
    assert first["entries"] == [{
        "key": {"type": "str", "value": "a", "length": 1, "truncated": False},
        "value": {"type": "int", "value": "1"},
    }]


def test_nesting_limit_falls_back_to_a_truncated_snapshot():
    snapshot = serializer(max_nesting_depth=1).serialize([[1]])

    assert snapshot["type"] == "list"
    assert snapshot["items"] == [
        {
            "type": "unknown",
            "className": "list",
            "repr": "[1]",
            "truncated": True,
        }
    ]


def test_custom_object_is_serialized_as_a_reference_without_calling_repr():
    class BrokenRepr:
        def __repr__(self):
            raise RuntimeError("repr failed")

    snapshot = serializer().serialize(BrokenRepr())

    assert snapshot["type"] == "reference"
    assert snapshot["className"] == "BrokenRepr"
    assert snapshot["objectId"].startswith("obj-")

"""Unit tests for :func:`packing_class_key_of` — the geotech class identity.

Owner ruling 2026-08-21 (*"yes one mass one body"*): two regions of the same
packing CLASS tied across a geological boundary are one body, even though the
geotech model stores them under different formation rows (one row per NAD class
× litho parent × GEOLOGICAL parent). The class key collapses those twin rows.

The complement (owner, same ruling, mirrored in ``resolve_litho_instances`` and
the frontend twin ``packingClassOf.ts``): a formation missing EITHER half of its
identity keeps its own row id — two unknowns are not known to be the same
density, so they must never weld across rows.
"""

from __future__ import annotations

from groundmodel.domain.services.voxel_litho.packing_class_key import packing_class_key_of


def test_a_row_with_both_halves_maps_to_soil_pipe_class() -> None:
    """A NAD-6 sand row keys on ``"ZAND|6"``."""
    key = packing_class_key_of([("f1", 6, "ZAND", None)])

    assert key("f1") == "ZAND|6"


def test_two_twin_rows_of_one_class_share_a_key() -> None:
    """The same class under two row ids collapses to one key (the #278 case)."""
    key = packing_class_key_of([("f1", 6, "ZAND", None), ("f2", 6, "ZAND", None)])

    assert key("f1") == key("f2") == "ZAND|6"


def test_a_missing_nad_class_keeps_the_row_id() -> None:
    """A skeleton band with no NAD class stays its own identity."""
    key = packing_class_key_of([("f1", None, "ZAND", None)])

    assert key("f1") == "f1"


def test_a_missing_soil_code_keeps_the_row_id() -> None:
    """No soil code, no known class — the row id stands."""
    key = packing_class_key_of([("f1", 6, None, None)])

    assert key("f1") == "f1"


def test_two_unknowns_are_not_known_equal() -> None:
    """Two rows each missing their class must NOT collapse to one key."""
    key = packing_class_key_of([("f3", None, "ZAND", None), ("f4", None, "KLEI", None)])

    assert key("f3") == "f3"
    assert key("f4") == "f4"
    assert key("f3") != key("f4")


def test_different_classes_get_different_keys() -> None:
    """NAD-6 and NAD-7 sand are different masses, so different keys."""
    key = packing_class_key_of([("f1", 6, "ZAND", None), ("f2", 7, "ZAND", None)])

    assert key("f1") != key("f2")


def test_an_unknown_id_is_returned_unchanged() -> None:
    """An id not among the rows falls through to itself (safe to call blind)."""
    key = packing_class_key_of([("f1", 6, "ZAND", None)])

    assert key("not-a-known-row") == "not-a-known-row"


def test_two_litho_units_of_one_soil_and_class_never_share_a_key() -> None:
    """ZAND NAD 6 and ZAND (SL:M) NAD 6 stay two masses in the voxel paint.

    Owner 2026-10-03: "a zand and zand/matig siltig are 2 different lithologies,
    never weld those" — the litho unit leads the key.
    """
    key = packing_class_key_of([("g1", 6, "ZAND", "u-zand"), ("g2", 6, "ZAND", "u-zand-slm")])

    assert key("g1") == "u-zand|ZAND|6"
    assert key("g1") != key("g2")

"""Integrity of the Belgian lithology + NAD reference codelist (slice 2).

Pins the curated reference table against the source (``laagnr
NAD-NEN``, 31 classes) so a future edit can't silently drop or
misalign a class — the class number is the Phase-5 parameter join key.
"""

from __future__ import annotations

from groundmodel.shared.constants.litho_constants import (
    BASE_LITHOLOGIES,
    NAD_CLASS_MAX,
    NAD_CLASS_MIN,
    NAD_CLASSES,
)


def test_five_base_lithologies() -> None:
    """The base axis is exactly the five Belgian soil types."""
    assert set(BASE_LITHOLOGIES) == {"GRIND", "ZAND", "SILT", "KLEI", "VEEN"}


def test_nad_classes_are_1_to_31_contiguous() -> None:
    """All 31 ``laagnr`` rows present, keyed contiguously 1..31."""
    assert sorted(NAD_CLASSES) == list(range(1, 32))
    assert NAD_CLASS_MIN == 1
    assert NAD_CLASS_MAX == 31
    assert min(NAD_CLASSES) == NAD_CLASS_MIN
    assert max(NAD_CLASSES) == NAD_CLASS_MAX


def test_every_nad_class_maps_to_a_known_base_lithology() -> None:
    """Each class's base lithology is one of the five base tokens, and
    the name starts with that base (catches a copy/paste misalignment)."""
    for n, (name, base) in NAD_CLASSES.items():
        assert base in BASE_LITHOLOGIES, f"class {n}: unknown base {base}"
        assert name, f"class {n}: empty name"
        assert name.upper().startswith(base), (
            f"class {n}: name {name!r} does not start with base {base}"
        )


def test_source_typos_are_normalised() -> None:
    """The xlsx artefacts ('KLEi', double spaces) are cleaned in the
    curated table (these strings are shown to engineers)."""
    for name, _base in NAD_CLASSES.values():
        assert "KLEi" not in name
        assert "  " not in name

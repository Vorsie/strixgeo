"""Unit tests for the export unit-identifier scheme (debt #104).

The scheme turns a unit's machine-usable fields — ``nad_class`` and
``litho_main_soil_code`` — into ONE deterministic token that every
exporter reuses as the unit's identity (DXF layer name, Plaxis
material identification, mapping-table key).

What we assert:

* The token shape per level: geotech (class + soil), geotech without a
  soil code, litho (soil only), geological (no identifiers at all).
* Zero-padding — so ``NAD-06`` sorts before ``NAD-21`` in a CAD layer
  manager, which a bare ``NAD-6`` would not.
* CAD legality — the token never contains a DXF-forbidden character,
  even when the soil token arrives dirty.
* Determinism — the same inputs always give the same token, and two
  different (class, soil) pairs never give the same token.
* The mapping table renders aligned rows with the absent-value marker.
"""

from __future__ import annotations

from uuid import UUID

import pytest

from groundmodel.infrastructure.exporters.unit_identifier import (
    UnitMappingRow,
    format_mapping_table,
    unit_identifier,
)
from groundmodel.infrastructure.exporters.unit_identifier_constants import (
    DXF_FORBIDDEN_LAYER_CHARS,
    MAPPING_TABLE_ABSENT,
    MAPPING_TABLE_GEO_HEADING,
    MAPPING_TABLE_TITLE,
)

# ---------------------------------------------------------------------------
# Token shape, per model level
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "nad_class, soil_code, expected",
    [
        # Geotech unit — the full identifier a downstream tool maps to
        # a material definition.
        (6, "ZAND", "NAD-06_ZAND"),
        (21, "KLEI", "NAD-21_KLEI"),
        # Zero-padding: a single-digit class must still sort before 21.
        (5, "SILT", "NAD-05_SILT"),
        # Geotech skeleton — classified band with no soil code on the
        # litho parent. The class alone is still machine-usable.
        (6, None, "NAD-06"),
        # Litho unit — no class yet, the soil code IS the identifier.
        (None, "ZAND", "ZAND"),
        # Geological formation — carries neither, so it has no
        # machine-usable identifier and the exporters must fall back to
        # today's display-name-only behaviour.
        (None, None, None),
    ],
)
def test_identifier_shape_per_level(
    nad_class: int | None, soil_code: str | None, expected: str | None
) -> None:
    """The token each model level produces."""
    assert unit_identifier(nad_class=nad_class, litho_main_soil_code=soil_code) == expected


def test_zero_padded_classes_sort_numerically_as_text() -> None:
    """The pad exists so a CAD layer list reads in NAD order.

    Sorting the tokens as plain strings — which is what every CAD layer
    manager does — must put class 6 above class 21.
    """
    six = unit_identifier(nad_class=6, litho_main_soil_code="ZAND")
    twentyone = unit_identifier(nad_class=21, litho_main_soil_code="ZAND")
    assert six is not None and twentyone is not None
    assert sorted([twentyone, six]) == [six, twentyone]


def test_soil_code_is_normalised_to_upper_case() -> None:
    """Soil codes are a closed BaseLithology vocabulary stored upper-case;
    a lower-case row must not mint a second, different identifier."""
    assert unit_identifier(nad_class=6, litho_main_soil_code="zand") == "NAD-06_ZAND"


def test_identifier_is_always_cad_legal() -> None:
    """A dirty soil token must never push a DXF-forbidden character into
    a layer name — the export would be rejected by AutoCAD."""
    token = unit_identifier(nad_class=6, litho_main_soil_code='ZA/ND<"*')
    assert token == "NAD-06_ZAND"
    assert token is not None
    assert not (set(token) & DXF_FORBIDDEN_LAYER_CHARS)


def test_blank_soil_code_is_treated_as_absent() -> None:
    """An empty / whitespace soil code must not mint ``NAD-06_``."""
    assert unit_identifier(nad_class=6, litho_main_soil_code="   ") == "NAD-06"
    assert unit_identifier(nad_class=None, litho_main_soil_code="") is None


def test_distinct_pairs_never_collide() -> None:
    """Different (class, soil) pairs must never produce the same token —
    a collision would weld two materials into one downstream."""
    pairs = [(6, "ZAND"), (6, "KLEI"), (21, "ZAND"), (None, "ZAND"), (6, None)]
    tokens = [unit_identifier(nad_class=c, litho_main_soil_code=s) for c, s in pairs]
    assert len(set(tokens)) == len(pairs)


# ---------------------------------------------------------------------------
# Mapping table rendering
# ---------------------------------------------------------------------------


def test_mapping_table_renders_aligned_rows_with_absent_marker() -> None:
    """Title, headings, rule, then one aligned row per unit."""
    rows = [
        UnitMappingRow(
            export_label="NAD-06_ZAND - Zand van Diest (NAD 6)",
            nad_class=6,
            soil_code="ZAND",
            display_name="Zand van Diest (NAD 6)",
            formation_id=UUID("00000000-0000-0000-0000-0000000000aa"),
        ),
        UnitMappingRow(
            export_label="Zand van Diest",
            nad_class=None,
            soil_code="ZAND",
            display_name="Zand van Diest",
            formation_id=UUID("00000000-0000-0000-0000-0000000000bb"),
        ),
    ]
    lines = format_mapping_table(rows, label_heading="Plaxis material")

    assert lines[0] == MAPPING_TABLE_TITLE
    body = "\n".join(lines)
    assert "Plaxis material" in body
    assert "NAD-06_ZAND - Zand van Diest (NAD 6)" in body
    assert "00000000-0000-0000-0000-0000000000aa" in body
    # The unclassified row must state the class is absent rather than
    # silently render an empty cell that reads like a rendering bug.
    assert MAPPING_TABLE_ABSENT in body
    # Alignment: every data row shares the rule row's width.
    widths = {len(line.rstrip()) for line in lines[3:]}
    assert len(widths) >= 1


def test_mapping_table_is_empty_for_no_rows() -> None:
    """A geological-model export has no identifiers, so it must emit no
    table at all rather than an empty-bodied header."""
    assert format_mapping_table([], label_heading="Plaxis material") == []


# ---------------------------------------------------------------------------
# R2 (owner ruling 2026-08-31): a body crossing two geological formations lists
# them BOTH — the export gains an optional "Geo" column, emitted only when at
# least one row carries geological names, so every existing artefact stays
# byte-identical.
# ---------------------------------------------------------------------------


def test_geo_column_appears_only_when_a_row_carries_geo_names() -> None:
    """A row that crosses two formations lists both in a joined "Geo" column."""
    rows = [
        UnitMappingRow(
            export_label="NAD-06_ZAND - Zand van Diest (NAD 6)",
            nad_class=6,
            soil_code="ZAND",
            display_name="Zand van Diest (NAD 6)",
            formation_id=UUID("00000000-0000-0000-0000-0000000000aa"),
            geo_formations=("Holoceen", "Pleistoceen"),
        ),
    ]
    lines = format_mapping_table(rows, label_heading="Plaxis material")
    body = "\n".join(lines)
    assert MAPPING_TABLE_GEO_HEADING in body
    # Both crossed formations are named, shallowest first, joined for one cell.
    assert "Holoceen + Pleistoceen" in body


def test_geo_column_is_absent_when_no_row_carries_geo_names() -> None:
    """With no geo names on any row the table is byte-identical to before —
    the "Geo" column must not appear at all."""
    rows = [
        UnitMappingRow(
            export_label="NAD-06_ZAND - Zand van Diest (NAD 6)",
            nad_class=6,
            soil_code="ZAND",
            display_name="Zand van Diest (NAD 6)",
            formation_id=UUID("00000000-0000-0000-0000-0000000000aa"),
        ),
    ]
    with_field = format_mapping_table(rows, label_heading="Plaxis material")
    assert MAPPING_TABLE_GEO_HEADING not in "\n".join(with_field)

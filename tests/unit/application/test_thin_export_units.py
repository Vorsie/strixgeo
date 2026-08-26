"""Export-level thinning of adjacent same-NAD units (debt #104b).

Owner ruling 2026-08-26, verbatim: *"thin in dxf and pdf, keep plaxis
exact, shallower parent name wins."*

Two geotech units that carry the SAME NAD class and soil and sit
directly on top of each other are one material to the engineer reading
the deliverable — but they are two formation rows, because the geotech
find-or-create keys on ``(nad_class, litho parent, geo parent)``. The
export therefore shows a boundary that carries no NAD meaning.

These pins state the rule in the ruling's own words:

* adjacent units with the same identifier collapse to ONE unit;
* the SHALLOWER unit's identity survives — name, colour, formation id;
* units that are NOT adjacent (something else lies between them at some
  column) never merge, whatever their class;
* the merge is auditable — the surviving unit records what it absorbed.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.application.section_snapshot import (
    SectionFormation,
    SectionFormationContact,
    SectionInvestigationProjection,
    SectionSnapshot,
)
from groundmodel.application.thin_export_units import ThinExportUnits

COL_A = UUID("00000000-0000-0000-0000-0000000000a1")
COL_B = UUID("00000000-0000-0000-0000-0000000000a2")
SHALLOW = UUID("00000000-0000-0000-0000-000000000051")
DEEP = UUID("00000000-0000-0000-0000-000000000052")
OTHER = UUID("00000000-0000-0000-0000-000000000053")


def _unit(
    formation_id: UUID,
    name: str,
    *,
    nad_class: int | None,
    soil: str | None,
    display_order: int,
    color: str = "#e8c86a",
) -> SectionFormation:
    return SectionFormation(
        formation_id=formation_id,
        name=name,
        code=None,
        color=color,
        display_order=display_order,
        nad_class=nad_class,
        litho_main_soil_code=soil,
    )


def _contact(formation_id: UUID, investigation_id: UUID, depth: float) -> SectionFormationContact:
    along = 10.0 if investigation_id == COL_A else 90.0
    return SectionFormationContact(
        contact_id=UUID(int=int(depth * 1000) + (1 if investigation_id == COL_A else 2)),
        formation_id=formation_id,
        investigation_id=investigation_id,
        along_distance_m=along,
        depth_m=depth,
        level_m=10.0 - depth,
    )


def _snapshot(
    formations: list[SectionFormation], contacts: list[SectionFormationContact]
) -> SectionSnapshot:
    return SectionSnapshot(
        project_id=UUID(int=1),
        project_name="Thin-Test",
        section_id=UUID(int=2),
        section_name="CS1",
        section_length_m=100.0,
        crs_epsg=31370,
        vertical_datum_label="m TAW",
        investigations=[
            SectionInvestigationProjection(COL_A, "cpt", "S1", 10.0, 10.0, 30.0),
            SectionInvestigationProjection(COL_B, "cpt", "S2", 90.0, 10.0, 30.0),
        ],
        formations=formations,
        contacts=contacts,
    )


def _stacked_same_class() -> SectionSnapshot:
    """Two NAD-6 sand units directly on top of each other at both columns."""
    formations = [
        _unit(SHALLOW, "Zand Quartair (NAD 6)", nad_class=6, soil="ZAND", display_order=20),
        _unit(DEEP, "Zand Diest (NAD 6)", nad_class=6, soil="ZAND", display_order=10),
    ]
    contacts = [
        _contact(SHALLOW, COL_A, 2.0),
        _contact(DEEP, COL_A, 6.0),
        _contact(SHALLOW, COL_B, 2.5),
        _contact(DEEP, COL_B, 7.0),
    ]
    return _snapshot(formations, contacts)


# ---------------------------------------------------------------------------
# The merge
# ---------------------------------------------------------------------------


def test_adjacent_same_identifier_units_collapse_to_one() -> None:
    """Two stacked NAD-6 sands are one material — the export shows one."""
    thinned = ThinExportUnits().execute(_stacked_same_class())
    assert len(thinned.formations) == 1
    assert {c.formation_id for c in thinned.contacts} == {SHALLOW}


def test_the_shallower_units_identity_survives() -> None:
    """Owner ruling: "shallower parent name wins" — name, colour and the
    formation reference all come from the shallower unit."""
    thinned = ThinExportUnits().execute(_stacked_same_class())
    survivor = thinned.formations[0]
    assert survivor.formation_id == SHALLOW
    assert survivor.name == "Zand Quartair (NAD 6)"
    assert survivor.color == "#e8c86a"


def test_the_merge_stays_auditable_on_the_surviving_unit() -> None:
    """The merge erases a litho/geo boundary the engineer drew, so the
    surviving unit must name what it absorbed — that is what the mapping
    table renders."""
    thinned = ThinExportUnits().execute(_stacked_same_class())
    assert thinned.formations[0].absorbed_unit_names == ("Zand Diest (NAD 6)",)


def test_the_merged_unit_keeps_only_its_own_top_contacts() -> None:
    """The merged unit runs from the SHALLOWER unit's top down to whatever
    lies below the deeper one — so the deeper unit's top boundary, which
    carried no NAD meaning, is gone."""
    thinned = ThinExportUnits().execute(_stacked_same_class())
    depths = sorted(c.depth_m for c in thinned.contacts)
    assert depths == [2.0, 2.5]


def test_three_stacked_same_class_units_collapse_to_one() -> None:
    """Thinning runs to a fixpoint, not one pass."""
    formations = [
        _unit(SHALLOW, "Zand top (NAD 6)", nad_class=6, soil="ZAND", display_order=30),
        _unit(DEEP, "Zand mid (NAD 6)", nad_class=6, soil="ZAND", display_order=20),
        _unit(OTHER, "Zand base (NAD 6)", nad_class=6, soil="ZAND", display_order=10),
    ]
    contacts = [
        _contact(SHALLOW, COL_A, 2.0),
        _contact(DEEP, COL_A, 6.0),
        _contact(OTHER, COL_A, 9.0),
        _contact(SHALLOW, COL_B, 2.5),
        _contact(DEEP, COL_B, 7.0),
        _contact(OTHER, COL_B, 9.5),
    ]
    thinned = ThinExportUnits().execute(_snapshot(formations, contacts))
    assert len(thinned.formations) == 1
    assert thinned.formations[0].formation_id == SHALLOW
    assert set(thinned.formations[0].absorbed_unit_names) == {
        "Zand mid (NAD 6)",
        "Zand base (NAD 6)",
    }


# ---------------------------------------------------------------------------
# What must NOT merge
# ---------------------------------------------------------------------------


def test_non_adjacent_same_class_units_are_not_merged() -> None:
    """A clay unit lies between the two sands at one column — they are not
    adjacent, so they stay two units. Merging them would need one unit to
    appear twice in a column, which no export format can express."""
    formations = [
        _unit(SHALLOW, "Zand boven (NAD 6)", nad_class=6, soil="ZAND", display_order=30),
        _unit(OTHER, "Klei (NAD 21)", nad_class=21, soil="KLEI", display_order=20),
        _unit(DEEP, "Zand onder (NAD 6)", nad_class=6, soil="ZAND", display_order=10),
    ]
    contacts = [
        _contact(SHALLOW, COL_A, 2.0),
        _contact(OTHER, COL_A, 5.0),
        _contact(DEEP, COL_A, 8.0),
        _contact(SHALLOW, COL_B, 2.5),
        _contact(OTHER, COL_B, 5.5),
        _contact(DEEP, COL_B, 8.5),
    ]
    thinned = ThinExportUnits().execute(_snapshot(formations, contacts))
    assert len(thinned.formations) == 3


def test_units_adjacent_at_one_column_but_separated_at_another_do_not_merge() -> None:
    """The interleave case. The two sands touch at column A but a clay
    wedges between them at column B. Merging on the strength of column A
    alone would weld across a unit that is really there."""
    formations = [
        _unit(SHALLOW, "Zand boven (NAD 6)", nad_class=6, soil="ZAND", display_order=30),
        _unit(OTHER, "Klei (NAD 21)", nad_class=21, soil="KLEI", display_order=20),
        _unit(DEEP, "Zand onder (NAD 6)", nad_class=6, soil="ZAND", display_order=10),
    ]
    contacts = [
        # Column A: sand directly on sand.
        _contact(SHALLOW, COL_A, 2.0),
        _contact(DEEP, COL_A, 6.0),
        # Column B: the clay wedges in between.
        _contact(SHALLOW, COL_B, 2.5),
        _contact(OTHER, COL_B, 5.5),
        _contact(DEEP, COL_B, 8.5),
    ]
    thinned = ThinExportUnits().execute(_snapshot(formations, contacts))
    assert len(thinned.formations) == 3


def test_different_classes_never_merge() -> None:
    """Adjacency alone is not enough — the identifier has to match."""
    formations = [
        _unit(SHALLOW, "Zand (NAD 6)", nad_class=6, soil="ZAND", display_order=20),
        _unit(DEEP, "Zand (NAD 8)", nad_class=8, soil="ZAND", display_order=10),
    ]
    contacts = [
        _contact(SHALLOW, COL_A, 2.0),
        _contact(DEEP, COL_A, 6.0),
        _contact(SHALLOW, COL_B, 2.5),
        _contact(DEEP, COL_B, 7.0),
    ]
    thinned = ThinExportUnits().execute(_snapshot(formations, contacts))
    assert len(thinned.formations) == 2


def test_units_without_an_identifier_never_merge() -> None:
    """Two adjacent GEOLOGICAL formations carry no identifier at all.
    Thinning them would collapse the geological export, which the ruling
    does not touch."""
    formations = [
        _unit(SHALLOW, "Boom Klei", nad_class=None, soil=None, display_order=20),
        _unit(DEEP, "Diest Zand", nad_class=None, soil=None, display_order=10),
    ]
    contacts = [
        _contact(SHALLOW, COL_A, 2.0),
        _contact(DEEP, COL_A, 6.0),
        _contact(SHALLOW, COL_B, 2.5),
        _contact(DEEP, COL_B, 7.0),
    ]
    thinned = ThinExportUnits().execute(_snapshot(formations, contacts))
    assert len(thinned.formations) == 2
    assert thinned.formations[0].absorbed_unit_names == ()


def test_units_that_never_share_a_column_do_not_merge() -> None:
    """With no column where both are present there is no evidence they are
    adjacent — two disjoint bodies of the same class are not one unit."""
    formations = [
        _unit(SHALLOW, "Zand west (NAD 6)", nad_class=6, soil="ZAND", display_order=20),
        _unit(DEEP, "Zand east (NAD 6)", nad_class=6, soil="ZAND", display_order=10),
    ]
    contacts = [_contact(SHALLOW, COL_A, 2.0), _contact(DEEP, COL_B, 2.5)]
    thinned = ThinExportUnits().execute(_snapshot(formations, contacts))
    assert len(thinned.formations) == 2


def test_a_snapshot_with_nothing_to_thin_is_returned_unchanged() -> None:
    """The no-op path must not perturb the snapshot — the geological and
    litho exports go through this same call."""
    formations = [_unit(SHALLOW, "Boom Klei", nad_class=None, soil=None, display_order=20)]
    contacts = [_contact(SHALLOW, COL_A, 2.0)]
    original = _snapshot(formations, contacts)
    thinned = ThinExportUnits().execute(original)
    assert thinned.formations == original.formations
    assert thinned.contacts == original.contacts
    assert thinned.investigations == original.investigations

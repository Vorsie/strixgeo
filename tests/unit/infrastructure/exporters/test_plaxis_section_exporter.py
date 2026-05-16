"""Unit tests for ``PlaxisSectionExporter`` — Plaxis 2D per-section (debt #29).

The exporter is a pure ``SectionSnapshot → bytes`` transform — no DB,
no network, no Plaxis. Tests assert on the emitted script's STRING
content so a future Plaxis release doesn't break our build just
because we haven't run the script against it.

What we assert:

* Header carries the project + section identity and counts.
* The connection block wires ``new_server`` with fillable placeholders.
* One ``g_i.soilmat()`` block per formation, Identification set.
* One ``g_i.soillayer(0)`` per formation, top-down (highest
  display_order first).
* One ``g_i.borehole(x)`` per exportable column at its along-distance
  (2D single-coordinate signature, NOT the 3D ``(x, y)``).
* One ``g_i.setsoillayerlevel(...)`` per (borehole, layer) pair, with
  the absolute level recomputed from the column surface.
* Columns without a surface elevation are dropped + counted.
* Formations absent at a column emit ``# absent — zero thickness`` +
  inherit the next-deeper present formation's top level.
* The emitted script is syntactically valid Python (``compile``).
* An empty snapshot emits a no-op script that still ``compile``s.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from groundmodel.application.section_snapshot import (
    SectionFormation,
    SectionFormationContact,
    SectionInvestigationProjection,
    SectionSnapshot,
)
from groundmodel.infrastructure.exporters.plaxis_section_exporter import (
    PlaxisSectionExporter,
)

PROJECT_ID = UUID("00000000-0000-0000-0000-000000000001")
SECTION_ID = UUID("00000000-0000-0000-0000-000000000002")


def _snapshot(
    *,
    investigations: list[SectionInvestigationProjection] | None = None,
    formations: list[SectionFormation] | None = None,
    contacts: list[SectionFormationContact] | None = None,
) -> SectionSnapshot:
    return SectionSnapshot(
        project_id=PROJECT_ID,
        project_name="Antwerp port — quay 7",
        section_id=SECTION_ID,
        section_name="Section A-A'",
        section_length_m=100.0,
        crs_epsg=31370,
        vertical_datum_label="m TAW",
        investigations=investigations or [],
        formations=formations or [],
        contacts=contacts or [],
    )


def _inv(
    *,
    iid: UUID,
    name: str,
    along: float,
    surface: float | None = 5.0,
    total_depth: float | None = 20.0,
) -> SectionInvestigationProjection:
    return SectionInvestigationProjection(
        investigation_id=iid,
        kind="cpt",
        name=name,
        along_distance_m=along,
        surface_elevation_m=surface,
        total_depth_m=total_depth,
    )


def _formation(*, fid: UUID, name: str, order: int) -> SectionFormation:
    return SectionFormation(
        formation_id=fid,
        name=name,
        code=None,
        color="#b45309",
        display_order=order,
    )


def _contact(
    *, fid: UUID, iid: UUID, along: float, depth: float, surface: float | None = 5.0
) -> SectionFormationContact:
    return SectionFormationContact(
        contact_id=uuid4(),
        formation_id=fid,
        investigation_id=iid,
        along_distance_m=along,
        depth_m=depth,
        level_m=None if surface is None else surface - depth,
    )


def _script(snapshot: SectionSnapshot) -> str:
    return PlaxisSectionExporter().export(snapshot).decode("utf-8")


# ---------------------------------------------------------------------------
# Smoke — empty snapshot
# ---------------------------------------------------------------------------


def test_empty_snapshot_emits_compilable_noop() -> None:
    script = _script(_snapshot())
    assert "nothing to export" in script
    # Still valid Python — the engineer can run it and get a clear message.
    compile(script, "<plaxis2d>", "exec")


def test_formations_but_no_columns_emits_noop() -> None:
    f = _formation(fid=uuid4(), name="Boom Klei", order=0)
    script = _script(_snapshot(formations=[f]))
    assert "nothing to export" in script
    compile(script, "<plaxis2d>", "exec")


# ---------------------------------------------------------------------------
# Basic two-column / two-formation export
# ---------------------------------------------------------------------------


def test_basic_export_structure() -> None:
    young = _formation(fid=uuid4(), name="Quartair", order=1)
    old = _formation(fid=uuid4(), name="Boom Klei", order=0)
    i1 = uuid4()
    i2 = uuid4()
    snapshot = _snapshot(
        investigations=[
            _inv(iid=i1, name="CPT-1", along=0.0, surface=5.0, total_depth=20.0),
            _inv(iid=i2, name="CPT-2", along=40.0, surface=4.0, total_depth=18.0),
        ],
        formations=[old, young],
        contacts=[
            _contact(fid=young.formation_id, iid=i1, along=0.0, depth=0.0, surface=5.0),
            _contact(fid=old.formation_id, iid=i1, along=0.0, depth=8.0, surface=5.0),
            _contact(fid=young.formation_id, iid=i2, along=40.0, depth=0.0, surface=4.0),
            _contact(fid=old.formation_id, iid=i2, along=40.0, depth=6.0, surface=4.0),
        ],
    )
    script = _script(snapshot)

    # Valid Python.
    compile(script, "<plaxis2d>", "exec")

    # Header identity.
    assert "Antwerp port — quay 7" in script
    assert "Section A-A'" in script
    assert "EPSG:31370" in script

    # Connection block.
    assert "from plxscripting.easy import new_server" in script
    assert "s_i, g_i = new_server(HOST, PORT, password=PASSWORD)" in script
    assert "g_i.new()" in script

    # One material per formation.
    assert script.count("g_i.soilmat()") == 2
    assert "'Boom Klei'" in script
    assert "'Quartair'" in script

    # Two global layers, top-down: layer 0 = youngest (higher order).
    assert "g_i.soillayer(0)  # layer 0: Quartair" in script
    assert "g_i.soillayer(0)  # layer 1: Boom Klei" in script

    # 2D borehole signature is single-coordinate (along-distance), not (x, y).
    assert "g_i.borehole(0.0)" in script
    assert "g_i.borehole(40.0)" in script
    assert "g_i.borehole(0.0, " not in script  # not the 3D two-arg form

    # Head set to the column surface elevation.
    assert "bh_0.Head = 5.0" in script
    assert "bh_1.Head = 4.0" in script

    # One setsoillayerlevel per (borehole, layer) pair = 2 columns × 2 layers.
    assert script.count("g_i.setsoillayerlevel(") == 4
    # CPT-1: Quartair top at level 5.0 (surface 5 − depth 0), Boom Klei at −3.0.
    assert "g_i.setsoillayerlevel(bh_0, 0, 5.0)" in script
    assert "g_i.setsoillayerlevel(bh_0, 1, -3.0)" in script


# ---------------------------------------------------------------------------
# No-Z columns are dropped + counted
# ---------------------------------------------------------------------------


def test_column_without_surface_elevation_is_skipped() -> None:
    f = _formation(fid=uuid4(), name="Boom Klei", order=0)
    with_z = uuid4()
    without_z = uuid4()
    snapshot = _snapshot(
        investigations=[
            _inv(iid=with_z, name="CPT-WITH-Z", along=0.0, surface=5.0),
            _inv(iid=without_z, name="CPT-NO-Z", along=10.0, surface=None),
        ],
        formations=[f],
        contacts=[
            _contact(fid=f.formation_id, iid=with_z, along=0.0, depth=2.0, surface=5.0),
            _contact(fid=f.formation_id, iid=without_z, along=10.0, depth=2.0, surface=None),
        ],
    )
    script = _script(snapshot)
    compile(script, "<plaxis2d>", "exec")

    # Only the Z-bearing column produced a borehole.
    assert script.count("g_i.borehole(") == 1
    assert "g_i.borehole(0.0)" in script
    assert "CPT-NO-Z" not in script
    # The summary tells the engineer one column was dropped.
    assert "skipped 1 column(s) without surface Z" in script
    # And the header explains why + how to fix.
    assert "lacked a surface elevation" in script


# ---------------------------------------------------------------------------
# Absent formation at a column → zero-thickness inherit
# ---------------------------------------------------------------------------


def test_absent_formation_collapses_to_zero_thickness() -> None:
    young = _formation(fid=uuid4(), name="Quartair", order=1)
    old = _formation(fid=uuid4(), name="Boom Klei", order=0)
    i1 = uuid4()
    snapshot = _snapshot(
        investigations=[_inv(iid=i1, name="CPT-1", along=0.0, surface=5.0, total_depth=12.0)],
        formations=[old, young],
        # Only the OLD formation is picked at this column — Quartair absent.
        contacts=[_contact(fid=old.formation_id, iid=i1, along=0.0, depth=3.0, surface=5.0)],
    )
    script = _script(snapshot)
    compile(script, "<plaxis2d>", "exec")

    # Quartair (layer 0) is absent → zero-thickness, inherits Boom Klei's
    # top level (5.0 − 3.0 = 2.0).
    assert "g_i.setsoillayerlevel(bh_0, 0, 2.0)  # absent — zero thickness" in script
    assert "g_i.setsoillayerlevel(bh_0, 1, 2.0)" in script


# ---------------------------------------------------------------------------
# Helper sanitisation
# ---------------------------------------------------------------------------


def test_material_variable_name_sanitisation() -> None:
    fn = PlaxisSectionExporter._material_variable_name
    assert fn("Boom Klei") == "mat_boom_klei"
    assert fn("Diest  Zand") == "mat_diest_zand"  # collapsed double space
    assert fn("Kortrijk (Ieper)") == "mat_kortrijk_ieper"
    assert fn("///") == "mat_unnamed"

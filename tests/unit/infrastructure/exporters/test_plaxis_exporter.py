"""Unit tests for ``PlaxisExporter`` — emits a ``plxscripting`` Python script.

The exporter is a pure ``GroundModelSnapshot → bytes`` transform —
no DB, no network, no Plaxis. Tests assert on the emitted script's
STRING content so a future Plaxis version doesn't break our build
just because we haven't run the script against it.

What we assert:

* Header carries the project name + investigation/formation counts.
* The connection block sets up ``new_server`` with placeholders the
  engineer can fill in.
* One ``g_i.soilmat()`` block per formation, with Identification set.
* One ``g_i.soillayer(0)`` per formation, top-down (highest
  display_order first).
* One ``g_i.borehole(x, y)`` per investigation column.
* One ``g_i.setsoillayerlevel(...)`` per (borehole, layer) pair.
* Formations absent at a column emit a ``# absent — zero thickness``
  comment + inherit the next-deeper present formation's top z.
* The script is syntactically valid Python (``compile``).
* An empty snapshot emits a no-op script that still ``compile``s.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.application.ground_model_snapshot import (
    FormationDisplay,
    GroundModelSnapshot,
    LayerGeometry,
)
from groundmodel.infrastructure.exporters.plaxis_exporter import PlaxisExporter
from groundmodel.infrastructure.exporters.unit_identifier_constants import (
    MAPPING_TABLE_TITLE,
)

PROJECT_ID = UUID("00000000-0000-0000-0000-000000000001")
SAND_ID = UUID("00000000-0000-0000-0000-0000000000aa")
CLAY_ID = UUID("00000000-0000-0000-0000-0000000000bb")


def _snapshot(
    *,
    layers: list[LayerGeometry] | None = None,
    formations: list[FormationDisplay] | None = None,
) -> GroundModelSnapshot:
    """Build a project-wide ``GroundModelSnapshot`` for one test."""
    return GroundModelSnapshot(
        project_id=PROJECT_ID,
        project_name="Antwerp port — quay 7",
        crs_epsg=31370,
        layers=layers or [],
        formations=formations or [],
    )


def _layer(
    *,
    formation_name: str,
    top: float,
    base: float,
    x: float,
    y: float,
    surface_z: float = 5.0,
    code: str | None = None,
) -> LayerGeometry:
    """Build one ``LayerGeometry`` row for a synthetic snapshot."""
    return LayerGeometry(
        formation_name=formation_name,
        formation_code=code,
        top_depth_m=top,
        base_depth_m=base,
        location_x=x,
        location_y=y,
        surface_elevation_m=surface_z,
    )


def _decode(payload: bytes) -> str:
    """Decode exporter bytes to ``str`` for substring assertions."""
    return payload.decode("utf-8")


# ---------------------------------------------------------------------------
# Header + connection
# ---------------------------------------------------------------------------


def test_header_contains_project_name_and_counts() -> None:
    """Script header carries the project name, EPSG and counts so the
    engineer sees what they're about to run."""
    snapshot = _snapshot(
        layers=[_layer(formation_name="Boom Klei", top=2.0, base=8.0, x=100.0, y=200.0)],
        formations=[
            FormationDisplay(name="Boom Klei", code=None, display_order=0, color="#cccc66")
        ],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    assert "Antwerp port — quay 7" in script
    assert "Investigations: 1" in script
    assert "Formations    : 1" in script
    assert "EPSG:31370" in script


def test_emits_new_server_connection_block() -> None:
    """``plxscripting.easy.new_server`` connect block + project reset."""
    snapshot = _snapshot(
        layers=[_layer(formation_name="Boom Klei", top=0.0, base=5.0, x=0.0, y=0.0)],
        formations=[FormationDisplay(name="Boom Klei", code=None, display_order=0, color="#ccc")],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    assert "from plxscripting.easy import new_server" in script
    assert "HOST" in script and "PORT" in script and "PASSWORD" in script
    assert "new_server(HOST, PORT, password=PASSWORD)" in script
    assert "g_i.new()" in script


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------


def test_emits_one_soilmat_per_formation_with_identification() -> None:
    """One Mohr-Coulomb placeholder material per formation,
    Identification set to the formation name."""
    snapshot = _snapshot(
        layers=[
            _layer(formation_name="Anthropogeen", top=0.0, base=2.0, x=0.0, y=0.0),
            _layer(formation_name="Boom Klei", top=2.0, base=10.0, x=0.0, y=0.0),
        ],
        formations=[
            FormationDisplay(name="Anthropogeen", code="AN", display_order=10, color="#ff8800"),
            FormationDisplay(name="Boom Klei", code="BmK", display_order=0, color="#cccc66"),
        ],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    assert script.count("g_i.soilmat()") == 2
    assert "Identification = 'Anthropogeen'" in script
    assert "Identification = 'Boom Klei'" in script
    # Mohr-Coulomb placeholder
    assert ".SoilModel = 1" in script


def test_materials_dict_keyed_by_formation_name() -> None:
    """``materials`` dict in the emitted script is keyed by formation name."""
    snapshot = _snapshot(
        layers=[_layer(formation_name="Boom Klei", top=0.0, base=5.0, x=0.0, y=0.0)],
        formations=[FormationDisplay(name="Boom Klei", code=None, display_order=0, color="#ccc")],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    assert "materials['Boom Klei'] = mat_boom_klei" in script


# ---------------------------------------------------------------------------
# Global layer stack — top-down ordering
# ---------------------------------------------------------------------------


def test_global_layers_emitted_top_down_youngest_first() -> None:
    """Layer block lists formations top-down (display_order DESC); Plaxis
    layer 0 must be the youngest formation in the soil column."""
    # display_order ASC = oldest. Top-down means DESCending.
    snapshot = _snapshot(
        layers=[
            _layer(formation_name="Boom Klei", top=2.0, base=10.0, x=0.0, y=0.0),
            _layer(formation_name="Anthropogeen", top=0.0, base=2.0, x=0.0, y=0.0),
        ],
        formations=[
            FormationDisplay(name="Boom Klei", code=None, display_order=0, color="#ccc"),
            FormationDisplay(name="Anthropogeen", code=None, display_order=10, color="#fff"),
        ],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    # Anthropogeen should appear in the layer-stack section BEFORE Boom Klei.
    layer_block_start = script.index("# ---- Global soil layer stack")
    layer_block_end = script.index("# ---- Boreholes ----")
    layer_block = script[layer_block_start:layer_block_end]
    assert layer_block.index("Anthropogeen") < layer_block.index("Boom Klei")


def test_one_soillayer_call_per_formation() -> None:
    """One global ``g_i.soillayer(0)`` per formation regardless of column count."""
    snapshot = _snapshot(
        layers=[
            _layer(formation_name="A", top=0.0, base=2.0, x=0.0, y=0.0),
            _layer(formation_name="B", top=2.0, base=5.0, x=0.0, y=0.0),
            _layer(formation_name="C", top=5.0, base=10.0, x=0.0, y=0.0),
        ],
        formations=[
            FormationDisplay(name="A", code=None, display_order=2, color="#ccc"),
            FormationDisplay(name="B", code=None, display_order=1, color="#ccc"),
            FormationDisplay(name="C", code=None, display_order=0, color="#ccc"),
        ],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    assert script.count("g_i.soillayer(0)") == 3


# ---------------------------------------------------------------------------
# Boreholes + setsoillayerlevel
# ---------------------------------------------------------------------------


def test_one_borehole_per_unique_xy_column() -> None:
    """One ``g_i.borehole(x, y)`` per unique investigation column."""
    snapshot = _snapshot(
        layers=[
            _layer(formation_name="A", top=0.0, base=5.0, x=100.0, y=200.0),
            _layer(formation_name="A", top=0.0, base=5.0, x=300.0, y=400.0),
        ],
        formations=[FormationDisplay(name="A", code=None, display_order=0, color="#ccc")],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    assert script.count("g_i.borehole(") == 2
    assert "g_i.borehole(100.0, 200.0)" in script
    assert "g_i.borehole(300.0, 400.0)" in script


def test_borehole_carries_its_surface_elevation_as_a_comment_not_as_head() -> None:
    """The surface elevation annotates the borehole; it is not a water head.

    Rewritten 2026-08-03: this test used to assert ``bh_0.Head = 12.5``,
    pinning the audit's finding rather than catching it.  ``Head`` is the
    phreatic level in PLAXIS — see
    ``test_export_does_not_set_a_water_head_at_the_ground_surface``.
    """
    snapshot = _snapshot(
        layers=[_layer(formation_name="A", top=0.0, base=5.0, x=0.0, y=0.0, surface_z=12.5)],
        formations=[FormationDisplay(name="A", code=None, display_order=0, color="#ccc")],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    assert "# surface z = 12.5" in script
    assert "bh_0.Head" not in script


def test_setsoillayerlevel_per_borehole_per_layer() -> None:
    """``setsoillayerlevel`` called per (borehole, layer) with absolute z."""
    # One borehole, two formations, both present.
    snapshot = _snapshot(
        layers=[
            _layer(formation_name="A", top=0.0, base=2.0, x=0.0, y=0.0, surface_z=10.0),
            _layer(formation_name="B", top=2.0, base=8.0, x=0.0, y=0.0, surface_z=10.0),
        ],
        formations=[
            FormationDisplay(name="A", code=None, display_order=1, color="#ccc"),
            FormationDisplay(name="B", code=None, display_order=0, color="#ccc"),
        ],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    # A is layer 0 (top), B is layer 1 (bottom). A's top z = 10 - 0 = 10;
    # B's top z = 10 - 2 = 8.
    assert "g_i.setsoillayerlevel(bh_0, 0, 10.0)" in script
    assert "g_i.setsoillayerlevel(bh_0, 1, 8.0)" in script


def test_absent_formation_at_column_inherits_next_deeper_top() -> None:
    """An absent formation at a column collapses to zero thickness by
    inheriting the top z of the next-deeper present formation."""
    # Two formations globally; column has only the older one. The
    # younger formation (layer 0) should collapse to zero thickness
    # at this column — its top z equals the older formation's top z.
    snapshot = _snapshot(
        layers=[
            _layer(formation_name="Boom", top=3.0, base=8.0, x=0.0, y=0.0, surface_z=10.0),
        ],
        formations=[
            FormationDisplay(name="Anthropogeen", code=None, display_order=10, color="#ccc"),
            FormationDisplay(name="Boom", code=None, display_order=0, color="#ccc"),
        ],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    # Boom's top z = 10 - 3 = 7. Anthropogeen is absent — its top z
    # inherits Boom's = 7 (zero-thickness layer).
    assert "g_i.setsoillayerlevel(bh_0, 0, 7.0)" in script
    assert "g_i.setsoillayerlevel(bh_0, 1, 7.0)" in script
    assert "# absent — zero thickness" in script


def test_deepest_layer_gets_a_base_level_at_the_column_bottom() -> None:
    """A borehole with N soil layers has N+1 level boundaries.

    Boundary N is the BASE of the deepest layer — the bottom of the model.
    Without it the deepest unit runs to whatever base PLAXIS defaults to
    rather than to the depth the investigation actually reached.
    """
    snapshot = _snapshot(
        layers=[
            _layer(formation_name="A", top=0.0, base=2.0, x=0.0, y=0.0, surface_z=10.0),
            _layer(formation_name="B", top=2.0, base=8.0, x=0.0, y=0.0, surface_z=10.0),
        ],
        formations=[
            FormationDisplay(name="A", code=None, display_order=1, color="#ccc"),
            FormationDisplay(name="B", code=None, display_order=0, color="#ccc"),
        ],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    # Two layers → three boundaries: 10.0 (top), 8.0 (contact), 2.0 (base
    # of B = surface 10 − deepest base 8).
    assert script.count("g_i.setsoillayerlevel(") == 3
    assert "g_i.setsoillayerlevel(bh_0, 2, 2.0)" in script


# ---------------------------------------------------------------------------
# Script-level invariants
# ---------------------------------------------------------------------------


def test_emitted_script_is_valid_python() -> None:
    """``compile`` must accept the emitted source — if it doesn't, the
    engineer can't even open it in Plaxis."""
    snapshot = _snapshot(
        layers=[
            _layer(formation_name="Boom Klei", top=2.0, base=8.0, x=100.0, y=200.0),
            _layer(formation_name="Diest Zand", top=8.0, base=15.0, x=100.0, y=200.0),
        ],
        formations=[
            FormationDisplay(name="Boom Klei", code=None, display_order=10, color="#cccc66"),
            FormationDisplay(name="Diest Zand", code=None, display_order=0, color="#cccc99"),
        ],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    # If the emitted script is not parseable Python, the engineer
    # can't even start with it — fail loudly here.
    compile(script, "<emitted>", "exec")


def test_empty_snapshot_emits_no_op_valid_script() -> None:
    """An empty model (no contacts / no formations) emits a no-op script
    that still ``compile``s and tells the user nothing was exported."""
    snapshot = _snapshot(layers=[], formations=[])

    script = _decode(PlaxisExporter().export(snapshot))

    compile(script, "<emitted>", "exec")
    assert "nothing to export" in script.lower()


def test_formation_name_with_spaces_becomes_safe_variable() -> None:
    """Formation names with spaces are sanitised to valid Python identifiers."""
    snapshot = _snapshot(
        layers=[_layer(formation_name="Boom Klei", top=0.0, base=5.0, x=0.0, y=0.0)],
        formations=[FormationDisplay(name="Boom Klei", code=None, display_order=0, color="#ccc")],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    # The variable name in the script must be a valid Python identifier.
    assert "mat_boom_klei = g_i.soilmat()" in script
    assert "mat_boom klei" not in script  # space must be sanitised


def test_returns_utf8_bytes_for_unicode_formation_names() -> None:
    """Unicode-bearing formation names round-trip through UTF-8 encoded bytes."""
    snapshot = _snapshot(
        layers=[_layer(formation_name="Tielt — Egem", top=0.0, base=5.0, x=0.0, y=0.0)],
        formations=[
            FormationDisplay(name="Tielt — Egem", code=None, display_order=0, color="#ccc")
        ],
    )

    payload = PlaxisExporter().export(snapshot)

    assert isinstance(payload, bytes)
    decoded = payload.decode("utf-8")
    assert "Tielt — Egem" in decoded


# ---------------------------------------------------------------------------
# Dropped-borehole tally (no surface Z)
# ---------------------------------------------------------------------------


def test_emit_boreholes_counts_columns_with_no_surface_z() -> None:
    """A column whose surface elevation is None can't be placed in PLAXIS 3D;
    it is skipped with a script comment AND counted. The count feeds the
    export WARNING + success line, so pin it at the source (_emit_boreholes)
    so a refactor can't silently desync ``emitted = total - skipped``."""
    formations = [FormationDisplay(name="Boom Klei", code=None, display_order=0, color="#ccc")]
    ordered_columns = [(0.0, 0.0), (10.0, 10.0)]
    columns_layers = {
        (0.0, 0.0): [_layer(formation_name="Boom Klei", top=0.0, base=5.0, x=0.0, y=0.0)],
        # No surface Z → this column is not emittable to PLAXIS 3D.
        (10.0, 10.0): [
            _layer(
                formation_name="Boom Klei",
                top=0.0,
                base=5.0,
                x=10.0,
                y=10.0,
                surface_z=None,  # type: ignore[arg-type]
            )
        ],
    }

    lines, skipped = PlaxisExporter()._emit_boreholes(ordered_columns, columns_layers, formations)

    assert skipped == 1
    # The emittable column produced a borehole; the no-Z one produced a comment.
    assert any("g_i.borehole(" in ln for ln in lines)
    assert any("# Skipped column" in ln for ln in lines)
    emitted = len(ordered_columns) - skipped
    assert emitted == 1


def test_export_does_not_set_a_water_head_at_the_ground_surface() -> None:
    """A borehole's ``Head`` is the PHREATIC level, not the soil-column top.

    Same rule as the 2D section exporter: the geometry contract does not
    include a phreatic line, and ``Head = surface_z`` silently generated
    a fully saturated model.  The column top already reaches PLAXIS via
    ``setsoillayerlevel``; the water table is the engineer's to set, and
    the script must say it was left unset.
    """
    snapshot = _snapshot(
        layers=[_layer(formation_name="A", top=0.0, base=5.0, x=0.0, y=0.0, surface_z=12.5)],
        formations=[FormationDisplay(name="A", code=None, display_order=0, color="#ccc")],
    )

    script = _decode(PlaxisExporter().export(snapshot))

    assert ".Head" not in script, (
        "the exporter must not set a water head — Head is the phreatic level, "
        "and the surface elevation is not it"
    )
    assert "water table" in script.lower(), (
        "the script must state that no water table was set so the engineer "
        "knows to set one before computing stresses"
    )


# ---------------------------------------------------------------------------
# Unit identifiers (debt #104) — the project-wide 3-D exporter carries the
# NAD class + soil for a geotech / litho model, just like the section
# exporters. The v1.0 gate is "export unit identifiers (NAD class + soil) in
# DXF/Plaxis"; this exporter shares the identifier helpers with the 2-D
# section exporter, so these pins guard against a future divergence and
# state the three-level contract on the 3-D artefact directly (it was
# previously exercised only with geological formations).
# ---------------------------------------------------------------------------


def _geotech_formations() -> list[FormationDisplay]:
    """Two classified geotech units, top-down, carrying NAD class + soil."""
    return [
        FormationDisplay(
            name="Boom Klei (NAD 21)",
            code=None,
            display_order=10,
            color="#8899aa",
            nad_class=21,
            litho_main_soil_code="KLEI",
            formation_id=CLAY_ID,
        ),
        FormationDisplay(
            name="Zand van Diest (NAD 6)",
            code=None,
            display_order=20,
            color="#e8c86a",
            nad_class=6,
            litho_main_soil_code="ZAND",
            formation_id=SAND_ID,
        ),
    ]


def _geotech_snapshot() -> GroundModelSnapshot:
    """A one-column snapshot whose two layers carry the classified units."""
    return _snapshot(
        layers=[
            _layer(formation_name="Boom Klei (NAD 21)", top=0.0, base=5.0, x=0.0, y=0.0),
            _layer(formation_name="Zand van Diest (NAD 6)", top=5.0, base=12.0, x=0.0, y=0.0),
        ],
        formations=_geotech_formations(),
    )


def test_geotech_plaxis3d_material_identity_leads_with_the_nad_identifier() -> None:
    """A Plaxis 3D export of a geotech model names each material by its NAD
    class + soil, so the PLAXIS material list is directly mappable."""
    script = _decode(PlaxisExporter().export(_geotech_snapshot()))
    assert "mat_nad_06_zand = g_i.soilmat()" in script
    assert "mat_nad_06_zand.Identification = 'NAD-06_ZAND - Zand van Diest (NAD 6)'" in script
    assert "mat_nad_21_klei.Identification = 'NAD-21_KLEI - Boom Klei (NAD 21)'" in script


def test_geotech_plaxis3d_carries_the_unit_mapping_table_with_correct_triples() -> None:
    """The script header must map each material to its class / soil / name /
    formation id so a downstream tool can resolve the units."""
    script = _decode(PlaxisExporter().export(_geotech_snapshot()))
    assert MAPPING_TABLE_TITLE in script
    header = script.split('"""')[1]
    sand_row = next(line for line in header.splitlines() if "NAD-06_ZAND" in line)
    assert " 6 " in f" {sand_row} "
    assert "ZAND" in sand_row
    assert "Zand van Diest (NAD 6)" in sand_row
    assert str(SAND_ID) in sand_row


def test_litho_plaxis3d_material_name_unchanged_but_soil_reaches_the_table() -> None:
    """A litho unit carries a soil code but no NAD class: its material NAME
    stays the display name, and the soil still reaches the mapping table."""
    snapshot = _snapshot(
        layers=[_layer(formation_name="Zand van Diest", top=0.0, base=8.0, x=0.0, y=0.0)],
        formations=[
            FormationDisplay(
                name="Zand van Diest",
                code=None,
                display_order=20,
                color="#e8c86a",
                nad_class=None,
                litho_main_soil_code="ZAND",
                formation_id=SAND_ID,
            )
        ],
    )
    script = _decode(PlaxisExporter().export(snapshot))
    assert "mat_zand_van_diest = g_i.soilmat()" in script
    assert "mat_zand_van_diest.Identification = 'Zand van Diest'" in script
    assert MAPPING_TABLE_TITLE in script
    assert "ZAND" in script


def test_geological_plaxis3d_script_carries_no_mapping_table() -> None:
    """A geological formation carries neither identifier, so nothing about
    its 3-D export moves — no identifier-led name, no mapping table."""
    snapshot = _snapshot(
        layers=[_layer(formation_name="Boom Klei", top=0.0, base=6.0, x=0.0, y=0.0, code="BmK")],
        formations=[
            FormationDisplay(name="Boom Klei", code="BmK", display_order=0, color="#ff8800")
        ],
    )
    script = _decode(PlaxisExporter().export(snapshot))
    assert "mat_boom_klei.Identification = 'Boom Klei'" in script
    assert MAPPING_TABLE_TITLE not in script

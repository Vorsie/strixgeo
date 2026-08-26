"""Export-level unit identifiers reach DXF and Plaxis (debt #104).

The v1.0 gate's export step requires that a downstream tool can map each
exported unit to a material definition. Before this slice the exporters
emitted formation-level DISPLAY NAMES only, so an engineer opening a
geotech-axis DXF saw ``GeoModel-Zand van Diest (NAD 6)`` — readable, but
nothing a script can key on, and the soil code never left Strix at all.

These pins state the contract in the owner's terms:

* a geotech export's DXF layers carry the NAD identifiers;
* the Plaxis script carries a mapping block with correct triples;
* the litho and geological axes keep their current NAMING byte-identical
  — a unit's name changes only when the unit carries a ``nad_class``;
* the name scheme is deterministic and stays collision-free when two
  units share a class + soil (a real case: NAD 6 sand under two
  different geological parents).
"""

from __future__ import annotations

import io
from uuid import UUID

import ezdxf

from groundmodel.application.section_snapshot import (
    SectionFormation,
    SectionInvestigationProjection,
    SectionSnapshot,
)
from groundmodel.infrastructure.exporters.dxf_section_exporter import DxfSectionExporter
from groundmodel.infrastructure.exporters.plaxis_section_exporter import (
    PlaxisSectionExporter,
)
from groundmodel.infrastructure.exporters.unit_identifier_constants import (
    MAPPING_TABLE_TITLE,
)

PROJECT_ID = UUID("00000000-0000-0000-0000-000000000001")
SECTION_ID = UUID("00000000-0000-0000-0000-000000000002")
SAND_ID = UUID("00000000-0000-0000-0000-0000000000aa")
CLAY_ID = UUID("00000000-0000-0000-0000-0000000000bb")
SAND_2_ID = UUID("00000000-0000-0000-0000-0000000000cc")


def _snapshot(formations: list[SectionFormation]) -> SectionSnapshot:
    """A one-column section carrying the given units."""
    return SectionSnapshot(
        project_id=PROJECT_ID,
        project_name="Antwerp port — quay 7",
        section_id=SECTION_ID,
        section_name="Section A-A'",
        section_length_m=100.0,
        crs_epsg=31370,
        vertical_datum_label="m TAW",
        investigations=[
            SectionInvestigationProjection(
                investigation_id=UUID("00000000-0000-0000-0000-0000000000f1"),
                kind="cpt",
                name="S1",
                along_distance_m=10.0,
                surface_elevation_m=5.0,
                total_depth_m=20.0,
            )
        ],
        formations=formations,
        contacts=[],
    )


def _geotech_units() -> list[SectionFormation]:
    return [
        SectionFormation(
            formation_id=CLAY_ID,
            name="Boom Klei (NAD 21)",
            code=None,
            color="#8899aa",
            display_order=10,
            nad_class=21,
            litho_main_soil_code="KLEI",
        ),
        SectionFormation(
            formation_id=SAND_ID,
            name="Zand van Diest (NAD 6)",
            code=None,
            color="#e8c86a",
            display_order=20,
            nad_class=6,
            litho_main_soil_code="ZAND",
        ),
    ]


def _parse_dxf(payload: bytes):  # type: ignore[no-untyped-def]
    return ezdxf.read(io.StringIO(payload.decode("utf-8")))


# ---------------------------------------------------------------------------
# DXF — geotech axis carries the identifiers
# ---------------------------------------------------------------------------


def test_geotech_dxf_layers_carry_the_nad_identifiers() -> None:
    """RED before this slice: layers were named after the display name only."""
    doc = _parse_dxf(DxfSectionExporter().export(_snapshot(_geotech_units())))
    names = {layer.dxf.name for layer in doc.layers}
    assert "GeoModel-NAD-06_ZAND - Zand van Diest (NAD 6)" in names
    assert "GeoModel-NAD-21_KLEI - Boom Klei (NAD 21)" in names


def test_geotech_dxf_layer_description_states_class_and_soil() -> None:
    """The layer properties dialog is where a CAD user reads the mapping."""
    doc = _parse_dxf(DxfSectionExporter().export(_snapshot(_geotech_units())))
    layer = doc.layers.get("GeoModel-NAD-06_ZAND - Zand van Diest (NAD 6)")
    assert "NAD class 6" in layer.description
    assert "soil ZAND" in layer.description


def test_geotech_dxf_carries_a_mapping_table_in_model_space() -> None:
    """A DXF is often the only artefact that travels — it must carry the
    unit id -> class -> soil -> name mapping on its own."""
    payload = DxfSectionExporter().export(_snapshot(_geotech_units()))
    doc = _parse_dxf(payload)
    text = "\n".join(e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT")
    assert MAPPING_TABLE_TITLE in text
    assert "NAD-06_ZAND" in text
    assert "ZAND" in text
    assert "Zand van Diest (NAD 6)" in text


def test_geotech_dxf_layer_names_stay_distinct_for_duplicate_class_instances() -> None:
    """Two units can legitimately share (class, soil) — NAD 6 sand under
    two different geological parents. They must not weld onto one layer."""
    units = [
        SectionFormation(
            formation_id=SAND_ID,
            name="Zand (NAD 6)",
            code=None,
            color="#e8c86a",
            display_order=20,
            nad_class=6,
            litho_main_soil_code="ZAND",
        ),
        SectionFormation(
            formation_id=SAND_2_ID,
            name="Zand (NAD 6)",
            code=None,
            color="#e8c86a",
            display_order=21,
            nad_class=6,
            litho_main_soil_code="ZAND",
        ),
    ]
    doc = _parse_dxf(DxfSectionExporter().export(_snapshot(units)))
    geo_layers = [n.dxf.name for n in doc.layers if n.dxf.name.startswith("GeoModel-")]
    assert len(geo_layers) == 2
    assert len(set(geo_layers)) == 2


# ---------------------------------------------------------------------------
# DXF — control pins: litho + geological naming byte-identical
# ---------------------------------------------------------------------------


def test_litho_dxf_layer_names_are_unchanged() -> None:
    """A litho unit carries a soil code but no NAD class, so its NAME must
    stay exactly what it is today. The soil code rides the description."""
    units = [
        SectionFormation(
            formation_id=SAND_ID,
            name="Zand van Diest",
            code=None,
            color="#e8c86a",
            display_order=20,
            nad_class=None,
            litho_main_soil_code="ZAND",
        )
    ]
    doc = _parse_dxf(DxfSectionExporter().export(_snapshot(units)))
    model_layers = {n.dxf.name for n in doc.layers if n.dxf.name.startswith("GeoModel-")}
    assert model_layers == {"GeoModel-Zand van Diest"}
    layer = doc.layers.get("GeoModel-Zand van Diest")
    assert "soil ZAND" in layer.description


def test_geological_dxf_layer_name_and_description_are_byte_identical() -> None:
    """A geological formation carries neither identifier — nothing about
    its export may move."""
    units = [
        SectionFormation(
            formation_id=CLAY_ID,
            name="Boom Klei",
            code="BmK",
            color="#ff8800",
            display_order=0,
        )
    ]
    doc = _parse_dxf(DxfSectionExporter().export(_snapshot(units)))
    layer = doc.layers.get("GeoModel-Boom Klei")
    assert layer.description == "Formation 'Boom Klei' (code BmK)"
    text = "\n".join(e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT")
    assert MAPPING_TABLE_TITLE not in text


# ---------------------------------------------------------------------------
# Plaxis — the mapping block + material identity
# ---------------------------------------------------------------------------


def test_plaxis_script_carries_the_mapping_block_with_correct_triples() -> None:
    """One table row per unit, stating identifier / class / soil / name / id."""
    script = PlaxisSectionExporter().export(_snapshot(_geotech_units())).decode("utf-8")
    assert MAPPING_TABLE_TITLE in script
    header = script.split('"""')[1]
    # One row per unit, each stating identifier / class / soil / name.
    sand_row = next(line for line in header.splitlines() if "NAD-06_ZAND" in line)
    assert " 6 " in f" {sand_row} "
    assert "ZAND" in sand_row
    assert "Zand van Diest (NAD 6)" in sand_row
    assert str(SAND_ID) in sand_row
    clay_row = next(line for line in header.splitlines() if "NAD-21_KLEI" in line)
    assert "21" in clay_row
    assert "KLEI" in clay_row
    assert str(CLAY_ID) in clay_row


def test_plaxis_material_identification_leads_with_the_unit_identifier() -> None:
    """The PLAXIS material list itself must be mappable, not just the table."""
    script = PlaxisSectionExporter().export(_snapshot(_geotech_units())).decode("utf-8")
    assert "mat_nad_06_zand = g_i.soilmat()" in script
    assert "mat_nad_06_zand.Identification = 'NAD-06_ZAND - Zand van Diest (NAD 6)'" in script


def test_plaxis_material_variables_stay_distinct_for_duplicate_class_instances() -> None:
    """Same (class, soil) on two units must not collapse to one Python
    variable — the second assignment would silently overwrite the first."""
    units = [
        SectionFormation(
            formation_id=SAND_ID,
            name="Zand (NAD 6)",
            code=None,
            color="#e8c86a",
            display_order=20,
            nad_class=6,
            litho_main_soil_code="ZAND",
        ),
        SectionFormation(
            formation_id=SAND_2_ID,
            name="Zand (NAD 6)",
            code=None,
            color="#e8c86a",
            display_order=21,
            nad_class=6,
            litho_main_soil_code="ZAND",
        ),
    ]
    script = PlaxisSectionExporter().export(_snapshot(units)).decode("utf-8")
    declared = [line for line in script.splitlines() if line.endswith("= g_i.soilmat()")]
    assert len(declared) == 2
    assert len(set(declared)) == 2
    # The IDENTIFICATION must be distinct too — two materials under one
    # name are unmappable by hand in the PLAXIS material list, which is
    # the whole point of exporting an identifier.
    identifications = [line for line in script.splitlines() if ".Identification = " in line]
    values = [line.split(" = ", 1)[1] for line in identifications]
    assert len(values) == 2
    assert len(set(values)) == 2
    # ...and the mapping table names those same two identifications, so
    # the engineer can resolve them against the formation ids.
    header = script.split('"""')[1]
    assert str(SAND_ID) in header
    assert str(SAND_2_ID) in header
    compile(script, "<plaxis>", "exec")


def test_litho_plaxis_naming_is_unchanged_but_gains_a_mapping_block() -> None:
    """Litho control pin: names frozen, soil code reaches the export anyway."""
    units = [
        SectionFormation(
            formation_id=SAND_ID,
            name="Zand van Diest",
            code=None,
            color="#e8c86a",
            display_order=20,
            nad_class=None,
            litho_main_soil_code="ZAND",
        )
    ]
    script = PlaxisSectionExporter().export(_snapshot(units)).decode("utf-8")
    assert "mat_zand_van_diest = g_i.soilmat()" in script
    assert "mat_zand_van_diest.Identification = 'Zand van Diest'" in script
    # The soil code still has to REACH the export — via the table, not
    # via a renamed material.
    assert MAPPING_TABLE_TITLE in script
    assert "ZAND" in script


def test_geological_plaxis_script_is_unchanged() -> None:
    """Geological control pin: no identifiers, so nothing about it moves."""
    units = [
        SectionFormation(
            formation_id=CLAY_ID,
            name="Boom Klei",
            code="BmK",
            color="#ff8800",
            display_order=0,
        )
    ]
    script = PlaxisSectionExporter().export(_snapshot(units)).decode("utf-8")
    assert "mat_boom_klei = g_i.soilmat()" in script
    assert "mat_boom_klei.Identification = 'Boom Klei'" in script
    assert MAPPING_TABLE_TITLE not in script

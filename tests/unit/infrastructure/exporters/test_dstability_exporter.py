"""The D-Stability export carries the section's drawn ground, and nothing else.

The rules these tests encode, in the words they were ruled in:

* the units the engineer drew arrive in D-Stability under their export
  identifier, so a downstream script can key on them;
* the export states what it KNOWS (geometry + characterisation) and
  leaves every design parameter at the tool's own default — the
  product's liability line;
* a region the 2-D engine could not close into a simple polygon is
  DROPPED and counted, never quietly repaired into a different shape,
  and the regions around it still export;
* an export with nothing left to draw is REFUSED, because an empty
  ``.stix`` is a plausible, correctly-named, completely wrong
  deliverable;
* the artefact is a real ``.stix`` — GEOLib parses its own output back.
"""

from __future__ import annotations

import json
import zipfile
from io import BytesIO
from pathlib import Path
from uuid import UUID

import pytest
from geolib.models import DStabilityModel

from groundmodel.application.section_polygon_set import (
    SectionPolygon,
    SectionPolygonSet,
    SectionPolygonUnit,
)
from groundmodel.domain.services import nad_soil_parameters_constants as nad_params
from groundmodel.domain.services.nad_soil_parameters_constants import (
    SOURCE_LABEL,
    NadSoilParameters,
)
from groundmodel.infrastructure.exporters.dstability_exporter import DStabilityExporter

_PROJECT_ID = UUID("11111111-1111-1111-1111-111111111111")
_SECTION_ID = UUID("22222222-2222-2222-2222-222222222222")
_SAND_ID = UUID("33333333-3333-3333-3333-333333333333")
_CLAY_ID = UUID("44444444-4444-4444-4444-444444444444")
_ABSENT_ID = UUID("55555555-5555-5555-5555-555555555555")

_SAND_QUAD = SectionPolygon(
    formation_id=_SAND_ID,
    points=((0.0, 5.0), (40.0, 4.0), (40.0, -1.0), (0.0, 0.0)),
    gap_index=0,
)
_CLAY_QUAD = SectionPolygon(
    formation_id=_CLAY_ID,
    points=((0.0, 0.0), (40.0, -1.0), (40.0, -9.0), (0.0, -8.0)),
    gap_index=0,
)


def _sand() -> SectionPolygonUnit:
    return SectionPolygonUnit(
        formation_id=_SAND_ID,
        name="Zand — NAD 6",
        nad_class=6,
        litho_main_soil_code="ZAND",
        color="#e8c56a",
        display_order=1,
    )


def _clay() -> SectionPolygonUnit:
    return SectionPolygonUnit(
        formation_id=_CLAY_ID,
        name="Klei — NAD 21",
        nad_class=21,
        litho_main_soil_code="KLEI",
        color="#7a8f6a",
        display_order=2,
    )


def _polygon_set(
    *,
    units: tuple[SectionPolygonUnit, ...] = (),
    polygons: tuple[SectionPolygon, ...] = (),
) -> SectionPolygonSet:
    """A 40 m section carrying the given units and regions."""
    return SectionPolygonSet(
        project_id=_PROJECT_ID,
        project_name="Quay 7",
        section_id=_SECTION_ID,
        section_name="A–A'",
        section_length_m=40.0,
        crs_epsg=31370,
        vertical_datum_label="m TAW",
        column_positions_m=(0.0, 40.0),
        units=units,
        polygons=polygons,
    )


def _two_layer_set(extra: tuple[SectionPolygon, ...] = ()) -> SectionPolygonSet:
    """Sand quad over clay quad, sharing their contact, plus any extra region."""
    return _polygon_set(units=(_sand(), _clay()), polygons=(_SAND_QUAD, _CLAY_QUAD, *extra))


def _reparse(payload: bytes, tmp_path: Path) -> DStabilityModel:
    """Round-trip the exported bytes back through GEOLib's own parser.

    GEOLib quirk: ``DStabilityModel.parse`` assigns its argument to the
    model's ``filename`` field, which pydantic validates as a ``Path``.
    A ``BytesIO`` is refused, so the round-trip goes via a real file
    even though ``serialize`` happily writes to a buffer.
    """
    target = tmp_path / "roundtrip.stix"
    target.write_bytes(payload)
    model = DStabilityModel()
    model.parse(target)
    return model


def _archive_text(payload: bytes, member: str) -> str:
    """Read one member of the .stix archive as the UTF-8 text we wrote.

    GEOLib quirk (verified 2026-08-26, v2.9.1): the ``.stix`` WRITER
    emits correct UTF-8 — an em dash lands as ``\xe2\x80\x94`` in
    ``geometries/geometry.json`` — but the READER decodes the archive as
    cp1252, so ``model.parse`` hands back mojibake for any non-ASCII
    text. What matters is what is IN the file D-Stability opens, so
    every non-ASCII assertion reads the archive directly and the GEOLib
    round-trip is used for structure and for the ASCII identifiers.
    """
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        return archive.read(member).decode("utf-8")


def _our_soils(model: DStabilityModel, prefix: str = "NAD-") -> list:
    """The soils this export added, not the Deltares library GEOLib ships."""
    return [soil for soil in model.soils.Soils if (soil.Code or "").startswith(prefix)]


# --- happy path -------------------------------------------------------


def test_ds1_export_is_a_stix_archive_geolib_parses_back(tmp_path: Path) -> None:
    """A real .stix: a zip container GEOLib reads back as a model."""
    payload = DStabilityExporter().export(_two_layer_set())

    assert payload[:2] == b"PK", "a .stix is a zip container"
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        assert "geometries/geometry.json" in archive.namelist()

    model = _reparse(payload, tmp_path)
    assert len(model.datastructure.geometries[0].Layers) == 2


def test_ds2_each_drawn_unit_arrives_under_its_export_identifier(tmp_path: Path) -> None:
    """The engineer's units land as soils named NAD-06_ZAND / NAD-21_KLEI."""
    model = _reparse(DStabilityExporter().export(_two_layer_set()), tmp_path)

    codes = {soil.Code for soil in model.soils.Soils}
    assert "NAD-06_ZAND" in codes
    assert "NAD-21_KLEI" in codes


def test_ds3_the_layer_carries_the_strix_unit_name_and_its_characterisation() -> None:
    """Label = the name the engineer sees; notes = the characterisation."""
    geometry = _archive_text(
        DStabilityExporter().export(_two_layer_set()), "geometries/geometry.json"
    )

    assert '"Label": "Zand — NAD 6"' in geometry
    assert "NAD class: 6" in geometry
    assert "Soil: ZAND" in geometry
    assert str(_SAND_ID) in geometry, "the formation id resolves a class/soil collision"


def test_ds4_geometry_reaches_dstability_in_along_distance_and_elevation(
    tmp_path: Path,
) -> None:
    """A polygon's (along_m, elevation_m) becomes D-Stability's (X, Z)."""
    model = _reparse(DStabilityExporter().export(_two_layer_set()), tmp_path)

    corners = {
        (round(p.X, 3), round(p.Z, 3))
        for layer in model.datastructure.geometries[0].Layers
        for p in layer.Points
    }
    assert (0.0, 5.0) in corners
    assert (40.0, 4.0) in corners
    assert (40.0, -9.0) in corners


def test_ds5_the_shipped_table_reaches_the_file_for_the_scene_classes() -> None:
    """Owner ruling 2026-09-02: the D-Series files carry the NAD characteristic
    values per soil + packing class. The scene's two classes (6 ZAND matig gp,
    21 KLEI weinig vast) resolve through the SHIPPED table, not a monkeypatch,
    so a drifted transcription shows up here."""
    table = nad_params.NAD_SOIL_PARAMETERS
    soils = _archive_soils(DStabilityExporter().export(_two_layer_set()))
    for code, class_id in (("NAD-06_ZAND", 6), ("NAD-21_KLEI", 21)):
        row = table[class_id]
        soil = soils[code]
        assert soil["MohrCoulombAdvancedShearStrengthModel"]["Cohesion"] == row.c_kpa
        assert soil["MohrCoulombAdvancedShearStrengthModel"]["FrictionAngle"] == row.phi_deg
        assert soil["VolumetricWeightAbovePhreaticLevel"] == row.gamma_unsat_kn_m3
        assert soil["VolumetricWeightBelowPhreaticLevel"] == row.gamma_sat_kn_m3
        assert SOURCE_LABEL in soil["Notes"]


def test_ds6_no_phreatic_line_is_invented(tmp_path: Path) -> None:
    """We never saw a water table, so the export never states one."""
    model = _reparse(DStabilityExporter().export(_two_layer_set()), tmp_path)
    waternet = model.datastructure.waternets[0]

    assert waternet.PhreaticLineId is None
    assert waternet.HeadLines == []


def test_ds13_the_artefact_says_parameters_were_not_exported() -> None:
    """The disclaimer rides inside the file, which outlives this conversation."""
    info = json.loads(
        _archive_text(DStabilityExporter().export(_two_layer_set()), "projectinfo.json")
    )

    assert info["Project"] == "Quay 7"
    assert info["CrossSection"] == "A–A'"
    assert "NOT exported" in info["Remarks"]
    assert "m TAW" in info["Remarks"]


# --- structural error paths -------------------------------------------


def test_ds7_a_zero_area_region_is_dropped_and_its_neighbours_still_export(
    tmp_path: Path,
) -> None:
    """Three collinear points are not a layer — but the good quads survive."""
    collapsed = SectionPolygon(
        formation_id=_SAND_ID,
        points=((0.0, 2.0), (20.0, 2.0), (40.0, 2.0)),
        gap_index=1,
    )
    model = _reparse(DStabilityExporter().export(_two_layer_set(extra=(collapsed,))), tmp_path)

    assert len(model.datastructure.geometries[0].Layers) == 2


def test_ds8_a_self_intersecting_region_is_dropped_not_repaired(tmp_path: Path) -> None:
    """A bow-tie repairs into TWO polygons — picking one would invent ground."""
    bowtie = SectionPolygon(
        formation_id=_CLAY_ID,
        points=((0.0, -12.0), (40.0, -24.0), (40.0, -12.0), (0.0, -30.0)),
        gap_index=1,
    )
    model = _reparse(DStabilityExporter().export(_two_layer_set(extra=(bowtie,))), tmp_path)

    assert len(model.datastructure.geometries[0].Layers) == 2


def test_ds9_a_region_whose_unit_is_missing_is_dropped(tmp_path: Path) -> None:
    """A polygon pointing at a unit the set never declared cannot be named."""
    orphan = SectionPolygon(
        formation_id=_ABSENT_ID,
        points=((0.0, -12.0), (40.0, -12.0), (40.0, -18.0), (0.0, -18.0)),
        gap_index=1,
    )
    model = _reparse(DStabilityExporter().export(_two_layer_set(extra=(orphan,))), tmp_path)

    assert len(model.datastructure.geometries[0].Layers) == 2


def test_ds10_a_section_with_no_drawable_geometry_is_refused() -> None:
    """An empty .stix is a plausible, completely wrong deliverable."""
    with pytest.raises(ValueError, match="no closed geometry"):
        DStabilityExporter().export(_polygon_set(units=(_sand(),)))


def test_ds14_a_section_whose_every_region_is_a_bow_tie_is_refused() -> None:
    """Refusal survives the drop pass: GEOLib refusing everything still refuses."""
    bowtie = SectionPolygon(
        formation_id=_SAND_ID,
        points=((0.0, 0.0), (40.0, -8.0), (40.0, 0.0), (0.0, -20.0)),
        gap_index=0,
    )
    with pytest.raises(ValueError, match="self-intersecting"):
        DStabilityExporter().export(_polygon_set(units=(_sand(),), polygons=(bowtie,)))


def test_ds15_a_unit_that_fills_nothing_gets_no_soil(tmp_path: Path) -> None:
    """An export never emits a material no layer uses."""
    model = _reparse(
        DStabilityExporter().export(_polygon_set(units=(_sand(), _clay()), polygons=(_SAND_QUAD,))),
        tmp_path,
    )

    assert [soil.Code for soil in _our_soils(model)] == ["NAD-06_ZAND"]


# --- variant detection -------------------------------------------------


def test_ds11_an_unclassified_unit_falls_back_to_its_soil_then_its_name(
    tmp_path: Path,
) -> None:
    """No NAD class → the soil code is the identity; neither → the name."""
    litho_only = SectionPolygonUnit(
        formation_id=_SAND_ID,
        name="Zand van Mol",
        nad_class=None,
        litho_main_soil_code="ZAND",
        color="#e8c56a",
        display_order=1,
    )
    geological = SectionPolygonUnit(
        formation_id=_CLAY_ID,
        name="Boom Klei",
        nad_class=None,
        litho_main_soil_code=None,
        color="#7a8f6a",
        display_order=2,
    )
    model = _reparse(
        DStabilityExporter().export(
            _polygon_set(units=(litho_only, geological), polygons=(_SAND_QUAD, _CLAY_QUAD))
        ),
        tmp_path,
    )

    codes = {soil.Code for soil in model.soils.Soils}
    assert "ZAND" in codes
    assert "Boom Klei" in codes


def test_ds12_two_units_sharing_a_class_and_a_soil_get_distinct_soil_codes(
    tmp_path: Path,
) -> None:
    """NAD 6 sand under two parents is a normal model — codes must not collide."""
    second_sand = SectionPolygonUnit(
        formation_id=_CLAY_ID,
        name="Zand — NAD 6 (Diest)",
        nad_class=6,
        litho_main_soil_code="ZAND",
        color="#d8b55a",
        display_order=2,
    )
    model = _reparse(
        DStabilityExporter().export(
            _polygon_set(units=(_sand(), second_sand), polygons=(_SAND_QUAD, _CLAY_QUAD))
        ),
        tmp_path,
    )

    assert sorted(soil.Code for soil in _our_soils(model)) == [
        "NAD-06_ZAND",
        "NAD-06_ZAND #2",
    ]
    assert len(model.datastructure.geometries[0].Layers) == 2


# --- NAD soil parameters (empty-until-filled) --------------------------


def _archive_soils(payload: bytes) -> dict[str, dict]:
    """Read our own soils out of ``soils.json`` in the .stix archive, by code.

    Read from the archive rather than ``model.parse`` because the soil
    ``Notes`` we write carries the SOURCE_LABEL's em dash, and GEOLib's
    reader decodes the archive as cp1252 — so the round-trip mojibakes it
    (the documented writer-UTF-8 / reader-cp1252 quirk). The bytes IN the
    file D-Stability opens are correct, so the assertions read them.
    """
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        soils = json.loads(archive.read("soils.json").decode("utf-8"))["Soils"]
    return {s["Code"]: s for s in soils if (s.get("Code") or "").startswith("NAD-")}


def test_ds16_a_populated_class_writes_its_parameters_and_the_source_label(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A class present in the NAD table exports its γ, φ′, c′ and the label.

    The rule: when the owner has transcribed a class's characteristic
    values, the D-Series export carries them — cohesion and friction angle
    on the Mohr-Coulomb model D-Stability actually applies both above AND
    below the phreatic level, both unit weights, and the NAD-table label on
    the soil so a reviewer sees where the numbers came from.
    """
    monkeypatch.setattr(
        nad_params,
        "NAD_SOIL_PARAMETERS",
        {
            6: NadSoilParameters(
                gamma_unsat_kn_m3=18.0, gamma_sat_kn_m3=20.0, phi_deg=32.5, c_kpa=0.0, cu_kpa=None
            ),
            21: NadSoilParameters(
                gamma_unsat_kn_m3=16.0, gamma_sat_kn_m3=17.5, phi_deg=22.0, c_kpa=5.0, cu_kpa=None
            ),
        },
    )

    soils = _archive_soils(DStabilityExporter().export(_two_layer_set()))

    sand = soils["NAD-06_ZAND"]
    assert sand["MohrCoulombAdvancedShearStrengthModel"]["Cohesion"] == 0.0
    assert sand["MohrCoulombAdvancedShearStrengthModel"]["FrictionAngle"] == 32.5
    assert sand["VolumetricWeightAbovePhreaticLevel"] == 18.0
    assert sand["VolumetricWeightBelowPhreaticLevel"] == 20.0
    # The strength model is Mohr-Coulomb on BOTH sides, so cohesion + phi are
    # applied below the water table too (not GEOLib's default Su-below).
    assert sand["ShearStrengthModelTypeAbovePhreaticLevel"] == "MohrCoulombAdvanced"
    assert sand["ShearStrengthModelTypeBelowPhreaticLevel"] == "MohrCoulombAdvanced"
    assert SOURCE_LABEL in sand["Notes"]

    clay = soils["NAD-21_KLEI"]
    assert clay["MohrCoulombAdvancedShearStrengthModel"]["Cohesion"] == 5.0
    assert clay["MohrCoulombAdvancedShearStrengthModel"]["FrictionAngle"] == 22.0
    assert clay["VolumetricWeightAbovePhreaticLevel"] == 16.0
    assert clay["VolumetricWeightBelowPhreaticLevel"] == 17.5
    assert SOURCE_LABEL in clay["Notes"]


def test_ds17_a_class_absent_from_the_table_writes_no_invented_numbers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A class the owner has not transcribed stays at GEOLib's blank defaults.

    Pins the audited "absent" representation so the parameter path cannot
    leak a default into an unfilled class: every strength/weight field is
    the zero GEOLib initialises, the soil carries no NAD-table note, and the
    below-phreatic model is GEOLib's own ``Su`` default (documented, not
    chosen by Strix — see ``dstability_exporter_constants``).
    """
    monkeypatch.setattr(nad_params, "NAD_SOIL_PARAMETERS", {})
    soils = _archive_soils(DStabilityExporter().export(_two_layer_set()))

    for soil in soils.values():
        assert soil["MohrCoulombAdvancedShearStrengthModel"]["Cohesion"] == 0.0
        assert soil["MohrCoulombAdvancedShearStrengthModel"]["FrictionAngle"] == 0.0
        assert soil["MohrCoulombClassicShearStrengthModel"]["Cohesion"] == 0.0
        assert soil["MohrCoulombClassicShearStrengthModel"]["FrictionAngle"] == 0.0
        assert soil["VolumetricWeightAbovePhreaticLevel"] == 0.0
        assert soil["VolumetricWeightBelowPhreaticLevel"] == 0.0
        assert soil["Notes"] == ""
        assert soil["ShearStrengthModelTypeBelowPhreaticLevel"] == "Su"

"""The D-Sheet Piling export carries a 1-D profile through the drawn section.

The rules these tests encode, in the words they were ruled in:

* D-Sheet needs a 1-D soil profile at a position — so the export samples
  the drawn section at a fraction along the line, mid-section by
  default;
* materials are named by unit identifier, same as every other export;
* the same characterisation-only stance: no strength, no stiffness, no
  unit weight;
* what D-Sheet demands and we cannot honestly derive — the retaining
  structure, the water levels, the surcharges — is stated as an explicit
  TODO inside the file, never as an invented value;
* a hole or an overlap in the sampled column is REPORTED, because
  D-Sheet's profile has no void concept and would silently swallow one.
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

import pytest
from geolib.models import DSheetPilingModel

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
from groundmodel.infrastructure.exporters.ascii_fold import ascii_fold
from groundmodel.infrastructure.exporters.dsheet_piling_exporter import (
    DSheetPilingExporter,
)

_PROJECT_ID = UUID("11111111-1111-1111-1111-111111111111")
_SECTION_ID = UUID("22222222-2222-2222-2222-222222222222")
_SAND_ID = UUID("33333333-3333-3333-3333-333333333333")
_CLAY_ID = UUID("44444444-4444-4444-4444-444444444444")

# A 40 m section, two columns. Sand wedges from +5.0 down to 0.0 on the
# left and +4.0 down to -1.0 on the right; clay carries on below it to
# -8.0 / -9.0. At mid-section (x = 20 m) the stack is sand +4.5..-0.5
# over clay -0.5..-8.5.
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


def _two_layer_set() -> SectionPolygonSet:
    return _polygon_set(units=(_sand(), _clay()), polygons=(_SAND_QUAD, _CLAY_QUAD))


def _text(payload: bytes) -> str:
    """Decode the ``.shi`` the way D-Sheet Piling writes it (cp1252)."""
    return payload.decode("cp1252")


# --- happy path -------------------------------------------------------


def test_dp1_export_is_a_shi_geolib_parses_back(tmp_path: Path) -> None:
    """A real .shi: GEOLib reads its own output back into a model."""
    payload = DSheetPilingExporter().export(_two_layer_set())
    target = tmp_path / "roundtrip.shi"
    target.write_bytes(payload)

    model = DSheetPilingModel()
    model.parse(target)

    names = {soil.name for soil in model.datastructure.input_data.soil_collection.soil}
    assert names == {"NAD-06_ZAND", "NAD-21_KLEI"}


def test_dp2_the_profile_is_sampled_at_mid_section_by_default() -> None:
    """Mid-section of the wedge: sand top +4.5, clay top −0.5."""
    text = _text(DSheetPilingExporter().export(_two_layer_set()))

    profile = text[text.index("[SOIL PROFILES]") : text.index("[END OF SOIL PROFILES]")]
    sand_line = next(line for line in profile.splitlines() if "NAD-06_ZAND" in line)
    clay_line = next(line for line in profile.splitlines() if "NAD-21_KLEI" in line)

    assert "4.50" in sand_line
    assert "-0.50" in clay_line


def test_dp3_a_caller_given_fraction_moves_the_sample(tmp_path: Path) -> None:
    """The rule: export the profile at a user-given fraction along the section."""
    text = _text(DSheetPilingExporter().export(_two_layer_set(), fraction=0.0))

    profile = text[text.index("[SOIL PROFILES]") : text.index("[END OF SOIL PROFILES]")]
    sand_line = next(line for line in profile.splitlines() if "NAD-06_ZAND" in line)

    assert "5.00" in sand_line, "at the section start the sand top is +5.0"


def test_dp4_the_profile_stack_runs_top_down_in_the_drawn_order() -> None:
    """Sand over clay, because that is how the engineer drew it."""
    text = _text(DSheetPilingExporter().export(_two_layer_set()))
    profile = text[text.index("[SOIL PROFILES]") : text.index("[END OF SOIL PROFILES]")]

    assert profile.index("NAD-06_ZAND") < profile.index("NAD-21_KLEI")


def test_dp5_the_ground_surface_we_measured_is_exported() -> None:
    """Surface elevation is a measurement, not a design input — it travels."""
    text = _text(DSheetPilingExporter().export(_two_layer_set()))
    surfaces = text[text.index("[SURFACES]") : text.index("[END OF SURFACES]")]

    assert "4.50" in surfaces


def test_dp6_the_shipped_table_reaches_the_file_for_the_scene_classes(tmp_path: Path) -> None:
    """Owner ruling 2026-09-02: the D-Series files carry the NAD characteristic
    values per soil + packing class, read from the SHIPPED table (no monkeypatch)
    so a drifted transcription shows up here."""
    table = nad_params.NAD_SOIL_PARAMETERS
    payload = DSheetPilingExporter().export(_two_layer_set())
    soils = _parsed_soils(payload, tmp_path)
    for code, class_id in (("NAD-06_ZAND", 6), ("NAD-21_KLEI", 21)):
        row = table[class_id]
        soil = soils[code]
        assert soil.soilgamdry == row.gamma_unsat_kn_m3
        assert soil.soilgamwet == row.gamma_sat_kn_m3
        assert soil.soilcohesion == row.c_kpa
        assert soil.soilphi == row.phi_deg
    assert ascii_fold(SOURCE_LABEL) in _text(payload)


def test_dp7_the_file_states_what_strix_did_not_supply() -> None:
    """Never invent a water level — say out loud that it is missing."""
    text = _text(DSheetPilingExporter().export(_two_layer_set()))

    assert "TODO" in text
    assert "water" in text.lower()
    assert "StrixGeo" in text


def test_dp14_the_water_level_the_file_must_carry_is_labelled_a_todo() -> None:
    """GEOLib writes a [WATERLEVELS] block regardless — so label the placeholder.

    A ``.shi`` cannot omit the water table, and 0.00 m TAW is a
    perfectly plausible phreatic level in Flanders. The NAME is the only
    thing that stops an engineer reading GEOLib's placeholder as an
    exported measurement.
    """
    text = _text(DSheetPilingExporter().export(_two_layer_set()))
    block = text[text.index("[WATERLEVELS]") : text.index("[END OF WATERLEVELS]")]

    assert "TODO set water level" in block


def test_dp15_the_run_identification_fits_the_three_lines_dsheet_shows() -> None:
    """A fourth TODO line is in the file and invisible — the same as absent.

    D-Sheet Piling's GUI renders exactly three ``[RUN IDENTIFICATION]``
    lines (GEOLib: "More than 3 lines in run_identification will be
    ignored in the GUI"), so the whole message is budgeted to three.
    """
    text = _text(DSheetPilingExporter().export(_two_layer_set()))
    block = text[
        text.index("[RUN IDENTIFICATION]") + len("[RUN IDENTIFICATION]") : text.index(
            "[END OF RUN IDENTIFICATION]"
        )
    ]
    lines = [line for line in block.splitlines() if line.strip()]

    assert len(lines) == 3
    assert lines[0].startswith("StrixGeo export")
    assert "TODO" in lines[1]
    assert "NAD Tabel 2.b" in lines[2], (
        "line 3 names the parameter source once soils carry NAD values"
    )


def test_dp8_the_file_names_the_project_the_section_and_the_sample_position() -> None:
    """A profile without its position is unreviewable."""
    text = _text(DSheetPilingExporter().export(_two_layer_set()))

    assert "Quay 7" in text
    assert "20.00" in text, "the sampled along-distance"


# --- structural error paths -------------------------------------------


def test_dp9_a_fraction_outside_the_section_is_refused() -> None:
    """A profile off the end of the line samples nothing real."""
    with pytest.raises(ValueError, match="fraction"):
        DSheetPilingExporter().export(_two_layer_set(), fraction=1.4)


def test_dp10_a_position_with_no_drawn_ground_is_refused() -> None:
    """An empty profile is a plausible, completely wrong deliverable."""
    with pytest.raises(ValueError, match="no drawn ground"):
        DSheetPilingExporter().export(
            _polygon_set(units=(_sand(),), polygons=(_SAND_QUAD,)),
            fraction=1.0,
        )


def test_dp11_a_section_with_no_geometry_at_all_is_refused() -> None:
    """Same refusal as D-Stability: never ship an empty artefact."""
    with pytest.raises(ValueError, match="no drawn ground"):
        DSheetPilingExporter().export(_polygon_set(units=(_sand(),)))


# --- variant detection -------------------------------------------------


def test_dp12_a_hole_in_the_sampled_column_is_reported(caplog) -> None:
    """D-Sheet has no void, so an unfilled gap would vanish silently."""
    floating = SectionPolygon(
        formation_id=_CLAY_ID,
        points=((0.0, -20.0), (40.0, -20.0), (40.0, -30.0), (0.0, -30.0)),
        gap_index=0,
    )
    with caplog.at_level("WARNING"):
        DSheetPilingExporter().export(
            _polygon_set(units=(_sand(), _clay()), polygons=(_SAND_QUAD, floating))
        )

    assert any("unfilled" in record.message for record in caplog.records)


def test_dp13_an_unclassified_unit_falls_back_to_its_soil_then_its_name(
    tmp_path: Path,
) -> None:
    """Same identifier fallback chain as every other export."""
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
    text = _text(
        DSheetPilingExporter().export(
            _polygon_set(units=(litho_only, geological), polygons=(_SAND_QUAD, _CLAY_QUAD))
        )
    )

    assert "ZAND" in text
    assert "Boom Klei" in text


def test_dp_ascii_only_a_section_name_with_an_en_dash_stays_readable() -> None:
    """A .shi must contain no byte outside ASCII.

    Found by CI on Linux (run 33135927403): the fixture's section name
    ``section A-A'`` carries an EN DASH (U+2013), which cp1252 encodes as the
    single byte 0x96. GEOLib's own parser opens the file with the ambient
    locale encoding, so the round-trip works on a cp1252 Windows box and dies
    with ``UnicodeDecodeError: invalid start byte`` anywhere UTF-8 is the
    default. A dash in a section name is not exotic — "A-A'" is how engineers
    name sections — so the artefact, not the reader, has to be portable.

    The identification block is free text whose only job is to say where the
    file came from; folding it to ASCII costs nothing and makes the file
    readable by every toolchain.
    """
    payload = DSheetPilingExporter().export(_two_layer_set())

    non_ascii = [(i, payload[i]) for i in range(len(payload)) if payload[i] > 0x7F]
    assert non_ascii == [], f"non-ASCII bytes in the .shi at {non_ascii[:5]}"


def test_dp_unclassified_fallback_soil_name_is_folded_to_ascii(tmp_path: Path) -> None:
    """The fallback SOIL NAME must not smuggle non-ASCII bytes into the .shi.

    A classified unit exports as the safe ``NAD-06_ZAND`` token, but an
    UNCLASSIFIED unit (no nad_class, no soil code) falls back to the raw unit
    name — which, on a colleague's .strix, carries a Flemish accent or a
    word-processor dash. The soil name is a value GEOLib PARSES, and the .shi is
    a cp1252 file it re-opens with the ambient locale, so a non-ASCII soil name
    is the same UnicodeDecodeError-on-Linux the identification block already
    folds. The soil name is a SELF-REFERENTIAL key (the ``Soil`` definition and
    the ``SoilLayer`` reference are the same label), so folding preserves the
    only invariant that matters and the file still round-trips.
    """
    exotic = SectionPolygonUnit(
        formation_id=_SAND_ID,
        name="Zandé – Mol",  # é (U+00E9) + en dash (U+2013): non-ASCII, non-structural
        nad_class=None,
        litho_main_soil_code=None,
        color="#e8c56a",
        display_order=1,
    )
    payload = DSheetPilingExporter().export(_polygon_set(units=(exotic,), polygons=(_SAND_QUAD,)))

    # The whole-file invariant the identification block already holds.
    assert all(b <= 0x7F for b in payload), "non-ASCII byte in the .shi from a fallback soil name"

    # The definition↔reference match survives the fold — GEOLib round-trips it.
    target = tmp_path / "folded.shi"
    target.write_bytes(payload)
    model = DSheetPilingModel()
    model.parse(target)
    names = {soil.name for soil in model.datastructure.input_data.soil_collection.soil}
    assert names == {"Zande - Mol"}


# --- NAD soil parameters (empty-until-filled) --------------------------


def _parsed_soils(payload: bytes, tmp_path: Path) -> dict:
    """Re-parse the .shi with GEOLib and return its soils keyed by name."""
    target = tmp_path / "params.shi"
    target.write_bytes(payload)
    model = DSheetPilingModel()
    model.parse(target)
    return {s.name: s for s in model.datastructure.input_data.soil_collection.soil}


def test_dp16_a_populated_class_writes_its_parameters_and_names_the_source(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """A class in the NAD table exports its γ, φ′, c′, and the file names the source.

    D-Sheet's ``[SOIL]`` block has no per-soil free-text slot, so the NAD-table
    provenance rides in the ``[RUN IDENTIFICATION]`` block (ASCII-folded, so the
    .shi stays byte-portable). The parameter values land on the right soils.
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

    payload = DSheetPilingExporter().export(_two_layer_set())
    soils = _parsed_soils(payload, tmp_path)

    sand = soils["NAD-06_ZAND"]
    assert sand.soilgamdry == 18.0
    assert sand.soilgamwet == 20.0
    assert sand.soilcohesion == 0.0
    assert sand.soilphi == 32.5

    clay = soils["NAD-21_KLEI"]
    assert clay.soilgamdry == 16.0
    assert clay.soilgamwet == 17.5
    assert clay.soilcohesion == 5.0
    assert clay.soilphi == 22.0

    text = _text(payload)
    assert ascii_fold(SOURCE_LABEL) in text, "the run-identification names the NAD table"
    # The label must not break the whole-file ASCII invariant.
    assert all(b <= 0x7F for b in payload), "the source label smuggled a non-ASCII byte"


def test_dp17_a_class_absent_from_the_table_writes_no_invented_numbers(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """A class the owner has not transcribed stays at D-Sheet's blank defaults.

    Pins the audited "absent" representation: GEOLib initialises a D-Sheet soil
    with a 0.01 kN/m³ unit weight and cohesion / phi 0 — its own placeholders,
    not values Strix chose. The run-identification does NOT name the NAD table.
    """
    monkeypatch.setattr(nad_params, "NAD_SOIL_PARAMETERS", {})
    payload = DSheetPilingExporter().export(_two_layer_set())
    soils = _parsed_soils(payload, tmp_path)

    assert len(soils) == 2
    for soil in soils.values():
        assert soil.soilgamdry == 0.01
        assert soil.soilgamwet == 0.01
        assert soil.soilcohesion == 0.0
        assert soil.soilphi == 0.0

    assert ascii_fold(SOURCE_LABEL) not in _text(payload)

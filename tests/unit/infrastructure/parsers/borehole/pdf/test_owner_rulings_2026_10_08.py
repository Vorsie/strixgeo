"""The owner's seven rulings on the borehole-log digitiser (2026-10-08), pinned in his words.

1. "the word printed ON the surface line is the surface label, NOT a layer":
   a header note ``surface_label``; "the first layer is 6.50 to 6.40".
2. An interval that prints only the drill technique / sample remark ("Sonic
   Drill, steekbus niet vol"): "you can leave it empty": a layer with an EMPTY
   lithology, the raw text kept, the sample kept, marked
   ``lithology_absent_reason = "sampled"``.
3. X/Y printed without a named system: "it IS Lambert 72, but the user confirms
   it at import": position kept, EPSG 31370 with ``crs_assumed``, a
   ``CRS_ASSUMED`` finding. "Never silently assume; never block the import".
4. "GWS: 380" / "Grondwaterstand in cm': 234": "read as cm BELOW GROUND LEVEL",
   with the same assumption flag (``unit_assumed``, ``WATER_UNIT_ASSUMED``).
5. A borehole printed twice: "if the repeated print carries EXACTLY the same
   data drop it with a notice; if anything differs, alert the user and let him
   choose which print to withhold. Never merge the two."
6. Sample ids: "keep it all" (verbatim, trailing character included); the
   S-number prefix is what the lab reports reference: ``sample_label``.
7. Sample boxes of fixed size: "store the interval AS DRAWN (0.11-0.39 m), not
   a spot depth".
"""

from __future__ import annotations

import json

import pymupdf
import pytest

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_digitiser import (
    BoreholePdfDigitiser,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_text_helpers import sample_label
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_borehole import DigitisedBorehole
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel

from . import _synthetic_borehole_pdf as synth

IDENTITY = PdfReportIdentity(file_name="rulings.pdf", file_sha="3" * 64, ocr_available=False)


def _parse(doc: pymupdf.Document):
    """Return the triage and the parsed boreholes of a synthetic report."""
    result = BoreholePdfTriager(ocr=None).triage(doc, file_name="rulings.pdf")
    return result, BoreholePdfDigitiser().digitise(result, IDENTITY)


def _boorstaat(sheets: list[synth.Sheet]) -> pymupdf.Document:
    """Return a boorstaat report drawn from the given sheets."""
    doc = pymupdf.open()
    for sheet in sheets:
        synth.draw_boorstaat_sheet(doc, sheet)
    return doc


def _codes(borehole: DigitisedBorehole) -> list[str]:
    """Return the finding codes of a borehole."""
    return [i.code for i in borehole.issues]


@pytest.fixture(scope="module")
def boorstaat() -> DigitisedBorehole:
    """B-T1 from the clean two-sheet boorstaat (header names Lambert72, water in cm-mv)."""
    _, (borehole,) = _parse(synth.build_boorstaat_pdf())
    return borehole


# --- Ruling 1: the surface line ----------------------------------------------


def test_the_word_on_the_surface_line_is_the_header_note_surface_label_not_a_layer(
    boorstaat,
) -> None:
    """ "asfalt" on the 650 cm TAW line is the surface label; "the first layer is 6.50 to 6.40"."""
    assert boorstaat.header.surface_label == "asfalt"
    first = boorstaat.intervals[0]
    assert (first.top_level_m, first.base_level_m) == pytest.approx((6.50, 6.40))
    assert (first.depth_top_m, first.depth_base_m) == pytest.approx((0.0, 0.10))
    assert first.description == "Asfalt, Asfaltboor"
    assert all(i.description != "asfalt" for i in boorstaat.intervals)
    assert boorstaat.to_dict()["header"]["surface_label"] == "asfalt"


def test_the_boorprofiel_surface_word_is_its_surface_label_too() -> None:
    """ "akker" on the 6.61 m TAW line: a header note; the first layer starts at 6.61."""
    _, (borehole,) = _parse(synth.build_boorprofiel_pdf())
    assert borehole.header.surface_label == "akker"
    assert borehole.intervals[0].top_level_m == pytest.approx(6.61)
    assert borehole.intervals[0].description.startswith("Zand zeer fijn")


# --- Ruling 2: a sampled interval has an empty lithology ---------------------


@pytest.mark.parametrize(
    "printed",
    ["Sonic Drill, Steekbus", "Sonic Drill, steekbus niet vol", "Edelmanboor, steekbus"],
)
def test_an_interval_printing_only_the_technique_and_sample_remark_has_an_empty_lithology(
    printed: str,
) -> None:
    """ "You can leave it empty": the layer stays, its lithology is empty, the raw text and
    the sample are kept, and it says why (``sampled``) so a grain-size test can fill it."""
    sheet1, sheet2 = synth.boorstaat_sheets()
    sheet2.layers[1] = synth.Layer("200", [printed])
    _, (borehole,) = _parse(_boorstaat([sheet1, sheet2]))
    tube = borehole.intervals[5]
    assert (tube.depth_top_m, tube.depth_base_m) == pytest.approx((4.5, 5.0))
    assert tube.description == printed
    assert tube.lithology_absent_reason == "sampled"
    # What the description -> codes rule parser receives: nothing to map.
    assert tube.lithology_text == ""
    sample = next(s for s in borehole.samples if s.sample_id == "S1-0000000001")
    assert (sample.depth_top_m, sample.depth_base_m) == pytest.approx((4.5, 5.0), abs=0.01)


def test_a_described_layer_that_also_names_the_technique_keeps_its_lithology(boorstaat) -> None:
    """ "Zand matig fijn, ..., Sonic Drill" is described: no absent reason, text to map kept."""
    sand = boorstaat.intervals[2]
    assert sand.lithology_absent_reason is None
    assert sand.lithology_text == sand.description


def test_the_absent_reason_travels_in_the_dict(boorstaat) -> None:
    """``lithology_absent_reason`` and ``lithology_text`` are in ``to_dict`` and round-trip."""
    data = json.loads(json.dumps(boorstaat.to_dict()))
    tube = data["intervals"][5]
    assert tube["lithology_absent_reason"] == "sampled"
    assert tube["lithology_text"] == ""
    assert DigitisedBorehole.from_dict(data).to_dict() == boorstaat.to_dict()


# --- Ruling 3: X/Y without a named system ------------------------------------


def test_xy_without_a_named_system_is_kept_as_lambert72_assumed_and_flagged() -> None:
    """ "It IS Lambert 72, but the user confirms it at import": EPSG 31370, assumed, one finding."""
    result, (borehole,) = _parse(synth.build_boorprofiel_pdf())
    assert (borehole.header.x, borehole.header.y) == pytest.approx((67800.0, 224500.0))
    assert borehole.header.epsg == 31370
    assert borehole.header.crs_assumed is True
    assert borehole.provenance["crs_assumed"] is True
    (finding,) = [i for i in borehole.issues if i.code == "CRS_ASSUMED"]
    assert finding.level is ValidationLevel.WARNING
    assert finding.params["epsg"] == 31370
    (listed,) = result.digest.boreholes
    assert (listed.epsg, listed.crs_assumed) == (31370, True)


def test_a_printed_lambert72_label_is_not_an_assumption(boorstaat) -> None:
    """ "x-coordinaat [m Lambert72]" names the system: ``crs_assumed`` False, no finding."""
    assert boorstaat.header.epsg == 31370
    assert boorstaat.header.crs_assumed is False
    assert boorstaat.provenance["crs_assumed"] is False
    assert "CRS_ASSUMED" not in _codes(boorstaat)


# --- Ruling 4: a water level without unit or reference -----------------------


def test_a_bare_water_level_is_read_as_cm_below_ground_and_flagged() -> None:
    """ "GWS: 380" = 3.80 m below ground level, ``unit_assumed``, ``WATER_UNIT_ASSUMED``."""
    _, (borehole,) = _parse(synth.build_boorprofiel_pdf(water="380"))
    (water,) = borehole.water_levels
    assert water.depth_m == pytest.approx(3.80)
    assert water.unit_assumed is True
    assert water.raw_text == "380"
    assert "WATER_UNIT_ASSUMED" in _codes(borehole)
    assert borehole.provenance["water_unit_assumed"] is True


def test_a_water_level_in_cm_without_a_reference_is_cm_below_ground_and_flagged() -> None:
    """ "Grondwaterstand in cm': 234" = 2.34 m below ground level, flagged the same way."""
    sheet1, sheet2 = synth.boorstaat_sheets()
    sheet1.water_line = sheet2.water_line = "Grondwaterstand in cm': 234"
    _, (borehole,) = _parse(_boorstaat([sheet1, sheet2]))
    (water,) = borehole.water_levels
    assert water.depth_m == pytest.approx(2.34)
    assert water.unit_assumed is True
    assert "WATER_UNIT_ASSUMED" in _codes(borehole)


def test_a_water_level_with_an_explicit_reference_is_not_an_assumption(boorstaat) -> None:
    """ "Grondwaterstand [cm-mv]: 200" is explicit: 2.00 m, ``unit_assumed`` False, no finding."""
    (water,) = boorstaat.water_levels
    assert water.depth_m == pytest.approx(2.0)
    assert water.unit_assumed is False
    assert "WATER_UNIT_ASSUMED" not in _codes(boorstaat)
    assert boorstaat.provenance["water_unit_assumed"] is False


# --- Ruling 5: a borehole printed twice ---------------------------------------


def test_a_repeat_print_with_exactly_the_same_data_is_dropped_with_a_notice() -> None:
    """Sheet 2 printed again, identical over the overlap: dropped, listed in the digest's
    dropped list, and a notice on the kept borehole."""
    result, boreholes = _parse(synth.build_findings_pdf())
    (listed,) = result.digest.boreholes
    assert listed.pages == (1, 2, 3)
    (dropped,) = result.digest.dropped
    assert dropped.key == "B-T1@p5"
    assert dropped.kept_key == "B-T1@p1"
    assert dropped.reason == "duplicate"
    assert dropped.pages == (5,)
    assert result.digest.to_dict()["dropped"][0]["key"] == "B-T1@p5"
    (kept,) = boreholes
    (notice,) = [i for i in kept.issues if i.code == "REPEAT_DROPPED"]
    assert notice.level is ValidationLevel.INFO
    assert notice.params["dropped_key"] == "B-T1@p5"


def test_a_repeat_print_that_differs_keeps_both_listed_and_flags_both() -> None:
    """The reprint prints another text for the 4.50-5.00 m row: both stay listed, both carry
    ``REPEAT_DIFFERS`` with the differing row, and nothing is merged."""
    result, (first, again) = _parse(synth.build_findings_pdf("Sonic Drill, Steekbus niet vol"))
    assert [b.key for b in result.digest.boreholes] == ["B-T1@p1", "B-T1@p5"]
    assert result.digest.dropped == ()
    assert result.digest.boreholes[1].repeat_of == "B-T1@p1"
    for borehole, other in ((first, "B-T1@p5"), (again, "B-T1@p1")):
        (finding,) = [i for i in borehole.issues if i.code == "REPEAT_DIFFERS"]
        assert finding.level is ValidationLevel.WARNING
        assert finding.params["other_key"] == other
        (row,) = finding.params["rows"]
        assert (row["depth_top_m"], row["depth_base_m"]) == pytest.approx((4.5, 5.0))
        assert row["kept"] == "Sonic Drill, Steekbus"
        assert row["repeat"] == "Sonic Drill, Steekbus niet vol"
    assert first.intervals[5].description == "Sonic Drill, Steekbus"


# --- Ruling 6: sample ids verbatim + the S-number ----------------------------


def test_sample_ids_stay_verbatim_and_expose_the_printed_s_number() -> None:
    """ "Keep it all": "9-0000000008X" and "S10-0000000009/" verbatim; the S-number the lab
    reports reference is its own field ("S10"), the bare number where no S is printed ("9")."""
    sheet1, sheet2 = synth.boorstaat_sheets()
    sheet1.samples = [("9-0000000008X", 350.0, 414.0, False)]
    sheet2.samples = [("S10-0000000009/", 450.0, 500.0, True)]
    _, (borehole,) = _parse(_boorstaat([sheet1, sheet2]))
    by_id = {s.sample_id: s for s in borehole.samples}
    assert set(by_id) == {"9-0000000008X", "S10-0000000009/"}
    assert by_id["9-0000000008X"].sample_label == "9"
    assert by_id["S10-0000000009/"].sample_label == "S10"
    assert borehole.to_dict()["samples"][0]["sample_label"] in {"9", "S10"}


def test_a_bare_sample_number_is_its_own_label() -> None:
    """The boorprofiel prints only "3" next to the box: id "3", label "3"."""
    _, (borehole,) = _parse(synth.build_boorprofiel_pdf(sample_box=("3", 6.50, 6.22)))
    (sample,) = borehole.samples
    assert (sample.sample_id, sample.sample_label) == ("3", "3")


# --- Ruling 7: a sample box is stored as drawn --------------------------------


def test_a_fixed_size_sample_box_is_stored_as_the_interval_as_drawn() -> None:
    """The box drawn from 6.50 to 6.22 m TAW (0.11-0.39 m): the interval as drawn, never a
    spot depth."""
    _, (borehole,) = _parse(synth.build_boorprofiel_pdf(sample_box=("3", 6.50, 6.22)))
    (sample,) = borehole.samples
    # 0.02 m: the synthetic axis labels sit ~0.3 pt off their ticks (20 pt per m).
    assert (sample.depth_top_m, sample.depth_base_m) == pytest.approx((0.11, 0.39), abs=0.02)
    assert sample.depth_base_m - sample.depth_top_m == pytest.approx(0.28, abs=0.01)


@pytest.mark.parametrize(
    ("printed", "label"),
    [
        ("S10-0550471459/", "S10"),
        ("9-0550471461X", "9"),
        ("1 -", "1"),
        ("ST1-2017054426", "ST1"),
        ("D1-0550471388+", "D1"),
        ("108 -44.49", "108"),
        ("5groteemmers(40kg)-", None),
    ],
)
def test_the_sample_label_is_the_printed_prefix_before_the_dash(
    printed: str, label: str | None
) -> None:
    """Ids as the owner's boorstaten print them: the label is what precedes the dash
    (the S-number, a bare number, or another short prefix such as "ST1"); free text is none."""
    assert sample_label(printed) == label

"""Per-borehole parse of a boorstaat report (owner 2026-10-08).

The rules pinned here, in the brief's words:

* columns -> per-interval rows: depth_top_m, depth_base_m, the free
  description text verbatim (raw, no translation);
* the depths come from the printed level labels (depth = ground level -
  level), never from where the row text happens to sit;
* a continuation sheet that reprints the layer the previous sheet cut joins
  into ONE interval;
* a malformed depth cell is left unread with an error, never interpolated;
* sample marks (depth + id) where printed; water level(s) where printed;
* no description is mapped to DOV codes here (the track editor's rule parser
  is the only description -> codes path);
* ``DigitisedBorehole`` round-trips through ``to_dict`` / ``from_dict``.
"""

from __future__ import annotations

import json

import pytest

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_digitiser import (
    BoreholePdfDigitiser,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_borehole import DigitisedBorehole
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel

from . import _synthetic_borehole_pdf as synth

IDENTITY = PdfReportIdentity(file_name="synthetic.pdf", file_sha="0" * 64, ocr_available=False)


def _digitise(malformed_label: str | None = None) -> DigitisedBorehole:
    doc = synth.build_boorstaat_pdf(malformed_label=malformed_label)
    result = BoreholePdfTriager(ocr=None).triage(doc, file_name="synthetic.pdf")
    (borehole,) = BoreholePdfDigitiser().digitise(result, IDENTITY)
    return borehole


@pytest.fixture(scope="module")
def borehole() -> DigitisedBorehole:
    """B-T1, read from the clean two-sheet report."""
    return _digitise()


def test_intervals_take_their_depths_from_the_printed_levels(borehole) -> None:
    """Ground 6.50 m TAW: levels 650/640/600/500/400/200/150/-78 -> depths 0..7.28 m."""
    tops_bases = [(i.depth_top_m, i.depth_base_m) for i in borehole.intervals]
    assert tops_bases == pytest.approx(
        [(0.0, 0.1), (0.1, 0.5), (0.5, 1.5), (1.5, 2.5), (2.5, 4.5), (4.5, 5.0), (5.0, 7.28)]
    )


def test_the_description_is_kept_verbatim(borehole) -> None:
    """The printed lines joined by a space; no translation, no code."""
    texts = [i.description for i in borehole.intervals]
    assert texts[0] == "Asfalt, Asfaltboor"
    assert texts[2] == "Zand matig fijn, zwak siltig, donker bruingrijs, Sonic Drill"
    assert texts[5] == "Sonic Drill, Steekbus"
    assert borehole.intervals[2].description_lines == (
        "Zand matig fijn, zwak siltig, donker bruingrijs,",
        "Sonic Drill",
    )


def test_a_continuation_sheet_that_reprints_the_cut_layer_joins_into_one_interval(borehole) -> None:
    """Sheet 1 cuts the sand at 4.14 m; sheet 2 reprints it from 3.14 m: one sand 2.50-4.50 m."""
    sand = borehole.intervals[4]
    assert sand.description == synth.SAND_TEXT
    assert (sand.depth_top_m, sand.depth_base_m) == pytest.approx((2.5, 4.5))
    assert sand.pages == (1, 2)
    assert sum(1 for i in borehole.intervals if i.description == synth.SAND_TEXT) == 1


def test_the_surface_cover_above_the_first_rule_is_not_an_interval(borehole) -> None:
    """ "asfalt" printed above the 650 rule is kept raw on the header, not as a layer."""
    assert borehole.header.surface_label == "asfalt"
    assert all(i.description != "asfalt" for i in borehole.intervals)


def test_the_header_names_the_identification_standard_and_the_ground_level(borehole) -> None:
    """The sheet says "Identificatie volgens NEN-EN-ISO 14688"; ground 6.5 mTAW from the header."""
    assert borehole.header.identification_standard == "NEN-EN-ISO 14688"
    assert borehole.header.ground_level_m == pytest.approx(6.5)
    assert borehole.header.ground_level_source == "header"
    assert borehole.header.total_depth_m == pytest.approx(7.28)


def test_sample_marks_take_their_depth_from_the_depth_axis(borehole) -> None:
    """Open bar 3.50-4.14 m = disturbed; filled bar 4.50-5.00 m = undisturbed (printed legend)."""
    samples = {s.sample_id: s for s in borehole.samples}
    disturbed = samples["1-0000000002"]
    undisturbed = samples["S1-0000000001"]
    assert (disturbed.depth_top_m, disturbed.depth_base_m) == pytest.approx((3.5, 4.14), abs=0.01)
    assert (undisturbed.depth_top_m, undisturbed.depth_base_m) == pytest.approx(
        (4.5, 5.0), abs=0.01
    )
    assert disturbed.mark == "open"
    assert undisturbed.mark == "filled"
    assert disturbed.sample_type == "geroerd"
    assert undisturbed.sample_type == "ongeroerd"


def test_the_printed_water_level_is_read_with_its_unit(borehole) -> None:
    """ "Grondwaterstand [cm-mv]: 200" = 2.00 m below ground; the raw text is kept."""
    (water,) = borehole.water_levels
    assert water.depth_m == pytest.approx(2.0)
    assert water.raw_text == "200"
    assert water.label == "Grondwaterstand [cm-mv]:"


def test_no_description_is_mapped_to_dov_codes_here(borehole) -> None:
    """The rule parser of the track editor is the only description -> codes path."""
    data = borehole.to_dict()
    for interval in data["intervals"]:
        assert not any("code" in key or "soil" in key for key in interval)


def test_a_malformed_depth_cell_is_left_unread_never_interpolated() -> None:
    """Sheet 2 prints "15O" for the 5.00 m boundary: that boundary is None, with an ERROR."""
    borehole = _digitise(malformed_label="15O")
    tube, clay = borehole.intervals[5], borehole.intervals[6]
    assert tube.depth_base_m is None
    assert clay.depth_top_m is None
    assert clay.depth_base_m == pytest.approx(7.28)
    errors = [i for i in borehole.issues if i.level == ValidationLevel.ERROR]
    assert [e.code for e in errors] == ["PDF_BOREHOLE_LEVEL_UNREADABLE"]
    assert errors[0].params["text"] == "15O"
    assert errors[0].params["page"] == 2


def test_the_parse_round_trips_through_its_dict(borehole) -> None:
    """``from_dict(to_dict())`` gives back the same borehole, JSON-safe."""
    data = json.loads(json.dumps(borehole.to_dict()))
    again = DigitisedBorehole.from_dict(data)
    assert again.to_dict() == borehole.to_dict()
    assert data["provenance"]["source"] == "pdf-digitised"
    assert data["provenance"]["profile"] == "boorstaat"
    assert data["provenance"]["pages"] == [1, 2]
    assert data["provenance"]["text_sources"] == {"1": "text", "2": "text"}

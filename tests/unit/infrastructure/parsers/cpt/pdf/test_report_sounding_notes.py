"""Every triage warning also travels as a stable code + params (dogfeed 2026-10-04).

The owner read the per-row notes of the PDF triage list in English inside a
Dutch app ("22 point(s) on an axis maximum: the true value is higher"). The
project rule is "translate at the presentation boundary, never at ingest", so
the backend sends each note as a code with its parameters and the desktop
renders it from its EN/NL catalogues. The English ``warnings`` stay exactly as
they were, for clients that do not know the codes yet (additive change).
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.cpt_origin import CptOrigin
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import _report_sounding


def _page(
    *, placed: bool, ground: float | None, kind: GraphKind, project: str | None = None
) -> SimpleNamespace:
    """Return the header evidence of one sheet."""
    return SimpleNamespace(
        project=project,
        ground_level_m=ground,
        x=150000.0 if placed else None,
        y=200000.0 if placed else None,
        epsg=31370 if placed else None,
        z_epsg=5710,
        graph_kind=kind,
        profile_name="generic",
        test_date=None,
    )


def _sounding(
    *,
    read: bool,
    elevation: bool,
    clipped: int,
    drilled: list[tuple[float, float]] | None = None,
    axis_gaps: list[tuple[int, float, float]] | None = None,
) -> SimpleNamespace:
    """Return a merged sounding: curves read or not, on an elevation axis or not."""
    reference = DepthReference.ELEVATION if elevation else DepthReference.DEPTH_BELOW_GROUND
    flags = np.zeros(40, dtype=bool)
    flags[:clipped] = True
    curves = {PanelKind.QC: SimpleNamespace(clipped=flags)} if read else {}
    return SimpleNamespace(
        sounding_id="S7",
        page_numbers=(6,),
        calibrations=(SimpleNamespace(depth_reference=reference, ground_level_m=None),),
        curves=curves,
        drilled_intervals=lambda logger=None: list(drilled or []),
        sheet_axis_gaps=lambda: list(axis_gaps or []),
    )


def _notes(sounding: SimpleNamespace, page: SimpleNamespace, ocr: bool):  # type: ignore[no-untyped-def]
    """Return the listed sounding for one sheet."""
    return _report_sounding("S7", CptOrigin.CAMPAIGN, sounding, {6: page}, ocr)  # type: ignore[arg-type]


def test_every_warning_has_a_note_code_in_the_same_order() -> None:
    """Unread raster sheet, no OCR, no position: three warnings, three codes, same order."""
    listed = _notes(
        _sounding(read=False, elevation=False, clipped=0),
        _page(placed=False, ground=None, kind=GraphKind.RASTER),
        ocr=False,
    )
    assert [n.code for n in listed.notes] == [
        "TICKS_UNAVAILABLE_NO_OCR",
        "NO_POSITION_PRINTED",
        "READ_FROM_IMAGE",
    ]
    assert len(listed.notes) == len(listed.warnings)


def test_ticks_not_read_when_ocr_was_available() -> None:
    """OCR ran but no curve was read: ask for two tick values per axis."""
    listed = _notes(
        _sounding(read=False, elevation=False, clipped=0),
        _page(placed=True, ground=4.5, kind=GraphKind.VECTOR),
        ocr=True,
    )
    assert [n.code for n in listed.notes] == ["TICKS_NOT_READ"]
    assert listed.warnings == ("axis values not read: type two tick values per axis",)


def test_elevation_axis_and_clipped_points_carry_their_count() -> None:
    """An elevation axis with a printed ground level, 22 clipped points: count as a param."""
    listed = _notes(
        _sounding(read=True, elevation=True, clipped=22),
        _page(placed=True, ground=4.5, kind=GraphKind.VECTOR),
        ocr=False,
    )
    assert [(n.code, n.params) for n in listed.notes] == [
        ("ELEVATION_AXIS", {}),
        ("CLIPPED_POINTS", {"count": 22}),
    ]
    assert listed.warnings[1] == "22 point(s) on an axis maximum: the true value is higher"


def test_elevation_axis_without_a_printed_ground_level() -> None:
    """An elevation axis and no printed ground level: ask the user to type it."""
    listed = _notes(
        _sounding(read=True, elevation=True, clipped=0),
        _page(placed=True, ground=None, kind=GraphKind.VECTOR),
        ocr=False,
    )
    assert [n.code for n in listed.notes] == ["ELEVATION_AXIS_NO_GROUND_LEVEL"]


def test_the_ui_dict_carries_notes_next_to_the_english_warnings() -> None:
    """``to_dict`` keeps ``warnings`` and adds ``notes`` as plain JSON."""
    listed = _notes(
        _sounding(read=True, elevation=False, clipped=3),
        _page(placed=False, ground=4.5, kind=GraphKind.VECTOR),
        ocr=False,
    )
    data = json.loads(json.dumps(listed.to_dict()))
    assert data["warnings"] == [
        "no position printed: type X and Y before importing",
        "3 point(s) on an axis maximum: the true value is higher",
    ]
    assert data["notes"] == [
        {"code": "NO_POSITION_PRINTED", "params": {}},
        {"code": "CLIPPED_POINTS", "params": {"count": 3}},
    ]


def test_drilled_intervals_are_one_note_with_the_list_and_the_count() -> None:
    """Ruling "a" (2026-10-04): a drilled stretch is shown on the triage row as a note."""
    listed = _notes(
        _sounding(read=True, elevation=False, clipped=0, drilled=[(32.0, 32.3), (40.12, 40.9)]),
        _page(placed=True, ground=4.5, kind=GraphKind.VECTOR),
        ocr=False,
    )
    assert [(n.code, n.params) for n in listed.notes] == [
        ("DRILLED_INTERVALS", {"intervals": [[32.0, 32.3], [40.12, 40.9]], "count": 2}),
    ]
    assert listed.warnings == ("drilled: 32.0 to 32.3 m, 40.1 to 40.9 m",)


def test_a_stretch_no_sheet_axis_covers_is_a_sheet_axis_gap_note() -> None:
    """Owner 2026-10-07: sheet 1 ends at D1, sheet 2 starts at D2 > D1: no reading between."""
    listed = _notes(
        _sounding(read=True, elevation=False, clipped=0, axis_gaps=[(1, 33.5, 34.004)]),
        _page(placed=True, ground=4.5, kind=GraphKind.VECTOR),
        ocr=False,
    )
    assert [(n.code, n.params) for n in listed.notes] == [
        ("SHEET_AXIS_GAP", {"sheet": 1, "next": 2, "d1": 33.5, "d2": 34.0}),
    ]
    assert listed.warnings == (
        "Sheet 1 ends at 33.50 m, sheet 2 starts at 34.00 m: no reading in between",
    )


def test_a_continuous_sounding_has_no_drilled_note() -> None:
    """Nothing drilled: no note."""
    listed = _notes(
        _sounding(read=True, elevation=False, clipped=0, drilled=[]),
        _page(placed=True, ground=4.5, kind=GraphKind.VECTOR),
        ocr=False,
    )
    assert listed.notes == ()


def test_the_row_names_the_sheet_project_and_the_project_sounding_name() -> None:
    """Ruling 2026-10-04: the row shows "<project>-S<number>" ("23.15-002-S110")."""
    sounding = _sounding(read=True, elevation=False, clipped=0)
    sounding.sounding_id = "110"
    listed = _report_sounding(
        "110",
        CptOrigin.CAMPAIGN,
        sounding,  # type: ignore[arg-type]
        {6: _page(placed=True, ground=4.5, kind=GraphKind.VECTOR, project="23.15-002")},  # type: ignore[dict-item]
        False,
    )
    data = listed.to_dict()
    assert data["project_number"] == "23.15-002"
    assert data["display_name"] == "23.15-002-S110"


def _placed_at(x: float, y: float, epsg: int = 31370) -> SimpleNamespace:
    """Return the header evidence of one vector sheet printed at (x, y)."""
    page = _page(placed=True, ground=4.5, kind=GraphKind.VECTOR)
    page.x, page.y, page.epsg = x, y, epsg
    return page


def _codes_at(x: float, y: float, epsg: int = 31370) -> list[str]:
    """Return the note codes of a read sounding printed at (x, y)."""
    listed = _notes(
        _sounding(read=True, elevation=False, clipped=0), _placed_at(x, y, epsg), ocr=False
    )
    return [n.code for n in listed.notes]


def test_a_printed_coordinate_outside_the_system_extent_gets_a_note() -> None:
    """Owner finding 2026-10-08: S28A prints Y 2244433.030, out of the Lambert 72 range.

    The digitiser reads the sheet faithfully; the row tells the user to check
    the header, with the printed values and the system as params.
    """
    listed = _notes(
        _sounding(read=True, elevation=False, clipped=0),
        _placed_at(67592.443, 2244433.030),
        ocr=False,
    )
    assert [n.code for n in listed.notes] == ["COORDINATE_OUT_OF_RANGE"]
    assert listed.notes[0].params == {"x": 67592.443, "y": 2244433.030, "epsg": 31370}
    assert len(listed.warnings) == 1


def test_the_corrected_coordinate_inside_the_extent_gets_no_note() -> None:
    """Near miss: the meant value 224433.030 lies inside Lambert 72; no note."""
    assert _codes_at(67592.443, 224433.030) == []


def test_an_x_outside_the_extent_gets_the_note_too() -> None:
    """Over-shoot on the other axis: X 675924.43 is out of range as well."""
    assert _codes_at(675924.43, 224433.030) == ["COORDINATE_OUT_OF_RANGE"]


def test_a_system_without_a_known_extent_is_not_checked() -> None:
    """Another EPSG code (RD New 28992) has no extent in the table: no check."""
    assert _codes_at(67592.443, 2244433.030, epsg=28992) == []

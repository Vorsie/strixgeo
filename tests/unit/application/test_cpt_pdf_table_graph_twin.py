"""The graph sheet of a printed-table sounding is a CPT sheet (owner 2026-10-12).

Owner finding on the packaged 0.1.6 (report Z2255777): "Assen controleren" on
CPTE090, a printed-table sounding, opened an empty overlay. Ruling: "i see the
thumbnail, i should be able to set the axes, that is a cpt".

* The overlay shows the sounding's GRAPH sheet with the axes the backend
  detects for it, on demand (the triage never calibrates the graph twin); the
  user corrects them exactly as on a raster sheet and "Read again" runs the
  raster digitise on that sheet.
* The printed TABLE stays the default source of the stored series. The user
  may choose the picture reading instead ("Source: printed table (default) /
  read graph"); the chosen source and, when both exist, the qc comparison
  (median absolute and RMS difference) go into the provenance, additively
  under ``printed_table``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from groundmodel.api.routers.cpt_pdf import _digitise_response
from groundmodel.application.digitise_cpt_pdf_sounding import DigitiseCptPdfSounding
from groundmodel.application.import_cpt_pdf import ImportCptPdf
from groundmodel.application.import_cpt_result import ImportCptResult
from groundmodel.application.pdf_sounding_import_request import PdfSoundingImportRequest
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import CptPdfDigitiser
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import RASTER_DPI
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import PdfReportTriager

from ..infrastructure.parsers.cpt.pdf import _synthetic_table_pdf as synth

SHA = "c" * 64
PROJECT = UUID("00000000-0000-0000-0000-000000000003")
GRAPH_PAGE = 1  # the synthetic report prints the graph sheet first

# The synthetic graph picture: 1000 x 1200 px pasted into Rect(40, 160, 560,
# 790) pt; its frame is the rectangle (80, 40)-(950, 1150) px and the curve the
# red line (100, 60)-(900, 1100) px.
_PT_PER_PX_X = 520.0 / 1000.0
_PT_PER_PX_Y = 630.0 / 1200.0
_K = RASTER_DPI / 72.0


def _px(x_img: float, y_img: float) -> tuple[float, float]:
    """Return a picture pixel as a page pixel at the raster resolution."""
    return (40.0 + x_img * _PT_PER_PX_X) * _K, (160.0 + y_img * _PT_PER_PX_Y) * _K


def _graph_calibration() -> dict[str, Any]:
    """The calibration a user sets on the graph sheet: frame + two ticks per axis."""
    x0, y0 = _px(80, 40)
    x1, y1 = _px(950, 1150)
    return {
        "page_number": GRAPH_PAGE,
        "coordinate_space": "image-px",
        "dpi": RASTER_DPI,
        "depth_reference": "depth",
        "panels": [
            {
                "kind": "qc",
                "frame": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
                "value_scale": {"coord_a": x0, "value_a": 0.0, "coord_b": x1, "value_b": 20.0},
                "depth_scale": {"coord_a": y0, "value_a": 0.0, "coord_b": y1, "value_b": 10.0},
                "unit": "MPa",
                "to_storage_factor": 1.0,
                "curve_colour": [1.0, 0.0, 0.0],
                "source": "user",
                "assumptions": [],
            }
        ],
        "ground_level_m": None,
        "sounding_id": None,
        "profile_name": "generic",
        "assumptions": [],
    }


@pytest.fixture
def store(tmp_path: Path) -> PdfReportStore:
    """A store holding the synthetic printed-table report, triaged without OCR."""
    doc = synth.table_report()
    store = PdfReportStore(tmp_path)
    path = store.path_for(PROJECT, SHA)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    digest, soundings = PdfReportTriager(ocr=False).run(doc, SHA)
    store.remember(
        PROJECT,
        CachedPdfReport(path=path, file_name="report.pdf", digest=digest, soundings=soundings),
    )
    return store


def _use_case(store: PdfReportStore) -> DigitiseCptPdfSounding:
    """The digitise use case, detecting without OCR (the test machine may lack it)."""
    return DigitiseCptPdfSounding(store, detector_factory=lambda: CptPdfDigitiser(ocr=False))


class _Persist:
    """A stand-in for ``ImportCpt.persist`` recording what it was handed."""

    def __init__(self) -> None:
        self.calls: list[GEFParseResult] = []

    async def __call__(self, result: GEFParseResult, name: str, *_: Any, **__: Any) -> Any:
        self.calls.append(result)
        return ImportCptResult(cpt_id=uuid4(), issues=result.issues, refreshed=False, name=name)


def _import(store: PdfReportStore, request: PdfSoundingImportRequest) -> tuple[Any, _Persist]:
    persist = _Persist()
    use_case = ImportCptPdf(AsyncMock(), store=store, persist=persist)
    use_case._digitise = _use_case(store)
    return use_case, persist


# --- the overlay: the graph sheet with its axes ------------------------------


def test_opening_a_table_sounding_shows_its_graph_sheet_with_axes_to_set(
    store: PdfReportStore,
) -> None:
    """No calibration posted: the graph sheet is read on demand; the user gets
    a frame to drag even when no axis label could be read (a qc draft on the
    picture), and the stored series is still the printed table."""
    base = store.require(PROJECT, SHA).soundings[synth.SOUNDING]
    view = _use_case(store).run(PROJECT, SHA, synth.SOUNDING)
    assert view.graph is not None
    assert [c.page_number for c in view.graph.calibrations] == [GRAPH_PAGE]
    assert view.graph.calibrations[0].panels, "a frame the user can drag"
    assert list(view.overlays) == [GRAPH_PAGE]
    assert view.sounding is base
    assert view.table is not None
    assert len(view.table) == len(base.curves[PanelKind.QC])


def test_read_again_through_the_users_axes_reads_the_picture_and_keeps_the_table(
    store: PdfReportStore,
) -> None:
    """A posted calibration on the graph page runs the raster digitise on it."""
    base = store.require(PROJECT, SHA).soundings[synth.SOUNDING]
    view = _use_case(store).run(PROJECT, SHA, synth.SOUNDING, [_graph_calibration()])
    assert view.graph is not None
    qc = view.graph.curves[PanelKind.QC]
    assert len(qc) > 10
    # The red line runs from top-left to bottom-right: qc grows with depth.
    assert qc.value[-1] > qc.value[0]
    assert view.sounding is base
    assert view.comparison is not None
    assert view.comparison["n"] > 0
    assert set(view.comparison) >= {"n", "median_abs_qc_mpa", "rms_qc_mpa"}


def test_a_calibration_on_a_table_page_is_refused(store: PdfReportStore) -> None:
    """Only a graph sheet has axes; a table page has none to set."""
    on_table = {**_graph_calibration(), "page_number": 2}
    with pytest.raises(ValueError, match="graph sheet"):
        _use_case(store).run(PROJECT, SHA, synth.SOUNDING, [on_table])


def test_the_digitise_answer_carries_the_table_as_series_and_the_picture_apart(
    store: PdfReportStore,
) -> None:
    """``series`` stays the printed table (the default source); the picture's
    rows and the comparison are additive fields."""
    view = _use_case(store).run(PROJECT, SHA, synth.SOUNDING, [_graph_calibration()])
    answer = _digitise_response(view, synth.SOUNDING)
    assert answer.sampling == "printed table rows (no resampling)"
    assert [c["page_number"] for c in answer.calibrations] == [GRAPH_PAGE]
    assert answer.graph_series is not None
    assert len(answer.graph_series["depth_m"]) > 10
    assert answer.graph_comparison is not None
    assert answer.series_source_default == "table"


# --- the import: table by default, the picture on request --------------------


async def test_the_printed_table_stays_the_default_source(store: PdfReportStore) -> None:
    """No source chosen: the printed rows are stored and the provenance says "table"."""
    use_case, persist = _import(store, PdfSoundingImportRequest(key=synth.SOUNDING))
    outcomes = await use_case.execute(
        PROJECT, SHA, [PdfSoundingImportRequest(key=synth.SOUNDING)], confirm_refresh=False
    )
    assert [o.status for o in outcomes] == ["imported"]
    (result,) = persist.calls
    prov = result.import_provenance or {}
    assert prov["graph_kind"] == "printed-table"
    assert prov["printed_table"]["series_source"] == "table"
    assert "graph_comparison" not in prov["printed_table"]


async def test_the_table_source_with_the_graph_read_records_the_comparison(
    store: PdfReportStore,
) -> None:
    """Axes set but the table kept: the table is stored, the comparison recorded."""
    request = PdfSoundingImportRequest(key=synth.SOUNDING, calibrations=[_graph_calibration()])
    use_case, persist = _import(store, request)
    outcomes = await use_case.execute(PROJECT, SHA, [request], confirm_refresh=False)
    assert [o.status for o in outcomes] == ["imported"]
    (result,) = persist.calls
    prov = result.import_provenance or {}
    assert prov["graph_kind"] == "printed-table"
    assert prov["printed_table"]["series_source"] == "table"
    assert prov["printed_table"]["graph_comparison"]["n"] > 0


async def test_choosing_the_read_graph_stores_the_picture_series(store: PdfReportStore) -> None:
    """ "read graph" chosen: the picture's curve is stored under the printed header."""
    request = PdfSoundingImportRequest(
        key=synth.SOUNDING, calibrations=[_graph_calibration()], series_source="graph"
    )
    use_case, persist = _import(store, request)
    outcomes = await use_case.execute(PROJECT, SHA, [request], confirm_refresh=False)
    assert [o.status for o in outcomes] == ["imported"]
    (result,) = persist.calls
    prov = result.import_provenance or {}
    assert prov["graph_kind"] == "raster"
    assert prov["pages"] == [GRAPH_PAGE]
    assert prov["printed_table"]["series_source"] == "graph"
    assert prov["printed_table"]["graph_comparison"]["n"] > 0
    table_rows = len(store.require(PROJECT, SHA).soundings[synth.SOUNDING].curves[PanelKind.QC])
    assert len(result.data) != table_rows  # the 0.02 m raster grid, not the printed rows
    # The sounding keeps the printed header: same test id, same ground level.
    assert result.header.test_id == synth.SOUNDING
    assert result.header.z == pytest.approx(synth.GROUND_LEVEL)


async def test_the_read_graph_without_axes_set_is_not_imported(store: PdfReportStore) -> None:
    """No curve read off the picture yet: nothing to store from it, said so."""
    request = PdfSoundingImportRequest(key=synth.SOUNDING, series_source="graph")
    use_case, persist = _import(store, request)
    outcomes = await use_case.execute(PROJECT, SHA, [request], confirm_refresh=False)
    assert [o.status for o in outcomes] == ["failed"]
    assert "graph" in (outcomes[0].message or "")
    assert persist.calls == []

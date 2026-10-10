"""TriageBoreholePdfReport: the borehole-log report triage behind the import dialog.

The brief (owner 2026-10-10, phase 2): "the same user path as the CPT one".
In its words:

* the dialog lists one row per borehole with its sheets, depth, X/Y, ground
  level, date and the FINDINGS the import will ask about (``CRS_ASSUMED``,
  ``WATER_UNIT_ASSUMED``);
* "cache-by-sha": a report already triaged answers from memory, no second read;
* "cancel the same way": a stopped triage ends with ``TriageCancelled`` and
  remembers nothing.

A real synthetic report (the parser tests' PyMuPDF builder) in a throw-away
store; no OCR (deterministic).
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import uuid4

import pymupdf
import pytest

from groundmodel.application.triage_borehole_pdf_report import TriageBoreholePdfReport
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.shared.exceptions import CptPdfReportNotFoundError, TriageCancelled

from ..infrastructure.parsers.borehole.pdf import _synthetic_borehole_pdf as synth

PROJECT = uuid4()


def _store_report(store: PdfReportStore, doc: pymupdf.Document) -> str:
    """Spool ``doc`` into the store the way the route does; return its sha."""
    data = bytes(doc.tobytes())
    sha = hashlib.sha256(data).hexdigest()
    spooled = store.project_dir(PROJECT) / "upload.part"
    spooled.parent.mkdir(parents=True, exist_ok=True)
    spooled.write_bytes(data)
    store.put_file(PROJECT, sha, spooled)
    return sha


def _triage(tmp_path: Path, doc: pymupdf.Document):
    """Return (store, sha, use case) for a stored synthetic report."""
    store = PdfReportStore(tmp_path)
    sha = _store_report(store, doc)
    use_case = TriageBoreholePdfReport(store, lambda: BoreholePdfTriager(ocr=None))
    return store, sha, use_case


def test_the_triage_lists_each_borehole_with_the_findings_the_import_asks_about(tmp_path):
    """B-T2 prints X/Y without a system and "GWS: 380": both findings are on its row."""
    _, sha, use_case = _triage(tmp_path, synth.build_boorprofiel_pdf(water="380"))

    report = use_case.run(PROJECT, sha, "profielen.pdf")
    listing = report.to_triage_dict()

    [row] = listing["boreholes"]
    assert row["key"] == "B-T2@p1"
    assert row["name"] == "B-T2"
    assert row["x"] == pytest.approx(67800.0)
    assert row["y"] == pytest.approx(224500.0)
    assert row["crs_assumed"] is True
    assert row["water_unit_assumed"] is True
    assert row["water_level_m"] == pytest.approx(3.80)
    assert row["importable"] is True
    codes = {f["code"] for f in row["findings"]}
    assert {"CRS_ASSUMED", "WATER_UNIT_ASSUMED"} <= codes
    assert row["n_intervals"] == 4
    assert listing["file_sha"] == sha


def test_a_borehole_printed_with_a_named_system_asks_nothing(tmp_path):
    """B-T1 prints "[m Lambert72]" and "[cm-mv]": no assumption, no question."""
    _, sha, use_case = _triage(tmp_path, synth.build_boorstaat_pdf())

    [row] = use_case.run(PROJECT, sha, "boorstaten.pdf").to_triage_dict()["boreholes"]

    assert row["crs_assumed"] is False
    assert row["water_unit_assumed"] is False
    assert row["n_samples"] == 2
    assert row["pages"] == [1, 2]


def test_a_report_already_triaged_answers_from_memory(tmp_path):
    """Cache-by-sha: the second run does not open the report again."""
    _, sha, use_case = _triage(tmp_path, synth.build_boorstaat_pdf())
    first = use_case.run(PROJECT, sha, "boorstaten.pdf")

    calls: list[int] = []
    use_case_again = TriageBoreholePdfReport(
        use_case._store, lambda: calls.append(1) or BoreholePdfTriager(ocr=None)
    )
    second = use_case_again.run(PROJECT, sha, "boorstaten.pdf")

    assert second is first
    assert calls == []


def test_a_stopped_triage_ends_cancelled_and_remembers_nothing(tmp_path):
    """Cancel the same way as the CPT triage: TriageCancelled, nothing kept."""
    store, sha, use_case = _triage(tmp_path, synth.build_boorstaat_pdf())

    with pytest.raises(TriageCancelled):
        use_case.run(PROJECT, sha, "boorstaten.pdf", should_stop=lambda: True)

    assert store.recall(PROJECT, sha) is None


def test_progress_ticks_per_page_in_the_classify_phase(tmp_path):
    """Every page ticks ``classify``; the parse ticks ``digitise`` once it ran."""
    _, sha, use_case = _triage(tmp_path, synth.build_boorstaat_pdf())
    ticks: list[tuple[str, int, int]] = []

    use_case.run(
        PROJECT, sha, "boorstaten.pdf", progress=lambda p, d, t, **_: ticks.append((p, d, t))
    )

    classify = [t for t in ticks if t[0] == "classify"]
    assert classify[-1] == ("classify", 3, 3)
    assert ticks[-1][0] == "digitise"


def test_an_unknown_report_is_the_stores_not_found_error(tmp_path):
    """A sha the store does not hold: the not-found error the API maps to 404."""
    use_case = TriageBoreholePdfReport(PdfReportStore(tmp_path), lambda: BoreholePdfTriager())
    with pytest.raises(CptPdfReportNotFoundError):
        use_case.run(PROJECT, "a" * 64, "missing.pdf")

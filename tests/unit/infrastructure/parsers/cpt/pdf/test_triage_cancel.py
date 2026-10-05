"""Cancel stops the work (owner finding 2026-10-05).

He closed the triage dialog of a report whose ~97 sheets all go through OCR;
the job was cancelled but the OCR kept going page after page in its worker
thread. The rule: once the user cancels, the triage reads no further page --
not in the classify pass, not in the digitise pass, and not the second strip
of a page whose OCR is under way -- and it ends with ``TriageCancelled``.
"""

from __future__ import annotations

import pytest

from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import PdfReportTriager
from groundmodel.shared.exceptions import TriageCancelled

from . import _garbled_pages as garbled
from . import _synthetic_cpt_pdf as synth


def test_cancel_after_two_pages_reads_no_third_page() -> None:
    """Cancel after page 2 of 4: the OCR never sees page 3 and the triage ends cancelled."""
    ticks: list[tuple[int, int, bool]] = []
    engine = garbled.CountingEngine()
    triage = PageTriage(ocr=OcrReader(engine=engine))

    def progress(done: int, total: int, ocr: bool = False) -> None:
        ticks.append((done, total, ocr))

    with pytest.raises(TriageCancelled) as caught:
        triage.classify(
            garbled.garbled_report(4),
            progress=progress,
            should_stop=lambda: max((d for d, _, _ in ticks), default=0) >= 2,
        )
    # Two pages, two title strips each: page 3 was never rendered for OCR.
    assert engine.calls == 4
    assert caught.value.done == 2
    assert caught.value.total == 4


def test_cancel_during_a_page_skips_its_remaining_ocr_strip() -> None:
    """Cancel while the bottom strip is read: the top strip is not OCR'd."""
    stop = {"now": False}
    engine = garbled.CountingEngine(on_call=lambda n: stop.update(now=True))
    triage = PageTriage(ocr=OcrReader(engine=engine))
    with pytest.raises(TriageCancelled):
        triage.classify(garbled.garbled_report(2), should_stop=lambda: stop["now"])
    assert engine.calls == 1


def test_cancel_during_the_digitise_pass_digitises_no_further_sheet() -> None:
    """Cancel after the first digitised sheet: the second is never digitised."""
    doc = synth.synthetic_cpt_pdf()
    synth.draw_cpt_page(doc, synth.SyntheticPageSpec(sounding_id="S2"))
    synth.draw_cpt_page(doc, synth.SyntheticPageSpec(sounding_id="S3"))
    ticks: list[tuple[str, int, int]] = []

    def progress(phase: str, done: int, total: int, ocr: bool = False) -> None:
        ticks.append((phase, done, total))

    with pytest.raises(TriageCancelled) as caught:
        PdfReportTriager(ocr=False).run(
            doc,
            file_sha="abc",
            progress=progress,
            should_stop=lambda: ("digitise", 1, 3) in ticks,
        )
    assert [t for t in ticks if t[0] == "digitise"] == [("digitise", 1, 3)]
    assert (caught.value.done, caught.value.total) == (1, 3)


def test_without_a_cancel_the_whole_report_is_read() -> None:
    """Guard: a stop flag that never rises changes nothing."""
    engine = garbled.CountingEngine()
    report = PageTriage(ocr=OcrReader(engine=engine)).classify(
        garbled.garbled_report(3), should_stop=lambda: False
    )
    assert len(report.pages) == 3
    assert engine.calls == 6

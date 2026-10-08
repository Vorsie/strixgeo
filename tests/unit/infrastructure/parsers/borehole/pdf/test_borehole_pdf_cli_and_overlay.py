"""The offline runner and the overlay render (phase 1 tooling the owner judges).

* ``borehole_pdf_cli`` takes a pdf path and writes the triage digest
  (``<stem>.digest.json``), the parse (``<stem>.boreholes.json``) and a
  markdown table row per file (``digest.md``);
* the overlay of a parsed sheet is a PNG with the detected columns and rows
  boxed.
"""

from __future__ import annotations

import json
from pathlib import Path

from groundmodel.infrastructure.parsers.borehole.pdf import borehole_pdf_cli
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_overlay_renderer import (
    BoreholeOverlayRenderer,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)

from . import _synthetic_borehole_pdf as synth

PNG_MAGIC = b"\x89PNG"


def test_the_runner_writes_the_digest_the_parse_and_the_table(tmp_path: Path) -> None:
    """One pdf in, three artefacts out; the parse names the borehole and its intervals."""
    pdf = tmp_path / "synthetic.pdf"
    synth.build_boorstaat_pdf(extra_pages=True).save(pdf)
    out = tmp_path / "out"
    code = borehole_pdf_cli.main([str(pdf), "--out", str(out), "--no-ocr", "--overlays", "1"])
    assert code == 0
    digest = json.loads((out / "synthetic.digest.json").read_text(encoding="utf-8"))
    assert digest["boreholes"][0]["name"] == "B-T1"
    parse = json.loads((out / "synthetic.boreholes.json").read_text(encoding="utf-8"))
    assert parse[0]["header"]["name"] == "B-T1"
    assert len(parse[0]["intervals"]) == 7
    table = (out / "digest.md").read_text(encoding="utf-8")
    assert "synthetic.pdf" in table
    assert "| 5 |" in table
    assert any(p.suffix == ".png" for p in out.iterdir())


def test_the_overlay_of_a_parsed_sheet_is_a_png() -> None:
    """The renderer boxes the rows of a log sheet and returns PNG bytes."""
    doc = synth.build_boorstaat_pdf()
    result = BoreholePdfTriager(ocr=None).triage(doc, file_name="synthetic.pdf")
    png = BoreholeOverlayRenderer().overlay_png(doc, result.sheets[1], dpi=72)
    assert png[:4] == PNG_MAGIC


def test_the_table_names_a_dropped_repeat_and_an_assumed_crs(tmp_path: Path) -> None:
    """digest.md lists an identical repeat as dropped and marks an assumed Lambert 72."""
    out = tmp_path / "out"
    findings = tmp_path / "findings.pdf"
    synth.build_findings_pdf().save(findings)
    profile = tmp_path / "profile.pdf"
    synth.build_boorprofiel_pdf().save(profile)
    code = borehole_pdf_cli.main([str(findings), str(profile), "--out", str(out), "--no-ocr"])
    assert code == 0
    table = (out / "digest.md").read_text(encoding="utf-8")
    assert "Dropped: B-T1@p5 (pages 5), duplicate" in table
    assert "31370 (assumed)" in table

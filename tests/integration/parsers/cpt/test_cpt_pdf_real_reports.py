"""The PDF CPT digitiser on the two real 23.15 proefverslagen (CAMZ-001, CAMZ-005).

The reports are not repo fixtures (94 MB together). Put them in
``data/cpt_pdf/`` (gitignored, like ``data/cpt/``) or point
``STRIX_CPT_PDF_DIR`` at them; the tests skip when they are absent. The GEF
of sounding 1 (``23.15-002_1.gef``) is the reference for the score; it is
looked up in the same directory or ``STRIX_CPT_PDF_GEF_DIR``.

No database is touched.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pymupdf
import pytest

from groundmodel.infrastructure.parsers.cpt.gef.gef_parser import GEFParser
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_origin import CptOrigin
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import CptPdfDigitiser
from groundmodel.infrastructure.parsers.cpt.pdf.page_class import PageClass
from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind

REPORT_DIR = Path(os.environ.get("STRIX_CPT_PDF_DIR", "data/cpt_pdf"))
GEF_DIR = Path(os.environ.get("STRIX_CPT_PDF_GEF_DIR", str(REPORT_DIR)))
CAMZ_001 = REPORT_DIR / "camz-001.pdf"
GEF_1 = GEF_DIR / "23.15-002_1.gef"

pytestmark = pytest.mark.skipif(
    not CAMZ_001.exists(), reason=f"real proefverslag not present ({CAMZ_001})"
)


@pytest.fixture(scope="module")
def camz001() -> pymupdf.Document:
    """The CAMZ-001 proefverslag."""
    return pymupdf.open(CAMZ_001)


def test_triage_keeps_the_campaign_sheets_and_names_the_dov_reprints(
    camz001: pymupdf.Document,
) -> None:
    """Triage keeps the campaign sheets and names the dov reprints."""
    triage = PageTriage(ocr=False).classify(camz001)
    assert triage.fingerprint.campaign_codes == ("CAMZ-001",)
    graphs = [p for p in triage.pages if p.page_class is PageClass.CPT_GRAPH]
    campaign = [p for p in graphs if p.origin is CptOrigin.CAMPAIGN]
    dov = [p for p in graphs if p.dov_id]
    # Sheet 172 = sounding 1, the first campaign sheet; the DOV sheets of the
    # desk study are never campaign.
    assert 172 in PageTriage.trim(triage)
    assert len(campaign) >= 90
    assert all(p.origin is CptOrigin.DESK_STUDY for p in dov)
    assert len(PageTriage.trim(triage)) < triage.pages[-1].page_number / 3


@pytest.mark.skipif(not GEF_1.exists(), reason=f"reference GEF not present ({GEF_1})")
def test_sounding_1_vertices_match_its_gef(camz001: pymupdf.Document) -> None:
    """Sounding 1 vertices match its gef."""
    sounding = CptPdfDigitiser(ocr=False).digitise_page(camz001, 172)
    assert sounding.sounding_id == "1"
    qc = sounding.curves[PanelKind.QC]
    gef = GEFParser().parse_bytes(GEF_1.read_bytes()).data
    gd = gef["depth_m"].to_numpy()
    gq = gef["qc_mpa"].to_numpy()
    j = np.clip(np.searchsorted(gd, qc.depth_m), 1, len(gd) - 1)
    j = np.where(np.abs(gd[j - 1] - qc.depth_m) < np.abs(gd[j] - qc.depth_m), j - 1, j)
    keep = ~qc.clipped
    # One drawn vertex per GEF scan: depth within 2 cm, qc within 0.05 MPa.
    assert abs(len(qc.depth_m) - len(gd)) <= 2
    assert np.max(np.abs(qc.depth_m - gd[j])) < 0.02
    assert np.max(np.abs(qc.value[keep] - gq[j][keep])) < 0.05

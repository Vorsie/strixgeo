"""A digitised CPT carries its provenance (Data Integrity rule 1).

Brief 2026-09-30: "provenance stored on the CPT: source 'pdf-digitised', the
report file name + sha, the page numbers, the calibration JSON, the digitiser
version". The parse result carries it; ``ImportCpt`` stores it verbatim; a
GEF / DOV import stores none (the file is its own provenance); a consented
refresh replaces it with the fresh reading's.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import polars as pl

from groundmodel.application import import_cpt
from groundmodel.application.import_cpt import ImportCpt
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult

PROVENANCE = {"source": "pdf-digitised", "report_file_name": "camz-001.pdf", "pages": [231]}


def _result(provenance: dict[str, object] | None) -> GEFParseResult:
    return GEFParseResult(
        header=GEFHeader(project_id="CAMZ-001", test_id="110", x=1.0, y=2.0, epsg=31370),
        cpt_type=CPTType.CPTE,
        data=pl.DataFrame({"depth_m": [1.0, 1.02], "qc_mpa": [3.0, 4.0]}),
        import_provenance=provenance,
    )


def test_the_provenance_a_parser_stamps_is_stored_on_the_cpt() -> None:
    """The digitiser's provenance lands verbatim on the CPT row."""
    orm = ImportCpt(MagicMock())._to_orm(uuid4(), "110", _result(PROVENANCE), None)
    assert orm.import_provenance == PROVENANCE


def test_a_file_import_stores_no_provenance() -> None:
    """A GEF / DOV parse carries none, so the column stays empty."""
    orm = ImportCpt(MagicMock())._to_orm(uuid4(), "110", _result(None), None)
    assert orm.import_provenance is None


def test_a_consented_refresh_replaces_the_provenance() -> None:
    """A refresh re-reads the sounding, so its provenance is the fresh one."""
    assert "import_provenance" in import_cpt._REFRESHED_COLUMNS

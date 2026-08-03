"""The import refusal must name the coordinate-system code the file declared.

``ImportCpt.persist`` refuses a CPT whose coordinates carry no usable CRS.
There are two different reasons that happens, and they send the reader to
different places:

* the file declared no ``#XYID`` code at all — nothing to look up;
* the file declared a code we could not translate to an EPSG — the file is
  fine, our codelist is short.

Saying "EPSG code is required" about the second case is wrong: the file *does*
declare one. The message has to quote the code so the reader can tell us which
entry is missing.
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import uuid4

import polars as pl
import pytest

from groundmodel.application.import_cpt import ImportCpt
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.shared.exceptions import ParseError


def _result(*, xy_code: int | None, epsg: int | None) -> GEFParseResult:
    """Build a parse result with coordinates but the given CRS identification."""
    return GEFParseResult(
        header=GEFHeader(
            project_id="P",
            test_id="T",
            x=200000.0,
            y=100000.0,
            z=5.0,
            xy_code=xy_code,
            epsg=epsg,
        ),
        cpt_type=CPTType.CPTE,
        data=pl.DataFrame({"depth_m": [0.2], "qc_mpa": [1.0]}),
        issues=[],
    )


class TestUnusableCrsRefusal:
    """Both refusal paths, told apart by what the message names."""

    async def test_unknown_code_refusal_quotes_the_declared_code(self) -> None:
        """An unrecognised ``#XYID`` code is refused with the code quoted."""
        importer = ImportCpt(AsyncMock())
        with pytest.raises(ParseError, match="99999"):
            await importer.persist(_result(xy_code=99999, epsg=None), "bad.gef", uuid4())

    async def test_absent_code_refusal_says_the_code_is_missing(self) -> None:
        """A file with no ``#XYID`` code is refused for a different, named reason."""
        importer = ImportCpt(AsyncMock())
        with pytest.raises(ParseError, match="no coordinate-system code"):
            await importer.persist(_result(xy_code=None, epsg=None), "bad.gef", uuid4())

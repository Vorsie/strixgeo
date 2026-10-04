"""A GEF import is named "<project>-S<number>" like its PDF twin (ruling 2026-10-04).

The owner's words: "GEF imports of the same shape ("23.15-002" + "110")
display the same way", while the stored ids stay exactly as the GEF stores
them (the duplicate rule keys on project id + test id). Pure: the parser and
``persist`` are mocked, no DB, no file I/O.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import polars as pl
import pytest

from groundmodel.application.import_cpt import ImportCpt
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult


def _result(project_id: str, test_id: str) -> GEFParseResult:
    return GEFParseResult(
        header=GEFHeader(project_id=project_id, test_id=test_id),
        cpt_type=CPTType.CPTU,
        data=pl.DataFrame({"depth_m": [0.2], "qc_mpa": [1.0]}),
        issues=[],
    )


async def _name(project_id: str, test_id: str) -> tuple[str, GEFParseResult]:
    imp = ImportCpt(MagicMock())
    result = _result(project_id, test_id)
    imp._parse = MagicMock(return_value=result)  # type: ignore[method-assign]
    imp.persist = AsyncMock()  # type: ignore[method-assign]
    file_path = MagicMock(spec=Path)
    file_path.name = "23.15-002_110.gef"
    file_path.stem = "23.15-002_110"
    file_path.read_bytes = MagicMock(return_value=b"")
    await imp.execute(file_path, uuid4())
    passed_result, name = imp.persist.await_args.args[:2]
    return name, passed_result


@pytest.mark.asyncio
async def test_a_gef_with_a_bare_sounding_number_is_named_project_s_number() -> None:
    """#PROJECTID= CPT, 23.15-002 + #TESTID= 110 -> "23.15-002-S110"; ids unchanged."""
    name, result = await _name("CPT, 23.15-002", "110")
    assert name == "23.15-002-S110"
    assert (result.header.project_id, result.header.test_id) == ("CPT, 23.15-002", "110")


@pytest.mark.asyncio
async def test_a_gef_with_a_named_test_id_keeps_its_name() -> None:
    """A test id that is already a name ("CPT-REFRESH-01") is shown as it is."""
    name, _ = await _name("REFRESH-PROJ", "CPT-REFRESH-01")
    assert name == "CPT-REFRESH-01"

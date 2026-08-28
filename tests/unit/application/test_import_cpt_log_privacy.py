"""An always-on CPT-import log line names no client.

Security contract (owner: "no user data should ever leak"). ``backend.log`` is
not redacted on disk, so a line written at an always-on level (INFO / SUCCESS /
WARNING) must not carry a client-identifying file name or CPT name. The
completion line already carries the stable ``cpt_id``; the human-readable name
belongs at DEBUG. Pure — the session and parser are mocked, no DB, no file I/O.
"""

from __future__ import annotations

import logging
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import polars as pl
import pytest

from groundmodel.application.import_cpt import ImportCpt
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.cpt.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import CptRefreshRefusedError

# A file / CPT name that carries the project code and site.
CLIENT_TOKEN = "SECRETSITE"
CLIENT_NAME = f"GEO-22-115-{CLIENT_TOKEN}-S1"


def _result(rows: list[tuple[float, float]], issues: list[ValidationIssue] | None = None):
    """Build a parse result with the given ``(depth_m, qc_mpa)`` rows."""
    return GEFParseResult(
        header=GEFHeader(),
        cpt_type=CPTType.CPTU,
        data=pl.DataFrame(
            {"depth_m": [r[0] for r in rows], "qc_mpa": [r[1] for r in rows]},
            schema={"depth_m": pl.Float64, "qc_mpa": pl.Float64},
        ),
        issues=issues or [],
    )


def _always_on(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.levelno >= logging.INFO]


def _debug(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.levelno < logging.INFO]


class _StopBeforePersist(Exception):
    """Raised by the mocked parser so ``execute`` returns right after logging."""


@pytest.mark.asyncio
async def test_import_start_line_names_no_file(caplog: pytest.LogCaptureFixture) -> None:
    """The import-start line does not put the file name on an always-on level."""
    imp = ImportCpt(MagicMock())
    file_path = MagicMock(spec=Path)
    file_path.name = f"{CLIENT_NAME}.gef"
    file_path.stem = CLIENT_NAME
    file_path.read_bytes = MagicMock(return_value=b"")
    imp._parse = MagicMock(side_effect=_StopBeforePersist())  # type: ignore[method-assign]

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(_StopBeforePersist):
            await imp.execute(file_path, uuid4())

    assert not any(CLIENT_TOKEN in r.getMessage() for r in _always_on(caplog)), (
        "an always-on log line named the imported file"
    )
    # Not gutted — the file name is still recoverable at DEBUG.
    assert any(CLIENT_TOKEN in r.getMessage() for r in _debug(caplog))


@pytest.mark.asyncio
async def test_refuse_line_names_no_client(caplog: pytest.LogCaptureFixture) -> None:
    """The refresh-refused WARNING (zero rows) does not name the CPT."""
    imp = ImportCpt(MagicMock())

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(CptRefreshRefusedError):
            imp._refuse_unusable_refresh(_result([]), CLIENT_NAME)

    assert not any(CLIENT_TOKEN in r.getMessage() for r in _always_on(caplog)), (
        "the refresh-refused WARNING named the client CPT"
    )


@pytest.mark.asyncio
async def test_refuse_error_line_names_no_client(caplog: pytest.LogCaptureFixture) -> None:
    """The refresh-refused WARNING (parse errors) does not name the CPT."""
    imp = ImportCpt(MagicMock())
    issues = [ValidationIssue(ValidationLevel.ERROR, "DEPTH_NOT_MONOTONIC", "depths go backwards")]

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(CptRefreshRefusedError):
            imp._refuse_unusable_refresh(_result([(0.2, 1.0)], issues), CLIENT_NAME)

    assert not any(CLIENT_TOKEN in r.getMessage() for r in _always_on(caplog)), (
        "the refresh-refused WARNING named the client CPT"
    )
    # The validation code is structural, not client data — it must survive.
    assert any("DEPTH_NOT_MONOTONIC" in r.getMessage() for r in _always_on(caplog))


@pytest.mark.asyncio
async def test_confirmation_line_names_no_client(caplog: pytest.LogCaptureFixture) -> None:
    """The refresh-confirmation INFO carries the stored id, not the CPT name."""
    imp = ImportCpt(MagicMock())
    existing = SimpleNamespace(id=uuid4(), name="stored-name", n_rows=10, max_depth_m=12.0)

    with caplog.at_level(logging.DEBUG):
        imp._confirmation_required(existing, _result([(0.2, 1.0)]), CLIENT_NAME)  # type: ignore[arg-type]

    assert not any(CLIENT_TOKEN in r.getMessage() for r in _always_on(caplog)), (
        "the refresh-confirmation INFO named the client CPT"
    )
    # The stored id is what identifies the record for support.
    assert any(str(existing.id) in r.getMessage() for r in _always_on(caplog))

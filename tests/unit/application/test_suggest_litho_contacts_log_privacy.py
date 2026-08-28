"""An always-on litho-segmenter log line names no client.

Security contract (owner: "no user data should ever leak"). The segmenter logs
the CPT / borehole *name* — an investigation test_id that encodes the project /
site code — on always-on lines. ``backend.log`` is unredacted on disk, so those
names must move to DEBUG and the always-on line must carry the stable id
instead. Pure — the session and the segmentation kernel are stubbed, no DB.
"""

from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from groundmodel.application.suggest_litho_contacts import (
    InvestigationNotFoundError,
    SuggestLithoContacts,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm

# A test_id that encodes the project code and site.
CLIENT_TOKEN = "SECRETSITE"
CLIENT_NAME = f"GEO-22-115-{CLIENT_TOKEN}-S1"


class _StubResult:
    """Stand-in for a SQLAlchemy ``Result`` covering both access styles."""

    def __init__(self, row: Any) -> None:
        self._row = row

    def one_or_none(self) -> Any:
        return self._row

    def scalar_one_or_none(self) -> Any:
        return self._row


class _StubSession:
    """Answers the use case's two SELECTs in order: model kind, then row."""

    def __init__(self, project_id: Any, investigation: Any) -> None:
        self._rows = [
            SimpleNamespace(kind="lithostratigraphic", app_project_id=project_id),
            investigation,
        ]

    async def execute(self, _stmt: Any) -> _StubResult:
        return _StubResult(self._rows.pop(0))


def _always_on(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.levelno >= logging.INFO]


def _debug(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.levelno < logging.INFO]


def _make_cpt() -> CptOrm:
    cpt = CptOrm(
        id=uuid4(),
        name=CLIENT_NAME,
        elevation_m=5.0,
        water_depth_m=None,
        cone_area_ratio=None,
    )
    cpt.series = CptSeriesOrm(
        depths_m=[0.2, 0.4],
        qc_mpa=[1.0, 2.0],
        fs_mpa=[0.05, 0.1],
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
        rf_source=None,
    )
    return cpt


def test_cpt_suggest_success_line_names_no_client(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The CPT-segmenter SUCCESS line carries the CPT id, not its name."""
    monkeypatch.setattr(
        "groundmodel.application.suggest_litho_contacts.segment_cpt",
        lambda **_kwargs: [],
    )
    cpt = _make_cpt()
    use_case = SuggestLithoContacts(_StubSession(uuid4(), cpt))  # type: ignore[arg-type]

    with caplog.at_level(logging.DEBUG):
        asyncio.run(use_case.execute_for_cpt(model_id=uuid4(), cpt_id=cpt.id))

    assert not any(CLIENT_TOKEN in r.getMessage() for r in _always_on(caplog)), (
        "an always-on segmenter line named the client CPT"
    )
    # Not gutted — the name is still recoverable at DEBUG.
    assert any(CLIENT_TOKEN in r.getMessage() for r in _debug(caplog))


def test_borehole_no_layers_warning_names_no_client(caplog: pytest.LogCaptureFixture) -> None:
    """The "no lithology layers" WARNING carries the borehole id, not its name."""
    borehole = BoreholeOrm(id=uuid4(), name=CLIENT_NAME)
    borehole.observations = []
    use_case = SuggestLithoContacts(_StubSession(uuid4(), borehole))  # type: ignore[arg-type]

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(InvestigationNotFoundError):
            asyncio.run(use_case.execute_for_borehole(model_id=uuid4(), borehole_id=borehole.id))

    assert not any(CLIENT_TOKEN in r.getMessage() for r in _always_on(caplog)), (
        "the 'no litho layers' WARNING named the client borehole"
    )

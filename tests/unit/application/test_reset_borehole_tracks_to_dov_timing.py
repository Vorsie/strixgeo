"""Reset to DOV says in its log where its time goes (owner finding 2026-10-04).

"Reset to DOV ... works but takes 5 to 10 seconds." The rule: one INFO line
per reset names every phase - loading the borehole, looking the DOV XML up in
the cache, parsing + rewriting the tracks, flushing - so the next slow click
is diagnosable from the log alone.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any
from uuid import UUID

import pytest
from uuid6 import uuid7

import groundmodel.infrastructure.db.models  # noqa: F401  (configures every mapper)
from groundmodel.application import reset_borehole_tracks_to_dov as use_case_module
from groundmodel.application.reset_borehole_tracks_to_dov import ResetBoreholeTracksToDov
from groundmodel.application.timed_dov_track_source import TimedDovTrackSource
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from tests.unit.application.dov_track_fixtures import (
    BOORNUMMER,
    CODED_PERMKEY,
    full_source,
)


class _FakeSession:
    """Only what the use case touches: an awaitable ``flush``."""

    def __init__(self) -> None:
        """No flush yet."""
        self.flushes = 0

    async def flush(self) -> None:
        """Count the flush."""
        self.flushes += 1


def _borehole() -> BoreholeOrm:
    """A DOV borehole with its coded lithology and no field log."""
    bh_id = uuid7()
    return BoreholeOrm(
        id=bh_id,
        test_id=BOORNUMMER,
        observations=[
            ObservationOrm(
                id=uuid7(),
                borehole_id=bh_id,
                dov_permkey=CODED_PERMKEY,
                observation_type="coded_lithology",
                observation_date=date(2001, 10, 18),
                source="dov",
                layers=[],
            )
        ],
        field_log_intervals=[],
        n_field_log_intervals=0,
    )


def test_the_timed_source_forwards_every_lookup_and_counts_it() -> None:
    """The proxy answers exactly what the cache answers, and tallies the calls."""
    timed = TimedDovTrackSource(full_source())

    assert timed.boring_xml(BOORNUMMER) == full_source().boring_xml(BOORNUMMER)
    assert timed.interpretation_xml(CODED_PERMKEY) is not None
    assert timed.interpretation_xml("1999-000000") is None

    assert (timed.boring_reads, timed.interpretation_reads) == (1, 2)
    assert timed.seconds >= 0.0


@pytest.mark.asyncio
async def test_a_reset_logs_one_info_line_naming_every_phase(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Load, DOV XML lookup, parse + rewrite and flush each carry a duration."""
    borehole = _borehole()

    async def fake_load(session: Any, borehole_id: UUID, project_id: UUID) -> BoreholeOrm:
        return borehole

    monkeypatch.setattr(use_case_module, "load_borehole_with_tracks", fake_load)
    session = _FakeSession()

    with caplog.at_level(logging.INFO):
        outcome = await ResetBoreholeTracksToDov(session, full_source()).execute(  # type: ignore[arg-type]
            project_id=uuid7(), borehole_id=borehole.id
        )

    assert outcome.reset
    assert session.flushes == 1
    timing = [r.getMessage() for r in caplog.records if "reset to DOV timing" in r.getMessage()]
    assert len(timing) == 1, [r.getMessage() for r in caplog.records]
    line = timing[0]
    for phase in ("load ", "DOV XML lookup ", "parse + rewrite ", "flush ", "total "):
        assert phase in line, line
    assert "1 boring + 1 interpretation read(s)" in line

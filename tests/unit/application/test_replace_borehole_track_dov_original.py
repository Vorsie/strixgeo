"""Undo of the first edit clears the "edited by hand" mark (owner dogfeed 2026-10-01).

The owner edited a DOV track, pressed Ctrl+Z: the values came back, the track
still read "Edited by hand". The rule the session main set:

* an undo that restores a track to EXACTLY its DOV content clears
  ``edited_manually_at`` (and the badge);
* an undo (or any save) that leaves a difference keeps it;
* the backend decides; the renderer only shows what the save answers.

"Its DOV content" is what DOV published: the interpretation / boring XML the
bbox import cached (the same XML a Reset to DOV reads). An untouched DOV track
IS that content already, so a save on it compares with the stored rows and
never reads the cache. With no cached XML the original is unknown and the mark
stays (the safe side: never claim DOV published what the engineer typed).

No DB: the borehole is an in-memory ORM tree, the loader is patched, the cache
is a fake.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

import pytest
from uuid6 import uuid7

import groundmodel.application.replace_borehole_track as replace_module
import groundmodel.infrastructure.db.models  # noqa: F401  (configures every mapper)
from groundmodel.application.borehole_track_helpers import build_observation_layers
from groundmodel.application.borehole_track_snapshot import BoreholeTrackSnapshot
from groundmodel.application.dov_track_source import DovTrackSource
from groundmodel.application.replace_borehole_track import ReplaceBoreholeTrack
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.domain.value_objects.track_interval import TrackInterval
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.field_log_interval_orm import FieldLogIntervalOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from tests.unit.application.dov_track_fixtures import (
    BOORNUMMER,
    CODED_PERMKEY,
    EDITED,
    FakeDovSource,
    full_source,
)

PROJECT = uuid7()

# What DOV published for the coded track and the colour log (dov_track_fixtures).
DOV_CODED = [
    TrackInterval(top_m=0.0, base_m=2.0, color="bruingrijs", main_soil_codes=("FZ",)),
    TrackInterval(
        top_m=2.0,
        base_m=4.0,
        color="bruingrijs",
        main_soil_codes=("MZ",),
        admixtures=(Admixture("FG", "N", False),),
    ),
]
DOV_COLOUR = [
    TrackInterval(top_m=0.0, base_m=2.0, value="bruin"),
    TrackInterval(top_m=2.0, base_m=4.0, value="grijs"),
]
HAND_CODED = [TrackInterval(top_m=0.0, base_m=4.0, main_soil_codes=("KL",))]
HAND_COLOUR = [TrackInterval(top_m=0.0, base_m=4.0, value="zwart")]


class _Session:
    """The use case only flushes."""

    async def flush(self) -> None:
        """No DB."""


class _NoCache:
    """A cache the save must not read (an untouched track is its own original)."""

    def boring_xml(self, boornummer: str) -> bytes | None:
        """Fail loudly: the stored rows were enough."""
        raise AssertionError(f"boring XML read for {boornummer}")

    def interpretation_xml(self, permkey: str) -> bytes | None:
        """Fail loudly: the stored rows were enough."""
        raise AssertionError(f"interpretation XML read for {permkey}")


def _borehole(*, edited: bool, source: str = "dov") -> BoreholeOrm:
    """A borehole with a coded track and a colour log, both edited by hand or both untouched."""
    bh_id = uuid7()
    stamp = EDITED if (edited or source == "manual") else None
    coded = ObservationOrm(
        id=uuid7(),
        borehole_id=bh_id,
        dov_permkey=CODED_PERMKEY if source == "dov" else None,
        observation_type="coded_lithology",
        observation_date=date(2001, 10, 18),
        source=source,
        edited_manually_at=stamp,
        layers=build_observation_layers(HAND_CODED if edited else DOV_CODED),
    )
    colour = HAND_COLOUR if edited else DOV_COLOUR
    return BoreholeOrm(
        id=bh_id,
        name=BOORNUMMER,
        test_id=BOORNUMMER,
        app_project_id=PROJECT,
        location_x=150000.0,
        location_y=200000.0,
        total_depth_m=4.0,
        observations=[coded],
        field_log_intervals=[
            FieldLogIntervalOrm(
                id=uuid7(),
                borehole_id=bh_id,
                top_m=i.top_m,
                base_m=i.base_m,
                kind="color",
                value=i.value,
                source=source,
                edited_manually_at=stamp,
            )
            for i in colour
        ],
        n_field_log_intervals=len(colour),
    )


def _loaded(monkeypatch: pytest.MonkeyPatch, borehole: BoreholeOrm) -> None:
    """Make the use case load ``borehole``."""

    async def _load(session: object, borehole_id: UUID, project_id: UUID) -> BoreholeOrm:
        assert borehole_id == borehole.id
        return borehole

    monkeypatch.setattr(replace_module, "load_borehole_with_tracks", _load)


async def _put(
    bh: BoreholeOrm, track_id: str, intervals: list[TrackInterval], source: DovTrackSource
) -> BoreholeTrackSnapshot:
    """Run the PUT use case."""
    use_case = ReplaceBoreholeTrack(_Session(), source=source)  # type: ignore[arg-type]
    return await use_case.execute(
        project_id=PROJECT, borehole_id=bh.id, track_id=track_id, intervals=intervals
    )


async def test_undo_back_to_the_dov_content_clears_the_edited_mark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Edited coded track, Ctrl+Z sends DOV's layers back: no longer edited by hand."""
    bh = _borehole(edited=True)
    _loaded(monkeypatch, bh)
    coded = bh.observations[0]

    snap = await _put(bh, str(coded.id), DOV_CODED, full_source())

    assert snap.edited_manually_at is None
    assert coded.edited_manually_at is None
    assert coded.source == "dov"
    assert coded.dov_permkey == CODED_PERMKEY


async def test_a_save_that_leaves_a_difference_keeps_the_edited_mark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Edited coded track, saved with one boundary moved: still edited by hand."""
    bh = _borehole(edited=True)
    _loaded(monkeypatch, bh)
    coded = bh.observations[0]
    near = [
        TrackInterval(top_m=0.0, base_m=2.5, color="bruingrijs", main_soil_codes=("FZ",)),
        TrackInterval(
            top_m=2.5,
            base_m=4.0,
            color="bruingrijs",
            main_soil_codes=("MZ",),
            admixtures=(Admixture("FG", "N", False),),
        ),
    ]

    snap = await _put(bh, str(coded.id), near, full_source())

    assert snap.edited_manually_at is not None
    assert coded.edited_manually_at is not None


async def test_undo_of_the_field_log_back_to_dov_clears_the_mark_on_every_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Edited colour log, Ctrl+Z sends DOV's two rows back: the track is DOV's again."""
    bh = _borehole(edited=True)
    _loaded(monkeypatch, bh)

    snap = await _put(bh, "field_log:color", DOV_COLOUR, full_source())

    assert snap.edited_manually_at is None
    rows = sorted((r for r in bh.field_log_intervals if r.kind == "color"), key=lambda r: r.top_m)
    assert [(r.value, r.source, r.edited_manually_at) for r in rows] == [
        ("bruin", "dov", None),
        ("grijs", "dov", None),
    ]


async def test_a_field_log_save_that_differs_from_dov_keeps_the_mark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Edited colour log saved as another hand version: still edited."""
    bh = _borehole(edited=True)
    _loaded(monkeypatch, bh)

    snap = await _put(
        bh,
        "field_log:color",
        [TrackInterval(top_m=0.0, base_m=4.0, value="bruin")],
        full_source(),
    )

    assert snap.edited_manually_at is not None


async def test_an_untouched_dov_track_is_its_own_original_and_the_cache_is_not_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Untouched track: an unchanged save stays DOV's, a change is stamped - no cache read."""
    bh = _borehole(edited=False)
    _loaded(monkeypatch, bh)
    coded_id = str(bh.observations[0].id)

    same = await _put(bh, coded_id, DOV_CODED, _NoCache())
    assert same.edited_manually_at is None
    same_log = await _put(bh, "field_log:color", DOV_COLOUR, _NoCache())
    assert same_log.edited_manually_at is None

    changed = await _put(bh, coded_id, HAND_CODED, _NoCache())
    assert changed.edited_manually_at is not None


async def test_without_cached_dov_xml_the_mark_stays(monkeypatch: pytest.MonkeyPatch) -> None:
    """No XML to compare with (XML-file import, wiped cache): never claim it is DOV's."""
    bh = _borehole(edited=True)
    _loaded(monkeypatch, bh)

    snap = await _put(bh, str(bh.observations[0].id), DOV_CODED, FakeDovSource({}, {}))
    assert snap.edited_manually_at is not None
    log = await _put(bh, "field_log:color", DOV_COLOUR, FakeDovSource({}, {}))
    assert log.edited_manually_at is not None


async def test_a_manual_track_is_always_edited_by_hand(monkeypatch: pytest.MonkeyPatch) -> None:
    """A hand-made track has no DOV original: every save stamps it."""
    bh = _borehole(edited=True, source="manual")
    _loaded(monkeypatch, bh)

    snap = await _put(bh, str(bh.observations[0].id), DOV_CODED, _NoCache())
    assert snap.source == "manual"
    assert snap.edited_manually_at is not None
    log = await _put(bh, "field_log:color", DOV_COLOUR, _NoCache())
    assert log.edited_manually_at is not None

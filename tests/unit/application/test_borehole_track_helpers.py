"""Pure helpers of the borehole track use cases: track ids and ORM-row mapping.

One API shape, two ORM families: an observation track is addressed by its UUID,
a field-log track (one per kind per borehole) by ``"field_log:<kind>"``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest
from uuid6 import uuid7

from groundmodel.application.borehole_track_helpers import (
    build_field_log_rows,
    build_observation_layers,
    field_log_snapshot,
    parse_track_id,
    track_family,
)
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.domain.value_objects.track_interval import TrackInterval
from groundmodel.shared.exceptions import NotFoundError


def test_an_observation_track_is_addressed_by_its_uuid() -> None:
    """A UUID string names an observation track."""
    obs_id = uuid7()
    assert parse_track_id(str(obs_id)) == ("observation", obs_id)


def test_a_field_log_track_is_addressed_by_its_kind() -> None:
    """``field_log:color`` names the borehole's colour field log."""
    assert parse_track_id("field_log:color") == ("field_log", "color")


@pytest.mark.parametrize("bad", ["field_log:drill_method", "not-a-uuid", ""])
def test_an_unparseable_track_id_names_no_track(bad: str) -> None:
    """An id that is neither is a miss (404), not a server error."""
    with pytest.raises(NotFoundError):
        parse_track_id(bad)


def test_field_log_kinds_and_observation_kinds_pick_their_family() -> None:
    """colour / moisture / consistency live in field_log_interval; the rest in observation."""
    assert track_family("moisture") == "field_log"
    assert track_family("coded_lithology") == "observation"


def test_observation_layers_are_indexed_in_depth_order_with_admixtures() -> None:
    """The stored layer_index follows the validated (depth) order."""
    layers = build_observation_layers(
        [
            TrackInterval(0.0, 1.0, main_soil_codes=("FZ",)),
            TrackInterval(
                1.0, 2.0, main_soil_codes=("KL",), admixtures=(Admixture("GL", "M", True),)
            ),
        ]
    )
    assert [(la.layer_index, la.main_soil_codes) for la in layers] == [(0, ["FZ"]), (1, ["KL"])]
    assert [(a.soil_code, a.amount, a.locally) for a in layers[1].admixtures] == [("GL", "M", True)]


def test_a_field_log_track_reads_manual_when_any_row_was_typed_by_hand() -> None:
    """The track's provenance is read off its rows; the newest stamp wins."""
    early = datetime(2026, 9, 1, tzinfo=UTC)
    late = datetime(2026, 9, 29, tzinfo=UTC)
    bh = UUID(int=1)
    rows = build_field_log_rows(
        bh, "color", [TrackInterval(1.0, 2.0, value="grijs")], source="manual", edited_at=late
    ) + build_field_log_rows(
        bh, "color", [TrackInterval(0.0, 1.0, value="bruin")], source="dov", edited_at=early
    )
    snap = field_log_snapshot("color", rows)
    assert snap.track_id == "field_log:color"
    assert snap.source == "manual"
    assert snap.edited_manually_at == late
    assert [i.value for i in snap.intervals] == ["bruin", "grijs"]

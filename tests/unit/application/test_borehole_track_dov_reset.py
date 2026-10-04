"""Reset a borehole's tracks to DOV (owner dogfeed 2026-09-30).

The owner, verbatim: "there needs to be a per borehole button to reset to dov
defaults though". The rules the session main set for it:

* the DOV tracks are replaced by a FRESH parse of the DOV XML the import
  cached - observations in place (same track id), field logs wholesale;
* manual tracks (``source = "manual"``) are KEPT;
* the "edited by hand" mark is cleared on every reset track;
* one track can be reset on its own;
* when the cache holds no XML for the borehole the reset is refused and
  NOTHING changes (``borehole_reset_no_dov_source``).

No DB: the borehole is an in-memory ORM tree, the cache a fake.
"""

from __future__ import annotations

from datetime import date

import pytest
from uuid6 import uuid7

import groundmodel.infrastructure.db.models  # noqa: F401  (configures every mapper)
from groundmodel.application.borehole_track_dov_reset import reset_tracks_from_dov
from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.field_log_interval_orm import FieldLogIntervalOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.shared.exceptions import BoreholeResetNoDovSourceError
from tests.unit.application.dov_track_fixtures import (
    BOORNUMMER,
    BORING_XML,
    CODED_PERMKEY,
    EDITED,
    FakeDovSource,
)
from tests.unit.application.dov_track_fixtures import full_source as _full_source


def _layer(top: float, base: float, code: str, index: int) -> ObservationLayerOrm:
    """A stored coded layer."""
    return ObservationLayerOrm(
        id=uuid7(),
        top_m=top,
        base_m=base,
        main_soil_codes=[code],
        layer_index=index,
        admixtures=[],
    )


def _borehole() -> BoreholeOrm:
    """A DOV borehole the engineer has worked on.

    * its DOV coded lithology was EDITED by hand (one KL layer 0-4);
    * a MANUAL description track he typed;
    * its DOV colour log was EDITED (one row 'zwart');
    * a MANUAL consistency log.
    """
    bh_id = uuid7()
    coded = ObservationOrm(
        id=uuid7(),
        borehole_id=bh_id,
        dov_permkey=CODED_PERMKEY,
        observation_type="coded_lithology",
        observation_date=date(2001, 10, 18),
        source="dov",
        edited_manually_at=EDITED,
        layers=[_layer(0.0, 4.0, "KL", 0)],
    )
    manual = ObservationOrm(
        id=uuid7(),
        borehole_id=bh_id,
        dov_permkey=None,
        observation_type="lithological_description",
        observation_date=date(2026, 9, 29),
        source="manual",
        edited_manually_at=EDITED,
        layers=[
            ObservationLayerOrm(
                id=uuid7(),
                top_m=0.0,
                base_m=4.0,
                description="grijs zand",
                layer_index=0,
                main_soil_codes=[],
                admixtures=[],
            )
        ],
    )
    return BoreholeOrm(
        id=bh_id,
        name=BOORNUMMER,
        test_id=BOORNUMMER,
        location_x=150000.0,
        location_y=200000.0,
        total_depth_m=4.0,
        observations=[coded, manual],
        field_log_intervals=[
            FieldLogIntervalOrm(
                id=uuid7(),
                borehole_id=bh_id,
                top_m=0.0,
                base_m=4.0,
                kind="color",
                value="zwart",
                source="dov",
                edited_manually_at=EDITED,
            ),
            FieldLogIntervalOrm(
                id=uuid7(),
                borehole_id=bh_id,
                top_m=0.0,
                base_m=4.0,
                kind="consistency",
                value="vast",
                source="manual",
                edited_manually_at=EDITED,
            ),
        ],
        n_field_log_intervals=2,
    )


def _obs(bh: BoreholeOrm, kind: str) -> ObservationOrm:
    """The borehole's observation of ``kind``."""
    return next(o for o in bh.observations if o.observation_type == kind)


def _field_log(bh: BoreholeOrm, kind: str) -> list[tuple[float, float, str, str, object]]:
    """(top, base, value, source, edited) of the ``kind`` rows, depth-ordered."""
    return sorted(
        (r.top_m, r.base_m, r.value, r.source, r.edited_manually_at)
        for r in bh.field_log_intervals
        if r.kind == kind
    )


def test_reset_to_dov_puts_the_dov_interpretation_back_on_an_edited_track_in_place() -> None:
    """The edited coded lithology gets DOV's layers back, keeps its id, loses its edit mark."""
    bh = _borehole()
    coded_id = _obs(bh, "coded_lithology").id

    reset_tracks_from_dov(bh, _full_source())

    coded = _obs(bh, "coded_lithology")
    assert coded.id == coded_id
    assert coded.dov_permkey == CODED_PERMKEY
    assert coded.edited_manually_at is None
    assert [(la.top_m, la.base_m, la.main_soil_codes) for la in coded.layers] == [
        (0.0, 2.0, ["FZ"]),
        (2.0, 4.0, ["MZ"]),
    ]
    admixtures: list[AdmixtureOrm] = coded.layers[1].admixtures
    assert [(a.soil_code, a.amount, a.locally) for a in admixtures] == [("FG", "N", False)]


def test_reset_to_dov_keeps_the_manual_tracks_untouched() -> None:
    """Manual tracks (source = manual) are KEPT: the description and the consistency log."""
    bh = _borehole()
    manual_id = _obs(bh, "lithological_description").id

    reset_tracks_from_dov(bh, _full_source())

    manual = _obs(bh, "lithological_description")
    assert manual.id == manual_id
    assert manual.edited_manually_at == EDITED
    assert [la.description for la in manual.layers] == ["grijs zand"]
    assert _field_log(bh, "consistency") == [(0.0, 4.0, "vast", "manual", EDITED)]


def test_reset_to_dov_replaces_the_dov_field_logs_wholesale_from_the_boring() -> None:
    """Field logs come back as DOV published them: the colour rows, and the moisture log too."""
    bh = _borehole()

    reset_tracks_from_dov(bh, _full_source())

    assert _field_log(bh, "color") == [
        (0.0, 2.0, "bruin", "dov", None),
        (2.0, 4.0, "grijs", "dov", None),
    ]
    assert _field_log(bh, "moisture") == [(0.0, 4.0, "vochtig", "dov", None)]
    assert bh.n_field_log_intervals == len(bh.field_log_intervals) == 4


def test_the_outcome_names_how_many_hand_edited_tracks_lost_their_edits() -> None:
    """Two DOV tracks carried hand edits (coded lithology + colour): both are discarded."""
    outcome = reset_tracks_from_dov(_borehole(), _full_source())
    assert outcome.discarded_edits == 2
    assert outcome.kept_manual == 2
    assert sorted(s.track_id for s in outcome.reset if s.family == "field_log") == [
        "field_log:color",
        "field_log:moisture",
    ]


def test_with_no_dov_xml_in_the_cache_the_reset_is_refused_and_nothing_changes() -> None:
    """An XML-file import or a wiped cache: borehole_reset_no_dov_source, the edits stay."""
    bh = _borehole()

    with pytest.raises(BoreholeResetNoDovSourceError):
        reset_tracks_from_dov(bh, FakeDovSource({}, {}))

    assert [la.main_soil_codes for la in _obs(bh, "coded_lithology").layers] == [["KL"]]
    assert _obs(bh, "coded_lithology").edited_manually_at == EDITED
    assert _field_log(bh, "color") == [(0.0, 4.0, "zwart", "dov", EDITED)]


def test_a_partly_cached_borehole_is_refused_whole_rather_than_half_reset() -> None:
    """The boring is cached but the interpretation is not: refuse, change nothing."""
    bh = _borehole()

    with pytest.raises(BoreholeResetNoDovSourceError):
        reset_tracks_from_dov(bh, FakeDovSource({BOORNUMMER: BORING_XML}, {}))

    assert _field_log(bh, "color") == [(0.0, 4.0, "zwart", "dov", EDITED)]


def test_one_track_can_be_reset_on_its_own() -> None:
    """Reset of the colour log alone: the edited coded lithology keeps its edits."""
    bh = _borehole()

    outcome = reset_tracks_from_dov(bh, _full_source(), track_id="field_log:color")

    assert [s.track_id for s in outcome.reset] == ["field_log:color"]
    assert outcome.discarded_edits == 1
    assert _field_log(bh, "color")[0][2] == "bruin"
    assert _field_log(bh, "moisture") == []
    assert _obs(bh, "coded_lithology").edited_manually_at == EDITED


def test_a_manual_track_has_no_dov_source_to_reset_to() -> None:
    """Reset on a hand-made track is refused: there is no DOV data behind it."""
    bh = _borehole()
    manual_id = str(_obs(bh, "lithological_description").id)

    with pytest.raises(BoreholeResetNoDovSourceError):
        reset_tracks_from_dov(bh, _full_source(), track_id=manual_id)

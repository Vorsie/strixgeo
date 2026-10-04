"""A DOV bbox re-import never touches the tracks of a borehole the user holds.

Owner dogfeed of the track editor (2026-10-01): "a deleted or edited DOV track
comes back unchanged on a DOV bbox re-import". The rule the session main set,
mirroring the CPT refresh contract (an overwrite of the user's data is never
automatic):

* a borehole already in the project (same 'DOV' + test_id) is skipped as
  today, and its tracks are NEVER touched;
* a track the user EDITED keeps its edits (the stored interpretation is not
  re-inserted nor overwritten);
* a track the user DELETED stays deleted (its DOV permkey is remembered on the
  borehole, and the re-import does not treat the missing permkey as new);
* an interpretation DOV published since (a permkey never seen) is still
  attached - refresh-on-duplicate keeps filling in what is genuinely new.

No DB: the session, the DOV client and the dedup queries are mocked; the
delete use case runs on an in-memory ORM tree.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
from uuid6 import uuid7

import groundmodel.application.delete_borehole_track as delete_module
import groundmodel.infrastructure.db.models  # noqa: F401  (configures every mapper)
from groundmodel.application.borehole_track_helpers import build_observation_layers
from groundmodel.application.delete_borehole_track import DeleteBoreholeTrack
from groundmodel.application.dov_interpretation_dedup import interpretation_dedup_verdict
from groundmodel.application.dov_interpretation_verdict import DovInterpretationVerdict
from groundmodel.application.import_interpretations_dov import ImportInterpretationsDov
from groundmodel.domain.models.borehole.observation import Observation
from groundmodel.domain.models.borehole.observation_layer import ObservationLayer
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.domain.value_objects.track_interval import TrackInterval
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.field_log_interval_orm import FieldLogIntervalOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.parsers.borehole.dov.interpretation_parse_result import (
    InterpretationParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.interpretation_wfs_row import (
    InterpretationWfsRow,
)

EDITED_PERMKEY = "2001-000001"
DELETED_PERMKEY = "2001-000002"
NEW_PERMKEY = "2026-000003"

_MODULE = "groundmodel.application.import_interpretations_dov"


# --- the dedup decision -----------------------------------------------------


def test_a_permkey_never_seen_is_attached() -> None:
    """DOV published a new interpretation since the first import: attach it."""
    verdict = interpretation_dedup_verdict(
        NEW_PERMKEY, stored={EDITED_PERMKEY}, deleted_by_user={DELETED_PERMKEY}
    )
    assert verdict is DovInterpretationVerdict.ATTACH


def test_a_stored_permkey_is_left_alone_so_its_edits_stay() -> None:
    """The user's (possibly edited) track holds that permkey: skip, never overwrite."""
    verdict = interpretation_dedup_verdict(
        EDITED_PERMKEY, stored={EDITED_PERMKEY}, deleted_by_user=set()
    )
    assert verdict is DovInterpretationVerdict.ALREADY_PRESENT


def test_a_permkey_the_user_deleted_is_not_new() -> None:
    """Missing from the borehole because the user deleted it: it stays deleted."""
    verdict = interpretation_dedup_verdict(
        DELETED_PERMKEY, stored={EDITED_PERMKEY}, deleted_by_user={DELETED_PERMKEY}
    )
    assert verdict is DovInterpretationVerdict.DELETED_BY_USER


# --- the re-import ------------------------------------------------------------


def _wfs_row(permkey: str) -> InterpretationWfsRow:
    """A coded-lithology WFS row of borehole BH-1."""
    return InterpretationWfsRow(
        permkey=permkey,
        test_id="BH-1",
        observation_type=ObservationType.CODED_LITHOLOGY,
        fiche_url=f"https://www.dov.vlaanderen.be/data/interpretatie/{permkey}",
        xml_url=f"https://www.dov.vlaanderen.be/xdov/proxy/export/interpretatie/{permkey}",
    )


def _parsed(borehole_id: UUID) -> InterpretationParseResult:
    """One parsed interpretation with a single layer."""
    obs = Observation(borehole_id=borehole_id, observation_type=ObservationType.CODED_LITHOLOGY)
    obs.layers = [
        ObservationLayer(
            observation_id=obs.id,
            top_m=0.0,
            base_m=2.0,
            color=None,
            main_soil_codes=["FZ"],
            description=None,
            layer_index=0,
        )
    ]
    return InterpretationParseResult(observation=obs, issues=[])


async def test_a_reimport_attaches_only_what_the_user_never_held() -> None:
    """Edited track stays, deleted track stays deleted, a new DOV interpretation is attached."""
    bh = uuid4()
    session = MagicMock()
    added: list[ObservationOrm] = []
    session.add = MagicMock(side_effect=added.append)
    parsed = [(_wfs_row(p), _parsed(bh)) for p in (EDITED_PERMKEY, DELETED_PERMKEY, NEW_PERMKEY)]

    with (
        patch(
            f"{_MODULE}.DovInterpretationClient.fetch_bbox_processed",
            new=AsyncMock(return_value=parsed),
        ),
        patch(f"{_MODULE}.existing_dov_permkeys", new=AsyncMock(return_value={EDITED_PERMKEY})),
        patch(f"{_MODULE}.deleted_dov_permkeys", new=AsyncMock(return_value={DELETED_PERMKEY})),
    ):
        result = await ImportInterpretationsDov(session).execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            test_id_to_borehole_id={"BH-1": bh},
            cache=MagicMock(),
            http=MagicMock(),
        )

    assert [orm.dov_permkey for orm in added] == [NEW_PERMKEY]
    assert result.attached == 1
    assert result.skipped_already_present == 1
    assert result.skipped_deleted_by_user == 1


# --- deleting a track remembers its DOV permkey ----------------------------------


class _Session:
    """The use case only flushes."""

    async def flush(self) -> None:
        """No DB."""


def _borehole() -> BoreholeOrm:
    """A DOV borehole: a DOV coded track, a manual description, a colour log."""
    bh_id = uuid7()
    layers = [TrackInterval(top_m=0.0, base_m=2.0, main_soil_codes=("FZ",))]
    dov_track = ObservationOrm(
        id=uuid7(),
        borehole_id=bh_id,
        dov_permkey=DELETED_PERMKEY,
        observation_type="coded_lithology",
        observation_date=date(2001, 1, 1),
        source="dov",
        layers=build_observation_layers(layers),
    )
    manual_track = ObservationOrm(
        id=uuid7(),
        borehole_id=bh_id,
        dov_permkey=None,
        observation_type="lithological_description",
        observation_date=date(2026, 10, 1),
        source="manual",
        layers=build_observation_layers([TrackInterval(top_m=0.0, base_m=2.0, description="zand")]),
    )
    return BoreholeOrm(
        id=bh_id,
        name="BH-1",
        test_id="BH-1",
        location_x=150000.0,
        location_y=200000.0,
        observations=[dov_track, manual_track],
        field_log_intervals=[
            FieldLogIntervalOrm(
                id=uuid7(), borehole_id=bh_id, top_m=0.0, base_m=2.0, kind="color", value="bruin"
            )
        ],
        deleted_dov_permkeys=[],
    )


async def _delete(monkeypatch: pytest.MonkeyPatch, bh: BoreholeOrm, track_id: str) -> None:
    """Run the delete use case on ``bh``."""

    async def _load(session: object, borehole_id: UUID, project_id: UUID) -> BoreholeOrm:
        return bh

    monkeypatch.setattr(delete_module, "load_borehole_with_tracks", _load)
    await DeleteBoreholeTrack(_Session()).execute(  # type: ignore[arg-type]
        project_id=uuid7(), borehole_id=bh.id, track_id=track_id
    )


async def test_deleting_a_dov_track_remembers_its_permkey_on_the_borehole(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The deleted DOV interpretation is recorded so a re-import cannot bring it back."""
    bh = _borehole()
    await _delete(monkeypatch, bh, str(bh.observations[0].id))
    assert bh.deleted_dov_permkeys == [DELETED_PERMKEY]


async def test_a_permkey_is_remembered_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """A permkey already remembered is not listed twice."""
    bh = _borehole()
    bh.deleted_dov_permkeys = [DELETED_PERMKEY]
    await _delete(monkeypatch, bh, str(bh.observations[0].id))
    assert bh.deleted_dov_permkeys == [DELETED_PERMKEY]


async def test_deleting_a_manual_track_or_a_field_log_remembers_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No DOV permkey behind them: nothing to remember."""
    bh = _borehole()
    await _delete(monkeypatch, bh, str(bh.observations[1].id))
    await _delete(monkeypatch, bh, "field_log:color")
    assert bh.deleted_dov_permkeys == []

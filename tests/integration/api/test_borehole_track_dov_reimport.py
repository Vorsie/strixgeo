"""A DOV bbox re-import leaves the user's tracks as the user left them.

Owner dogfeed of the track editor (2026-10-01): "a deleted or edited DOV track
comes back unchanged on a DOV bbox re-import". The rule the session main set,
mirroring the CPT refresh contract (an overwrite of the user's data is never
automatic): a borehole already in the project (project 'DOV' + test_id) is
skipped, and its tracks are never touched - a track the user deleted stays
deleted, a track the user edited keeps its edits. An interpretation DOV
published since (a permkey the borehole never held) is still attached.

Real DB, real routes for the edit and the delete, the real interpretation
import over the real dedup queries; only the DOV network fetch is replaced by
the parsed interpretations DOV would answer.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.import_interpretations_dov import ImportInterpretationsDov
from groundmodel.domain.models.borehole.observation import Observation
from groundmodel.domain.models.borehole.observation_layer import ObservationLayer
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_bundle import (
    build_project_bundle,
)
from groundmodel.infrastructure.parsers.borehole.dov.interpretation_parse_result import (
    InterpretationParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.interpretation_wfs_row import (
    InterpretationWfsRow,
)

TEST_ID = "kb1d1w-B7"
CODED_PERMKEY = "1990-000701"
STRAT_PERMKEY = "1990-000702"
NEW_PERMKEY = "2026-000703"


@pytest_asyncio.fixture
async def held_borehole(db_session: AsyncSession) -> dict:
    """A project holding one DOV borehole with two DOV tracks (coded lithology + strat)."""
    project = ProjectOrm(id=uuid7(), name="Re-import", status="active")
    db_session.add(project)
    await db_session.flush()
    borehole = BoreholeOrm(
        id=uuid7(),
        name=TEST_ID,
        app_project_id=project.id,
        project_id="DOV",
        test_id=TEST_ID,
        location_x=150_000.0,
        location_y=200_000.0,
        epsg=31370,
        total_depth_m=5.0,
    )
    coded = ObservationOrm(
        id=uuid7(),
        observation_type="coded_lithology",
        dov_permkey=CODED_PERMKEY,
        observation_date=date(1990, 5, 1),
        layers=[
            ObservationLayerOrm(
                id=uuid7(), top_m=0.0, base_m=5.0, layer_index=0, main_soil_codes=["FZ"]
            )
        ],
    )
    strat = ObservationOrm(
        id=uuid7(),
        observation_type="formal_stratigraphy",
        dov_permkey=STRAT_PERMKEY,
        observation_date=date(1990, 5, 1),
        layers=[
            ObservationLayerOrm(
                id=uuid7(),
                top_m=0.0,
                base_m=5.0,
                layer_index=0,
                main_soil_codes=[],
                description="Q",
            )
        ],
    )
    borehole.observations = [coded, strat]
    db_session.add(borehole)
    await db_session.commit()
    return {"project": project, "borehole": borehole, "coded": coded.id, "strat": strat.id}


def _dov_answer(
    borehole_id, permkeys: tuple[str, ...]
) -> list[tuple[InterpretationWfsRow, InterpretationParseResult]]:
    """What the DOV WFS + XML download would answer for the borehole's interpretations."""
    kinds = {
        CODED_PERMKEY: ObservationType.CODED_LITHOLOGY,
        STRAT_PERMKEY: ObservationType.FORMAL_STRATIGRAPHY,
        NEW_PERMKEY: ObservationType.LITHOLOGICAL_DESCRIPTION,
    }
    answer = []
    for permkey in permkeys:
        kind = kinds[permkey]
        obs = Observation(borehole_id=borehole_id, observation_type=kind)
        obs.layers = [
            ObservationLayer(
                observation_id=obs.id,
                top_m=0.0,
                base_m=5.0,
                color=None,
                main_soil_codes=["FZ"] if kind is ObservationType.CODED_LITHOLOGY else [],
                description=None if kind is ObservationType.CODED_LITHOLOGY else "Q",
                layer_index=0,
            )
        ]
        row = InterpretationWfsRow(
            permkey=permkey,
            test_id=TEST_ID,
            observation_type=kind,
            fiche_url=f"https://www.dov.vlaanderen.be/data/interpretatie/{permkey}",
            xml_url=f"https://www.dov.vlaanderen.be/xdov/proxy/export/interpretatie/{permkey}",
        )
        answer.append((row, InterpretationParseResult(observation=obs, issues=[])))
    return answer


async def _reimport(db_session: AsyncSession, borehole_id) -> object:
    """Run the interpretation phase of a DOV bbox re-import and commit, as the import does."""
    answer = _dov_answer(borehole_id, (CODED_PERMKEY, STRAT_PERMKEY, NEW_PERMKEY))
    with patch(
        "groundmodel.application.import_interpretations_dov."
        "DovInterpretationClient.fetch_bbox_processed",
        new=AsyncMock(return_value=answer),
    ):
        result = await ImportInterpretationsDov(db_session).execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            test_id_to_borehole_id={TEST_ID: borehole_id},
            cache=MagicMock(),
            http=MagicMock(),
        )
    await db_session.commit()
    return result


async def _detail(client: AsyncClient, scene: dict) -> dict:
    """GET the borehole detail the desktop reads."""
    resp = await client.get(
        f"/borehole/{scene['borehole'].id}?project_id={scene['project'].id}&include="
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_a_reimport_keeps_the_edited_track_and_the_deleted_track_deleted(
    async_client: AsyncClient, held_borehole: dict, db_session: AsyncSession
) -> None:
    """Edit the coded track, delete the strat track, re-import the bbox: both unchanged."""
    scene = held_borehole
    base = f"/borehole/{scene['borehole'].id}/tracks"
    query = f"?project_id={scene['project'].id}"
    edit = await async_client.put(
        f"{base}/{scene['coded']}{query}",
        json={"intervals": [{"top_m": 0.0, "base_m": 5.0, "main_soil_codes": ["KL"]}]},
    )
    assert edit.status_code == 200, edit.text
    gone = await async_client.delete(f"{base}/{scene['strat']}{query}")
    assert gone.status_code == 204, gone.text

    db_session.expunge_all()
    result = await _reimport(db_session, scene["borehole"].id)

    assert result.skipped_already_present == 1  # the edited coded track
    assert result.skipped_deleted_by_user == 1  # the deleted strat track
    assert result.attached == 1  # only what DOV published since

    detail = await _detail(async_client, scene)
    by_permkey = {o["dov_permkey"]: o for o in detail["observations"]}
    assert set(by_permkey) == {CODED_PERMKEY, NEW_PERMKEY}
    coded = by_permkey[CODED_PERMKEY]
    assert coded["id"] == str(scene["coded"])
    assert coded["edited_manually_at"] is not None
    assert [la["main_soil_codes"] for la in coded["layers"]] == [["KL"]]


async def test_the_deleted_permkey_is_remembered_and_rides_the_bundle(
    async_client: AsyncClient, held_borehole: dict, db_session: AsyncSession
) -> None:
    """The delete records the permkey on the borehole; a saved bundle carries it."""
    scene = held_borehole
    gone = await async_client.delete(
        f"/borehole/{scene['borehole'].id}/tracks/{scene['strat']}?project_id={scene['project'].id}"
    )
    assert gone.status_code == 204, gone.text

    db_session.expunge_all()
    stored = await db_session.get(BoreholeOrm, scene["borehole"].id)
    assert stored is not None
    assert stored.deleted_dov_permkeys == [STRAT_PERMKEY]

    project = await db_session.get(ProjectOrm, scene["project"].id)
    assert project is not None
    bundle = await build_project_bundle(db_session, project)
    (bh_payload,) = bundle["boreholes"]
    assert bh_payload["deleted_dov_permkeys"] == [STRAT_PERMKEY]

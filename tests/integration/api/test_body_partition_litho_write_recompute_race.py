"""BP-2 — a plain litho-layer write and a bodies/recompute must not collide.

The per-model body-partition advisory lock (``lock_body_partition``) serialises
every writer that *rewrites the body partition* — correlate, accept-correlations,
band edits, subdivide, the startup sweep, and ``bodies/recompute`` — so any two of
them queue instead of racing (pinned by BP-1). But the lock is a cooperative
mutex: it only serialises the transactions that TAKE it. A writer that touches
``litho_layer`` ROWS without rewriting body identity — ``MoveLithoLayerBoundary``
(UPDATE of ``depth_top_m`` / ``depth_base_m`` on two accepted rows),
``UpdateLithoLayer``, ``BulkCreateLithoLayers``, and the accept-litho-suggestions
path — does NOT take the lock, because by the lock's own contract it is not a
body-partition rewrite (it leaves ``body_id`` alone; the frontend fires a
debounced ``bodies/recompute`` afterwards to restamp identity).

Those writers still lock the SAME accepted ``litho_layer`` tuples that
``bodies/recompute`` re-stamps ``body_id`` on inside ``_run_resolver`` — a plain
UPDATE takes a row lock on the whole tuple regardless of which column it changes.
Two transactions holding overlapping tuples and reaching for one the other holds
deadlock, and the advisory lock cannot prevent it because the litho-row writer
never takes it. This is the class the owner's note names: *"flow_bulk_accept hit a
PostgreSQL deadlock on POST .../bodies/recompute ... a user double-press could hit
it"* — an engineer's litho edit (or the bulk-accept path) landing while the app's
own debounced recompute for the same model is in flight.

BP-2 fires ``PATCH .../layers/boundary-move`` (the cleanest, simplest member of
the class: it UPDATEs two EXISTING accepted rows that recompute also re-stamps) in
parallel with ``POST .../bodies/recompute`` for many rounds and fails on any 5xx
or escaped exception. It stands in for the whole non-lock-taking litho-row-writer
set — they share the missing-lock property, and this one is fixtureable without
the segmenter.

Expected outcome closes the note either way:

* GREEN over the rounds → the race does not manifest in practice (the temporal
  overlap is narrow: a boundary move touches two tuples, recompute many, and they
  must grab the shared pair in opposite orders). The note is then STALE and the
  cure needs no extension.
* RED (a 5xx / ``DeadlockDetectedError`` on either arm) → the hole is real. The
  minimal fix is to take the model's partition lock at the top of
  ``MoveLithoLayerBoundary.execute`` (and the sibling non-lock-taking litho-row
  writers) BEFORE the first UPDATE — one lock, on the litho model, so it adds no
  new lock-order class (see ``body_partition_lock``: single-lock holders cannot
  deadlock on the lock itself) and serialises the write against recompute.

Run via ``scripts\\run-integration-tests.ps1`` ONLY.
"""

from __future__ import annotations

import asyncio
import random
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# Enough columns that the recompute's component set really churns between rounds
# (mirrors BP-1's reasoning: with too few, the two transactions almost always
# agree and the race window never opens).
BP2_COLUMNS = 12

# Rounds of (recompute ‖ boundary-move). BP-1 saw its first pre-fix failure within
# the first handful; 20 rounds is ~2 s of wall clock.
BP2_ROUNDS = 20

# The two adjacent accepted layers on each anchor: SAND on top, CLAY below,
# sharing a boundary at ``_SHARED_BOUNDARY_M``. The boundary move oscillates
# between two depths that always leave both layers well above the min-thickness
# floor, so a move is only ever 200 (applied) or, on the race, a 5xx we catch.
_COLUMN_TOP_M = 2.0
_SHARED_BOUNDARY_M = 5.0
_COLUMN_BASE_M = 8.0
_MOVE_DEPTHS_M = (4.5, 5.5)


class _Scene:
    """Ids the two-layer-per-anchor scene exposes to BP-2."""

    def __init__(
        self,
        project_id: UUID,
        model_id: UUID,
        sand_formation_id: UUID,
        clay_formation_id: UUID,
        upper_layer_ids: list[UUID],
        lower_layer_ids: list[UUID],
        investigation_ids: list[UUID],
        section_id: UUID,
    ) -> None:
        self.project_id = project_id
        self.model_id = model_id
        self.sand_formation_id = sand_formation_id
        self.clay_formation_id = clay_formation_id
        self.upper_layer_ids = upper_layer_ids
        self.lower_layer_ids = lower_layer_ids
        self.investigation_ids = investigation_ids
        self.section_id = section_id


@pytest_asyncio.fixture
async def bp2_scene(db_session: AsyncSession) -> _Scene:
    """``BP2_COLUMNS`` boreholes, each with a SAND-over-CLAY adjacent accepted pair."""
    project = ProjectOrm(id=uuid7(), name="BP2 litho-write race project", status="active")
    db_session.add(project)
    await db_session.flush()

    geo = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="BP2-Geo", kind="geological"
    )
    db_session.add(geo)
    await db_session.flush()
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="BP2-Litho",
        kind="lithostratigraphic",
        parent_model_id=geo.id,
    )
    sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND-BP2",
        color="#e0c068",
        display_order=0,
        litho_main_soil_code="ZAND",
        instance_ordinal=0,
    )
    clay = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="KLEI-BP2",
        color="#8a6d3b",
        display_order=1,
        litho_main_soil_code="KLEI",
        instance_ordinal=0,
    )
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="BP2-Section",
        start_x=160_000.0,
        start_y=200_000.0,
        end_x=160_000.0 + 25.0 * BP2_COLUMNS,
        end_y=200_000.0,
        epsg=31370,
        projection_buffer_m=60.0,
    )
    db_session.add_all([model, sand, clay, section])
    await db_session.flush()

    upper_layer_ids: list[UUID] = []
    lower_layer_ids: list[UUID] = []
    investigation_ids: list[UUID] = []
    for i in range(BP2_COLUMNS):
        borehole = BoreholeOrm(
            id=uuid7(),
            name=f"BH-BP2-{i}",
            app_project_id=project.id,
            project_id="BP2",
            test_id=f"BH-BP2-{i}",
            location_x=160_000.0 + i * 25.0,
            location_y=200_000.0,
            epsg=31370,
            total_depth_m=20.0,
        )
        db_session.add(borehole)
        await db_session.flush()
        upper = LithoLayerOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=sand.id,
            borehole_id=borehole.id,
            depth_top_m=_COLUMN_TOP_M,
            depth_base_m=_SHARED_BOUNDARY_M,
            status="accepted",
            source="manual",
            confidence="medium",
        )
        lower = LithoLayerOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=clay.id,
            borehole_id=borehole.id,
            depth_top_m=_SHARED_BOUNDARY_M,
            depth_base_m=_COLUMN_BASE_M,
            status="accepted",
            source="manual",
            confidence="medium",
        )
        db_session.add_all([upper, lower])
        upper_layer_ids.append(upper.id)
        lower_layer_ids.append(lower.id)
        investigation_ids.append(borehole.id)

    project_id, model_id, sand_id, clay_id, section_id = (
        project.id,
        model.id,
        sand.id,
        clay.id,
        section.id,
    )
    await db_session.commit()
    # Stamp body_id once so the model starts coherent (mirrors BP-1).
    await ResolveLithoInstances(db_session).execute(model_id=model_id)

    return _Scene(
        project_id=project_id,
        model_id=model_id,
        sand_formation_id=sand_id,
        clay_formation_id=clay_id,
        upper_layer_ids=upper_layer_ids,
        lower_layer_ids=lower_layer_ids,
        investigation_ids=investigation_ids,
        section_id=section_id,
    )


def _recompute_payload(scene: _Scene, group_size: int) -> dict:
    """One section carrying every layer, with the first ``group_size`` SAND rows unioned.

    Varying ``group_size`` between rounds makes the recompute merge and split
    components, so the resolver churns ``body`` rows and re-stamps ``body_id`` —
    the write that has to overlap the concurrent boundary move for the race to
    open. ``section_ids`` names the project's one section so the P1-3 coverage
    guard passes and the request reaches the lock (see BP-1's note on that guard).
    """
    # One region per layer (SAND then CLAY per anchor), each carrying its own id.
    regions: list[dict] = []
    for i, (up_id, lo_id) in enumerate(zip(scene.upper_layer_ids, scene.lower_layer_ids)):
        regions.append(
            {
                "formation_id": str(scene.sand_formation_id),
                "body_id": None,
                "polygon": [
                    [float(i), 0.0],
                    [float(i) + 0.9, 0.0],
                    [float(i) + 0.9, -2.0],
                    [float(i), -2.0],
                ],
                "gap_index": i,
                "kind": "quad",
                "layer_ids": [str(up_id)],
            }
        )
        regions.append(
            {
                "formation_id": str(scene.clay_formation_id),
                "body_id": None,
                "polygon": [
                    [float(i), -2.0],
                    [float(i) + 0.9, -2.0],
                    [float(i) + 0.9, -4.0],
                    [float(i), -4.0],
                ],
                "gap_index": i,
                "kind": "quad",
                "layer_ids": [str(lo_id)],
            }
        )
    group = [str(layer_id) for layer_id in scene.upper_layer_ids[:group_size]]
    return {
        "section_ids": [str(scene.section_id)],
        "sections": [
            {
                "start_x": 160_000.0,
                "start_y": 200_000.0,
                "end_x": 160_000.0 + 25.0 * BP2_COLUMNS,
                "end_y": 200_000.0,
                "columns": [
                    {
                        "investigation_id": str(inv_id),
                        "along_m": 25.0 * i,
                        "world_x": 160_000.0 + i * 25.0,
                        "world_y": 200_000.0,
                    }
                    for i, inv_id in enumerate(scene.investigation_ids)
                ],
                "regions": regions,
            }
        ],
        "layer_groups": [[group] if len(group) > 1 else []],
    }


@pytest.mark.asyncio
async def test_bp2_a_boundary_move_and_a_recompute_never_500_on_the_same_model(
    bp2_scene: _Scene,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """BP-2 — a litho boundary move and a bodies/recompute run at once without a 5xx.

    ``MoveLithoLayerBoundary`` UPDATEs two accepted ``litho_layer`` rows and takes
    NO body-partition lock; ``bodies/recompute`` re-stamps ``body_id`` on those
    same rows under the lock. Because the boundary move never takes the lock, the
    two are not serialised and can deadlock on the shared tuples. A gesture the
    engineer makes while the app's own background recompute is running must either
    apply or be refused for a reason the engineer can act on — never die on a race
    between two of the app's own writes.
    """
    boundary_move_url = (
        f"/projects/{bp2_scene.project_id}/geology/models/{bp2_scene.model_id}/layers/boundary-move"
    )
    recompute_url = (
        f"/projects/{bp2_scene.project_id}/geology/models/{bp2_scene.model_id}/bodies/recompute"
    )

    rng = random.Random(2026)
    server_errors: list[str] = []

    def _check(label: str, outcome: Response | BaseException) -> None:
        """Record anything that is not an answer the engineer could act on.

        ``ASGITransport`` re-raises an exception that escapes a route instead of
        rendering the 500 uvicorn would send, so both shapes count as the same
        failure: the request died on a race rather than being answered. A 422
        (an invariant the move genuinely violates) is an actionable answer and is
        NOT counted — the regression is a 5xx / an escaped exception.
        """
        if isinstance(outcome, BaseException):
            server_errors.append(f"{label} raised {type(outcome).__name__}: {str(outcome)[:400]}")
        elif outcome.status_code >= 500:
            server_errors.append(f"{label} → {outcome.status_code}: {outcome.text[:400]}")

    for round_index in range(BP2_ROUNDS):
        group_size = rng.randint(0, BP2_COLUMNS)
        # A DIFFERENT anchor each round so the moved tuples and the recompute's
        # re-stamp set overlap on a shifting pair, not the same one every time.
        anchor_index = rng.randrange(BP2_COLUMNS)
        # Oscillate the shared boundary between two always-valid depths.
        new_depth_m = _MOVE_DEPTHS_M[round_index % 2]
        move_body = {
            "upper_layer_id": str(bp2_scene.upper_layer_ids[anchor_index]),
            "lower_layer_id": str(bp2_scene.lower_layer_ids[anchor_index]),
            "new_depth_m": new_depth_m,
        }

        recompute_outcome, move_outcome = await asyncio.gather(
            async_client.post(recompute_url, json=_recompute_payload(bp2_scene, group_size)),
            async_client.patch(boundary_move_url, json=move_body),
            return_exceptions=True,
        )
        _check("bodies/recompute", recompute_outcome)
        _check("layers/boundary-move", move_outcome)

    assert not server_errors, (
        "BP-2 FAIL: a litho boundary move and a bodies/recompute on the same model "
        f"produced {len(server_errors)} server error(s) — a litho-row writer that "
        "skips the body-partition lock raced recompute's body_id re-stamp:\n"
        + "\n".join(server_errors[:5])
    )

    # The model is still coherent afterwards: every accepted layer carries a body.
    db_session.expire_all()
    unstamped = (
        (
            await db_session.execute(
                select(LithoLayerOrm.id).where(
                    LithoLayerOrm.model_id == bp2_scene.model_id,
                    LithoLayerOrm.status == "accepted",
                    LithoLayerOrm.body_id.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    assert not unstamped, (
        f"BP-2 FAIL: {len(unstamped)} accepted layer(s) left with no body_id after "
        "the concurrent rounds"
    )

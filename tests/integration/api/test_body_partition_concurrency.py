"""BP — a correlate click and a background bodies/recompute must not collide.

Owner dogfeed 2026-08-15: ``POST .../contact-correlations`` answered
``net::ERR_FAILED 500`` (surfaced in the renderer console as a missing
``Access-Control-Allow-Origin`` header) while the debounced
``POST .../bodies/recompute`` for the SAME model was in flight; the identical
click 6 seconds later created the edge. Both endpoints end in ``_run_resolver``,
which reads a model's layers/edges/facts and then rewrites one ``body`` row per
connected component — a read-then-rewrite that was unguarded across requests.

Running the two concurrently against the integration database reproduced three
different unhandled 500s, in a single 24-round run of the pre-fix code:

* ``UniqueViolationError`` on ``uq_litho_lens_model_formation_ordinal``
* ``ForeignKeyViolationError`` on ``fk_litho_layer_body_id``
* ``DeadlockDetectedError`` on ``DELETE FROM body``

BP-1 fires both verbs concurrently over HTTP for many rounds and fails on any
5xx. It goes RED on the pre-fix code (drop the ``lock_body_partition`` call in
``_run_resolver``) and GREEN with the per-model body-partition lock in place.

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

# Enough columns that the resolver's component set really churns between
# rounds — with two bodies the two transactions almost always agree and the
# race never opens. Twelve reproduced all three signatures pre-fix.
BP_COLUMNS = 12

# Rounds of (recompute ‖ correlate). Pre-fix, the first failure landed within
# the first handful; 20 rounds is ~2 s of wall clock and left no pre-fix run
# clean across the seeds tried during the investigation.
BP_ROUNDS = 20


class _Scene:
    """Ids the wide single-formation scene exposes to BP-1."""

    def __init__(
        self,
        project_id: UUID,
        model_id: UUID,
        formation_id: UUID,
        layer_ids: list[UUID],
        investigation_ids: list[UUID],
        section_id: UUID,
    ) -> None:
        self.project_id = project_id
        self.model_id = model_id
        self.formation_id = formation_id
        self.layer_ids = layer_ids
        self.investigation_ids = investigation_ids
        self.section_id = section_id


@pytest_asyncio.fixture
async def bp_scene(db_session: AsyncSession) -> _Scene:
    """``BP_COLUMNS`` uncorrelated SAND layers on as many boreholes → as many bodies."""
    project = ProjectOrm(id=uuid7(), name="BP concurrency project", status="active")
    db_session.add(project)
    await db_session.flush()

    geo = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="BP-Geo", kind="geological"
    )
    db_session.add(geo)
    await db_session.flush()
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="BP-Litho",
        kind="lithostratigraphic",
        parent_model_id=geo.id,
    )
    sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND-BP",
        color="#e0c068",
        display_order=0,
        litho_main_soil_code="ZAND",
        instance_ordinal=0,
    )
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="BP-Section",
        start_x=160_000.0,
        start_y=200_000.0,
        end_x=160_000.0 + 25.0 * BP_COLUMNS,
        end_y=200_000.0,
        epsg=31370,
        projection_buffer_m=60.0,
    )
    db_session.add_all([model, sand, section])
    await db_session.flush()

    layer_ids: list[UUID] = []
    investigation_ids: list[UUID] = []
    for i in range(BP_COLUMNS):
        borehole = BoreholeOrm(
            id=uuid7(),
            name=f"BH-BP-{i}",
            app_project_id=project.id,
            project_id="BP",
            test_id=f"BH-BP-{i}",
            location_x=160_000.0 + i * 25.0,
            location_y=200_000.0,
            epsg=31370,
            total_depth_m=20.0,
        )
        db_session.add(borehole)
        await db_session.flush()
        layer = LithoLayerOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=sand.id,
            borehole_id=borehole.id,
            depth_top_m=2.0,
            depth_base_m=8.0,
            status="accepted",
            source="manual",
            confidence="medium",
        )
        db_session.add(layer)
        layer_ids.append(layer.id)
        investigation_ids.append(borehole.id)

    project_id, model_id, formation_id, section_id = (
        project.id,
        model.id,
        sand.id,
        section.id,
    )
    await db_session.commit()
    await ResolveLithoInstances(db_session).execute(model_id=model_id)

    return _Scene(
        project_id=project_id,
        model_id=model_id,
        formation_id=formation_id,
        layer_ids=layer_ids,
        investigation_ids=investigation_ids,
        section_id=section_id,
    )


def _recompute_payload(scene: _Scene, group_size: int) -> dict:
    """One section carrying every layer, with the first ``group_size`` unioned.

    Varying ``group_size`` between rounds makes the recompute merge and split
    components, which is what makes the two transactions disagree about the
    body key set — the condition the race needs.

    Must carry ``section_ids`` parallel to ``sections``: the coverage guard
    (``_ids_parallel_to_sections`` + ``IncompleteRecomputeCoverageError``,
    audit P1-3, added 2026-08-18 — three days AFTER this test) 422s a recompute
    request whose ``section_ids`` do not name every section BEFORE the use case
    takes the body-partition lock. Without this field the recompute arm of BP-1
    died at request validation every round, so BP-1 stopped actually racing two
    writers through ``_run_resolver`` and became a correlate-only smoke test that
    stayed green even with the lock removed from recompute. Naming the one
    section restores the race the test exists to pin.
    """
    regions = [
        {
            "formation_id": str(scene.formation_id),
            "body_id": None,
            "polygon": [
                [float(i), 0.0],
                [float(i) + 0.9, 0.0],
                [float(i) + 0.9, -2.0],
                [float(i), -2.0],
            ],
            "gap_index": i,
            "kind": "quad",
            "layer_ids": [str(layer_id)],
        }
        for i, layer_id in enumerate(scene.layer_ids)
    ]
    group = [str(layer_id) for layer_id in scene.layer_ids[:group_size]]
    return {
        # Parallel to ``sections`` (one entry) and equal to the project's only
        # section, so the P1-3 coverage guard passes and the request reaches the
        # lock + resolver instead of 422-ing at validation.
        "section_ids": [str(scene.section_id)],
        "sections": [
            {
                "start_x": 160_000.0,
                "start_y": 200_000.0,
                "end_x": 160_000.0 + 25.0 * BP_COLUMNS,
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
async def test_bp1_a_correlate_and_a_recompute_never_500_on_the_same_model(
    bp_scene: _Scene,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """BP-1 — the two verbs run at once on one model without a server error.

    Owner dogfeed (verbatim shape): ``POST …/contact-correlations
    net::ERR_FAILED 500`` reported as *"No 'Access-Control-Allow-Origin'
    header"*, immediately after a concurrent ``POST …/bodies/recompute`` for the
    same model; *"the identical click 6 seconds later succeeded"*. A gesture the
    engineer makes while the app's own background recompute is running must
    either apply or be refused for a reason — never fail on a race between two
    of the app's own writes.
    """
    correlate_url = (
        f"/projects/{bp_scene.project_id}/geology/models/{bp_scene.model_id}/contact-correlations"
    )
    recompute_url = (
        f"/projects/{bp_scene.project_id}/geology/models/{bp_scene.model_id}/bodies/recompute"
    )

    rng = random.Random(2026)
    server_errors: list[str] = []

    def _check(label: str, outcome: Response | BaseException) -> None:
        """Record anything that is not an answer the engineer could act on.

        ``ASGITransport`` re-raises an exception that escapes a route instead of
        rendering the 500 uvicorn would send, so both shapes count as the same
        failure: the request died on a race rather than being answered.
        """
        if isinstance(outcome, BaseException):
            server_errors.append(f"{label} raised {type(outcome).__name__}: {str(outcome)[:400]}")
        elif outcome.status_code >= 500:
            server_errors.append(f"{label} → {outcome.status_code}: {outcome.text[:400]}")

    for _ in range(BP_ROUNDS):
        group_size = rng.randint(0, BP_COLUMNS)
        # A DIFFERENT adjacent pair each round: two requests inserting the SAME
        # edge is a separate check-then-act race on the edge's own unique key,
        # not the body-partition race this test pins.
        pair_index = rng.randrange(BP_COLUMNS - 1)
        correlate_body = {
            "layer_a_id": str(bp_scene.layer_ids[pair_index]),
            "layer_b_id": str(bp_scene.layer_ids[pair_index + 1]),
            "request_section_id": str(bp_scene.section_id),
        }

        recompute_outcome, correlate_outcome = await asyncio.gather(
            async_client.post(recompute_url, json=_recompute_payload(bp_scene, group_size)),
            async_client.post(correlate_url, json=correlate_body),
            return_exceptions=True,
        )
        _check("bodies/recompute", recompute_outcome)
        _check("contact-correlations", correlate_outcome)

    assert not server_errors, (
        "BP-1 FAIL: a correlate and a bodies/recompute on the same model produced "
        f"{len(server_errors)} server error(s) — the engineer's gesture died on a "
        "race between two of the app's own writes:\n" + "\n".join(server_errors[:5])
    )

    # The model is still coherent afterwards: every accepted layer carries a body.
    db_session.expire_all()
    unstamped = (
        (
            await db_session.execute(
                select(LithoLayerOrm.id).where(
                    LithoLayerOrm.model_id == bp_scene.model_id,
                    LithoLayerOrm.status == "accepted",
                    LithoLayerOrm.body_id.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    assert not unstamped, (
        f"BP-1 FAIL: {len(unstamped)} accepted layer(s) left with no body_id after "
        "the concurrent rounds"
    )

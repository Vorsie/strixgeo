"""BP-3 — a litho recompute and a geotech recompute on parent and child never deadlock.

The per-model body-partition advisory lock (``lock_body_partition``) serialises
every writer that rewrites ONE model's body partition (pinned by BP-1/BP-2). Its
docstring also mandates the MULTI-MODEL order for a transaction that legitimately
holds two locks: **lock the LITHO PARENT first, then the GEOTECH CHILD**. A litho
``bodies/recompute`` does hold both — it re-mints the litho body rows, then at
``_run_resolver`` step 6 re-stamps every sibling geotech model's
``body.parent_litho_body_id``, so it takes the geotech child's lock too.

The flaw this test pins: the litho resolver took the geotech child's lock at step
6 — AFTER it had already deleted/re-minted litho ``body`` rows. Deleting a litho
body fires the ``ON DELETE SET NULL`` action of the geotech rows'
``parent_litho_body_id`` foreign key (``body_orm.py``), a hidden WRITE that
row-locks the geotech ``body`` rows *before* the litho transaction requests the
geotech advisory lock. A concurrent geotech ``bodies/recompute`` holds that
advisory lock and is deleting those same geotech rows → an ABBA deadlock across
the two models:

* Process A (geotech recompute) holds the GEOTECH advisory lock and runs
  ``DELETE FROM body WHERE body.id = $geotech_body`` — waiting for the row lock
  the litho transaction holds.
* Process B (litho recompute, ``operation="restamp-parent-litho-body"``) holds
  the geotech row locks (via the FK ``SET NULL`` cascade) and waits for the
  GEOTECH advisory lock A holds.

Observed live: tonight's e2e backend log, eight victims in eleven minutes — a
real user-facing race, not a flake (the app fires debounced ``bodies/recompute``
for a litho model and its geotech child independently).

BP-3 fires ``POST .../models/<litho>/bodies/recompute`` in parallel with
``POST .../models/<geotech>/bodies/recompute`` for many rounds and fails on any
5xx or escaped exception (``ASGITransport`` re-raises an exception that escapes a
route). It goes RED on the pre-fix code — a ``DeadlockDetectedError`` 500 on one
of the arms — and GREEN once the litho resolver takes each sibling geotech lock
UP FRONT (right after its own lock, before any write), so the child lock is never
taken after a write that reaches the child through the FK action.

Run via ``scripts\\run-integration-tests.ps1`` ONLY — a bare
``pytest tests/integration`` TRUNCATEs whatever ``DATABASE_URL`` points at.
"""

from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# Enough columns that BOTH resolvers' component sets really churn between rounds —
# with too few, the two transactions almost always agree and neither deletes a
# body, so the FK ``SET NULL`` cascade never fires and the race window never opens
# (mirrors BP-1/BP-2's twelve).
BP3_COLUMNS = 12

# Rounds of (litho recompute ‖ geotech recompute). BP-1/BP-2 hit their first
# pre-fix failure within the first handful; 20 rounds is ~2 s of wall clock.
BP3_ROUNDS = 20

# Every borehole carries one accepted litho band [TOP, BASE) covered by one
# accepted geotech band over the same interval — a single band per column so the
# deferred litho-contiguity constraint (gap-free column) is trivially satisfied.
_COLUMN_TOP_M = 0.0
_COLUMN_BASE_M = 8.0

# The geotech band's packing class — any real NAD class; all bands share it so a
# union of connected bands fuses into one geotech body (churn).
_GEOTECH_NAD_CLASS = 19


@dataclass
class _Scene:
    """Ids the litho-parent / geotech-child two-model scene exposes to BP-3."""

    project_id: UUID
    section_id: UUID
    litho_model_id: UUID
    geotech_model_id: UUID
    litho_formation_id: UUID
    geotech_formation_id: UUID
    litho_layer_ids: list[UUID]
    geotech_band_ids: list[UUID]
    investigation_ids: list[UUID]


@pytest_asyncio.fixture
async def bp3_scene(db_session: AsyncSession) -> _Scene:
    """A litho model + its geotech child, each with ``BP3_COLUMNS`` bodies.

    Every borehole gets one accepted litho band and one accepted geotech band
    over the same interval, the geotech band's ``parent_litho_layer_id`` pointing
    at the litho band on the same borehole. After the two seed resolves, each
    geotech body carries ``parent_litho_body_id`` pointing at the covering litho
    body — the FK whose ``ON DELETE SET NULL`` cascade is the hidden child write
    at the heart of the race.
    """
    project = ProjectOrm(id=uuid7(), name="BP3 litho/geotech lock-order project", status="active")
    db_session.add(project)
    await db_session.flush()

    geo = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="BP3-Geo", kind="geological"
    )
    db_session.add(geo)
    await db_session.flush()
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="BP3-Litho",
        kind="lithostratigraphic",
        parent_model_id=geo.id,
    )
    db_session.add(litho)
    await db_session.flush()
    geotech = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="BP3-Geotech",
        kind="geotechnical",
        parent_model_id=litho.id,
    )
    litho_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND-BP3-litho",
        color="#e0c068",
        display_order=0,
        litho_main_soil_code="ZAND",
        instance_ordinal=0,
    )
    geotech_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND-BP3-geotech",
        color="#e0c068",
        display_order=1,
        litho_main_soil_code="ZAND",
        instance_ordinal=0,
        nad_class=_GEOTECH_NAD_CLASS,
    )
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="BP3-Section",
        start_x=160_000.0,
        start_y=200_000.0,
        end_x=160_000.0 + 25.0 * BP3_COLUMNS,
        end_y=200_000.0,
        epsg=31370,
        projection_buffer_m=60.0,
    )
    db_session.add_all([geotech, litho_sand, geotech_sand, section])
    await db_session.flush()

    litho_layer_ids: list[UUID] = []
    geotech_band_ids: list[UUID] = []
    investigation_ids: list[UUID] = []
    for i in range(BP3_COLUMNS):
        borehole = BoreholeOrm(
            id=uuid7(),
            name=f"BH-BP3-{i}",
            app_project_id=project.id,
            project_id="BP3",
            test_id=f"BH-BP3-{i}",
            location_x=160_000.0 + i * 25.0,
            location_y=200_000.0,
            epsg=31370,
            total_depth_m=20.0,
        )
        db_session.add(borehole)
        await db_session.flush()
        litho_band = LithoLayerOrm(
            id=uuid7(),
            model_id=litho.id,
            formation_id=litho_sand.id,
            borehole_id=borehole.id,
            depth_top_m=_COLUMN_TOP_M,
            depth_base_m=_COLUMN_BASE_M,
            status="accepted",
            source="manual",
            confidence="medium",
        )
        db_session.add(litho_band)
        await db_session.flush()
        geotech_band = LithoLayerOrm(
            id=uuid7(),
            model_id=geotech.id,
            formation_id=geotech_sand.id,
            borehole_id=borehole.id,
            depth_top_m=_COLUMN_TOP_M,
            depth_base_m=_COLUMN_BASE_M,
            status="accepted",
            source="segmenter",
            confidence="medium",
            # The covering litho band — the link the geotech body's
            # parent_litho_body_id is derived from (step 5b).
            parent_litho_layer_id=litho_band.id,
        )
        db_session.add(geotech_band)
        litho_layer_ids.append(litho_band.id)
        geotech_band_ids.append(geotech_band.id)
        investigation_ids.append(borehole.id)

    project_id = project.id
    section_id = section.id
    litho_model_id, geotech_model_id = litho.id, geotech.id
    litho_formation_id, geotech_formation_id = litho_sand.id, geotech_sand.id
    await db_session.commit()

    # Seed both models coherent: the litho resolve stamps litho body ids FIRST,
    # then the geotech resolve stamps each geotech body's parent_litho_body_id
    # from its covering litho band's now-known body (step 5b). The order matters —
    # a geotech resolve before the litho resolve would read NULL litho bodies.
    await ResolveLithoInstances(db_session).execute(model_id=litho_model_id)
    await ResolveLithoInstances(db_session).execute(model_id=geotech_model_id)

    return _Scene(
        project_id=project_id,
        section_id=section_id,
        litho_model_id=litho_model_id,
        geotech_model_id=geotech_model_id,
        litho_formation_id=litho_formation_id,
        geotech_formation_id=geotech_formation_id,
        litho_layer_ids=litho_layer_ids,
        geotech_band_ids=geotech_band_ids,
        investigation_ids=investigation_ids,
    )


def _recompute_payload(
    scene: _Scene, *, layer_ids: list[UUID], formation_id: UUID, group_size: int
) -> dict:
    """One section carrying every ``layer_ids`` region, first ``group_size`` unioned.

    Varying ``group_size`` between rounds makes the recompute merge and split
    components, so the resolver churns ``body`` rows — the deletes that (a) fire
    the litho→geotech FK cascade on the litho arm and (b) delete geotech ``body``
    rows on the geotech arm. ``section_ids`` names the project's one section so
    the P1-3 coverage guard passes and the request reaches the lock + resolver.
    """
    regions = [
        {
            "formation_id": str(formation_id),
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
        for i, layer_id in enumerate(layer_ids)
    ]
    group = [str(layer_id) for layer_id in layer_ids[:group_size]]
    return {
        "section_ids": [str(scene.section_id)],
        "sections": [
            {
                "start_x": 160_000.0,
                "start_y": 200_000.0,
                "end_x": 160_000.0 + 25.0 * BP3_COLUMNS,
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
async def test_bp3_a_litho_recompute_and_a_geotech_recompute_never_deadlock(
    bp3_scene: _Scene,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """BP-3 — recomputing the litho parent and its geotech child at once never 500s.

    A litho ``bodies/recompute`` deletes/re-mints litho ``body`` rows; deleting a
    litho body fires the ``ON DELETE SET NULL`` of every covering geotech body's
    ``parent_litho_body_id`` FK, row-locking those geotech rows BEFORE the litho
    transaction reaches step 6 and requests the geotech advisory lock. A geotech
    ``bodies/recompute`` running at the same time holds that advisory lock and is
    deleting those same geotech rows → an ABBA deadlock between the two models.
    The app fires both recomputes independently (debounced), so this must never
    surface to the engineer as a failed request.
    """
    litho_url = (
        f"/projects/{bp3_scene.project_id}/geology/"
        f"models/{bp3_scene.litho_model_id}/bodies/recompute"
    )
    geotech_url = (
        f"/projects/{bp3_scene.project_id}/geology/"
        f"models/{bp3_scene.geotech_model_id}/bodies/recompute"
    )

    rng = random.Random(2026)
    server_errors: list[str] = []

    def _check(label: str, outcome: Response | BaseException) -> None:
        """Record anything that is not an answer the engineer could act on.

        ``ASGITransport`` re-raises an exception that escapes a route instead of
        rendering the 500 uvicorn would send, so both shapes count as the same
        failure: the request died on the cross-model deadlock rather than being
        answered. A 422 (empty / incomplete-coverage payload) is an actionable
        answer and is NOT counted — the regression is a 5xx / an escaped
        exception carrying ``DeadlockDetectedError``.
        """
        if isinstance(outcome, BaseException):
            server_errors.append(f"{label} raised {type(outcome).__name__}: {str(outcome)[:400]}")
        elif outcome.status_code >= 500:
            server_errors.append(f"{label} → {outcome.status_code}: {outcome.text[:400]}")

    for _ in range(BP3_ROUNDS):
        litho_group = rng.randint(0, BP3_COLUMNS)
        geotech_group = rng.randint(0, BP3_COLUMNS)

        litho_outcome, geotech_outcome = await asyncio.gather(
            async_client.post(
                litho_url,
                json=_recompute_payload(
                    bp3_scene,
                    layer_ids=bp3_scene.litho_layer_ids,
                    formation_id=bp3_scene.litho_formation_id,
                    group_size=litho_group,
                ),
            ),
            async_client.post(
                geotech_url,
                json=_recompute_payload(
                    bp3_scene,
                    layer_ids=bp3_scene.geotech_band_ids,
                    formation_id=bp3_scene.geotech_formation_id,
                    group_size=geotech_group,
                ),
            ),
            return_exceptions=True,
        )
        _check("litho bodies/recompute", litho_outcome)
        _check("geotech bodies/recompute", geotech_outcome)

    assert not server_errors, (
        "BP-3 FAIL: a litho recompute and a geotech recompute on parent and child "
        f"produced {len(server_errors)} server error(s) — the litho resolver took "
        "the geotech child's partition lock AFTER a delete that reached the child "
        "through the parent_litho_body_id FK cascade, so the two models deadlocked:\n"
        + "\n".join(server_errors[:5])
    )

    # Both models are still coherent afterwards: every accepted band carries a body.
    db_session.expire_all()
    unstamped = (
        (
            await db_session.execute(
                select(LithoLayerOrm.id).where(
                    LithoLayerOrm.model_id.in_(
                        [bp3_scene.litho_model_id, bp3_scene.geotech_model_id]
                    ),
                    LithoLayerOrm.status == "accepted",
                    LithoLayerOrm.body_id.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    assert not unstamped, (
        f"BP-3 FAIL: {len(unstamped)} accepted band(s) left with no body_id after "
        "the concurrent rounds"
    )

    # And every geotech body's litho parent still resolves (no dangling FK the
    # cascade set NULL and never restamped).
    geotech_bodies_without_parent = (
        (
            await db_session.execute(
                select(BodyOrm.id).where(
                    BodyOrm.model_id == bp3_scene.geotech_model_id,
                    BodyOrm.parent_litho_body_id.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    assert not geotech_bodies_without_parent, (
        f"BP-3 FAIL: {len(geotech_bodies_without_parent)} geotech body(ies) left with a "
        "NULL parent_litho_body_id after the concurrent rounds — a litho re-mint "
        "orphaned the child link instead of re-stamping it"
    )


@pytest.mark.asyncio
async def test_bp3_a_clear_litho_and_a_geotech_recompute_never_deadlock(
    bp3_scene: _Scene,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """A litho-model clear and a geotech recompute at once never 500.

    ``clear_litho_model`` (``DELETE .../contacts``) bulk-deletes the litho model's
    ``body`` rows; each delete fires the ``ON DELETE SET NULL`` of the geotech
    rows' ``parent_litho_body_id`` FK (and, via the litho_layer cascade, the
    geotech bands' ``parent_litho_layer_id``), row-locking the geotech child rows.
    A concurrent geotech ``bodies/recompute`` deletes/re-mints those same geotech
    rows. Like the resolver (BP-3), clear must take the geotech child's partition
    lock BEFORE that delete, or the two cross-model transactions can deadlock.

    SINGLE-SHOT arm: the first clear empties the litho model, so a second round
    would race an empty delete — one clear ‖ one recompute is the whole race, so
    this arm is a lower-probability reproducer than the many-round arms.
    """
    clear_url = (
        f"/projects/{bp3_scene.project_id}/geology/models/{bp3_scene.litho_model_id}/contacts"
    )
    geotech_url = (
        f"/projects/{bp3_scene.project_id}/geology/"
        f"models/{bp3_scene.geotech_model_id}/bodies/recompute"
    )

    server_errors: list[str] = []

    def _check(label: str, outcome: Response | BaseException) -> None:
        """Record a 5xx / escaped exception (the deadlock shape); tolerate 2xx/4xx."""
        if isinstance(outcome, BaseException):
            server_errors.append(f"{label} raised {type(outcome).__name__}: {str(outcome)[:400]}")
        elif outcome.status_code >= 500:
            server_errors.append(f"{label} → {outcome.status_code}: {outcome.text[:400]}")

    clear_outcome, geotech_outcome = await asyncio.gather(
        async_client.delete(clear_url),
        async_client.post(
            geotech_url,
            json=_recompute_payload(
                bp3_scene,
                layer_ids=bp3_scene.geotech_band_ids,
                formation_id=bp3_scene.geotech_formation_id,
                group_size=BP3_COLUMNS // 2,
            ),
        ),
        return_exceptions=True,
    )
    _check("clear-litho", clear_outcome)
    _check("geotech bodies/recompute", geotech_outcome)

    assert not server_errors, (
        "BP-3 FAIL: a clear-litho and a geotech recompute produced "
        f"{len(server_errors)} server error(s) — clear deleted litho bodies (the "
        "SET NULL cascade onto the geotech child rows) without holding the geotech "
        "child's partition lock, racing the concurrent geotech recompute:\n"
        + "\n".join(server_errors[:5])
    )


@pytest.mark.asyncio
async def test_bp3_a_delete_body_and_a_geotech_recompute_never_deadlock(
    bp3_scene: _Scene,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """Deleting litho bodies while a geotech recompute runs never 500.

    ``delete_body`` (``DELETE .../bodies/{id}``) removes one litho ``body`` row;
    deleting it fires the ``ON DELETE SET NULL`` of the geotech rows'
    ``parent_litho_body_id`` FK, row-locking the covering geotech ``body`` rows. A
    concurrent geotech ``bodies/recompute`` deletes/re-mints those same rows. Each
    round deletes a DIFFERENT litho body in parallel with a churning geotech
    recompute; ``delete_body`` must take the geotech child's partition lock BEFORE
    its delete or the two cross-model transactions can deadlock.
    """
    db_session.expire_all()
    litho_body_ids = (
        (
            await db_session.execute(
                select(BodyOrm.id)
                .where(BodyOrm.model_id == bp3_scene.litho_model_id)
                .order_by(BodyOrm.id)
            )
        )
        .scalars()
        .all()
    )
    assert litho_body_ids, "the scene must start with litho bodies to delete"

    geotech_url = (
        f"/projects/{bp3_scene.project_id}/geology/"
        f"models/{bp3_scene.geotech_model_id}/bodies/recompute"
    )
    rng = random.Random(2026)
    server_errors: list[str] = []

    def _check(label: str, outcome: Response | BaseException) -> None:
        """Record a 5xx / escaped exception; tolerate 204 (deleted) and 404 (already gone)."""
        if isinstance(outcome, BaseException):
            server_errors.append(f"{label} raised {type(outcome).__name__}: {str(outcome)[:400]}")
        elif outcome.status_code >= 500:
            server_errors.append(f"{label} → {outcome.status_code}: {outcome.text[:400]}")

    for body_id in litho_body_ids:
        delete_url = (
            f"/projects/{bp3_scene.project_id}/geology/"
            f"models/{bp3_scene.litho_model_id}/bodies/{body_id}"
        )
        geotech_group = rng.randint(0, BP3_COLUMNS)
        delete_outcome, geotech_outcome = await asyncio.gather(
            async_client.delete(delete_url),
            async_client.post(
                geotech_url,
                json=_recompute_payload(
                    bp3_scene,
                    layer_ids=bp3_scene.geotech_band_ids,
                    formation_id=bp3_scene.geotech_formation_id,
                    group_size=geotech_group,
                ),
            ),
            return_exceptions=True,
        )
        _check("delete-body", delete_outcome)
        _check("geotech bodies/recompute", geotech_outcome)

    assert not server_errors, (
        "BP-3 FAIL: a delete-body and a geotech recompute produced "
        f"{len(server_errors)} server error(s) — delete_body deleted a litho body "
        "(the SET NULL cascade onto the geotech child rows) without holding the "
        "geotech child's partition lock, racing the concurrent geotech recompute:\n"
        + "\n".join(server_errors[:5])
    )

"""Integration test: concurrent SaveBodyBoundary must serialise, never interleave.

Reproduces debt TEST-05 — the ``SaveBodyBoundary`` use case takes a Postgres
advisory lock (``pg_advisory_xact_lock(hashtext('{model_id}:{body_id}'))`` in
``application/body_boundary.py``) but had no contention test proving the lock
actually does its job.

What the lock protects
----------------------
``SaveBodyBoundary.execute`` is a full-replace: it SELECTs the existing shape,
DELETEs its nodes, then INSERTs the new node set — a read-modify-write over the
``body_boundary_node`` rows keyed by the shape.  The frontend body-shape editor
fires PUTs ~1 ms apart while the user drags nodes.  Without the lock, two
concurrent transactions can both pass the "shape exists" SELECT, both DELETE the
existing nodes, then both INSERT — and the two INSERT sets interleave / collide
on the ``(shape_id, boundary, node_index)`` unique constraint, so the second
commit dies (or, worse, a mixed set of nodes from *both* submissions survives).

Behavioural invariant these tests pin
-------------------------------------
* **A concurrent save must never interleave two submissions.**  Whichever
  writer commits last wins in full; the persisted boundary equals ONE of the
  two submissions node-for-node, never a mix of both.
* Both submissions must complete — no deadlock, no timeout, no leaked
  unique-constraint 500.
* The lock is per-body: saves to two *different* bodies must proceed
  concurrently without blocking each other (the key includes the body id).
"""

from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from uuid6 import uuid7

from groundmodel.application.body_boundary import BoundaryNode, SaveBodyBoundary
from groundmodel.infrastructure.db.models.body_boundary_node_orm import BodyBoundaryNodeOrm
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.shared.config import settings
from tests.integration.conftest import make_project

# ---------------------------------------------------------------------------
# Fixture helpers — the minimal row chain a body + its boundary shape need.
# body → formation → model → project, plus a section for primary_section_id.
# body / body_boundary_shape / body_boundary_node are not in the conftest
# TRUNCATE list directly, but they CASCADE from project / geological_model /
# geological_formation, all of which the fixture truncates.
# ---------------------------------------------------------------------------


async def _seed_body(
    db_session: AsyncSession,
    *,
    project_id: UUID,
    model_id: UUID,
    formation_id: UUID,
    section_id: UUID,
    body_ordinal: int,
) -> UUID:
    """Insert one body row (no boundary shape yet) and return its id.

    Parameters
    ----------
    db_session : AsyncSession
        Active session used only for the setup writes.
    project_id, model_id, formation_id, section_id : UUID
        The scope chain the body hangs from. ``section_id`` becomes the
        body's ``primary_section_id`` so the section-local boundary nodes
        have an anchor (SaveBodyBoundary raises otherwise).
    body_ordinal : int
        Distinguishes two bodies in the same formation (unique constraint
        is ``(model_id, formation_id, body_ordinal)``).

    Returns
    -------
    UUID
        The new body's id.
    """
    body = BodyOrm(
        id=uuid7(),
        app_project_id=project_id,
        model_id=model_id,
        formation_id=formation_id,
        body_ordinal=body_ordinal,
        source_investigation_id=uuid7(),  # polymorphic UUID, no FK
        primary_section_id=section_id,
    )
    db_session.add(body)
    await db_session.commit()
    return body.id


async def _seed_scope(
    db_session: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID]:
    """Build project + litho model + formation + section; commit and return ids.

    Returns
    -------
    tuple[UUID, UUID, UUID, UUID]
        ``(project_id, model_id, formation_id, section_id)``.
    """
    project = await make_project(db_session)

    # A litho model requires a geological parent
    # (ck_geological_model_kind_parent_null).
    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo parent",
        kind="geological",
    )
    db_session.add(geo_model)
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho model",
        kind="lithostratigraphic",
        parent_model_id=geo_model.id,
    )
    db_session.add(model)

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Sand body",
        color="#c8a030",
    )
    db_session.add(formation)
    await db_session.commit()

    section = await CrossSectionRepository(db_session).create(
        project.id,
        name="Body section",
        start_x=0.0,
        start_y=0.0,
        end_x=200.0,
        end_y=0.0,
        epsg=31370,
        projection_buffer_m=50.0,
    )
    await db_session.commit()

    return project.id, model.id, formation.id, section.id


def _nodes(elevation: float) -> list[BoundaryNode]:
    """Build a distinctive 3-node polyline stamped with ``elevation``.

    Every node in a submission carries the same ``elevation_m`` so a
    read-back can tell which of the two racing submissions won: a mixed
    (interleaved) set would contain both elevation stamps.
    """
    return [
        BoundaryNode(along_m=10.0, elevation_m=elevation),
        BoundaryNode(along_m=50.0, elevation_m=elevation),
        BoundaryNode(along_m=90.0, elevation_m=elevation),
    ]


async def _read_node_rows(db_session: AsyncSession, body_id: UUID) -> list[float]:
    """Read the persisted node elevations for a body's boundary, fresh from DB.

    Returns plain floats, not ORM instances: a later ``expire_all()`` (the
    next call to this helper) would expire previously returned instances and
    any attribute read on them then lazy-refreshes outside the async
    context — ``MissingGreenlet``.
    """
    db_session.expire_all()
    shape = (
        await db_session.execute(
            select(BodyBoundaryShapeOrm).where(BodyBoundaryShapeOrm.body_id == body_id)
        )
    ).scalar_one_or_none()
    if shape is None:
        return []
    return list(
        (
            await db_session.execute(
                select(BodyBoundaryNodeOrm.elevation_m).where(
                    BodyBoundaryNodeOrm.shape_id == shape.id
                )
            )
        )
        .scalars()
        .all()
    )


# ---------------------------------------------------------------------------
# TEST-05 — a concurrent save must never interleave two submissions
# ---------------------------------------------------------------------------


async def test_concurrent_save_body_boundary_serialises_no_interleave(
    db_session: AsyncSession,
) -> None:
    """Two concurrent saves to the SAME body serialise to one full submission.

    Fire two SaveBodyBoundary calls at the same body from two independent
    sessions.  The advisory lock must queue them so the second replaces the
    first wholesale.  The invariant: after both complete, the persisted
    node set is exactly ONE submission's nodes — all six nodes carry a
    single elevation stamp, never a mix of the two.
    """
    project_id, model_id, formation_id, section_id = await _seed_scope(db_session)
    body_id = await _seed_body(
        db_session,
        project_id=project_id,
        model_id=model_id,
        formation_id=formation_id,
        section_id=section_id,
        body_ordinal=0,
    )

    # Two submissions with disjoint elevation stamps so an interleave is
    # visible: submission A stamps every node at -5.0, submission B at -9.0.
    stamp_a, stamp_b = -5.0, -9.0

    # Each racing writer needs its OWN session / connection so the two
    # transactions genuinely contend on the advisory lock rather than
    # serialising on a shared connection (mirrors the seeded-contact race
    # test).
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def save(stamp: float) -> None:
        """Run one full-replace save in a fresh isolated session."""
        async with factory() as session:
            await SaveBodyBoundary(session).execute(
                project_id=project_id,
                model_id=model_id,
                body_id=body_id,
                upper_nodes=_nodes(stamp),
                lower_nodes=_nodes(stamp),
                render_style="straight",
            )

    # gather submits both concurrently. Both must complete — a deadlock,
    # timeout, or unique-constraint 500 would surface as an exception here
    # and fail the test.
    await asyncio.gather(save(stamp_a), save(stamp_b))

    await engine.dispose()

    rows = await _read_node_rows(db_session, body_id)

    # Full-replace of 3 upper + 3 lower nodes = exactly 6 rows survive.
    # A leaked-partial-DELETE or double-INSERT would show up as != 6.
    assert len(rows) == 6, (
        f"Expected exactly 6 nodes (one full submission), got {len(rows)} — "
        f"a concurrent save interleaved or partially applied."
    )

    # The load-bearing assertion: every surviving node carries the SAME
    # elevation stamp. If both submissions' nodes are present the set would
    # contain both -5.0 and -9.0 — that is the interleave the lock forbids.
    stamps = set(rows)
    assert stamps in ({stamp_a}, {stamp_b}), (
        f"Concurrent save interleaved two submissions: persisted node "
        f"elevations = {stamps}; must be a single submission's stamp "
        f"({{{stamp_a}}} or {{{stamp_b}}}), never a mix."
    )


# ---------------------------------------------------------------------------
# Control — different bodies proceed concurrently (the lock is per-body)
# ---------------------------------------------------------------------------


async def test_concurrent_save_different_bodies_both_persist(
    db_session: AsyncSession,
) -> None:
    """Saves to two DIFFERENT bodies run concurrently and both land in full.

    The advisory-lock key includes the body id, so unrelated bodies never
    block each other.  This control case proves the lock does not over-
    serialise: both bodies end up with their own submission's node set.
    """
    project_id, model_id, formation_id, section_id = await _seed_scope(db_session)
    body_a = await _seed_body(
        db_session,
        project_id=project_id,
        model_id=model_id,
        formation_id=formation_id,
        section_id=section_id,
        body_ordinal=0,
    )
    body_b = await _seed_body(
        db_session,
        project_id=project_id,
        model_id=model_id,
        formation_id=formation_id,
        section_id=section_id,
        body_ordinal=1,
    )

    stamp_a, stamp_b = -5.0, -9.0

    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def save(target_body: UUID, stamp: float) -> None:
        """Run one save against ``target_body`` in a fresh isolated session."""
        async with factory() as session:
            await SaveBodyBoundary(session).execute(
                project_id=project_id,
                model_id=model_id,
                body_id=target_body,
                upper_nodes=_nodes(stamp),
                lower_nodes=_nodes(stamp),
                render_style="straight",
            )

    await asyncio.gather(save(body_a, stamp_a), save(body_b, stamp_b))

    await engine.dispose()

    rows_a = await _read_node_rows(db_session, body_a)
    rows_b = await _read_node_rows(db_session, body_b)

    # Each body keeps exactly its own submission — no cross-contamination.
    assert set(rows_a) == {stamp_a}, (
        f"body_a lost its own submission: {{{stamp_a}}} expected, got {set(rows_a)}"
    )
    assert set(rows_b) == {stamp_b}, (
        f"body_b lost its own submission: {{{stamp_b}}} expected, got {set(rows_b)}"
    )
    assert len(rows_a) == 6 and len(rows_b) == 6

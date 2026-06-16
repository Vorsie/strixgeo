"""Integration test: concurrent union_seeded_contact_ids must not lose ids.

Reproduces debt #208 — the seeded_formation_contact_ids lost-update race.

``union_seeded_contact_ids`` performs a Python-side read-union-write:
  1. SELECT the current array,
  2. compute ``existing | contact_ids`` in Python,
  3. UPDATE the row,
  4. COMMIT.

When two concurrent callers execute against the **same section** both read
the same snapshot, both compute a union over that snapshot, and the second
COMMIT silently clobbers the first write — so half the accepted contact ids
vanish from the seeded set.

COR-02 / TEST-05 per the 2026-06-13 audit.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from uuid6 import uuid7

from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.shared.config import settings
from tests.integration.conftest import make_project

# ---------------------------------------------------------------------------
# COR-02 — concurrent union_seeded_contact_ids must be a true union
# ---------------------------------------------------------------------------


async def test_concurrent_union_seeded_contact_ids_no_lost_update(
    db_session: AsyncSession,
) -> None:
    """Two concurrent union calls on the same section preserve ALL ids.

    This test reproduces the race:
    - The BUGGY path: both transactions read the SAME empty snapshot,
      each computes {their_own_ids}, the second COMMIT clobbers the first.
      Result: only the second batch's ids survive.
    - The CORRECT path: the operation must be atomic.  After both tasks
      finish, the seeded set must equal batch_a | batch_b.
    """
    project = await make_project(db_session)

    # Seed the section into its committed state via the shared session.
    repo_setup = CrossSectionRepository(db_session)
    section = await repo_setup.create(
        project.id,
        name="Race section",
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        epsg=31370,
        projection_buffer_m=50.0,
    )
    await db_session.commit()
    section_id: UUID = section.id
    project_id: UUID = project.id

    # Two independent batches — disjoint ids so a clobber is detectable.
    batch_a: set[UUID] = {uuid7(), uuid7(), uuid7()}
    batch_b: set[UUID] = {uuid7(), uuid7(), uuid7()}
    expected: set[UUID] = batch_a | batch_b

    # Each concurrent call needs its OWN session (and therefore its own
    # DB connection) so that the read-modify-write truly races through two
    # separate transactions.  The shared ``db_session`` fixture is a single
    # connection; using it for both callers would serialise them on the
    # connection level and hide the race.
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def write_batch(ids: set[UUID]) -> None:
        """Run union_seeded_contact_ids in a fresh isolated session."""
        async with factory() as session:
            repo = CrossSectionRepository(session)
            await repo.union_seeded_contact_ids(
                section_id,
                project_id,
                ids,
                operation="test_concurrent",
            )

    # Fire both writes concurrently — asyncio.gather submits them to the
    # event loop simultaneously; the race is real on a single-process async
    # runtime because each write's network round-trips interleave.
    await asyncio.gather(write_batch(batch_a), write_batch(batch_b))

    await engine.dispose()

    # Read back via a fresh SELECT (expire the ORM cache, avoid reading
    # a stale identity-map entry from the setup session).
    # expire_all() is synchronous; the subsequent .get() re-loads from DB.
    db_session.expire_all()

    repo_read = CrossSectionRepository(db_session)
    final = await repo_read.get(section_id)
    assert final is not None

    actual: set[UUID] = set(final.seeded_formation_contact_ids or [])

    # The union must contain every id from BOTH batches.
    # If this assertion fails it means a lost-update happened — the second
    # write clobbered the first, which is the bug this test pins.
    missing = expected - actual
    assert not missing, (
        f"Lost-update race detected: {len(missing)} id(s) from one batch "
        f"were clobbered by the concurrent write.\n"
        f"  expected union size: {len(expected)}\n"
        f"  actual size:         {len(actual)}\n"
        f"  missing:             {missing}"
    )

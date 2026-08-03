"""Integration test: two overlapping view_state PATCHes must not drop a key.

Audit finding F19. Both view-state surfaces do a Python-side read-merge-write:

  1. SELECT the current ``view_state`` bag,
  2. shallow-merge the patch in Python (``_helpers.merge_view_state``),
  3. UPDATE the whole column,
  4. COMMIT.

Two concurrent PATCHes on the same row both read the SAME snapshot, each merges
its own key into it, and the second COMMIT silently clobbers the first — the
engineer's toggle (or, on the project row, the ``save_anchor`` the save flow
writes there) is gone with no error anywhere.

The identical race on the section seeded-set was fixed under debt #208 with
``pg_advisory_xact_lock``; these two siblings share the same helper and never got
it. Mirrors ``test_seeded_contact_ids_race.py``.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from groundmodel.api.routers.cross_section import update_section
from groundmodel.api.routers.investigation_review import patch_project_view_state
from groundmodel.api.schemas.project.cross_section import CrossSectionUpdateRequest
from groundmodel.api.schemas.project.investigation_review import (
    ProjectViewStatePatchRequest,
)
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.repositories.project_repository import ProjectRepository
from groundmodel.shared.config import settings
from tests.integration.conftest import make_project


async def test_concurrent_project_view_state_patches_keep_both_keys(
    db_session: AsyncSession,
) -> None:
    """Two overlapping PATCHes on one project keep BOTH top-level keys.

    The buggy path leaves whichever patch committed last; the correct path is a
    true merge because the second transaction waits for the first to commit
    before it reads.
    """
    project = await make_project(db_session)
    await db_session.commit()
    project_id: UUID = project.id

    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def patch(key: str, value: object) -> None:
        async with factory() as session:
            await patch_project_view_state(
                project_id,
                ProjectViewStatePatchRequest(patch={key: value}),
                session,
            )

    # ``save_anchor`` is the realistic pair: the save flow writes it to the same
    # bag a UI toggle patches, so a lost update here loses the save anchor.
    await asyncio.gather(
        patch("save_anchor", "2026-08-03T09:12:44.201Z-4f2c9a"),
        patch("hidden_cpt_types", ["CPTM"]),
    )
    await engine.dispose()

    db_session.expire_all()
    final = await ProjectRepository(db_session).get_by_id(project_id)
    assert final is not None
    bag = final.view_state or {}
    missing = {"save_anchor", "hidden_cpt_types"} - set(bag)
    assert not missing, (
        f"Lost-update race on project.view_state: {sorted(missing)} clobbered by "
        f"the concurrent PATCH. Final bag: {bag}"
    )


async def test_concurrent_section_view_state_patches_keep_both_keys(
    db_session: AsyncSession,
) -> None:
    """Two overlapping section PATCHes keep BOTH top-level view_state keys."""
    project = await make_project(db_session)
    section = await CrossSectionRepository(db_session).create(
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
    project_id: UUID = project.id
    section_id: UUID = section.id

    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def patch(key: str, value: object) -> None:
        async with factory() as session:
            await update_section(
                project_id,
                section_id,
                CrossSectionUpdateRequest(view_state={key: value}),
                session,
            )

    await asyncio.gather(
        patch("review_flags", {"dismissed": ["L1|2|left"]}),
        patch("cpt_channels", {"qc": True}),
    )
    await engine.dispose()

    db_session.expire_all()
    final = await CrossSectionRepository(db_session).get(section_id)
    assert final is not None
    bag = final.view_state or {}
    assert isinstance(bag, dict), f"view_state is not an object: {bag!r}"
    missing = {"review_flags", "cpt_channels"} - set(bag)
    assert not missing, (
        f"Lost-update race on section.view_state: {sorted(missing)} clobbered by "
        f"the concurrent PATCH. Final bag: {bag}"
    )

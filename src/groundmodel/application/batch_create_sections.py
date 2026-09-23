"""Batch cross-section creation — N creates, one commit.

The single :func:`create_section` endpoint commits once per call.  When the
frontend issues "Accept all tie-sections" it would fire one request per
section, costing N commits + N round-trips.  This use case loops
:class:`~groundmodel.infrastructure.db.repositories.cross_section_repository.CrossSectionRepository.create`
with ``flush`` semantics (no per-row commit) and issues a **single** commit at
the end, so the whole batch is one transaction (one fsync) via a single
endpoint call.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class BatchCreateSections(GroundModelLogger):
    """Create several cross-sections atomically (one commit).

    Parameters
    ----------
    session : AsyncSession
        Active database session.  This use case commits once at the end of
        the batch; the caller must not commit before calling it.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = CrossSectionRepository(session)

    async def execute(
        self,
        *,
        app_project_id: UUID,
        sections: list[dict[str, Any]],
    ) -> list[CrossSectionOrm]:
        """Create every section, then commit once.

        Each section is flushed (not committed) inside
        :meth:`CrossSectionRepository.create`, so all rows share a single
        transaction.  A single :meth:`AsyncSession.commit` persists the whole
        batch atomically.

        Parameters
        ----------
        app_project_id : UUID
            Owning project.  Every created section is scoped to this project.
        sections : list[dict[str, Any]]
            One kwargs dict per section.  Keys must match the keyword
            arguments accepted by
            :meth:`CrossSectionRepository.create` (name, start_x, start_y,
            end_x, end_y, epsg, projection_buffer_m, description,
            vertical_exaggeration, excluded_borehole_ids, excluded_cpt_ids,
            min_depth_m, max_depth_m, display_order, view_state).

        Returns
        -------
        list[CrossSectionOrm]
            The created ORM rows, in the same order as ``sections``.
            Empty list when ``sections`` is empty.
        """
        self.info(
            f"BatchCreateSections.execute: {len(sections)} section(s) for project {app_project_id}"
        )
        created: list[CrossSectionOrm] = []
        for i, spec in enumerate(sections, start=1):
            row = await self._repo.create(app_project_id, **spec)
            created.append(row)
            self.debug(f"[{i}/{len(sections)}] flushed section '{spec.get('name')}'")

        if created:
            # New sections can draw tests no section drew before; only tests a
            # section draws feed the model (owner ruling 2026-09-23).
            await GeologyRepository(self._session).mark_project_surfaces_stale(
                app_project_id, reason=f"{len(created)} section(s) created in batch"
            )
        await self._session.commit()

        # Refresh so all server-set columns (created_at, updated_at) are
        # populated before the caller serialises the rows.
        for row in created:
            await self._session.refresh(row)

        self.success(f"BatchCreateSections: committed {len(created)} section(s)")
        return created

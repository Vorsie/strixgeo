"""Repository for the cross_section table.

Standalone — sections are project-scoped but don't own children or
embed inside another tree, so a small focused repo is the right shape.
Mirrors the ``ProjectRepository`` / ``BoreholeRepository`` pattern.

The polylines drawn on a section (formation tops between
investigations) live in their own ``formation_surface_on_section``
table added by the geological-model editor (#34). They aren't this
repo's concern; their CRUD will land alongside the editor.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class CrossSectionRepository(GroundModelLogger):
    """Async CRUD for ``CrossSectionOrm`` rows."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def create(
        self,
        app_project_id: UUID,
        *,
        name: str,
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        epsg: int,
        projection_buffer_m: float,
        description: str | None = None,
        vertical_exaggeration: float = 1.0,
        excluded_borehole_ids: list[UUID] | None = None,
        excluded_cpt_ids: list[UUID] | None = None,
        min_depth_m: float | None = None,
        max_depth_m: float | None = None,
        display_order: int = 0,
    ) -> CrossSectionOrm:
        """Insert a new cross-section under the given project."""
        section = CrossSectionOrm(
            id=uuid7(),
            app_project_id=app_project_id,
            name=name,
            description=description,
            start_x=start_x,
            start_y=start_y,
            end_x=end_x,
            end_y=end_y,
            epsg=epsg,
            projection_buffer_m=projection_buffer_m,
            vertical_exaggeration=vertical_exaggeration,
            excluded_borehole_ids=excluded_borehole_ids or [],
            excluded_cpt_ids=excluded_cpt_ids or [],
            min_depth_m=min_depth_m,
            max_depth_m=max_depth_m,
            display_order=display_order,
        )
        self._session.add(section)
        await self._session.flush()
        self.success(f"Cross-section created: {section.id} — {name}")
        return section

    async def list_all(self, app_project_id: UUID) -> list[CrossSectionOrm]:
        """Return every section for a project, ordered by display_order then name."""
        stmt = (
            select(CrossSectionOrm)
            .where(CrossSectionOrm.app_project_id == app_project_id)
            .order_by(CrossSectionOrm.display_order, CrossSectionOrm.name)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get(self, section_id: UUID) -> CrossSectionOrm | None:
        """Look up a section by id. ``None`` when missing."""
        return await self._session.get(CrossSectionOrm, section_id)

    async def update(self, section_id: UUID, patch: dict[str, Any]) -> CrossSectionOrm | None:
        """Apply a partial update. Only keys present in ``patch`` are written."""
        section = await self.get(section_id)
        if section is None:
            return None
        for key, value in patch.items():
            setattr(section, key, value)
        await self._session.flush()
        self.info(f"Cross-section updated: {section_id}")
        return section

    async def delete(self, section_id: UUID) -> bool:
        """Delete a section. Returns ``True`` if a row was removed."""
        section = await self.get(section_id)
        if section is None:
            return False
        await self._session.delete(section)
        await self._session.flush()
        self.info(f"Cross-section deleted: {section_id}")
        return True

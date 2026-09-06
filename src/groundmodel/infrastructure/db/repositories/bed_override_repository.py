"""Repository for the bed_override table.

Standalone — bed overrides are project-scoped and own no children, so a small
focused repo is the right shape (mirrors ``CrossSectionRepository``).

Flush-only: every write flushes; the router owns the commit.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.bed_override_orm import BedOverrideOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class BedOverrideRepository(GroundModelLogger):
    """Async CRUD for ``BedOverrideOrm`` rows."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def create(
        self,
        app_project_id: UUID,
        *,
        label: str,
        level_m: float,
        epsg: int,
        vertices: list[list[float]],
    ) -> BedOverrideOrm:
        """Insert a new bed override under the given project.

        Parameters
        ----------
        app_project_id : UUID
            Owning project.
        label : str
            Human-readable name for the override list.
        level_m : float
            The constant bed elevation (m TAW / NAP).
        epsg : int
            CRS of the polygon coordinates (the project's horizontal CRS).
        vertices : list[list[float]]
            The polygon ring as ``[x, y]`` pairs.
        """
        override = BedOverrideOrm(
            id=uuid7(),
            app_project_id=app_project_id,
            label=label,
            level_m=level_m,
            epsg=epsg,
            vertices=vertices,
        )
        self._session.add(override)
        await self._session.flush()
        self.success(f"Bed override created: {override.id}")
        self.debug(f"Bed override created: {override.id} — label {label!r} level {level_m} m")
        return override

    async def list_all(self, app_project_id: UUID) -> list[BedOverrideOrm]:
        """Return every bed override for a project, newest first.

        Newest-first so the most recently drawn polygon wins any overlap (the
        domain ``bed_level_at`` resolves overlaps by list order).
        """
        stmt = (
            select(BedOverrideOrm)
            .where(BedOverrideOrm.app_project_id == app_project_id)
            .order_by(BedOverrideOrm.created_at.desc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get(self, override_id: UUID) -> BedOverrideOrm | None:
        """Look up a bed override by id. ``None`` when missing."""
        return await self._session.get(BedOverrideOrm, override_id)

    async def update(self, override_id: UUID, patch: dict[str, Any]) -> BedOverrideOrm | None:
        """Apply a partial update. Only keys present in ``patch`` are written."""
        override = await self.get(override_id)
        if override is None:
            return None
        for key, value in patch.items():
            setattr(override, key, value)
        await self._session.flush()
        self.info(f"Bed override updated: {override_id}")
        return override

    async def delete(self, override_id: UUID) -> bool:
        """Delete a bed override. Returns ``True`` if a row was removed."""
        override = await self.get(override_id)
        if override is None:
            return False
        await self._session.delete(override)
        await self._session.flush()
        self.info(f"Bed override deleted: {override_id}")
        return True

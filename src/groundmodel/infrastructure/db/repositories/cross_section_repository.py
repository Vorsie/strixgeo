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
        view_state: dict[str, Any] | None = None,
    ) -> CrossSectionOrm:
        """Insert a new cross-section under the given project.

        ``seeded_formation_contact_ids`` is always empty on create —
        a freshly-drawn section shows investigations only.  Formation
        content appears only after an explicit Seed or manual draw action.
        """
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
            seeded_formation_contact_ids=[],
            min_depth_m=min_depth_m,
            max_depth_m=max_depth_m,
            display_order=display_order,
            view_state=view_state,
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

    async def union_seeded_contact_ids(
        self,
        section_id: UUID,
        project_id: UUID,
        contact_ids: set[UUID],
        *,
        operation: str,
    ) -> CrossSectionOrm | None:
        """Union ``contact_ids`` into a section's ``seeded_formation_contact_ids``.

        The explicit-content invariant (owner directive 2026-05-17): formation
        content appears on a section only where the user explicitly seeded or
        drew it, tracked by ``cross_section.seeded_formation_contact_ids``. This
        method is the single write path for that set — shared by the manual-draw
        201 path, the dedup-survivor 409 path (debt #57), the Seed endpoint, and
        the pinch-out use case.

        Non-fatal by contract: the caller's primary operation (contact create /
        Seed run / pinch-out commit) has already committed its own transaction.
        A missing or out-of-project section, or a failed section commit here, is
        logged and swallowed — it must never turn the caller's 200/201/409 into
        a 500. On a swallowed failure the session is rolled back so it is clean
        before ``get_session``'s finaliser closes it (a failed ``commit``
        otherwise leaves it in ``PendingRollbackError`` and poisons the next
        pooled use).

        Parameters
        ----------
        section_id : UUID
            Section whose seeded set to extend.
        project_id : UUID
            Project the section must belong to (scope guard against IDOR).
        contact_ids : set[UUID]
            Ids to union into the existing seeded set.
        operation : str
            Short label identifying the call site in log messages
            (e.g. ``"create_contact"`` / ``"create_contact dedup"`` /
            ``"Seed"`` / ``"pinch_out"``).

        Returns
        -------
        CrossSectionOrm | None
            The refreshed section ORM row on a successful update, else
            ``None``. Callers that need a ``CrossSectionResponse`` map the
            returned row themselves (layer boundary: repo returns ORM, the
            router/use-case constructs the Pydantic response).
        """
        try:
            section = await self.get(section_id)
            if section is None or section.app_project_id != project_id:
                self.warning(
                    f"{operation}: section_id {section_id} not found in project "
                    f"{project_id} — seeded set not updated"
                )
                return None
            existing_seeded = frozenset(section.seeded_formation_contact_ids or [])
            merged = list(existing_seeded | contact_ids)
            updated = await self.update(section_id, {"seeded_formation_contact_ids": merged})
            await self._session.commit()
            if updated is not None:
                await self._session.refresh(updated)
            self.info(
                f"{operation}: section {section_id} seeded_formation_contact_ids "
                f"updated — {len(merged)} id(s) total "
                f"({len(contact_ids)} requested, {len(existing_seeded)} pre-existing)"
            )
            return updated
        except Exception as exc:
            await self._session.rollback()
            self.warning(
                f"{operation}: section seeding failed — section {section_id} "
                f"seeded set not updated ({type(exc).__name__}): {exc!r}"
            )
            return None

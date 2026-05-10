"""Repository for Project persistence."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ProjectRepository(GroundModelLogger):
    """Async CRUD for ``ProjectOrm`` rows.

    Mirrors the access pattern of ``CptRepository`` / ``BoreholeRepository``:
    one ``AsyncSession`` per request, no broker. Keeps the soft-delete
    semantics tight — ``archive`` and ``unarchive`` flip ``archived_at``
    rather than mutating the row twice.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def save(self, project: ProjectOrm, *, flush: bool = True) -> None:
        """Persist a new or updated project.

        Parameters
        ----------
        project : ProjectOrm
            Row to add to the session. For updates, the row must already be
            attached (loaded from this session) so SQLAlchemy emits an UPDATE
            rather than an INSERT.
        flush : bool
            When ``True`` (default), flush so a freshly-built row's id round-
            trips to the DB and any DB-side defaults populate. Bulk callers
            pass ``False``.
        """
        self._session.add(project)
        if flush:
            await self._session.flush()
            self.success(f"Project saved: {project.id} — {project.name}")

    async def get_by_id(self, project_id: UUID) -> ProjectOrm | None:
        """Return the project with the given id, or ``None``.

        Returns archived projects too — the router decides whether to surface
        them based on the request's ``status`` filter.
        """
        result = await self._session.execute(select(ProjectOrm).where(ProjectOrm.id == project_id))
        return result.scalar_one_or_none()

    async def list_all(self, *, include_archived: bool = False) -> list[ProjectOrm]:
        """Return every project, ordered by most-recent activity first.

        Parameters
        ----------
        include_archived : bool
            When ``False`` (default), hide rows where ``archived_at`` is set
            so the projects-list view keeps active work front-and-centre. When
            ``True``, return both active and archived; an "Archived" view in
            the UI uses this.
        """
        stmt = select(ProjectOrm).order_by(ProjectOrm.updated_at.desc())
        if not include_archived:
            stmt = stmt.where(ProjectOrm.archived_at.is_(None))
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def list_archived(self) -> list[ProjectOrm]:
        """Return only archived projects (for the 'Archived' view)."""
        stmt = (
            select(ProjectOrm)
            .where(ProjectOrm.archived_at.is_not(None))
            .order_by(ProjectOrm.archived_at.desc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def archive(self, project_id: UUID) -> ProjectOrm | None:
        """Soft-delete: stamp ``archived_at`` so the project drops out of
        default listings. Returns ``None`` when the id is unknown so the
        router can map to 404.
        """
        project = await self.get_by_id(project_id)
        if project is None:
            return None
        # Stamp with timezone-aware UTC so the column matches its declared
        # ``DateTime(timezone=True)`` type — naive datetimes round-trip as
        # implicit UTC on PostgreSQL but break ordering against other tz-
        # aware writes.
        project.archived_at = datetime.now(UTC)
        await self._session.flush()
        self.info(f"Project {project_id} archived")
        return project

    async def unarchive(self, project_id: UUID) -> ProjectOrm | None:
        """Restore a previously-archived project (clear ``archived_at``)."""
        project = await self.get_by_id(project_id)
        if project is None:
            return None
        project.archived_at = None
        await self._session.flush()
        self.info(f"Project {project_id} unarchived")
        return project

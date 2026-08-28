"""Repository for Project persistence."""

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_bundle.bundle_clone import (
    clone_project_children,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def _json_copy(value: dict[str, Any] | None) -> dict[str, Any] | None:
    """Deep-copy a JSONB column value so clone and source stay independent.

    Parameters
    ----------
    value : dict[str, Any] | None
        The source row's JSONB value. ``None`` passes through unchanged —
        for the lumping slots that is a meaningful state ("no map at all"),
        distinct from an empty dict.

    Returns
    -------
    dict[str, Any] | None
        A structurally independent copy, or ``None``.
    """
    return deepcopy(value) if value is not None else None


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
            # Id at SUCCESS, name at DEBUG: ``backend.log`` is unredacted on
            # disk and can travel to support, so a client-identifying project
            # name must not sit on an always-on line (owner: "no user data
            # should ever leak"). The id answers "which project" without it.
            self.success(f"Project saved: {project.id}")
            self.debug(f"Project saved: {project.id} — name {project.name!r}")

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

    async def duplicate(self, source_id: UUID, new_name: str | None = None) -> ProjectOrm | None:
        """Deep-clone a project and everything under it.

        Used by the desktop client's File → Save As. Creates a new
        ``ProjectOrm`` with a fresh UUID and copies every metadata field
        from the source, then hands the whole child tree to
        :func:`~groundmodel.infrastructure.db.repositories.project_bundle.bundle_clone.clone_project_children`,
        which drives the copy off the SAME bundle build + restore the
        .strix round-trip uses. What the engineer gets is therefore the
        whole project — CPTs and boreholes AND the geological formations,
        the three model levels with their contacts and litho layers, the
        cross-sections, the bodies and their boundary shapes, the
        correlation edges, the reviews and the cached solids — rather
        than the raw investigations alone.

        Returns the new ``ProjectOrm`` (already attached to the session,
        ready for ``commit``), or ``None`` when ``source_id`` doesn't
        resolve. Caller is responsible for the commit, and for running
        ``reconcile_bodies_after_restore`` — the restore drops
        ``litho_layer.body_id`` for the resolver to re-stamp, exactly as
        it does on an open-from-file.

        ``new_name`` overrides the source's name; defaults to
        ``"Copy of <source name>"``. Lifecycle (status / archived_at)
        does NOT carry across — a fresh copy starts active, like any
        other new project. The two lumping slots + their revision and
        ``view_state`` DO carry across (debt #267).

        DB rows only — the .gmproj file write is the caller's
        responsibility (the desktop client knows where the user wants
        the new file saved).

        Raises
        ------
        BundleCloneIncompleteError
            When the copy came out with fewer rows than the source. The
            copy is abandoned rather than returned — a Save As that
            silently loses the interpretation is worse than one that
            fails, because the app adopts the copy immediately.
        """
        source = await self.get_by_id(source_id)
        if source is None:
            return None

        new_project = ProjectOrm(
            id=uuid7(),
            name=new_name if new_name else f"Copy of {source.name}",
            project_number=source.project_number,
            client=source.client,
            site_label=source.site_label,
            description=source.description,
            tags=list(source.tags),
            default_horizontal_epsg=source.default_horizontal_epsg,
            default_vertical_epsg=source.default_vertical_epsg,
            phase=source.phase,
            status="active",
            archived_at=None,
            # The lumping map's real home is these three columns (see
            # docs/design/autosave-recovery.md §3) and the renderer seeds
            # its in-memory slots from them on open. Leaving them NULL on
            # a Save-As would hand the copy a .gmproj that carries the map
            # while its DB does not — the exact split the two-slot design
            # exists to prevent. ``view_state`` rides along for the same
            # reason: a Save-As that silently drops the user's view toggles
            # is the same class of surprise (debt #267). Both are plain
            # JSON values, so copy them by value — sharing the source's
            # dict would let a later mutation of one row bleed into the
            # other through SQLAlchemy's identity map.
            stratigraphy_lumping_staged=_json_copy(source.stratigraphy_lumping_staged),
            stratigraphy_lumping_saved=_json_copy(source.stratigraphy_lumping_saved),
            stratigraphy_lumping_revision=source.stratigraphy_lumping_revision,
            view_state=_json_copy(source.view_state) or {},
        )
        self._session.add(new_project)
        await self._session.flush()

        copied = await clone_project_children(
            self._session,
            source=source,
            target=new_project,
            logger=self,
        )
        self.success(
            f"Project {source_id} duplicated to {new_project.id} — "
            + ", ".join(f"{n} {key}" for key, n in copied.items())
        )
        return new_project

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

from collections.abc import Callable
from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
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
        # Id at SUCCESS, name at DEBUG: a section name commonly echoes a site
        # ("Kaai 42 A-A'"), so it must not sit on an always-on line in the
        # unredacted ``backend.log``.
        self.success(f"Cross-section created: {section.id}")
        self.debug(f"Cross-section created: {section.id} — name {name!r}")
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
            # Serialise concurrent writers on the same section.
            #
            # Two concurrent accept requests both do: GET the current array →
            # union in Python → UPDATE → COMMIT.  Without a lock both read the
            # same snapshot and the second COMMIT silently clobbers the first
            # write (debt #208, "lost-update race").
            #
            # ``pg_advisory_xact_lock`` queues concurrent transactions on the
            # same integer key and releases automatically at COMMIT / ROLLBACK —
            # no manual cleanup needed.  The key is derived from section_id so
            # writes to different sections never block each other.  Read paths
            # (``list_all``, ``get``) are untouched.  Mirrors the pattern used
            # in ``SaveBodyBoundary`` (body_boundary.py).
            await self._session.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
                {"k": str(section_id)},
            )
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

    async def _rewrite_sections(
        self,
        app_project_id: UUID,
        keep: Callable[[UUID], bool],
    ) -> int:
        """Rewrite every project section's seeded set, keeping only ids passing ``keep``.

        Flush-only (no commit): the caller owns the transaction. This is the
        symmetric counterpart to :meth:`union_seeded_contact_ids` — that method
        is the single write path that ADDS ids (post-commit, non-fatal); this is
        the single write path that REMOVES them, run inside the caller's
        delete/clear transaction so the unseed is atomic with the row removal.

        Parameters
        ----------
        app_project_id : UUID
            Project whose sections are swept.
        keep : Callable[[UUID], bool]
            Predicate run per seeded id — ``True`` keeps the id, ``False`` drops
            it. The list order of surviving ids is preserved.

        Returns
        -------
        int
            Total number of seeded ids removed across all of the project's
            sections.
        """
        sections = await self.list_all(app_project_id)
        removed_total = 0
        for section in sections:
            seeded = section.seeded_formation_contact_ids or []
            kept = [cid for cid in seeded if keep(cid)]
            if len(kept) != len(seeded):
                removed_total += len(seeded) - len(kept)
                await self.update(section.id, {"seeded_formation_contact_ids": kept})
        return removed_total

    async def remove_seeded_contact_ids(
        self,
        app_project_id: UUID,
        contact_ids: set[UUID],
    ) -> int:
        """Remove specific contact ids from every project section's seeded set.

        Targeted unseed for the single-contact delete path: a deleted contact
        must no longer be seeded on any section (closes the seeded-array leak).
        Flush-only — the caller commits.

        Parameters
        ----------
        app_project_id : UUID
            Project whose sections are swept.
        contact_ids : set[UUID]
            Contact ids to drop from every section's seeded set. Empty set is a
            no-op.

        Returns
        -------
        int
            Total number of seeded entries removed across all sections.
        """
        if not contact_ids:
            return 0
        removed = await self._rewrite_sections(app_project_id, lambda cid: cid not in contact_ids)
        if removed:
            self.info(
                f"remove_seeded_contact_ids: pruned {removed} seeded entr(ies) for "
                f"{len(contact_ids)} deleted contact(s) in project {app_project_id}"
            )
        return removed

    async def prune_orphan_seeded_ids(self, app_project_id: UUID) -> int:
        """Drop every seeded id that no longer references a live contact.

        Garbage-collection sweep for the clear-litho-model path: after a clear
        the model's contacts are gone, and historical suggest→accept→delete
        cycles may have left thousands of stale ids seeded on the project's
        sections. This removes any seeded id whose contact no longer exists in
        ANY model of the project, while preserving ids that still reference a
        live contact (including live geological contacts). Flush-only — the
        caller commits.

        Parameters
        ----------
        app_project_id : UUID
            Project whose sections are swept.

        Returns
        -------
        int
            Total number of stale seeded entries removed across all sections.
        """
        live = await self._live_contact_ids(app_project_id)
        pruned = await self._rewrite_sections(app_project_id, lambda cid: cid in live)
        if pruned:
            self.info(
                f"prune_orphan_seeded_ids: removed {pruned} stale seeded entr(ies) "
                f"in project {app_project_id} ({len(live)} live contact(s) retained)"
            )
        return pruned

    async def _live_contact_ids(self, app_project_id: UUID) -> set[UUID]:
        """Return the ids of every contact that exists in any model of the project.

        Parameters
        ----------
        app_project_id : UUID
            Project to scope the contact set to.

        Returns
        -------
        set[UUID]
            All ``FormationContact.id`` values whose owning model belongs to
            the project — the set of ids that are legitimately seedable.
        """
        stmt = (
            select(FormationContactOrm.id)
            .join(GeologicalModelOrm, FormationContactOrm.model_id == GeologicalModelOrm.id)
            .where(GeologicalModelOrm.app_project_id == app_project_id)
        )
        return set((await self._session.execute(stmt)).scalars().all())

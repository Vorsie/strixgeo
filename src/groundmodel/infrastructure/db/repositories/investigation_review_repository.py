"""Repository for the investigation_review table.

Per-investigation engineering decisions (review status / notes / hidden
flag). Polymorphic anchor: one repo handles both CPT- and borehole-
targeted reviews. Mirrors the ``CrossSectionRepository`` pattern —
focused CRUD with no children to walk.

The "upsert by target" path (``set_for_target``) is the dominant
caller-side use case: the UI rarely cares which review row id holds the
decision for borehole X, only that there's one. We expose both id-keyed
and target-keyed APIs so callers can pick the natural one.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.investigation_review_orm import (
    InvestigationReviewOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Allowed values mirror the DB CHECK constraints. Re-asserted here so a
# caller bypassing the API layer (tests, future scripts) still raises
# cleanly instead of pushing a bad value to Postgres.
ALLOWED_TARGET_KINDS = frozenset({"cpt", "borehole"})
ALLOWED_REVIEW_STATUSES = frozenset({"unreviewed", "in_progress", "reviewed"})


class InvestigationReviewRepository(GroundModelLogger):
    """Async CRUD for ``InvestigationReviewOrm`` rows."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def list_all(self, app_project_id: UUID) -> list[InvestigationReviewOrm]:
        """Return every review row for a project, ordered by creation."""
        stmt = (
            select(InvestigationReviewOrm)
            .where(InvestigationReviewOrm.app_project_id == app_project_id)
            .order_by(InvestigationReviewOrm.created_at)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get(self, review_id: UUID) -> InvestigationReviewOrm | None:
        """Look up a review row by id. ``None`` when missing."""
        return await self._session.get(InvestigationReviewOrm, review_id)

    async def hidden_investigation_ids(self, app_project_id: UUID) -> set[UUID]:
        """Return the target ids of every investigation hidden in a project.

        "Hidden" is the project-local remove: the CPT / borehole row and its
        contacts survive, but the investigation is not shown and — per the
        owner ruling 2026-09-06 — its contacts must not feed the stratigraphic
        model. The TIN rebuild uses this set to drop those contacts.

        Parameters
        ----------
        app_project_id : UUID
            The project whose hidden investigations are returned.

        Returns
        -------
        set[UUID]
            ``target_id`` of every ``is_hidden`` review row in the project,
            mixing CPT and borehole ids (both are unique UUIDs, so one flat
            set matches a contact's ``borehole_id`` / ``cpt_id`` directly).
        """
        stmt = select(InvestigationReviewOrm.target_id).where(
            InvestigationReviewOrm.app_project_id == app_project_id,
            InvestigationReviewOrm.is_hidden.is_(True),
        )
        return set((await self._session.execute(stmt)).scalars().all())

    async def get_for_target(
        self, target_kind: str, target_id: UUID
    ) -> InvestigationReviewOrm | None:
        """Look up the review row for a specific investigation.

        ``None`` when no row exists yet — callers should treat the
        absence as the default ``unreviewed`` / not-hidden state.
        """
        stmt = select(InvestigationReviewOrm).where(
            InvestigationReviewOrm.target_kind == target_kind,
            InvestigationReviewOrm.target_id == target_id,
        )
        return (await self._session.execute(stmt)).scalar_one_or_none()

    async def set_for_target(
        self,
        app_project_id: UUID,
        target_kind: str,
        target_id: UUID,
        patch: dict[str, Any],
    ) -> InvestigationReviewOrm:
        """Idempotently apply a decision to an investigation.

        Inserts a new review row if none exists for the target; updates
        in place otherwise. Returns the (post-write) row.

        ``patch`` keys are the writable columns: ``review_status``,
        ``review_notes``, ``is_hidden``. ``reviewed_at`` is managed here
        (stamped when status transitions to 'reviewed', re-NULLed when
        moving back to an earlier state) so callers don't have to.

        Raises ``ValueError`` on disallowed enum values rather than
        bubbling a CheckViolation from Postgres — the API layer can
        translate that to a 422 cleanly.
        """
        if target_kind not in ALLOWED_TARGET_KINDS:
            raise ValueError(
                f"target_kind must be one of {sorted(ALLOWED_TARGET_KINDS)}; got {target_kind!r}"
            )
        new_status = patch.get("review_status")
        if new_status is not None and new_status not in ALLOWED_REVIEW_STATUSES:
            raise ValueError(
                f"review_status must be one of {sorted(ALLOWED_REVIEW_STATUSES)}; got {new_status!r}"
            )

        # Per-column None policy:
        # * ``review_status`` (NOT NULL) — None means "don't touch".
        # * ``is_hidden``     (NOT NULL) — None means "don't touch".
        # * ``review_notes``  (nullable) — None means "clear it".
        # The router accepts ``null`` on any field (the Pydantic shape
        # is bool | None / str | None), so explicit-null callers must
        # not crash the NOT NULL columns at flush time.
        status_in = patch.get("review_status")
        hidden_in = patch.get("is_hidden")

        # Pre-read the current row so the per-column None policy +
        # the ``reviewed_at`` transition rule resolve against the
        # actual state. The race that motivated this refactor
        # (debt #14) is the INSERT-collides-with-INSERT path —
        # ``ON CONFLICT DO UPDATE`` below converts that path's
        # IntegrityError into a deterministic UPDATE instead of a
        # bubbling 500. Two concurrent PUTs settle to last-writer-
        # wins; the IntegrityError class is gone.
        row = await self.get_for_target(target_kind, target_id)
        old_status = row.review_status if row is not None else None

        # Merge patch with current state to derive the FINAL desired
        # row, then push it through INSERT ... ON CONFLICT. Doing the
        # merge client-side preserves the ``"absent key" vs explicit
        # null`` distinction that plain SQL can't express.
        final_status = (
            status_in
            if status_in is not None
            else (row.review_status if row is not None else "unreviewed")
        )
        final_hidden = (
            hidden_in if hidden_in is not None else (row.is_hidden if row is not None else False)
        )
        if "review_notes" in patch:
            final_notes = patch["review_notes"]  # explicit null clears
        else:
            final_notes = row.review_notes if row is not None else None
        # ``reviewed_at`` follows status transitions only:
        #   * unchanged status → keep the existing timestamp (or
        #     None for a brand-new row not in 'reviewed').
        #   * status → 'reviewed' → stamp now.
        #   * 'reviewed' → anything else → clear to None.
        if final_status == old_status:
            final_reviewed_at = row.reviewed_at if row is not None else None
        elif final_status == "reviewed":
            final_reviewed_at = datetime.now(UTC)
        else:
            final_reviewed_at = None

        stmt = (
            pg_insert(InvestigationReviewOrm)
            .values(
                id=row.id if row is not None else uuid7(),
                app_project_id=app_project_id,
                target_kind=target_kind,
                target_id=target_id,
                review_status=final_status,
                review_notes=final_notes,
                is_hidden=final_hidden,
                reviewed_at=final_reviewed_at,
            )
            .returning(InvestigationReviewOrm)
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["target_kind", "target_id"],
            set_={
                "review_status": stmt.excluded.review_status,
                "review_notes": stmt.excluded.review_notes,
                "is_hidden": stmt.excluded.is_hidden,
                "reviewed_at": stmt.excluded.reviewed_at,
            },
        )
        # ``populate_existing=True`` refreshes any identity-mapped
        # instance from the RETURNING row. Without it, the pre-read
        # ``row`` (loaded at line 121) stays in the identity map with
        # stale attributes and ``result.scalar_one()`` hands back that
        # same instance unchanged — callers then see the pre-call
        # values for ``review_notes`` / ``is_hidden`` / ``reviewed_at``
        # even though the DB row is correct. Surfaces under
        # ``expire_on_commit=False`` (the conftest default + production
        # default for an AsyncSession).
        result = await self._session.execute(stmt, execution_options={"populate_existing": True})
        await self._session.flush()
        # ``returning(orm)`` gives back an OrmRow whose first column
        # is the ORM instance. ``scalar_one()`` extracts it.
        out: InvestigationReviewOrm = result.scalar_one()
        if row is None:
            self.success(
                f"Review created for {target_kind} {target_id}: "
                f"status={out.review_status} hidden={out.is_hidden}"
            )
        else:
            self.info(
                f"Review updated for {target_kind} {target_id}: "
                f"status={out.review_status} hidden={out.is_hidden}"
            )
        return out

    async def delete(self, review_id: UUID) -> bool:
        """Delete a review row by id. Returns ``True`` if a row was removed.

        Used by the API when an engineer wants to fully reset a
        decision rather than transition the status — semantically
        equivalent to "this investigation was never reviewed".
        """
        row = await self.get(review_id)
        if row is None:
            return False
        await self._session.delete(row)
        await self._session.flush()
        self.info(f"Review deleted: {review_id}")
        return True

    async def delete_for_target(self, target_kind: str, target_id: UUID) -> bool:
        """Drop the review row (if any) for a polymorphic target.

        Used by ``DELETE /cpt/{id}`` and ``DELETE /borehole/{id}`` to
        clear the matching review row alongside the investigation
        itself. ``investigation_review`` has no DB-side FK to the
        target tables (the anchor is polymorphic), so without this
        call the review row dangles after the investigation it
        points at is gone — surfaced as orphan rows in the bundle
        on Save.

        Returns ``True`` when a row was removed, ``False`` when no
        review existed for the target (the common "never-reviewed"
        case).
        """
        row = await self.get_for_target(target_kind, target_id)
        if row is None:
            return False
        await self._session.delete(row)
        await self._session.flush()
        self.info(f"Review cascaded on {target_kind} {target_id} delete")
        return True

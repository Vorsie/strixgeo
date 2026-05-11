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

        row = await self.get_for_target(target_kind, target_id)
        if row is None:
            row = InvestigationReviewOrm(
                id=uuid7(),
                app_project_id=app_project_id,
                target_kind=target_kind,
                target_id=target_id,
                review_status=patch.get("review_status", "unreviewed"),
                review_notes=patch.get("review_notes"),
                is_hidden=patch.get("is_hidden", False),
                reviewed_at=(
                    datetime.now(UTC) if patch.get("review_status") == "reviewed" else None
                ),
            )
            self._session.add(row)
            await self._session.flush()
            self.success(
                f"Review created for {target_kind} {target_id}: "
                f"status={row.review_status} hidden={row.is_hidden}"
            )
            return row

        # Update path — only write keys actually present in patch so
        # callers can PATCH a single field without resetting siblings.
        for key in ("review_status", "review_notes", "is_hidden"):
            if key in patch:
                setattr(row, key, patch[key])

        # ``reviewed_at`` is derived from review_status transitions. We
        # only touch it when the caller is changing review_status this
        # turn — explicit "set notes without bumping reviewed_at" keeps
        # the original review timestamp intact.
        if "review_status" in patch:
            row.reviewed_at = datetime.now(UTC) if patch["review_status"] == "reviewed" else None

        await self._session.flush()
        self.info(
            f"Review updated for {target_kind} {target_id}: "
            f"status={row.review_status} hidden={row.is_hidden}"
        )
        return row

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

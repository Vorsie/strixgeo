"""Clear the review flag on correlation edges the engineer has confirmed.

Why this exists
---------------
A re-subdivide can leave an accepted geotech tie attached to a band that is not
obviously the one it was drawn on — the packing class re-derived, or several
same-class bands overlap where the old one was.  Those ties are carried and
stamped with ``review_reason`` rather than deleted, because the owner's rule
(2026-08-02) is that an accepted edge never disappears without them deleting it
(:mod:`groundmodel.application.geotech_tie_reanchor`).

This is the other half of that: the engineer looks at a flagged tie and either
deletes it (the existing right-click delete) or says "yes, that is right", which
is this use case.  Without it the flag would be permanent and the section would
accumulate warnings nobody can clear.

What it does NOT do
-------------------
Clearing the flag changes no geometry and no approval state.  A flagged edge is
already ``user_approved`` — it is awaiting confirmation, not pending acceptance —
so there is nothing to approve and nothing to move.  Only the flag is dropped.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.dml_rowcount import dml_rowcount
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class ConfirmCorrelationEdgeReviewResult:
    """Outcome of clearing review flags.

    Attributes
    ----------
    edges_confirmed : int
        How many edges actually had a flag cleared.  Zero is a normal answer —
        confirming an unflagged edge is a no-op, not an error.
    """

    edges_confirmed: int


class ConfirmCorrelationEdgeReview(GroundModelLogger):
    """Drop ``review_reason`` from one edge or from a whole model.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session, owned by the caller.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        model_id: UUID,
        edge_id: UUID | None = None,
    ) -> ConfirmCorrelationEdgeReviewResult:
        """Clear the review flag on a model's edges.

        Parameters
        ----------
        model_id : UUID
            The model whose edges are confirmed.  Always constrains the
            statement, so an ``edge_id`` from a different model matches nothing
            rather than being confirmed across the model boundary.
        edge_id : UUID | None
            One edge to confirm, or ``None`` to confirm every flagged edge of
            the model ("confirm all", after the engineer has reviewed them).

        Returns
        -------
        ConfirmCorrelationEdgeReviewResult
            How many edges had a flag cleared.
        """
        self.debug(
            f"ConfirmCorrelationEdgeReview.execute: model={model_id} "
            f"edge={edge_id if edge_id is not None else 'ALL flagged'}"
        )
        stmt = (
            update(LithoContactCorrelationEdgeOrm)
            .where(
                LithoContactCorrelationEdgeOrm.model_id == model_id,
                # Restricting to flagged rows makes the rowcount mean "flags
                # cleared" rather than "rows touched", so re-confirming reports
                # 0 instead of silently looking like work happened.
                LithoContactCorrelationEdgeOrm.review_reason.is_not(None),
            )
            .values(review_reason=None)
        )
        if edge_id is not None:
            stmt = stmt.where(LithoContactCorrelationEdgeOrm.id == edge_id)

        result = await self._session.execute(stmt)
        confirmed = int(dml_rowcount(result) or 0)
        await self._session.commit()

        self.success(
            f"ConfirmCorrelationEdgeReview.execute: model={model_id} "
            f"cleared {confirmed} review flag(s)"
        )
        return ConfirmCorrelationEdgeReviewResult(edges_confirmed=confirmed)

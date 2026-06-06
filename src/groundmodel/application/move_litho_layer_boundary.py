"""Move-litho-layer-boundary use case (Slice A2).

Atomic two-row depth update: the **shared boundary** between two
adjacent same-anchor layers moves to a new depth. The upper layer's
``depth_base_m`` AND the lower layer's ``depth_top_m`` change to the
same ``new_depth_m`` in one DB transaction. This is the
``applyCrossMergeOnDrag`` replacement on the server side — cross-store
dispatch retires.

Validation
----------
* Both layer ids must exist and belong to the URL's model (scope
  guard runs in the router).
* The two layers must be on the SAME anchor (both have the same
  ``cpt_id`` or the same ``borehole_id``). Cross-anchor "shared
  boundaries" are nonsensical and rejected with a 422.
* The two layers must be ADJACENT on that anchor — the upper's
  current ``depth_base_m`` must equal the lower's current
  ``depth_top_m``. Non-adjacency means the caller picked the wrong
  pair; reject with a 422.
* ``new_depth_m`` must leave BOTH layers at least
  ``_MIN_LAYER_THICKNESS_M`` thick (a strict ordering check is not
  enough: a near-zero-thickness result rounds to a degenerate range
  and trips the no-overlap exclusion constraint as an unhandled 500).
  Out of range = reject with a 422. As defence-in-depth, an
  ``IntegrityError`` at commit is also caught and re-raised as a 422.

Idempotent in the trivial sense: passing ``new_depth_m`` equal to the
current shared boundary is a no-op that still returns 200 with the
two unchanged rows.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Minimum resulting layer thickness for a boundary move. The no-overlap
# exclusion constraint rounds depths to the millimetre (round(.,3)); a move
# that leaves a layer thinner than this collapses to an empty/degenerate range
# at the DB and trips ``litho_layer_accepted_no_overlap`` (dogfeed/e2e
# 2026-06-06: a 1µm layer surfaced as an unhandled 500). Reject such moves
# cleanly instead — the FE drag clamp keeps a larger gap, so a normal drag
# never reaches this floor.
_MIN_LAYER_THICKNESS_M = 0.001


class BoundaryMoveError(ValueError):
    """Raised when the move violates an invariant (router → 422)."""


@dataclass
class BoundaryMoveResult:
    """Outcome of a successful boundary move."""

    upper: LithoLayerOrm
    lower: LithoLayerOrm


class MoveLithoLayerBoundary(GroundModelLogger):
    """Atomically move the shared boundary between two adjacent layers."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = LithoLayerRepository(session)

    async def execute(
        self,
        upper_layer_id: UUID,
        lower_layer_id: UUID,
        new_depth_m: float,
    ) -> BoundaryMoveResult:
        """Move the shared boundary, committing both rows atomically.

        Raises
        ------
        BoundaryMoveError
            On any invariant violation (missing rows, mismatched
            anchor, non-adjacent, or new depth would invert a layer).
        """
        self.debug(
            f"MoveLithoLayerBoundary: upper={upper_layer_id} "
            f"lower={lower_layer_id} new_depth_m={new_depth_m:.3f}"
        )
        rows = await self._repo.list_layers_by_ids([upper_layer_id, lower_layer_id])
        by_id = {r.id: r for r in rows}
        upper = by_id.get(upper_layer_id)
        lower = by_id.get(lower_layer_id)
        if upper is None or lower is None:
            missing = [str(lid) for lid in (upper_layer_id, lower_layer_id) if lid not in by_id]
            raise BoundaryMoveError(f"Layer not found: {', '.join(missing)}")

        # Same-anchor check. Both XOR sides must match.
        if (upper.cpt_id, upper.borehole_id) != (lower.cpt_id, lower.borehole_id):
            raise BoundaryMoveError(
                "Boundary move: upper and lower layers must be on the same anchor"
            )

        # Adjacency: upper.depth_base_m == lower.depth_top_m. Allow a
        # tiny float-equality tolerance so a previous drag that landed
        # at e.g. 2.000000000001 vs 2.0 doesn't reject.
        if abs(upper.depth_base_m - lower.depth_top_m) > 1e-6:
            raise BoundaryMoveError(
                "Boundary move: upper.depth_base_m must equal lower.depth_top_m "
                f"(got upper.base={upper.depth_base_m}, lower.top={lower.depth_top_m})"
            )

        # Depth-range guard: the new boundary must leave BOTH layers at least
        # ``_MIN_LAYER_THICKNESS_M`` thick. Stricter than a bare ordering check
        # (``upper.top < new < lower.base``) so a near-zero-thickness result —
        # which the no-overlap exclusion constraint rejects at commit — is
        # turned into a clean 422 rather than an unhandled 500.
        if (
            new_depth_m - upper.depth_top_m < _MIN_LAYER_THICKNESS_M
            or lower.depth_base_m - new_depth_m < _MIN_LAYER_THICKNESS_M
        ):
            raise BoundaryMoveError(
                f"Boundary move: new_depth_m ({new_depth_m}) must leave both "
                f"layers >= {_MIN_LAYER_THICKNESS_M} m thick between "
                f"upper.depth_top_m ({upper.depth_top_m}) and "
                f"lower.depth_base_m ({lower.depth_base_m})"
            )

        # Apply the atomic update — same session, single flush + commit.
        upper.depth_base_m = new_depth_m
        lower.depth_top_m = new_depth_m
        try:
            await self._session.flush()
            await self._session.commit()
        except IntegrityError as err:
            # Defence-in-depth: any residual no-overlap / constraint violation
            # the range guard above didn't pre-empt becomes a clean 422, never
            # a 500. Roll back so the session is reusable.
            await self._session.rollback()
            raise BoundaryMoveError(
                "Boundary move rejected: it would overlap or collapse a layer"
            ) from err
        # See UpdateLithoLayer: refresh so Pydantic doesn't lazy-load
        # the server-side onupdate `updated_at` outside the greenlet.
        await self._session.refresh(upper)
        await self._session.refresh(lower)
        self.success(
            f"MoveLithoLayerBoundary ok upper={upper_layer_id} "
            f"lower={lower_layer_id} new_depth_m={new_depth_m:.3f}"
        )
        return BoundaryMoveResult(upper=upper, lower=lower)

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

from groundmodel.application.body_partition_lock import (
    lock_body_partition,
    lock_sibling_geotech_partitions,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.constants.db_constraints import MIN_LAYER_THICKNESS_M
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Minimum resulting layer thickness for a boundary move: a move that would leave
# a layer thinner than this is rejected cleanly (the FE drag clamp keeps a larger
# gap, so a normal drag never reaches this floor). Rationale + value:
# ``MIN_LAYER_THICKNESS_M``.
_MIN_LAYER_THICKNESS_M = MIN_LAYER_THICKNESS_M


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
        model_id: UUID | None = None,
    ) -> BoundaryMoveResult:
        """Move the shared boundary, committing both rows atomically.

        Parameters
        ----------
        upper_layer_id, lower_layer_id : UUID
            The two adjacent layers sharing the boundary to move.
        new_depth_m : float
            The new shared-boundary depth.
        model_id : UUID, optional
            When given, both layers must belong to this model or the move is
            rejected as not-found (audit #2 IDOR guard). The router always
            passes the URL's model id.

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
        rows = await self._repo.list_layers_by_ids(
            [upper_layer_id, lower_layer_id], model_id=model_id
        )
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

        # Serialise this write with a concurrent ``bodies/recompute`` on the same
        # model. The two UPDATEs below take a FOR-KEY-SHARE row lock on the ``body``
        # each layer's ``body_id`` references — the SAME rows ``_run_resolver``
        # re-stamps ``body_id`` on under the per-model advisory lock. Without taking
        # that shared lock here first, this writer holds body-row locks while
        # recompute holds the advisory lock and waits on those rows — the BP-2/BP-4
        # ABBA deadlock. Taken AFTER the validation raises (a rejected move 422s
        # without queuing behind a live writer) and BEFORE the first write, in the
        # resolver's canonical order (own litho lock, then the sibling geotech
        # children — a no-op when the model has no geotech child). ``upper.model_id``
        # is the litho model both layers belong to (the anchor check proved they
        # share it).
        await lock_body_partition(
            self._session, model_id=upper.model_id, operation="move-litho-layer-boundary"
        )
        await lock_sibling_geotech_partitions(
            self._session, litho_model_id=upper.model_id, operation="move-litho-layer-boundary"
        )

        # Apply the atomic update — same session, single flush + commit.
        upper.depth_base_m = new_depth_m
        lower.depth_top_m = new_depth_m
        # The coupled geological contact rides along, in this SAME transaction.
        #
        # A litho layer derived from the geological model names its origin in
        # ``parent_geo_contact_id``, and on a real model about a third of them do.
        # That contact is not merely near this boundary — it IS this boundary, the
        # same physical surface recorded once per model.  Moving one and not the
        # other splits it into two records that disagree, and nothing downstream
        # reports the disagreement.
        #
        # The LOWER row's parent is the one that matters: the boundary being moved
        # is that layer's TOP, whereas the upper layer's parent describes its own
        # top, metres away and unaffected.  A dangling link (parent since deleted)
        # carries nothing and is not an error.
        if lower.parent_geo_contact_id is not None:
            geo_contact = await self._repo.get_formation_contact(lower.parent_geo_contact_id)
            if geo_contact is not None:
                self.debug(
                    f"MoveLithoLayerBoundary: carrying coupled geological contact "
                    f"{geo_contact.id} {geo_contact.depth_top_m:.3f} → {new_depth_m:.3f} m"
                )
                geo_contact.depth_top_m = new_depth_m
                # The TIN was interpolated THROUGH this contact at its old depth, so it
                # now describes a boundary the section disagrees with. Same transaction,
                # same rule every other contact-mutating use case follows.
                await self._repo.mark_geo_surfaces_stale(
                    [(geo_contact.model_id, geo_contact.formation_id)]
                )
            else:
                self.warning(
                    f"MoveLithoLayerBoundary: layer {lower.id} names geological contact "
                    f"{lower.parent_geo_contact_id}, which no longer exists — boundary "
                    f"moved, nothing carried"
                )
        # Geometry change → 3-D solid cache is stale.  Idempotent no-op when no
        # solid rows exist yet.  Called before commit so the UPDATE is part of the
        # same transaction (mirrors the contact-CRUD cascade sites).
        await self._repo.mark_litho_solids_stale(upper.model_id)
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

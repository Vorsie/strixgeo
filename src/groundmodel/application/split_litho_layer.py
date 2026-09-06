"""Split-litho-layer use case.

"Split here" — cut one accepted ``litho_layer`` at a clicked depth into TWO
accepted layers that keep the same composition (same ``formation_id``).  The
top half keeps the original row (its base shrinks to the split depth); the
bottom half is a fresh row ``[split_depth, original_base]`` on the same anchor.

Atomic by necessity
-------------------
The column carries a DEFERRED no-overlap exclusion constraint AND a deferred
contiguity trigger, both checked at COMMIT.  Shrinking the original base and
inserting the bottom half must therefore land in ONE transaction: a
bulk-create + a separate boundary-move would each commit, and the first commit
would trip the constraints (the two rows transiently overlap / leave a gap).
Inside one transaction the intermediate overlap is tolerated and both rows meet
cleanly at the split depth by commit.

Validation
----------
* The layer must exist and belong to the URL's model (IDOR scope).
* ``depth_m`` (mm-rounded, matching the stored precision) must leave BOTH halves
  at least ``_MIN_LAYER_THICKNESS_M`` thick — a near-zero-thickness half rounds
  to a degenerate range and trips the no-overlap exclusion as an unhandled 500,
  so it is rejected as a clean ``SplitError`` (router → 422) instead.  As
  defence-in-depth an ``IntegrityError`` at commit is also caught and re-raised.
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
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Minimum resulting half thickness (metres). Matches MoveLithoLayerBoundary: a
# thinner half collapses to a degenerate mm-rounded range and trips the
# no-overlap exclusion at commit.
_MIN_LAYER_THICKNESS_M = 0.001


class SplitError(ValueError):
    """Raised when the split is invalid (router → 422)."""


@dataclass
class SplitResult:
    """Outcome of a successful split — the (shrunk) top and the new bottom layer."""

    top: LithoLayerOrm
    bottom: LithoLayerOrm


class SplitLithoLayer(GroundModelLogger):
    """Atomically split one accepted litho layer at a depth into two."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = LithoLayerRepository(session)

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        layer_id: UUID,
        depth_m: float,
    ) -> SplitResult | None:
        """Split ``layer_id`` at ``depth_m`` into two contiguous same-composition layers.

        Parameters
        ----------
        project_id : UUID
            Owning project (accepted for symmetry with the other litho write
            use cases; the model scope below is the actual guard).
        model_id : UUID
            The lithostratigraphic model the layer belongs to (IDOR scope).
        layer_id : UUID
            The layer to split.
        depth_m : float
            The split boundary depth. Mm-rounded to match stored precision.

        Returns
        -------
        SplitResult | None
            The shrunk top layer + the new bottom layer, or ``None`` when the
            layer does not exist or is outside ``model_id``.

        Raises
        ------
        SplitError
            When the split depth would leave either half thinner than
            ``_MIN_LAYER_THICKNESS_M`` (router → 422), or when the commit trips a
            residual integrity constraint.
        """
        # Round to the millimetre the column is stored at, so the thickness guard
        # and the two resulting rows use the same precision the DB will.
        depth_m = round(depth_m, 3)
        self.info(f"SplitLithoLayer: layer={layer_id} model={model_id} depth={depth_m:.3f}m")

        # Scope read BEFORE the lock (IDOR guard): a missing / foreign-model layer
        # 404s without queuing behind a live writer.
        pre = await self._session.get(LithoLayerOrm, layer_id)
        if pre is None or pre.model_id != model_id:
            self.warning(f"SplitLithoLayer: layer={layer_id} not found in model {model_id}")
            return None

        # The split depth must leave BOTH halves at least the min thickness. A
        # bare ordering check (top < depth < base) is not enough — a hair-thin
        # half rounds to a degenerate range and trips the no-overlap exclusion.
        if (
            depth_m - pre.depth_top_m < _MIN_LAYER_THICKNESS_M
            or pre.depth_base_m - depth_m < _MIN_LAYER_THICKNESS_M
        ):
            raise SplitError(
                f"Split depth ({depth_m}) must leave both halves >= "
                f"{_MIN_LAYER_THICKNESS_M} m thick between the layer's top "
                f"({pre.depth_top_m}) and base ({pre.depth_base_m})"
            )

        # Serialise with a concurrent bodies/recompute on the same model (the
        # UPDATE + INSERT take FOR-KEY-SHARE row locks on the body rows recompute
        # re-stamps). Own litho lock, then the sibling geotech children — the
        # resolver's canonical order (BP-2/BP-4). Taken AFTER validation raises.
        await lock_body_partition(
            self._session, model_id=pre.model_id, operation="split-litho-layer"
        )
        await lock_sibling_geotech_partitions(
            self._session, litho_model_id=pre.model_id, operation="split-litho-layer"
        )

        original_base = pre.depth_base_m
        # Top half keeps the original row; its base shrinks to the split depth.
        pre.depth_base_m = depth_m
        # Bottom half is a fresh row on the same anchor + composition. The split
        # depth is a NEW boundary, coupled to no geological contact, so the
        # bottom layer carries no parent_geo_contact_id / observation ids / notes.
        bottom = await self._repo.create_layer(
            model_id=pre.model_id,
            formation_id=pre.formation_id,
            depth_top_m=depth_m,
            depth_base_m=original_base,
            status=pre.status,
            source=pre.source,
            confidence=pre.confidence,
            borehole_id=pre.borehole_id,
            cpt_id=pre.cpt_id,
        )
        # Geometry change → 3-D solid cache is stale (idempotent no-op when none).
        await self._repo.mark_litho_solids_stale(pre.model_id)
        # A new same-litho layer changes body membership — re-derive ordinals +
        # body_id in this SAME transaction (commit=False, like DeleteLithoLayer).
        await ResolveLithoInstances(self._session).execute(model_id=model_id, commit=False)
        try:
            await self._session.commit()
        except IntegrityError as err:
            # Defence-in-depth: any residual no-overlap / contiguity violation the
            # thickness guard did not pre-empt becomes a clean 422, never a 500.
            await self._session.rollback()
            raise SplitError(
                "Split rejected: it would overlap or leave a gap in the column"
            ) from err
        await self._session.refresh(pre)
        await self._session.refresh(bottom)
        self.success(
            f"SplitLithoLayer ok layer={layer_id} → "
            f"top [{pre.depth_top_m:.3f},{pre.depth_base_m:.3f}] "
            f"+ bottom {bottom.id} [{bottom.depth_top_m:.3f},{bottom.depth_base_m:.3f}]"
        )
        return SplitResult(top=pre, bottom=bottom)

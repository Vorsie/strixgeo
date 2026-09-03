"""Update-litho-layer use case (Slice A2 of the unified litho boundary model).

PATCH a single ``litho_layer`` row's depth / formation / status /
confidence / anchor / coupling / notes. Routes through the application
layer so future cross-cutting concerns (audit log, refetch triggers,
side-effects on the geo↔litho coupling) have one seam to plug into.

Trust-the-caller: the Pydantic request schema enforces depth ordering
+ the literal allowlists; the DB CHECK constraints are the safety
net. This use case is a thin wrapper over the repository's update.
"""

from __future__ import annotations

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
from groundmodel.shared.constants.db_constraints import LITHO_LAYER_NO_OVERLAP_CONSTRAINT
from groundmodel.shared.exceptions import LithoLayerOverlapError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# The exclusion constraint added in f7a8b9c0d1e2 — its name appears verbatim in
# the asyncpg error text, so we can tell it apart from any other integrity
# violation and translate only this one into a clean domain error. Shared with
# the API layer's translation of the same violation (routers/_helpers.py).
_NO_OVERLAP_CONSTRAINT = LITHO_LAYER_NO_OVERLAP_CONSTRAINT


class UpdateLithoLayer(GroundModelLogger):
    """Apply a partial update to one ``litho_layer`` row + commit."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = LithoLayerRepository(session)

    async def execute(
        self,
        layer_id: UUID,
        patch: dict[str, object],
        model_id: UUID | None = None,
    ) -> LithoLayerOrm | None:
        """Mutate the layer and commit.

        Parameters
        ----------
        layer_id : UUID
            Target row.
        patch : dict
            Column-name → new-value pairs. Empty patch = no-op (returns
            the unchanged row).
        model_id : UUID, optional
            When given, the layer must belong to this model or the update is
            rejected as not-found (audit #2 IDOR guard). The router always
            passes the URL's model id.

        Returns
        -------
        LithoLayerOrm | None
            The updated row, or ``None`` when the id does not exist (or is
            outside ``model_id`` when that scope is given).

        Raises
        ------
        LithoLayerOverlapError
            When the edit would overlap an accepted sibling on the same
            investigation (the deferred no-overlap exclusion constraint fires
            at commit). Any other integrity error propagates unchanged.
        """
        self.debug(f"UpdateLithoLayer: id={layer_id} patch_keys={list(patch.keys())}")

        # Scope read BEFORE the lock (the IDOR guard): a not-found or out-of-model
        # layer 404s without queuing behind a live writer (mirrors DeleteBody). The
        # get warms the identity map, so ``update_layer``'s own get below is a free
        # hit, not a second round-trip.
        pre = await self._session.get(LithoLayerOrm, layer_id)
        if pre is None or (model_id is not None and pre.model_id != model_id):
            self.warning(f"UpdateLithoLayer: id={layer_id} not found")
            return None

        # Serialise this write with a concurrent ``bodies/recompute`` on the same
        # model: the patch may change the row's depth / formation / body_id, and the
        # flush takes a row lock recompute also re-stamps under the per-model advisory
        # lock. Take the advisory lock (own litho, then the sibling geotech children —
        # a no-op when the model has no geotech child) BEFORE ``update_layer``'s flush,
        # in the resolver's canonical order, so the two serialise rather than
        # deadlocking (BP-2/BP-4). Keyed on the layer's own model.
        await lock_body_partition(
            self._session, model_id=pre.model_id, operation="update-litho-layer"
        )
        await lock_sibling_geotech_partitions(
            self._session, litho_model_id=pre.model_id, operation="update-litho-layer"
        )

        layer = await self._repo.update_layer(layer_id, patch, model_id=model_id)
        if layer is None:
            self.warning(f"UpdateLithoLayer: id={layer_id} not found")
            return None
        # Geometry / formation / status change → 3-D solid cache is stale.
        # Idempotent no-op when no solid rows exist yet.  Called before commit so
        # the UPDATE is part of the same transaction (mirrors contact-CRUD sites).
        await self._repo.mark_litho_solids_stale(layer.model_id)
        try:
            await self._session.commit()
        except IntegrityError as err:
            await self._session.rollback()
            if _NO_OVERLAP_CONSTRAINT in str(err.orig):
                self.warning(
                    f"UpdateLithoLayer: id={layer_id} rejected — edit would overlap "
                    "an accepted layer on the same investigation"
                )
                raise LithoLayerOverlapError(layer_id) from err
            raise
        # onupdate=func.now() on updated_at expires the in-memory value
        # at flush; refresh so Pydantic's response serializer doesn't
        # try a lazy-load outside the async greenlet (MissingGreenlet).
        await self._session.refresh(layer)
        self.success(f"UpdateLithoLayer ok id={layer_id}")
        return layer

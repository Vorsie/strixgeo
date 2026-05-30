"""Batch-update-litho-layers use case (A4 slice 4b).

Atomic PATCH for N layer rows. All-or-nothing scope check before any
mutation — if any layer_id is unknown, the whole call rejects with no
side effects. Mirrors the existing batch update on the contact side
(``UpdateFormationContactsBatch``) so the FE swap from
``api.geology.updateContactsBatch`` to ``api.geology.batchUpdateLayers``
preserves the all-or-nothing contract the section editor's multi-drag
+ cross-column MOVE gestures rely on.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class BatchUpdateError(ValueError):
    """Raised when the batch references unknown layer ids (router → 422)."""


@dataclass
class BatchUpdateResult:
    """Outcome of a successful batch update."""

    updated_count: int
    layers: list[LithoLayerOrm]


class BatchUpdateLithoLayers(GroundModelLogger):
    """Apply per-row patches to N layers in one transaction."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = LithoLayerRepository(session)

    async def execute(
        self,
        patches: list[tuple[UUID, dict[str, Any]]],
    ) -> BatchUpdateResult:
        """Apply patches atomically.

        Parameters
        ----------
        patches : list[tuple[UUID, dict]]
            ``(layer_id, patch_dict)`` pairs. Empty list = no-op.

        Raises
        ------
        BatchUpdateError
            When any layer_id in the input is missing from the DB.
        """
        self.debug(f"BatchUpdateLithoLayers: count={len(patches)}")
        if not patches:
            return BatchUpdateResult(updated_count=0, layers=[])

        layer_ids = [lid for lid, _ in patches]
        existing = await self._repo.list_layers_by_ids(layer_ids)
        if len(existing) != len(layer_ids):
            found = {r.id for r in existing}
            missing = [str(lid) for lid in layer_ids if lid not in found]
            raise BatchUpdateError(f"Layers not found: {', '.join(missing)}")

        # Index by id for O(1) lookup as we apply each patch.
        by_id = {r.id: r for r in existing}
        out: list[LithoLayerOrm] = []
        for layer_id, patch in patches:
            row = by_id[layer_id]
            for key, value in patch.items():
                setattr(row, key, value)
            out.append(row)

        await self._session.flush()
        await self._session.commit()
        # See UpdateLithoLayer / BatchUpdateLithoLayerStatus: refresh
        # so Pydantic doesn't lazy-load the server-side onupdate
        # ``updated_at`` outside the greenlet.
        for row in out:
            await self._session.refresh(row)
        self.success(f"BatchUpdateLithoLayers ok count={len(out)}")
        return BatchUpdateResult(updated_count=len(out), layers=out)

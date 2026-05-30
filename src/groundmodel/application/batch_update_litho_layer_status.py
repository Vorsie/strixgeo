"""Batch-update-litho-layer-status use case (Slice A2).

Bulk status transition on a set of ``litho_layer`` rows in one
transaction. Replaces the per-row PATCH loop the "accept all" and
"reject all" verbs would otherwise need.

All-or-nothing scope check: every id must exist + belong to the URL's
model (router-level guard) before any row is mutated. If any id is
missing, the whole call rejects with no side effects.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class BatchStatusError(ValueError):
    """Raised when the batch references unknown layer ids (router → 422)."""


@dataclass
class BatchStatusResult:
    """Outcome of a successful batch status transition."""

    updated_count: int
    layers: list[LithoLayerOrm]


class BatchUpdateLithoLayerStatus(GroundModelLogger):
    """Set the same status on N layer rows in one transaction."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = LithoLayerRepository(session)

    async def execute(
        self,
        layer_ids: list[UUID],
        new_status: str,
    ) -> BatchStatusResult:
        """Mutate status on every id and commit atomically.

        Parameters
        ----------
        layer_ids : list[UUID]
            Target rows. Empty list = no-op (returns count=0).
        new_status : str
            One of ``"pending"`` / ``"accepted"`` / ``"rejected"``.
            The DB CHECK enforces the literal; this method trusts the
            caller (the Pydantic request schema does the early check).

        Raises
        ------
        BatchStatusError
            When any id in the input is missing from the DB.
        """
        self.debug(f"BatchUpdateLithoLayerStatus: count={len(layer_ids)} new_status={new_status}")
        if not layer_ids:
            return BatchStatusResult(updated_count=0, layers=[])

        rows = await self._repo.list_layers_by_ids(layer_ids)
        if len(rows) != len(layer_ids):
            found = {r.id for r in rows}
            missing = [str(lid) for lid in layer_ids if lid not in found]
            raise BatchStatusError(f"Layers not found: {', '.join(missing)}")

        for row in rows:
            row.status = new_status
        await self._session.flush()
        await self._session.commit()
        # See UpdateLithoLayer: refresh so Pydantic doesn't lazy-load
        # the server-side onupdate `updated_at` outside the greenlet.
        for row in rows:
            await self._session.refresh(row)
        self.success(f"BatchUpdateLithoLayerStatus ok count={len(rows)} status={new_status}")
        return BatchStatusResult(updated_count=len(rows), layers=rows)

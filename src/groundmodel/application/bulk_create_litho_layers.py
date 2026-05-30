"""Bulk-create-litho-layers use case (Slice A2).

Insert N ``litho_layer`` rows in one transaction. The intended caller
is the suggest-litho flow at the segmenter boundary: the segmenter
produces a list of suggestion layers, this use case persists them all
as ``status='pending'`` rows in one round-trip. Saves N inserts +
N flushes for the typical 20-layer column.

No find-or-create — the suggest flow always inserts fresh. If the
caller wants idempotency, it should ``ClearLithoModel`` (or per-anchor
delete-then-insert) first.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class LithoLayerCreateRequest:
    """Per-layer payload for the bulk-create."""

    formation_id: UUID
    depth_top_m: float
    depth_base_m: float
    status: str = "pending"
    source: str = "segmenter"
    confidence: str = "medium"
    borehole_id: UUID | None = None
    cpt_id: UUID | None = None
    observation_id: UUID | None = None
    observation_layer_id: UUID | None = None
    parent_geo_contact_id: UUID | None = None
    notes: str | None = None


class BulkCreateLithoLayers(GroundModelLogger):
    """Insert N ``litho_layer`` rows + commit."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        model_id: UUID,
        layers: list[LithoLayerCreateRequest],
    ) -> list[LithoLayerOrm]:
        """Persist every layer + commit atomically.

        Parameters
        ----------
        model_id : UUID
            Target litho model.
        layers : list[LithoLayerCreateRequest]
            Per-layer payloads. Empty list = no-op (returns []).

        Returns
        -------
        list[LithoLayerOrm]
            Persisted rows in input order.
        """
        self.debug(f"BulkCreateLithoLayers: model={model_id} count={len(layers)}")
        if not layers:
            return []

        rows: list[LithoLayerOrm] = []
        for payload in layers:
            row = LithoLayerOrm(
                id=uuid7(),
                model_id=model_id,
                formation_id=payload.formation_id,
                depth_top_m=payload.depth_top_m,
                depth_base_m=payload.depth_base_m,
                status=payload.status,
                source=payload.source,
                confidence=payload.confidence,
                borehole_id=payload.borehole_id,
                cpt_id=payload.cpt_id,
                observation_id=payload.observation_id,
                observation_layer_id=payload.observation_layer_id,
                parent_geo_contact_id=payload.parent_geo_contact_id,
                notes=payload.notes,
            )
            self._session.add(row)
            rows.append(row)
        await self._session.flush()
        await self._session.commit()
        # server_default=func.now() on created_at / updated_at expires
        # the in-memory values at flush; refresh so Pydantic's response
        # serializer doesn't lazy-load outside the greenlet.
        for row in rows:
            await self._session.refresh(row)
        self.success(f"BulkCreateLithoLayers ok model={model_id} created={len(rows)}")
        return rows

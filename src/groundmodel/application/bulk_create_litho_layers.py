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

from groundmodel.application.body_partition_lock import (
    lock_body_partition,
    lock_sibling_geotech_partitions,
)
from groundmodel.application.litho_layer_helpers import repopulate_layers_after_commit
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
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
        *,
        project_id: UUID | None = None,
    ) -> list[LithoLayerOrm]:
        """Persist every layer + commit atomically.

        Parameters
        ----------
        model_id : UUID
            Target litho model.
        layers : list[LithoLayerCreateRequest]
            Per-layer payloads. Empty list = no-op (returns []).
        project_id : UUID | None
            When provided, every ``formation_id`` in ``layers`` is checked
            against the formation's ``app_project_id`` before any write.  A
            mismatch (cross-project formation id) raises ``ValueError`` so
            foreign-project formations are never silently accepted (debt #211-a).
            When ``None`` the check is skipped for backwards compatibility with
            existing callers that have not yet been updated to pass the project.

        Returns
        -------
        list[LithoLayerOrm]
            Persisted rows in input order.

        Raises
        ------
        ValueError
            When ``project_id`` is provided and any ``formation_id`` does not
            exist or belongs to a different project.
        """
        self.debug(f"BulkCreateLithoLayers: model={model_id} count={len(layers)}")
        if not layers:
            return []

        # ------------------------------------------------------------------ #
        # Scope guard (debt #211-a) — verify every formation_id belongs to   #
        # the caller's project before touching the DB.  Deduplicating the    #
        # formation ids avoids redundant round-trips for the common case      #
        # where many layers share the same formation.                         #
        # ------------------------------------------------------------------ #
        if project_id is not None:
            seen_formation_ids: set[UUID] = set()
            for payload in layers:
                if payload.formation_id not in seen_formation_ids:
                    await load_scoped_or_raise(
                        self._session,
                        GeologicalFormationOrm,
                        payload.formation_id,
                        project_id,
                        label="Formation",
                    )
                    seen_formation_ids.add(payload.formation_id)
            self.debug(
                f"BulkCreateLithoLayers: scope guard passed for "
                f"{len(seen_formation_ids)} unique formation(s)"
            )

        # Serialise these INSERTs with a concurrent ``bodies/recompute`` on the same
        # model: a ``litho_layer`` INSERT takes a FOR-KEY-SHARE row lock on any
        # ``body`` its ``body_id`` references, and recompute re-stamps those same
        # rows under the per-model advisory lock. Take the advisory lock (own litho,
        # then the sibling geotech children — a no-op when the model has no geotech
        # child) BEFORE the first ``session.add`` below, in the resolver's canonical
        # order, so the write serialises with recompute rather than deadlocking
        # (BP-2/BP-4). After the scope guard so a cross-project formation still 404s
        # without queuing behind a live writer.
        await lock_body_partition(
            self._session, model_id=model_id, operation="bulk-create-litho-layers"
        )
        await lock_sibling_geotech_partitions(
            self._session, litho_model_id=model_id, operation="bulk-create-litho-layers"
        )

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
        # the in-memory values at flush; repopulate in one round-trip so
        # Pydantic's response serializer doesn't lazy-load outside the
        # greenlet.
        await repopulate_layers_after_commit(self._session, rows)
        self.success(f"BulkCreateLithoLayers ok model={model_id} created={len(rows)}")
        return rows

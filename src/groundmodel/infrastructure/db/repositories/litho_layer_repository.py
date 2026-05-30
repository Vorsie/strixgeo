"""LithoLayerRepository — read-path for the unified litho boundary model.

Slice A1 of the unified litho boundary model
(spec ``docs/superpowers/specs/2026-05-30-unified-litho-boundary-model-design.md``).

Slice A1 ships read methods only — the write path (PATCH layer,
boundary-move, batch-status, bulk-create) lands in Slice A2 alongside
the dual-write transition. List queries are scoped by ``model_id`` +
optional ``borehole_id`` / ``cpt_id`` filters and always return rows
sorted by ``depth_top_m`` ascending, matching the dominant frontend
read pattern ("give me this anchor's layers in top-to-bottom order").
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class LithoLayerRepository(GroundModelLogger):
    """Read-path repository for ``litho_layer`` rows.

    Parameters
    ----------
    session : AsyncSession
        The active SQLAlchemy async session.
    """

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(__name__)
        self._session = session

    async def list_layers(
        self,
        model_id: UUID,
        *,
        borehole_id: UUID | None = None,
        cpt_id: UUID | None = None,
        formation_id: UUID | None = None,
        status: str | None = None,
    ) -> list[LithoLayerOrm]:
        """List layers in a model, optionally filtered + sorted top-to-bottom.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model to scope the query to.
        borehole_id : UUID | None
            Restrict to one borehole anchor's layers. Mutually
            exclusive with ``cpt_id``; caller is trusted (the XOR is
            enforced at the row level by the table CHECK, so combining
            both filters here would return zero rows safely).
        cpt_id : UUID | None
            Restrict to one CPT anchor's layers.
        formation_id : UUID | None
            Restrict to one formation's layers across all anchors.
        status : str | None
            Restrict to one status (``"pending"`` / ``"accepted"`` /
            ``"rejected"``). When absent, all three are returned.

        Returns
        -------
        list[LithoLayerOrm]
            Matching rows, ordered by ``depth_top_m`` ascending.
        """
        stmt = (
            select(LithoLayerOrm)
            .where(LithoLayerOrm.model_id == model_id)
            .order_by(LithoLayerOrm.depth_top_m)
        )
        if borehole_id is not None:
            stmt = stmt.where(LithoLayerOrm.borehole_id == borehole_id)
        if cpt_id is not None:
            stmt = stmt.where(LithoLayerOrm.cpt_id == cpt_id)
        if formation_id is not None:
            stmt = stmt.where(LithoLayerOrm.formation_id == formation_id)
        if status is not None:
            stmt = stmt.where(LithoLayerOrm.status == status)
        return list((await self._session.execute(stmt)).scalars().all())

    async def get_layer(self, layer_id: UUID) -> LithoLayerOrm | None:
        """Load one layer by primary key.

        Returns
        -------
        LithoLayerOrm | None
            The row, or ``None`` when the id does not exist (or has
            been deleted via CASCADE).
        """
        return await self._session.get(LithoLayerOrm, layer_id)

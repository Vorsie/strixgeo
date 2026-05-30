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

    async def update_layer(
        self,
        layer_id: UUID,
        patch: dict[str, object],
    ) -> LithoLayerOrm | None:
        """Apply a partial update to a layer.

        Trust-the-caller: validation (depth ordering, status / source /
        confidence literals) lives in the Pydantic request schema +
        the DB CHECK constraints. This method just maps the dict onto
        the row and flushes.

        Parameters
        ----------
        layer_id : UUID
            Row to update.
        patch : dict
            Column-name → new-value pairs. Keys must be valid column
            names on ``LithoLayerOrm``.

        Returns
        -------
        LithoLayerOrm | None
            The updated row, or ``None`` when the id does not exist.
        """
        layer = await self._session.get(LithoLayerOrm, layer_id)
        if layer is None:
            return None
        for key, value in patch.items():
            setattr(layer, key, value)
        await self._session.flush()
        self.info(f"Layer updated: {layer_id}")
        return layer

    async def create_layer(
        self,
        *,
        model_id: UUID,
        formation_id: UUID,
        depth_top_m: float,
        depth_base_m: float,
        status: str,
        source: str,
        confidence: str = "medium",
        borehole_id: UUID | None = None,
        cpt_id: UUID | None = None,
        observation_id: UUID | None = None,
        observation_layer_id: UUID | None = None,
        parent_geo_contact_id: UUID | None = None,
        notes: str | None = None,
    ) -> LithoLayerOrm:
        """Insert one ``litho_layer`` row and flush.

        The caller owns the id assignment (`uuid7()` is the project
        convention — see other repository write methods).
        """
        from uuid6 import uuid7

        layer = LithoLayerOrm(
            id=uuid7(),
            model_id=model_id,
            formation_id=formation_id,
            depth_top_m=depth_top_m,
            depth_base_m=depth_base_m,
            status=status,
            source=source,
            confidence=confidence,
            borehole_id=borehole_id,
            cpt_id=cpt_id,
            observation_id=observation_id,
            observation_layer_id=observation_layer_id,
            parent_geo_contact_id=parent_geo_contact_id,
            notes=notes,
        )
        self._session.add(layer)
        await self._session.flush()
        self.success(
            f"Layer created: {layer.id} @ [{depth_top_m:.2f}, {depth_base_m:.2f}] m "
            f"status={status} source={source}"
        )
        return layer

    async def delete_layer(self, layer_id: UUID) -> bool:
        """Hard-delete a layer row.

        Returns
        -------
        bool
            ``True`` when the row existed and was removed, ``False``
            when it did not exist. (Idempotent.)
        """
        layer = await self._session.get(LithoLayerOrm, layer_id)
        if layer is None:
            return False
        await self._session.delete(layer)
        await self._session.flush()
        self.info(f"Layer deleted: {layer_id}")
        return True

    async def list_layers_by_ids(self, layer_ids: list[UUID]) -> list[LithoLayerOrm]:
        """Load layers by id in one IN-query.

        Used by the boundary-move + batch-status use cases for the
        all-or-nothing scope check. Returns in arbitrary order; the
        caller indexes by id.
        """
        if not layer_ids:
            return []
        stmt = select(LithoLayerOrm).where(LithoLayerOrm.id.in_(layer_ids))
        return list((await self._session.execute(stmt)).scalars().all())

"""ListLithoLayersForModel — read-path use case for the unified litho model.

Slice A1 of the unified litho boundary model
(spec ``docs/superpowers/specs/2026-05-30-unified-litho-boundary-model-design.md``).

Lists ``litho_layer`` rows belonging to a model, optionally filtered by
anchor (one CPT or one borehole) or by formation or by status. Rows
are returned sorted by ``depth_top_m`` ascending so the renderer can
draw them top-to-bottom without re-sorting.

The scope check (model belongs to URL project) lives in the router;
this layer trusts the call and just queries.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ListLithoLayersForModel(GroundModelLogger):
    """List the layers for a lithostratigraphic model with optional filters.

    Geological models (kind='geological') don't carry litho_layer rows,
    so calling this against a geological model returns an empty list
    rather than raising — keeps the router's response shape predictable
    when the caller passes the wrong model id.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = LithoLayerRepository(session)

    async def execute(
        self,
        model_id: UUID,
        *,
        borehole_id: UUID | None = None,
        cpt_id: UUID | None = None,
        formation_id: UUID | None = None,
        status: str | None = None,
    ) -> list[LithoLayerOrm]:
        """List layers in a model with optional filters.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model to query.
        borehole_id, cpt_id, formation_id, status : optional
            Forwarded to ``LithoLayerRepository.list_layers``.

        Returns
        -------
        list[LithoLayerOrm]
            Sorted by ``depth_top_m`` ascending.
        """
        self.debug(
            f"ListLithoLayersForModel: model={model_id} "
            f"borehole={borehole_id} cpt={cpt_id} "
            f"formation={formation_id} status={status}"
        )
        rows = await self._repo.list_layers(
            model_id,
            borehole_id=borehole_id,
            cpt_id=cpt_id,
            formation_id=formation_id,
            status=status,
        )
        self.debug(f"ListLithoLayersForModel: returning {len(rows)} layer(s)")
        return rows

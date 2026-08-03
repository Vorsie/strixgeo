"""Invalidate every cached geometry that depends on an investigation's collar Z.

An elevation edit moves the absolute z of every contact anchored at that
investigation (``z = elevation_m − depth_top_m``), which makes BOTH cached
geometries wrong: the geological TINs (``formation_surface``) and the 3-D
litho/geotech body solids built by the voxel pipeline (``litho_body_solid``).

Debt #34 closed the TIN half in the two ``PATCH .../elevation`` handlers; the
voxel solid cache landed later, in a different table with a different staleness
flag, and no elevation path ever touched it — so the 3-D viewer kept rendering
bodies at the old elevation with no "needs rebuild" prompt while the 2-D
sections showed the corrected geometry. Both handlers now go through this one
use case so the two caches cannot drift apart again.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class StaleCacheCounts:
    """How many cached rows an elevation edit invalidated.

    Attributes
    ----------
    surfaces : int
        ``formation_surface`` (TIN) rows flipped to stale.
    solids : int
        ``litho_body_solid`` (3-D body) rows flipped to stale.
    models : int
        Distinct models the investigation has contacts in — 0 means the
        investigation carries no interpretation, so nothing needed staling.
    """

    surfaces: int
    solids: int
    models: int


class StaleInvestigationCaches(GroundModelLogger):
    """Flip every cached geometry anchored at one investigation to stale."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession`` (does NOT commit)."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        cpt_id: UUID | None = None,
        borehole_id: UUID | None = None,
    ) -> StaleCacheCounts:
        """Stale the TINs and the 3-D solids that depend on this investigation.

        Does not commit — the caller runs this inside the same transaction as
        the elevation write, so a failed write cannot leave the caches marked
        stale (and a successful one cannot leave them marked fresh).

        Parameters
        ----------
        cpt_id : UUID | None
            The edited CPT, when the anchor is a CPT.
        borehole_id : UUID | None
            The edited borehole, when the anchor is a borehole.

        Returns
        -------
        StaleCacheCounts
            Rows flipped per cache, plus the number of models involved.

        Raises
        ------
        ValueError
            When neither or both anchor ids are supplied.
        """
        geology = GeologyRepository(self._session)
        pairs = await geology.contact_scope_for_investigation(
            cpt_id=cpt_id, borehole_id=borehole_id
        )
        anchor = f"cpt={cpt_id}" if cpt_id is not None else f"borehole={borehole_id}"
        if not pairs:
            self.debug(f"StaleInvestigationCaches({anchor}): no contacts — nothing to stale")
            return StaleCacheCounts(surfaces=0, solids=0, models=0)

        surfaces = await geology.mark_surfaces_stale(pairs)
        # One UPDATE per model, scoped by model_id; a model with no built
        # solids is a legal no-op that returns 0.
        litho_repo = LithoLayerRepository(self._session)
        model_ids = {model_id for model_id, _formation_id in pairs}
        solids = 0
        for model_id in model_ids:
            solids += await litho_repo.mark_litho_solids_stale(model_id)

        self.info(
            f"StaleInvestigationCaches({anchor}): {len(pairs)} (model, formation) pair(s) "
            f"across {len(model_ids)} model(s) → {surfaces} surface(s), {solids} solid(s) stale"
        )
        return StaleCacheCounts(surfaces=surfaces, solids=solids, models=len(model_ids))

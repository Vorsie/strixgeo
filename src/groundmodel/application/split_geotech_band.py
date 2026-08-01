"""Commit a hand split of one NAD packing band into two, on ONE column.

Owner spec 2026-08-01. What this use case does, and the ruling behind each part:

* **The class is derived, not carried** — both halves are reclassified from the
  CPT qc over their own extent (median, the statistic the build classifies on)
  and re-pointed at the geotech formation that carries the resulting class. A
  half whose qc cannot answer gets the "needs review" skeleton formation, the
  same outcome the build produces for thin coverage — never a guessed class.
* **Recalculation is local** — the context loader reads only the edited band's
  own column, so no other column can be re-derived. This use case writes exactly
  two rows: the band being split (resized to the upper half) and one new row for
  the lower half.
* **Hard bounds** — a split depth outside the band's geo-bounded litho body is
  refused by :func:`plan_split` before anything is written. The owner overrules
  the CLASS, not the hierarchy.
* **Manual override always wins** — a resulting band thinner than the configured
  minimum is committed with a warning, not blocked.
* **A borehole is refused** (ruling A) — the class is re-derived from qc, and a
  borehole has none, so :func:`require_cpt_anchor` rejects the split before
  anything is written rather than skeletonising a band whose class
  ``DivideBoreholes`` extrapolated from the surrounding CPTs.

Row identity on a split: the ORIGINAL row becomes the UPPER half, because its
top boundary is the one the split leaves untouched, and a NEW row is inserted for
the lower half. That keeps the upper half's correlations attached to the band
whose top they mark; they are then re-validated against the upper half's new
class and dropped only where the class no longer matches its partner (ruling 4).
The lower half is new and starts with no correlations.

Both edited rows are stamped ``source='manual'``: their depths are the engineer's
now, not the segmenter's, and provenance must say so.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.geotech_band_edit_helpers import (
    GeotechBandEditResult,
    delete_edges,
    formation_for_class,
    invalidated_edge_ids,
    load_edges_for_layers,
    load_geotech_column_context,
    load_nad_class_by_layer,
    require_cpt_anchor,
)
from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.domain.services.geotech_band_reclassification import plan_split
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm

# Depths are rounded to the millimetre before they are written: the no-overlap
# exclusion constraint compares ``round(depth, 3)``, so writing the raw float
# would let sub-millimetre noise decide whether two bands "touch".
_DEPTH_DECIMALS = 3


class SplitGeotechBand(GeotechBoreholeMaterialiser):
    """Split one packing band in two and re-derive both halves' NAD class.

    Inherits :class:`GeotechBoreholeMaterialiser` for its find-or-create
    formation helpers, so a hand edit lands on the SAME formation rows the build
    would have produced.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session. This use case commits once at the end.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__, session)

    async def execute(
        self,
        *,
        project_id: UUID,
        geotech_model_id: UUID,
        band_id: UUID,
        split_depth_m: float,
    ) -> GeotechBandEditResult:
        """Split ``band_id`` at ``split_depth_m`` and commit.

        Parameters
        ----------
        project_id : UUID
            Owning project (scope guard).
        geotech_model_id : UUID
            The geotechnical model the band belongs to.
        band_id : UUID
            The band to split.
        split_depth_m : float
            The new boundary depth (metres, positive down).

        Returns
        -------
        GeotechBandEditResult
            The committed plan, the resulting row ids, and the correlation edges
            that were dropped.

        Raises
        ------
        GeotechBandEditError
            When the band is unknown, or the depth breaches the hierarchy.
        """
        self.info(
            f"SplitGeotechBand: model={geotech_model_id} band={band_id} depth={split_depth_m:.3f} m"
        )
        context = await load_geotech_column_context(
            self._session,
            self,
            project_id=project_id,
            geotech_model_id=geotech_model_id,
            band_id=band_id,
        )
        require_cpt_anchor(context, gesture="Split")
        plan = plan_split(
            bands=context.bands,
            band_id=str(band_id),
            split_depth_m=split_depth_m,
            soil=context.soil,
            admixtures=context.admixtures,
            depth_m=context.depth_m,
            qc_mpa=context.qc_mpa,
            min_thickness_m=context.min_thickness_m,
        )
        upper_outcome, lower_outcome = plan.intervals
        for warning in plan.warnings:
            self.warning(f"SplitGeotechBand: {warning.code} — {warning.message}")

        target = context.band_rows[str(band_id)]
        original_base_m = target.depth_base_m
        boundary_m = round(split_depth_m, _DEPTH_DECIMALS)

        # Upper half — the original row, resized and reclassified.
        upper_formation = await formation_for_class(
            self,
            project_id=project_id,
            nad_class=upper_outcome.nad_class,
            source_litho_formation_id=context.source_litho_formation_id,
            source_geo_formation_id=context.source_geo_formation_id,
        )
        target.depth_base_m = boundary_m
        target.formation_id = upper_formation.id
        target.source = "manual"

        # Lower half — a new row on the SAME column, never on another.
        lower_formation = await formation_for_class(
            self,
            project_id=project_id,
            nad_class=lower_outcome.nad_class,
            source_litho_formation_id=context.source_litho_formation_id,
            source_geo_formation_id=context.source_geo_formation_id,
        )
        lower_row = LithoLayerOrm(
            id=uuid7(),
            model_id=geotech_model_id,
            formation_id=lower_formation.id,
            depth_top_m=boundary_m,
            depth_base_m=round(original_base_m, _DEPTH_DECIMALS),
            status="accepted",
            source="manual",
            confidence="medium",
            cpt_id=context.investigation_id if context.anchor_is_cpt else None,
            borehole_id=None if context.anchor_is_cpt else context.investigation_id,
        )
        self._session.add(lower_row)
        await self._session.flush()

        # Ruling 4: a connection breaks if the new class no longer matches. Only
        # the upper half carries pre-existing edges (the lower row is new).
        dropped = await self._revalidate_edges(
            geotech_model_id=geotech_model_id,
            layer_id=target.id,
            new_nad_class=upper_outcome.nad_class,
        )

        await self._litho_repo.mark_litho_solids_stale(geotech_model_id)
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model_id, commit=False)
        await self._session.commit()

        self.success(
            f"SplitGeotechBand ok: band={band_id} → "
            f"{target.depth_top_m:.2f}–{boundary_m:.2f} m (class {upper_outcome.nad_class}) + "
            f"{boundary_m:.2f}–{original_base_m:.2f} m (class {lower_outcome.nad_class}); "
            f"{len(dropped)} correlation(s) dropped"
        )
        return GeotechBandEditResult(
            geotech_model_id=geotech_model_id,
            investigation_id=context.investigation_id,
            plan=plan,
            layer_ids=(target.id, lower_row.id),
            created_layer_ids=(lower_row.id,),
            deleted_layer_ids=(),
            deleted_edge_ids=tuple(dropped),
        )

    async def _revalidate_edges(
        self,
        *,
        geotech_model_id: UUID,
        layer_id: UUID,
        new_nad_class: int | None,
    ) -> list[UUID]:
        """Drop the layer's correlations that its new class no longer supports.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model to scope the edge query to.
        layer_id : UUID
            The re-derived layer.
        new_nad_class : int | None
            Its new class; ``None`` never matches (the skeleton-band rule).

        Returns
        -------
        list[UUID]
            The edge ids that were deleted.
        """
        edges = await load_edges_for_layers(
            self._session, model_id=geotech_model_id, layer_ids=[layer_id]
        )
        if not edges:
            return []
        partner_ids = [e.partner_of(layer_id) for e in edges]
        class_by_layer = await load_nad_class_by_layer(self._session, partner_ids)
        dropped = invalidated_edge_ids(
            edges=edges,
            edited_layer_id=layer_id,
            new_nad_class=new_nad_class,
            class_by_layer_id=class_by_layer,
        )
        await delete_edges(self._session, dropped)
        self.debug(
            f"_revalidate_edges: layer={layer_id} new_class={new_nad_class} "
            f"kept={len(edges) - len(dropped)} dropped={len(dropped)}"
        )
        return dropped

"""Commit a hand merge of two adjacent NAD packing bands, on ONE column.

Owner spec 2026-08-01. What this use case does, and the ruling behind each part:

* **The class is derived, not carried** — the merged interval is reclassified
  from the CPT qc over the UNION (median, the statistic the build classifies on).
  The answer may differ from both inputs; that is the point of re-deriving it.
* **Recalculation is local** — the context loader reads only the edited bands'
  own column. This use case writes exactly two rows: the upper band (extended
  over the union) and the lower band (deleted).
* **Hard bounds** — a merge whose two bands sit in different lithostratigraphic
  or geological units is refused by :func:`plan_merge` before anything is
  written.
* **Manual override always wins** — the warning about the material moving
  between layers is advisory; a merge is never blocked on it.

Which correlations are touched
------------------------------
Two sets, and nothing else:

1. Every correlation on the LOWER band. That band ceases to exist, so its
   correlations go with it (the FK cascades on the row delete). They are not
   transferred to the merged band — whether a merge should inherit them when the
   partner class still matches is an open product question, deliberately not
   decided here.
2. Correlations on the UPPER band whose partner's NAD class no longer equals the
   merged class (ruling 4: "a connection breaks if the new class no longer
   matches"). Ones that still match survive untouched.

No other column's correlations are read or written.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.geotech_band_edit_helpers import (
    GeotechBandEditResult,
    delete_edges,
    formation_for_class,
    invalidated_edge_ids,
    load_edges_for_layers,
    load_geotech_column_context,
    load_nad_class_by_layer,
)
from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.domain.services.geotech_band_reclassification import plan_merge

# Depths are rounded to the millimetre before they are written — the no-overlap
# exclusion constraint compares ``round(depth, 3)``.
_DEPTH_DECIMALS = 3


class MergeGeotechBands(GeotechBoreholeMaterialiser):
    """Merge two adjacent packing bands and re-derive the union's NAD class.

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
        upper_band_id: UUID,
        lower_band_id: UUID,
    ) -> GeotechBandEditResult:
        """Merge the two adjacent bands and commit.

        Parameters
        ----------
        project_id : UUID
            Owning project (scope guard).
        geotech_model_id : UUID
            The geotechnical model the bands belong to.
        upper_band_id, lower_band_id : UUID
            The adjacent pair to merge. Order is normalised by depth, so passing
            them the wrong way round still works.

        Returns
        -------
        GeotechBandEditResult
            The committed plan, the surviving row id, the deleted row id, and
            the correlation edges that were dropped.

        Raises
        ------
        GeotechBandEditError
            When the bands are unknown, not adjacent, or sit in different litho
            or geological units.
        """
        self.info(
            f"MergeGeotechBands: model={geotech_model_id} "
            f"upper={upper_band_id} lower={lower_band_id}"
        )
        context = await load_geotech_column_context(
            self._session,
            self,
            project_id=project_id,
            geotech_model_id=geotech_model_id,
            band_id=upper_band_id,
        )
        plan = plan_merge(
            bands=context.bands,
            upper_band_id=str(upper_band_id),
            lower_band_id=str(lower_band_id),
            soil=context.soil,
            admixtures=context.admixtures,
            depth_m=context.depth_m,
            qc_mpa=context.qc_mpa,
            min_thickness_m=context.min_thickness_m,
        )
        merged = plan.intervals[0]
        for warning in plan.warnings:
            self.warning(f"MergeGeotechBands: {warning.code} — {warning.message}")

        # plan_merge normalises the order by depth; follow it so "upper" here is
        # the shallower row regardless of how the caller passed the pair.
        rows = [context.band_rows[str(upper_band_id)], context.band_rows[str(lower_band_id)]]
        rows.sort(key=lambda r: r.depth_top_m)
        survivor, absorbed = rows[0], rows[1]

        formation = await formation_for_class(
            self,
            project_id=project_id,
            nad_class=merged.nad_class,
            source_litho_formation_id=context.source_litho_formation_id,
            source_geo_formation_id=context.source_geo_formation_id,
        )
        survivor.depth_base_m = round(absorbed.depth_base_m, _DEPTH_DECIMALS)
        survivor.formation_id = formation.id
        # The merged band's extent is the engineer's decision now, not the
        # segmenter's — provenance must say so.
        survivor.source = "manual"

        # Deleting the absorbed row cascades its correlation edges away (the
        # edge FK is ON DELETE CASCADE); the band they connected no longer
        # exists as a separate band.
        absorbed_id = absorbed.id
        await self._session.delete(absorbed)
        await self._session.flush()

        dropped = await self._revalidate_edges(
            geotech_model_id=geotech_model_id,
            layer_id=survivor.id,
            new_nad_class=merged.nad_class,
        )

        await self._litho_repo.mark_litho_solids_stale(geotech_model_id)
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model_id, commit=False)
        await self._session.commit()

        self.success(
            f"MergeGeotechBands ok: {survivor.depth_top_m:.2f}–{survivor.depth_base_m:.2f} m "
            f"class {merged.previous_nad_class} → {merged.nad_class}; "
            f"band {absorbed_id} absorbed; {len(dropped)} correlation(s) dropped"
        )
        return GeotechBandEditResult(
            geotech_model_id=geotech_model_id,
            investigation_id=context.investigation_id,
            plan=plan,
            layer_ids=(survivor.id,),
            created_layer_ids=(),
            deleted_layer_ids=(absorbed_id,),
            deleted_edge_ids=tuple(dropped),
        )

    async def _revalidate_edges(
        self,
        *,
        geotech_model_id: UUID,
        layer_id: UUID,
        new_nad_class: int | None,
    ) -> list[UUID]:
        """Drop the surviving band's correlations its new class no longer supports.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model to scope the edge query to.
        layer_id : UUID
            The merged (surviving) layer.
        new_nad_class : int | None
            Its re-derived class; ``None`` never matches (the skeleton-band rule).

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

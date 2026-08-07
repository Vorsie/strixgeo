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
* **A borehole is refused** (ruling A) — the class is re-derived from qc, and a
  borehole has none, so :func:`require_cpt_anchor` rejects the merge before
  anything is written rather than skeletonising a band whose class
  ``DivideBoreholes`` extrapolated from the surrounding CPTs.

Which correlations are touched
------------------------------
Two sets, and nothing else (both under the owner's 2026-08-07 flag-not-drop
ruling — "i don't want accepted edges to just disappear without any user
explicitly deleting it"):

1. Every correlation on the ABSORBED band. Its ACCEPTED ties are TRANSFERRED
   to the surviving band and flagged for review (``class_changed`` when the
   merged class no longer matches the partner, ``ambiguous_band`` when it
   still does — the anchor changed identity either way); a transfer that
   would self-loop or duplicate an existing tie is dropped and counted. Its
   PENDING ties go with the row (the FK cascade) — machine claims the
   machine may withdraw.
2. Correlations on the SURVIVING band re-judged against the merged class:
   pending mismatches drop, accepted mismatches gain the ``class_changed``
   flag, and a restored match self-heals an earlier flag.

No other column's correlations are read or written.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.geotech_band_edit_helpers import (
    GeotechBandEditResult,
    formation_for_class,
    load_geotech_column_context,
    require_cpt_anchor,
    revalidate_layer_edges,
    transfer_accepted_edges,
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
        require_cpt_anchor(context, gesture="Merge")
        plan = plan_merge(
            bands=context.bands,
            upper_band_id=str(upper_band_id),
            lower_band_id=str(lower_band_id),
            soil=context.soil,
            admixtures=context.admixtures,
            depth_m=context.depth_m,
            qc_mpa=context.qc_mpa,
            min_thickness_m=context.min_thickness_m,
            statistic=context.statistic,
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

        # BEFORE the row delete: re-anchor the absorbed band's ACCEPTED ties
        # onto the survivor (owner ruling 2026-08-07 — the FK cascade must
        # never silently destroy accepted work). Pending ties stay for the
        # cascade to take.
        absorbed_id = absorbed.id
        transfer = await transfer_accepted_edges(
            self._session,
            self,
            model_id=geotech_model_id,
            from_layer_id=absorbed_id,
            to_layer_id=survivor.id,
            survivor_class=merged.nad_class,
        )
        await self._session.delete(absorbed)
        await self._session.flush()

        revalidation = await revalidate_layer_edges(
            self._session,
            self,
            model_id=geotech_model_id,
            new_class_by_layer_id={survivor.id: merged.nad_class},
        )

        await self._litho_repo.mark_litho_solids_stale(geotech_model_id)
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model_id, commit=False)
        await self._session.commit()

        # The transferred ties were flagged BY the transfer; the revalidation
        # judged the survivor's pre-existing ties. The union is what the UI
        # reports. A transferred tie can also appear in the revalidation's
        # flag set (it now sits on the survivor) — dedupe keeps counts honest.
        flagged = tuple(
            dict.fromkeys([m.edge_id for m in transfer.moves] + list(revalidation.flagged_edge_ids))
        )
        deleted_edges = tuple(transfer.drops) + revalidation.deleted_edge_ids
        self.success(
            f"MergeGeotechBands ok: {survivor.depth_top_m:.2f}–{survivor.depth_base_m:.2f} m "
            f"class {merged.previous_nad_class} → {merged.nad_class}; "
            f"band {absorbed_id} absorbed; {len(transfer.moves)} tie(s) transferred+flagged, "
            f"{len(deleted_edges)} removed, {len(revalidation.cleared_edge_ids)} flag(s) cleared"
        )
        return GeotechBandEditResult(
            geotech_model_id=geotech_model_id,
            investigation_id=context.investigation_id,
            plan=plan,
            layer_ids=(survivor.id,),
            created_layer_ids=(),
            deleted_layer_ids=(absorbed_id,),
            deleted_edge_ids=deleted_edges,
            flagged_edge_ids=flagged,
            cleared_edge_ids=revalidation.cleared_edge_ids,
        )

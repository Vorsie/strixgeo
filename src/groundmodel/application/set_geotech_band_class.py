"""Set a BOREHOLE band's NAD packing class by hand.

Owner ask 2026-08-18, in the editing-section ruling's own words: *"if the user
edits TS11 he will notice and change it"* — a borehole band's class is
donor-extrapolated, never measured, so the engineer's judgement outranks it.
This verb repoints the band at the chosen NAD formation and stamps manual
provenance. Geometry never moves.

A CPT band is REFUSED (the inverse of ruling A's ``require_cpt_anchor``): its
class is derived from its own cone resistance, and a hand class would dress an
opinion as a measurement. On a CPT the levers are split / merge / move and the
qc statistic.

A re-divide rebuilds every borehole band from the donors, so a hand class
lives until the next "Divide boreholes" press — the pipeline's goal is one
pass per section, with hand fixes AFTER the last press.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.geotech_band_edit_helpers import (
    GeotechBandEditResult,
    formation_for_class,
    geo_parent_for_interval,
    load_geotech_column_context,
    pre_edit_class_snapshot,
    revalidate_layer_edges,
)
from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.domain.services.geotech_band_reclassification import (
    BandEditPlan,
    GeotechBandEditError,
    IntervalOutcome,
)
from groundmodel.domain.services.nad_classifier import hand_settable_classes_for


class SetGeotechBandClass(GeotechBoreholeMaterialiser):
    """Repoint one borehole band at an engineer-chosen NAD class.

    Inherits :class:`GeotechBoreholeMaterialiser` so the hand class lands on
    the SAME formation rows the build would have produced (find-or-create).

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session. This use case commits once at the end.
    """

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(__name__, session)

    async def execute(
        self,
        *,
        project_id: UUID,
        geotech_model_id: UUID,
        band_id: UUID,
        nad_class: int,
    ) -> GeotechBandEditResult:
        """Set *band_id*'s class to *nad_class* and re-judge its ties.

        Parameters
        ----------
        project_id : UUID
            Owning project (scope guard).
        geotech_model_id : UUID
            The geotechnical model the band belongs to.
        band_id : UUID
            The borehole band to reclassify.
        nad_class : int
            The chosen NAD packing class (validated against the band's soil).

        Returns
        -------
        GeotechBandEditResult
            The committed change and the correlation consequences.

        Raises
        ------
        GeotechBandEditError
            When the band is unknown, sits on a CPT, has no usable soil, or
            the class does not belong to the soil's NAD family.
        """
        self.info(f"SetGeotechBandClass: model={geotech_model_id} band={band_id} class={nad_class}")
        context = await load_geotech_column_context(
            self._session,
            self,
            project_id=project_id,
            geotech_model_id=geotech_model_id,
            band_id=band_id,
        )
        if context.anchor_is_cpt:
            raise GeotechBandEditError(
                "This band's class is measured from the CPT's own cone resistance — "
                "a hand class would overwrite a measurement. Set classes on borehole "
                "bands; on a CPT, split or merge bands, or change the qc statistic."
            )
        if context.soil is None:
            raise GeotechBandEditError(
                "This band's parent litho unit carries no usable soil code, so no "
                "NAD family exists to choose a class from."
            )
        allowed = hand_settable_classes_for(context.soil)
        if nad_class not in allowed:
            # ``context.soil`` may arrive as the enum or its raw string value.
            soil_label = getattr(context.soil, "value", context.soil)
            raise GeotechBandEditError(
                f"NAD class {nad_class} does not belong to {soil_label} — "
                f"this band's soil offers {', '.join(str(c) for c in allowed)}."
            )

        target = context.band_rows[str(band_id)]
        band = next(b for b in context.bands if b.band_id == str(band_id))
        previous_class = band.nad_class

        formation = await formation_for_class(
            self,
            project_id=project_id,
            nad_class=nad_class,
            source_litho_formation_id=context.source_litho_formation_id,
            # Live-first, so a hand edit heals a stale build-time stamp on touch.
            source_geo_formation_id=geo_parent_for_interval(context, band.depth_top_m),
        )
        target.formation_id = formation.id
        # The class is the engineer's own statement now — provenance must say
        # so, and the low donor-distance confidence would be a lie about it.
        target.source = "manual"
        target.confidence = "high"
        await self._session.flush()

        revalidation = await revalidate_layer_edges(
            self._session,
            self,
            model_id=geotech_model_id,
            new_class_by_layer_id={target.id: nad_class},
            old_class_by_layer_id=pre_edit_class_snapshot(context),
        )

        await self._litho_repo.mark_litho_solids_stale(geotech_model_id)
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model_id, commit=False)
        await self._session.commit()

        self.success(
            f"SetGeotechBandClass ok: band={band_id} class {previous_class} → {nad_class}; "
            f"{len(revalidation.deleted_edge_ids)} tie(s) removed, "
            f"{len(revalidation.flagged_edge_ids)} flagged, "
            f"{len(revalidation.cleared_edge_ids)} flag(s) cleared"
        )
        plan = BandEditPlan(
            kind="set_class",
            parent_top_m=band.depth_top_m,
            parent_base_m=band.depth_base_m,
            intervals=(
                IntervalOutcome(
                    depth_top_m=band.depth_top_m,
                    depth_base_m=band.depth_base_m,
                    median_qc_mpa=None,
                    nad_class=nad_class,
                    previous_nad_class=previous_class,
                    class_changed=previous_class != nad_class,
                    unclassifiable_reason=None,
                    sources=(),
                ),
            ),
            warnings=(),
            statistic=context.statistic,
        )
        return GeotechBandEditResult(
            geotech_model_id=geotech_model_id,
            investigation_id=context.investigation_id,
            plan=plan,
            layer_ids=(target.id,),
            created_layer_ids=(),
            deleted_layer_ids=(),
            deleted_edge_ids=revalidation.deleted_edge_ids,
            flagged_edge_ids=revalidation.flagged_edge_ids,
            cleared_edge_ids=revalidation.cleared_edge_ids,
        )

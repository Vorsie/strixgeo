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
* **Hard bounds** — a split depth outside the band's litho body is
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

from groundmodel.application.body_partition_lock import lock_body_partition
from groundmodel.application.geotech_band_edit_constants import MANUAL_BAND_SOURCE
from groundmodel.application.geotech_band_edit_helpers import (
    GeotechBandEditResult,
    formation_for_class,
    geo_parent_for_interval,
    load_geotech_column_context,
    pre_edit_class_snapshot,
    require_cpt_anchor,
    revalidate_layer_edges,
)
from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.orphan_formation_sweep import OrphanFormationSweep
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
            statistic=context.statistic,
        )
        upper_outcome, lower_outcome = plan.intervals
        for warning in plan.warnings:
            self.warning(f"SplitGeotechBand: {warning.code} — {warning.message}")

        # TAKE THE PARTITION LOCK BEFORE THE FIRST WRITE, not after it — every
        # guard above has passed, so this request is going to write. The
        # ``ResolveLithoInstances`` call below takes this same lock, but by then
        # this transaction has already resized one ``litho_layer`` row and
        # inserted another, and those writes race the debounced background
        # ``bodies/recompute``, which re-stamps ``litho_layer.body_id`` over the
        # same rows in a different lock order (owner dogfeed 2026-08-23:
        # DeadlockDetectedError on ``litho_layer`` during a quick edit burst).
        # The lock is re-entrant per session, so the resolver's later
        # acquisition stays free.
        await lock_body_partition(
            self._session, model_id=geotech_model_id, operation="split-geotech-band"
        )

        target = context.band_rows[str(band_id)]
        original_base_m = target.depth_base_m
        boundary_m = round(split_depth_m, _DEPTH_DECIMALS)

        # Upper half — the original row, resized and reclassified.
        upper_formation = await formation_for_class(
            self,
            project_id=project_id,
            nad_class=upper_outcome.nad_class,
            source_litho_formation_id=context.source_litho_formation_id,
            # Live-first, so a hand edit heals a stale build-time stamp on touch.
            source_geo_formation_id=geo_parent_for_interval(
                context, upper_outcome.depth_top_m, upper_outcome.depth_base_m
            ),
        )
        target.depth_base_m = boundary_m
        target.formation_id = upper_formation.id
        target.source = MANUAL_BAND_SOURCE

        # Lower half — a new row on the SAME column, never on another.
        lower_formation = await formation_for_class(
            self,
            project_id=project_id,
            nad_class=lower_outcome.nad_class,
            source_litho_formation_id=context.source_litho_formation_id,
            source_geo_formation_id=geo_parent_for_interval(
                context, lower_outcome.depth_top_m, lower_outcome.depth_base_m
            ),
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
            # Both halves stay inside the original band's litho parent (the split
            # is refused outside it), so the new lower half keeps the SAME
            # covering litho band as the upper half (the original row, resized).
            parent_litho_layer_id=target.parent_litho_layer_id,
        )
        self._session.add(lower_row)
        await self._session.flush()

        # Flag-not-drop (owner 2026-08-07): the upper half's pre-existing ties
        # are re-judged against its re-derived class — pending mismatches
        # withdraw, accepted mismatches gain the class_changed flag, restored
        # matches self-heal. The lower row is new and carries no edges yet;
        # its entry in the map is a no-op today and correctness insurance the
        # day something gives new rows edges.
        revalidation = await revalidate_layer_edges(
            self._session,
            self,
            model_id=geotech_model_id,
            new_class_by_layer_id={
                target.id: upper_outcome.nad_class,
                lower_row.id: lower_outcome.nad_class,
            },
            old_class_by_layer_id=pre_edit_class_snapshot(context),
        )

        await self._litho_repo.mark_litho_solids_stale(geotech_model_id)
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model_id, commit=False)
        # Both halves are re-derived, so the pre-split class can end up with no
        # bands left anywhere and its formation with nothing in it.
        await OrphanFormationSweep(self._session).sweep_geotech_units(project_id)
        await self._session.commit()

        self.success(
            f"SplitGeotechBand ok: band={band_id} → "
            f"{target.depth_top_m:.2f}–{boundary_m:.2f} m (class {upper_outcome.nad_class}) + "
            f"{boundary_m:.2f}–{original_base_m:.2f} m (class {lower_outcome.nad_class}); "
            f"{len(revalidation.deleted_edge_ids)} tie(s) removed, "
            f"{len(revalidation.flagged_edge_ids)} flagged, "
            f"{len(revalidation.cleared_edge_ids)} flag(s) cleared"
        )
        return GeotechBandEditResult(
            geotech_model_id=geotech_model_id,
            investigation_id=context.investigation_id,
            plan=plan,
            layer_ids=(target.id, lower_row.id),
            created_layer_ids=(lower_row.id,),
            deleted_layer_ids=(),
            deleted_edge_ids=revalidation.deleted_edge_ids,
            flagged_edge_ids=revalidation.flagged_edge_ids,
            cleared_edge_ids=revalidation.cleared_edge_ids,
        )

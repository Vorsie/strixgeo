"""Commit a drag of the shared boundary between two adjacent packing bands.

The drag verb of the geotech hand-edit surface (docs/debt.md #227 — the owner's
2026-08-07 "drag/merge" ask). What this use case does, per ruling:

* **The class is derived, not carried (ruling 3)** — BOTH resulting intervals
  are reclassified from the CPT qc over their new extents, under the model's
  representative statistic (ruling 7). The drag changes the extents; the data
  re-classifies what was made.
* **Recalculation is local (ruling 4)** — the context loader reads only the
  edited pair's own column, and exactly two rows are written.
* **Hard bounds (ruling 2)** — drag is only legal on a same-parentage pair
  (any other boundary IS a litho or geological contact); the depth must sit
  strictly inside the pair. Both enforced by :func:`plan_move` before anything
  is written.
* **Manual override always wins (ruling 5)** — a survivor thinner than the
  configured minimum WARNS; the only refusals are hierarchy/structure.
* **A borehole is refused** (ruling A) — no qc, nothing to re-derive from.
* **Flag-not-drop (2026-08-07)** — ties on either band whose class match
  breaks are flagged for review (accepted) or withdrawn (pending) by the
  shared revalidation driver; restored matches self-heal.

The write is an atomic two-row UPDATE: ``upper.depth_base_m`` and
``lower.depth_top_m`` both become the rounded new depth in one transaction.
Never a one-row PATCH — the deferred contiguity trigger and the mm-grain
no-overlap exclusion both check at COMMIT, so the paired write is legal and a
lone one would not be.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

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
from groundmodel.domain.services.geotech_band_reclassification import plan_move
from groundmodel.shared.constants.db_constraints import LITHO_LAYER_DEPTH_DECIMALS


class MoveGeotechBandBoundary(GeotechBoreholeMaterialiser):
    """Drag the shared boundary of two adjacent packing bands and re-derive both.

    Inherits :class:`GeotechBoreholeMaterialiser` for its find-or-create
    formation helpers, so a hand edit lands on the SAME formation rows the
    build would have produced.

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
        new_depth_m: float,
    ) -> GeotechBandEditResult:
        """Move the pair's shared boundary and commit.

        Parameters
        ----------
        project_id : UUID
            Owning project (scope guard).
        geotech_model_id : UUID
            The geotechnical model the bands belong to.
        upper_band_id, lower_band_id : UUID
            The adjacent pair. Order is normalised by depth, so passing them
            the wrong way round still works.
        new_depth_m : float
            The new boundary depth (metres, positive down).

        Returns
        -------
        GeotechBandEditResult
            The committed plan, both surviving row ids, and the edge
            revalidation outcome (deleted / flagged / cleared).

        Raises
        ------
        GeotechBandEditError
            When the bands are unknown, not an adjacent same-parentage pair,
            or the depth is not strictly inside the pair.
        """
        self.info(
            f"MoveGeotechBandBoundary: model={geotech_model_id} "
            f"upper={upper_band_id} lower={lower_band_id} depth={new_depth_m:.3f} m"
        )
        context = await load_geotech_column_context(
            self._session,
            self,
            project_id=project_id,
            geotech_model_id=geotech_model_id,
            band_id=upper_band_id,
        )
        require_cpt_anchor(context, gesture="Move")
        plan = plan_move(
            bands=context.bands,
            upper_band_id=str(upper_band_id),
            lower_band_id=str(lower_band_id),
            new_depth_m=new_depth_m,
            soil=context.soil,
            admixtures=context.admixtures,
            depth_m=context.depth_m,
            qc_mpa=context.qc_mpa,
            min_thickness_m=context.min_thickness_m,
            statistic=context.statistic,
        )
        upper_outcome, lower_outcome = plan.intervals
        for warning in plan.warnings:
            self.warning(f"MoveGeotechBandBoundary: {warning.code} — {warning.message}")

        # TAKE THE PARTITION LOCK BEFORE THE FIRST WRITE, not after it — every
        # guard above has passed, so this request is going to write. The
        # ``ResolveLithoInstances`` call below takes this same lock, but by then
        # this transaction has already UPDATEd both ``litho_layer`` rows, and
        # those writes race the debounced background ``bodies/recompute``, which
        # re-stamps ``litho_layer.body_id`` over the same rows in a different
        # lock order (owner dogfeed 2026-08-23: DeadlockDetectedError on
        # ``litho_layer`` during a quick edit burst). The lock is re-entrant per
        # session, so the resolver's later acquisition stays free.
        await lock_body_partition(
            self._session, model_id=geotech_model_id, operation="move-geotech-band-boundary"
        )

        # plan_move normalises order by depth; follow it.
        rows = [context.band_rows[str(upper_band_id)], context.band_rows[str(lower_band_id)]]
        rows.sort(key=lambda r: r.depth_top_m)
        upper_row, lower_row = rows[0], rows[1]
        boundary_m = round(new_depth_m, LITHO_LAYER_DEPTH_DECIMALS)

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
        lower_formation = await formation_for_class(
            self,
            project_id=project_id,
            nad_class=lower_outcome.nad_class,
            source_litho_formation_id=context.source_litho_formation_id,
            source_geo_formation_id=geo_parent_for_interval(
                context, lower_outcome.depth_top_m, lower_outcome.depth_base_m
            ),
        )
        # The atomic two-row write: both rows move in one transaction, and both
        # become the engineer's decision (the hand-edit counter keys on it).
        upper_row.depth_base_m = boundary_m
        upper_row.formation_id = upper_formation.id
        upper_row.source = MANUAL_BAND_SOURCE
        lower_row.depth_top_m = boundary_m
        lower_row.formation_id = lower_formation.id
        lower_row.source = MANUAL_BAND_SOURCE
        await self._session.flush()

        revalidation = await revalidate_layer_edges(
            self._session,
            self,
            model_id=geotech_model_id,
            new_class_by_layer_id={
                upper_row.id: upper_outcome.nad_class,
                lower_row.id: lower_outcome.nad_class,
            },
            old_class_by_layer_id=pre_edit_class_snapshot(context),
        )

        await self._litho_repo.mark_litho_solids_stale(geotech_model_id)
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model_id, commit=False)
        # Both rows are re-derived at the new boundary, so either side's former
        # class can end up with no bands left and its formation with nothing.
        await OrphanFormationSweep(self._session).sweep_geotech_units(project_id)
        await self._session.commit()

        self.success(
            f"MoveGeotechBandBoundary ok: boundary → {boundary_m:.2f} m; "
            f"classes {upper_outcome.previous_nad_class}→{upper_outcome.nad_class} / "
            f"{lower_outcome.previous_nad_class}→{lower_outcome.nad_class}; "
            f"{len(revalidation.deleted_edge_ids)} tie(s) removed, "
            f"{len(revalidation.flagged_edge_ids)} flagged, "
            f"{len(revalidation.cleared_edge_ids)} flag(s) cleared"
        )
        return GeotechBandEditResult(
            geotech_model_id=geotech_model_id,
            investigation_id=context.investigation_id,
            plan=plan,
            layer_ids=(upper_row.id, lower_row.id),
            created_layer_ids=(),
            deleted_layer_ids=(),
            deleted_edge_ids=revalidation.deleted_edge_ids,
            flagged_edge_ids=revalidation.flagged_edge_ids,
            cleared_edge_ids=revalidation.cleared_edge_ids,
        )

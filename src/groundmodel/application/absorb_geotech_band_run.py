"""Commit a Ctrl+drag absorb-all on ONE column: a run unions and its far boundary moves.

Owner 2026-09-25 ("ctrl drag over multiple geotech ghost to absorb them"): the
litho ghost gesture (PR #53) on packing bands. The dragged boundary ran through
every band it passed; those bands union into the dragged one, and the boundary
with the band the release landed in moves to the released depth. ONE
transaction, ONE preview (:func:`plan_absorb_run`), ONE undo step — the same
reasons the small-lens absorb went through the run form of the merge rather
than two pair merges.

The write is the merge write plus the move write:

* the SURVIVOR (the shallowest band of the run) takes the union's extents and
  its re-derived class; every other band of the run is deleted, its ACCEPTED
  ties transferred to the survivor and flagged (flag-not-drop, owner
  2026-08-07), its pending ties gone with the row;
* the ENTERED band, when there is one, takes the remainder past the released
  depth and re-derives too — the atomic two-row write of the move.

Both survivors become the engineer's decision (``source = manual``). Only the
edited column is read or written.
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
    transfer_accepted_edges,
)
from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.orphan_formation_sweep import OrphanFormationSweep
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.domain.services.geotech_band_reclassification import plan_absorb_run
from groundmodel.shared.constants.db_constraints import LITHO_LAYER_DEPTH_DECIMALS


class AbsorbGeotechBandRun(GeotechBoreholeMaterialiser):
    """Union a run of packing bands and move its far boundary, in one transaction.

    Inherits :class:`GeotechBoreholeMaterialiser` for its find-or-create
    formation helpers, so the hand edit lands on the SAME formation rows the
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
        band_ids: list[UUID],
        entered_band_id: UUID | None,
        new_depth_m: float | None,
    ) -> GeotechBandEditResult:
        """Commit the absorb-all.

        Parameters
        ----------
        project_id : UUID
            Owning project (scope guard).
        geotech_model_id : UUID
            The geotechnical model the bands belong to.
        band_ids : list[UUID]
            The run that unions: the dragged band plus every band it passed,
            any order (normalised by depth).
        entered_band_id : UUID | None
            The band the release landed in; ``None`` when the drag reached the
            litho wall.
        new_depth_m : float | None
            The released depth inside that band; ``None`` at the wall.

        Returns
        -------
        GeotechBandEditResult
            The committed plan, the surviving row ids (top to bottom), the
            deleted row ids, and the tie outcome.

        Raises
        ------
        GeotechBandEditError
            When the run or the landing is not one the rules allow, or the
            bands hang off a borehole (no qc to re-derive from).
        """
        self.info(
            f"AbsorbGeotechBandRun: model={geotech_model_id} run={[str(b) for b in band_ids]} "
            f"entered={entered_band_id} depth={new_depth_m}"
        )
        # The partition lock BEFORE the first write, as every band verb does
        # (owner dogfeed 2026-08-23: a DeadlockDetectedError against the
        # debounced bodies/recompute otherwise).
        await lock_body_partition(
            self._session, model_id=geotech_model_id, operation="absorb-geotech-band-run"
        )
        context = await load_geotech_column_context(
            self._session,
            self,
            project_id=project_id,
            geotech_model_id=geotech_model_id,
            band_id=band_ids[0],
        )
        require_cpt_anchor(context, gesture="Absorb")
        plan = plan_absorb_run(
            bands=context.bands,
            band_ids=[str(b) for b in band_ids],
            entered_band_id=None if entered_band_id is None else str(entered_band_id),
            new_depth_m=new_depth_m,
            soil=context.soil,
            admixtures=context.admixtures,
            depth_m=context.depth_m,
            qc_mpa=context.qc_mpa,
            min_thickness_m=context.min_thickness_m,
            statistic=context.statistic,
        )
        for warning in plan.warnings:
            self.warning(f"AbsorbGeotechBandRun: {warning.code} — {warning.message}")

        rows = sorted((context.band_rows[str(b)] for b in band_ids), key=lambda r: r.depth_top_m)
        survivor, absorbed_rows = rows[0], rows[1:]
        entered_row = None if entered_band_id is None else context.band_rows[str(entered_band_id)]
        pre_classes = pre_edit_class_snapshot(context)

        # The plan lists its intervals top to bottom; the union is the one that
        # carries the run's material — the shallower interval on a downward
        # drag, the deeper one on an upward drag.
        if entered_row is None:
            merged, entered_outcome = plan.intervals[0], None
        elif entered_row.depth_top_m > survivor.depth_top_m:
            merged, entered_outcome = plan.intervals
        else:
            entered_outcome, merged = plan.intervals

        merged_formation = await formation_for_class(
            self,
            project_id=project_id,
            nad_class=merged.nad_class,
            source_litho_formation_id=context.source_litho_formation_id,
            # Live-first, so a hand edit heals a stale build-time stamp on touch.
            source_geo_formation_id=geo_parent_for_interval(
                context, merged.depth_top_m, merged.depth_base_m
            ),
        )
        survivor.depth_top_m = round(merged.depth_top_m, LITHO_LAYER_DEPTH_DECIMALS)
        survivor.depth_base_m = round(merged.depth_base_m, LITHO_LAYER_DEPTH_DECIMALS)
        survivor.formation_id = merged_formation.id
        survivor.source = MANUAL_BAND_SOURCE
        new_class_by_layer_id: dict[UUID, int | None] = {survivor.id: merged.nad_class}

        if entered_row is not None and entered_outcome is not None:
            entered_formation = await formation_for_class(
                self,
                project_id=project_id,
                nad_class=entered_outcome.nad_class,
                source_litho_formation_id=context.source_litho_formation_id,
                source_geo_formation_id=geo_parent_for_interval(
                    context, entered_outcome.depth_top_m, entered_outcome.depth_base_m
                ),
            )
            entered_row.depth_top_m = round(entered_outcome.depth_top_m, LITHO_LAYER_DEPTH_DECIMALS)
            entered_row.depth_base_m = round(
                entered_outcome.depth_base_m, LITHO_LAYER_DEPTH_DECIMALS
            )
            entered_row.formation_id = entered_formation.id
            entered_row.source = MANUAL_BAND_SOURCE
            new_class_by_layer_id[entered_row.id] = entered_outcome.nad_class

        # BEFORE each row delete: re-anchor the absorbed band's ACCEPTED ties
        # onto the survivor (flag-not-drop). Pending ties go with the row.
        transfer_moves: list[UUID] = []
        transfer_drops: list[UUID] = []
        accepted_drops: list[UUID] = []
        absorbed_ids: list[UUID] = []
        for absorbed in absorbed_rows:
            absorbed_ids.append(absorbed.id)
            transfer = await transfer_accepted_edges(
                self._session,
                self,
                model_id=geotech_model_id,
                from_layer_id=absorbed.id,
                to_layer_id=survivor.id,
                absorbed_class=pre_classes.get(absorbed.id),
                survivor_class=merged.nad_class,
            )
            transfer_moves.extend(m.edge_id for m in transfer.moves)
            accepted_drops.extend(transfer.drops)
            transfer_drops.extend(transfer.drops)
            transfer_drops.extend(transfer.displaced_edge_ids)
            await self._session.delete(absorbed)
        await self._session.flush()

        revalidation = await revalidate_layer_edges(
            self._session,
            self,
            model_id=geotech_model_id,
            new_class_by_layer_id=new_class_by_layer_id,
            old_class_by_layer_id=pre_classes,
        )

        await self._litho_repo.mark_litho_solids_stale(geotech_model_id)
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model_id, commit=False)
        # Several rows retired and two re-pointed: a class can end up with no band.
        await OrphanFormationSweep(self._session).sweep_geotech_units(project_id)
        await self._session.commit()

        flagged = tuple(dict.fromkeys(transfer_moves + list(revalidation.flagged_edge_ids)))
        deleted_edges = tuple(transfer_drops) + revalidation.deleted_edge_ids
        self.success(
            f"AbsorbGeotechBandRun ok: union {survivor.depth_top_m:.2f}–"
            f"{survivor.depth_base_m:.2f} m class {merged.previous_nad_class} → "
            f"{merged.nad_class}; {len(absorbed_ids)} band(s) absorbed; "
            + (
                "no entered band (litho wall); "
                if entered_row is None
                else (
                    f"entered band now {entered_row.depth_top_m:.2f}–"
                    f"{entered_row.depth_base_m:.2f} m; "
                )
            )
            + f"{len(transfer_moves)} tie(s) transferred+flagged, {len(deleted_edges)} removed "
            f"({len(accepted_drops)} of them accepted), "
            f"{len(revalidation.cleared_edge_ids)} flag(s) cleared"
        )
        survivors = [survivor] if entered_row is None else [survivor, entered_row]
        survivors.sort(key=lambda r: r.depth_top_m)
        return GeotechBandEditResult(
            geotech_model_id=geotech_model_id,
            investigation_id=context.investigation_id,
            plan=plan,
            layer_ids=tuple(r.id for r in survivors),
            created_layer_ids=(),
            deleted_layer_ids=tuple(absorbed_ids),
            deleted_edge_ids=deleted_edges,
            deleted_accepted_edge_ids=tuple(accepted_drops),
            flagged_edge_ids=flagged,
            cleared_edge_ids=revalidation.cleared_edge_ids,
        )

"""Commit a hand merge of two adjacent NAD packing bands, on ONE column.

Owner spec 2026-08-01. What this use case does, and the ruling behind each part:

* **The class is derived, not carried** — the merged interval is reclassified
  from the CPT qc over the UNION, under the model's representative statistic
  (ruling 7; median by default — the same one the build classifies on).
  The answer may differ from every input; that is the point of re-deriving it.
* **Recalculation is local** — the context loader reads only the edited bands'
  own column. This use case writes the SURVIVOR (the shallowest band, extended
  over the union) and deletes the absorbed row(s) — a pair ordinarily, an
  N-band contiguous run for the small-lens absorb.
* **Hard bounds** — a merge whose two bands sit in different lithostratigraphic
  or geological units is refused by :func:`plan_merge_run` before anything is
  written.
* **Manual override always wins** — the warning about the material moving
  between layers is advisory; a merge is never blocked on it.
* **A borehole is merged too — the union KEEPS the survivor's class** (owner #35,
  the inverse of the borehole split, amending ruling A). A borehole records no
  cone resistance, so there is nothing to re-derive from; rather than refuse, the
  union takes the SURVIVOR (shallowest) band's class. This is what makes a
  borehole split reversible: ctrl+z re-merges the two halves, which share the
  original class, back to it. Reached today only by that undo — the borehole menu
  offers no merge affordance of its own — so the two halves always agree; the
  survivor's class is the unambiguous answer.

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

from dataclasses import replace
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
    revalidate_layer_edges,
    transfer_accepted_edges,
)
from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.orphan_formation_sweep import OrphanFormationSweep
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.domain.services.geotech_band_reclassification import (
    GeotechBandEditError,
    plan_merge_run,
)
from groundmodel.shared.constants.db_constraints import LITHO_LAYER_DEPTH_DECIMALS


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
        upper_band_id: UUID | None = None,
        lower_band_id: UUID | None = None,
        band_ids: list[UUID] | None = None,
    ) -> GeotechBandEditResult:
        """Merge an adjacent run of bands and commit.

        Parameters
        ----------
        project_id : UUID
            Owning project (scope guard).
        geotech_model_id : UUID
            The geotechnical model the bands belong to.
        upper_band_id, lower_band_id : UUID
            The adjacent pair to merge (the ordinary case). Order is
            normalised by depth, so passing them the wrong way round still
            works.
        band_ids : list[UUID] | None
            An N-band contiguous run instead of the pair (the small-lens
            absorb: host + lens + host in ONE transaction, one preview, one
            undo step). When given, the pair arguments are ignored.

        Returns
        -------
        GeotechBandEditResult
            The committed plan, the surviving row id, the deleted row ids,
            and the tie outcome (removed / flagged / cleared).

        Raises
        ------
        GeotechBandEditError
            When the run is unknown, not consecutive, or crosses a litho or
            geological contact.
        """
        if band_ids:
            run: list[UUID] = list(band_ids)
        elif upper_band_id is not None and lower_band_id is not None:
            run = [upper_band_id, lower_band_id]
        else:
            raise GeotechBandEditError(
                "Merge rejected: provide the adjacent pair or a band_ids run."
            )
        self.info(f"MergeGeotechBands: model={geotech_model_id} run={[str(b) for b in run]}")
        # TAKE THE PARTITION LOCK BEFORE THE FIRST WRITE, not after it.
        # ``ResolveLithoInstances`` below takes this same lock, but by then this
        # transaction has already DELETEd the absorbed row and UPDATEd the
        # survivor — so those writes raced the debounced background
        # ``bodies/recompute``, which UPDATEs ``litho_layer.body_id`` stamps over
        # the same rows in a different order. Owner dogfeed 2026-08-23: merging
        # bands in quick succession 500'd with DeadlockDetectedError on
        # ``DELETE FROM litho_layer`` while a recompute for the same model was in
        # flight. The lock is re-entrant per session, so the resolver's later
        # acquisition stays free.
        await lock_body_partition(
            self._session, model_id=geotech_model_id, operation="merge-geotech-bands"
        )
        context = await load_geotech_column_context(
            self._session,
            self,
            project_id=project_id,
            geotech_model_id=geotech_model_id,
            band_id=run[0],
        )
        plan = plan_merge_run(
            bands=context.bands,
            band_ids=[str(b) for b in run],
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

        # plan_merge_run normalises the order by depth; follow it. The SURVIVOR
        # is the shallowest row: its depth_top_m — the one boundary this edit
        # leaves untouched — keeps its FC mirror and its top-anchored ties put.
        rows = sorted((context.band_rows[str(b)] for b in run), key=lambda r: r.depth_top_m)
        survivor, absorbed_rows = rows[0], rows[1:]

        # Capture the pre-merge state of the survivor + the deepest absorbed band
        # BEFORE anything is overwritten or deleted, so ctrl+z can re-split and
        # restore each half exactly (owner #35). For a pair these two ARE the two
        # bands; the pair-merge undo re-splits into exactly two, so it reads these.
        pre_classes = pre_edit_class_snapshot(context)
        survivor_band = next(b for b in context.bands if b.band_id == str(survivor.id))
        deepest_absorbed = absorbed_rows[-1]
        pre_merge_upper_nad_class = pre_classes.get(survivor.id)
        pre_merge_upper_source = survivor.source
        pre_merge_lower_nad_class = pre_classes.get(deepest_absorbed.id)
        pre_merge_lower_source = deepest_absorbed.source

        # A CPT re-derives the union's class from qc; a borehole has none, so the
        # union keeps the SURVIVOR's class (owner #35 — the borehole split's
        # inverse). ``merged.nad_class`` is ``None`` on a borehole (empty-qc
        # re-derivation), so it is never the answer there.
        merged_class = merged.nad_class if context.anchor_is_cpt else survivor_band.nad_class

        formation = await formation_for_class(
            self,
            project_id=project_id,
            nad_class=merged_class,
            source_litho_formation_id=context.source_litho_formation_id,
            # Live-first: the union may legally span ground whose build-time
            # stamps went stale (the engineer moved a geological contact on its
            # own axis) — the write heals the parentage instead of copying it.
            source_geo_formation_id=geo_parent_for_interval(
                context, merged.depth_top_m, merged.depth_base_m
            ),
        )
        survivor.depth_base_m = round(absorbed_rows[-1].depth_base_m, LITHO_LAYER_DEPTH_DECIMALS)
        survivor.formation_id = formation.id
        # The merged band's extent is the engineer's decision now, not the
        # segmenter's — provenance must say so.
        survivor.source = MANUAL_BAND_SOURCE

        # BEFORE each row delete: re-anchor the absorbed band's ACCEPTED ties
        # onto the survivor (owner ruling 2026-08-07 — the FK cascade must
        # never silently destroy accepted work). Pending ties stay for the
        # cascade to take.
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
                survivor_class=merged_class,
            )
            transfer_moves.extend(m.edge_id for m in transfer.moves)
            # ``drops`` are ACCEPTED ties the absorb could not re-anchor —
            # a self-loop or a true duplicate. Tracked apart from the displaced
            # proposals so the toast can tell the engineer whose work went.
            accepted_drops.extend(transfer.drops)
            transfer_drops.extend(transfer.drops)
            # Pending proposals the accepted transfers evicted are removals too.
            transfer_drops.extend(transfer.displaced_edge_ids)
            await self._session.delete(absorbed)
        await self._session.flush()

        revalidation = await revalidate_layer_edges(
            self._session,
            self,
            model_id=geotech_model_id,
            new_class_by_layer_id={survivor.id: merged_class},
            old_class_by_layer_id=pre_classes,
        )

        # Make the returned plan honest when the class was KEPT rather than
        # re-derived (a borehole): the response mirrors the preview shape, so it
        # must state the class the survivor actually got, not the ``None`` the
        # empty-qc re-derivation produced.
        if not context.anchor_is_cpt:
            plan = replace(
                plan,
                intervals=(
                    replace(
                        merged,
                        nad_class=merged_class,
                        class_changed=merged_class != merged.previous_nad_class,
                    ),
                ),
            )

        await self._litho_repo.mark_litho_solids_stale(geotech_model_id)
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model_id, commit=False)
        # The heaviest case: every absorbed row is deleted and the survivor is
        # re-pointed at the merged class, so an N-run merge can retire several
        # formations in one gesture.
        await OrphanFormationSweep(self._session).sweep_geotech_units(project_id)
        await self._session.commit()

        # The transferred ties were flagged BY the transfer; the revalidation
        # judged the survivor's pre-existing ties. The union is what the UI
        # reports. A transferred tie can also appear in the revalidation's
        # flag set (it now sits on the survivor) — dedupe keeps counts honest.
        flagged = tuple(dict.fromkeys(transfer_moves + list(revalidation.flagged_edge_ids)))
        deleted_edges = tuple(transfer_drops) + revalidation.deleted_edge_ids
        self.success(
            f"MergeGeotechBands ok: {survivor.depth_top_m:.2f}–{survivor.depth_base_m:.2f} m "
            f"class {merged.previous_nad_class} → {merged_class}; "
            f"{len(absorbed_ids)} band(s) absorbed; "
            f"{len(transfer_moves)} tie(s) transferred+flagged, "
            f"{len(deleted_edges)} removed ({len(accepted_drops)} of them accepted), "
            f"{len(revalidation.cleared_edge_ids)} flag(s) cleared"
        )
        return GeotechBandEditResult(
            geotech_model_id=geotech_model_id,
            investigation_id=context.investigation_id,
            plan=plan,
            layer_ids=(survivor.id,),
            created_layer_ids=(),
            deleted_layer_ids=tuple(absorbed_ids),
            deleted_edge_ids=deleted_edges,
            # Tracked apart since the 2026-08-08 review round and then never wired
            # (audit F10): the field defaulted to empty in every response, so the
            # toast called every deleted ACCEPTED tie a withdrawn pending proposal —
            # the exact misreport the split was made to prevent.
            deleted_accepted_edge_ids=tuple(accepted_drops),
            flagged_edge_ids=flagged,
            cleared_edge_ids=revalidation.cleared_edge_ids,
            # The pre-merge state ctrl+z restores each half from (owner #35).
            pre_merge_upper_nad_class=pre_merge_upper_nad_class,
            pre_merge_lower_nad_class=pre_merge_lower_nad_class,
            pre_merge_upper_source=pre_merge_upper_source,
            pre_merge_lower_source=pre_merge_lower_source,
        )

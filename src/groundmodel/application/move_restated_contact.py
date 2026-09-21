"""Move a lithostratigraphic contact from the geotech axis, with everything on it.

The gesture the owner asked for on 2026-08-09: *"we're refining from
geo-litho-geotech, so if we want to refine in the geotech then the rest should
move too"*. On finely interbedded ground the cone resolves a contact three to
four times finer than the driller's 0.5 m log grid, so the geotech screen is
where the best evidence for that contact is — and it is where he reaches for it.

WHY THIS EXISTS RATHER THAN A SECOND CALL FROM THE RENDERER. The first build moved
only the litho row. The packing bands stayed where they were, so:

* the line on screen did not move — the geotech axis draws the BANDS, and the
  band boundary had not moved, so a successful drag looked like a no-op; and
* the next drag on the same line was REFUSED, because the code resolves the litho
  contact by matching the band's depth, and after one move the two no longer
  coincided ("no litho contact within 0.0011 m of 16.9700m" — the owner's log).

Both symptoms are the same mistake: a contact restated in three models is ONE
boundary, and moving it in one model splits it. So this writes all three in one
transaction:

1. the geotech band boundary, with BOTH bands re-derived from the qc over their
   new extents (ruling 3, and the owner's chain: soil type → qc → NAD
   parameters — change the interval and the qc differs, so the class must be
   asked again);
2. the litho contact the boundary restates (an atomic two-row resize);
3. the geological contact the litho row is derived from, when it carries one —
   about a third of them do on the owner's model.

Nothing here re-subdivides. The two bands are re-derived because their own
extents changed; every other band on the column is untouched (ruling 4).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.body_partition_lock import lock_body_partition
from groundmodel.application.geotech_band_edit_constants import MANUAL_BAND_SOURCE
from groundmodel.application.geotech_band_edit_helpers import (
    GeotechBandEditResult,
    formation_for_class,
    load_geotech_column_context,
    pre_edit_class_snapshot,
    require_cpt_anchor,
    revalidate_layer_edges,
    transfer_accepted_edges,
)
from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.litho_geo_link_helpers import (
    load_geo_contacts_at_investigation,
    nearest_geo_contact_within_tolerance,
)
from groundmodel.application.orphan_formation_sweep import OrphanFormationSweep
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.domain.services.geotech_band_reclassification import (
    KIND_MERGE,
    GeotechBandEditError,
    plan_restated_contact_move,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.constants.db_constraints import LITHO_LAYER_DEPTH_DECIMALS

# The allowance within which two depths on one column are the same depth. A
# rounding width, not a matching heuristic: the band materialiser rounds to 3
# decimals while litho contacts keep full float precision, so one boundary is
# recorded at two precisions. Mirrors ``COINCIDENT_DEPTH_TOLERANCE_M`` in the
# renderer.
_COINCIDENT_M = 0.0011


@dataclass(frozen=True)
class RestatedContactMoveResult:
    """What the move wrote, for the caller to report.

    Attributes
    ----------
    band_result : GeotechBandEditResult
        The geotech half: the plan, the two surviving band ids, and the edge
        revalidation outcome.
    litho_upper_layer_id, litho_lower_layer_id : UUID
        The litho rows that were resized.
    geo_contact_id : UUID | None
        The geological contact carried along — or, for a merge that landed
        exactly ON one, the contact the litho boundary was COUPLED to (owner
        ruling 2026-08-12). ``None`` when the litho row is not derived from one
        and the landing coincides with none.
    """

    band_result: GeotechBandEditResult
    litho_upper_layer_id: UUID
    litho_lower_layer_id: UUID
    geo_contact_id: UUID | None


class MoveRestatedContact(GeotechBoreholeMaterialiser):
    """Move a restated contact and everything recorded at the same boundary.

    Inherits :class:`GeotechBoreholeMaterialiser` for the find-or-create formation
    helpers, so a hand edit lands on the SAME formation rows the build produces.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session. This use case commits once, at the end.
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
    ) -> RestatedContactMoveResult:
        """Move the contact in all three models and commit once.

        Parameters
        ----------
        project_id : UUID
            Owning project (scope guard).
        geotech_model_id : UUID
            The geotechnical model the bands belong to.
        upper_band_id, lower_band_id : UUID
            The adjacent pair the contact separates. Order is normalised by depth.
        new_depth_m : float
            Where the contact lands, in metres below the collar.

        Returns
        -------
        RestatedContactMoveResult
            The geotech outcome plus the litho and geological rows carried.

        Raises
        ------
        GeotechBandEditError
            When the pair is not an adjacent cross-unit pair, the depth falls
            outside it, the column is a borehole, or no litho contact is recorded
            at the boundary being moved.
        """
        self.info(
            f"MoveRestatedContact: model={geotech_model_id} upper={upper_band_id} "
            f"lower={lower_band_id} depth={new_depth_m:.3f} m"
        )
        # TAKE THE PARTITION LOCKS BEFORE THE FIRST WRITE, not after it. This
        # gesture rewrites TWO body partitions — the geotech bands and the parent
        # litho rows it resizes — while the debounced background
        # ``bodies/recompute`` re-stamps ``litho_layer.body_id`` over the very
        # same rows in a different order (owner dogfeed 2026-08-23: a band edit
        # 500'd with DeadlockDetectedError on ``DELETE FROM litho_layer``).
        # ``ResolveLithoInstances`` below takes the geotech one again for free —
        # the lock is re-entrant per session — but by then the writes have
        # happened, so it is far too late to be the only holder.
        # LITHO PARENT FIRST, THEN THE GEOTECH CHILD — the one multi-model lock
        # order, stated once in ``body_partition_lock``, so two holders can never
        # take this pair in opposite orders and deadlock on the locks. The
        # geological arm needs none: a geological model carries formation
        # contacts, not the ``litho_layer`` rows a body partition is made of.
        parent_litho_model_id = await self._parent_litho_model_id(geotech_model_id)
        for partition_model_id in (parent_litho_model_id, geotech_model_id):
            await lock_body_partition(
                self._session, model_id=partition_model_id, operation="move-restated-contact"
            )
        # One context per band, because the two sit in DIFFERENT litho units and
        # each must re-derive under its own soil. A single load would classify one
        # side with the other's NAD column.
        upper_ctx = await load_geotech_column_context(
            self._session,
            self,
            project_id=project_id,
            geotech_model_id=geotech_model_id,
            band_id=upper_band_id,
        )
        lower_ctx = await load_geotech_column_context(
            self._session,
            self,
            project_id=project_id,
            geotech_model_id=geotech_model_id,
            band_id=lower_band_id,
        )
        require_cpt_anchor(upper_ctx, gesture="Contact move")

        plan = plan_restated_contact_move(
            bands=upper_ctx.bands,
            upper_band_id=str(upper_band_id),
            lower_band_id=str(lower_band_id),
            new_depth_m=new_depth_m,
            upper_soil=upper_ctx.soil,
            upper_admixtures=upper_ctx.admixtures,
            lower_soil=lower_ctx.soil,
            lower_admixtures=lower_ctx.admixtures,
            depth_m=upper_ctx.depth_m,
            qc_mpa=upper_ctx.qc_mpa,
            min_thickness_m=upper_ctx.min_thickness_m,
            statistic=upper_ctx.statistic,
        )
        # A landing ON a neighbouring boundary is a MERGE, and the plan says which
        # side it swallows: the downward landing absorbs the lower band (the unit
        # above grows), the upward one absorbs the upper band (the reverse — owner,
        # §4c: "Down = the layer above grows; up = the reverse"). Anything short of
        # either boundary keeps both bands.
        merging = plan.kind == KIND_MERGE
        if merging:
            (merged_outcome,) = plan.intervals
            upper_outcome = lower_outcome = None
        else:
            merged_outcome = None
            upper_outcome, lower_outcome = plan.intervals
        for warning in plan.warnings:
            self.warning(f"MoveRestatedContact: {warning.code} — {warning.message}")

        rows = [upper_ctx.band_rows[str(upper_band_id)], upper_ctx.band_rows[str(lower_band_id)]]
        rows.sort(key=lambda r: r.depth_top_m)
        upper_row, lower_row = rows[0], rows[1]
        boundary_m = round(new_depth_m, LITHO_LAYER_DEPTH_DECIMALS)

        # The litho pair is resolved from the DATABASE, at the boundary being
        # moved — never handed in by the caller. The renderer used to match the
        # band's depth to a contact depth, which stopped working the moment the
        # two stopped coinciding; here they are moved together, so they cannot
        # drift apart in the first place.
        pre_move_boundary_m = upper_row.depth_base_m
        litho_upper, litho_lower = await self._litho_pair_at(
            parent_model_id=parent_litho_model_id,
            investigation_id=upper_ctx.investigation_id,
            boundary_m=pre_move_boundary_m,
        )

        # --- the geological arm, resolved BEFORE anything is written ---------
        # Its one refusal (two geological contacts colliding, below) must leave
        # the transaction untouched, so every lookup happens up front.
        linked_geo_id: UUID | None = litho_lower.parent_geo_contact_id
        geo_at_inv: list[tuple[float, UUID, UUID]] = []
        if linked_geo_id is None or merging:
            geo_model_id = (
                await self._session.execute(
                    select(GeologicalModelOrm.parent_model_id).where(
                        GeologicalModelOrm.id == litho_lower.model_id
                    )
                )
            ).scalar_one_or_none()
            if geo_model_id is not None:
                geo_at_inv = await load_geo_contacts_at_investigation(
                    self._session,
                    geo_model_id,
                    borehole_id=litho_lower.borehole_id,
                    cpt_id=litho_lower.cpt_id,
                )
        # COINCIDENCE COUPLES (owner ruling 2026-08-11, audit F34). The dev
        # model held litho rows sitting bit-for-bit ON a geological contact
        # with no link — provably once-coupled (only the accept-time snap
        # copies the float exactly) and severed later, e.g. by a delete +
        # re-accept. Owner: "it shouldn't be that easy to unlink them." So
        # the move resolves the geological contact the same way it resolves
        # the litho pair — by depth, within the same 1.1 mm tolerance, at
        # which distance accidental coincidence does not exist — carries it,
        # and WRITES THE LINK BACK so the record self-heals on touch.
        healed_geo_id: UUID | None = None
        if linked_geo_id is None:
            healed_geo_id = nearest_geo_contact_within_tolerance(
                pre_move_boundary_m, geo_at_inv, _COINCIDENT_M
            )
        geo_contact_id: UUID | None = linked_geo_id or healed_geo_id
        coupled_geo_id: UUID | None = None
        if merging:
            # A merge may land exactly ON a geological contact — the audit-F03
            # wall REVERSED (owner, 2026-08-12: "yes allow it and couple them,
            # this is unnecessary friction"). The landing neither moves nor
            # crosses the geo contact; the litho contact comes to IT, so the
            # two are coupled and the next drag carries both. The one landing
            # that stays refused: this contact already carrying a DIFFERENT
            # geological contact, which the merge would drop onto the landing's
            # one — two geological contacts at one depth, a corrupt column.
            landing_geo_id = nearest_geo_contact_within_tolerance(
                boundary_m, geo_at_inv, _COINCIDENT_M
            )
            if landing_geo_id is not None and landing_geo_id != geo_contact_id:
                if geo_contact_id is not None:
                    raise GeotechBandEditError(
                        "Contact move rejected: this contact carries its own "
                        "geological contact, and another geological contact "
                        "already sits at the landing — the merge would make the "
                        "two coincide. Merge or move them on the geological "
                        "axis first."
                    )
                coupled_geo_id = landing_geo_id
                geo_contact_id = landing_geo_id
        if geo_contact_id is not None and linked_geo_id is None:
            litho_lower.parent_geo_contact_id = geo_contact_id
            if coupled_geo_id is not None:
                self.info(
                    f"MoveRestatedContact: merge lands on geological contact "
                    f"{coupled_geo_id} — litho layer {litho_lower.id} coupled to it "
                    "(owner ruling 2026-08-12)"
                )
            else:
                self.info(
                    f"MoveRestatedContact: healed severed litho→geo link — layer "
                    f"{litho_lower.id} re-coupled to coinciding contact {geo_contact_id}"
                )

        # --- the write: three levels, one transaction ------------------------
        deleted_band_ids: tuple[UUID, ...] = ()
        if merging:
            assert merged_outcome is not None  # noqa: S101 - narrowed by ``merging``
            # The survivor belongs to the unit that now owns the ground, so its
            # formation is derived under THAT side's parentage — the upper unit's
            # when the lower band is absorbed, the lower unit's for the reverse.
            absorbing_down = plan.absorbs == "lower"
            survivor_ctx = upper_ctx if absorbing_down else lower_ctx
            survivor_row = upper_row if absorbing_down else lower_row
            absorbed_row = lower_row if absorbing_down else upper_row
            survivor_formation = await formation_for_class(
                self,
                project_id=project_id,
                nad_class=merged_outcome.nad_class,
                source_litho_formation_id=survivor_ctx.source_litho_formation_id,
                source_geo_formation_id=survivor_ctx.source_geo_formation_id,
            )
            # Accepted ties on the absorbed row are RE-ANCHORED onto the survivor and
            # flagged for review, never dropped by the FK cascade (flag-not-drop, owner
            # 2026-08-07). The same helper the band merge uses, so the two verbs cannot
            # disagree about what happens to the engineer's own correlations.
            pre_classes = pre_edit_class_snapshot(upper_ctx) | pre_edit_class_snapshot(lower_ctx)
            transfer = await transfer_accepted_edges(
                self._session,
                self,
                model_id=geotech_model_id,
                from_layer_id=absorbed_row.id,
                to_layer_id=survivor_row.id,
                absorbed_class=pre_classes.get(absorbed_row.id),
                survivor_class=merged_outcome.nad_class,
            )
            # The plan is the record of what happened to the engineer's OWN ties —
            # discarding it (audit F09) meant a contact drag-merge flagged and
            # deleted accepted correlations without the response ever saying so,
            # and the keep-or-delete prompt never fired for this gesture.
            transfer_flagged = tuple(m.edge_id for m in transfer.moves)
            transfer_deleted = tuple(transfer.drops) + tuple(transfer.displaced_edge_ids)
            accepted_drops = tuple(transfer.drops)
            survivor_row.depth_top_m = merged_outcome.depth_top_m
            survivor_row.depth_base_m = merged_outcome.depth_base_m
            survivor_row.formation_id = survivor_formation.id
            survivor_row.source = MANUAL_BAND_SOURCE
            deleted_band_ids = (absorbed_row.id,)
            await self._session.delete(absorbed_row)
        else:
            survivor_row = upper_row  # unused in this branch; bound for the shared tail
            transfer_flagged = ()
            transfer_deleted = ()
            accepted_drops = ()
            assert upper_outcome is not None and lower_outcome is not None  # noqa: S101
            upper_formation = await formation_for_class(
                self,
                project_id=project_id,
                nad_class=upper_outcome.nad_class,
                source_litho_formation_id=upper_ctx.source_litho_formation_id,
                source_geo_formation_id=upper_ctx.source_geo_formation_id,
            )
            lower_formation = await formation_for_class(
                self,
                project_id=project_id,
                nad_class=lower_outcome.nad_class,
                source_litho_formation_id=lower_ctx.source_litho_formation_id,
                source_geo_formation_id=lower_ctx.source_geo_formation_id,
            )
            upper_row.depth_base_m = boundary_m
            upper_row.formation_id = upper_formation.id
            upper_row.source = MANUAL_BAND_SOURCE
            lower_row.depth_top_m = boundary_m
            lower_row.formation_id = lower_formation.id
            lower_row.source = MANUAL_BAND_SOURCE

        litho_upper.depth_base_m = boundary_m
        litho_lower.depth_top_m = boundary_m

        if geo_contact_id is not None:
            geo_contact = await self._litho_repo.get_formation_contact(geo_contact_id)
            if geo_contact is None:
                self.warning(
                    f"MoveRestatedContact: litho layer {litho_lower.id} names geological "
                    f"contact {geo_contact_id}, which no longer exists — nothing carried"
                )
                geo_contact_id = None
            else:
                self.debug(
                    f"MoveRestatedContact: carrying geological contact {geo_contact.id} "
                    f"{geo_contact.depth_top_m:.3f} → {boundary_m:.3f} m"
                )
                geo_contact.depth_top_m = boundary_m
                # The TIN was interpolated through this contact at its old depth.
                await self._litho_repo.mark_geo_surfaces_stale(
                    [(geo_contact.model_id, geo_contact.formation_id)]
                )

        await self._session.flush()

        revalidation = await revalidate_layer_edges(
            self._session,
            self,
            model_id=geotech_model_id,
            new_class_by_layer_id=(
                {survivor_row.id: merged_outcome.nad_class}  # type: ignore[union-attr]
                if merging
                else {
                    upper_row.id: upper_outcome.nad_class,  # type: ignore[union-attr]
                    lower_row.id: lower_outcome.nad_class,  # type: ignore[union-attr]
                }
            ),
            old_class_by_layer_id=(
                pre_edit_class_snapshot(upper_ctx) | pre_edit_class_snapshot(lower_ctx)
            ),
        )

        # Both models' 3-D caches: the packing bands moved AND the litho column did.
        await self._litho_repo.mark_litho_solids_stale(geotech_model_id)
        await self._litho_repo.mark_litho_solids_stale(litho_upper.model_id)
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model_id, commit=False)
        # The packing bands were re-derived either side of the moved contact,
        # so a class that no longer appears leaves its formation with nothing.
        await OrphanFormationSweep(self._session).sweep_geotech_units(project_id)
        await self._session.commit()

        self.success(
            f"MoveRestatedContact: contact at {boundary_m:.3f} m moved in "
            f"{'3' if geo_contact_id is not None else '2'} model(s)"
        )
        # The transferred ties were flagged BY the transfer; the revalidation judged
        # the survivor's pre-existing ones. The union is what the UI reports — the
        # same rule MergeGeotechBands applies, so the two merge verbs cannot tell
        # the engineer different stories about one operation.
        flagged = tuple(dict.fromkeys(transfer_flagged + tuple(revalidation.flagged_edge_ids)))
        return RestatedContactMoveResult(
            band_result=GeotechBandEditResult(
                geotech_model_id=geotech_model_id,
                investigation_id=upper_ctx.investigation_id,
                plan=plan,
                layer_ids=(survivor_row.id,) if merging else (upper_row.id, lower_row.id),
                created_layer_ids=(),
                deleted_layer_ids=deleted_band_ids,
                deleted_edge_ids=transfer_deleted + tuple(revalidation.deleted_edge_ids),
                deleted_accepted_edge_ids=accepted_drops,
                flagged_edge_ids=flagged,
                cleared_edge_ids=revalidation.cleared_edge_ids,
            ),
            litho_upper_layer_id=litho_upper.id,
            litho_lower_layer_id=litho_lower.id,
            geo_contact_id=geo_contact_id,
        )

    async def _parent_litho_model_id(self, geotech_model_id: UUID) -> UUID:
        """Return the lithostratigraphic model this geotechnical model refines.

        Resolved up front, because it is the SECOND body partition this gesture
        rewrites and both locks have to be taken together, before any write.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model being edited.

        Returns
        -------
        UUID
            The parent lithostratigraphic model's id.

        Raises
        ------
        GeotechBandEditError
            When the geotechnical model names no parent — there is then no
            lithostratigraphic contact to move at all.
        """
        parent_model_id: UUID | None = (
            await self._session.execute(
                select(GeologicalModelOrm.parent_model_id).where(
                    GeologicalModelOrm.id == geotech_model_id
                )
            )
        ).scalar_one_or_none()
        if parent_model_id is None:
            raise GeotechBandEditError(
                "Contact move rejected: this geotechnical model names no parent "
                "lithostratigraphic model, so there is no contact to move."
            )
        return parent_model_id

    async def _litho_pair_at(
        self,
        *,
        parent_model_id: UUID,
        investigation_id: UUID,
        boundary_m: float,
    ) -> tuple[LithoLayerOrm, LithoLayerOrm]:
        """Find the two litho rows that share the boundary being moved.

        Parameters
        ----------
        parent_model_id : UUID
            The lithostratigraphic model the geotech model refines — the one
            searched. Packing bands are ``litho_layer`` rows too, and the upper
            BAND's own base is exactly this boundary, so an unscoped search would
            match the band itself and "move the litho contact" would silently
            move a packing band a second time.
        investigation_id : UUID
            The column the boundary sits on.
        boundary_m : float
            The boundary's depth TODAY, before the move.

        Returns
        -------
        tuple[LithoLayerOrm, LithoLayerOrm]
            The layer above and the layer below, in that order.

        Raises
        ------
        GeotechBandEditError
            When no accepted litho pair meets at that depth. That is a real
            disagreement between the two models, not a rounding matter, and
            guessing a row would move something the engineer never pointed at.
        """
        rows = (
            (
                await self._session.execute(
                    select(LithoLayerOrm).where(
                        (LithoLayerOrm.model_id == parent_model_id)
                        & (
                            (LithoLayerOrm.cpt_id == investigation_id)
                            | (LithoLayerOrm.borehole_id == investigation_id)
                        )
                        & (LithoLayerOrm.status == "accepted")
                    )
                )
            )
            .scalars()
            .all()
        )
        # NEAREST match, not first match. The tolerance (1.1 mm) exceeds the litho
        # minimum thickness (1.0 mm), so a legal sliver layer beside the contact
        # can put TWO rows' edges inside it — and an unordered first-match then
        # picks whichever row the driver returned first (audit F18: the write
        # could nondeterministically resize the wrong litho row, or return one
        # sliver as BOTH sides and degenerate it to zero thickness).
        upper_candidates = sorted(
            (r for r in rows if abs(r.depth_base_m - boundary_m) <= _COINCIDENT_M),
            key=lambda r: abs(r.depth_base_m - boundary_m),
        )
        lower_candidates = sorted(
            (r for r in rows if abs(r.depth_top_m - boundary_m) <= _COINCIDENT_M),
            key=lambda r: abs(r.depth_top_m - boundary_m),
        )
        upper = upper_candidates[0] if upper_candidates else None
        lower = lower_candidates[0] if lower_candidates else None
        if upper is None or lower is None:
            raise GeotechBandEditError(
                f"Contact move rejected: no lithostratigraphic contact is recorded at "
                f"{boundary_m:.3f} m on this column, so there is nothing to move. The "
                "two models disagree about where this boundary is."
            )
        # The pair must be the two SIDES of one contact: distinct rows whose
        # shared edge is the boundary itself. One sliver matching both
        # predicates, or two rows that do not actually touch, is the two models
        # disagreeing — refuse rather than resize something the engineer never
        # pointed at.
        if upper.id == lower.id or abs(upper.depth_base_m - lower.depth_top_m) > _COINCIDENT_M:
            raise GeotechBandEditError(
                f"Contact move rejected: the litho rows around {boundary_m:.3f} m do "
                "not meet at one contact (a sub-millimetre layer sits beside it). "
                "Repair the lithostratigraphic column first."
            )
        return upper, lower

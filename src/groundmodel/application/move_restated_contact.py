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
from groundmodel.domain.services.geotech_band_reclassification import (
    KIND_MERGE,
    GeotechBandEditError,
    plan_restated_contact_move,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm

# Depths are rounded to the millimetre before they are written — the no-overlap
# exclusion constraint compares ``round(depth, 3)``.
_DEPTH_DECIMALS = 3

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
        The geological contact carried along, or ``None`` when the litho row is
        not derived from one.
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
        # A landing ON the next boundary is a MERGE: the band between the contact and
        # that boundary is absorbed into the one above, because the litho unit above
        # now owns the ground down to it. Anything short of it keeps both bands.
        merging = plan.kind == KIND_MERGE
        if merging:
            (upper_outcome,) = plan.intervals
            lower_outcome = None
        else:
            upper_outcome, lower_outcome = plan.intervals
        for warning in plan.warnings:
            self.warning(f"MoveRestatedContact: {warning.code} — {warning.message}")

        rows = [upper_ctx.band_rows[str(upper_band_id)], upper_ctx.band_rows[str(lower_band_id)]]
        rows.sort(key=lambda r: r.depth_top_m)
        upper_row, lower_row = rows[0], rows[1]
        boundary_m = round(new_depth_m, _DEPTH_DECIMALS)

        # The litho pair is resolved from the DATABASE, at the boundary being
        # moved — never handed in by the caller. The renderer used to match the
        # band's depth to a contact depth, which stopped working the moment the
        # two stopped coinciding; here they are moved together, so they cannot
        # drift apart in the first place.
        litho_upper, litho_lower = await self._litho_pair_at(
            geotech_model_id=geotech_model_id,
            investigation_id=upper_ctx.investigation_id,
            boundary_m=upper_row.depth_base_m,
        )

        upper_formation = await formation_for_class(
            self,
            project_id=project_id,
            nad_class=upper_outcome.nad_class,
            source_litho_formation_id=upper_ctx.source_litho_formation_id,
            source_geo_formation_id=upper_ctx.source_geo_formation_id,
        )
        lower_formation = (
            None
            if lower_outcome is None
            else await formation_for_class(
                self,
                project_id=project_id,
                nad_class=lower_outcome.nad_class,
                source_litho_formation_id=lower_ctx.source_litho_formation_id,
                source_geo_formation_id=lower_ctx.source_geo_formation_id,
            )
        )

        # --- the write: three levels, one transaction ------------------------
        upper_row.depth_base_m = boundary_m
        upper_row.formation_id = upper_formation.id
        upper_row.source = "manual"
        deleted_band_ids: tuple[UUID, ...] = ()
        if merging:
            # Accepted ties on the absorbed row are RE-ANCHORED onto the survivor and
            # flagged for review, never dropped by the FK cascade (flag-not-drop, owner
            # 2026-08-07). The same helper the band merge uses, so the two verbs cannot
            # disagree about what happens to the engineer's own correlations.
            await transfer_accepted_edges(
                self._session,
                self,
                model_id=geotech_model_id,
                from_layer_id=lower_row.id,
                to_layer_id=upper_row.id,
                survivor_class=upper_outcome.nad_class,
            )
            deleted_band_ids = (lower_row.id,)
            await self._session.delete(lower_row)
        else:
            assert lower_formation is not None  # noqa: S101 - narrowed by ``merging``
            lower_row.depth_top_m = boundary_m
            lower_row.formation_id = lower_formation.id
            lower_row.source = "manual"

        litho_upper.depth_base_m = boundary_m
        litho_lower.depth_top_m = boundary_m

        geo_contact_id: UUID | None = litho_lower.parent_geo_contact_id
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
                {upper_row.id: upper_outcome.nad_class}
                if merging
                else {
                    upper_row.id: upper_outcome.nad_class,
                    lower_row.id: lower_outcome.nad_class,  # type: ignore[union-attr]
                }
            ),
        )

        # Both models' 3-D caches: the packing bands moved AND the litho column did.
        await self._litho_repo.mark_litho_solids_stale(geotech_model_id)
        await self._litho_repo.mark_litho_solids_stale(litho_upper.model_id)
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model_id, commit=False)
        await self._session.commit()

        self.success(
            f"MoveRestatedContact: contact at {boundary_m:.3f} m moved in "
            f"{'3' if geo_contact_id is not None else '2'} model(s)"
        )
        return RestatedContactMoveResult(
            band_result=GeotechBandEditResult(
                geotech_model_id=geotech_model_id,
                investigation_id=upper_ctx.investigation_id,
                plan=plan,
                layer_ids=(upper_row.id,) if merging else (upper_row.id, lower_row.id),
                created_layer_ids=(),
                deleted_layer_ids=deleted_band_ids,
                deleted_edge_ids=revalidation.deleted_edge_ids,
                flagged_edge_ids=revalidation.flagged_edge_ids,
                cleared_edge_ids=revalidation.cleared_edge_ids,
            ),
            litho_upper_layer_id=litho_upper.id,
            litho_lower_layer_id=litho_lower.id,
            geo_contact_id=geo_contact_id,
        )

    async def _litho_pair_at(
        self,
        *,
        geotech_model_id: UUID,
        investigation_id: UUID,
        boundary_m: float,
    ) -> tuple[LithoLayerOrm, LithoLayerOrm]:
        """Find the two litho rows that share the boundary being moved.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotech model being edited; its PARENT is the litho model searched.
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
        # Scoped to the geotech model's PARENT. Packing bands are ``litho_layer``
        # rows too, and the upper BAND's own base is exactly this boundary — an
        # unscoped search would match the band itself, and "move the litho contact"
        # would silently move a packing band a second time.
        parent_model_id = (
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
        upper = next((r for r in rows if abs(r.depth_base_m - boundary_m) <= _COINCIDENT_M), None)
        lower = next((r for r in rows if abs(r.depth_top_m - boundary_m) <= _COINCIDENT_M), None)
        if upper is None or lower is None or upper.model_id != lower.model_id:
            raise GeotechBandEditError(
                f"Contact move rejected: no lithostratigraphic contact is recorded at "
                f"{boundary_m:.3f} m on this column, so there is nothing to move. The "
                "two models disagree about where this boundary is."
            )
        return upper, lower

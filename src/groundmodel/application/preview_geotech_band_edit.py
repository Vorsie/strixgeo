"""Preview a hand split or merge of NAD packing bands — answer before committing.

The UI calls this before it writes anything: it asks "what would this split /
this merge do?" and gets back, per resulting interval, the representative
(median) qc, the re-derived NAD class, the class the material carries today, and
the plain-language consequence of the move.

Two things this preview deliberately does NOT do:

* It does not guess. When the cone resistance over an interval cannot answer —
  absent, void, or too gappy — the interval comes back with ``nad_class=None``
  and a reason, because ``classify_nad`` rejects invalid input by design (owner
  rule 2026-07-25) and a plausible-looking class would be worse than silence.
* It does not block. Everything except a breach of the three-level hierarchy is
  a warning; the hierarchy itself (a split outside the band's litho body, a
  merge across a litho or geological contact) raises
  :class:`GeotechBandEditError`, which the router maps to a 422.

The one other refusal is the anchor (owner ruling A): a band on a borehole is
rejected here as well as at the commit, because a preview that answered "here is
what this would do" for an edit the commit refuses would be worse than either
refusal alone.

The statistic is the MODEL'S CHOICE (ruling 7; median by default), read through
the same ``representative_statistic`` path the classifier reads, so the preview
predicts the reclassification that will actually happen. A preview on any other
statistic would sometimes promise a class change that never occurs, and miss
one that does (ruling 6).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.geotech_band_edit_helpers import (
    load_geotech_column_context,
    require_cpt_anchor,
)
from groundmodel.domain.services.geotech_band_reclassification import (
    BandEditPlan,
    GeotechBandEditError,
    plan_absorb_run,
    plan_merge_run,
    plan_move,
    plan_split,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class PreviewGeotechBandEdit(GroundModelLogger):
    """Read-only "what would this do?" for a packing-band split or merge.

    Reads one column, plans the edit with the shared pure domain functions, and
    returns the plan. Nothing is written and nothing is committed.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def preview_split(
        self,
        *,
        project_id: UUID,
        geotech_model_id: UUID,
        band_id: UUID,
        split_depth_m: float,
    ) -> BandEditPlan:
        """Preview splitting one packing band at ``split_depth_m``.

        Parameters
        ----------
        project_id : UUID
            Owning project (scope guard).
        geotech_model_id : UUID
            The geotechnical model the band belongs to.
        band_id : UUID
            The band to split.
        split_depth_m : float
            Proposed boundary depth (metres, positive down).

        Returns
        -------
        BandEditPlan
            The two resulting intervals with their re-derived classes, plus the
            advisory warnings.

        Raises
        ------
        GeotechBandEditError
            When the depth falls outside the band's own litho body.
        """
        self.info(
            f"PreviewGeotechBandEdit.split: model={geotech_model_id} band={band_id} "
            f"depth={split_depth_m:.3f} m"
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
        self._log_plan("split", plan)
        return plan

    async def preview_merge(
        self,
        *,
        project_id: UUID,
        geotech_model_id: UUID,
        upper_band_id: UUID | None = None,
        lower_band_id: UUID | None = None,
        band_ids: list[UUID] | None = None,
    ) -> BandEditPlan:
        """Preview merging a contiguous run of packing bands into one.

        Parameters
        ----------
        project_id : UUID
            Owning project (scope guard).
        geotech_model_id : UUID
            The geotechnical model the bands belong to.
        upper_band_id, lower_band_id : UUID
            The adjacent pair to merge (the ordinary case).
        band_ids : list[UUID] | None
            An N-band contiguous run instead of the pair (the small-lens
            absorb: host + lens + host in one honest preview). When given,
            the pair arguments are ignored.

        Returns
        -------
        BandEditPlan
            One interval spanning the union with its re-derived class, plus the
            advisory warnings that say what each input band's representative qc
            does.

        Raises
        ------
        GeotechBandEditError
            When the run is not consecutive same-parentage neighbours.
        """
        if band_ids:
            run: list[UUID] = list(band_ids)
        elif upper_band_id is not None and lower_band_id is not None:
            run = [upper_band_id, lower_band_id]
        else:
            raise GeotechBandEditError(
                "Merge rejected: provide the adjacent pair or a band_ids run."
            )
        self.info(
            f"PreviewGeotechBandEdit.merge: model={geotech_model_id} run={[str(b) for b in run]}"
        )
        context = await load_geotech_column_context(
            self._session,
            self,
            project_id=project_id,
            geotech_model_id=geotech_model_id,
            band_id=run[0],
        )
        require_cpt_anchor(context, gesture="Merge")
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
        self._log_plan("merge", plan)
        return plan

    async def preview_move(
        self,
        *,
        project_id: UUID,
        geotech_model_id: UUID,
        upper_band_id: UUID,
        lower_band_id: UUID,
        new_depth_m: float,
    ) -> BandEditPlan:
        """Preview dragging the shared boundary of two adjacent packing bands.

        Parameters
        ----------
        project_id : UUID
            Owning project (scope guard).
        geotech_model_id : UUID
            The geotechnical model the bands belong to.
        upper_band_id, lower_band_id : UUID
            The adjacent pair whose shared boundary moves.
        new_depth_m : float
            The proposed boundary depth (metres, positive down).

        Returns
        -------
        BandEditPlan
            Both resulting intervals with their re-derived classes, plus the
            advisory warnings.

        Raises
        ------
        GeotechBandEditError
            When the pair is not draggable (different parents = a contact) or
            the depth is not strictly inside the pair.
        """
        self.info(
            f"PreviewGeotechBandEdit.move: model={geotech_model_id} "
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
        self._log_plan("move", plan)
        return plan

    async def preview_absorb_run(
        self,
        *,
        project_id: UUID,
        geotech_model_id: UUID,
        band_ids: list[UUID],
        entered_band_id: UUID | None,
        new_depth_m: float | None,
    ) -> BandEditPlan:
        """Preview a Ctrl+drag absorb-all (owner 2026-09-25).

        Parameters
        ----------
        project_id : UUID
            Owning project (scope guard).
        geotech_model_id : UUID
            The geotechnical model the bands belong to.
        band_ids : list[UUID]
            The run that unions: the dragged band plus every band it passed.
        entered_band_id : UUID | None
            The band the release landed in; ``None`` at the litho wall.
        new_depth_m : float | None
            The released depth inside that band; ``None`` at the wall.

        Returns
        -------
        BandEditPlan
            The final intervals with their re-derived classes, plus the
            advisory warnings.

        Raises
        ------
        GeotechBandEditError
            When the run or the landing is not one the rules allow.
        """
        self.info(
            f"PreviewGeotechBandEdit.absorb_run: model={geotech_model_id} "
            f"run={[str(b) for b in band_ids]} entered={entered_band_id} depth={new_depth_m}"
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
        self._log_plan("absorb", plan)
        return plan

    def _log_plan(self, kind: str, plan: BandEditPlan) -> None:
        """Log the previewed outcome, including what it could NOT answer.

        Parameters
        ----------
        kind : str
            ``"split"`` or ``"merge"``.
        plan : BandEditPlan
            The plan to report.
        """
        for interval in plan.intervals:
            if interval.nad_class is None:
                self.warning(
                    f"Preview {kind}: {interval.depth_top_m:.2f}–{interval.depth_base_m:.2f} m "
                    f"cannot be classified — {interval.unclassifiable_reason}"
                )
            else:
                self.debug(
                    f"Preview {kind}: {interval.depth_top_m:.2f}–{interval.depth_base_m:.2f} m "
                    f"median_qc={interval.median_qc_mpa:.2f} MPa "
                    f"class {interval.previous_nad_class} → {interval.nad_class}"
                )
        self.success(
            f"Preview {kind}: {len(plan.intervals)} interval(s), "
            f"{len(plan.warnings)} warning(s), bounds "
            f"{plan.parent_top_m:.2f}–{plan.parent_base_m:.2f} m"
        )

"""Manual rebuild of every cached TIN surface in a model.

The auto-recompute hooks attached to every contact-mutating use case
keep the ``formation_surface`` cache fresh on the happy path. This
use case is the **manual escape hatch** for the cases the hooks
can't cover:

* a checksum-collision false-negative (recompute skipped because the
  inputs hashed to the same value but the geometry actually changed —
  not believed to happen today, but the rebuild button is the safety
  rail if it ever does);
* contacts mutated outside the use case layer (a bulk DB script, a
  manual psql session, a future bundle restore that bypasses the
  per-mutation hooks);
* an anchor's surface elevation changed after a contact was created
  (today every contact-mutating use case rebuilds its own formations,
  but ``PATCH /cpt/{id}/elevation`` and ``PATCH /borehole/{id}/elevation``
  do NOT — the user's escape hatch when they re-set Z is to click
  Rebuild).

Idempotent — every formation runs through the same checksum
short-circuit as the auto-recompute path. A clean model is a no-op
(``formations_rebuilt == 0``).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.recompute_formation_surface import (
    RecomputeFormationSurface,
)
from groundmodel.domain.services.formation_age_order import infer_age_order
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class RebuildOutcome:
    """Summary of one rebuild pass."""

    formations_considered: int
    formations_rebuilt: int
    formations_reordered: int = 0


class RebuildModelSurfaces(GroundModelLogger):
    """Force-recompute every formation's TIN cache in one model."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(self, model_id: UUID) -> RebuildOutcome:
        """Recompute the surface cache for every formation in the model.

        Loads the distinct formation_ids that have at least one
        contact in this model, then dispatches to
        ``RecomputeFormationSurface.execute_many``. Formations with
        no contacts are not in the result — the cache for them is
        already empty and there is nothing to rebuild.

        Parameters
        ----------
        model_id : UUID

        Returns
        -------
        RebuildOutcome
            ``formations_considered`` is the number of distinct
            formations the model has contacts for; ``formations_rebuilt``
            is the subset whose checksum actually changed (i.e. the
            cache write fired).
        """
        self.info(f"rebuild surfaces: model={model_id}")
        formation_ids = list(
            (
                await self._session.execute(
                    select(FormationContactOrm.formation_id)
                    .where(FormationContactOrm.model_id == model_id)
                    .distinct()
                )
            )
            .scalars()
            .all()
        )

        if not formation_ids:
            self.info(f"rebuild surfaces: model={model_id} no contacts → no-op")
            return RebuildOutcome(formations_considered=0, formations_rebuilt=0)

        recompute = RecomputeFormationSurface(self._session)
        rebuilt = await recompute.execute_many((model_id, fid) for fid in formation_ids)
        # Auto-derive formation age order from the data the user just
        # built against. This corrects display_order when natural
        # top-down creation order doesn't match geological age — the
        # same fix the engineer would otherwise apply manually by
        # dragging in InterpretationPane.
        reordered = await self._reorder_by_age(model_id)
        if rebuilt or reordered:
            await self._session.commit()
        self.success(
            f"rebuild surfaces: model={model_id} considered={len(formation_ids)} "
            f"rebuilt={rebuilt} reordered={reordered}"
        )
        return RebuildOutcome(
            formations_considered=len(formation_ids),
            formations_rebuilt=rebuilt,
            formations_reordered=reordered,
        )

    async def _reorder_by_age(self, model_id: UUID) -> int:
        """Re-sort ``display_order`` from per-investigation contact depths.

        Each anchor with ≥2 contacts gives a local "younger on top"
        partial order; aggregating across anchors and toposorting
        yields a globally consistent youngest-first sequence. Orphan
        formations (no contacts in this model) keep their relative
        position from the current ``display_order``. Final
        assignment compacts to 0..N-1 across every project formation,
        mirroring the drag-end reorder convention documented in
        CLAUDE.md ("display_order is the age axis").

        Returns
        -------
        int
            Number of formations whose ``display_order`` actually
            changed. ``0`` means the current order already matched
            the data — common after the first build.
        """
        # Load every contact on this model with anchor + depth.
        rows = (
            await self._session.execute(
                select(
                    FormationContactOrm.formation_id,
                    FormationContactOrm.borehole_id,
                    FormationContactOrm.cpt_id,
                    FormationContactOrm.depth_top_m,
                ).where(FormationContactOrm.model_id == model_id)
            )
        ).all()
        if not rows:
            return 0

        contacts_by_anchor: dict[UUID, list[tuple[float, UUID]]] = defaultdict(list)
        with_contacts: set[UUID] = set()
        for fid, bh_id, cpt_id, depth in rows:
            anchor = bh_id or cpt_id
            if anchor is None:
                continue
            contacts_by_anchor[anchor].append((depth, fid))
            with_contacts.add(fid)

        # Find the model's project so we can include orphan formations
        # (those without any contact in this model) in the final
        # ordering — they keep their existing display_order's relative
        # position rather than getting reshuffled by the algorithm.
        project_id = (
            await self._session.execute(
                select(GeologicalModelOrm.app_project_id).where(GeologicalModelOrm.id == model_id)
            )
        ).scalar_one()
        all_formations = list(
            (
                await self._session.execute(
                    select(GeologicalFormationOrm).where(
                        GeologicalFormationOrm.app_project_id == project_id
                    )
                )
            )
            .scalars()
            .all()
        )
        if not all_formations:
            return 0

        # Algorithm orders the contact-bearing formations by data;
        # orphans append in their current display_order so a manual
        # drag-reorder on an unplaced formation survives Build.
        age_ordered = infer_age_order(
            contacts_by_anchor=contacts_by_anchor,
            all_formation_ids=list(with_contacts),
        )
        orphans = sorted(
            (f for f in all_formations if f.id not in with_contacts),
            key=lambda f: f.display_order,
        )
        final_order: list[UUID] = age_ordered + [f.id for f in orphans]
        new_order_by_fid = {fid: i for i, fid in enumerate(final_order)}

        changed = 0
        for f in all_formations:
            target = new_order_by_fid.get(f.id)
            if target is None:
                continue
            if f.display_order != target:
                f.display_order = target
                changed += 1
        return changed

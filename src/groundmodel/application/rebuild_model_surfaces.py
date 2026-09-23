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

Always recomputes. The manual "Build 3D model" click forces a full
re-triangulation of every formation that has contacts (``force=True``
on ``execute_many``), bypassing the contact checksum. WHY: the
checksum hashes only the *input contacts*, not the output geometry —
so a code change that alters the TIN from the *same* contacts (e.g. a
boundary-trim tweak) would otherwise short-circuit and keep serving
the stale cached surface. An explicit Build must reflect the current
code. ``formations_rebuilt`` therefore equals the number of
formations with contacts, not "the subset whose checksum changed".
The automatic dedupe path still uses the checksum short-circuit (its
contacts change anyway, and it is the high-frequency path).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.recompute_formation_surface import (
    RecomputeFormationSurface,
)
from groundmodel.application.section_membership import (
    load_section_member_investigation_ids,
)
from groundmodel.domain.services.formation_age_order import infer_age_order
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.formation_surface_orm import (
    FormationSurfaceOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.repositories.investigation_review_repository import (
    InvestigationReviewRepository,
)
from groundmodel.shared.constants.model_kind import NON_STRATIGRAPHIC_KINDS
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

    async def execute(
        self,
        model_id: UUID,
        *,
        ground_sampler: Callable[[float, float], float | None] | None = None,
    ) -> RebuildOutcome:
        """Recompute the surface cache for every formation in the model.

        Loads the distinct formation_ids that have at least one
        contact in this model, then dispatches to
        ``RecomputeFormationSurface.execute_many``. Formations with
        no contacts are not in the result — the cache for them is
        already empty and there is nothing to rebuild.

        Parameters
        ----------
        model_id : UUID
        ground_sampler : Callable[[float, float], float | None] or None, keyword-only
            The ground surface (DEM + manual bed overrides) to clip every
            formation TIN against (owner ruling 2026-09-06). Forwarded to
            ``RecomputeFormationSurface.execute_many`` so each formation is cut
            where it crosses the ground. ``None`` (default) applies no clip —
            the surfaces are triangulated as before, byte-identical for a model
            with no dredged terrain.

        Returns
        -------
        RebuildOutcome
            ``formations_considered`` is the number of distinct
            formations the model has contacts for; ``formations_rebuilt``
            equals it (the manual Build forces every one — see the
            module docstring), plus any stale-orphan formations picked
            up to clear their flag.
        """
        self.info(f"rebuild surfaces: model={model_id}")
        contact_fids = set(
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
        # Orphan stale surfaces: a formation whose last contact was
        # deleted leaves the surface row behind with is_stale=True from
        # the delete's mark_surfaces_stale call. The contact-only query
        # above misses it, so the rebuild would never clear the flag and
        # the "N unbuilt edits" badge sticks forever. Pick those up so
        # one Build click reaches a clean state.
        stale_orphan_fids = set(
            (
                await self._session.execute(
                    select(FormationSurfaceOrm.formation_id)
                    .where(FormationSurfaceOrm.model_id == model_id)
                    .where(FormationSurfaceOrm.is_stale.is_(True))
                )
            )
            .scalars()
            .all()
        )
        formation_ids = list(contact_fids | stale_orphan_fids)

        if not formation_ids:
            self.info(f"rebuild surfaces: model={model_id} no contacts → no-op")
            return RebuildOutcome(formations_considered=0, formations_rebuilt=0)

        # Removed-from-project (hidden) investigations are not model inputs
        # (owner ruling 2026-09-06). Load the set ONCE for the whole build and
        # hand it to every formation recompute, so each drops those contacts
        # and — when that leaves a formation with < 3 contacts — its surface is
        # deleted, and the surface stops reflecting a test the user removed.
        project_id = (
            await self._session.execute(
                select(GeologicalModelOrm.app_project_id).where(GeologicalModelOrm.id == model_id)
            )
        ).scalar_one_or_none()
        hidden_ids: set[UUID] = (
            await InvestigationReviewRepository(self._session).hidden_investigation_ids(project_id)
            if project_id is not None
            else set()
        )
        # Only tests a cross-section draws are model inputs (owner ruling
        # 2026-09-23). Same batch treatment: one membership load per Build.
        member_ids: set[UUID] = (
            await load_section_member_investigation_ids(self._session, project_id=project_id)
            if project_id is not None
            else set()
        )
        self.info(
            f"rebuild surfaces: model={model_id} {len(member_ids)} test(s) on a section, "
            f"{len(hidden_ids)} hidden"
        )

        recompute = RecomputeFormationSurface(self._session)
        # force=True: an explicit Build always re-triangulates, even
        # when the contacts (hence the checksum) are unchanged — so a
        # TIN-algorithm change is reflected without the user having to
        # mutate a contact to bust the cache.
        rebuilt = await recompute.execute_many(
            ((model_id, fid) for fid in formation_ids),
            force=True,
            hidden_investigation_ids=hidden_ids,
            section_member_ids=member_ids,
            ground_sampler=ground_sampler,
        )
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

        # Debt #69: load the model's kind AND project_id together so we
        # can scope the formation set + short-circuit on non-stratigraphic
        # models. Without this, building any model rewrote display_order
        # across EVERY project formation regardless of kind — so a
        # geological Build silently renumbered the litho units that
        # AcceptLithoSuggestions._recompute_litho_display_orders just
        # set, treating them as orphans sorted after all geo rows.
        model_row = (
            await self._session.execute(
                select(
                    GeologicalModelOrm.app_project_id,
                    GeologicalModelOrm.kind,
                ).where(GeologicalModelOrm.id == model_id)
            )
        ).one()
        project_id = model_row.app_project_id
        kind = model_row.kind
        # Non-stratigraphic kinds (lithostratigraphic, geotechnical) do
        # not obey strict age superposition — interfingering sand/clay
        # is real geology — so age-based reorder is meaningless for them
        # AND would clobber the per-instance ordinal display_orders set
        # by the litho accept path. The crossings validator already
        # honours this invariant via the same constant.
        if kind in NON_STRATIGRAPHIC_KINDS:
            return 0
        # Geological build: include ONLY geological-level formations in
        # the reorder pool. Litho units have parent_formation_id NOT
        # NULL; geotech units have nad_class NOT NULL. Filtering both
        # out scopes the reorder to the geological vocabulary even
        # though geological_formation is shared across all three kinds.
        all_formations = list(
            (
                await self._session.execute(
                    select(GeologicalFormationOrm).where(
                        GeologicalFormationOrm.app_project_id == project_id,
                        GeologicalFormationOrm.parent_formation_id.is_(None),
                        GeologicalFormationOrm.nad_class.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        if not all_formations:
            return 0

        # Debt #35: pinned formations were manually drag-reordered by
        # the engineer — Build's age inference is exactly the thing they
        # overrode (pinch-outs / unconformities / inversion the data
        # can't disambiguate). Keep every pinned formation at its EXACT
        # current display_order; only the non-pinned formations get
        # re-flowed, into whatever slots the pinned ones don't occupy.
        pinned_order_by_fid: dict[UUID, int] = {
            f.id: f.display_order for f in all_formations if f.pinned_order
        }
        pinned_ids = set(pinned_order_by_fid)
        occupied = set(pinned_order_by_fid.values())

        # Algorithm orders the contact-bearing formations by data;
        # orphans append in their current display_order so a manual
        # drag-reorder on an unplaced formation survives Build. Pinned
        # formations are removed from the re-flow entirely.
        #
        # ``infer_age_order`` returns YOUNGEST-FIRST. CLAUDE.md
        # ("display_order is the age axis") specifies lower
        # display_order = OLDER, so the contact-bearing run must be
        # reversed before slot assignment — oldest gets the lowest
        # free_slot, youngest the highest. Orphans append AFTER the
        # contact-bearing run so they fall in the youngest-end slots
        # (preserving the "manual drag-reorder on an unplaced formation
        # survives Build" property — they stay at the high-display_order
        # end where the inspector renders them at the top). Resolves
        # debt #177 (age-reorder direction inversion).
        # Label each formation for the anthropogenic-youngest pin. Pass
        # the DOV code (regional_ref) when present, else the name, so the
        # pin fires whether Antropogeen arrives as the code "A" or the
        # name "Antropogeen" (owner ruling 2026-09-05), and likewise for
        # DOV's disturbed group, code "G" (owner 2026-09-23).
        labels_by_formation = {f.id: (f.regional_ref or f.name) for f in all_formations}
        age_ordered_oldest_first = list(
            reversed(
                infer_age_order(
                    contacts_by_anchor=contacts_by_anchor,
                    all_formation_ids=list(with_contacts),
                    labels_by_formation=labels_by_formation,
                )
            )
        )
        orphans = sorted(
            (f for f in all_formations if f.id not in with_contacts),
            key=lambda f: f.display_order,
        )
        non_pinned_sequence: list[UUID] = [
            fid for fid in age_ordered_oldest_first if fid not in pinned_ids
        ] + [f.id for f in orphans if f.id not in pinned_ids]

        # Free slots = 0..N-1 minus the indices the pinned formations
        # hold. Assign the non-pinned sequence into them in order, so
        # the data-driven ordering still applies AROUND the fixed picks.
        free_slots = (i for i in range(len(all_formations)) if i not in occupied)
        new_order_by_fid: dict[UUID, int] = dict(pinned_order_by_fid)
        for fid, slot in zip(non_pinned_sequence, free_slots):
            new_order_by_fid[fid] = slot

        changed = 0
        for f in all_formations:
            if f.id in pinned_ids:
                # Belt-and-braces: never touch a pinned formation even
                # if its stored order somehow drifted from the map.
                continue
            target = new_order_by_fid.get(f.id)
            if target is None:
                continue
            if f.display_order != target:
                f.display_order = target
                changed += 1
        return changed

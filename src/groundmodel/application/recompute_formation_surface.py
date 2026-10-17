"""Recompute the cached TIN for one formation in one model.

Called by every contact-mutating use case after its DB writes
land. Loads the formation's contacts, joins each to its anchor's
(x, y, surface elevation), runs Delaunay via the TIN service, and
upserts the result into the ``formation_surface`` cache row.

Cache-validity short-circuit: if the recomputed checksum matches
the cached one, no DB write fires. Lets a no-op refresh (e.g.
re-PATCH that ended up at the same depth) skip the upsert.

Recompute scope rules
---------------------

* Single mutation → recompute ONE (model, formation) pair.
* PATCH that changes ``formation_id`` → recompute BOTH the old
  and new formations (caller's responsibility to pass both ids).
* Batch mutations → caller collects every affected
  (model, formation) tuple + calls this once per pair after the
  batch commit. Avoids N redundant recomputes inside the loop.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.section_membership import (
    load_section_member_investigation_ids,
)
from groundmodel.domain.services.clip_tin_by_ground_surface import (
    clip_tin_by_ground_surface,
)
from groundmodel.domain.services.formation_surface_contacts import (
    contact_feeds_surface,
)
from groundmodel.domain.services.tin_surface import (
    ContactPoint3D,
    checksum_contacts,
    compute_tin,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.formation_surface_orm import (
    FormationSurfaceOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.repositories.investigation_review_repository import (
    InvestigationReviewRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class RecomputeFormationSurface(GroundModelLogger):
    """Refresh the cached TIN for a (model, formation) pair."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        model_id: UUID,
        formation_id: UUID,
        force: bool = False,
        *,
        hidden_investigation_ids: set[UUID] | None = None,
        section_member_ids: set[UUID] | None = None,
        ground_sampler: Callable[[float, float], float | None] | None = None,
    ) -> bool:
        """Recompute and upsert the surface row.

        Parameters
        ----------
        model_id : UUID
        formation_id : UUID
        ground_sampler : Callable[[float, float], float | None] or None, keyword-only
            The ground surface to clip the formation TIN against (owner ruling
            2026-09-06). When provided, the surface is cut along its crossing
            line with the ground: the part above ground is dropped, the crossing
            line becomes new TIN vertices, and a surface entirely below ground
            is unchanged. ``None`` (default) applies no clip — the auto-recompute
            path, which has no DEM, leaves the surface as triangulated. Only the
            explicit geological Build (which can build the ground) passes it, so
            the cut is an on-click-build artifact that shows in the section view
            and in 3D.
        force : bool, default ``False``
            When ``True``, skip the checksum short-circuit and always
            re-triangulate + upsert. The manual "Build 3D model" path
            passes this so an explicit Build click always reflects the
            current code (e.g. a changed TIN algorithm produces a
            different surface from the *same* contacts — the checksum,
            which hashes only the input contacts, would otherwise
            short-circuit and serve the stale cached geometry). The
            automatic dedupe path leaves it ``False`` (contacts change
            there, so the checksum differs anyway, and the short-circuit
            is the right perf default for the high-frequency path).
        hidden_investigation_ids : set[UUID] or None, keyword-only
            Investigations removed from the project (project-local hide);
            their contacts do not feed the surface. ``None`` (default)
            makes this method load the set itself for the model's project
            — the single-call / auto path. The batch path
            (:class:`RebuildModelSurfaces`) loads it once and passes it
            here so every formation in one Build shares the same lookup.
        section_member_ids : set[UUID] or None, keyword-only
            Investigations that project onto at least one cross-section of
            the project. Only their contacts feed the surface (owner ruling
            2026-09-23: "only don't use tests not on sections for the
            model"). ``None`` (default) makes this method load the set
            itself; the batch path loads it once and passes it here.

        Returns
        -------
        bool
            ``True`` when the cache was refreshed (DB write happened),
            ``False`` when the existing row's checksum already matched
            the recomputed contacts (no-op). ``force=True`` always
            returns ``True``.
        """
        self.debug(f"recompute entry: model={model_id} formation={formation_id}")
        # Load the contacts. Eager-load the polymorphic anchor on each
        # so a single round-trip carries everything we need to build
        # the (x, y, elevation_m) tuples.
        contacts = list(
            (
                await self._session.execute(
                    select(FormationContactOrm).where(
                        FormationContactOrm.model_id == model_id,
                        FormationContactOrm.formation_id == formation_id,
                    )
                )
            )
            .scalars()
            .all()
        )

        # A contact feeds the TIN only when its anchoring investigation is
        # drawn by a cross-section, not excluded from the model and not
        # removed from the project. All three filters SKIP (never delete) the
        # contact row so a section that reaches the test again, un-excluding
        # or un-hiding restores its contribution — mirroring
        # BuildSectionSnapshot's filter-at-projection.
        #
        # * ``excluded_borehole_ids`` (debt #36): a borehole the user excluded
        #   from the model still contributed its (x, y, z) point to the TIN, so
        #   the surface silently disagreed with the section view. Model-scoped,
        #   borehole-only.
        # * ``hidden_investigation_ids`` (owner ruling 2026-09-06): a test
        #   removed from the PROJECT (project-local hide) kept feeding the
        #   surface — its Vlierzele / Pleistoceen TIN survived a rebuild with
        #   no "stale" flag. Project-scoped, CPT and borehole. Loaded here when
        #   the batch caller did not pass it.
        # * ``section_member_ids`` (owner ruling 2026-09-23): a test no
        #   cross-section draws kept feeding the surface after the section
        #   moved away from it — picks nobody can see or correct shaped the
        #   model. The geotech membership invariant, applied to every model.
        #   Project-scoped, CPT and borehole. Loaded here when the batch
        #   caller did not pass it.
        model_row = (
            await self._session.execute(
                select(
                    GeologicalModelOrm.app_project_id,
                    GeologicalModelOrm.excluded_borehole_ids,
                ).where(GeologicalModelOrm.id == model_id)
            )
        ).one_or_none()
        excluded_bh_ids: set[UUID] = set(
            (model_row.excluded_borehole_ids if model_row is not None else None) or []
        )
        hidden_ids = hidden_investigation_ids
        if hidden_ids is None:
            hidden_ids = (
                await InvestigationReviewRepository(self._session).hidden_investigation_ids(
                    model_row.app_project_id
                )
                if model_row is not None
                else set()
            )
        member_ids = section_member_ids
        if member_ids is None:
            member_ids = (
                await load_section_member_investigation_ids(
                    self._session, project_id=model_row.app_project_id
                )
                if model_row is not None
                else set()
            )
        before = len(contacts)
        contacts = [
            c
            for c in contacts
            if contact_feeds_surface(
                borehole_id=c.borehole_id,
                cpt_id=c.cpt_id,
                hidden_investigation_ids=hidden_ids,
                excluded_borehole_ids=excluded_bh_ids,
                section_member_ids=member_ids,
            )
        ]
        dropped = before - len(contacts)
        if dropped:
            # INFO, not DEBUG: this is the line that explains a surface that
            # ignores a pick the user can see on a test (the test is on no
            # section, or hidden, or excluded).
            self.info(
                f"recompute: dropped {dropped} of {before} contact(s) on tests that are "
                f"off-section / removed / excluded (model={model_id} "
                f"formation={formation_id}, {len(member_ids)} test(s) on a section)"
            )

        # Bulk-load the unique anchor ids referenced by these contacts.
        # Two queries because borehole_id and cpt_id are XOR-nullable;
        # one query each is simpler than a UNION.
        bh_ids: set[UUID] = {c.borehole_id for c in contacts if c.borehole_id is not None}
        cpt_ids: set[UUID] = {c.cpt_id for c in contacts if c.cpt_id is not None}
        # The outer ``if`` already skips the query for an empty id set, so the
        # query result is the only source of rows here.
        boreholes_by_id: dict[UUID, BoreholeOrm] = (
            {
                b.id: b
                for b in (
                    await self._session.execute(
                        select(BoreholeOrm).where(BoreholeOrm.id.in_(bh_ids))
                    )
                )
                .scalars()
                .all()
            }
            if bh_ids
            else {}
        )
        cpts_by_id: dict[UUID, CptOrm] = (
            {
                c.id: c
                for c in (await self._session.execute(select(CptOrm).where(CptOrm.id.in_(cpt_ids))))
                .scalars()
                .all()
            }
            if cpt_ids
            else {}
        )

        # Build ContactPoint3D for each contact whose anchor has a
        # complete (x, y, surface_elevation). Three anchor flavours:
        #
        # 1. Borehole anchor — look up the borehole row; skip if missing
        #    or if any of (location_x, location_y, elevation_m) is None.
        # 2. CPT anchor — same pattern.
        # 3. Synthetic anchor (borehole_id IS NULL, cpt_id IS NULL,
        #    synthetic_x IS NOT NULL) — the pinch-out extrapolation tool
        #    stores absolute (x, y, elevation_m) directly on the contact
        #    row; no investigation lookup needed.  The TIN uses these
        #    coordinates verbatim.
        #
        # Contacts that don't fit any branch (e.g. a corrupted row with
        # no anchor at all) are silently skipped — "render nothing" beats
        # a 500, consistent with the NaN-filter above.
        points: list[ContactPoint3D] = []
        for c in contacts:
            if c.borehole_id is None and c.cpt_id is None and c.synthetic_x is not None:
                # Synthetic anchor: coordinates are absolute, stored directly.
                if c.synthetic_y is None or c.synthetic_elevation_m is None:
                    self.debug(
                        f"recompute: synthetic contact {c.id} has partial synthetic "
                        "coordinates — skipping (all three must be non-null)"
                    )
                    continue
                points.append(
                    ContactPoint3D(
                        contact_id=str(c.id),
                        x_m=c.synthetic_x,
                        y_m=c.synthetic_y,
                        elevation_m=c.synthetic_elevation_m,
                    )
                )
                continue

            anchor: BoreholeOrm | CptOrm | None = None
            if c.borehole_id is not None:
                anchor = boreholes_by_id.get(c.borehole_id)
            elif c.cpt_id is not None:
                anchor = cpts_by_id.get(c.cpt_id)
            if anchor is None:
                continue
            if anchor.location_x is None or anchor.location_y is None or anchor.elevation_m is None:
                continue
            points.append(
                ContactPoint3D(
                    contact_id=str(c.id),
                    x_m=anchor.location_x,
                    y_m=anchor.location_y,
                    elevation_m=anchor.elevation_m - c.depth_top_m,
                )
            )

        # Fewer than three surviving points cannot triangulate: ``compute_tin``
        # returns an empty surface, which is upserted as an empty row (0
        # triangles) rather than deleted — the on-click-build contract keeps
        # the ``is_stale=False`` row so the section consumer knows the cache is
        # fresh (see test_geology.test_build_after_contact_create_materialises_surface).
        # After the hidden / excluded filter above, a formation that drops
        # below three contacts therefore rebuilds to an EMPTY, non-rendering
        # surface — which is what removes the removed test's TIN from view.
        new_checksum = checksum_contacts(points)
        existing = (
            await self._session.execute(
                select(FormationSurfaceOrm).where(
                    FormationSurfaceOrm.model_id == model_id,
                    FormationSurfaceOrm.formation_id == formation_id,
                )
            )
        ).scalar_one_or_none()

        if not force and existing is not None and existing.source_contact_checksum == new_checksum:
            # Geometry unchanged — but the row may still be stale if a
            # mutation flipped is_stale=True without a net change in
            # contacts (e.g. PATCH that round-trips to the same depth).
            # Clear the flag so the user's Build click does what they
            # expect: "the model is now fresh."
            if existing.is_stale:
                existing.is_stale = False
                await self._session.flush()
                self.debug(
                    f"recompute no-op (geometry) but cleared stale flag: "
                    f"model={model_id} formation={formation_id}"
                )
                return True
            self.debug(
                f"recompute no-op: model={model_id} formation={formation_id} checksum unchanged"
            )
            return False

        surface = compute_tin(points)
        # Cut the surface along its crossing line with the ground (owner ruling
        # 2026-09-06). No-op when no ground sampler is supplied (auto path) or
        # when the surface is entirely below ground (byte-identical), so the
        # only change is a dredged formation ending where it meets the ground.
        if ground_sampler is not None:
            surface = clip_tin_by_ground_surface(surface, ground_sampler)
        # Serialise to plain JSONB-friendly lists.
        vertices_payload = [list(v) for v in surface.vertices]
        triangles_payload = [list(t) for t in surface.triangles]

        # Upsert via Postgres ON CONFLICT on the (model, formation)
        # unique constraint — one round-trip whether the row exists
        # or not. PG-specific but we're already PG-only.
        # ``is_stale=False`` on every successful upsert — this is the
        # only path that clears the on-click-build staleness flag. The
        # mutation handlers flip True; only RecomputeFormationSurface
        # flips it back.
        stmt = pg_insert(FormationSurfaceOrm).values(
            id=uuid7() if existing is None else existing.id,
            model_id=model_id,
            formation_id=formation_id,
            method="tin",
            vertices=vertices_payload,
            triangles=triangles_payload,
            source_contact_count=len(points),
            source_contact_checksum=new_checksum,
            is_stale=False,
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_formation_surface_model_formation",
            set_=dict(
                method="tin",
                vertices=vertices_payload,
                triangles=triangles_payload,
                source_contact_count=len(points),
                source_contact_checksum=new_checksum,
                is_stale=False,
            ),
        )
        await self._session.execute(stmt)
        self.debug(
            f"recompute upsert: model={model_id} formation={formation_id} "
            f"vertices={len(vertices_payload)} triangles={len(triangles_payload)}"
        )
        return True

    async def execute_many(
        self,
        pairs: Iterable[tuple[UUID, UUID]],
        force: bool = False,
        *,
        hidden_investigation_ids: set[UUID] | None = None,
        section_member_ids: set[UUID] | None = None,
        ground_sampler: Callable[[float, float], float | None] | None = None,
    ) -> int:
        """Convenience: recompute multiple (model, formation) pairs.

        Returns the number of pairs that actually wrote (no-op
        recomputes don't count). Used by batch mutation use cases
        that affect several formations at once.

        Parameters
        ----------
        pairs : Iterable[tuple[UUID, UUID]]
            ``(model_id, formation_id)`` pairs to recompute.
        force : bool, default ``False``
            Forwarded to :meth:`execute` — when ``True`` every pair is
            re-triangulated regardless of the checksum (the manual
            Build path; see :meth:`execute`).
        hidden_investigation_ids : set[UUID] or None, keyword-only
            Forwarded to :meth:`execute` so every pair in one batch
            shares the same project-hidden lookup instead of each pair
            re-querying it.
        section_member_ids : set[UUID] or None, keyword-only
            Forwarded to :meth:`execute` so every pair in one batch shares
            the same on-a-section lookup (owner ruling 2026-09-23).
        ground_sampler : Callable[[float, float], float | None] or None, keyword-only
            Forwarded to :meth:`execute` so every formation in one Build is
            cut against the same ground surface (owner ruling 2026-09-06).
        """
        unique = list({(m, f) for m, f in pairs})
        wrote = 0
        for model_id, formation_id in unique:
            if await self.execute(
                model_id,
                formation_id,
                force=force,
                hidden_investigation_ids=hidden_investigation_ids,
                section_member_ids=section_member_ids,
                ground_sampler=ground_sampler,
            ):
                wrote += 1
        return wrote

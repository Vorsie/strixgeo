"""Auto-correlate contact-edges use case — #133 Phase 2+3.

Loads contacts + investigation locations + lithology context, calls the
pure-domain ``auto_correlate_contact_edges`` algorithm, and persists
net-new edges with ``user_approved=False``.  Does NOT call the resolver
or lens detection — auto edges are not approved, so they don't yet
participate in the user's correlation graph.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.auto_correlate_contact_edges import (
    AutoCorrelateContactParams,
    ContactRecord,
    InvestigationLocation,
    auto_correlate_contact_edges,
)
from groundmodel.domain.services.auto_correlate_contact_edges_constants import (
    AUTO_SOURCE,
)
from groundmodel.domain.services.detect_body_extents import (
    ContactEdge,
    ContactStack,
    ContactStackEntry,
)
from groundmodel.domain.services.detect_crossing_pinch_outs import (
    CrossingPinchOut,
    detect_crossing_pinch_outs,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.gis.section_projection import (
    SectionEndpoints,
    project_point_onto_line,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class AutoCorrelateContactResult:
    """Outcome counts for the auto-correlate batch.

    Attributes
    ----------
    edges_created : int
        Net-new rows inserted (ON CONFLICT DO NOTHING — did not already exist).
    edges_skipped_existing : int
        Candidates that were skipped because an edge already existed for that
        ``(model_id, contact_a_id, contact_b_id)`` triple.
    crossing_pinch_outs : list[CrossingPinchOut]
        Pinch-out lens candidates inferred from correlation crossings among the
        proposed candidates. The two edges of each crossing are DROPPED (not
        persisted) — a crossing is not a flat correlation — and surfaced here so
        the caller can render them as lens ghosts (auto-lens, drop + lens).
    edges_dropped_crossing : int
        Count of candidate edges withheld from persistence because they were
        part of a crossing.
    """

    edges_created: int
    edges_skipped_existing: int
    crossing_pinch_outs: list[CrossingPinchOut] = field(default_factory=list)
    edges_dropped_crossing: int = 0


class AutoCorrelateContactEdges(GroundModelLogger):
    """Run contact-level auto-correlate for a litho model.

    Idempotent: existing edges (any source, any approval state) are skipped
    via ``ON CONFLICT DO NOTHING``.  Auto edges insert with
    ``user_approved=False`` — the lens detector + resolver do NOT fire
    here; the Accept flow is the trigger.

    Parameters
    ----------
    session : AsyncSession
        An active SQLAlchemy async session.  The use case owns the commit
        boundary (single commit at the end).
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        params: AutoCorrelateContactParams | None = None,
        section_id: UUID | None = None,
    ) -> AutoCorrelateContactResult:
        """Run the use case.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.  The model must belong to this project;
            investigation locations are filtered to this project.
        model_id : UUID
            The lithostratigraphic model whose contacts are auto-correlated.
        params : AutoCorrelateContactParams | None
            Algorithm tunables.  ``None`` uses the defaults from the
            constants module (``MAX_COLUMN_DISTANCE_M``,
            ``BASE_DEPTH_THRESHOLD_M``, ``DISTANCE_FACTOR``).

        Returns
        -------
        AutoCorrelateContactResult
            ``edges_created`` (net-new rows) + ``edges_skipped_existing``
            (candidates already present in the DB).

        Raises
        ------
        ValueError
            When the model does not belong to ``project_id``.
        """
        self.info(f"AutoCorrelateContactEdges.execute: model={model_id} project={project_id}")

        # 1. Scope guard.
        await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Geological model"
        )

        # 2. Load all contacts with their formation's litho info.
        contacts_stmt = (
            select(
                FormationContactOrm.id,
                FormationContactOrm.formation_id,
                FormationContactOrm.cpt_id,
                FormationContactOrm.borehole_id,
                FormationContactOrm.depth_top_m,
                GeologicalFormationOrm.parent_formation_id,
                GeologicalFormationOrm.litho_main_soil_code,
            )
            .join(
                GeologicalFormationOrm,
                GeologicalFormationOrm.id == FormationContactOrm.formation_id,
            )
            .where(FormationContactOrm.model_id == model_id)
        )
        rows = (await self._session.execute(contacts_stmt)).all()
        self.debug(f"AutoCorrelateContactEdges: loaded {len(rows)} contact row(s)")

        # 3. Build contact stacks per investigation and derive litho_below_code.
        #    Each stack entry: (depth_top_m, contact_id, formation_id,
        #    parent_formation_id, litho_main_soil_code).
        stacks: dict[UUID, list[tuple[float, UUID, UUID, UUID | None, str]]] = {}
        for row in rows:
            inv_id = row.borehole_id if row.borehole_id is not None else row.cpt_id
            if inv_id is None:
                continue
            stacks.setdefault(inv_id, []).append(
                (
                    row.depth_top_m,
                    row.id,
                    row.formation_id,
                    row.parent_formation_id,
                    row.litho_main_soil_code or "",
                )
            )
        for s in stacks.values():
            s.sort()  # ascending depth

        contact_records: list[ContactRecord] = []
        for inv_id, entries in stacks.items():
            for i, (depth, cid, fid, parent, litho_above) in enumerate(entries):
                # litho_below_code is the main soil code of the unit directly
                # below this contact in the same investigation column.  None
                # for the deepest contact — depths are already sorted ascending
                # so i+1 is the next-deeper entry.
                litho_below = entries[i + 1][4] if i + 1 < len(entries) else None
                contact_records.append(
                    ContactRecord(
                        contact_id=cid,
                        formation_id=fid,
                        investigation_id=inv_id,
                        depth_top_m=depth,
                        parent_formation_id=parent,
                        litho_main_soil_code=litho_above,
                        litho_below_code=litho_below,
                    )
                )

        self.debug(
            f"AutoCorrelateContactEdges: built {len(contact_records)} ContactRecord(s) "
            f"across {len(stacks)} investigation(s)"
        )

        # 4. Load investigation locations — project-scoped so we pick up both
        #    CPTs and boreholes anchored to this project regardless of which
        #    models they appear in.
        cpt_locs = (
            await self._session.execute(
                select(CptOrm.id, CptOrm.location_x, CptOrm.location_y).where(
                    CptOrm.app_project_id == project_id,
                )
            )
        ).all()
        bh_locs = (
            await self._session.execute(
                select(BoreholeOrm.id, BoreholeOrm.location_x, BoreholeOrm.location_y).where(
                    BoreholeOrm.app_project_id == project_id,
                )
            )
        ).all()
        locations = [
            InvestigationLocation(investigation_id=r.id, x=r.location_x, y=r.location_y)
            for r in (*cpt_locs, *bh_locs)
        ]
        self.debug(
            f"AutoCorrelateContactEdges: {len(cpt_locs)} CPT + "
            f"{len(bh_locs)} borehole location(s) loaded"
        )

        # 5. Build the adjacency gate.  When a section is given, pair each
        #    in-corridor, contact-bearing investigation only with its immediate
        #    along-section neighbours (consecutive projected columns) so
        #    correlations follow the section's left-to-right order.  Map-plane
        #    RNG (the domain default) does NOT match the section's column order
        #    for off-line tests — a map-adjacent pair crosses an intervening
        #    column and renders as a spaghetti ribbon on the section
        #    (dogfeed 2026-05-29).  No section → adjacency=None → model-wide RNG.
        section_adjacency: set[frozenset[UUID]] | None = None
        if section_id is not None:
            section_adjacency = await self._section_along_adjacency(
                project_id=project_id,
                section_id=section_id,
                locations=locations,
                participant_ids={r.investigation_id for r in contact_records},
            )
            self.debug(
                f"AutoCorrelateContactEdges: section {section_id} → "
                f"{len(section_adjacency)} consecutive along-section pair(s)"
            )

        # 6. Run the pure-domain algorithm.
        candidates = auto_correlate_contact_edges(
            contact_records, locations, params, adjacency=section_adjacency
        )
        self.debug(f"AutoCorrelateContactEdges: {len(candidates)} candidate pair(s)")

        # 6b. Auto-lens (drop + lens): detect correlation crossings among the
        #     proposed candidates. A crossing's two edges are not flat
        #     correlations — DROP them from persistence and surface the pinch-out
        #     so the caller renders a lens ghost instead of a steep diagonal.
        body_stacks = [
            ContactStack(
                investigation_id=inv_id,
                entries=tuple(
                    ContactStackEntry(contact_id=cid, formation_id=fid, depth_top_m=depth)
                    for depth, cid, fid, _parent, _litho in entries
                ),
            )
            for inv_id, entries in stacks.items()
        ]
        candidate_edges = [
            ContactEdge(contact_a_id=c.contact_a_id, contact_b_id=c.contact_b_id)
            for c in candidates
        ]
        crossing_pinch_outs = detect_crossing_pinch_outs(candidate_edges, body_stacks)
        excluded_edges: set[frozenset[UUID]] = set()
        for po in crossing_pinch_outs:
            excluded_edges.update(po.crossing_edges)
        flat_candidates = [
            c
            for c in candidates
            if frozenset({c.contact_a_id, c.contact_b_id}) not in excluded_edges
        ]
        edges_dropped = len(candidates) - len(flat_candidates)
        if crossing_pinch_outs:
            self.debug(
                f"AutoCorrelateContactEdges: {len(crossing_pinch_outs)} crossing "
                f"pinch-out(s); dropped {edges_dropped} crossing edge(s) before insert"
            )

        # 7. Bulk-insert the FLAT candidates with ON CONFLICT DO NOTHING
        #    (Postgres-specific). Uses the named unique constraint so the
        #    conflict target is unambiguous even if the table grows more indexes.
        if not flat_candidates:
            await self._session.commit()
            self.success(
                "AutoCorrelateContactEdges: no flat candidates to insert "
                f"({len(crossing_pinch_outs)} crossing pinch-out(s))"
            )
            return AutoCorrelateContactResult(
                edges_created=0,
                edges_skipped_existing=0,
                crossing_pinch_outs=crossing_pinch_outs,
                edges_dropped_crossing=edges_dropped,
            )

        values = [
            {
                "id": uuid7(),
                "model_id": model_id,
                "contact_a_id": c.contact_a_id,
                "contact_b_id": c.contact_b_id,
                "source": AUTO_SOURCE,
                "user_approved": False,
            }
            for c in flat_candidates
        ]
        stmt = (
            insert(LithoContactCorrelationEdgeOrm)
            .values(values)
            .on_conflict_do_nothing(constraint="uq_litho_contact_corr_triple")
        )
        result = await self._session.execute(stmt)
        edges_created = result.rowcount or 0
        edges_skipped = len(values) - edges_created

        await self._session.commit()
        self.success(
            f"AutoCorrelateContactEdges: created={edges_created} "
            f"skipped_existing={edges_skipped} dropped_crossing={edges_dropped}"
        )
        return AutoCorrelateContactResult(
            edges_created=edges_created,
            edges_skipped_existing=edges_skipped,
            crossing_pinch_outs=crossing_pinch_outs,
            edges_dropped_crossing=edges_dropped,
        )

    async def _section_along_adjacency(
        self,
        *,
        project_id: UUID,
        section_id: UUID,
        locations: list[InvestigationLocation],
        participant_ids: set[UUID],
    ) -> set[frozenset[UUID]]:
        """Adjacency = consecutive contact-bearing columns along the section.

        Projects every contact-bearing, in-corridor (within the section's
        ``projection_buffer_m``, not explicitly excluded) investigation onto the
        section line, orders them by along-distance, and returns the set of
        immediate-neighbour pairs.  This is the section-editor's notion of
        "adjacent" — consecutive columns left-to-right — which the user expects
        correlations to follow, in contrast to the model-wide map-plane RNG.

        Parameters
        ----------
        project_id : UUID
            Owning project — the section must belong to it (scope guard).
        section_id : UUID
            The cross-section whose along-order defines adjacency.
        locations : list[InvestigationLocation]
            Planar (x, y) of every project investigation (CPTs + boreholes).
        participant_ids : set[UUID]
            Investigations that have at least one contact in the model — only
            these can correlate, so a contactless column never splits two
            contact-bearing neighbours apart.

        Returns
        -------
        set[frozenset[UUID]]
            Canonical unordered pairs of along-section-consecutive
            investigations.  Empty when fewer than two qualify.

        Raises
        ------
        ValueError
            When the section does not exist in ``project_id``.
        """
        section = (
            await self._session.execute(
                select(CrossSectionOrm).where(
                    CrossSectionOrm.id == section_id,
                    CrossSectionOrm.app_project_id == project_id,
                )
            )
        ).scalar_one_or_none()
        if section is None:
            raise ValueError(f"Section {section_id} not found in project {project_id}")

        endpoints = SectionEndpoints(
            start_x=section.start_x,
            start_y=section.start_y,
            end_x=section.end_x,
            end_y=section.end_y,
        )
        excluded = set(section.excluded_cpt_ids) | set(section.excluded_borehole_ids)

        on_section: list[tuple[float, UUID]] = []
        for loc in locations:
            iid = loc.investigation_id
            if iid not in participant_ids or iid in excluded:
                continue
            res = project_point_onto_line(endpoints, loc.x, loc.y)
            if res is None:
                continue
            if abs(res.offset) <= section.projection_buffer_m:
                on_section.append((res.along, iid))

        on_section.sort(key=lambda t: t[0])
        adjacency: set[frozenset[UUID]] = set()
        for i in range(len(on_section) - 1):
            adjacency.add(frozenset((on_section[i][1], on_section[i + 1][1])))
        return adjacency

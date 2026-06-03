"""Suggest-body-pinch-outs use case — ephemeral candidate pass.

Scans bodies in a model whose source pair has ZERO approved
correlations in some direction; emits one ``PinchOutCandidate`` per
adjacent neighbour in that direction. NO persistence side effects —
candidates are returned in-memory. The frontend renders them as ghost
wedges; click-to-commit fires ``ClaimBodyExtent`` to materialise the
claim.

Refreshed on every "Suggest pinch-outs" verb click.

Adjacent investigation definition
---------------------------------
When ``section_id`` is given (the frontend always passes the active
section), adjacency follows the section's ALONG-AXIS order: each source's
neighbours are the investigations immediately lower / higher in
along-distance on the section line — exactly the column order the user
sees. Without a section, the fallback is UUID ordering, which is unrelated
to the column layout and visibly "skips" intervening columns
(dogfeed 2026-06-01) — so callers should pass the section whenever one is
active.

Open ends are a section-EDGE concept
-------------------------------------
An ``open`` candidate is emitted ONLY when a source has no neighbour on a
side — i.e. it is the section's FIRST test (left side) or LAST test (right
side).  "First/last test" means the first/last in-corridor column the user
sees on the section, NOT the first/last litho participant: ALL in-corridor
non-excluded tests define the order (see ``_section_along_positions``),
including bare columns that carry no litho contacts yet.  A unit adjacent to
a not-yet-segmented column therefore pinches out TOWARD it rather than
opening against it as if it were the section edge (owner directive +
dogfeed 2026-06-03).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.classify_enclosed_lenses import (
    classify_enclosed_lenses,
)
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.gis.section_projection import (
    SectionEndpoints,
    project_point_onto_line,
)
from groundmodel.shared.constants.extent_kind import is_user_claimed_extent_kind
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class PinchOutCandidate:
    """One ephemeral suggestion — not persisted.

    Attributes
    ----------
    body_id : UUID | None
        The body of the FRAMED layer — resolved from
        ``litho_layer.body_id`` on the layer whose top is
        ``above_contact_id`` (post-A4 the contact id IS the layer id).
        Non-null for every accepted unit (the resolver stamps a body on
        each).  ``None`` only when the framed layer carries no body yet
        (e.g. a pending/unresolved layer); the ``ClaimBodyExtent`` use
        case targets the body directly by this id.
    source_investigation_id : UUID
        The investigation that carries the framing contacts
        (``above_contact_id`` + ``below_contact_id``).
    above_contact_id : UUID
        The shallower contact of the source pair; its ``formation_id``
        is the body's formation.
    below_contact_id : UUID | None
        The deeper contact of the source pair.  ``None`` for the
        deepest-formation open candidate — that unit has no base contact
        because it extends to the bottom of the hole.
    below_depth_m : float | None
        Investigation bottom depth (m below surface) for the
        deepest-formation open candidate, whose base is the bottom of the
        hole rather than a contact.  ``None`` for normal framed candidates
        (they use ``below_contact_id``).
    side : Literal["left", "right"]
        Direction of the suggested pinch-out relative to the source
        investigation in the section's along axis.  ``"left"`` = lower
        along-distance; ``"right"`` = higher (UUID rank in the no-section
        fallback).
    kind : Literal["pinch_out_halfway", "open"]
        The extent kind the candidate would claim. ``"pinch_out_halfway"``
        for an interior pinch-out toward ``suggested_neighbour_investigation_id``;
        ``"open"`` for an EDGE test that has no neighbour on ``side`` — we
        don't know what's beyond the furthest test, so it opens to the
        section boundary (only emitted when a section is given).
    suggested_neighbour_investigation_id : UUID | None
        The nearest adjacent investigation on ``side`` (the halfway target).
        ``None`` for an ``"open"`` edge candidate.
    """

    body_id: UUID | None
    source_investigation_id: UUID
    above_contact_id: UUID
    below_contact_id: UUID | None
    below_depth_m: float | None
    side: Literal["left", "right"]
    kind: Literal["pinch_out_halfway", "open"]
    suggested_neighbour_investigation_id: UUID | None


class SuggestBodyPinchOuts(GroundModelLogger):
    """Ephemeral candidate generator for body pinch-out suggestions.

    Iterates every depth-adjacent contact pair on every investigation
    that participates in the given model.  For each pair that behaves
    as a body source (two contacts sharing a formation_id boundary):

    * Left side: emit one candidate if there are ZERO approved
      correlation edges joining either contact to a lower-adjacent
      investigation, AND the existing body row (if any) has no
      user-claimed left extent.
    * Right side: same logic for the higher-adjacent direction.

    No DB writes are performed; every candidate is purely in-memory.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``.

        Parameters
        ----------
        session : AsyncSession
            Active database session (read-only in this use case).
        """
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        section_id: UUID | None = None,
    ) -> list[PinchOutCandidate]:
        """Generate pinch-out candidates for the given model.

        Parameters
        ----------
        project_id : UUID
            Project scope.  The model must belong to this project
            (raises ``ValueError`` otherwise).
        model_id : UUID
            The lithostratigraphic model to inspect.
        section_id : UUID | None
            When given, adjacency is the SECTION's along-axis order: each
            source is paired with its immediate along-section neighbours and
            "left"/"right" mean lower/higher along-distance on the section
            line.  This is what the user sees on screen — without it the
            v1 fallback uses UUID ordering, which is unrelated to the
            column layout and visibly "skips" intervening columns
            (dogfeed 2026-06-01).  Off-section investigations are excluded.

        Returns
        -------
        list[PinchOutCandidate]
            Zero or more candidates.  Empty when every source pair
            already has bilateral closure or when the model has fewer
            than two participant investigations.

        Raises
        ------
        ValueError
            When ``model_id`` does not exist or belongs to a different
            project.
        """
        self.info(f"SuggestBodyPinchOuts.execute: model={model_id} project={project_id}")

        await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Model"
        )

        # ------------------------------------------------------------------ #
        # 1. Load all contacts for this model.                                #
        # ------------------------------------------------------------------ #
        contacts_stmt = select(
            FormationContactOrm.id,
            FormationContactOrm.formation_id,
            FormationContactOrm.cpt_id,
            FormationContactOrm.borehole_id,
            FormationContactOrm.depth_top_m,
        ).where(FormationContactOrm.model_id == model_id)
        contact_rows = (await self._session.execute(contacts_stmt)).all()
        self.debug(f"SuggestBodyPinchOuts: {len(contact_rows)} contact row(s) loaded")

        # Build per-investigation stacks (depth-sorted tuples) and a
        # contact→investigation reverse map.
        stacks: dict[UUID, list[tuple[float, UUID, UUID]]] = {}
        # Maps contact_id → investigation_id (polymorphic).
        contact_inv: dict[UUID, UUID] = {}
        for r in contact_rows:
            inv_id: UUID | None = r.borehole_id if r.borehole_id is not None else r.cpt_id
            if inv_id is None:
                # Synthetic contacts have no anchor investigation — skip.
                continue
            stacks.setdefault(inv_id, []).append((r.depth_top_m, r.id, r.formation_id))
            contact_inv[r.id] = inv_id

        # Sort each stack ascending by depth.
        for entries in stacks.values():
            entries.sort()

        # ------------------------------------------------------------------ #
        # 1b. Load investigation bottom depths for participant investigations. #
        # Used to populate ``below_depth_m`` on deepest-formation open        #
        # candidates (the substrate extends to the bottom of the hole).       #
        # ``None`` when the depth is not recorded — the frontend falls back   #
        # to its plotBottom.                                                   #
        # ------------------------------------------------------------------ #
        bottom_depth_by_inv: dict[UUID, float | None] = {}
        cpt_depth_rows = (
            await self._session.execute(
                select(CptOrm.id, CptOrm.max_depth_m).where(CptOrm.app_project_id == project_id)
            )
        ).all()
        bh_depth_rows = (
            await self._session.execute(
                select(BoreholeOrm.id, BoreholeOrm.total_depth_m).where(
                    BoreholeOrm.app_project_id == project_id
                )
            )
        ).all()
        for r in cpt_depth_rows:
            bottom_depth_by_inv[r.id] = r.max_depth_m
        for r in bh_depth_rows:
            bottom_depth_by_inv[r.id] = r.total_depth_m

        # ------------------------------------------------------------------ #
        # 2. Load all user-approved edges.                                    #
        # ------------------------------------------------------------------ #
        edges_stmt = select(
            LithoContactCorrelationEdgeOrm.contact_a_id,
            LithoContactCorrelationEdgeOrm.contact_b_id,
        ).where(
            LithoContactCorrelationEdgeOrm.model_id == model_id,
            LithoContactCorrelationEdgeOrm.user_approved.is_(True),
        )
        edge_rows = (await self._session.execute(edges_stmt)).all()
        self.debug(f"SuggestBodyPinchOuts: {len(edge_rows)} approved edge(s) loaded")

        # For each contact, accumulate the set of neighbour-investigation
        # ids it has at least one approved edge to.
        contact_neighbour_invs: dict[UUID, set[UUID]] = {}
        for r in edge_rows:
            inv_a = contact_inv.get(r.contact_a_id)
            inv_b = contact_inv.get(r.contact_b_id)
            if inv_a is None or inv_b is None:
                # Edge references a synthetic / unanchored contact — skip.
                continue
            contact_neighbour_invs.setdefault(r.contact_a_id, set()).add(inv_b)
            contact_neighbour_invs.setdefault(r.contact_b_id, set()).add(inv_a)

        # ------------------------------------------------------------------ #
        # 3. Load existing body rows + the per-layer body backlink.           #
        # ------------------------------------------------------------------ #
        bodies_stmt = select(BodyOrm).where(BodyOrm.model_id == model_id)
        bodies = (await self._session.execute(bodies_stmt)).scalars().all()
        bodies_by_id: dict[UUID, BodyOrm] = {b.id: b for b in bodies}

        # Per-INSTANCE body identity: each accepted litho layer carries its
        # own ``body_id`` (stamped by ResolveLithoInstances per connected
        # component).  Post-A4 a litho layer's id IS its top formation_contact
        # id (the FC↔LL mirror preserves the UUID), so a framed candidate's
        # ``above_contact_id`` IS the framed layer's id.  We resolve the body
        # from THAT layer's ``body_id`` — keyed per instance, not per formation.
        # This is what fixes the over-suppression bug: two distinct same-formation
        # instances resolve to distinct bodies, so naming/claiming one no longer
        # suppresses the other's candidates (the old (formation, ordinal) key
        # collapsed both onto one body — dogfeed 2026-06-03).
        layer_body_rows = (
            await self._session.execute(
                select(LithoLayerOrm.id, LithoLayerOrm.body_id).where(
                    LithoLayerOrm.model_id == model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        ).all()
        body_id_by_layer: dict[UUID, UUID | None] = {r.id: r.body_id for r in layer_body_rows}

        # ------------------------------------------------------------------ #
        # 4. Build an ordering POSITION per investigation for adjacency.       #
        # With a section: along-distance on the section line (what the user    #
        # sees). Without: a UUID rank fallback (v1 — unrelated to the column   #
        # layout, which is the "skips a column" bug; section is preferred).    #
        # ------------------------------------------------------------------ #
        position: dict[UUID, float]
        if section_id is not None:
            position = await self._section_along_positions(
                project_id=project_id,
                section_id=section_id,
            )
        else:
            position = {iid: float(i) for i, iid in enumerate(sorted(stacks.keys()))}

        ordered: list[UUID] = sorted(position.keys(), key=lambda iid: position[iid])

        # ------------------------------------------------------------------ #
        # 5. Iterate source pairs and emit candidates.                        #
        # ------------------------------------------------------------------ #
        candidates: list[PinchOutCandidate] = []

        for inv_id, entries in stacks.items():
            # In section mode, a source that isn't on this section has no
            # along-position — skip it (its candidates wouldn't render anyway).
            if inv_id not in position:
                continue
            src_pos = position[inv_id]

            # Lens-aware suppression: a thin unit bracketed by the SAME
            # formation above and below (e.g. SAND·SILT·SAND, both sands one
            # formation row) is an enclosed lens — the bracketing formation is
            # one continuous host wrapping it.  The lens itself stays a normal
            # candidate (it is the real pinch-out); the host halves must NOT be
            # suggested as independent pinch-outs.  See spec
            # docs/superpowers/specs/2026-06-02-lens-aware-pinch-out-suggestions-design.md.
            host_half_units = classify_enclosed_lenses(
                [entry[2] for entry in entries]
            ).host_half_units

            for i in range(len(entries) - 1):
                if i in host_half_units:
                    # Interior to a continuous host wrapping a lens — the host
                    # is presumptively continuous here, not a pinch-out. Skip.
                    continue
                _, above_id, _above_formation = entries[i]
                _, below_id, _below_formation = entries[i + 1]

                # The framed unit is the layer whose TOP is ``above_id`` — and
                # post-A4 that layer's id IS ``above_id``.  Resolve the body
                # from that specific layer's ``body_id`` so suppression is
                # per-instance: a sibling same-formation instance has its own
                # distinct body and is reasoned about independently.
                body_id: UUID | None = body_id_by_layer.get(above_id)
                existing_body = bodies_by_id.get(body_id) if body_id is not None else None

                # A side is "paired" when both the above and below
                # contacts of this source pair share at least one approved
                # edge to the same neighbour investigation on that side.
                # "Same side" = lower along-position (left) or higher (right);
                # off-section paired neighbours are ignored (not in position).
                above_neighbours = contact_neighbour_invs.get(above_id, set())
                below_neighbours = contact_neighbour_invs.get(below_id, set())
                paired_neighbours = above_neighbours & below_neighbours

                left_paired = any(position[n] < src_pos for n in paired_neighbours if n in position)
                right_paired = any(
                    position[n] > src_pos for n in paired_neighbours if n in position
                )

                # A side is "claimed" only when the user has COMMITTED an extent
                # there (open / pinch_out_halfway / extrapolated).  A detector
                # ``to_target`` is just a guess — the user must be able to
                # override it with a suggestion, so it does NOT suppress the
                # candidate (dogfeed 2026-06-03: a detected sand lens blocked its
                # own open-end suggestions).
                left_claimed = existing_body is not None and is_user_claimed_extent_kind(
                    existing_body.extent_left_kind
                )
                right_claimed = existing_body is not None and is_user_claimed_extent_kind(
                    existing_body.extent_right_kind
                )

                # Left-side candidate: no approved bilateral pairing AND
                # no existing extent claim. "Left" = lower along-position.
                if not left_paired and not left_claimed:
                    left_neighbours = [n for n in ordered if position[n] < src_pos]
                    if left_neighbours:
                        # Interior: pinch out halfway to the nearest left neighbour.
                        candidates.append(
                            PinchOutCandidate(
                                body_id=body_id,
                                source_investigation_id=inv_id,
                                above_contact_id=above_id,
                                below_contact_id=below_id,
                                below_depth_m=None,
                                side="left",
                                kind="pinch_out_halfway",
                                suggested_neighbour_investigation_id=left_neighbours[-1],
                            )
                        )
                    elif section_id is not None:
                        # Section EDGE (leftmost test): nothing to the left, no
                        # data beyond — open the layer to the section boundary.
                        candidates.append(
                            PinchOutCandidate(
                                body_id=body_id,
                                source_investigation_id=inv_id,
                                above_contact_id=above_id,
                                below_contact_id=below_id,
                                below_depth_m=None,
                                side="left",
                                kind="open",
                                suggested_neighbour_investigation_id=None,
                            )
                        )

                # Right-side candidate: no approved bilateral pairing AND
                # no existing extent claim. "Right" = higher along-position.
                if not right_paired and not right_claimed:
                    right_neighbours = [n for n in ordered if position[n] > src_pos]
                    if right_neighbours:
                        # Interior: pinch out halfway to the nearest right neighbour.
                        candidates.append(
                            PinchOutCandidate(
                                body_id=body_id,
                                source_investigation_id=inv_id,
                                above_contact_id=above_id,
                                below_contact_id=below_id,
                                below_depth_m=None,
                                side="right",
                                kind="pinch_out_halfway",
                                suggested_neighbour_investigation_id=right_neighbours[0],
                            )
                        )
                    elif section_id is not None:
                        # Section EDGE (rightmost test): open to the boundary.
                        candidates.append(
                            PinchOutCandidate(
                                body_id=body_id,
                                source_investigation_id=inv_id,
                                above_contact_id=above_id,
                                below_contact_id=below_id,
                                below_depth_m=None,
                                side="right",
                                kind="open",
                                suggested_neighbour_investigation_id=None,
                            )
                        )

            # Deepest-formation open end (dogfeed 2026-06-02): the deepest
            # contact's formation has no base contact (it extends to the bottom
            # of the hole), so the framed-unit loop above never emits for it.
            # At a section EDGE (no neighbour on a side) emit an ``open``
            # candidate so the substrate shows it continues past the section.
            # No interior (halfway) candidate — a substrate does not pinch out
            # toward a neighbour. Only emitted when a section is given (open
            # candidates require section context, matching the framed-open branches).
            if section_id is not None and entries:
                _deepest_depth, deepest_contact_id, _deepest_formation = entries[-1]
                # Per-instance body: the deepest layer's id IS its top contact
                # id; resolve the body from THAT layer's body_id (see above).
                deepest_body_id: UUID | None = body_id_by_layer.get(deepest_contact_id)
                deepest_body = (
                    bodies_by_id.get(deepest_body_id) if deepest_body_id is not None else None
                )
                deepest_bottom = bottom_depth_by_inv.get(inv_id)
                left_neighbours_d = [n for n in ordered if position[n] < src_pos]
                right_neighbours_d = [n for n in ordered if position[n] > src_pos]
                left_claimed_d = deepest_body is not None and is_user_claimed_extent_kind(
                    deepest_body.extent_left_kind
                )
                right_claimed_d = deepest_body is not None and is_user_claimed_extent_kind(
                    deepest_body.extent_right_kind
                )
                # Left edge: no neighbour to the left and not already claimed.
                if not left_neighbours_d and not left_claimed_d:
                    candidates.append(
                        PinchOutCandidate(
                            body_id=deepest_body_id,
                            source_investigation_id=inv_id,
                            above_contact_id=deepest_contact_id,
                            below_contact_id=None,
                            below_depth_m=deepest_bottom,
                            side="left",
                            kind="open",
                            suggested_neighbour_investigation_id=None,
                        )
                    )
                # Right edge: no neighbour to the right and not already claimed.
                if not right_neighbours_d and not right_claimed_d:
                    candidates.append(
                        PinchOutCandidate(
                            body_id=deepest_body_id,
                            source_investigation_id=inv_id,
                            above_contact_id=deepest_contact_id,
                            below_contact_id=None,
                            below_depth_m=deepest_bottom,
                            side="right",
                            kind="open",
                            suggested_neighbour_investigation_id=None,
                        )
                    )

        # Breakdown so a "missing suggestion" report is diagnosable from the log
        # alone: section vs UUID adjacency, how many investigations projected,
        # and open (edge) vs pinch (interior) split.  ``open=0`` with
        # ``section=NONE`` means the active section never reached this pass (open
        # candidates require section context); ``open=0`` with ``section=yes``
        # points at a suppression/logic bug instead.
        n_open = sum(1 for c in candidates if c.kind == "open")
        n_pinch = sum(1 for c in candidates if c.kind == "pinch_out_halfway")
        self.info(
            f"SuggestBodyPinchOuts: {len(candidates)} candidate(s) for model={model_id} "
            f"(section={'yes' if section_id else 'NONE'}, "
            f"{len(position)} investigation(s) placed, {n_open} open + {n_pinch} pinch)"
        )
        return candidates

    async def _section_along_positions(
        self,
        *,
        project_id: UUID,
        section_id: UUID,
    ) -> dict[UUID, float]:
        """Project every in-corridor section TEST onto the section line.

        Mirrors ``AutoCorrelateContactEdges._section_along_adjacency`` but
        returns the per-investigation along-distance (not just consecutive
        pairs), since the pinch-out pass needs left/right comparison and
        nearest-neighbour lookup, not only immediate adjacency.

        Every in-corridor, non-excluded investigation in the project is
        projected — NOT only the model's litho participants.  An ``open`` end
        is a section-EDGE concept ("left of the first test / right of the last
        test of the section" — owner directive 2026-06-03), so the edge test
        must be over the columns the user actually sees on the section, not
        over the subset that already carries litho contacts.  Restricting the
        order to participants made the last *participant* (rather than the last
        *test*) open out, so a unit adjacent to a not-yet-segmented column
        opened against it instead of pinching toward it (dogfeed 2026-06-03).
        A bare column (no litho contacts yet) still has an along-position here,
        so the adjacent participant correctly pinches toward it.

        Parameters
        ----------
        project_id : UUID
            Owning project — the section must belong to it (scope guard).
        section_id : UUID
            The cross-section whose along-axis defines order.

        Returns
        -------
        dict[UUID, float]
            ``{investigation_id: along_distance}`` for every in-corridor,
            non-excluded investigation projected onto the section line. Omits
            off-section / excluded / unprojectable investigations.

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

        along: dict[UUID, float] = {}
        for r in (*cpt_locs, *bh_locs):
            # Every in-corridor, non-excluded test counts — bare columns (no
            # litho contacts yet) included, so the section-edge test for
            # ``open`` is over the columns the user sees, not only litho
            # participants (dogfeed 2026-06-03).
            if r.id in excluded:
                continue
            res = project_point_onto_line(endpoints, r.location_x, r.location_y)
            if res is None:
                continue
            if abs(res.offset) <= section.projection_buffer_m:
                along[r.id] = res.along
        return along

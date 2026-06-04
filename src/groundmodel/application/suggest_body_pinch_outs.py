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

from groundmodel.application.project_investigations_onto_section import (
    project_investigations_onto_section,
)
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
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
        The deeper contact bounding the unit.  ``None`` only for the bottom
        substrate (the deepest unit), which has no base contact because it
        extends to the bottom of the hole — interior open/pinch candidates
        carry a real base contact.
    below_depth_m : float | None
        Investigation bottom depth (m below surface) for a bottom-substrate
        candidate, whose base is the bottom of the hole rather than a contact.
        ``None`` for interior candidates (they use ``below_contact_id``).
    side : Literal["left", "right"]
        Direction of the suggested pinch-out relative to the source
        investigation in the section's along axis.  ``"left"`` = lower
        along-distance; ``"right"`` = higher (UUID rank in the no-section
        fallback).
    kind : Literal["pinch_out_halfway", "open"]
        The extent kind the candidate would claim. ``"pinch_out_halfway"``
        for an interior unit whose lithology does not continue, tapering toward
        ``suggested_neighbour_investigation_id``; ``"open"`` at the section's
        first/last column (no neighbour) or for the bottom substrate wherever
        it does not continue (only emitted when a section is given).
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
    """Ephemeral candidate generator for body pinch-out suggestions (R1).

    Iterates every unit on every investigation that participates in the
    model and classifies each lateral side by **lithology continuity**
    (R1, owner directive 2026-06-03):

    * **BAND** (no candidate) — the unit's lithology continues across to the
      nearest neighbour on that side: its top contact has an approved edge to
      a SAME-soil contact there, and that neighbour is deep enough to carry the
      unit.  A correlation to a DIFFERENT-soil contact (a boundary tie where
      the lithology changes) does NOT make it a band.
    * **OPEN** — there is no neighbour on that side (the section's first/last
      column), OR the unit is the bottom substrate (deepest unit, no base
      contact) wherever it does not continue.  The substrate never pinches.
    * **PINCH** — an interior unit whose lithology does not continue to an
      EXISTING neighbour (different lithology, no correlation, or the neighbour
      is too shallow to carry it).

    A user-claimed extent (open / pinch_out_halfway / extrapolated) on a side
    settles it — no candidate is re-suggested there.  ``open`` candidates need
    section context, so they are only emitted when a section is given.

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

        # Lithology (main soil code) per formation — the R1 rule (owner directive
        # 2026-06-03) decides band-vs-pinch on whether the unit's LITHOLOGY
        # continues across a correlation, not merely whether the contacts
        # correlate.  So we need each contact's soil code, resolved via its
        # formation.
        soil_rows = (
            await self._session.execute(
                select(
                    GeologicalFormationOrm.id,
                    GeologicalFormationOrm.litho_main_soil_code,
                ).where(GeologicalFormationOrm.app_project_id == project_id)
            )
        ).all()
        soil_by_formation: dict[UUID, str | None] = {
            r.id: r.litho_main_soil_code for r in soil_rows
        }

        # Build per-investigation stacks (depth-sorted tuples) and a
        # contact→investigation reverse map.
        stacks: dict[UUID, list[tuple[float, UUID, UUID]]] = {}
        # Maps contact_id → investigation_id (polymorphic).
        contact_inv: dict[UUID, UUID] = {}
        # Maps contact_id → the soil code of the unit that STARTS at this contact.
        soil_by_contact: dict[UUID, str | None] = {}
        for r in contact_rows:
            inv_id: UUID | None = r.borehole_id if r.borehole_id is not None else r.cpt_id
            if inv_id is None:
                # Synthetic contacts have no anchor investigation — skip.
                continue
            stacks.setdefault(inv_id, []).append((r.depth_top_m, r.id, r.formation_id))
            contact_inv[r.id] = inv_id
            soil_by_contact[r.id] = soil_by_formation.get(r.formation_id)

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

        # For each contact, the set of contacts it is correlated to (both
        # directions).  R1 checks not just THAT a contact correlates to a
        # neighbour but whether the correlated contact carries the SAME
        # lithology — so we keep the contact ids (not just their investigations)
        # to look up the target soil.
        contact_corr: dict[UUID, set[UUID]] = {}
        for r in edge_rows:
            if contact_inv.get(r.contact_a_id) is None or contact_inv.get(r.contact_b_id) is None:
                # Edge references a synthetic / unanchored contact — skip.
                continue
            contact_corr.setdefault(r.contact_a_id, set()).add(r.contact_b_id)
            contact_corr.setdefault(r.contact_b_id, set()).add(r.contact_a_id)

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
        # 5. Iterate every unit on every source and classify each side via R1. #
        #                                                                      #
        # R1 (owner directive 2026-06-03): the band-vs-pinch-vs-open decision  #
        # is driven by LITHOLOGY CONTINUITY, not bare contact correlation:     #
        #                                                                      #
        #   * BAND  (no candidate) — the unit's lithology continues across to  #
        #     the nearest neighbour: the unit's top contact has an approved    #
        #     edge to a SAME-soil contact there, and that neighbour reaches    #
        #     this depth.                                                      #
        #   * OPEN  — no neighbour on that side (the section's first/last       #
        #     column), OR the bottom substrate (deepest unit, no base contact) #
        #     wherever it does not continue.  The substrate never pinches; it  #
        #     opens.                                                           #
        #   * PINCH — an interior unit whose lithology does not continue to an #
        #     EXISTING neighbour (different lithology, no correlation, or the   #
        #     neighbour is too shallow to carry it).                           #
        #                                                                      #
        # Open candidates require section context (the frontend renders them   #
        # against the section), so they are only emitted when a section is     #
        # given — matching the previous behaviour.                            #
        # ------------------------------------------------------------------ #
        candidates: list[PinchOutCandidate] = []

        for inv_id, entries in stacks.items():
            # In section mode, a source that isn't on this section has no
            # along-position — skip it (its candidates wouldn't render anyway).
            if inv_id not in position:
                continue
            src_pos = position[inv_id]

            # Nearest neighbour on each side, in along-section order.
            left_neighbours = [n for n in ordered if position[n] < src_pos]
            right_neighbours = [n for n in ordered if position[n] > src_pos]
            nearest: dict[str, UUID | None] = {
                "left": left_neighbours[-1] if left_neighbours else None,
                "right": right_neighbours[0] if right_neighbours else None,
            }

            n_units = len(entries)
            for i in range(n_units):
                top_depth, top_id, _top_formation = entries[i]
                is_deepest = i == n_units - 1
                below_id: UUID | None = entries[i + 1][1] if not is_deepest else None
                unit_soil = soil_by_contact.get(top_id)

                # Per-INSTANCE body identity: post-A4 the litho layer's id IS
                # its top contact id, so resolve the body from THAT layer's
                # ``body_id``.  Used only to honour user-claimed extents (a
                # committed claim settles the side — do not re-suggest).
                body_id = body_id_by_layer.get(top_id)
                existing_body = bodies_by_id.get(body_id) if body_id is not None else None

                for side in ("left", "right"):
                    neighbour = nearest[side]

                    # A user-claimed extent (open / pinch_out_halfway /
                    # extrapolated) settles the side — skip.  A detector
                    # ``to_target`` is just a guess and does NOT suppress.
                    extent_kind = (
                        (
                            existing_body.extent_left_kind
                            if side == "left"
                            else existing_body.extent_right_kind
                        )
                        if existing_body is not None
                        else None
                    )
                    if existing_body is not None and is_user_claimed_extent_kind(extent_kind):
                        continue

                    # R1: does the lithology continue across to the neighbour?
                    continues = False
                    if neighbour is not None and unit_soil is not None:
                        nbr_bottom = bottom_depth_by_inv.get(neighbour)
                        reaches = nbr_bottom is None or nbr_bottom >= top_depth
                        if reaches:
                            continues = any(
                                contact_inv.get(c) == neighbour
                                and soil_by_contact.get(c) == unit_soil
                                for c in contact_corr.get(top_id, set())
                            )
                    if continues:
                        continue  # BAND — no suggestion

                    if is_deepest:
                        # Substrate opens where it does not continue (never pinches).
                        if section_id is None:
                            continue
                        candidates.append(
                            PinchOutCandidate(
                                body_id=body_id,
                                source_investigation_id=inv_id,
                                above_contact_id=top_id,
                                below_contact_id=None,
                                below_depth_m=bottom_depth_by_inv.get(inv_id),
                                side=side,
                                kind="open",
                                suggested_neighbour_investigation_id=None,
                            )
                        )
                    elif neighbour is None:
                        # Interior unit at the section's first/last column → open.
                        if section_id is None:
                            continue
                        candidates.append(
                            PinchOutCandidate(
                                body_id=body_id,
                                source_investigation_id=inv_id,
                                above_contact_id=top_id,
                                below_contact_id=below_id,
                                below_depth_m=None,
                                side=side,
                                kind="open",
                                suggested_neighbour_investigation_id=None,
                            )
                        )
                    else:
                        # Interior unit whose lithology does not continue → pinch.
                        candidates.append(
                            PinchOutCandidate(
                                body_id=body_id,
                                source_investigation_id=inv_id,
                                above_contact_id=top_id,
                                below_contact_id=below_id,
                                below_depth_m=None,
                                side=side,
                                kind="pinch_out_halfway",
                                suggested_neighbour_investigation_id=neighbour,
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
        # Every in-corridor, non-excluded test counts — bare columns (no litho
        # contacts yet) included (``restrict_to=None``), so the section-edge
        # test for ``open`` is over the columns the user sees, not only litho
        # participants (dogfeed 2026-06-03).
        return await project_investigations_onto_section(
            self._session, project_id=project_id, section_id=section_id
        )

"""Suggest-body-pinch-outs use case — ephemeral candidate pass.

Scans bodies in a model whose source pair has ZERO approved
correlations in some direction; emits one ``PinchOutCandidate`` per
adjacent neighbour in that direction. NO persistence side effects —
candidates are returned in-memory. The frontend renders them as ghost
wedges; click-to-commit fires ``ClaimBodyExtent`` to materialise the
claim.

Refreshed on every "Suggest pinch-outs" verb click.

Adjacent investigation definition (v1)
---------------------------------------
Without a section reference (no ``prefer_section_id``), adjacency is
determined by UUID ordering among the model's participant investigations.
The nearest lower-UUID investigation is the "left" neighbour; the
nearest higher-UUID is the "right" neighbour.  This is a
section-agnostic fallback; slice 7 (frontend) can refine by passing a
``prefer_section_id`` so the backend resolves along-axis order instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class PinchOutCandidate:
    """One ephemeral suggestion — not persisted.

    Attributes
    ----------
    body_id : UUID | None
        The existing ``BodyOrm.id`` when a body row already exists for
        this (model, formation) host pair.  ``None`` when no body row
        exists yet (the ``ClaimBodyExtent`` use case will create one on
        commit).
    source_investigation_id : UUID
        The investigation that carries the framing contacts
        (``above_contact_id`` + ``below_contact_id``).
    above_contact_id : UUID
        The shallower contact of the source pair; its ``formation_id``
        is the body's formation.
    below_contact_id : UUID
        The deeper contact of the source pair.
    side : Literal["left", "right"]
        Direction of the suggested pinch-out relative to the source
        investigation in the section's along axis.  ``"left"`` = lower-
        UUID side; ``"right"`` = higher-UUID side (v1 fallback ordering).
    suggested_neighbour_investigation_id : UUID
        The nearest adjacent investigation on ``side``.  The frontend
        pre-fills this as the default target when the user clicks to
        commit via ``ClaimBodyExtent``.
    """

    body_id: UUID | None
    source_investigation_id: UUID
    above_contact_id: UUID
    below_contact_id: UUID
    side: Literal["left", "right"]
    suggested_neighbour_investigation_id: UUID


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
    ) -> list[PinchOutCandidate]:
        """Generate pinch-out candidates for the given model.

        Parameters
        ----------
        project_id : UUID
            Project scope.  The model must belong to this project
            (raises ``ValueError`` otherwise).
        model_id : UUID
            The lithostratigraphic model to inspect.

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
        # 3. Load existing body rows for this model.                          #
        # ------------------------------------------------------------------ #
        bodies_stmt = select(BodyOrm).where(BodyOrm.model_id == model_id)
        bodies = (await self._session.execute(bodies_stmt)).scalars().all()

        # Key: (source_investigation_id, formation_id) → BodyOrm.
        # Used to check whether a body row already exists for a source pair
        # and whether a user-claimed extent already covers a side.  When
        # multiple bodies share the same (inv, formation) — possible with
        # ordinals > 0 — we take the first match; this is acceptable for v1
        # because the suggest pass is best-effort.
        bodies_by_inv_formation: dict[tuple[UUID, UUID], BodyOrm] = {}
        for b in bodies:
            key = (b.source_investigation_id, b.formation_id)
            if key not in bodies_by_inv_formation:
                bodies_by_inv_formation[key] = b

        # ------------------------------------------------------------------ #
        # 4. Sort all participating investigations for adjacency queries.     #
        # UUID ordering is the v1 fallback when no section context is given;  #
        # deterministic and cheap.                                             #
        # ------------------------------------------------------------------ #
        all_invs: list[UUID] = sorted(stacks.keys())

        # ------------------------------------------------------------------ #
        # 5. Iterate source pairs and emit candidates.                        #
        # ------------------------------------------------------------------ #
        candidates: list[PinchOutCandidate] = []

        for inv_id, entries in stacks.items():
            for i in range(len(entries) - 1):
                _, above_id, above_formation = entries[i]
                _, below_id, _below_formation = entries[i + 1]

                # Convention: the body's formation is the formation whose
                # top is at the above contact (above_formation).
                body_formation = above_formation
                existing_body = bodies_by_inv_formation.get((inv_id, body_formation))
                body_id: UUID | None = existing_body.id if existing_body is not None else None

                # A side is "paired" when both the above and below
                # contacts of this source pair share at least one approved
                # edge to the same neighbour investigation on that side.
                # "Same side" = lower UUID (left) or higher UUID (right).
                above_neighbours = contact_neighbour_invs.get(above_id, set())
                below_neighbours = contact_neighbour_invs.get(below_id, set())
                paired_neighbours = above_neighbours & below_neighbours

                left_paired = any(n < inv_id for n in paired_neighbours)
                right_paired = any(n > inv_id for n in paired_neighbours)

                # A side is "claimed" when the existing body row already
                # carries a non-NULL extent kind on that side (any kind —
                # including to_target from the detector).  The suggestion
                # pass skips already-settled sides.
                left_claimed = (
                    existing_body is not None and existing_body.extent_left_kind is not None
                )
                right_claimed = (
                    existing_body is not None and existing_body.extent_right_kind is not None
                )

                # Left-side candidate: no approved bilateral pairing AND
                # no existing extent claim.
                if not left_paired and not left_claimed:
                    left_neighbours = [n for n in all_invs if n < inv_id]
                    if left_neighbours:
                        # Nearest lower-UUID neighbour.
                        suggested = left_neighbours[-1]
                        candidates.append(
                            PinchOutCandidate(
                                body_id=body_id,
                                source_investigation_id=inv_id,
                                above_contact_id=above_id,
                                below_contact_id=below_id,
                                side="left",
                                suggested_neighbour_investigation_id=suggested,
                            )
                        )

                # Right-side candidate: no approved bilateral pairing AND
                # no existing extent claim.
                if not right_paired and not right_claimed:
                    right_neighbours = [n for n in all_invs if n > inv_id]
                    if right_neighbours:
                        # Nearest higher-UUID neighbour.
                        suggested = right_neighbours[0]
                        candidates.append(
                            PinchOutCandidate(
                                body_id=body_id,
                                source_investigation_id=inv_id,
                                above_contact_id=above_id,
                                below_contact_id=below_id,
                                side="right",
                                suggested_neighbour_investigation_id=suggested,
                            )
                        )

        self.info(f"SuggestBodyPinchOuts: {len(candidates)} candidate(s) for model={model_id}")
        return candidates

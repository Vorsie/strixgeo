"""Correlate-litho-contacts use case — #133 Phase 1.

Records that two ``formation_contact`` rows belong to the same stratigraphic
boundary across investigation columns.  This is the contact-level (boundary-
to-boundary) correlation model that replaces the formation-level model in the
long run — see debt #133 for the phased migration plan.

The use case is intentionally lightweight: it does NOT run the ordinal
resolver or the absence inference engine (those operate on the formation-level
graph and are not affected by contact-level edges in Phase 1).  Phase 2 of
#133 will add auto-correlate at the contact level and lens detection.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class ContactCorrelateResult:
    """Output of ``CorrelateLithoContacts.execute``.

    Attributes
    ----------
    edge : LithoContactCorrelationEdgeOrm
        The canonical edge row (freshly inserted or pre-existing).
    was_created : bool
        ``True`` when a new row was inserted; ``False`` when the edge
        already existed (idempotent re-call).
    """

    edge: LithoContactCorrelationEdgeOrm
    was_created: bool


class CorrelateLithoContacts(GroundModelLogger):
    """Create (or confirm) a contact-level correlation edge (#133 Phase 1).

    Connects two ``formation_contact`` rows in the same lithostratigraphic
    model, recording that they represent the same stratigraphic boundary at
    different investigation columns.  The use case is idempotent: calling
    with the same pair returns the existing edge with ``was_created=False``.

    Unlike the formation-level ``CorrelateLithoUnits``, this use case does
    NOT re-run the ordinal resolver or the absence inference engine.  Those
    systems operate on the formation-level graph; contact-level edges only
    drive lens detection, which ships in Phase 2 of #133.
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
        contact_a_id: UUID,
        contact_b_id: UUID,
        source: str = "manual",
        request_section_id: UUID | None = None,
    ) -> ContactCorrelateResult:
        """Insert a contact-level edge and return the result.

        Parameters
        ----------
        project_id : UUID
            The owning project.  Used to scope-guard the model and contacts
            (IDOR defence — contacts from another project are rejected 404).
        model_id : UUID
            The lithostratigraphic model.  Both contacts must belong to it.
        contact_a_id : UUID
            One endpoint.  Order does not matter — the use case normalises
            to ``(min, max)`` before INSERT.
        contact_b_id : UUID
            The other endpoint.
        source : str
            Provenance token.  Defaults to ``'manual'``.
        request_section_id : UUID | None
            The section on which this correlation is authored (required —
            section-scoped, owner directive 2026-06-08).  Passing ``None``
            raises ``ValueError``; the router maps that to HTTP 422.

        Returns
        -------
        ContactCorrelateResult
            The edge row and a ``was_created`` flag.

        Raises
        ------
        ValueError
            When ``request_section_id`` is ``None`` (section-scoped invariant),
            when either contact does not belong to ``model_id`` / ``project_id``,
            when both contacts share the same id (self-loop), or when the
            contacts are anchored to the same investigation column (a boundary
            cannot be correlated with itself at the same column).
        """
        self.info(
            f"CorrelateLithoContacts: model={model_id} "
            f"a={contact_a_id} b={contact_b_id} source={source!r}"
        )

        # ------------------------------------------------------------------ #
        # 0. Section-scoped guard (owner directive 2026-06-08).               #
        #    Every correlation is authored on a section — the section drives  #
        #    rendering and the section-scoped unique constraint.  A None here #
        #    would produce a NOT-NULL IntegrityError downstream; surface it   #
        #    as a clear ValueError so the router maps it to HTTP 422.         #
        # ------------------------------------------------------------------ #
        if request_section_id is None:
            raise ValueError(
                "CorrelateLithoContacts requires request_section_id — a "
                "correlation is always authored on a section (section-scoped, "
                "owner directive 2026-06-08)."
            )

        # ------------------------------------------------------------------ #
        # 1. Self-loop guard.                                                  #
        # ------------------------------------------------------------------ #
        if contact_a_id == contact_b_id:
            raise ValueError(f"Cannot correlate a contact with itself: {contact_a_id}")

        # ------------------------------------------------------------------ #
        # 2. Validate the model belongs to this project.                       #
        # ------------------------------------------------------------------ #
        await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Model"
        )

        # ------------------------------------------------------------------ #
        # 3. Validate both contacts belong to this model + project.            #
        # ------------------------------------------------------------------ #
        ca = await self._session.get(FormationContactOrm, contact_a_id)
        cb = await self._session.get(FormationContactOrm, contact_b_id)

        for label, contact in (("contact_a", ca), ("contact_b", cb)):
            cid = contact_a_id if label == "contact_a" else contact_b_id
            if contact is None or contact.model_id != model_id:
                raise ValueError(f"{label} {cid} not found in model {model_id}")

        assert ca is not None and cb is not None  # narrowed above

        # ------------------------------------------------------------------ #
        # 4. Same-investigation guard: correlating two contacts on the same    #
        #    investigation column is meaningless and would confuse Phase 2     #
        #    lens detection.  Check by comparing the anchor investigation ids. #
        # ------------------------------------------------------------------ #
        def _anchor_id(c: FormationContactOrm) -> UUID | None:
            return c.borehole_id if c.borehole_id is not None else c.cpt_id

        if _anchor_id(ca) == _anchor_id(cb) and _anchor_id(ca) is not None:
            raise ValueError(
                f"contact_a and contact_b are anchored to the same investigation "
                f"({_anchor_id(ca)}) — cannot correlate a boundary with itself"
            )

        # ------------------------------------------------------------------ #
        # A cross-lithology edge is allowed — it is a SURFACE TIE (the         #
        # boundary is one continuous surface even where the material differs,  #
        # e.g. a sand top tied to a clay top across a facies change). The      #
        # resolver still DROPS cross-lithology edges from body formation       #
        # (resolve_litho_instances), so a tie never creates a mixed body; the  #
        # renderer draws it as a line, not a body ribbon. There is therefore   #
        # no same-lithology guard at creation (thread B, 2026-06-07).          #
        # ------------------------------------------------------------------ #

        # ------------------------------------------------------------------ #
        # 5. Canonical ordering: (min, max).                                   #
        # ------------------------------------------------------------------ #
        a_id = min(contact_a_id, contact_b_id)
        b_id = max(contact_a_id, contact_b_id)

        # ------------------------------------------------------------------ #
        # 6. Idempotent upsert — check for an existing edge.                  #
        # ------------------------------------------------------------------ #
        existing_stmt = select(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.model_id == model_id,
            LithoContactCorrelationEdgeOrm.section_id == request_section_id,
            LithoContactCorrelationEdgeOrm.contact_a_id == a_id,
            LithoContactCorrelationEdgeOrm.contact_b_id == b_id,
        )
        existing = (await self._session.execute(existing_stmt)).scalar_one_or_none()
        if existing is not None:
            self.info(
                f"CorrelateLithoContacts: edge already exists ({existing.id}) — idempotent return"
            )
            return ContactCorrelateResult(edge=existing, was_created=False)

        # ------------------------------------------------------------------ #
        # 7. Insert the new edge, run resolver + lens detection, then commit.  #
        # ------------------------------------------------------------------ #
        # Manual gestures are implicitly user-approved — set the flag
        # explicitly so auto-proposed edges (user_approved=False) stay
        # invisible to the lens detector even if the server_default changes.
        edge = LithoContactCorrelationEdgeOrm(
            id=uuid7(),
            model_id=model_id,
            section_id=request_section_id,
            contact_a_id=a_id,
            contact_b_id=b_id,
            source=source,
            user_approved=True,
        )
        self._session.add(edge)
        await self._session.flush()
        self.debug(f"CorrelateLithoContacts: edge inserted {edge.id}")

        # Approved-edge mutations still re-run the resolver so instance
        # ordinals stay coherent in the same transaction.  Lens detection
        # is NO LONGER fired here (owner directive 2026-05-31): a single
        # manual correlate that incidentally closed a #135 topology was
        # silently spawning a LithoLensOrm row, which violated the
        # "no side-effects beyond the gesture" invariant.  Detection now
        # runs only on the explicit ``POST .../lenses/detect`` verb.
        await ResolveLithoInstances(self._session).execute(
            model_id=model_id,
            commit=False,  # caller owns the transaction boundary
        )

        await self._session.commit()
        await self._session.refresh(edge)
        self.success(
            f"CorrelateLithoContacts: committed contact-edge {edge.id}; "
            f"contact_a={a_id} contact_b={b_id} source={source!r}"
        )
        return ContactCorrelateResult(edge=edge, was_created=True)


class UncorrelateLithoContacts(GroundModelLogger):
    """Delete a contact-level correlation edge (#133 Phase 1).

    Idempotent: if the edge does not exist, this is a no-op (no error).
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
        contact_a_id: UUID,
        contact_b_id: UUID,
        request_section_id: UUID | None = None,
    ) -> None:
        """Delete the contact-level edge between two contacts.

        Parameters
        ----------
        project_id : UUID
            The owning project.  Used to scope-guard the model.
        model_id : UUID
            The lithostratigraphic model.
        contact_a_id : UUID
            One endpoint (order does not matter — canonical ordering applied).
        contact_b_id : UUID
            The other endpoint.
        request_section_id : UUID | None
            Retained for API symmetry; no longer consumed.  Lens detection
            now runs only on the explicit ``POST .../lenses/detect`` verb
            (owner directive 2026-05-31).

        Returns
        -------
        None
            Always.  No-op when the edge does not exist.

        Raises
        ------
        ValueError
            When the model does not belong to ``project_id``.
        """
        self.info(f"UncorrelateLithoContacts: model={model_id} a={contact_a_id} b={contact_b_id}")

        # Scope guard — mirrors the create path.
        await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Model"
        )

        # Canonical ordering.
        a_id = min(contact_a_id, contact_b_id)
        b_id = max(contact_a_id, contact_b_id)

        stmt = select(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.model_id == model_id,
            LithoContactCorrelationEdgeOrm.contact_a_id == a_id,
            LithoContactCorrelationEdgeOrm.contact_b_id == b_id,
        )
        existing = (await self._session.execute(stmt)).scalar_one_or_none()
        if existing is None:
            # Topology is unchanged — resolver is not needed.
            self.debug(
                f"UncorrelateLithoContacts: edge not found — no-op "
                f"(contact_a={a_id} contact_b={b_id})"
            )
            await self._session.commit()
            return

        await self._session.delete(existing)
        await self._session.flush()
        self.debug(f"UncorrelateLithoContacts: edge {existing.id} deleted from session")

        # Topology changed — re-run the resolver so instance ordinals stay
        # coherent.  Lens detection is NO LONGER fired here (owner directive
        # 2026-05-31); stale LithoLensOrm rows are reconciled only when the
        # user clicks "Detect lenses" (``POST .../lenses/detect``).
        await ResolveLithoInstances(self._session).execute(
            model_id=model_id,
            commit=False,  # caller owns the transaction boundary
        )

        await self._session.commit()
        self.success(
            f"UncorrelateLithoContacts: deleted edge {existing.id} "
            f"(contact_a={a_id} contact_b={b_id})"
        )

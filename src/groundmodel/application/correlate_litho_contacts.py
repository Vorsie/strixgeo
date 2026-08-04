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

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.litho_body_guard import shares_litho_body
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.constants.model_kind import MODEL_KIND_GEOTECHNICAL
from groundmodel.shared.exceptions import CrossLithoBodyCorrelationError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Containment tolerance for matching a geotech band's depth range to the
# parent litho layer that it subdivides.  The geotech band depths come from
# the same arithmetic pipeline (divide_picks_by_geology + A3 segmenter), so
# a tight numeric guard is sufficient.
_DEPTH_CONTAINMENT_EPS_M: float = 1e-3


def canonical_contact_order(
    layer_a_id: UUID,
    layer_a_side: str,
    layer_b_id: UUID,
    layer_b_side: str,
) -> tuple[UUID, str, UUID, str]:
    """Canonicalise an edge endpoint pair to ``a_id < b_id``, sides paired.

    A contact-correlation edge is undirected, so it is stored with the two
    endpoints in a fixed ``(min, max)`` order to make the pair unique
    regardless of call order.  With the bottom-tie ``contact_side``
    discriminator (spec 2026-06-17), each endpoint also carries a side
    (``'top'`` / ``'base'``).  When the two ids are swapped to reach canonical
    order, each side MUST travel WITH its own contact id — otherwise a swapped
    base↔base edge would silently mix the sides.

    Parameters
    ----------
    layer_a_id : UUID
        One endpoint's contact (layer) id.
    layer_a_side : str
        That endpoint's side (``'top'`` or ``'base'``).
    layer_b_id : UUID
        The other endpoint's contact id.
    layer_b_side : str
        That endpoint's side.

    Returns
    -------
    tuple[UUID, str, UUID, str]
        ``(a_id, a_side, b_id, b_side)`` with ``a_id < b_id`` and each side
        still paired with its original contact id.  A base↔base pair is a
        bottom-tie; the pairing is preserved through the swap.
    """
    if layer_a_id <= layer_b_id:
        return layer_a_id, layer_a_side, layer_b_id, layer_b_side
    return layer_b_id, layer_b_side, layer_a_id, layer_a_side


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
        layer_a_id: UUID,
        layer_b_id: UUID,
        source: str = "manual",
        request_section_id: UUID | None = None,
        layer_a_side: str = "top",
        layer_b_side: str = "top",
    ) -> ContactCorrelateResult:
        """Insert a contact-level edge and return the result.

        Parameters
        ----------
        project_id : UUID
            The owning project.  Used to scope-guard the model and contacts
            (IDOR defence — contacts from another project are rejected 404).
        model_id : UUID
            The lithostratigraphic model.  Both contacts must belong to it.
        layer_a_id : UUID
            One endpoint.  Order does not matter — the use case normalises
            to ``(min, max)`` before INSERT.
        layer_b_id : UUID
            The other endpoint.
        source : str
            Provenance token.  Defaults to ``'manual'``.
        request_section_id : UUID | None
            The section on which this correlation is authored (required —
            section-scoped, owner directive 2026-06-08).  Passing ``None``
            raises ``ValueError``; the router maps that to HTTP 422.
        layer_a_side : str
            Which contact of ``contact_a`` the edge joins — ``'top'`` (the
            legacy default for every existing edge) or ``'base'``.  Travels
            with ``layer_a_id`` through canonical ordering.
        layer_b_side : str
            The same for ``contact_b``.  An edge with ``'base'`` on BOTH ends
            is a **bottom-tie** — it correlates the deepest layer's base (which
            has no layer below, hence no top-keyed base contact) so that the
            deepest unit can band (bottom-tie spec 2026-06-17).

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
            f"a={layer_a_id}({layer_a_side}) b={layer_b_id}({layer_b_side}) "
            f"source={source!r}"
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
        if layer_a_id == layer_b_id:
            raise ValueError(f"Cannot correlate a contact with itself: {layer_a_id}")

        # ------------------------------------------------------------------ #
        # 2. Validate the model belongs to this project.                       #
        # ------------------------------------------------------------------ #
        model = await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Model"
        )

        # ------------------------------------------------------------------ #
        # 3. Validate both contacts belong to this model + project.            #
        # ------------------------------------------------------------------ #
        ca = await self._session.get(FormationContactOrm, layer_a_id)
        cb = await self._session.get(FormationContactOrm, layer_b_id)

        for label, contact in (("contact_a", ca), ("contact_b", cb)):
            cid = layer_a_id if label == "contact_a" else layer_b_id
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
        # 4b. Geotech-only litho-body guard.                                   #
        #     A NAD packing class is always a subdivision of ONE               #
        #     lithostratigraphic body; a manual packing correlation must       #
        #     never cross a body boundary (two separate sand bodies must not   #
        #     merge into one packing body by this gesture).                    #
        #                                                                      #
        #     Applies only to kind='geotechnical' models; litho and            #
        #     geological paths are unchanged.                                  #
        # ------------------------------------------------------------------ #
        if model.kind == MODEL_KIND_GEOTECHNICAL:
            litho_bodies_of = await self._resolve_litho_bodies_for_geotech(
                geotech_model=model,
                contact_ids=[ca.id, cb.id],
            )
            if not shares_litho_body(
                litho_bodies_of,
                str(ca.id),
                str(cb.id),
            ):
                band_a = await self._describe_geotech_band(ca.id)
                band_b = await self._describe_geotech_band(cb.id)
                self.warning(
                    f"CorrelateLithoContacts: cross-litho-body geotech correlation blocked — "
                    f"contact_a={ca.id} ({band_a}) bodies={sorted(litho_bodies_of.get(str(ca.id), set()))!r} "
                    f"contact_b={cb.id} ({band_b}) bodies={sorted(litho_bodies_of.get(str(cb.id), set()))!r}"
                )
                raise CrossLithoBodyCorrelationError(band_a=band_a, band_b=band_b)

        # ------------------------------------------------------------------ #
        # 5. Canonical ordering: (min, max), sides paired with their ids.      #
        # ------------------------------------------------------------------ #
        a_id, a_side, b_id, b_side = canonical_contact_order(
            layer_a_id, layer_a_side, layer_b_id, layer_b_side
        )

        # ------------------------------------------------------------------ #
        # 6. Idempotent upsert — check for an existing edge.                  #
        #    The side columns are part of the widened unique key, so a top-tie #
        #    and a base-tie between the SAME pair on the SAME section coexist.  #
        #    Filtering on side here keeps the lookup at exactly one row —      #
        #    without it ``.scalar_one_or_none()`` would raise                  #
        #    ``MultipleResultsFound`` once both ties exist (bottom-tie spec).  #
        # ------------------------------------------------------------------ #
        existing_stmt = select(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.model_id == model_id,
            LithoContactCorrelationEdgeOrm.section_id == request_section_id,
            LithoContactCorrelationEdgeOrm.layer_a_id == a_id,
            LithoContactCorrelationEdgeOrm.layer_b_id == b_id,
            LithoContactCorrelationEdgeOrm.layer_a_side == a_side,
            LithoContactCorrelationEdgeOrm.layer_b_side == b_side,
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
            layer_a_id=a_id,
            layer_b_id=b_id,
            layer_a_side=a_side,
            layer_b_side=b_side,
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
        # silently spawning a BodyOrm row, which violated the
        # "no side-effects beyond the gesture" invariant.  Body rows are
        # reconciled by the startup / bundle-restore body sweep.
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

    # ---------------------------------------------------------------------- #
    # Private helpers                                                          #
    # ---------------------------------------------------------------------- #

    async def _resolve_litho_bodies_for_geotech(
        self,
        *,
        geotech_model: GeologicalModelOrm,
        contact_ids: list[UUID],
    ) -> dict[str, set[str]]:
        """Build a ``{contact_id_str: {litho_body_id_str, ...}}`` map.

        A contact is a SURFACE (owner ruling 2026-08-04): it touches the band
        whose top it is (the band BELOW - same UUID via the LL->FC trigger,
        SAB-8) and the band directly ABOVE it (the geotech layer on the same
        investigation whose base sits at this contact's depth).  Each band's
        parent litho body is the accepted litho layer that CONTAINS it on the
        same investigation; the set carries every body that resolved.

        Conservative: a band that cannot be resolved contributes nothing, and
        an empty set makes :func:`shares_litho_body` block the correlation.

        Parameters
        ----------
        geotech_model : GeologicalModelOrm
            The geotechnical model whose ``parent_model_id``
            points to the lithostratigraphic model.
        contact_ids : list[UUID]
            Geotech contact (= litho_layer) ids to resolve.

        Returns
        -------
        dict[str, set[str]]
            Keys are string representations of each contact id; values are the
            litho body ids of the adjacent bands (possibly empty).
        """
        litho_model_id = geotech_model.parent_model_id
        result: dict[str, set[str]] = {}

        for contact_id in contact_ids:
            key = str(contact_id)
            result[key] = set()

            if litho_model_id is None:
                # Geotechnical model has no litho parent - block conservatively.
                self.debug(
                    f"_resolve_litho_bodies_for_geotech: "
                    f"geotech model {geotech_model.id} has no parent litho model"
                )
                continue

            # The geotech LithoLayerOrm has the same UUID as the FormationContactOrm
            # (SAB-8 invariant: the LL->FC trigger writes matching ids).
            below = await self._session.get(LithoLayerOrm, contact_id)
            if below is None:
                self.debug(
                    f"_resolve_litho_bodies_for_geotech: "
                    f"no LithoLayerOrm found for geotech contact {contact_id}"
                )
                continue

            # The band ABOVE the surface: same investigation, same geotech
            # model, base at this contact's depth (mm slack for the divide
            # arithmetic).
            if below.cpt_id is not None:
                above_inv_filter = LithoLayerOrm.cpt_id == below.cpt_id
            elif below.borehole_id is not None:
                above_inv_filter = LithoLayerOrm.borehole_id == below.borehole_id
            else:
                self.warning(
                    f"_resolve_litho_bodies_for_geotech: "
                    f"geotech layer {contact_id} has no cpt_id or borehole_id"
                )
                continue
            above = (
                (
                    await self._session.execute(
                        select(LithoLayerOrm)
                        .where(
                            and_(
                                LithoLayerOrm.model_id == below.model_id,
                                above_inv_filter,
                                LithoLayerOrm.depth_base_m
                                >= below.depth_top_m - _DEPTH_CONTAINMENT_EPS_M,
                                LithoLayerOrm.depth_base_m
                                <= below.depth_top_m + _DEPTH_CONTAINMENT_EPS_M,
                            )
                        )
                        .limit(1)
                    )
                )
                .scalars()
                .first()
            )

            for band in (below, above):
                if band is None:
                    continue
                body = await self._containing_litho_body(
                    litho_model_id=litho_model_id, band=band
                )
                if body is not None:
                    result[key].add(body)
            self.debug(
                f"_resolve_litho_bodies_for_geotech: geotech contact {contact_id} "
                f"-> adjacent litho bodies {sorted(result[key])!r}"
            )

        return result

    async def _containing_litho_body(
        self,
        *,
        litho_model_id: UUID,
        band: LithoLayerOrm,
    ) -> str | None:
        """Return the litho body id of the accepted litho layer containing *band*.

        Parameters
        ----------
        litho_model_id : UUID
            The parent lithostratigraphic model.
        band : LithoLayerOrm
            A geotech band (litho_layer row on the geotech model).

        Returns
        -------
        str | None
            The containing accepted litho layer's ``body_id``, or ``None``
            when no containing layer exists or its body is not yet stamped.
        """
        if band.cpt_id is not None:
            inv_filter = LithoLayerOrm.cpt_id == band.cpt_id
        elif band.borehole_id is not None:
            inv_filter = LithoLayerOrm.borehole_id == band.borehole_id
        else:
            return None
        stmt = (
            select(LithoLayerOrm)
            .where(
                and_(
                    LithoLayerOrm.model_id == litho_model_id,
                    LithoLayerOrm.status == "accepted",
                    inv_filter,
                    LithoLayerOrm.depth_top_m <= band.depth_top_m + _DEPTH_CONTAINMENT_EPS_M,
                    LithoLayerOrm.depth_base_m >= band.depth_base_m - _DEPTH_CONTAINMENT_EPS_M,
                )
            )
            # At most one accepted litho layer can contain a geotech band on
            # this anchor (the ``litho_layer_accepted_no_overlap`` exclusion
            # constraint). The ``order_by`` keeps the pick deterministic if
            # that constraint is ever relaxed or bypassed by a migration.
            .order_by(LithoLayerOrm.depth_top_m)
            .limit(1)
        )
        litho_layer = (await self._session.execute(stmt)).scalars().first()
        if litho_layer is None or litho_layer.body_id is None:
            return None
        return str(litho_layer.body_id)

    async def _describe_geotech_band(self, contact_id: UUID) -> str:
        """Name a geotech band for the refusal toast: formation @ investigation.

        Parameters
        ----------
        contact_id : UUID
            The geotech contact (= band) id.

        Returns
        -------
        str
            e.g. ``"KLEI (NAD 23) on GEO-22/115-S10"`` - or the bare id when
            the band cannot be resolved.
        """
        band = await self._session.get(LithoLayerOrm, contact_id)
        if band is None:
            return str(contact_id)
        formation = await self._session.get(GeologicalFormationOrm, band.formation_id)
        fname = formation.name if formation is not None else "?"
        inv_name: str | None = None
        if band.cpt_id is not None:
            cpt = await self._session.get(CptOrm, band.cpt_id)
            inv_name = cpt.name if cpt is not None else None
        elif band.borehole_id is not None:
            bh = await self._session.get(BoreholeOrm, band.borehole_id)
            inv_name = bh.name if bh is not None else None
        return f"{fname} on {inv_name}" if inv_name else fname


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
        layer_a_id: UUID,
        layer_b_id: UUID,
        request_section_id: UUID | None = None,
        layer_a_side: str = "top",
        layer_b_side: str = "top",
    ) -> None:
        """Delete the contact-level edge between two contacts.

        Parameters
        ----------
        project_id : UUID
            The owning project.  Used to scope-guard the model.
        model_id : UUID
            The lithostratigraphic model.
        layer_a_id : UUID
            One endpoint (order does not matter — canonical ordering applied).
        layer_b_id : UUID
            The other endpoint.
        request_section_id : UUID | None
            The section the edge was authored on.  Required — a correlation is
            always authored on a section (section-scoped invariant, owner
            directive 2026-06-08).  The delete is scoped to this section
            because the same contact pair may exist as edges on multiple
            sections (each section's edge is an independent row).  Passing
            ``None`` raises ``ValueError``; the router maps that to HTTP 422.
        layer_a_side : str
            Which contact of ``contact_a`` the edge to delete joins —
            ``'top'`` (default) or ``'base'``.  Travels with ``layer_a_id``
            through canonical ordering and scopes the delete: a top-tie and a
            base-tie (bottom-tie) on the same pair are distinct rows.
        layer_b_side : str
            The same for ``contact_b``.

        Returns
        -------
        None
            Always.  No-op when the edge does not exist.

        Raises
        ------
        ValueError
            When ``request_section_id`` is ``None`` (section-scoped invariant)
            or when the model does not belong to ``project_id``.
        """
        self.info(
            f"UncorrelateLithoContacts: model={model_id} "
            f"a={layer_a_id}({layer_a_side}) b={layer_b_id}({layer_b_side})"
        )

        # ------------------------------------------------------------------ #
        # 0. Section-scoped guard (owner directive 2026-06-08).               #
        #    Every correlation is authored on a section — the section drives  #
        #    rendering and the section-scoped unique constraint.  Without this #
        #    guard, querying (model_id, a_id, b_id) could match two rows      #
        #    (same pair on two sections) → MultipleResultsFound (500).        #
        # ------------------------------------------------------------------ #
        if request_section_id is None:
            raise ValueError(
                "UncorrelateLithoContacts requires request_section_id — a "
                "correlation is always authored on a section (section-scoped, "
                "owner directive 2026-06-08)."
            )

        # Scope guard — mirrors the create path.
        await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Model"
        )

        # Canonical ordering, sides paired with their ids.
        a_id, a_side, b_id, b_side = canonical_contact_order(
            layer_a_id, layer_a_side, layer_b_id, layer_b_side
        )

        # Side columns are part of the widened unique key — filter on them so a
        # top-tie and a base-tie on the same pair stay distinct, and so the
        # lookup matches at most one row (``.scalar_one_or_none()`` would raise
        # ``MultipleResultsFound`` once both ties coexist). Bottom-tie spec.
        stmt = select(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.model_id == model_id,
            LithoContactCorrelationEdgeOrm.section_id == request_section_id,
            LithoContactCorrelationEdgeOrm.layer_a_id == a_id,
            LithoContactCorrelationEdgeOrm.layer_b_id == b_id,
            LithoContactCorrelationEdgeOrm.layer_a_side == a_side,
            LithoContactCorrelationEdgeOrm.layer_b_side == b_side,
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
        # coherent.  Body detection is NO LONGER fired here (owner directive
        # 2026-05-31); stale BodyOrm rows are reconciled by the startup /
        # bundle-restore body sweep.
        await ResolveLithoInstances(self._session).execute(
            model_id=model_id,
            commit=False,  # caller owns the transaction boundary
        )

        await self._session.commit()
        self.success(
            f"UncorrelateLithoContacts: deleted edge {existing.id} "
            f"(contact_a={a_id} contact_b={b_id})"
        )

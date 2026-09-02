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

from groundmodel.application.body_partition_lock import lock_body_partition
from groundmodel.application.geotech_tie_tombstones import record_tie_tombstone
from groundmodel.application.litho_frame_conformance_resolver import (
    band_frame_warning,
    containing_litho_layer,
    describe_geotech_band,
)
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.geotech_edge_crossing_guard import (
    GapTie,
    crossing_partners,
    gap_key,
)
from groundmodel.domain.services.litho_body_guard import shares_litho_body
from groundmodel.domain.services.litho_frame_conformance import FRAME_MISMATCH_REVIEW_REASON
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.constants.model_kind import MODEL_KIND_GEOTECHNICAL
from groundmodel.shared.exceptions import (
    CrossingCorrelationError,
    CrossLithoBodyCorrelationError,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Containment tolerance for matching a geotech band's depth range to the
# parent litho layer that it subdivides.  The geotech band depths come from
# the same arithmetic pipeline (the litho picks + A3 segmenter), so
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
    frame_warning : str | None
        Draw-time warning when a geotech packing tie does not conform to
        the litho frame (owner order 2026-08-21: *"next time flag a tie
        like that when it doesn't conform to the litho model!"*).  The tie
        is still written — see ``litho_frame_conformance``.
    """

    edge: LithoContactCorrelationEdgeOrm
    was_created: bool
    frame_warning: str | None = None


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
                    f"contact_a={ca.id} ({band_a}) "
                    f"bodies={sorted(litho_bodies_of.get(str(ca.id), set()))!r} "
                    f"contact_b={cb.id} ({band_b}) "
                    f"bodies={sorted(litho_bodies_of.get(str(cb.id), set()))!r}"
                )
                raise CrossLithoBodyCorrelationError(band_a=band_a, band_b=band_b)

            # -------------------------------------------------------------- #
            # 4c. Geotech-only crossing guard.                                 #
            #     Owner ruling 2026-08-17: "ties shouldn't be able to cross    #
            #     ... when someone tries to draw a crossing tie, send a toast  #
            #     and reject the tie". A crossing is a hard conflict — the     #
            #     renderer suspends BOTH ties and neither side bands — so a    #
            #     crossing that lands silently kills the fill on that gap.     #
            # -------------------------------------------------------------- #
            crossed = await self._crossing_tie_description(
                model_id=model_id,
                section_id=request_section_id,
                a_id=ca.id,
                a_side=layer_a_side,
                b_id=cb.id,
                b_side=layer_b_side,
            )
            if crossed is not None:
                self.warning(
                    f"CorrelateLithoContacts: crossing packing correlation blocked — "
                    f"candidate {ca.id}({layer_a_side}) ↔ {cb.id}({layer_b_side}) "
                    f"crosses {crossed}"
                )
                raise CrossingCorrelationError(crossed)

        # ------------------------------------------------------------------ #
        # 4d. Geotech-only frame-conformance FLAG (owner order 2026-08-21:     #
        #     "next time flag a tie like that when it doesn't conform to the  #
        #     litho model!"). Never refuses — the tie may be a legitimate     #
        #     surface statement — but the engineer is told at draw time that  #
        #     the litho frame will not band the two bands, instead of         #
        #     discovering an "onlap that should band" on the canvas. Flagged  #
        #     edges are born with a review badge (``review_reason``).         #
        # ------------------------------------------------------------------ #
        frame_warning: str | None = None
        if model.kind == MODEL_KIND_GEOTECHNICAL:
            frame_warning = await self._frame_conformance_warning(
                geotech_model=model, a_id=ca.id, b_id=cb.id
            )
            if frame_warning is not None:
                self.warning(f"CorrelateLithoContacts: frame mismatch — {frame_warning}")

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
            return ContactCorrelateResult(
                edge=existing, was_created=False, frame_warning=frame_warning
            )

        # ------------------------------------------------------------------ #
        # 7. Insert the new edge, run resolver + lens detection, then commit.  #
        # ------------------------------------------------------------------ #
        # Take the partition lock HERE, before the INSERT — not down in
        # ``ResolveLithoInstances``, which takes it too late to protect this
        # transaction's own edge write. Unguarded, that write races the
        # debounced background ``bodies/recompute`` for the same model, which
        # re-stamps ``litho_layer.body_id`` over the same rows in a different
        # order (owner dogfeed 2026-08-23: DeadlockDetectedError). The lock is
        # re-entrant per session, so the resolver's later take stays free.
        await lock_body_partition(
            self._session, model_id=model_id, operation="correlate-litho-contacts"
        )
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
            # A frame-mismatched tie is born flagged — the violet review badge
            # keeps the draw-time warning visible until the engineer confirms
            # or deletes it (owner order 2026-08-21).
            review_reason=FRAME_MISMATCH_REVIEW_REASON if frame_warning is not None else None,
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
        return ContactCorrelateResult(edge=edge, was_created=True, frame_warning=frame_warning)

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

        A body that WRAPS the band below the contact (an enclosed lens, owner
        ruling 2026-08-12) is withdrawn from that contact's set — see
        :meth:`_enclosing_body_of`.  The withdrawal never touches the body the
        band below sits in ITSELF (owner dogfeed 2026-08-15): that licence is
        held in the band's own right, not borrowed from a neighbour.

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

            # An enclosed unit's WRAPPER may not license this contact (owner
            # ruling 2026-08-12 late evening): the wrapper exists on both
            # sides of a lens boundary, so a tie licensed by it would bisect
            # the very body that licensed it. The unit's OWN body always
            # stays — same-body ties are the legitimate case.
            #
            # ``tied_own`` is the body of the unit containing the band this
            # contact belongs to (``below`` — the contact IS that band's top,
            # SAB-8). That body is held in the band's OWN right and is NEVER
            # withdrawn (owner dogfeed 2026-08-15): when the neighbour above
            # is a lens enclosed by exactly that body, the neighbour's wrapper
            # IS ``tied_own``, and subtracting it cancelled a sand↔sand tie
            # running inside one big sand body — *"it is one big geometrically
            # connected body only with a clay and silt lens in it"*. The
            # 2026-08-12 rule keeps biting where it was aimed: there the TIED
            # band is the enclosed lens, so its wrapper is a borrowed licence
            # and still goes.
            excluded: set[str] = set()
            tied_own: set[str] = set()
            for band in (below, above):
                if band is None:
                    continue
                unit = await self._containing_litho_layer(litho_model_id=litho_model_id, band=band)
                if unit is None or unit.body_id is None:
                    continue
                result[key].add(str(unit.body_id))
                if band is below:
                    tied_own.add(str(unit.body_id))
                wrapper = await self._enclosing_body_of(litho_model_id=litho_model_id, unit=unit)
                if wrapper is not None:
                    excluded.add(wrapper)
            if excluded & tied_own:
                # INFO, not DEBUG: this is the line that decides between a
                # refusal and an allow on a lens-adjacent contact, so it has to
                # be readable in a dogfeed log without re-running at DEBUG.
                self.info(
                    f"_resolve_litho_bodies_for_geotech: contact {contact_id} — "
                    f"wrapper bodies {sorted(excluded & tied_own)!r} KEPT: the tied "
                    "band's own unit sits in them (own-right rule)"
                )
            excluded -= tied_own
            if excluded & result[key]:
                self.debug(
                    f"_resolve_litho_bodies_for_geotech: contact {contact_id} — "
                    f"wrapper bodies {sorted(excluded & result[key])!r} excluded "
                    "(enclosed-lens rule)"
                )
            result[key] -= excluded
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
        litho_layer = await self._containing_litho_layer(litho_model_id=litho_model_id, band=band)
        if litho_layer is None or litho_layer.body_id is None:
            return None
        return str(litho_layer.body_id)

    async def _containing_litho_layer(
        self,
        *,
        litho_model_id: UUID,
        band: LithoLayerOrm,
    ) -> LithoLayerOrm | None:
        """Return the accepted litho layer containing *band*, or ``None``.

        Thin delegation to
        :func:`groundmodel.application.litho_frame_conformance_resolver.containing_litho_layer`
        — the shared resolver the machine tie path also uses.

        Parameters
        ----------
        litho_model_id : UUID
            The parent lithostratigraphic model.
        band : LithoLayerOrm
            A geotech band (litho_layer row on the geotech model).

        Returns
        -------
        LithoLayerOrm | None
            The containing accepted litho layer row.
        """
        return await containing_litho_layer(self._session, litho_model_id=litho_model_id, band=band)

    async def _frame_conformance_warning(
        self,
        *,
        geotech_model: GeologicalModelOrm,
        a_id: UUID,
        b_id: UUID,
    ) -> str | None:
        """Draw-time warning when a packing tie exceeds the litho frame, or ``None``.

        Thin delegation to
        :func:`groundmodel.application.litho_frame_conformance_resolver.band_frame_warning`
        — the shared resolver the machine tie path
        (:class:`~groundmodel.application.auto_correlate_geotech_edges.AutoCorrelateGeotechEdges`)
        also runs, so both paths flag the identical tie with the identical
        message (owner order 2026-08-21). ``None`` when the geotech model has no
        litho parent.

        Parameters
        ----------
        geotech_model : GeologicalModelOrm
            The geotechnical model (its ``parent_model_id`` is the frame).
        a_id, b_id : UUID
            The two geotech contact (= band) ids being tied.

        Returns
        -------
        str | None
            The warning sentence, or ``None`` when the tie conforms.
        """
        litho_model_id = geotech_model.parent_model_id
        if litho_model_id is None:
            return None
        return await band_frame_warning(
            self._session,
            litho_model_id=litho_model_id,
            band_a_id=a_id,
            band_b_id=b_id,
        )

    async def _enclosing_body_of(
        self,
        *,
        litho_model_id: UUID,
        unit: LithoLayerOrm,
    ) -> str | None:
        """The body wrapping *unit* above AND below, or ``None``.

        Owner ruling 2026-08-12 (late evening): a unit whose litho-stack
        neighbours share one body is an ENCLOSED LENS in that body — its
        boundaries are the lens's, not a through-going horizon of the
        wrapper. Tying "the wrapper's surface" at a lens boundary would
        bisect the wrapper (*"adding this correlation would mean we would
        split the clay body in 2"*), so the wrapper may not license a tie at
        this unit's contacts.

        Parameters
        ----------
        litho_model_id : UUID
            The parent lithostratigraphic model.
        unit : LithoLayerOrm
            The accepted litho layer whose neighbourhood is inspected.

        Returns
        -------
        str | None
            The wrapping body id when the stack neighbours above and below
            both exist and share one non-null body that differs from the
            unit's own; ``None`` otherwise.
        """
        if unit.cpt_id is not None:
            inv_filter = LithoLayerOrm.cpt_id == unit.cpt_id
        elif unit.borehole_id is not None:
            inv_filter = LithoLayerOrm.borehole_id == unit.borehole_id
        else:
            return None

        async def _neighbour(above: bool) -> LithoLayerOrm | None:
            anchor = unit.depth_top_m if above else unit.depth_base_m
            column = LithoLayerOrm.depth_base_m if above else LithoLayerOrm.depth_top_m
            stmt = (
                select(LithoLayerOrm)
                .where(
                    and_(
                        LithoLayerOrm.model_id == litho_model_id,
                        LithoLayerOrm.status == "accepted",
                        inv_filter,
                        column >= anchor - _DEPTH_CONTAINMENT_EPS_M,
                        column <= anchor + _DEPTH_CONTAINMENT_EPS_M,
                        LithoLayerOrm.id != unit.id,
                    )
                )
                .limit(1)
            )
            return (await self._session.execute(stmt)).scalars().first()

        above_unit = await _neighbour(above=True)
        below_unit = await _neighbour(above=False)
        if above_unit is None or below_unit is None:
            return None
        if above_unit.body_id is None or above_unit.body_id != below_unit.body_id:
            return None
        if unit.body_id is not None and above_unit.body_id == unit.body_id:
            # Same-body enclosure is the enclosed-lens-merge family, not a
            # wrapper — dropping the unit's own body would empty legit sets.
            return None
        return str(above_unit.body_id)

    async def _crossing_tie_description(
        self,
        *,
        model_id: UUID,
        section_id: UUID | None,
        a_id: UUID,
        a_side: str,
        b_id: UUID,
        b_side: str,
    ) -> str | None:
        """Name the standing tie a candidate would cross, or ``None`` if free.

        Owner ruling, 2026-08-17: *"When someone tries to draw a crossing tie,
        send a toast and reject the tie"*.

        Shares its arithmetic with the derivation's emit-time guard
        (:func:`~groundmodel.domain.services.geotech_edge_crossing_guard.ties_cross`)
        so the hand and the machine cannot disagree about what crossing means.
        Depth below collar, not elevation: both differences the test takes are
        WITHIN one column, so the sign flip cancels.

        Parameters
        ----------
        model_id : UUID
            The geotech model.
        section_id : UUID | None
            The section the gesture was made on.  Correlations are
            section-scoped, so only ties on the same section can be crossed.
        a_id, b_id : UUID
            The two bands the gesture joins.
        a_side, b_side : str
            ``'top'`` or ``'base'`` — which surface of each band, resolved into
            a depth here.

        Returns
        -------
        str | None
            The blocking tie in the engineer's own vocabulary — column names and
            depths, never a database id, because *"i can't rule, unclear for me
            which tests"* was his verdict on the id-bearing warning.  ``None``
            when nothing is crossed.
        """
        candidate_home = await self._band_home(a_id, a_side)
        partner_home = await self._band_home(b_id, b_side)
        if candidate_home is None or partner_home is None:
            return None
        (inv_a, depth_a), (inv_b, depth_b) = candidate_home, partner_home
        if inv_a == inv_b:
            return None  # spans no gap, so it crosses nothing
        gap = gap_key(inv_a, inv_b)
        first, second = (depth_a, depth_b) if gap[0] == inv_a else (depth_b, depth_a)
        candidate = GapTie(
            depth_first_m=first,
            depth_second_m=second,
            accepted=True,
            layer_first_id=str(a_id),
            layer_second_id=str(b_id),
        )

        stmt = select(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.model_id == model_id
        )
        if section_id is not None:
            stmt = stmt.where(LithoContactCorrelationEdgeOrm.section_id == section_id)
        for edge in (await self._session.execute(stmt)).scalars():
            home_a = await self._band_home(edge.layer_a_id, edge.layer_a_side)
            home_b = await self._band_home(edge.layer_b_id, edge.layer_b_side)
            if home_a is None or home_b is None:
                continue
            if gap_key(home_a[0], home_b[0]) != gap:
                continue
            standing_first, standing_second = (
                (home_a[1], home_b[1]) if gap[0] == home_a[0] else (home_b[1], home_a[1])
            )
            standing = GapTie(
                depth_first_m=standing_first,
                depth_second_m=standing_second,
                accepted=True,
                layer_first_id=str(edge.layer_a_id),
                layer_second_id=str(edge.layer_b_id),
            )
            if not crossing_partners([standing], candidate):
                continue
            name_a = await self._investigation_name(home_a[0])
            name_b = await self._investigation_name(home_b[0])
            return f"{name_a} at {home_a[1]:.2f} m to {name_b} at {home_b[1]:.2f} m"
        return None

    async def _band_home(self, band_id: UUID, side: str) -> tuple[str, float] | None:
        """The column a band sits on, and the depth of the surface named by ``side``."""
        band = await self._session.get(LithoLayerOrm, band_id)
        if band is None:
            return None
        investigation = band.cpt_id or band.borehole_id
        if investigation is None:
            return None
        depth = band.depth_top_m if side == "top" else band.depth_base_m
        return str(investigation), float(depth)

    async def _investigation_name(self, investigation_id: str) -> str:
        """The column's name as the engineer reads it on the section."""
        as_uuid = UUID(investigation_id)
        cpt = await self._session.get(CptOrm, as_uuid)
        if cpt is not None:
            return cpt.name
        borehole = await self._session.get(BoreholeOrm, as_uuid)
        return borehole.name if borehole is not None else investigation_id

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
        return await describe_geotech_band(self._session, contact_id)


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

        # Scope guard — mirrors the create path. The model row is kept: the
        # kind decides whether this deletion leaves a tombstone below.
        model = await load_scoped_or_raise(
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

        # From here on this transaction writes — take the partition lock before
        # the tombstone and the DELETE rather than leaving it to
        # ``ResolveLithoInstances`` below, which acquires it after those writes
        # have already raced the debounced ``bodies/recompute`` re-stamping
        # ``litho_layer.body_id`` in a different order (owner dogfeed
        # 2026-08-23: DeadlockDetectedError). Re-entrant, so the resolver's
        # later take stays free.
        await lock_body_partition(
            self._session, model_id=model_id, operation="uncorrelate-litho-contacts"
        )

        # A deletion the ENGINEER makes on a geotechnical model stays deleted
        # (owner 2026-08-17: "a tie i delete stays deleted but does not delete
        # on the litho model"). The tombstone is written BEFORE the delete —
        # it reads the edge's endpoint bands — and remembers the PLACE (xyz
        # both ends + section), because every subdivide rebuilds the bands and
        # ids cannot carry the memory. Litho-model deletions record nothing:
        # a litho tie's absence is already its own statement, and the geotech
        # derivation only restates what the litho model still holds.
        if model.kind == MODEL_KIND_GEOTECHNICAL:
            await record_tie_tombstone(self._session, self, existing)

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

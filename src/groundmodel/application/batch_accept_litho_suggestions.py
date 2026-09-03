"""Batch accept litho suggestions — commit many anchors in one transaction.

The single-accept use case commits once per call.  The frontend's "accept all"
fires one HTTP request per anchor, so an N-anchor bulk accept costs N commits +
N round-trips (#153 profiling: the dominant remaining cost after the
seeded-array leak fix and the recompute-all optimisation).

This use case loops :class:`AcceptLithoSuggestions` with ``commit=False`` +
``defer_inference=True`` for every anchor and commits **once** at the end, so
the whole bulk accept is a single transaction (one fsync) reached through a
single endpoint call.  Section seeding and the one-shot inference recompute are
the router's responsibility (mirroring the single-accept division of labour).

A per-anchor ``ValueError`` (bad investigation id, model mismatch) is recorded
and the batch continues — those errors are raised before any mutation, so the
shared transaction stays clean.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.accept_litho_suggestions import (
    AcceptLithoResult,
    AcceptLithoSuggestions,
)
from groundmodel.application.body_partition_lock import (
    lock_body_partition,
    lock_sibling_geotech_partitions,
)
from groundmodel.domain.services.litho_segmentation import LithoLayerSuggestion
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class BatchAcceptAnchorInput:
    """One anchor's accepted suggestions for a batch accept.

    Attributes
    ----------
    suggestions : list[LithoLayerSuggestion]
        Domain suggestions to commit for this anchor.
    cpt_id : UUID | None
        CPT anchor (XOR with ``borehole_id``).
    borehole_id : UUID | None
        Borehole anchor (XOR with ``cpt_id``).
    """

    suggestions: list[LithoLayerSuggestion]
    cpt_id: UUID | None = None
    borehole_id: UUID | None = None


@dataclass(frozen=True)
class BatchAnchorOutcome:
    """Result of accepting one anchor inside a batch.

    Attributes
    ----------
    cpt_id : UUID | None
        CPT anchor echoed back for client-side mapping.
    borehole_id : UUID | None
        Borehole anchor echoed back for client-side mapping.
    result : AcceptLithoResult | None
        The accept result, or ``None`` when the anchor was skipped.
    error : str | None
        The ``ValueError`` message when the anchor was skipped, else ``None``.
    """

    cpt_id: UUID | None
    borehole_id: UUID | None
    result: AcceptLithoResult | None
    error: str | None


@dataclass
class BatchAcceptResult:
    """Return value of :meth:`BatchAcceptLithoSuggestions.execute`.

    Attributes
    ----------
    outcomes : list[BatchAnchorOutcome]
        Per-anchor outcomes in input order.
    committed : bool
        ``True`` once the single batch commit has run.
    touched_geo_formation_ids : list[UUID]
        Geological formation ids whose contacts were snapped by the coupling
        step across all anchors.  Used by the router to trigger a single
        ``RebuildModelSurfaces`` call on the parent geo model (#162 Task 4).
        Empty when no geo contact was snapped.
    """

    outcomes: list[BatchAnchorOutcome] = field(default_factory=list)
    committed: bool = False
    touched_geo_formation_ids: list[UUID] = field(default_factory=list)


class BatchAcceptLithoSuggestions(GroundModelLogger):
    """Commit the accepted suggestions of many anchors in one transaction.

    Parameters
    ----------
    session : AsyncSession
        Active database session.  This use case commits once at the end of
        the batch; the caller must not commit before calling it.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        litho_model_id: UUID,
        anchors: list[BatchAcceptAnchorInput],
        couple_tolerance_m: float = 0.20,
    ) -> BatchAcceptResult:
        """Accept every anchor's suggestions, then commit once.

        Each anchor is accepted with ``commit=False`` + ``defer_inference=True``
        so all anchors share one transaction and inference is deferred to a
        single post-batch recompute (the caller's responsibility).  Section
        seeding is likewise the caller's responsibility — every anchor is
        accepted with ``section_id=None`` and the caller unions the aggregated
        contact ids into the section once.

        Parameters
        ----------
        project_id : UUID
            Project scope guard (forwarded to each accept).
        litho_model_id : UUID
            Lithostratigraphic model to write into.
        anchors : list[BatchAcceptAnchorInput]
            One entry per investigation.  Empty list is a no-op that still
            issues the (empty) commit for a consistent transaction boundary.
        couple_tolerance_m : float
            Depth window within which a litho contact top is linked to the
            nearest geological contact and the geo contact is snapped to the
            litho depth (#162).  Forwarded to every inner accept call.
            Default 0.20 m (matches the single-accept default).

        Returns
        -------
        BatchAcceptResult
            Per-anchor outcomes, the committed flag, and the aggregated set of
            geological formation ids whose contacts were snapped (used by the
            router for a single post-batch geo-surface rebuild).
        """
        self.info(
            f"BatchAcceptLithoSuggestions.execute: litho_model={litho_model_id}, "
            f"{len(anchors)} anchor(s), "
            f"couple_tolerance_m={couple_tolerance_m}"
        )

        accept_uc = AcceptLithoSuggestions(self._session)
        outcomes: list[BatchAnchorOutcome] = []

        # Load the shared state ONCE (#153 hoist): geology surfaces, the
        # litho-formation lookup, and the existing-contact idempotency map are
        # identical across anchors, so per-anchor re-loading + per-layer
        # existence SELECTs are pure waste at batch scale.
        batch_ctx = await accept_uc.build_batch_context(
            project_id=project_id, litho_model_id=litho_model_id
        )

        # Take the model's body-partition lock ONCE for the whole batch — after the
        # read-only ``build_batch_context`` (scope guard + lookups) and BEFORE the
        # per-anchor accept loop's first write. Every anchor's INSERTs then serialise
        # with a concurrent ``bodies/recompute`` under one advisory-lock take rather
        # than deadlocking ABBA on the ``body`` rows recompute re-stamps (BP-2/BP-4).
        # Own litho lock then the sibling geotech children (a no-op when the model
        # has no geotech child), in the resolver's canonical order. The inner
        # ``AcceptLithoSuggestions.execute`` runs in batch mode (``batch_ctx`` set)
        # and takes NO lock of its own — advisory xact locks are re-entrant, but
        # taking it once keeps the contention log clean.
        await lock_body_partition(
            self._session, model_id=litho_model_id, operation="batch-accept-litho-suggestions"
        )
        await lock_sibling_geotech_partitions(
            self._session,
            litho_model_id=litho_model_id,
            operation="batch-accept-litho-suggestions",
        )

        # Tracks whether ANY anchor produced new state that can change the
        # display-order ranking — a new formation row OR a new contact.  A new
        # shallower contact for an existing formation lowers that formation's
        # min-depth (the recompute ranks by shallowest contact), so it can flip
        # ranks without creating a formation row.
        any_created = False
        # Aggregate geological formation ids snapped across all anchors (#162
        # Task 4): the router uses this set to rebuild geo surfaces ONCE after
        # the full batch rather than once per anchor.
        all_touched_geo_formation_ids: set[UUID] = set()

        for i, anchor in enumerate(anchors, start=1):
            anchor_label = anchor.cpt_id or anchor.borehole_id
            try:
                result: AcceptLithoResult = await accept_uc.execute(
                    project_id=project_id,
                    litho_model_id=litho_model_id,
                    suggestions=anchor.suggestions,
                    cpt_id=anchor.cpt_id,
                    borehole_id=anchor.borehole_id,
                    # Seeding + inference are batched once by the caller; the
                    # shared context skips per-anchor loads + display-order.
                    section_id=None,
                    defer_inference=True,
                    commit=False,
                    batch_ctx=batch_ctx,
                    couple_tolerance_m=couple_tolerance_m,
                )
                any_created = any_created or bool(
                    result.created_formation_ids or result.created_contact_ids
                )
                all_touched_geo_formation_ids.update(result.touched_geo_formation_ids)
                outcomes.append(
                    BatchAnchorOutcome(
                        cpt_id=anchor.cpt_id,
                        borehole_id=anchor.borehole_id,
                        result=result,
                        error=None,
                    )
                )
                self.debug(
                    f"[{i}/{len(anchors)}] anchor={anchor_label}: "
                    f"{len(result.created_contact_ids)} created, "
                    f"{len(result.found_contact_ids)} found, "
                    f"{len(result.touched_geo_formation_ids)} geo formation(s) snapped"
                )
            except ValueError as exc:
                # Raised before any mutation (XOR / scope guards) so the shared
                # transaction stays clean — record and continue.
                self.warning(f"[{i}/{len(anchors)}] anchor={anchor_label} skipped: {exc}")
                outcomes.append(
                    BatchAnchorOutcome(
                        cpt_id=anchor.cpt_id,
                        borehole_id=anchor.borehole_id,
                        result=None,
                        error=str(exc),
                    )
                )

        # Display-order recompute runs ONCE for the whole batch (each accept
        # deferred it via batch_ctx) — the per-anchor recompute scans the
        # growing contact set, so N runs would be O(N²).  Gated on any new
        # formation OR contact: a shallower contact for an existing formation
        # re-ranks it without creating a formation row.
        if any_created:
            await accept_uc._recompute_litho_display_orders(litho_model_id=litho_model_id)

        # One commit for every accepted anchor (and the deferred contact INSERTs).
        await self._session.commit()

        succeeded = sum(1 for o in outcomes if o.result is not None)
        failed = len(outcomes) - succeeded
        self.success(
            f"BatchAcceptLithoSuggestions: committed {succeeded} anchor(s), {failed} skipped, "
            f"{len(all_touched_geo_formation_ids)} geo formation(s) snapped"
        )
        return BatchAcceptResult(
            outcomes=outcomes,
            committed=True,
            touched_geo_formation_ids=sorted(all_touched_geo_formation_ids),
        )

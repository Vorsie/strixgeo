"""Carry accepted geotech packing ties across a re-subdivide.

The problem
-----------
A correlation edge does not say "the dense sand at 3 m connects to the dense
sand at 3 m".  It says "band ``#A7F3`` connects to band ``#B221``" — two row
ids.  ``SubdivideAllBodies`` throws every geotech band away and rebuilds it with
a fresh ``uuid7``, and both endpoint foreign keys are ``ON DELETE CASCADE``, so
Postgres removes the edge as a side effect of the layer wipe — silently, without
passing through application code.  Sparing accepted edges in the reset's own
``WHERE`` clause made no difference at all: the cascade took them anyway.

The rule
--------
Two tiers, tried in order.

1. **Same investigation, same depth interval, same NAD class** (owner ruling,
   2026-08-01, verbatim) — the band came back untouched.
2. Failing that, **the single band of the same class overlapping where the old
   band was** — the same band with a boundary dragged.

Tier 2 was added on 2026-08-02, after tier 1 alone dropped 13 accepted ties on the
real model and the owner rejected that outcome: *"you're literally just dragging
the anchor to which the tie is connected, shouldn't it just move with the
anchor?"*  Measured on those 13, 12 had exactly one same-class band overlapping
72–100 % of the old interval — the boundary had moved by as little as 4 cm.

What is still refused is guessing.  Two same-class candidates is ambiguous, and a
band of a different class is a different band however much it overlaps, so
neither re-points.  A tie that cannot follow is counted and logged at WARNING,
never approximated onto material the engineer did not tie to.

Depth comparison
----------------
Depths are compared in whole millimetres (:func:`depth_to_mm`).  That is the
grain the database itself distinguishes intervals at — ``litho_layer``'s
no-overlap exclusion constraint compares
``numrange(round(depth_top_m::numeric, 3), round(depth_base_m::numeric, 3))`` —
so it is the *storage* grain, not a geological tolerance.  A centimetre still
reads as a different interval.

What survives, and as what
--------------------------
A re-anchored tie is re-created with its ORIGINAL ``user_approved`` and
``source``: a tie the engineer accepted must come back accepted, and a hand-made
one must still read ``manual``.  Only accepted ties are carried — an unaccepted
tie is dirty by the clean/dirty rule, and regenerating it is the whole point of
the build.

Where it runs
-------------
:class:`~groundmodel.application.subdivide_all_bodies.SubdivideAllBodies`
captures before the reset and re-anchors after the rebuild, inside the same
transaction, so a failure leaves neither half applied.  The re-anchored ties are
inserted BEFORE the auto-derivation pass so that pass's per-section dedup set
already contains them and never proposes a duplicate.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Why a tie could not be re-anchored.  The three geological reasons mean
# different things and are reported separately: a class change is the qc
# re-deriving, an interval move is a boundary shifting, an absent band is
# geology the rebuild no longer draws.  The fourth is not geology at all.
REASON_CLASS_CHANGED = "class_changed"
REASON_INTERVAL_MOVED = "interval_moved"
REASON_BAND_ABSENT = "band_absent"
REASON_BOREHOLE_DEFERRED = "borehole_endpoint_deferred"

# Anchor-kind tokens, mirroring ``litho_layer``'s XOR pair.
ANCHOR_CPT = "cpt"
ANCHOR_BOREHOLE = "borehole"


def depth_to_mm(depth_m: float) -> int:
    """Convert a stored layer depth to whole millimetres.

    Millimetres are the finest interval grain the database distinguishes:
    ``litho_layer``'s no-overlap exclusion constraint compares
    ``numrange(round(depth_top_m::numeric, 3), round(depth_base_m::numeric, 3))``.
    Keying on millimetres therefore compares intervals the way the DB stores
    them, and is NOT a tolerance — a centimetre difference still reads as a
    different interval.

    Parameters
    ----------
    depth_m : float
        Depth below surface in metres, as read from ``litho_layer``.

    Returns
    -------
    int
        The depth in whole millimetres.
    """
    return int(round(depth_m * 1000.0))


@dataclass(frozen=True)
class BandIdentity:
    """The owner's three-part identity of a geotech packing band.

    Two bands are the same band when, and only when, all three fields are
    equal.

    Attributes
    ----------
    investigation_id : str
        The CPT or borehole the band sits on, stringified.  ``litho_layer``
        carries a DB XOR constraint, so exactly one of ``cpt_id`` /
        ``borehole_id`` is set and the anchor is unambiguous.
    depth_top_mm : int
        Top of the band in whole millimetres (see :func:`depth_to_mm`).
    depth_base_mm : int
        Base of the band in whole millimetres.
    nad_class : int | None
        The NAD packing class carried by the band's ``geological_formation``.
        ``None`` is a skeleton band (no qc resolved); it matches only another
        ``None`` — under the exact rule ``None`` is a class value like any
        other.
    """

    investigation_id: str
    depth_top_mm: int
    depth_base_mm: int
    nad_class: int | None


@dataclass(frozen=True)
class CapturedTie:
    """An accepted geotech tie, recorded before the reset destroys its endpoints.

    Attributes
    ----------
    edge_id : UUID
        The id of the edge row as it existed before the reset.  Kept for
        logging only — the re-created edge gets a fresh ``uuid7`` because the
        old row is gone by then.
    section_id : UUID
        The section the tie was authored on.  Geotech edges are section-scoped,
        so this is part of the tie's identity.
    layer_a_side : str
        ``'top'`` or ``'base'`` — which contact of endpoint A the tie joins.
    layer_b_side : str
        Same for endpoint B.
    source : str
        The tie's original provenance token (``'manual'`` / ``'auto'``),
        preserved verbatim so hand work still reads as hand work.
    identity_a : BandIdentity
        Three-part identity of endpoint A's band.
    identity_b : BandIdentity
        Three-part identity of endpoint B's band.
    anchor_kind_a : str
        ``'cpt'`` or ``'borehole'`` for endpoint A.
    anchor_kind_b : str
        Same for endpoint B.
    """

    edge_id: UUID
    section_id: UUID
    layer_a_side: str
    layer_b_side: str
    source: str
    identity_a: BandIdentity
    identity_b: BandIdentity
    anchor_kind_a: str
    anchor_kind_b: str


@dataclass(frozen=True)
class RebuiltBand:
    """A packing band the rebuild has just materialised.

    Attributes
    ----------
    identity : BandIdentity
        The band's three-part identity.
    layer_id : UUID
        The new ``litho_layer`` id an accepted tie must be re-pointed at.
    """

    identity: BandIdentity
    layer_id: UUID


@dataclass(frozen=True)
class LostTie:
    """An accepted tie that could not be re-anchored, and why.

    Attributes
    ----------
    tie : CapturedTie
        The captured tie that is being dropped.
    reason_a : str | None
        Why endpoint A found no band, or ``None`` when endpoint A matched.
    reason_b : str | None
        Same for endpoint B.
    """

    tie: CapturedTie
    reason_a: str | None
    reason_b: str | None

    def reasons(self) -> list[str]:
        """Return the distinct loss reasons this tie carries, in endpoint order."""
        out: list[str] = []
        for reason in (self.reason_a, self.reason_b):
            if reason is not None and reason not in out:
                out.append(reason)
        return out

    def describe(self) -> str:
        """One-line human description naming both endpoints and their verdicts."""
        return (
            f"edge {self.edge_id_str} on section {self.tie.section_id}: "
            f"A={_describe_identity(self.tie.identity_a)} "
            f"[{self.reason_a or 'matched'}] "
            f"B={_describe_identity(self.tie.identity_b)} "
            f"[{self.reason_b or 'matched'}]"
        )

    @property
    def edge_id_str(self) -> str:
        """The original edge id as a string, for log lines."""
        return str(self.tie.edge_id)


@dataclass
class ReanchorPlan:
    """Outcome of matching captured ties against the rebuilt bands.

    Attributes
    ----------
    matched : list[tuple[CapturedTie, UUID, UUID]]
        ``(tie, new_layer_id_for_identity_a, new_layer_id_for_identity_b)``.
    lost : list[LostTie]
        Ties with at least one endpoint that found no band.
    skipped_duplicate_pair : int
        Matched ties dropped because an earlier tie already claimed the same
        ``(section, layer pair, sides)`` — the DB uniqueness made visible
        instead of raised.
    """

    matched: list[tuple[CapturedTie, UUID, UUID]] = field(default_factory=list)
    lost: list[LostTie] = field(default_factory=list)
    skipped_duplicate_pair: int = 0

    def loss_reason_counts(self) -> dict[str, int]:
        """Count lost ties per reason.

        A tie whose two endpoints failed for different reasons is counted once
        under each — the reasons mean different things and both are worth
        seeing.

        Returns
        -------
        dict[str, int]
            Reason token → number of lost ties carrying it.
        """
        counts: dict[str, int] = {}
        for lost in self.lost:
            for reason in lost.reasons():
                counts[reason] = counts.get(reason, 0) + 1
        return counts


def _describe_identity(identity: BandIdentity) -> str:
    """Render a band identity for a log line."""
    return (
        f"inv={identity.investigation_id} "
        f"{identity.depth_top_mm / 1000.0:.3f}–{identity.depth_base_mm / 1000.0:.3f} m "
        f"nad={identity.nad_class}"
    )


def _endpoint_reason(
    identity: BandIdentity,
    anchor_kind: str,
    by_investigation: dict[str, list[RebuiltBand]],
) -> str:
    """Diagnose why an endpoint's band could not be found.

    Called only after the exact three-part lookup missed.

    Parameters
    ----------
    identity : BandIdentity
        The endpoint's captured identity.
    anchor_kind : str
        ``'cpt'`` or ``'borehole'``.
    by_investigation : dict[str, list[RebuiltBand]]
        Every rebuilt band, grouped by investigation.

    Returns
    -------
    str
        One of :data:`REASON_CLASS_CHANGED`, :data:`REASON_INTERVAL_MOVED`,
        :data:`REASON_BAND_ABSENT`, :data:`REASON_BOREHOLE_DEFERRED`.
    """
    bands = by_investigation.get(identity.investigation_id, [])
    if not bands:
        # A borehole column carries no bands at the point SubdivideAllBodies
        # re-anchors: it materialises CPT bands only, and DivideBoreholes fills
        # the borehole columns afterwards. That is a schedule fact about the
        # build order, NOT geology the rebuild stopped drawing, so it must not
        # be reported as an absent band.
        if anchor_kind == ANCHOR_BOREHOLE:
            return REASON_BOREHOLE_DEFERRED
        return REASON_BAND_ABSENT

    for band in bands:
        if (
            band.identity.depth_top_mm == identity.depth_top_mm
            and band.identity.depth_base_mm == identity.depth_base_mm
        ):
            # The band is exactly where it was; only its class differs — the qc
            # re-derived a different packing class for the same interval.
            return REASON_CLASS_CHANGED

    for band in bands:
        if (
            band.identity.depth_top_mm < identity.depth_base_mm
            and identity.depth_top_mm < band.identity.depth_base_mm
        ):
            # Something is still drawn over these depths, just not with these
            # boundaries — a boundary shifted.
            return REASON_INTERVAL_MOVED

    return REASON_BAND_ABSENT


def _follow_moved_band(
    identity: BandIdentity,
    by_investigation: dict[str, list[RebuiltBand]],
) -> UUID | None:
    """Find the band this one moved into, when that is unambiguous.

    Second tier of the rule, applied only after the exact-interval lookup missed.
    A rebuilt band of the SAME class that overlaps where the old band was is that
    band with a moved boundary — dragging a contact does not create a new band,
    it resizes an existing one.

    Two conditions keep this from guessing.  The class must still agree, because
    material of a different packing class is a different band no matter where it
    sits.  And exactly one candidate must exist: with two, which one inherited
    the tie is unknowable, and picking either would silently re-point accepted
    work.

    Overlap is strict, so a band that merely abuts the old one at a shared
    boundary is not a candidate.

    Parameters
    ----------
    identity : BandIdentity
        The captured endpoint's identity.
    by_investigation : dict[str, list[RebuiltBand]]
        Every rebuilt band, grouped by investigation.

    Returns
    -------
    UUID | None
        The new layer id to re-point at, or ``None`` when no single same-class
        band overlaps.
    """
    candidates = [
        band
        for band in by_investigation.get(identity.investigation_id, [])
        if band.identity.nad_class == identity.nad_class
        and band.identity.depth_top_mm < identity.depth_base_mm
        and identity.depth_top_mm < band.identity.depth_base_mm
    ]
    if len(candidates) == 1:
        return candidates[0].layer_id
    return None


def plan_tie_reanchor(
    captured: list[CapturedTie],
    rebuilt_bands: list[RebuiltBand],
) -> ReanchorPlan:
    """Match captured accepted ties onto the bands the rebuild produced.

    Two tiers, in order.  An endpoint re-anchors when a rebuilt band shares its
    investigation, its depth interval (to the millimetre the DB stores) and its
    NAD class — the band came back untouched.  Failing that it re-anchors onto
    the single same-class band overlapping where it used to be, which is the same
    band with a boundary dragged (:func:`_follow_moved_band`).

    The exact tier is tried first for every endpoint, so a band that came back
    unchanged is never abandoned for a neighbour that happens to overlap it.

    Parameters
    ----------
    captured : list[CapturedTie]
        Accepted ties recorded before the reset.
    rebuilt_bands : list[RebuiltBand]
        Every band the rebuild materialised, with its new layer id.

    Returns
    -------
    ReanchorPlan
        Matched ties with their new endpoint ids, plus the losses and their
        reasons.
    """
    by_identity: dict[BandIdentity, UUID] = {}
    by_investigation: dict[str, list[RebuiltBand]] = defaultdict(list)
    for band in rebuilt_bands:
        by_identity.setdefault(band.identity, band.layer_id)
        by_investigation[band.identity.investigation_id].append(band)

    plan = ReanchorPlan()
    claimed: set[tuple[UUID, UUID, UUID, str, str]] = set()

    for tie in captured:
        new_a = by_identity.get(tie.identity_a)
        if new_a is None:
            new_a = _follow_moved_band(tie.identity_a, by_investigation)
        new_b = by_identity.get(tie.identity_b)
        if new_b is None:
            new_b = _follow_moved_band(tie.identity_b, by_investigation)
        if new_a is None or new_b is None:
            plan.lost.append(
                LostTie(
                    tie=tie,
                    reason_a=(
                        None
                        if new_a is not None
                        else _endpoint_reason(tie.identity_a, tie.anchor_kind_a, by_investigation)
                    ),
                    reason_b=(
                        None
                        if new_b is not None
                        else _endpoint_reason(tie.identity_b, tie.anchor_kind_b, by_investigation)
                    ),
                )
            )
            continue

        if new_a == new_b:
            # Both endpoints landed on one band — an intra-column edge, which
            # the model forbids. Cannot happen while the two endpoints sit on
            # different investigations (their identities then differ), but a
            # self-loop would violate a DB CHECK, so refuse it here.
            plan.lost.append(
                LostTie(tie=tie, reason_a=REASON_BAND_ABSENT, reason_b=REASON_BAND_ABSENT)
            )
            continue

        key = _canonical_key(tie, new_a, new_b)
        if key in claimed:
            plan.skipped_duplicate_pair += 1
            continue
        claimed.add(key)
        plan.matched.append((tie, new_a, new_b))

    return plan


def _canonical_key(tie: CapturedTie, new_a: UUID, new_b: UUID) -> tuple[UUID, UUID, UUID, str, str]:
    """Return the ``(section, min, max, side, side)`` key the DB uniqueness uses.

    The sides travel with their endpoints: swapping the layer ids into canonical
    order must swap the sides too, or a top↔base tie would come back reversed.

    Parameters
    ----------
    tie : CapturedTie
        The captured tie, carrying the per-endpoint sides.
    new_a : UUID
        New layer id for ``tie.identity_a``.
    new_b : UUID
        New layer id for ``tie.identity_b``.

    Returns
    -------
    tuple[UUID, UUID, UUID, str, str]
        ``(section_id, layer_a_id, layer_b_id, layer_a_side, layer_b_side)``
        with ``layer_a_id < layer_b_id``.
    """
    if new_a < new_b:
        return (tie.section_id, new_a, new_b, tie.layer_a_side, tie.layer_b_side)
    return (tie.section_id, new_b, new_a, tie.layer_b_side, tie.layer_a_side)


class GeotechTieReanchor(GroundModelLogger):
    """Capture accepted geotech ties before a reset and re-anchor them after it.

    The two halves belong to the same transaction: ``capture`` runs before the
    layer wipe and ``reanchor`` after the rebuild, and the caller commits once.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session, owned by the caller.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def capture(self, geotech_model_id: UUID) -> list[CapturedTie]:
        """Record every ACCEPTED tie of a geotech model with its bands' identities.

        Must run before the reset: once the layer wipe fires, the endpoints are
        gone and their investigation / depth / class can no longer be read.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model whose accepted ties are captured.

        Returns
        -------
        list[CapturedTie]
            One entry per accepted edge whose two endpoints could both be
            resolved.  An edge with an unresolvable endpoint is skipped and
            logged at WARNING — it is already broken and nothing can be carried.
        """
        self.debug(f"GeotechTieReanchor.capture: model={geotech_model_id}")
        edges = (
            (
                await self._session.execute(
                    select(LithoContactCorrelationEdgeOrm).where(
                        LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                        LithoContactCorrelationEdgeOrm.user_approved.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        if not edges:
            self.info(
                f"GeotechTieReanchor.capture: model={geotech_model_id} has no accepted "
                f"tie — nothing to carry across the rebuild"
            )
            return []

        endpoint_ids = {e.layer_a_id for e in edges} | {e.layer_b_id for e in edges}
        identities = await self._load_band_identities(endpoint_ids)

        captured: list[CapturedTie] = []
        unresolved = 0
        for edge in edges:
            entry_a = identities.get(edge.layer_a_id)
            entry_b = identities.get(edge.layer_b_id)
            if entry_a is None or entry_b is None:
                unresolved += 1
                self.warning(
                    f"GeotechTieReanchor.capture: accepted edge {edge.id} has an endpoint "
                    f"that is not a resolvable geotech band "
                    f"(a={edge.layer_a_id} {'ok' if entry_a else 'MISSING'}, "
                    f"b={edge.layer_b_id} {'ok' if entry_b else 'MISSING'}) — "
                    f"it cannot be carried across the rebuild"
                )
                continue
            identity_a, kind_a = entry_a
            identity_b, kind_b = entry_b
            captured.append(
                CapturedTie(
                    edge_id=edge.id,
                    section_id=edge.section_id,
                    layer_a_side=edge.layer_a_side,
                    layer_b_side=edge.layer_b_side,
                    source=edge.source,
                    identity_a=identity_a,
                    identity_b=identity_b,
                    anchor_kind_a=kind_a,
                    anchor_kind_b=kind_b,
                )
            )

        self.info(
            f"GeotechTieReanchor.capture: model={geotech_model_id} captured "
            f"{len(captured)} accepted tie(s) "
            f"({unresolved} unresolvable endpoint(s) skipped)"
        )
        return captured

    async def reanchor(
        self,
        *,
        geotech_model_id: UUID,
        captured: list[CapturedTie],
        rebuilt_bands: list[RebuiltBand],
    ) -> ReanchorPlan:
        """Re-create the captured ties against the rebuilt bands.

        Each matched tie is inserted with its ORIGINAL ``source`` and
        ``user_approved=True``: a tie the engineer accepted comes back accepted,
        and a hand-made one still reads ``manual``.  A tie whose band is gone is
        logged at WARNING with both endpoints' identities so it can be
        identified in the section, and counted in the returned plan so the UI
        can say how many were lost.

        Parameters
        ----------
        geotech_model_id : UUID
            Model id stamped on each re-created edge.
        captured : list[CapturedTie]
            Ties recorded by :meth:`capture`.
        rebuilt_bands : list[RebuiltBand]
            Bands the rebuild materialised.

        Returns
        -------
        ReanchorPlan
            Matched / lost / duplicate-skipped counts, with per-reason detail.
        """
        if not captured:
            return ReanchorPlan()

        plan = plan_tie_reanchor(captured, rebuilt_bands)

        # Never write a pair that already exists on the section. Nothing should
        # remain at this point (the reset's cascade emptied the edge table for
        # this model), but re-reading is cheap and makes the pass safe to call
        # from anywhere.
        existing = await self._load_existing_keys(geotech_model_id)

        written = 0
        for tie, new_a, new_b in plan.matched:
            section_id, layer_a_id, layer_b_id, side_a, side_b = _canonical_key(tie, new_a, new_b)
            if (section_id, layer_a_id, layer_b_id, side_a, side_b) in existing:
                plan.skipped_duplicate_pair += 1
                continue
            existing.add((section_id, layer_a_id, layer_b_id, side_a, side_b))
            self._session.add(
                LithoContactCorrelationEdgeOrm(
                    id=uuid7(),
                    model_id=geotech_model_id,
                    section_id=section_id,
                    layer_a_id=layer_a_id,
                    layer_b_id=layer_b_id,
                    layer_a_side=side_a,
                    layer_b_side=side_b,
                    # Verbatim from the tie that was accepted — a hand-drawn tie
                    # must still read 'manual' after the rebuild.
                    source=tie.source,
                    user_approved=True,
                )
            )
            written += 1
        await self._session.flush()

        for lost in plan.lost:
            self.warning(f"GeotechTieReanchor.reanchor: tie LOST — {lost.describe()}")

        reasons = plan.loss_reason_counts()
        if plan.lost:
            self.warning(
                f"GeotechTieReanchor.reanchor: {len(plan.lost)} accepted tie(s) could not be "
                f"re-anchored to a rebuilt band — reasons {reasons}"
            )
        self.success(
            f"GeotechTieReanchor.reanchor: model={geotech_model_id} "
            f"re-anchored={written}/{len(captured)} lost={len(plan.lost)} "
            f"skipped_duplicate={plan.skipped_duplicate_pair} reasons={reasons}"
        )
        return plan

    async def _load_band_identities(
        self, layer_ids: set[UUID]
    ) -> dict[UUID, tuple[BandIdentity, str]]:
        """Load the three-part identity + anchor kind of a set of geotech layers.

        ``nad_class`` lives on the band's ``geological_formation``, not on the
        layer row, so the join is mandatory.

        Parameters
        ----------
        layer_ids : set[UUID]
            Geotech ``litho_layer`` ids.

        Returns
        -------
        dict[UUID, tuple[BandIdentity, str]]
            ``layer_id → (identity, 'cpt' | 'borehole')``.
        """
        if not layer_ids:
            return {}
        rows = (
            await self._session.execute(
                select(
                    LithoLayerOrm.id,
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.borehole_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                    GeologicalFormationOrm.nad_class,
                )
                .join(
                    GeologicalFormationOrm,
                    LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
                )
                .where(LithoLayerOrm.id.in_(layer_ids))
            )
        ).all()
        out: dict[UUID, tuple[BandIdentity, str]] = {}
        for row in rows:
            # The XOR CHECK guarantees exactly one anchor is set.
            kind = ANCHOR_BOREHOLE if row.borehole_id is not None else ANCHOR_CPT
            investigation_id = str(row.borehole_id if row.borehole_id is not None else row.cpt_id)
            out[row.id] = (
                BandIdentity(
                    investigation_id=investigation_id,
                    depth_top_mm=depth_to_mm(row.depth_top_m),
                    depth_base_mm=depth_to_mm(row.depth_base_m),
                    nad_class=row.nad_class,
                ),
                kind,
            )
        return out

    async def _load_existing_keys(
        self, geotech_model_id: UUID
    ) -> set[tuple[UUID, UUID, UUID, str, str]]:
        """Load the ``(section, pair, sides)`` keys already present for the model.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotech model.

        Returns
        -------
        set[tuple[UUID, UUID, UUID, str, str]]
            One key per persisted edge, in the same canonical shape
            :func:`_canonical_key` produces.
        """
        rows = (
            await self._session.execute(
                select(
                    LithoContactCorrelationEdgeOrm.section_id,
                    LithoContactCorrelationEdgeOrm.layer_a_id,
                    LithoContactCorrelationEdgeOrm.layer_b_id,
                    LithoContactCorrelationEdgeOrm.layer_a_side,
                    LithoContactCorrelationEdgeOrm.layer_b_side,
                ).where(LithoContactCorrelationEdgeOrm.model_id == geotech_model_id)
            )
        ).all()
        return {
            (r.section_id, r.layer_a_id, r.layer_b_id, r.layer_a_side, r.layer_b_side) for r in rows
        }

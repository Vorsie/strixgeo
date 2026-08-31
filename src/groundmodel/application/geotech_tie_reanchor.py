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
Three tiers, tried in order.

1. **Same investigation, same depth interval, same NAD class** (owner ruling,
   2026-08-01, verbatim) — the band came back untouched.  Carried clean.
2. Failing that, **the single band of the same class overlapping where the old
   band was** — the same band with a boundary dragged.  Carried clean.
3. Failing that, **whichever band covers most of where the old one was** —
   carried, but stamped with a ``review_reason`` for the engineer to confirm or
   delete.

Tier 2 was added on 2026-08-02, after tier 1 alone dropped 13 accepted ties on the
real model and the owner rejected that outcome: *"you're literally just dragging
the anchor to which the tie is connected, shouldn't it just move with the
anchor?"*  Measured on those 13, 12 had exactly one same-class band overlapping
72–100 % of the old interval — the boundary had moved by as little as 4 cm.

Tier 3 is the owner's stronger rule from the same day: *"i don't want accepted
edges to just disappear without any user explicitly deleting it."*  It exists so
the machine never decides on its own that accepted work is gone.  It does not
pretend to know the geology: an ambiguous or re-classified anchor produces a
FLAGGED tie, never a silent one, and only an endpoint with nothing overlapping it
anywhere is genuinely uncarryable (counted and logged at WARNING).

The full-model consequence, measured on the dev model: 217 of 217 accepted ties
survive a re-subdivide, with exactly one flagged ``class_changed``.

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

:class:`~groundmodel.application.divide_boreholes.DivideBoreholes` does the same
around ITS rebuild, which deletes and re-materialises the borehole bands only.
It therefore captures with ``restrict_to_anchor_kind='borehole'`` — a CPT↔CPT
tie's endpoints are untouched by that delete, so its row survives and there is
nothing to carry.  The two verbs together are why an accepted tie on a borehole
column outlives the whole build: SubdivideAllBodies cannot re-anchor it (it
materialises CPT bands only, and reports the endpoint as
:data:`REASON_BOREHOLE_DEFERRED`), and DivideBoreholes is where the borehole
bands come back.

Because DivideBoreholes IS that later step, it re-anchors with
``borehole_bands_are_final=True``: past it, a borehole endpoint with no band has
nothing coming, and the loss is reported as :data:`REASON_BAND_ABSENT` rather
than as deferred.  :data:`REASON_BOREHOLE_DEFERRED` is therefore emitted by
SubdivideAllBodies only.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
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

# Why a carried tie needs the engineer to look at it again.  Persisted on the
# edge as ``review_reason`` so the flag survives the session that raised it.
REVIEW_CLASS_CHANGED = "class_changed"
REVIEW_AMBIGUOUS_BAND = "ambiguous_band"
# A hand edit absorbed the band this tie was anchored on, and the survivor's class
# still matches the partner's. Distinct from ``ambiguous_band`` because the two ask
# the engineer different questions: ambiguous means several bands could have been the
# one the tie was drawn on and the re-anchor had to choose; absorbed means the band it
# was drawn on no longer exists as its own row. Owner's choice of wording, 2026-08-10.
# Like ``ambiguous_band`` and unlike ``class_changed`` it never self-heals — no later
# class match can answer a question that was never about the class.
REVIEW_BAND_ABSORBED = "band_absorbed"

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


def rebuilt_bands_from_layer_index(
    layers_by_investigation: Mapping[str, Sequence[tuple[Any, ...]]],
) -> list[RebuiltBand]:
    """Describe the bands a rebuild wrote, for the re-anchor to match against.

    Both geotech rebuilds accumulate their freshly-written bands in the same
    per-investigation index — the one they also hand to
    ``derive_geotech_edges_from_litho`` — whose entries begin
    ``(depth_top_m, depth_base_m, layer_id, formation_id, nad_class, ...)``.
    SubdivideAllBodies stops at five elements; DivideBoreholes carries a sixth
    (the resolver's ``body_id``).  Only positions 0, 1, 2 and 4 are read here,
    so the same helper serves both and a seventh element would ride along
    harmlessly.

    Parameters
    ----------
    layers_by_investigation : Mapping[str, Sequence[tuple[Any, ...]]]
        Investigation id (stringified) → the bands written for it.

    Returns
    -------
    list[RebuiltBand]
        One entry per band, carrying the owner's three-part identity and the
        band's new ``litho_layer`` id.
    """
    return [
        RebuiltBand(
            identity=BandIdentity(
                investigation_id=investigation_id,
                depth_top_mm=depth_to_mm(entry[0]),
                depth_base_mm=depth_to_mm(entry[1]),
                nad_class=entry[4],
            ),
            layer_id=entry[2],
        )
        for investigation_id, entries in layers_by_investigation.items()
        for entry in entries
    ]


@dataclass(frozen=True)
class MatchedTie:
    """A captured tie and the rebuilt bands it will be re-created against.

    Attributes
    ----------
    tie : CapturedTie
        The tie as it was before the reset, carrying its sides and provenance.
    layer_a_id : UUID
        New ``litho_layer`` id for ``tie.identity_a``.
    layer_b_id : UUID
        New ``litho_layer`` id for ``tie.identity_b``.
    review_reason : str | None
        ``None`` when both endpoints resolved cleanly (tiers 1–2).  Otherwise the
        token saying why the engineer should confirm the tie —
        :data:`REVIEW_CLASS_CHANGED` or :data:`REVIEW_AMBIGUOUS_BAND`.
    """

    tie: CapturedTie
    layer_a_id: UUID
    layer_b_id: UUID
    review_reason: str | None = None


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
    matched : list[MatchedTie]
        Ties that will be re-created, each with its new endpoint ids and its
        review flag (``None`` when it resolved cleanly).
    lost : list[LostTie]
        Ties with at least one endpoint that found no band.
    skipped_duplicate_pair : int
        Matched ties dropped because an earlier tie already claimed the same
        ``(section, layer pair, sides)`` — the DB uniqueness made visible
        instead of raised.
    lost_tie_labels : list[str]
        One human-readable line per lost tie, naming BOTH investigations and
        the depth of each endpoint — e.g.
        ``"GEO-22/115-S10 4.20-6.10 m <-> BH-3 4.00-5.90 m"``.

        Populated by :meth:`GeotechTieReanchor.reanchor`, which is where the
        session to resolve an investigation id into its name lives; the pure
        planner leaves it empty.  It exists because a count alone is not
        actionable: the engineer is told "3 accepted ties could not be kept"
        and has no way to find WHICH three, and the ids sit only in a
        renderer console a packaged build does not show (audit 2026-08-02).
    """

    matched: list[MatchedTie] = field(default_factory=list)
    lost: list[LostTie] = field(default_factory=list)
    skipped_duplicate_pair: int = 0
    lost_tie_labels: list[str] = field(default_factory=list)

    def review_reason_counts(self) -> dict[str, int]:
        """Count carried ties per review reason, ignoring the clean ones.

        Returns
        -------
        dict[str, int]
            Review token → number of carried ties flagged with it.
        """
        counts: dict[str, int] = {}
        for match in self.matched:
            if match.review_reason is not None:
                counts[match.review_reason] = counts.get(match.review_reason, 0) + 1
        return counts

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


def _label_endpoint(identity: BandIdentity, names: Mapping[str, str]) -> str:
    """Render one endpoint for the ENGINEER: investigation name + depth range.

    Falls back to the raw id when the investigation row is gone — a truncated
    id would be worse than useless (never trust a truncated UUID), so the whole
    one is shown.

    Parameters
    ----------
    identity : BandIdentity
        The endpoint's band identity.
    names : Mapping[str, str]
        Investigation id (stringified) → display name.

    Returns
    -------
    str
        e.g. ``"GEO-22/115-S10 4.20-6.10 m"``.
    """
    name = names.get(identity.investigation_id, identity.investigation_id)
    return f"{name} {identity.depth_top_mm / 1000.0:.2f}-{identity.depth_base_mm / 1000.0:.2f} m"


def label_lost_ties(lost: Sequence[LostTie], names: Mapping[str, str]) -> list[str]:
    """Name every lost tie so the engineer can find it in the section.

    Parameters
    ----------
    lost : Sequence[LostTie]
        The plan's lost ties.
    names : Mapping[str, str]
        Investigation id (stringified) → display name.

    Returns
    -------
    list[str]
        One ``"<A name> <depths> <-> <B name> <depths>"`` line per lost tie, in
        the order they were captured.
    """
    return [
        f"{_label_endpoint(item.tie.identity_a, names)} <-> "
        f"{_label_endpoint(item.tie.identity_b, names)}"
        for item in lost
    ]


def _endpoint_reason(
    identity: BandIdentity,
    anchor_kind: str,
    by_investigation: dict[str, list[RebuiltBand]],
    *,
    borehole_bands_are_final: bool = False,
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
    borehole_bands_are_final : bool, default False
        Whether the caller has already materialised the borehole bands. See
        :func:`plan_tie_reanchor`.

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
        #
        # ``borehole_bands_are_final`` is DivideBoreholes saying the schedule
        # excuse has expired: it IS the later verb, so a borehole with no band
        # after it ran has none coming.
        if anchor_kind == ANCHOR_BOREHOLE and not borehole_bands_are_final:
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


def overlap_mm(identity: BandIdentity, band: RebuiltBand) -> int:
    """Millimetres of the old interval a rebuilt band covers (0 when disjoint).

    Strict overlap: a band merely abutting the old one at a shared boundary
    covers nothing of it. Public so the body-separation re-anchor
    (``body_separation_reanchor``) shares one overlap definition with the tie
    re-anchor rather than keeping a second copy.

    Parameters
    ----------
    identity : BandIdentity
        The captured endpoint's identity.
    band : RebuiltBand
        A candidate band from the rebuild.

    Returns
    -------
    int
        Overlapping depth in whole millimetres.
    """
    top = max(identity.depth_top_mm, band.identity.depth_top_mm)
    base = min(identity.depth_base_mm, band.identity.depth_base_mm)
    return max(0, base - top)


def _follow_moved_band(
    identity: BandIdentity,
    by_investigation: dict[str, list[RebuiltBand]],
) -> tuple[UUID | None, str | None]:
    """Find the band this one moved into, and say whether it needs review.

    Applied only after the exact-interval lookup missed.  A rebuilt band that
    overlaps where the old band was is that band with a moved boundary —
    dragging a contact does not create a new band, it resizes an existing one.

    Which tier applies depends on how confidently the band can be identified:

    * exactly one overlapping band of the **same class** → tier 2, carried clean;
    * several same-class candidates → tier 3, carried with
      :data:`REVIEW_AMBIGUOUS_BAND`, because which one inherited the tie is
      unknowable;
    * no same-class candidate but something overlaps → tier 3, carried with
      :data:`REVIEW_CLASS_CHANGED`, because the qc re-derived a different
      packing class over those depths;
    * nothing overlaps → not carryable here.

    Tier 3 exists because of the owner's rule that an accepted tie never
    disappears without them deleting it.  It deliberately does not decide the
    geology: the tie comes back attached to the band covering most of where it
    used to be, flagged, for the engineer to confirm or delete.

    Ties are broken by shallowest top, so two candidates covering equal depth
    resolve deterministically rather than by dict ordering.

    Parameters
    ----------
    identity : BandIdentity
        The captured endpoint's identity.
    by_investigation : dict[str, list[RebuiltBand]]
        Every rebuilt band, grouped by investigation.

    Returns
    -------
    tuple[UUID | None, str | None]
        ``(new_layer_id, review_reason)``.  The id is ``None`` only when nothing
        overlaps; the reason is ``None`` when the match is clean.
    """
    overlapping = [
        band
        for band in by_investigation.get(identity.investigation_id, [])
        if overlap_mm(identity, band) > 0
    ]
    if not overlapping:
        return None, None

    same_class = [b for b in overlapping if b.identity.nad_class == identity.nad_class]
    if len(same_class) == 1:
        return same_class[0].layer_id, None

    pool = same_class or overlapping
    reason = REVIEW_AMBIGUOUS_BAND if same_class else REVIEW_CLASS_CHANGED
    best = min(pool, key=lambda b: (-overlap_mm(identity, b), b.identity.depth_top_mm))
    return best.layer_id, reason


def plan_tie_reanchor(
    captured: list[CapturedTie],
    rebuilt_bands: list[RebuiltBand],
    *,
    borehole_bands_are_final: bool = False,
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
    borehole_bands_are_final : bool, default False
        Whether ``rebuilt_bands`` already carries the borehole columns.
        ``SubdivideAllBodies`` leaves it ``False``: it materialises CPT bands
        only, so a borehole endpoint with no band is merely waiting for the
        ``DivideBoreholes`` step and is reported as
        :data:`REASON_BOREHOLE_DEFERRED`.  ``DivideBoreholes`` passes ``True``,
        because it IS that step — a borehole still carrying no band once it has
        run has permanently lost the tie and is reported as
        :data:`REASON_BAND_ABSENT`.

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
        review_a: str | None = None
        review_b: str | None = None
        new_a = by_identity.get(tie.identity_a)
        if new_a is None:
            new_a, review_a = _follow_moved_band(tie.identity_a, by_investigation)
        new_b = by_identity.get(tie.identity_b)
        if new_b is None:
            new_b, review_b = _follow_moved_band(tie.identity_b, by_investigation)
        # A class change is the more consequential of the two, so it names the
        # tie when both endpoints are flagged.
        review = (
            REVIEW_CLASS_CHANGED
            if REVIEW_CLASS_CHANGED in (review_a, review_b)
            else review_a or review_b
        )
        if new_a is None or new_b is None:
            plan.lost.append(
                LostTie(
                    tie=tie,
                    reason_a=(
                        None
                        if new_a is not None
                        else _endpoint_reason(
                            tie.identity_a,
                            tie.anchor_kind_a,
                            by_investigation,
                            borehole_bands_are_final=borehole_bands_are_final,
                        )
                    ),
                    reason_b=(
                        None
                        if new_b is not None
                        else _endpoint_reason(
                            tie.identity_b,
                            tie.anchor_kind_b,
                            by_investigation,
                            borehole_bands_are_final=borehole_bands_are_final,
                        )
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
        plan.matched.append(
            MatchedTie(tie=tie, layer_a_id=new_a, layer_b_id=new_b, review_reason=review)
        )

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


async def load_band_identities(
    session: AsyncSession, layer_ids: set[UUID]
) -> dict[UUID, tuple[BandIdentity, str]]:
    """Load the three-part identity + anchor kind of a set of geotech layers.

    ``nad_class`` lives on the band's ``geological_formation``, not on the layer
    row, so the join is mandatory. Shared by the tie re-anchor
    (:class:`GeotechTieReanchor`) and the body-separation re-anchor
    (``body_separation_reanchor``) — both capture a layer id's band identity the
    same way.

    Parameters
    ----------
    session : AsyncSession
        Active session owned by the caller.
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
        await session.execute(
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

    async def capture(
        self,
        geotech_model_id: UUID,
        *,
        restrict_to_anchor_kind: str | None = None,
        restrict_to_investigation_ids: set[UUID] | None = None,
    ) -> list[CapturedTie]:
        """Record every ACCEPTED tie of a geotech model with its bands' identities.

        Must run before the reset: once the layer wipe fires, the endpoints are
        gone and their investigation / depth / class can no longer be read.

        Both restrictions answer the same question — *is this tie at risk from
        the rebuild about to run?* — from the two directions a rebuild can be
        narrowed: by the KIND of column it touches, and by WHICH columns.  A tie
        neither endpoint of which the rebuild touches keeps its row and its
        endpoints, so capturing it would both overstate what the verb carried
        and invite a duplicate on the way back.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model whose accepted ties are captured.
        restrict_to_anchor_kind : str | None
            When given (:data:`ANCHOR_CPT` or :data:`ANCHOR_BOREHOLE`), keep
            only ties with at least one endpoint on that kind of
            investigation.  A rebuild that deletes only the borehole bands
            leaves a CPT↔CPT tie's row untouched, so capturing it would count
            a tie as "carried" that was never at risk.  ``None`` (default)
            captures every accepted tie, which is what a rebuild that wipes
            the whole model needs.
        restrict_to_investigation_ids : set[UUID] | None
            When given, keep only ties with at least one endpoint on one of
            these investigations — the columns a SECTION-SCOPED rebuild is
            about to delete and re-create.  One endpoint is enough: the other
            one's band survives untouched, and the tie is destroyed by the
            cascade all the same.  ``None`` (default) applies no such filter.

        Returns
        -------
        list[CapturedTie]
            One entry per accepted edge whose two endpoints could both be
            resolved.  An edge with an unresolvable endpoint is skipped and
            logged at WARNING — it is already broken and nothing can be carried.
        """
        scope_label = (
            "all"
            if restrict_to_investigation_ids is None
            else str(len(restrict_to_investigation_ids))
        )
        self.debug(
            f"GeotechTieReanchor.capture: model={geotech_model_id} "
            f"restrict_to_anchor_kind={restrict_to_anchor_kind} "
            f"restrict_to_investigations={scope_label}"
        )
        scoped_keys = (
            None
            if restrict_to_investigation_ids is None
            else {str(inv_id) for inv_id in restrict_to_investigation_ids}
        )
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
        out_of_scope = 0
        for edge in edges:
            entry_a = identities.get(edge.layer_a_id)
            entry_b = identities.get(edge.layer_b_id)
            if (
                restrict_to_anchor_kind is not None
                and entry_a is not None
                and entry_b is not None
                and restrict_to_anchor_kind not in (entry_a[1], entry_b[1])
            ):
                # Neither endpoint sits on the kind of column this rebuild
                # touches, so the edge row survives it untouched.
                out_of_scope += 1
                continue
            if (
                scoped_keys is not None
                and entry_a is not None
                and entry_b is not None
                and entry_a[0].investigation_id not in scoped_keys
                and entry_b[0].investigation_id not in scoped_keys
            ):
                # Neither endpoint's column is being rebuilt, so nothing
                # deletes this edge and nothing has to carry it.
                out_of_scope += 1
                continue
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
            f"({unresolved} unresolvable endpoint(s) skipped, "
            f"{out_of_scope} not touched by this rebuild)"
        )
        return captured

    async def surviving_bands(self, geotech_model_id: UUID) -> list[RebuiltBand]:
        """Describe every band the model still holds, read back from the database.

        A section-scoped rebuild deletes only its own columns, so a carried tie
        can have one endpoint on a band that was never touched.  That band is
        not in the rebuild's in-memory layer index — it was not rebuilt — and
        without it the re-anchor would report a perfectly intact tie as lost.
        Reading the model back after the scoped delete gives the matcher the
        whole picture: the survivors here, the fresh rows from the index.

        ⚠ Call this between the delete and the materialisation.  Later, the
        rebuild's own rows have been flushed and would come back here as well
        as in the index, and the matcher would see each of them twice —
        which reads as an ambiguous band and flags a tie that is fine.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model to read.

        Returns
        -------
        list[RebuiltBand]
            One entry per band currently persisted for the model.
        """
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
                .where(LithoLayerOrm.model_id == geotech_model_id)
            )
        ).all()
        return [
            RebuiltBand(
                identity=BandIdentity(
                    investigation_id=str(
                        row.borehole_id if row.borehole_id is not None else row.cpt_id
                    ),
                    depth_top_mm=depth_to_mm(row.depth_top_m),
                    depth_base_mm=depth_to_mm(row.depth_base_m),
                    nad_class=row.nad_class,
                ),
                layer_id=row.id,
            )
            for row in rows
        ]

    async def reanchor(
        self,
        *,
        geotech_model_id: UUID,
        captured: list[CapturedTie],
        rebuilt_bands: list[RebuiltBand],
        borehole_bands_are_final: bool = False,
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
        borehole_bands_are_final : bool, default False
            Whether ``rebuilt_bands`` already carries the borehole columns —
            ``True`` from ``DivideBoreholes``, ``False`` from
            ``SubdivideAllBodies``.  See :func:`plan_tie_reanchor`.

        Returns
        -------
        ReanchorPlan
            Matched / lost / duplicate-skipped counts, with per-reason detail.
        """
        if not captured:
            return ReanchorPlan()

        plan = plan_tie_reanchor(
            captured, rebuilt_bands, borehole_bands_are_final=borehole_bands_are_final
        )

        # Never write a pair that already exists on the section. Nothing should
        # remain at this point (the reset's cascade emptied the edge table for
        # this model), but re-reading is cheap and makes the pass safe to call
        # from anywhere.
        existing = await self._load_existing_keys(geotech_model_id)

        written = 0
        for match in plan.matched:
            tie = match.tie
            section_id, layer_a_id, layer_b_id, side_a, side_b = _canonical_key(
                tie, match.layer_a_id, match.layer_b_id
            )
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
                    # Still accepted: the engineer approved it and has not deleted
                    # it. A flagged tie is one they are asked to confirm, not one
                    # demoted to a proposal — demoting it would make the next
                    # rebuild's dirty-delete pass remove it, which is exactly the
                    # silent disappearance this whole path exists to prevent.
                    user_approved=True,
                    review_reason=match.review_reason,
                )
            )
            written += 1
        await self._session.flush()

        # Name the lost ties for the UI. A count on its own tells the engineer
        # that work vanished and nothing about where to look; the ids in the
        # WARNING lines below only reach a server log (audit 2026-08-02). One
        # extra SELECT, and only when something was actually lost.
        if plan.lost:
            plan.lost_tie_labels = label_lost_ties(
                plan.lost,
                await self._load_investigation_names(
                    {
                        identity.investigation_id
                        for item in plan.lost
                        for identity in (item.tie.identity_a, item.tie.identity_b)
                    }
                ),
            )

        for lost in plan.lost:
            self.warning(f"GeotechTieReanchor.reanchor: tie LOST — {lost.describe()}")

        reasons = plan.loss_reason_counts()
        if plan.lost:
            self.warning(
                f"GeotechTieReanchor.reanchor: {len(plan.lost)} accepted tie(s) could not be "
                f"re-anchored to a rebuilt band — reasons {reasons}"
            )
        reviews = plan.review_reason_counts()
        if reviews:
            # Carried, not lost — but the engineer has to confirm these, so they
            # are worth a WARNING rather than being buried in the summary line.
            self.warning(
                f"GeotechTieReanchor.reanchor: {sum(reviews.values())} accepted tie(s) were "
                f"carried onto a band that is not clearly the one they were drawn on and "
                f"need review — {reviews}"
            )
        self.success(
            f"GeotechTieReanchor.reanchor: model={geotech_model_id} "
            f"re-anchored={written}/{len(captured)} lost={len(plan.lost)} "
            f"needs_review={sum(reviews.values())} "
            f"skipped_duplicate={plan.skipped_duplicate_pair} reasons={reasons}"
        )
        return plan

    async def _load_investigation_names(self, investigation_ids: set[str]) -> dict[str, str]:
        """Resolve investigation ids to the names the engineer sees on screen.

        A band's anchor is a ``cpt`` OR a ``borehole`` row (DB XOR), and the
        caller only has the stringified id, so both tables are queried and the
        results merged.  Ids that resolve to neither are simply absent from the
        mapping — the label falls back to the raw id.

        Parameters
        ----------
        investigation_ids : set[str]
            Stringified CPT / borehole ids.

        Returns
        -------
        dict[str, str]
            Investigation id (stringified) → display name.
        """
        if not investigation_ids:
            return {}
        uuids: list[UUID] = []
        for raw in investigation_ids:
            try:
                uuids.append(UUID(raw))
            except ValueError:
                # Not a UUID at all — nothing to look up; the raw string is
                # still shown by the label helper.
                continue
        if not uuids:
            return {}
        names: dict[str, str] = {}
        for model in (CptOrm, BoreholeOrm):
            rows = (
                await self._session.execute(select(model.id, model.name).where(model.id.in_(uuids)))
            ).all()
            for row in rows:
                names[str(row.id)] = row.name
        return names

    async def _load_band_identities(
        self, layer_ids: set[UUID]
    ) -> dict[UUID, tuple[BandIdentity, str]]:
        """Load the three-part identity + anchor kind of a set of geotech layers.

        Thin instance wrapper around the module-level :func:`load_band_identities`
        — the body-separation re-anchor needs the same query, so the
        implementation is shared rather than copied.

        Parameters
        ----------
        layer_ids : set[UUID]
            Geotech ``litho_layer`` ids.

        Returns
        -------
        dict[UUID, tuple[BandIdentity, str]]
            ``layer_id → (identity, 'cpt' | 'borehole')``.
        """
        return await load_band_identities(self._session, layer_ids)

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

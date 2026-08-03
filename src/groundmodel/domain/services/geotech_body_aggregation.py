"""Pure policy-B body-subdivision aggregator (spec §0.1).

Given each CPT member's A3 packing-band profile for one
``(litho body_id, geo_formation_id)`` group, decide whether the body splits into
connected vertical sub-bodies (consensus on the ordered band-class sequence) or
carries one representative NAD class (lateral-only variation). Pure: no I/O.
Consensus is the exact band-class sequence after A3's min-thickness merge, with a
shorter sequence allowed to prefix-match a longer one (the too-shallow case;
spec §0.1 step 2, v1 default — the real-data eval is the arbiter on tightening).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from groundmodel.domain.services.geotech_subdivision import GeotechSplit

# Where an unclassified ("needs review") band sorts in the thickness tie-break.
# Above every real NAD class (1–31) so a tie resolves to the flag rather than to
# a class nobody derived — see :func:`_thickness_weighted_dominant`.
_NEEDS_REVIEW_TIE_RANK: float = float("inf")


@dataclass(frozen=True)
class BandProfile:
    """One CPT member's ordered packing bands within a body group.

    Parameters
    ----------
    investigation_id : str
        CPT id (string, matching ``BodyLayerPick.investigation_id``).
    splits : list[GeotechSplit]
        Ordered top-to-base packing bands from ``suggest_geotech_subdivision``.
    """

    investigation_id: str
    splits: list[GeotechSplit]


@dataclass(frozen=True)
class BodySubdivisionPlan:
    """The decided subdivision for one body group.

    Parameters
    ----------
    consistent : bool
        True -> split into ``len(band_classes)`` connected sub-bodies (one per
        band position). False -> one representative class for the whole body.
    band_classes : list[int | None]
        NAD class per band position (length 1 when not consistent or
        borehole-only; the single entry is ``None`` for a borehole-only group).
    """

    consistent: bool
    band_classes: list[int | None]


def _sequences_consistent(sequences: list[list[int | None]]) -> bool:
    """True iff every sequence is a prefix of the longest (shared ordering).

    Compared by equality only, so an unclassified (``None``) band position is
    just another value: two CPTs both reading "no usable qc" at position 0
    agree there, and one that read a class there does not.

    Parameters
    ----------
    sequences : list[list[int | None]]
        Per-CPT ordered NAD class sequences; ``None`` where the qc gave no
        class.

    Returns
    -------
    bool
        ``True`` when all sequences agree on a common prefix order.
    """
    if not sequences:
        return True
    longest = max(sequences, key=len)
    return all(longest[: len(seq)] == seq for seq in sequences)


def _thickness_weighted_dominant(splits: list[GeotechSplit]) -> int | None:
    """Mode NAD class by summed thickness; tie-break to the denser (higher) class.

    ``None`` is a real member of the pool, not an absence: it is the answer
    ``suggest_geotech_subdivision`` gives when there is no usable qc over the
    band's interval — "needs review", never a guessed class. Two consequences,
    both deliberate:

    * **Thickness still decides.** A thin unclassified sliver beside a much
      thicker classified band does not veto it; the body carries the class most
      of it reads. That is the ordinary geometry the ``None`` case covers — a
      contact placed above the CPT's first sample, or a sliver from the
      geo-bounding divide.
    * **On an exact tie, needs-review wins** (``_NEEDS_REVIEW_TIE_RANK``).
      Asserting a packing class over a body half of which has no evidence hides
      the gap from the engineer, and the flagged band is the cheaper error: he
      can confirm it, whereas a plausible class is never questioned again.

    Without an explicit rank ``None`` also cannot be *compared* at all — the
    tuple key falls through to ``None < int`` and raises ``TypeError``.

    Parameters
    ----------
    splits : list[GeotechSplit]
        One or more packing splits to aggregate.

    Returns
    -------
    int | None
        The NAD class with the greatest total thickness, or ``None`` when the
        unclassified bands carry that thickness. On a tie, the higher (denser)
        class wins among classified bands, and ``None`` wins over all of them.
    """
    by_class: dict[int | None, float] = defaultdict(float)
    for s in splits:
        by_class[s.nad_class] += max(s.depth_base_m - s.depth_top_m, 0.0)
    return max(
        by_class.items(),
        key=lambda kv: (kv[1], _NEEDS_REVIEW_TIE_RANK if kv[0] is None else kv[0]),
    )[0]


def plan_body_subdivision(profiles: list[BandProfile]) -> BodySubdivisionPlan:
    """Decide the subdivision for one body group (spec §0.1 steps 2 + 4).

    Filters out profiles with no splits (borehole-only investigations), then
    checks whether the remaining CPT sequences share a common prefix ordering.
    Consistent -> split at each band position with the thickness-weighted
    dominant class per position. Not consistent -> one representative class for
    the whole body (thickness-weighted dominant across all splits, tie-break to
    the denser class).

    Parameters
    ----------
    profiles : list[BandProfile]
        One per CPT member of the group (boreholes contribute no profile and
        are represented as ``BandProfile`` instances with an empty ``splits``
        list, or simply absent from the list).

    Returns
    -------
    BodySubdivisionPlan
        The consistent-split-vs-one-class decision and per-position NAD classes.
        When ``profiles`` is empty (borehole-only group), returns
        ``consistent=True, band_classes=[None]``.
    """
    cpt_profiles = [p for p in profiles if p.splits]
    if not cpt_profiles:
        return BodySubdivisionPlan(consistent=True, band_classes=[None])

    sequences: list[list[int | None]] = [[s.nad_class for s in p.splits] for p in cpt_profiles]
    if _sequences_consistent(sequences):
        longest_len = max(len(seq) for seq in sequences)
        band_classes: list[int | None] = []
        for k in range(longest_len):
            pool = [p.splits[k] for p in cpt_profiles if k < len(p.splits)]
            band_classes.append(_thickness_weighted_dominant(pool))
        return BodySubdivisionPlan(consistent=True, band_classes=band_classes)

    all_splits = [s for p in cpt_profiles for s in p.splits]
    return BodySubdivisionPlan(
        consistent=False, band_classes=[_thickness_weighted_dominant(all_splits)]
    )

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


def _sequences_consistent(sequences: list[list[int]]) -> bool:
    """True iff every sequence is a prefix of the longest (shared ordering).

    Parameters
    ----------
    sequences : list[list[int]]
        Per-CPT ordered NAD class sequences.

    Returns
    -------
    bool
        ``True`` when all sequences agree on a common prefix order.
    """
    if not sequences:
        return True
    longest = max(sequences, key=len)
    return all(longest[: len(seq)] == seq for seq in sequences)


def _thickness_weighted_dominant(splits: list[GeotechSplit]) -> int:
    """Mode NAD class by summed thickness; tie-break to the denser (higher) class.

    Parameters
    ----------
    splits : list[GeotechSplit]
        One or more packing splits to aggregate.

    Returns
    -------
    int
        The NAD class with the greatest total thickness; on a tie, the higher
        (denser) class wins.
    """
    by_class: dict[int, float] = defaultdict(float)
    for s in splits:
        by_class[s.nad_class] += max(s.depth_base_m - s.depth_top_m, 0.0)
    return sorted(by_class.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)[0][0]


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

    sequences = [[s.nad_class for s in p.splits] for p in cpt_profiles]
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

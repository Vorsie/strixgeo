"""Geotech NAD subdivision suggester — packing splits within one litho segment.

Reuses the litho segmenter's smoothing/RLE/merge helpers but classifies on RAW
qc via :func:`classify_nad` (no Dr, no Robertson, no σ′v). Heavy smoothing is
an in-memory split helper only (spec §1, §4 Step B); it never persists.
"""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.services.litho_segmentation import (
    _greedy_merge,
    _rolling_median_zones,
    _run_length_encode,
)
from groundmodel.domain.services.nad_classification_constants import NAD_QC_BANDS
from groundmodel.domain.services.nad_classifier import _variant_for, classify_nad
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.litho_constants import BaseLithology

# Smoothing half-window in samples — heavier than the litho default so single
# spikes/drops do not trigger spurious packing splits (spec §1). In-memory only.
# 5 half-window samples ≈ 10 cm at a 2 cm CPT increment / ≈ 25 cm at 5 cm —
# re-derive if the CPT resolution assumption changes.
_SMOOTH_HALF_WINDOW = 5


def _persistence_filter(mask: list[bool], persist: int) -> list[bool]:
    """Flip interior runs shorter than ``persist`` samples to the preceding value.

    Run-length scans ``mask`` and, for any interior run shorter than ``persist``
    samples, adopts the value of the run before it. Edge runs (first/last) are
    never flipped — they have no anchor. This is the "ignore a small dip/spike"
    rule: a brief excursion across a qc threshold no longer moves a boundary.

    Parameters
    ----------
    mask : list[bool]
        Per-sample boolean (e.g. ``qc >= threshold``).
    persist : int
        Minimum run length (samples) to survive; shorter interior runs flip.

    Returns
    -------
    list[bool]
        The persistence-filtered mask, same length as ``mask``.
    """
    n = len(mask)
    if n == 0:
        return []
    runs: list[list[int]] = []  # [value(0/1), start, end_exclusive]
    s = 0
    for j in range(1, n):
        if mask[j] != mask[s]:
            runs.append([int(mask[s]), s, j])
            s = j
    runs.append([int(mask[s]), s, n])
    for i in range(len(runs)):
        _v, a, b = runs[i]
        if (b - a) < persist and 0 < i < len(runs) - 1:
            runs[i][0] = runs[i - 1][0]
    out = [False] * n
    for v, a, b in runs:
        for k in range(a, b):
            out[k] = bool(v)
    return out


def _median_increment(depths: list[float]) -> float:
    """Median sample spacing (m). Falls back to 0.02 m for a degenerate series."""
    diffs = [b - a for a, b in zip(depths, depths[1:]) if b > a]
    if not diffs:
        return 0.02
    diffs.sort()
    return diffs[len(diffs) // 2]


def _sustained_threshold_cuts(
    depths: list[float],
    qc: list[float],
    soil: BaseLithology,
    admixtures: tuple[Admixture, ...],
    min_thickness_m: float,
) -> list[float]:
    """Boundary depths where qc *sustainably* crosses each NAD band threshold.

    For every finite qc upper-bound of the soil's NAD column, the raw-qc
    ``>= bound`` mask is persistence-filtered (a crossing must hold for
    ``min_thickness_m`` to count), and each surviving transition contributes a
    cut depth. The window top and bottom are always cuts.

    Parameters
    ----------
    depths, qc : list[float]
        Parallel sample series already restricted to the segment.
    soil : BaseLithology
        Segment soil (fixes the NAD column + thresholds).
    admixtures : tuple[Admixture, ...]
        Segment admixtures (pick clean vs secondary NAD variant).
    min_thickness_m : float
        Persistence length — a crossing must hold this long to place a cut.

    Returns
    -------
    list[float]
        Sorted, de-duplicated cut depths (always includes the window ends).
    """
    if not depths:
        return []
    persist = max(1, round(min_thickness_m / _median_increment(depths)))
    variant = _variant_for(soil, admixtures)
    thresholds = [u for u, _c in NAD_QC_BANDS[(soil, variant)] if u is not None]
    cuts: set[float] = {depths[0], depths[-1]}
    for thr in thresholds:
        above = _persistence_filter([q >= thr for q in qc], persist)
        for j in range(1, len(above)):
            if above[j] != above[j - 1]:
                cuts.add(depths[j])
    return sorted(cuts)


def _conservative_merge(bands: list[list[float]], min_thickness_m: float) -> list[list[float]]:
    """Absorb sub-min bands into their LOWER-density (lower NAD class) neighbour.

    Within one soil family the NAD class number is ordered loose->dense /
    weak->firm, so the lower number is the weaker class. Absorbing a thin band
    into the weaker neighbour makes the weaker class claim a threshold-oscillation
    zone — the conservative placement the owner asked for. Mutates a copy.

    Parameters
    ----------
    bands : list[list[float]]
        ``[top_m, base_m, nad_class]`` bands, ordered top-to-bottom, contiguous.
    min_thickness_m : float
        Minimum band thickness; thinner bands are absorbed.

    Returns
    -------
    list[list[float]]
        Bands all >= ``min_thickness_m`` (unless only one remains).
    """
    out = [list(b) for b in bands]
    changed = True
    while changed and len(out) > 1:
        changed = False
        for i, (top, base, _cls) in enumerate(out):
            if (base - top) >= min_thickness_m:
                continue
            prev = out[i - 1] if i > 0 else None
            nxt = out[i + 1] if i < len(out) - 1 else None
            candidates = [c for c in (prev, nxt) if c is not None]
            target = min(candidates, key=lambda c: c[2])  # lowest NAD class wins
            if target is prev:
                out[i - 1][1] = base  # extend prev's base over the thin band
            else:
                out[i + 1][0] = top  # extend next's top over the thin band
            del out[i]
            changed = True
            break
    return out


def _weld_same_class_bands(bands: list[list[float]]) -> list[list[float]]:
    """Weld adjacent bands of equal NAD class into one contiguous band."""
    if not bands:
        return []
    out = [list(bands[0])]
    for top, base, cls in bands[1:]:
        if cls == out[-1][2]:
            out[-1][1] = base
        else:
            out.append([top, base, cls])
    return out


@dataclass(frozen=True)
class GeotechSplit:
    """One suggested NAD sub-unit within a geo-bounded litho segment.

    Parameters
    ----------
    depth_top_m : float
        Top depth of the sub-unit (metres, positive down), clamped to the
        parent segment top.
    depth_base_m : float
        Base depth of the sub-unit (metres, positive down), clamped to the
        parent segment base.
    nad_class : int
        Classified NAD packing class 1–31.
    """

    depth_top_m: float
    depth_base_m: float
    nad_class: int


def suggest_geotech_subdivision(
    soil: BaseLithology,
    admixtures: tuple[Admixture, ...],
    depth_m: list[float],
    qc_mpa: list[float],
    segment_top_m: float,
    segment_base_m: float,
    min_thickness_m: float,
) -> list[GeotechSplit]:
    """Suggest NAD sub-units for one geo-bounded litho segment.

    Classifies each CPT sample inside the segment via :func:`classify_nad`,
    applies a rolling-median smoother to suppress single-point spikes, then
    run-length encodes and merges runs shorter than ``min_thickness_m``.
    Returns one :class:`GeotechSplit` per surviving packing run. A uniform
    segment (or one with only thin variation) returns a single split spanning
    the entire segment.

    Parameters
    ----------
    soil : BaseLithology
        Main soil type of the parent litho unit.
    admixtures : tuple[Admixture, ...]
        Parent unit admixtures; drives the clean/secondary NAD variant lookup.
    depth_m : list[float]
        Full CPT depth series (metres, positive down). Samples outside
        ``[segment_top_m, segment_base_m]`` are ignored.
    qc_mpa : list[float]
        Cone resistance in MPa, one value per entry in ``depth_m``.
    segment_top_m : float
        Top bound of the geo-bounded litho segment (metres).
    segment_base_m : float
        Base bound of the geo-bounded litho segment (metres).
    min_thickness_m : float
        Minimum sub-unit thickness; runs thinner than this are absorbed into
        their neighbour by :func:`_greedy_merge`.

    Returns
    -------
    list[GeotechSplit]
        One split per surviving packing run, ordered top-to-bottom. Never
        empty — falls back to a single split covering the full segment when
        no CPT samples fall inside it (qc=0.0 → loosest NAD class for the
        soil type).

    Raises
    ------
    ValueError
        If ``depth_m`` and ``qc_mpa`` have different lengths.
    """
    if len(depth_m) != len(qc_mpa):
        raise ValueError(
            f"depth_m ({len(depth_m)}) and qc_mpa ({len(qc_mpa)}) must have equal length."
        )

    # --- filter to samples inside [segment_top_m, segment_base_m] ----------
    pairs = [
        (d, q)
        for d, q in zip(depth_m, qc_mpa)
        if segment_top_m - 1e-9 <= d <= segment_base_m + 1e-9
    ]

    if not pairs:
        # No CPT samples in this segment (e.g. borehole-only column): qc=0.0 →
        # loosest NAD class for the soil; one fallback unit spanning the segment,
        # never empty.
        fallback = classify_nad(soil, admixtures, 0.0)
        return [GeotechSplit(segment_top_m, segment_base_m, fallback)]

    seg_depths: list[float] = [d for d, _q in pairs]
    seg_qc: list[float] = [q for _d, q in pairs]

    # --- classify, smooth, RLE, merge -------------------------------------
    classes: list[int] = [classify_nad(soil, admixtures, q) for q in seg_qc]
    smoothed = _rolling_median_zones(classes, _SMOOTH_HALF_WINDOW)
    runs = _run_length_encode(smoothed)

    # _greedy_merge takes the actual depth values (not sample counts) and a
    # float min thickness — no conversion needed.
    runs = _greedy_merge(runs, seg_depths, min_thickness_m)

    # _greedy_merge can absorb a thin run that sat BETWEEN two runs of the same
    # NAD class into one side, leaving two adjacent same-class runs (e.g.
    # dense / [thin medium absorbed] / dense → dense / dense). Collapse those so
    # each packing class renders as a single band. This runs PER geo-bounded
    # litho segment (one suggest_geotech_subdivision call == one segment), so it
    # can never merge across a geological or lithological boundary — those are
    # separate segments / separate calls.
    runs = _merge_adjacent_same_class(runs)

    # --- assemble GeotechSplit list ---------------------------------------
    splits: list[GeotechSplit] = []
    for i, (cls, start, end) in enumerate(runs):
        top = segment_top_m if i == 0 else seg_depths[start]
        # end is exclusive (RLE convention: [start, end)); the last sample of
        # this run is at index end-1, and the next run starts at end.
        # Use seg_depths[end] as the boundary depth when not the final run,
        # matching the convention that a run's base == the next run's top.
        base = segment_base_m if i == len(runs) - 1 else seg_depths[end]
        splits.append(GeotechSplit(round(top, 3), round(base, 3), int(cls)))  # type: ignore[arg-type]

    return splits


def _merge_adjacent_same_class(
    runs: list[tuple[int | None, int, int]],
) -> list[tuple[int | None, int, int]]:
    """Collapse consecutive runs that share the same NAD class into one run.

    ``_greedy_merge`` absorbs a thin run into a neighbour but never re-checks
    whether that leaves two same-class runs adjacent (e.g. a thin *medium* band
    between two *dense* bands is absorbed, yielding ``dense / dense``). This pass
    welds such pairs so each packing class is one contiguous band.

    Operates on a single geo-bounded litho segment's runs (one
    :func:`suggest_geotech_subdivision` call), so it cannot weld across a
    geological or lithological boundary — distinct segments are distinct calls.

    Parameters
    ----------
    runs : list[tuple[int | None, int, int]]
        RLE runs ``(nad_class, start_idx, end_idx_exclusive)`` after greedy
        merge, ordered top-to-bottom.

    Returns
    -------
    list[tuple[int | None, int, int]]
        Runs with adjacent same-class runs welded; the index span of a welded
        run covers ``(first.start, last.end)``.
    """
    if not runs:
        return runs
    merged: list[tuple[int | None, int, int]] = [runs[0]]
    for cls, start, end in runs[1:]:
        prev_cls, prev_start, _prev_end = merged[-1]
        if cls == prev_cls:
            # Weld: extend the previous run's exclusive end to this run's end.
            merged[-1] = (prev_cls, prev_start, end)
        else:
            merged.append((cls, start, end))
    return merged

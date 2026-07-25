"""Geotech NAD subdivision suggester — packing splits within one litho segment.

Uses a conservative per-threshold cut pipeline: sustained crossings place band
boundaries, each band is classified by its median qc (robust to spikes), thin
bands absorb into the weaker neighbour, and an optional gradient snap sharpens
contacts without ever making the placement less conservative.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from statistics import median

from groundmodel.domain.services.nad_classification_constants import NAD_QC_BANDS
from groundmodel.domain.services.nad_classifier import _variant_for, classify_nad
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.litho_constants import BaseLithology

# Owner rule (2026-07-25): a unit is flagged "needs review" (no guessed NAD class)
# rather than classified when its valid-qc coverage is too thin — EITHER a large
# fraction of the unit thickness has no valid qc OR there is a long continuous gap
# with no valid qc. Isolated bad samples at CPT density stay well under both bounds,
# so a single dropout never flags. Kept next to their sole caller (they encode this
# service's policy, not a shared vocabulary).
QC_REVIEW_MISSING_FRACTION = 0.40  # >40% of unit thickness lacking valid qc → review
QC_REVIEW_MAX_GAP_M = 0.05  # a continuous ≥5 cm span with no valid qc → review


def _is_valid_qc(q: float | None) -> bool:
    """True when a cone-resistance sample is usable: present, finite, non-negative.

    Parameters
    ----------
    q : float | None
        A single qc sample (MPa). ``None`` models a GEF/DOV void reading.

    Returns
    -------
    bool
        ``False`` for ``None``, NaN, ±inf, or a negative value; else ``True``.
    """
    return q is not None and math.isfinite(q) and q >= 0.0


def _missing_qc_coverage(
    in_range: list[tuple[float, float | None]],
    segment_top_m: float,
    segment_base_m: float,
) -> tuple[float, float]:
    """Measure how much of a segment lacks valid qc, from its in-range samples.

    Coverage is judged only over the depth span the CPT actually reaches (first to
    last in-range sample): a gap is the depth between two consecutive *valid* samples
    beyond the nominal sample spacing — i.e. the stretch a dropout/void run leaves
    with no usable reading. Sub-CPT-coverage at the segment ends is NOT counted as
    missing (that is coverage limit, not corrupt data).

    Parameters
    ----------
    in_range : list[tuple[float, float | None]]
        ``(depth_m, qc_mpa)`` samples inside the segment, any validity.
    segment_top_m, segment_base_m : float
        Segment bounds (metres); used only for the thickness denominator.

    Returns
    -------
    tuple[float, float]
        ``(missing_fraction, max_gap_m)`` — the summed gap length as a fraction of
        segment thickness, and the single longest continuous gap (metres). When no
        sample carries valid qc, returns ``(1.0, thickness)`` (fully missing).
    """
    thickness = max(segment_base_m - segment_top_m, 1e-9)
    valid_depths = sorted(d for d, q in in_range if _is_valid_qc(q))
    if not valid_depths:
        return 1.0, thickness
    nominal = _median_increment([d for d, _q in in_range])
    total_missing = 0.0
    max_gap = 0.0
    for a, b in zip(valid_depths, valid_depths[1:]):
        gap = (b - a) - nominal  # depth with no valid reading beyond normal spacing
        if gap > 0.0:
            total_missing += gap
            max_gap = max(max_gap, gap)
    return total_missing / thickness, max_gap


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


def _gradient_snap(
    bands: list[list[float]],
    depths: list[float],
    qc: list[float],
    window_m: float,
    min_thickness_m: float,
) -> list[list[float]]:
    """Snap each interior boundary to a nearby sharp |dqc/dz| peak, conservatively.

    A snap is applied only when it does NOT make the boundary less conservative:
    for a densifying boundary (weaker class above, denser below) a snap may move
    the boundary deeper (weaker holds longer) but never shallower; for a softening
    boundary the reverse. Re-runs the conservative merge + weld afterward.

    Parameters
    ----------
    bands : list[list[float]]
        ``[top, base, nad_class]`` bands after Step 4.
    depths, qc : list[float]
        Segment sample series.
    window_m : float
        Max distance a boundary may snap.
    min_thickness_m : float
        Re-applied to keep bands valid after snapping.

    Returns
    -------
    list[list[float]]
        Bands with eligible interior boundaries snapped.
    """
    if len(bands) < 2 or len(depths) < 3:
        return bands
    # |dqc/dz| via central differences on RAW qc. Spec §5 wrote "lightly-smoothed
    # qc"; smoothing is intentionally skipped here because the 92nd-percentile peak
    # threshold below already suppresses single-sample spikes, and the owner's
    # validated prototype used raw qc. Revisit only if a spike-heavy CPT triggers
    # a false snap.
    grad = [0.0] * len(depths)
    for i in range(1, len(depths) - 1):
        dz = depths[i + 1] - depths[i - 1]
        grad[i] = abs((qc[i + 1] - qc[i - 1]) / dz) if dz > 1e-9 else 0.0
    ordered = sorted(g for g in grad if g > 0.0)
    if not ordered:
        return bands
    # Index into the ascending gradients at the 92nd percentile. A snap needs
    # >= 5 samples (the peaks loop scans range(2, n-2)), by which point `ordered`
    # is large enough that this rank approximates the percentile; on a tiny series
    # it lands low, but the empty peaks loop then makes the threshold moot.
    thr = ordered[int(0.92 * (len(ordered) - 1))]
    peaks = [
        depths[i]
        for i in range(2, len(grad) - 2)
        if grad[i] > thr and grad[i] >= grad[i - 1] and grad[i] >= grad[i + 1]
    ]
    for k in range(len(bands) - 1):
        d = bands[k][1]  # boundary between band k (above) and k+1 (below)
        densifying = bands[k + 1][2] > bands[k][2]
        near = [p for p in peaks if abs(p - d) <= window_m]
        if not near:
            continue
        peak = min(near, key=lambda p: abs(p - d))
        more_conservative = (peak > d) if densifying else (peak < d)
        if more_conservative:
            # In-place: update both sides of the shared boundary. The next
            # iteration (k+1) reads bands[k+1][1] (its base), not the [0] we just
            # set, so there is no read-of-mutated-value hazard; the trailing
            # merge+weld repairs any sub-min or same-class artefact a snap creates.
            bands[k][1] = peak
            bands[k + 1][0] = peak
    return _weld_same_class_bands(_conservative_merge(bands, min_thickness_m))


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
    nad_class : int | None
        Classified NAD packing class 1–31, or ``None`` when the unit's qc is
        missing/invalid over a material span and it is flagged "needs review"
        rather than assigned a guessed class (owner rule 2026-07-25).
    """

    depth_top_m: float
    depth_base_m: float
    nad_class: int | None


def suggest_geotech_subdivision(
    soil: BaseLithology,
    admixtures: tuple[Admixture, ...],
    depth_m: list[float],
    qc_mpa: Sequence[float | None],
    segment_top_m: float,
    segment_base_m: float,
    min_thickness_m: float,
    *,
    gradient_snap: bool = True,
    gradient_snap_window_m: float = 0.5,
) -> list[GeotechSplit]:
    """Suggest NAD sub-units for one geo-bounded litho segment.

    Uses a conservative per-threshold cut pipeline: sustained qc crossings
    place band boundaries, each band is classified by its median qc (robust to
    spikes), thin bands absorb into the weaker neighbour, and an optional
    gradient snap sharpens contacts without ever making the placement less
    conservative. Returns one :class:`GeotechSplit` per surviving packing band.
    A uniform segment (or one with only thin variation) returns a single split
    spanning the entire segment.

    Parameters
    ----------
    soil : BaseLithology
        Main soil type of the parent litho unit.
    admixtures : tuple[Admixture, ...]
        Parent unit admixtures; drives the clean/secondary NAD variant lookup.
    depth_m : list[float]
        Full CPT depth series (metres, positive down). Samples outside
        ``[segment_top_m, segment_base_m]`` are ignored.
    qc_mpa : Sequence[float | None]
        Cone resistance in MPa, one value per entry in ``depth_m``. Void/invalid
        readings (``None``, NaN, negative) are dropped before classification.
    segment_top_m : float
        Top bound of the geo-bounded litho segment (metres).
    segment_base_m : float
        Base bound of the geo-bounded litho segment (metres).
    min_thickness_m : float
        Minimum sub-unit thickness; thinner bands absorb into the weaker
        neighbour via :func:`_conservative_merge`.
    gradient_snap : bool, optional
        When ``True`` (default), snap interior boundaries toward nearby sharp
        ``|dqc/dz|`` peaks, subject to the conservative-placement constraint
        (a densifying boundary may only move deeper; a softening boundary may
        only move shallower). Pass ``False`` to disable for deterministic unit
        tests that assert exact band sequences.
    gradient_snap_window_m : float, optional
        Maximum distance (metres) an interior boundary may snap toward a
        gradient peak. Default 0.5 m.

    Returns
    -------
    list[GeotechSplit]
        One split per surviving packing band, ordered top-to-bottom. Never
        empty. Two special single-split cases (owner rule 2026-07-25):
        no CPT samples at all in the segment (borehole-only) → one loosest-class
        band (qc=0.0 fallback); missing/invalid qc over a material span (>40% of
        thickness OR a ≥5 cm continuous gap) → one ``nad_class=None`` band flagged
        "needs review" rather than a guessed class. Isolated bad samples are
        dropped and the unit is classified from the remaining good qc.

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
    in_range: list[tuple[float, float | None]] = [
        (d, q)
        for d, q in zip(depth_m, qc_mpa)
        if segment_top_m - 1e-9 <= d <= segment_base_m + 1e-9
    ]

    if not in_range:
        # No CPT samples at all in this segment (e.g. borehole-only column): qc=0.0
        # → loosest NAD class for the soil; one fallback unit spanning the segment,
        # never empty.
        fallback = classify_nad(soil, admixtures, 0.0)
        return [GeotechSplit(segment_top_m, segment_base_m, fallback)]

    # The CPT reaches here, but some qc may be void/NaN/negative. Drop the bad
    # samples and classify from the good ones (owner rule 2026-07-25). If the
    # missing/invalid qc spans a material fraction of the unit OR leaves a long
    # continuous gap, do NOT guess a class — flag the whole unit "needs review".
    missing_fraction, max_gap_m = _missing_qc_coverage(in_range, segment_top_m, segment_base_m)
    if missing_fraction > QC_REVIEW_MISSING_FRACTION or max_gap_m >= QC_REVIEW_MAX_GAP_M:
        return [GeotechSplit(segment_top_m, segment_base_m, None)]

    valid = [(d, q) for d, q in in_range if _is_valid_qc(q)]
    seg_depths: list[float] = [d for d, _q in valid]
    seg_qc: list[float] = [q for _d, q in valid if q is not None]

    # 1. Sustained per-threshold crossings -> cut depths (conservative placement).
    cuts = _sustained_threshold_cuts(seg_depths, seg_qc, soil, admixtures, min_thickness_m)

    # 2. Bands between consecutive cuts, each classified by its MEDIAN qc (robust
    #    to spikes without the harmonic over-suppression).
    bands: list[list[float]] = []
    for a, b in zip(cuts, cuts[1:]):
        # Half-open [a, b): the cut at depths[-1] == segment_base_m is excluded
        # from the deepest band. At typical CPT densities (tens of samples per
        # band) that one boundary sample has a negligible effect on the median;
        # the degenerate single-sample case is caught by the `if not bands` fallback.
        in_band = [q for d, q in zip(seg_depths, seg_qc) if a <= d < b]
        if not in_band:
            continue
        cls = classify_nad(soil, admixtures, median(in_band))
        bands.append([a, b, cls])
    if not bands:  # degenerate (e.g. single sample) — one band over the segment
        bands = [[segment_top_m, segment_base_m, classify_nad(soil, admixtures, median(seg_qc))]]

    # 3. Conservative min-thickness merge (thin -> weaker neighbour) + 4. weld.
    bands = _weld_same_class_bands(_conservative_merge(bands, min_thickness_m))

    # 5. Optional bounded gradient snap (sharpens real contacts, never less conservative).
    if gradient_snap:
        bands = _gradient_snap(bands, seg_depths, seg_qc, gradient_snap_window_m, min_thickness_m)

    # Clamp the outer edges to the fixed litho-segment bounds, then emit.
    bands[0][0] = segment_top_m
    bands[-1][1] = segment_base_m
    return [GeotechSplit(round(top, 3), round(base, 3), int(cls)) for top, base, cls in bands]

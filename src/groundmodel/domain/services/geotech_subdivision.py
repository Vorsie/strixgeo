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

from groundmodel.domain.services.nad_classification_constants import NAD_QC_BANDS, Variant
from groundmodel.domain.services.nad_classifier import _variant_for, classify_nad
from groundmodel.domain.services.representative_statistic import (
    DEFAULT_STATISTIC,
    representative_qc,
)
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.litho_constants import BaseLithology

# Owner rule (2026-07-25): a unit is flagged "needs review" (no guessed NAD class)
# rather than classified when its valid-qc coverage is too thin — EITHER a large
# fraction of the unit thickness has no valid qc OR there is a long continuous gap
# with no valid qc. Isolated bad samples at CPT density stay well under both bounds,
# so a single dropout never flags. Kept next to their sole caller (they encode this
# service's policy, not a shared vocabulary).
QC_REVIEW_MISSING_FRACTION = 0.40  # >40% of unit thickness lacking valid qc → review
QC_REVIEW_MAX_GAP_M = 0.05  # a ≥5 cm continuous RUN of bad readings → review

# Re-derive-then-weld runs to a fixed point, and every weld strictly reduces the band
# count, so it reaches one in at most as many passes as there are bands. The cap is a
# backstop against a future weld rule that could oscillate rather than a tuning knob:
# if it is ever hit, the pair is not converging and that is a bug, not a slow case.
_REDERIVE_MAX_PASSES = 12


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

    The two review rules measure two different things, so this returns two
    independently-derived numbers:

    * ``max_gap_m`` — the depth actually SPANNED by a run of bad readings, first
      invalid sample to last invalid sample of that run. Measuring the run itself
      (rather than the distance between the valid samples bracketing it) is what
      makes the owner's rule "one isolated bad point never flags a unit" hold at
      every sample spacing: a single dropout spans 0 m whether the CPT logs at
      2 cm or at 20 cm. Under the old spacing-relative formula the same single
      dropout on a 5 cm logger measured exactly 5 cm and voided the whole unit.
    * ``missing_fraction`` — how much of the unit's thickness has NO reading,
      accumulated PER INVALID SAMPLE (each one covers its own nominal sample
      interval). Deriving this from the run span too would make scattered
      dropouts free: a cone returning every other sample void has runs of length
      one, span 0 m, and would score 0 % missing while having given the engineer
      half a unit's worth of data.

    Only samples the cone wrote and the validator rejected count; a stretch the
    cone simply did not sample (a coarser logging interval, a rod-change depth
    jump, an electric→mechanical increment change mid-test) contributes nothing,
    because nothing there is corrupt. That exemption is automatic — unsampled
    ground has no samples here to count — and it is the ONLY end-of-segment
    exemption: a recorded-but-invalid run at either end counts like any other
    (audit F12 — the old code skipped leading runs and never flushed trailing
    ones, so a bottom-of-unit sensor failure classified confidently where the
    owner's >40 % rule demanded review).

    Parameters
    ----------
    in_range : list[tuple[float, float | None]]
        ``(depth_m, qc_mpa)`` samples inside the segment, any validity.
    segment_top_m, segment_base_m : float
        Segment bounds (metres); used only for the thickness denominator.

    Returns
    -------
    tuple[float, float]
        ``(missing_fraction, max_gap_m)`` — the summed nominal interval of the
        invalid samples as a fraction of segment thickness, and the single longest
        continuous run span (metres). When no sample carries valid qc, returns
        ``(1.0, thickness)`` (fully missing).
    """
    thickness = max(segment_base_m - segment_top_m, 1e-9)
    if not any(_is_valid_qc(q) for _d, q in in_range):
        return 1.0, thickness
    ordered = sorted(in_range, key=lambda dq: dq[0])
    # Each invalid sample stands for one logging interval of unread profile. The
    # median spacing is the honest nominal for that: it is immune to the rod-change
    # jumps and method switches that a mean would smear across the whole unit.
    nominal = _median_increment([d for d, _q in ordered])
    invalid_counted = 0  # invalid samples across every run, edges included
    max_gap = 0.0
    run_start: float | None = None  # depth of the first invalid sample of the run
    run_end: float | None = None  # depth of the last invalid sample seen so far
    run_len = 0  # invalid samples in the run so far
    for depth, q in ordered:
        if _is_valid_qc(q):
            if run_start is not None and run_end is not None:
                max_gap = max(max_gap, run_end - run_start)
                invalid_counted += run_len
            run_start = run_end = None
            run_len = 0
            continue
        if run_start is None:
            run_start = depth
        run_end = depth
        run_len += 1
    # Flush a trailing run: the cone wrote these samples and the validator
    # rejected them, which is corrupt data wherever it sits — the coverage-limit
    # exemption belongs only to depths with no samples at all.
    if run_start is not None and run_end is not None:
        max_gap = max(max_gap, run_end - run_start)
        invalid_counted += run_len
    return min(invalid_counted * nominal / thickness, 1.0), max_gap


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
    *,
    variant_override: Variant | None = None,
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
    variant_override : Variant | None, optional
        The engineer's persisted NAD-family answer, resolved to a column; forces
        which soil column's thresholds are used. ``None`` keeps the
        auto-from-admixtures behaviour.
    min_thickness_m : float
        Sets the persistence length: a crossing must hold for HALF this long to
        place a cut. Half, not the whole (owner ruling 2026-08-11, audit F05):
        with full-thickness persistence a coherent run just under the minimum —
        a real 0.34 m dense seam at the 0.35 m setting — was erased at the
        CUTTER and its material silently upgraded whatever band swallowed it,
        with no decision point anywhere. At half, such a seam becomes a cut
        candidate and the no-silent-upgrade merge decides its fate: absorbed
        where a neighbour's class survives, STANDING as a sub-minimum band for
        the engineer where every absorption would upgrade ("i'd rather get a
        smaller sliver and make the user choose"). Features shorter than half
        the minimum remain noise — filtered here, influencing only the
        representative statistic, which is the harmonic's documented job.

    Returns
    -------
    list[float]
        Sorted, de-duplicated cut depths (always includes the window ends).
    """
    if not depths:
        return []
    persist = max(1, round((min_thickness_m / 2.0) / _median_increment(depths)))
    variant = variant_override if variant_override is not None else _variant_for(soil, admixtures)
    thresholds = [u for u, _c in NAD_QC_BANDS[(soil, variant)] if u is not None]
    cuts: set[float] = {depths[0], depths[-1]}
    for thr in thresholds:
        above = _persistence_filter([q >= thr for q in qc], persist)
        for j in range(1, len(above)):
            if above[j] != above[j - 1]:
                cuts.add(depths[j])
    return sorted(cuts)


def _conservative_merge(
    bands: list[list[float]],
    min_thickness_m: float,
    union_class=None,
) -> list[list[float]]:
    """Absorb sub-min bands — but never in a way that silently upgrades a band.

    Within one soil family the NAD class number is ordered loose->dense /
    weak->firm, so the lower number is the weaker class. The weaker neighbour is
    tried first (the conservative placement the owner asked for) — but a
    neighbour may only take the sliver if the re-derived union does NOT come out
    DENSER than that neighbour's own class. Owner ruling 2026-08-11 (audit F05),
    verbatim: *"this would make a matig zand jump to a dense one, i don't like
    this, in this case i'd rather get a smaller sliver and make the user
    choose"*. So when every neighbour would be upgraded by the absorption, the
    sliver STANDS as its own sub-minimum band and the engineer judges it with
    the shipped band verbs (the merge sheet warns about the class pull — manual
    override always wins). Going LOOSER stays automatic: that is the
    conservative direction the weaker-neighbour rule exists for.

    Mutates a copy.

    Parameters
    ----------
    bands : list[list[float]]
        ``[top_m, base_m, nad_class]`` bands, ordered top-to-bottom, contiguous.
    min_thickness_m : float
        Minimum band thickness; thinner bands are absorption candidates.
    union_class : callable | None
        ``union_class(top_m, base_m) -> int | None`` — the class the union would
        re-derive to (the model's statistic over the joined extent). ``None``
        (legacy callers) restores the unconditional weaker-neighbour absorb; a
        ``None`` RESULT (the union cannot be classified) counts as
        non-upgrading, because no class claim is being made.

    Returns
    -------
    list[list[float]]
        Bands >= ``min_thickness_m`` except the slivers the ruling keeps.
    """
    out = [list(b) for b in bands]
    # ``id(list)`` keys survive the index shifts the deletions cause.
    standing: set[int] = set()
    changed = True
    while changed and len(out) > 1:
        changed = False
        for i, band in enumerate(out):
            top, base, _cls = band
            if (base - top) >= min_thickness_m or id(band) in standing:
                continue
            prev = out[i - 1] if i > 0 else None
            nxt = out[i + 1] if i < len(out) - 1 else None
            # Weaker neighbour first — the original preference, kept.
            candidates = sorted((c for c in (prev, nxt) if c is not None), key=lambda c: c[2])
            target = None
            for cand in candidates:
                if union_class is not None:
                    joined_top = min(cand[0], top)
                    joined_base = max(cand[1], base)
                    union_cls = union_class(joined_top, joined_base)
                    if union_cls is not None and union_cls > cand[2]:
                        continue  # taking the sliver would upgrade this neighbour
                target = cand
                break
            if target is None:
                # Every neighbour would come out denser: the sliver stands for
                # the engineer to judge, and the loop must not revisit it.
                standing.add(id(band))
                continue
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
    union_class=None,
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
    # The same no-silent-upgrade rule as the main pass — without the callback the
    # legacy absorb here would swallow a standing sliver right back (audit F05).
    return _weld_same_class_bands(
        _conservative_merge(bands, min_thickness_m, union_class=union_class)
    )


@dataclass(frozen=True)
class GeotechSplit:
    """One suggested NAD sub-unit within a litho segment.

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


def _class_over(
    seg_depths: list[float],
    seg_qc: list[float],
    top_m: float,
    base_m: float,
    soil: BaseLithology,
    admixtures: tuple[Admixture, ...],
    statistic: str,
    fallback: int | None,
    all_samples: list[tuple[float, float | None]] | None = None,
    variant_override: Variant | None = None,
) -> int | None:
    """Classify one interval from the cone readings inside it.

    Half-open ``[top_m, base_m)``, the same window the hand-edit path samples, and —
    when ``all_samples`` is given — gated by the SAME per-interval coverage
    thresholds the hand-edit path applies, so the build and an edit of the same
    interval cannot disagree (audit F14: the build used to gate once per SEGMENT
    and then classify every band with no local check, so a band classified over
    locally-thin coverage was irrecoverably downgraded to needs-review by any
    touch — merge it, undo, and the restored band came back unanswerable).

    Parameters
    ----------
    seg_depths, seg_qc : list[float]
        The segment's valid readings, parallel.
    top_m, base_m : float
        The interval, metres below the collar.
    soil : BaseLithology
        Main soil of the litho unit — picks the NAD column.
    admixtures : tuple[Admixture, ...]
        Its admixtures — clean versus secondary variant.
    statistic : str
        The model's representative statistic (rulings 6-8).
    fallback : int | None
        Returned when the interval holds no reading at all, or when the readings
        cannot name a class: an interval with nothing in it is not evidence that the
        previous answer was wrong.
    all_samples : list[tuple[float, float | None]] | None
        The segment's raw in-range samples, validity included — what the coverage
        gate judges. ``None`` skips the gate (legacy callers).
    variant_override : Variant | None
        The engineer's persisted NAD-family answer, resolved to a column; forces
        clean vs secondary regardless of ``admixtures``. ``None`` = auto.

    Returns
    -------
    int | None
        The NAD packing class; ``fallback`` for an empty interval; ``None``
        (needs review) when the interval's own coverage fails the thresholds.
    """
    if all_samples is not None:
        window = [(d, q) for d, q in all_samples if top_m <= d < base_m]
        if window:
            missing_fraction, max_gap_m = _missing_qc_coverage(window, top_m, base_m)
            if missing_fraction > QC_REVIEW_MISSING_FRACTION or max_gap_m >= QC_REVIEW_MAX_GAP_M:
                return None
    in_band = [q for d, q in zip(seg_depths, seg_qc) if top_m <= d < base_m]
    if not in_band:
        return fallback
    derived = classify_nad(
        soil,
        admixtures,
        representative_qc(in_band, statistic),
        variant_override=variant_override,
    )
    return fallback if derived is None else derived


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
    statistic: str = DEFAULT_STATISTIC,
    variant_override: Variant | None = None,
) -> list[GeotechSplit]:
    """Suggest NAD sub-units for one litho segment.

    Uses a conservative per-threshold cut pipeline: sustained qc crossings
    place band boundaries, each band is classified by its representative qc
    (the model's chosen statistic — median by default, robust to spikes),
    thin bands absorb into the weaker neighbour, and an optional
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
        Top bound of the litho segment (metres).
    segment_base_m : float
        Base bound of the litho segment (metres).
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
    statistic : str, optional
        The model's representative-qc statistic (owner ruling 7) — one of
        ``REPRESENTATIVE_STATISTICS``. Defaults to ``'median'``, which keeps
        every pre-ruling caller byte-identical. The band-edit previews read
        the SAME model column through :func:`representative_qc`, so the
        warning can never predict a class this classifier does not derive
        (ruling 6).
    variant_override : Variant | None, optional
        The engineer's persisted NAD-family answer (owner ruling 2026-09-04),
        already resolved to a column: ``"clean"`` classifies the whole segment
        into the pure NAD column, ``"secondary"`` into the with-admixture column,
        regardless of the unit's ``admixtures``. ``None`` (default) keeps the
        auto-from-admixtures behaviour, so every pre-ruling caller is unchanged.

    Returns
    -------
    list[GeotechSplit]
        One split per surviving packing band, ordered top-to-bottom. Never
        empty. Two special single-split cases (owner rule 2026-07-25) both
        answer ``nad_class=None`` — a band flagged "needs review", never a
        guessed class: no cone readings at all inside the window, and
        missing/invalid qc over a material span (>40% of thickness OR a ≥5 cm
        continuous gap). Isolated bad samples are dropped and the unit is
        classified from the remaining good qc.

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
        # The cone never read over this window. This function is reached ONLY for
        # CPT segments (subdivide_all_bodies.py filters on anchor_kind == "cpt",
        # and a CPT with no series row is routed to a skeleton band before the
        # call), so "no samples" is never "this is a borehole" — it is a contact
        # placed above the CPT's first sample, or a sliver from the geo-bounding
        # divide. The class is DERIVED FROM qc; with no qc there is nothing to
        # derive it from, so flag the band for review rather than assert the
        # loosest packing class from zero readings. Matches what the band-edit
        # path already answers for the identical condition
        # (geotech_band_reclassification._median_qc_over).
        return [GeotechSplit(segment_top_m, segment_base_m, None)]

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
    cuts = _sustained_threshold_cuts(
        seg_depths,
        seg_qc,
        soil,
        admixtures,
        min_thickness_m,
        variant_override=variant_override,
    )

    # 2. Bands between consecutive cuts, each classified by its REPRESENTATIVE
    #    qc — the model's chosen statistic (ruling 7); median by default,
    #    robust to spikes without the harmonic over-suppression.
    bands: list[list[float]] = []
    for a, b in zip(cuts, cuts[1:]):
        # Half-open [a, b): the cut at depths[-1] == segment_base_m is excluded
        # from the deepest band. At typical CPT densities (tens of samples per
        # band) that one boundary sample has a negligible effect on the median;
        # the degenerate single-sample case is caught by the `if not bands` fallback.
        in_band = [q for d, q in zip(seg_depths, seg_qc) if a <= d < b]
        if not in_band:
            continue
        cls = classify_nad(
            soil,
            admixtures,
            representative_qc(in_band, statistic),
            variant_override=variant_override,
        )
        bands.append([a, b, cls])
    if not bands:  # degenerate (e.g. single sample) — one band over the segment
        bands = [
            [
                segment_top_m,
                segment_base_m,
                classify_nad(
                    soil,
                    admixtures,
                    representative_qc(seg_qc, statistic),
                    variant_override=variant_override,
                ),
            ]
        ]

    # 3. Conservative min-thickness merge (thin -> weaker neighbour) + 4. weld.
    # The union-class probe the no-silent-upgrade rule consults: the same
    # re-derivation (same statistic, same per-interval coverage gate) the final
    # emit runs, so the merge's refusals agree with what step 6 would have said.
    def _union_class(top_m: float, base_m: float) -> int | None:
        return _class_over(
            seg_depths,
            seg_qc,
            top_m,
            base_m,
            soil,
            admixtures,
            statistic,
            None,
            all_samples=in_range,
            variant_override=variant_override,
        )

    bands = _weld_same_class_bands(
        _conservative_merge(bands, min_thickness_m, union_class=_union_class)
    )

    # 5. Optional bounded gradient snap (sharpens real contacts, never less conservative).
    if gradient_snap:
        bands = _gradient_snap(
            bands,
            seg_depths,
            seg_qc,
            gradient_snap_window_m,
            min_thickness_m,
            union_class=_union_class,
        )

    # Reach the fixed litho-segment bounds — honestly (owner ruling 2026-08-11,
    # audit F32, option c). Ground the cone never sampled is not silently claimed:
    # an unread head or tail LONGER than the minimum layer thickness becomes its
    # own needs-review band instead of stretching the nearest class over it, and
    # the engineer decides what it is — by correlating the packing density across
    # columns, under the same 2/1/0 rule as the litho stage (owner: "the user
    # will have to correlate the packing density and make a good decision, the
    # 2/1/0 will stand in geotech stage also"). A shorter gap still stretches to
    # the boundary, so mm-scale under-coverage never litters review tails.
    first_read = seg_depths[0]
    # The unread ground starts one sample spacing BELOW the last reading (the
    # reading covers its own increment) — and the half-open windows then leave
    # the tail genuinely sample-free, so neither the re-derive loop nor the
    # edit path can conjure a class for it from the one boundary sample.
    last_read = min(seg_depths[-1] + _median_increment(seg_depths), segment_base_m)
    if first_read - segment_top_m > min_thickness_m:
        bands[0][0] = first_read
        bands.insert(0, [segment_top_m, first_read, None])
    else:
        bands[0][0] = segment_top_m
    if segment_base_m - last_read > min_thickness_m:
        bands[-1][1] = last_read
        bands.append([last_read, segment_base_m, None])
    else:
        bands[-1][1] = segment_base_m

    # 6. Re-derive every class over the interval the band ACTUALLY ends up with.
    #
    #    Owner ruling 2026-08-10: *"ofcourse it rederives class after boundaries change,
    #    because avg qc changes. if you restore the boundary it is exactly the same as
    #    before so the algorithm behind should ofcourse give it the same class"*.
    #
    #    Steps 3, 4 and 5 all MOVE boundaries — the conservative thin-band merge, the
    #    same-class weld and the gradient snap — and the emit rounds them again. None of
    #    them asked the cone what the new interval says, so a stored class could belong
    #    to an interval the band no longer had: 33 of 519 bands on the owner's model,
    #    every one off by exactly one class.
    #
    #    That is not a cosmetic inconsistency. Every hand edit re-derives over the final
    #    interval, so an edit appeared to change a class it never touched — and undo
    #    could not give the old class back, because the old class was never derivable
    #    from the band it sat on. Re-deriving here makes undo an inverse by construction.
    #
    #    Rounded FIRST, so the classes are derived from exactly the intervals that get
    #    written, not from intervals half a millimetre away from them.
    bands = [[round(top, 3), round(base, 3), cls] for top, base, cls in bands]
    for _ in range(_REDERIVE_MAX_PASSES):
        rederived = [
            [
                top,
                base,
                _class_over(
                    seg_depths,
                    seg_qc,
                    top,
                    base,
                    soil,
                    admixtures,
                    statistic,
                    cls,
                    all_samples=in_range,
                    variant_override=variant_override,
                ),
            ]
            for top, base, cls in bands
        ]
        # A re-derivation can make two neighbours agree, and two touching bands of one
        # class are one band. Welding changes their extent, which changes what the cone
        # says over it, so the pair runs to a fixed point. Each weld strictly reduces the
        # band count, so it always reaches one.
        welded = _weld_same_class_bands(rederived)
        if welded == bands:
            break
        bands = welded
    # ``cls`` can be None now: the per-interval coverage gate (audit F14) flags a
    # band whose own window cannot answer, exactly like the whole-segment path.
    return [GeotechSplit(top, base, None if cls is None else int(cls)) for top, base, cls in bands]

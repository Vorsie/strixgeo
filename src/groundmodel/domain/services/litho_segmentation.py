"""Lithostratigraphic layer segmenter — CPT (Robertson 2015) + borehole paths.

Produces a suggested list of lithostratigraphic layers for a CPT column or a
borehole observation sequence. The suggestions are READ-ONLY: the user accepts
or rejects them via the normal contact-create flow (slice 4). This module never
writes to the database.

**Phase 4 carve-out (CLAUDE.md).** Robertson SBT zones are used here strictly
as a SEGMENTATION INPUT. The SBT values are an intermediate step in proposing
layer boundaries; they are never exposed as committed parameters in the geological
model. The full parameter port (cu / OCR / E50 / Vs / G0 / M, per-layer unit
weights, NAD parameter values) stays Phase 5.

The segmenter diverges from ``cpt_interpretation.py`` intentionally: that module
uses the Robertson (1990) Ic preview frozen for the chart panel; this module uses
Robertson (2015/2009). Reconciliation is deferred — see docs/debt.md.

Algorithm (CPT path)
--------------------
1. Per-point SBT zone via ``robertson_2015.qtn_f_ic_series`` + ``sbt_zone_series``.
2. Smooth zone sequence over a rolling-median window sized to ``minimum_layer_thickness_m``
   (eliminates single-row noise without splitting thin real layers).
3. Run-length encode the smoothed sequence.
4. Greedy-merge: runs shorter than ``minimum_layer_thickness_m`` are absorbed
   into the preceding run (or the following run if at the very top).
5. Per resulting layer: compute mean qc from raw (unsmoothed) data, map dominant
   SBT → base lithology, compute Dr → NAD packing for sand zones.

Algorithm (borehole path)
-------------------------
Map each ``ObservationLayer.main_soil_codes[0]`` (DOV hoofdnaam code) to a base
lithology, then apply the same greedy-merge.
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from dataclasses import dataclass

from groundmodel.domain.services.litho_segmentation_constants import (
    DOV_HOOFDNAAM_TO_LITHOLOGY,
    ROBERTSON_ST_TO_LITHOLOGY,
)
from groundmodel.domain.services.robertson_2015 import (
    QtnResult,
    StressResult,
    qtn_f_ic_series,
    relative_density_sand,
    sbt_zone_series,
    stress_profile,
)
from groundmodel.domain.services.robertson_sbt_non_normalised import (
    sbt_zone_series_non_normalised,
)
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.litho_constants import BaseLithology
from groundmodel.shared.constants.suggestion_confidence import SuggestionConfidence

# ---------------------------------------------------------------------------
# NAD packing classes for SAND (CPT-derived Dr → NAD class)
# Clean sand only (Ic < 2.45 AND FR < 1.2 — the clean-sand gate of the
# Jamiolkowski et al. 2003 relative-density correlation).
# Classes 5-8 from litho_constants.NAD_CLASSES:
#   5: ZAND los gp, 6: ZAND matig gp, 7: ZAND dicht gp, 8: ZAND zeer dicht gp
# Thresholds from memory/project_litho_geotech_three_level_model.md:
#   los: Dr < 35%, matig: 35 ≤ Dr < 65%, dicht: 65 ≤ Dr < 85%, zeer dicht: Dr ≥ 85%
# ---------------------------------------------------------------------------
_SAND_NAD_BY_DR: tuple[tuple[float, int], ...] = (
    (35.0, 5),  # los (Dr < 35%) → NAD class 5
    (65.0, 6),  # matig (35 ≤ Dr < 65%) → NAD class 6
    (85.0, 7),  # dicht (65 ≤ Dr < 85%) → NAD class 7
)
_SAND_NAD_VERY_DENSE = 8  # zeer dicht (Dr ≥ 85%) → NAD class 8


def _dr_to_nad_class(dr_pct: float) -> int:
    """Map Dr [%] to the clean-sand NAD packing class (5–8)."""
    for threshold, nad in _SAND_NAD_BY_DR:
        if dr_pct < threshold:
            return nad
    return _SAND_NAD_VERY_DENSE


# ---------------------------------------------------------------------------
# Output dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LithoLayerSuggestion:
    """One suggested lithostratigraphic layer from the segmenter.

    Parameters
    ----------
    depth_top_m : float
        Top of the layer in metres below ground surface.
    depth_base_m : float
        Base of the layer in metres below ground surface.
    suggested_lithology : BaseLithology
        Base lithology token (ZAND / KLEI / SILT / GRIND / VEEN).
    suggested_nad_class : int | None
        NAD packing class (5–8 for clean sand from Dr; None for all other
        lithologies — admixture/silt-clayey classes 9–12 require borehole
        confirmation per project spec).
    nad_class_range : tuple[int, int] | None
        NAD class range ``(min, max)`` across the merged source segments.
        ``(n, n)`` when all sources share NAD class ``n``; ``(lo, hi)`` when
        they differ.  ``None`` when ``suggested_nad_class`` is ``None`` (i.e.
        the layer is not a clean-sand CPT layer).
        Populated by ``merge_adjacent_same_lithology``; un-merged layers carry
        the singleton ``(n, n)`` or ``None`` mirroring ``suggested_nad_class``.
    mean_qc_mpa : float | None
        Mean cone resistance over the layer from the raw (unsmoothed) series.
        ``None`` for borehole-path suggestions.
    dr_pct : float | None
        Mean relative density over the layer for ZAND layers.  ``None`` when
        the SBT is not clean sand (Ic ≥ 2.45 or FR ≥ 1.2).
    confidence : SuggestionConfidence
        Segmenter confidence (HIGH / MEDIUM / LOW).
    source : str
        ``"cpt_robertson_2015"`` or ``"borehole_observation"``.
    """

    depth_top_m: float
    depth_base_m: float
    suggested_lithology: BaseLithology
    suggested_nad_class: int | None
    mean_qc_mpa: float | None
    dr_pct: float | None
    confidence: SuggestionConfidence
    source: str
    # Admixtures aggregated from the contributing ObservationLayer.admixtures
    # by thickness-weighted majority (>50% merged thickness).  Empty tuple for
    # CPT-path suggestions (CPT cannot distinguish admixtures).
    # Debt #66: heuristic — owner tunes at dogfeed.
    suggested_admixtures: tuple[Admixture, ...] = ()
    # NAD class range across merged source segments — see field docstring.
    # Defaults to None; set by segment_cpt (singleton) and
    # merge_adjacent_same_lithology (range or singleton).
    nad_class_range: tuple[int, int] | None = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _rolling_median_zones(zones: list[int | None], half_window: int) -> list[int | None]:
    """Apply a rolling-median smoother to the zone sequence.

    A rolling median is robust to single-point spikes (qc interbedding) and
    preserves sharp transitions better than a mean. ``half_window`` is the
    number of rows above and below the current row included in the median;
    total window = 2*half_window + 1.

    Rows within ``half_window`` of the ends use a shortened window: the
    top/bottom edge effect is handled by keeping every row and shrinking the
    window there, rather than clipping the end rows away.

    ``None`` elements (undefined points) are excluded from the median sample
    but kept as ``None`` in the output.
    """
    n = len(zones)
    result: list[int | None] = []
    for i in range(n):
        if zones[i] is None:
            result.append(None)
            continue
        lo = max(0, i - half_window)
        hi = min(n, i + half_window + 1)
        sample = [z for z in zones[lo:hi] if z is not None]
        if not sample:
            result.append(None)
        else:
            result.append(int(statistics.median(sample)))
    return result


def _run_length_encode(zones: list[int | None]) -> list[tuple[int | None, int, int]]:
    """Run-length encode a zone sequence.

    Returns
    -------
    list of (zone, start_idx, end_idx_exclusive)
        Each tuple covers indices [start_idx, end_idx_exclusive).
    """
    if not zones:
        return []
    runs: list[tuple[int | None, int, int]] = []
    current = zones[0]
    start = 0
    for i in range(1, len(zones)):
        if zones[i] != current:
            runs.append((current, start, i))
            current = zones[i]
            start = i
    runs.append((current, start, len(zones)))
    return runs


def _greedy_merge(
    runs: list[tuple[int | None, int, int]],
    tops_m: Sequence[float],
    bases_m: Sequence[float],
    min_thickness_m: float,
) -> list[tuple[int | None, int, int]]:
    """Merge runs shorter than ``min_thickness_m`` into their neighbours.

    Policy: absorb into the preceding run; if at the very top (no preceding
    run), absorb into the following run. Iterate until all runs meet the
    thickness requirement or only one run remains.

    ``None``-zone runs (undefined/skipped points) are treated as zero-thickness
    and merged away immediately regardless of ``min_thickness_m``.

    Parameters
    ----------
    runs : list[tuple[int | None, int, int]]
        Run-length encoding as ``(zone, start_index, end_index_exclusive)``.
    tops_m, bases_m : Sequence[float]
        Top and base depth of each encoded element, parallel to the indices in
        ``runs``. A run's thickness is measured from the top of its FIRST
        element to the base of its LAST — the same bounds the caller emits, so
        the measure that decides survival matches the geometry produced. The
        CPT path passes the sample depths as both sequences, which reduces to
        ``depths[e - 1] - depths[s]``.
    min_thickness_m : float
        Runs thinner than this are absorbed into a neighbour.
    """
    merged = list(runs)

    def _thickness(s: int, e: int) -> float:
        return bases_m[e - 1] - tops_m[s] if e > s else 0.0

    # Restart-after-each-merge: find the first short run, absorb it into
    # the PRECEDING run (its zone wins) or — only when it is the very
    # first run — into the FOLLOWING run, then rescan from the top. Each
    # merge does one ``del`` so ``len(merged)`` strictly decreases →
    # termination in ≤ N-1 merges. A single surviving sub-minimum run
    # (whole series thinner than min_thickness) is returned as-is.
    changed = True
    while changed and len(merged) > 1:
        changed = False
        for i in range(len(merged)):
            zone, s, e = merged[i]
            if zone is not None and _thickness(s, e) >= min_thickness_m:
                continue
            if i > 0:
                pz, ps, _pe = merged[i - 1]
                merged[i - 1] = (pz, ps, e)
                del merged[i]
            else:
                nz, _ns, ne = merged[i + 1]
                merged[i + 1] = (nz, s, ne)
                del merged[i]
            changed = True
            break  # neighbours/indices shifted — rescan from the top
    return merged


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def segment_cpt(
    depths_m: Sequence[float],
    qc_mpa: Sequence[float],
    fs_mpa: Sequence[float | None],
    niveau_m: float,
    yw_m: float,
    minimum_layer_thickness_m: float = 0.15,
    gunsat_kNm3: float = 16.0,
    gwater_kNm3: float = 9.81,
    dr_compression_factor: float = 0.675,
    merge_same_lithology: bool = True,
    use_normalised_qc: bool = True,
) -> list[LithoLayerSuggestion]:
    """Segment a CPT series into lithostratigraphic layers via Robertson 2015/2009.

    Parameters
    ----------
    depths_m : Sequence[float]
        Measurement depths in metres below ground surface, ascending.
    qc_mpa : Sequence[float]
        Cone resistance in MPa, one per depth point.
    fs_mpa : Sequence[float | None]
        Sleeve friction in MPa; ``None`` for missing measurements.
    niveau_m : float
        Ground surface elevation in TAW (m).
    yw_m : float
        Groundwater table elevation in TAW (m).
    minimum_layer_thickness_m : float
        Minimum layer thickness the segmenter will output (default 0.15 m).
        Thinner runs are merged into their neighbour.
    gunsat_kNm3 : float
        Unit weight of soil above the water table (default 16 kN/m³).
    gwater_kNm3 : float
        Unit weight of water (default 9.81 kN/m³).
    dr_compression_factor : float
        Compression factor for Dr computation (default 0.675 average quartz;
        see ``relative_density_sand``).
    merge_same_lithology : bool
        When ``True`` (default), run ``merge_adjacent_same_lithology`` as a
        final pass to collapse adjacent segments that share the same lithology
        code into a single layer.  Set to ``False`` to see the un-merged
        Robertson-SBT-driven splits (useful for diagnosing packing-density
        boundaries before the Geotech stage ships its own split gesture).
    use_normalised_qc : bool
        When ``True`` (default), classify each point with the stress-NORMALISED
        Robertson 2015 pipeline (Qtn / F / Ic — needs the niveau/yw stress
        profile + iterative convergence).  When ``False``, classify with the
        NON-normalised Robertson 2010 index ``I_SBT`` (qc/pa + Rf directly), which
        needs no stress profile or groundwater table — the appropriate choice at
        shallow depth or when the effective-stress profile is unreliable.  In
        non-normalised mode ``niveau_m`` / ``yw_m`` are ignored and Dr / NAD
        packing class are left ``None`` (relative density needs effective stress).

    Returns
    -------
    list[LithoLayerSuggestion]
        Suggested layers, ordered top to bottom.  Empty list when the series
        is too short or all points are undefined.
    """
    depths_m = list(depths_m)
    n = len(depths_m)
    if n == 0:
        return []

    # --- Step 1: per-point SBT zones — normalised (Robertson 2015) or not ---
    # Non-normalised mode (use_normalised_qc=False) skips the stress profile +
    # iterative convergence entirely and reads the Robertson 2010 I_SBT index
    # from qc/pa + Rf. ``stress`` / ``qtn_results`` stay None in that mode and
    # Dr / NAD (which need effective stress) are left blank in Step 5.
    stress: list[StressResult] | None
    qtn_results: list[QtnResult | None] | None
    if use_normalised_qc:
        stress = stress_profile(depths_m, qc_mpa, fs_mpa, niveau_m, yw_m, gunsat_kNm3, gwater_kNm3)
        qtn_results = qtn_f_ic_series(depths_m, qc_mpa, fs_mpa, stress)
        raw_zones: list[int | None] = sbt_zone_series(qtn_results)
    else:
        stress = None
        qtn_results = None
        raw_zones = sbt_zone_series_non_normalised(qc_mpa, fs_mpa)

    # --- Step 2: rolling-median smoother ---
    # Window half-size in number of depth rows to cover minimum_layer_thickness_m.
    depth_step = (depths_m[-1] - depths_m[0]) / max(n - 1, 1) if n > 1 else 0.1
    half_window = max(1, int(round((minimum_layer_thickness_m / 2.0) / max(depth_step, 1e-6))))
    smoothed: list[int | None] = _rolling_median_zones(raw_zones, half_window)

    # --- Step 3: run-length encode ---
    runs = _run_length_encode(smoothed)

    # --- Step 4: greedy-merge thin runs ---
    # A CPT sample is a point, not an interval: its "top" and "base" are the
    # same depth, so this reduces to ``depths_m[e - 1] - depths_m[s]``.
    merged = _greedy_merge(runs, depths_m, depths_m, minimum_layer_thickness_m)

    # --- Step 5: build LithoLayerSuggestion per merged run ---
    # Drop undefined (None-zone) runs, then emit a CONTIGUOUS partition:
    # each layer's base is the NEXT kept layer's top (shared boundary,
    # so the user drawing contacts from these has no unassigned gap);
    # the last layer's base is its deepest sample. Any undefined points
    # between two kept runs are absorbed into the upper layer.
    kept = [(z, s, e) for (z, s, e) in merged if z is not None]
    suggestions: list[LithoLayerSuggestion] = []
    for idx, (zone, s, e) in enumerate(kept):
        assert zone is not None  # filtered above; narrows the type
        depth_top = depths_m[s]
        if idx + 1 < len(kept):
            depth_base = depths_m[kept[idx + 1][1]]  # next layer's top
        else:
            depth_base = depths_m[e - 1]  # deepest sample

        lithology: BaseLithology = ROBERTSON_ST_TO_LITHOLOGY.get(zone, "KLEI")

        # Confidence: HIGH if the layer is at least 2× minimum thickness;
        # MEDIUM if it just meets the threshold; LOW if it survived only due
        # to a greedy merge.
        raw_run_thickness = depths_m[min(e - 1, n - 1)] - depths_m[s]
        if raw_run_thickness >= 2.0 * minimum_layer_thickness_m:
            confidence = SuggestionConfidence.HIGH
        elif raw_run_thickness >= minimum_layer_thickness_m:
            confidence = SuggestionConfidence.MEDIUM
        else:
            confidence = SuggestionConfidence.LOW

        # Mean qc (raw, unsmoothed) over the layer points.
        raw_qcs = [qc_mpa[k] for k in range(s, e) if qc_mpa[k] > 0]
        mean_qc: float | None = sum(raw_qcs) / len(raw_qcs) if raw_qcs else None

        # Relative density + NAD class (sand zones only, the clean-sand gate of
        # the Dr correlation). Only available in the normalised pipeline — Dr needs the
        # effective-stress profile, which non-normalised mode never builds.
        dr_pct: float | None = None
        nad_class: int | None = None
        if lithology == "ZAND" and qtn_results is not None and stress is not None:
            # Compute per-point Dr for points satisfying Ic<2.45 AND
            # FR<1.2, then average. ``FR`` here is the RAW friction
            # ratio ``fs/qc*100``, NOT the Robertson-normalised ``F``
            # (= fs*100000/net_qc). The clean-sand gate is ``Ic<2.45 & FR<1.2``
            # on raw FR; using normalised F (which is ≥ raw FR) would
            # wrongly exclude deep loose sands — exactly the NAD case
            # that matters most. (Senior-review B1, 2026-05-17.)
            dr_values: list[float] = []
            for k in range(s, e):
                r = qtn_results[k]
                sr = stress[k]
                if r is None:
                    continue
                fs_k = fs_mpa[k]
                qc_k = qc_mpa[k]
                fr_raw = (fs_k / qc_k * 100.0) if (fs_k is not None and qc_k > 0) else float("inf")
                if r.ic < 2.45 and fr_raw < 1.2:
                    dr_k = relative_density_sand(qc_mpa[k], sr.seff_kpa, dr_compression_factor)
                    if dr_k is not None:
                        dr_values.append(dr_k)
            if dr_values:
                dr_pct = sum(dr_values) / len(dr_values)
                nad_class = _dr_to_nad_class(dr_pct)
            # If no points satisfy the sand condition (silty/clayey admixture
            # inferred from Ic ≥ 2.45 or FR ≥ 1.2), nad_class stays None —
            # admixture/silt-clayey classes 9–12 require borehole confirmation.

        # nad_class_range singleton — (n, n) when NAD class is known,
        # None otherwise.  merge_adjacent_same_lithology expands this to a
        # proper range when adjacent same-lithology segments are collapsed.
        nad_range: tuple[int, int] | None = (
            (nad_class, nad_class) if nad_class is not None else None
        )

        suggestions.append(
            LithoLayerSuggestion(
                depth_top_m=depth_top,
                depth_base_m=depth_base,
                suggested_lithology=lithology,
                suggested_nad_class=nad_class,
                nad_class_range=nad_range,
                mean_qc_mpa=mean_qc,
                dr_pct=dr_pct,
                confidence=confidence,
                source="cpt_robertson_2015",
            )
        )

    if merge_same_lithology:
        suggestions = merge_adjacent_same_lithology(suggestions)

    return suggestions


# Debt #66 (resolved 2026-05-21): two-threshold admixture aggregation.
# Hoisted to module constants so the owner can tune them at dogfeed
# without re-reading the function body. The primary threshold catches
# dominant admixtures (>50% of run thickness, e.g. "Strong Sandy Clay").
# The secondary threshold + presence-floor catches PERVASIVE secondary
# signals in thin interbedded sequences (e.g. "silty" present at modest
# thickness across many alternating layers — the primary threshold
# misses these because no single layer dominates).
ADMIXTURE_MAJORITY_THRESHOLD = 0.5
ADMIXTURE_SECONDARY_THRESHOLD = 0.25
ADMIXTURE_PRESENCE_FLOOR = 3


def _aggregate_admixtures(
    admixtures_per_layer: Sequence[list[Admixture]],
    thicknesses: Sequence[float],
    start_idx: int,
    end_idx_exclusive: int,
) -> tuple[Admixture, ...]:
    """Aggregate admixtures from contributing observation layers by thickness weight.

    An admixture is keyed by its ``soil_code`` (NOT soil_code:amount —
    different amounts of the same soil are aggregated together so the
    output picks the dominant amount per soil rather than competing
    variants thinned across the run).  Inclusion is two-threshold:

    1. **Primary** — total thickness > ``ADMIXTURE_MAJORITY_THRESHOLD``
       (50%) of the merged run's total thickness.  Dominant-signal case
       (e.g. "Strong Sandy Clay" where the sandy admixture spans most
       of the run).
    2. **Secondary** — total thickness > ``ADMIXTURE_SECONDARY_THRESHOLD``
       (25%) AND present in >= ``ADMIXTURE_PRESENCE_FLOOR`` (3) source
       layers.  Pervasive-secondary-signal case (thin interbedded
       sequences where the secondary admixture IS the geological
       character even though no single layer dominates).

    For each included ``soil_code``, the output's ``amount`` is the
    amount variant with the highest summed thickness across contributing
    layers — geotechnically honest: the merged label reflects the
    dominant strength when layers report different amounts.

    The ``locally`` flag follows the same rule as before — False when
    ANY contributing layer reports it globally; True only when EVERY
    contributing layer reports it as local.

    Parameters
    ----------
    admixtures_per_layer : Sequence[list[Admixture]]
        Per-layer admixture lists, indexed parallel to the observation layers.
    thicknesses : Sequence[float]
        Per-layer thickness in metres (base - top), indexed parallel.
    start_idx : int
        First layer index (inclusive) of the merged run.
    end_idx_exclusive : int
        Last layer index (exclusive) of the merged run.

    Returns
    -------
    tuple[Admixture, ...]
        Admixtures passing the two-threshold rule, ordered by ``soil_code``
        for determinism.
    """
    total_thickness = sum(thicknesses[i] for i in range(start_idx, end_idx_exclusive))
    if total_thickness <= 0:
        return ()

    # Per-soil_code accumulators. A soil_code appearing twice in one
    # layer is counted once for thickness + presence (defensive against
    # malformed input) but each amount variant still contributes to the
    # amount-thickness map.
    soil_thickness: dict[str, float] = {}
    soil_layer_count: dict[str, int] = {}
    soil_amount_thickness: dict[str, dict[str, float]] = {}
    soil_any_global: dict[str, bool] = {}  # True when any contributing layer has locally=False

    for i in range(start_idx, end_idx_exclusive):
        th = thicknesses[i]
        seen_this_layer: set[str] = set()
        for adm in admixtures_per_layer[i]:
            s = adm.soil_code
            if s not in seen_this_layer:
                seen_this_layer.add(s)
                soil_thickness[s] = soil_thickness.get(s, 0.0) + th
                soil_layer_count[s] = soil_layer_count.get(s, 0) + 1
            amount_map = soil_amount_thickness.setdefault(s, {})
            amount_map[adm.amount] = amount_map.get(adm.amount, 0.0) + th
            if not adm.locally:
                soil_any_global[s] = True
            elif s not in soil_any_global:
                soil_any_global[s] = False

    primary_cutoff = ADMIXTURE_MAJORITY_THRESHOLD * total_thickness
    secondary_cutoff = ADMIXTURE_SECONDARY_THRESHOLD * total_thickness

    result: list[Admixture] = []
    for s in sorted(soil_thickness):
        total_for_s = soil_thickness[s]
        layer_count = soil_layer_count[s]
        passes_primary = total_for_s > primary_cutoff
        passes_secondary = (
            total_for_s > secondary_cutoff and layer_count >= ADMIXTURE_PRESENCE_FLOOR
        )
        if not (passes_primary or passes_secondary):
            continue
        # Dominant amount: the variant with the largest summed thickness.
        # Tie-break by lexicographic order on the amount string so two
        # equally-weighted variants produce a deterministic output.
        amount_map = soil_amount_thickness[s]
        dominant_amount = max(amount_map.items(), key=lambda kv: (kv[1], kv[0]))[0]
        result.append(
            Admixture(
                soil_code=s,
                amount=dominant_amount,
                # locally=False when ANY contributing layer has it globally
                locally=not soil_any_global.get(s, False),
            )
        )
    return tuple(result)


# ---------------------------------------------------------------------------
# Same-lithology merge pass (debt #119)
# ---------------------------------------------------------------------------

# Small tolerance used when checking segment adjacency — segments whose gap
# is smaller than this (in metres) are considered touching.  Floating-point
# rounding in the depth series can produce gaps of ~1e-10 m after the
# connect-the-dots pass in segment_cpt, so we use a generous 1 mm floor.
_ADJACENCY_TOLERANCE_M: float = 0.001


def merge_adjacent_same_lithology(
    segments: list[LithoLayerSuggestion],
) -> list[LithoLayerSuggestion]:
    """Collapse adjacent segments that share ``suggested_lithology``.

    Two segments merge when:

    * They are positionally adjacent — segment ``i``'s ``depth_base_m`` equals
      segment ``i+1``'s ``depth_top_m`` within ``_ADJACENCY_TOLERANCE_M``.
    * They share the same ``suggested_lithology`` code (one of the five
      ``BaseLithology`` tokens: ZAND / KLEI / SILT / GRIND / VEEN).

    The merged segment:

    * ``depth_top_m``  — the topmost original segment's top.
    * ``depth_base_m`` — the bottommost original segment's base.
    * ``suggested_lithology`` — the shared code.
    * ``suggested_nad_class`` — thickness-weighted mean of non-None
      ``suggested_nad_class`` values, rounded to the nearest integer; ``None``
      when all sources are ``None``.
    * ``nad_class_range`` — ``(min, max)`` across non-None
      ``suggested_nad_class`` values; ``(n, n)`` when all sources share the
      same class ``n``; ``None`` when all sources are ``None``.
    * ``mean_qc_mpa`` — thickness-weighted mean of non-None values; ``None``
      when all sources are ``None``.
    * ``dr_pct`` — thickness-weighted mean of non-None values; ``None`` when
      all sources are ``None``.
    * ``confidence`` — the MINIMUM confidence across the merged sources
      (most conservative: if any source is LOW, the merged layer is LOW).
    * ``source`` — taken from the first source segment (homogeneous within a
      single call chain: all CPT or all borehole).
    * ``suggested_admixtures`` — re-aggregated via ``_aggregate_admixtures``
      from the per-segment already-aggregated admixture tuples, weighted by
      each segment's thickness.

    Iterative — runs until no two adjacent segments can be merged, so a chain
    of four or more same-lithology segments collapses in one call.

    Parameters
    ----------
    segments : list[LithoLayerSuggestion]
        Input list, ordered top to bottom.  May be empty or a single element.

    Returns
    -------
    list[LithoLayerSuggestion]
        Merged list, ordered top to bottom.  Fewer or equal items than the
        input; never more.
    """
    if len(segments) <= 1:
        return list(segments)

    # Repeat until stable — each pass reduces the list by at least 1 element
    # whenever a merge fires, so termination is guaranteed in ≤ N-1 passes.
    changed = True
    current = list(segments)
    while changed and len(current) > 1:
        changed = False
        merged: list[LithoLayerSuggestion] = []
        i = 0
        while i < len(current):
            seg = current[i]
            # Greedily absorb all immediately-following adjacent same-lithology
            # segments into one accumulator before appending.
            group: list[LithoLayerSuggestion] = [seg]
            while i + 1 < len(current):
                nxt = current[i + 1]
                # Adjacency: base of last group member ≈ top of next.
                adjacent = abs(group[-1].depth_base_m - nxt.depth_top_m) <= _ADJACENCY_TOLERANCE_M
                same_litho = group[-1].suggested_lithology == nxt.suggested_lithology
                if adjacent and same_litho:
                    group.append(nxt)
                    i += 1
                    changed = True
                else:
                    break
            if len(group) == 1:
                merged.append(seg)
            else:
                merged.append(_collapse_group(group))
            i += 1
        current = merged

    return current


def _collapse_group(group: list[LithoLayerSuggestion]) -> LithoLayerSuggestion:
    """Merge a run of same-lithology segments into a single LithoLayerSuggestion.

    Called only from ``merge_adjacent_same_lithology`` after the adjacency +
    same-lithology gate has already been passed for every pair in the group.
    All segments in the group must share ``suggested_lithology``.

    Parameters
    ----------
    group : list[LithoLayerSuggestion]
        Two or more adjacent same-lithology segments, ordered top to bottom.

    Returns
    -------
    LithoLayerSuggestion
        A single merged segment spanning the group.
    """
    thicknesses = [max(0.0, s.depth_base_m - s.depth_top_m) for s in group]

    # Thickness-weighted mean for numeric per-layer values.
    def _weighted_mean(values: list[float | None]) -> float | None:
        pairs = [(v, t) for v, t in zip(values, thicknesses) if v is not None]
        if not pairs:
            return None
        weight_sum = sum(t for _, t in pairs)
        if weight_sum <= 0.0:
            return None
        return sum(v * t for v, t in pairs) / weight_sum

    mean_qc = _weighted_mean([s.mean_qc_mpa for s in group])
    dr_pct = _weighted_mean([s.dr_pct for s in group])

    # NAD class — thickness-weighted mean (rounded) + range across sources.
    nad_values = [
        (s.suggested_nad_class, t)
        for s, t in zip(group, thicknesses)
        if s.suggested_nad_class is not None
    ]
    if nad_values:
        weight_sum = sum(t for _, t in nad_values)
        nad_weighted = (
            sum(n * t for n, t in nad_values) / weight_sum if weight_sum > 0.0 else nad_values[0][0]
        )
        nad_class: int | None = round(nad_weighted)
        nad_min = min(n for n, _ in nad_values)
        nad_max = max(n for n, _ in nad_values)
        nad_range: tuple[int, int] | None = (nad_min, nad_max)
    else:
        nad_class = None
        nad_range = None

    # Confidence — most conservative (LOW < MEDIUM < HIGH).
    _CONF_ORDER = {
        SuggestionConfidence.LOW: 0,
        SuggestionConfidence.MEDIUM: 1,
        SuggestionConfidence.HIGH: 2,
    }
    confidence = min(group, key=lambda s: _CONF_ORDER.get(s.confidence, 0)).confidence

    # Admixtures — re-aggregate from the per-segment already-aggregated tuples.
    # Each segment's admixtures are treated as one "observation layer" with the
    # segment's thickness as its weight.
    admix_per_layer: list[list[Admixture]] = [list(s.suggested_admixtures) for s in group]
    aggregated_admixtures = _aggregate_admixtures(admix_per_layer, thicknesses, 0, len(group))

    return LithoLayerSuggestion(
        depth_top_m=group[0].depth_top_m,
        depth_base_m=group[-1].depth_base_m,
        suggested_lithology=group[0].suggested_lithology,
        suggested_nad_class=nad_class,
        nad_class_range=nad_range,
        mean_qc_mpa=mean_qc,
        dr_pct=dr_pct,
        confidence=confidence,
        source=group[0].source,
        suggested_admixtures=aggregated_admixtures,
    )


def segment_borehole(
    layer_tops_m: Sequence[float],
    layer_bases_m: Sequence[float],
    main_soil_codes: Sequence[list[str]],
    minimum_layer_thickness_m: float = 0.15,
    admixtures_per_layer: Sequence[list[Admixture]] | None = None,
    merge_same_lithology: bool = True,
) -> list[LithoLayerSuggestion]:
    """Segment borehole observation layers into lithostratigraphic layer suggestions.

    Maps each ``ObservationLayer.main_soil_codes[0]`` (DOV hoofdnaam code) to a
    base lithology and applies the same greedy-merge.  Unknown/unmappable codes
    are logged and skipped.

    Parameters
    ----------
    layer_tops_m : Sequence[float]
        Top depths in metres below ground surface, one per observation layer.
    layer_bases_m : Sequence[float]
        Base depths in metres below ground surface, one per observation layer.
    main_soil_codes : Sequence[list[str]]
        DOV hoofdnaam code lists, one per layer.  The first element of each list
        is used as the primary soil type.  Empty lists yield ``None`` (skipped).
    minimum_layer_thickness_m : float
        Minimum layer thickness for the greedy-merge (default 0.15 m).
    admixtures_per_layer : Sequence[list[Admixture]] | None, optional
        Per-layer admixture lists (parallel to ``layer_tops_m``).  When provided
        and non-empty, admixtures present in >50% of each merged run's total
        thickness are propagated to ``LithoLayerSuggestion.suggested_admixtures``
        (debt #66 heuristic).  ``None`` or absent → empty admixtures on every
        suggestion (CPT path; borehole path without admixture data).
    merge_same_lithology : bool
        When ``True`` (default), run ``merge_adjacent_same_lithology`` as a
        final pass to collapse adjacent segments that share the same lithology
        code into a single layer.  Set to ``False`` to see the un-merged
        greedy-merge output (useful for diagnosing individual observation-layer
        boundaries before the Geotech stage).

    Returns
    -------
    list[LithoLayerSuggestion]
        Suggested layers ordered top to bottom.  Empty list when no mappable
        layers remain after filtering.
    """
    layer_tops_m = list(layer_tops_m)
    layer_bases_m = list(layer_bases_m)
    n = len(layer_tops_m)
    if n == 0:
        return []

    # Admixture data — default to empty lists per layer when not provided.
    effective_admixtures: list[list[Admixture]] = (
        [list(a) for a in admixtures_per_layer]
        if admixtures_per_layer is not None and len(admixtures_per_layer) == n
        else [[] for _ in range(n)]
    )
    # Per-layer thickness for the admixture aggregation weight.
    layer_thicknesses = [max(0.0, b - t) for t, b in zip(layer_tops_m, layer_bases_m)]

    # Map each layer to a lithology token (None = unmappable).
    litho_per_layer: list[BaseLithology | None] = []
    for codes in main_soil_codes:
        if not codes:
            litho_per_layer.append(None)
            continue
        code = codes[0]
        litho: BaseLithology | None = DOV_HOOFDNAAM_TO_LITHOLOGY.get(code)
        if litho is None and code not in DOV_HOOFDNAAM_TO_LITHOLOGY:
            # Truly unknown code — treat as None (unmappable) rather than crash.
            litho = None
        litho_per_layer.append(litho)

    # Build a fake "zones" list (lithology tokens as integers via a lookup)
    # so we can reuse the same RLE + merge pipeline.  Use a stable integer
    # encoding: GRIND=1, ZAND=2, SILT=3, KLEI=4, VEEN=5, None=None.
    _LITHO_INT: dict[BaseLithology, int] = {
        "GRIND": 1,
        "ZAND": 2,
        "SILT": 3,
        "KLEI": 4,
        "VEEN": 5,
    }
    _INT_LITHO: dict[int, BaseLithology] = {v: k for k, v in _LITHO_INT.items()}
    int_zones: list[int | None] = [
        _LITHO_INT.get(lith) if lith is not None else None for lith in litho_per_layer
    ]

    # RLE on the (top, base) intervals. The merge measures each run with the
    # REAL bounds it will be emitted with (``layer_tops_m[s]`` →
    # ``layer_bases_m[e - 1]``, see below): a description log has one layer per
    # lithology change, so a run of ONE layer is the normal case and must be
    # judged on its true thickness.
    runs = _run_length_encode(int_zones)
    merged = _greedy_merge(runs, layer_tops_m, layer_bases_m, minimum_layer_thickness_m)

    suggestions: list[LithoLayerSuggestion] = []
    for zone_int, s, e in merged:
        if zone_int is None:
            continue
        lithology = _INT_LITHO[zone_int]
        depth_top = layer_tops_m[s]
        depth_base = layer_bases_m[e - 1]
        raw_thickness = depth_base - depth_top
        if raw_thickness >= 2.0 * minimum_layer_thickness_m:
            confidence = SuggestionConfidence.HIGH
        elif raw_thickness >= minimum_layer_thickness_m:
            confidence = SuggestionConfidence.MEDIUM
        else:
            confidence = SuggestionConfidence.LOW

        aggregated_admixtures = _aggregate_admixtures(effective_admixtures, layer_thicknesses, s, e)

        suggestions.append(
            LithoLayerSuggestion(
                depth_top_m=depth_top,
                depth_base_m=depth_base,
                suggested_lithology=lithology,
                suggested_nad_class=None,  # Dr requires CPT; borehole has no qc
                mean_qc_mpa=None,
                dr_pct=None,
                confidence=confidence,
                source="borehole_observation",
                suggested_admixtures=aggregated_admixtures,
            )
        )

    if merge_same_lithology:
        suggestions = merge_adjacent_same_lithology(suggestions)

    return suggestions

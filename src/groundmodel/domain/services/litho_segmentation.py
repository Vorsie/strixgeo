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

from groundmodel.domain.services.robertson_2015 import (
    QtnResult,
    StressResult,
    qtn_f_ic_series,
    relative_density_sand,
    sbt_zone_series,
    stress_profile,
)
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.litho_constants import BaseLithology
from groundmodel.shared.constants.suggestion_confidence import SuggestionConfidence

# ---------------------------------------------------------------------------
# Robertson SBT zone → base lithology map
# ---------------------------------------------------------------------------
# Geotech judgement call (per project spec): GRIND is NOT CPT-resolvable —
# the standard Robertson chart does not distinguish gravel reliably from
# dense sand. Zone 7 ("Gravelly sand to dense sand") maps to ZAND here;
# GRIND is confirmed only from borehole observation. This map is tunable.
ROBERTSON_ST_TO_LITHOLOGY: dict[int, BaseLithology] = {
    1: "KLEI",  # Sensitive fine-grained
    2: "VEEN",  # Organic soil / clay → peat (most common Belgian organic)
    3: "KLEI",  # Clay to silty clay
    4: "SILT",  # Clayey silt to silty clay
    5: "SILT",  # Silty sand to sandy silt
    6: "ZAND",  # Clean sand to silty sand
    7: "ZAND",  # Gravelly sand to dense sand (GRIND not CPT-resolvable)
    8: "ZAND",  # Stiff sand to clayey sand (very stiff OC)
    9: "KLEI",  # Stiff fine-grained (very stiff OC clay/silt)
}

# ---------------------------------------------------------------------------
# DOV hoofdnaam code → base lithology map
# Source: codetabel_hoofdnaam.csv (infrastructure/codelists/data/).
# All codes that map unambiguously to a Belgian lithology are listed below;
# codes for rock types, construction materials, and unknowns fall through to
# ``None`` (the segmenter skips those layers or treats them as ``KLEI``
# conservatively, logged as unknown).
# ---------------------------------------------------------------------------
DOV_HOOFDNAAM_TO_LITHOLOGY: dict[str, BaseLithology | None] = {
    # Zand (sand) — both coarse and fine grain codes
    "XZ": "ZAND",  # zand (generic)
    "FZ": "ZAND",  # fijn zand
    "MZ": "ZAND",  # middelmatig zand
    "GZ": "ZAND",  # grof zand
    "ZL": "ZAND",  # zandleem (sand-dominant)
    # Grind (gravel)
    "XG": "GRIND",  # grind (generic)
    "FG": "GRIND",  # fijn grind
    "MG": "GRIND",  # middelmatig grind
    "GG": "GRIND",  # grof grind
    # Silt
    "SI": "SILT",  # silt
    "LE": "SILT",  # leem (loam — Belgian usage: silt-dominant)
    "ME": "SILT",  # mergel (marl — predominantly silt/clay, map conservatively)
    "SL": "SILT",  # slib (estuarine mud, silt-dominant)
    # Klei (clay)
    "KL": "KLEI",  # klei
    "GL": None,  # glauconiet — mineralogy, not a lithology; leave as None
    # Veen (peat) and organic material
    "VE": "VEEN",  # veen (peat)
    "HU": "VEEN",  # humus (organic horizon → peat class)
    "OM": "VEEN",  # organisch materiaal
    "LG": "VEEN",  # ligniet (sub-fossil peat)
    "PL": "VEEN",  # plantenresten (plant remains)
    # Rock and construction — not a soil lithology; map to None
    "KS": None,  # kalksteen
    "DL": None,  # dolomiet
    "GE": None,  # graniet
    "ZS": None,  # zandsteen
    "LS": None,  # leisteen
    "KW": None,  # kwartsiet
    "MA": None,  # marmer
    "BA": None,  # basalt
    "BT": None,  # beton
    "BK": None,  # baksteen
    "AT": None,  # asfalt
    "PU": None,  # puin
    "ST": None,  # stenen
    "XX": None,  # onbekend
    "RO": None,  # rots
    "RV": None,  # verweerde rots
    "GA": None,  # geroerd/gestoord
    # Shells — not a primary lithology
    "SC": None,  # schelpen
    "SF": None,  # schelpfragmenten
    "SG": None,  # schelpgruis
}

# ---------------------------------------------------------------------------
# NAD packing classes for SAND (CPT-derived Dr → NAD class)
# Clean sand only (Ic < 2.45 AND FR < 1.2 per .sce).
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


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _rolling_median_zones(zones: list[int | None], half_window: int) -> list[int | None]:
    """Apply a rolling-median smoother to the zone sequence.

    A rolling median is robust to single-point spikes (qc interbedding) and
    preserves sharp transitions better than a mean. ``half_window`` is the
    number of rows above and below the current row included in the median;
    total window = 2*half_window + 1.

    Rows within ``half_window`` of the ends use a shortened window (mirror of
    the .sce's handling of the top/bottom edge effect — the .sce clips the
    mean-over-10cm intervals at the ends with ``MM = MM(1+delt:lenM-delt,:)``
    but we keep all rows and use a variable-length window instead).

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
    depths_m: Sequence[float],
    min_thickness_m: float,
) -> list[tuple[int | None, int, int]]:
    """Merge runs shorter than ``min_thickness_m`` into their neighbours.

    Policy: absorb into the preceding run; if at the very top (no preceding
    run), absorb into the following run. Iterate until all runs meet the
    thickness requirement or only one run remains.

    ``None``-zone runs (undefined/skipped points) are treated as zero-thickness
    and merged away immediately regardless of ``min_thickness_m``.
    """
    merged = list(runs)

    def _thickness(s: int, e: int) -> float:
        return depths_m[e - 1] - depths_m[s] if e > s else 0.0

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
    minimum_layer_thickness_m: float = 0.5,
    gunsat_kNm3: float = 16.0,
    gwater_kNm3: float = 9.81,
    dr_compression_factor: float = 0.675,
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
        Minimum layer thickness the segmenter will output (default 0.5 m).
        Thinner runs are merged into their neighbour.
    gunsat_kNm3 : float
        Unit weight of soil above the water table (default 16 kN/m³).
    gwater_kNm3 : float
        Unit weight of water (default 9.81 kN/m³).
    dr_compression_factor : float
        Compression factor for Dr computation (default 0.675 average quartz;
        see ``relative_density_sand``).

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

    # --- Step 1: stress profile + Robertson 2015 normalisation ---
    stress: list[StressResult] = stress_profile(
        depths_m, qc_mpa, fs_mpa, niveau_m, yw_m, gunsat_kNm3, gwater_kNm3
    )
    qtn_results: list[QtnResult | None] = qtn_f_ic_series(depths_m, qc_mpa, fs_mpa, stress)
    raw_zones: list[int | None] = sbt_zone_series(qtn_results)

    # --- Step 2: rolling-median smoother ---
    # Window half-size in number of depth rows to cover minimum_layer_thickness_m.
    depth_step = (depths_m[-1] - depths_m[0]) / max(n - 1, 1) if n > 1 else 0.1
    half_window = max(1, int(round((minimum_layer_thickness_m / 2.0) / max(depth_step, 1e-6))))
    smoothed: list[int | None] = _rolling_median_zones(raw_zones, half_window)

    # --- Step 3: run-length encode ---
    runs = _run_length_encode(smoothed)

    # --- Step 4: greedy-merge thin runs ---
    merged = _greedy_merge(runs, depths_m, minimum_layer_thickness_m)

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

        # Relative density + NAD class (sand zones only, per CPTE_2025.sce criterion)
        dr_pct: float | None = None
        nad_class: int | None = None
        if lithology == "ZAND":
            # Compute per-point Dr for points satisfying Ic<2.45 AND
            # FR<1.2, then average. ``FR`` here is the RAW friction
            # ratio ``fs/qc*100`` (CPTE_2025.sce M-matrix column 4),
            # NOT the Robertson-normalised ``F`` (= fs*100000/net_qc).
            # The .sce sand gate (line ~375) is ``Ic<2.45 & FR(i)<1.2``
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

        suggestions.append(
            LithoLayerSuggestion(
                depth_top_m=depth_top,
                depth_base_m=depth_base,
                suggested_lithology=lithology,
                suggested_nad_class=nad_class,
                mean_qc_mpa=mean_qc,
                dr_pct=dr_pct,
                confidence=confidence,
                source="cpt_robertson_2015",
            )
        )

    return suggestions


def _aggregate_admixtures(
    admixtures_per_layer: Sequence[list[Admixture]],
    thicknesses: Sequence[float],
    start_idx: int,
    end_idx_exclusive: int,
) -> tuple[Admixture, ...]:
    """Aggregate admixtures from contributing observation layers by thickness weight.

    An admixture canonical key (``soil_code:amount``, ignoring ``locally``)
    that is present in layers covering >50% of the merged run's total thickness
    is included in the output.  For matching keys, the ``locally`` flag is set
    to False unless ALL contributing layers have it set to True.

    Debt #66: this heuristic is owner-tunable at dogfeed — the >50% majority
    threshold is a reasonable default for Belgian borehole descriptions but may
    need adjustment for thin interbedded sequences.

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
        Admixtures present in >50% of the run's total thickness, ordered by
        ``canonical_key()`` for determinism.
    """
    total_thickness = sum(thicknesses[i] for i in range(start_idx, end_idx_exclusive))
    if total_thickness <= 0:
        return ()

    # Accumulate thickness per canonical key + track locally flag presence.
    key_thickness: dict[str, float] = {}
    key_not_local: dict[str, bool] = {}  # True when any contributing layer has locally=False
    key_soil: dict[str, str] = {}
    key_amount: dict[str, str] = {}

    for i in range(start_idx, end_idx_exclusive):
        th = thicknesses[i]
        for adm in admixtures_per_layer[i]:
            k = adm.canonical_key()
            key_thickness[k] = key_thickness.get(k, 0.0) + th
            if not adm.locally:
                key_not_local[k] = True
            elif k not in key_not_local:
                key_not_local[k] = False
            key_soil[k] = adm.soil_code
            key_amount[k] = adm.amount

    threshold = 0.5 * total_thickness
    result: list[Admixture] = []
    for k in sorted(key_thickness):
        if key_thickness[k] > threshold:
            result.append(
                Admixture(
                    soil_code=key_soil[k],
                    amount=key_amount[k],
                    # locally=False when ANY contributing layer has it globally
                    locally=not key_not_local.get(k, False),
                )
            )
    return tuple(result)


def segment_borehole(
    layer_tops_m: Sequence[float],
    layer_bases_m: Sequence[float],
    main_soil_codes: Sequence[list[str]],
    minimum_layer_thickness_m: float = 0.5,
    admixtures_per_layer: Sequence[list[Admixture]] | None = None,
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
        Minimum layer thickness for the greedy-merge (default 0.5 m).
    admixtures_per_layer : Sequence[list[Admixture]] | None, optional
        Per-layer admixture lists (parallel to ``layer_tops_m``).  When provided
        and non-empty, admixtures present in >50% of each merged run's total
        thickness are propagated to ``LithoLayerSuggestion.suggested_admixtures``
        (debt #66 heuristic).  ``None`` or absent → empty admixtures on every
        suggestion (CPT path; borehole path without admixture data).

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

    # RLE on the (top, base) intervals — use midpoints as "depths" for the
    # thickness comparison in the greedy merge.
    midpoints = [0.5 * (t + b) for t, b in zip(layer_tops_m, layer_bases_m)]

    runs = _run_length_encode(int_zones)
    merged = _greedy_merge(runs, midpoints, minimum_layer_thickness_m)

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

    return suggestions

"""Robertson (2015) / Robertson (2009) CPT classification — pure-function port.

This module implements Robertson's normalised CPT classification — the
Q_tn / F_r / I_c definitions of Robertson (2009) and the soil-behaviour-type
chart of Robertson (2015), with the extended organic/peat boundary of
Lengkeek & Brinkgreve (2022). The formulas follow the published papers; the
implementation is array-based (one pass per CPT, not loop-per-point).

**Phase 4 scope carve-out (CLAUDE.md).** Robertson SBT zone classification is
permitted in Phase 4 strictly as a SEGMENTATION INPUT for lithostratigraphic-
model suggestions. The results of this module are NEVER committed as engineering
parameters. The user accepts/rejects suggested layer boundaries via the normal
contact-create flow (slice 4). Full parameter port (cu/OCR/E50/Vs/G0/M,
per-layer unit weights) stays Phase 5.

Do NOT extend this module with additional engineering calculations until Phase 5.
Do NOT import from this module in ``cpt_interpretation.py`` (frozen 1990 preview
— kept separate intentionally; see debt entry in docs/debt.md).

Units throughout
----------------
- qc, fs: MPa (as stored in cpt_series_orm)
- depth:   m below ground surface (CPT depths are positive downward)
- niveau:  TAW m (ground surface elevation above TAW datum)
- yw:      TAW m (groundwater table elevation)
- stresses: kPa
- gamma:    kN/m³
- FR / F:  % (friction ratio / normalised friction ratio)
- Dr:      % (relative density)
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from groundmodel.domain.services.robertson_2015_constants import (
    DEFAULT_GWT_DEPTH_M,
    ZONE_X1,
    ZONE_X2,
    ZONE_X3,
    ZONE_X4,
    ZONE_X5,
    ZONE_X6,
    ZONE_X7,
    ZONE_Y1,
    ZONE_Y2,
    ZONE_Y3,
    ZONE_Y4,
    ZONE_Y5,
    ZONE_Y6,
    ZONE_Y7,
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

# log10-domain zone-boundary arrays for vectorised numpy.interp calls.
# Sorted ascending by X (each chart-boundary X array is monotone, which
# ``numpy.interp`` requires).
_ZX = [
    np.asarray(ZONE_X1, dtype=np.float64),
    np.asarray(ZONE_X2, dtype=np.float64),
    np.asarray(ZONE_X3, dtype=np.float64),
    np.asarray(ZONE_X4, dtype=np.float64),
    np.asarray(ZONE_X5, dtype=np.float64),
    np.asarray(ZONE_X6, dtype=np.float64),
    np.asarray(ZONE_X7, dtype=np.float64),
]
_ZY = [
    np.asarray(ZONE_Y1, dtype=np.float64),
    np.asarray(ZONE_Y2, dtype=np.float64),
    np.asarray(ZONE_Y3, dtype=np.float64),
    np.asarray(ZONE_Y4, dtype=np.float64),
    np.asarray(ZONE_Y5, dtype=np.float64),
    np.asarray(ZONE_Y6, dtype=np.float64),
    np.asarray(ZONE_Y7, dtype=np.float64),
]


def _zone_threshold(zone_index: int, log10_f: float) -> float:
    """Evaluate Z[zone_index] = 10**interp(X[i], Y[i], log10(F)).

    Parameters
    ----------
    zone_index : int
        0-based index into the seven boundary arrays (0 = Z1 … 6 = Z7).
    log10_f : float
        log10(F) where F is the normalised friction ratio in %.

    Returns
    -------
    float
        Boundary Q_tn value.  Points whose Q_tn EXCEED this value are
        ABOVE the boundary (i.e. in a higher-numbered zone).
    """
    return float(10.0 ** np.interp(log10_f, _ZX[zone_index], _ZY[zone_index]))


# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------


def unit_weight(qc_mpa: float, fs_mpa: float) -> float | None:
    """Estimate bulk unit weight from CPT data (Robertson & Cabal 2010).

    Formula (Robertson & Cabal 2010, "Estimating soil unit weight from CPT"):
    ``gamma = 9.81 * (0.27*log10(FR) + 0.36*log10(qc/0.1) + 1.236)``
    where ``FR = fs/qc * 100``.

    Returns ``None`` when the result is mathematically undefined (qc ≤ 0,
    fs ≤ 0, or FR ≤ 0 — log10 of a non-positive number). The caller
    (``stress_profile``) forward-fills ``None`` values from the next-deeper
    valid point, so a short undefined stretch never breaks the integration.

    Parameters
    ----------
    qc_mpa : float
        Cone tip resistance in MPa.
    fs_mpa : float
        Sleeve friction in MPa.

    Returns
    -------
    float | None
        Bulk unit weight in kN/m³, or ``None`` when undefined.
    """
    if qc_mpa <= 0.0 or fs_mpa <= 0.0:
        # FR = fs/qc → division by zero or log10 of non-positive
        return None
    fr = fs_mpa / qc_mpa * 100.0
    if fr <= 0.0:
        return None
    # Guard: log10(qc/0.1) undefined when qc ≤ 0 — already covered above.
    return 9.81 * (0.27 * math.log10(fr) + 0.36 * math.log10(qc_mpa / 0.1) + 1.236)


@dataclass(frozen=True)
class StressResult:
    """Vertical stress state at one depth-point.

    Attributes
    ----------
    stot_kpa : float
        Total vertical stress in kPa.
    pwp_kpa : float
        Pore water pressure in kPa.
    seff_kpa : float
        Effective vertical stress in kPa (stot - pwp).
    gamma_kNm3 : float
        Bulk unit weight used at this point in kN/m³.
    """

    stot_kpa: float
    pwp_kpa: float
    seff_kpa: float
    gamma_kNm3: float


def stress_profile(
    depths_m: Sequence[float],
    qc_mpa: Sequence[float],
    fs_mpa: Sequence[float | None],
    niveau_m: float,
    yw_m: float,
    gunsat_kNm3: float = 16.0,
    gwater_kNm3: float = 9.81,
) -> list[StressResult]:
    """Compute total/effective vertical stress profile for a CPT column.

    Handles the three water-table positions (above ground, within the
    column, below the column) and the unit-weight forward-fill.

    The integration step is the actual depth increment between consecutive
    measurement points (rather than a fixed 0.1 m) — the CPT
    series in the DB is already depth-tagged so we use the recorded increment
    directly.

    Three water-position cases:
    1. ``Niveau - yw ≤ 0``: water level is at or above ground surface.
    2. ``0 < Niveau - yw ≤ depths_m[0]``: water level between surface and
       first measurement point.
    3. ``Niveau - yw > depths_m[0]``: water level below first measurement
       point.

    Parameters
    ----------
    depths_m : Sequence[float]
        Measurement depths in metres below ground surface, ascending (≥ 0).
    qc_mpa : Sequence[float]
        Cone resistance in MPa, one per depth point.
    fs_mpa : Sequence[float | None]
        Sleeve friction in MPa, or ``None`` for missing measurements.
    niveau_m : float
        Ground surface elevation in TAW (m).  CPT depths are measured from
        this surface downward.
    yw_m : float
        Groundwater table elevation in TAW (m).
    gunsat_kNm3 : float
        Unit weight of soil above the water table (default 16 kN/m³).
    gwater_kNm3 : float
        Unit weight of water (default 9.81 kN/m³).

    Returns
    -------
    list[StressResult]
        One StressResult per depth point, same length as ``depths_m``.
    """
    n_pts = len(depths_m)
    if n_pts == 0:
        return []

    # --- Unit weights (with NaN forward-fill from next-deeper valid point) ---
    # Loop from the second-to-last element DOWN to the first, checking
    # whether each value is NaN and replacing it with the value just below it.
    # Effectively a backward-fill (fill with the next-deeper valid value).
    gammas: list[float | None] = []
    for k in range(n_pts):
        fs_k = fs_mpa[k]
        gammas.append(unit_weight(qc_mpa[k], fs_k if fs_k is not None else 0.0))
    # Forward-pass: find the deepest valid gamma to seed backward fill.
    # If ALL points are None we default to gunsat (can't integrate at all).
    seed: float = gunsat_kNm3
    for g in reversed(gammas):
        if g is not None:
            seed = g
            break
    # Backward-fill: fill unitw(j) with unitw(j+1) when unitw(j) is undefined.
    # Walk from second-to-last DOWN to first (index 0).
    filled: list[float] = [0.0] * n_pts
    last_g = gammas[n_pts - 1]
    filled[n_pts - 1] = last_g if last_g is not None else seed
    for k in range(n_pts - 2, -1, -1):
        g_k = gammas[k]
        filled[k] = g_k if g_k is not None else filled[k + 1]

    # --- TAW-coordinate depths (level = ground level - depth) ---
    niv = [niveau_m - d for d in depths_m]  # TAW elevation of each point

    # --- Total stress integration + pore pressure (three water-position cases) ---
    stot = [0.0] * n_pts
    pwp = [0.0] * n_pts
    depth_above_water = niveau_m - yw_m  # positive → water below surface

    if depth_above_water <= 0.0:
        # Case 1: water at or above ground surface.
        # stot[0] = depth[0] * gamma[0]  (saturated from the top)
        # pwp[i]  = depth[i] * gwater (pressure zero at ground surface)
        stot[0] = depths_m[0] * filled[0]
        for k in range(1, n_pts):
            xint_k = depths_m[k] - depths_m[k - 1]
            stot[k] = stot[k - 1] + 0.5 * (filled[k - 1] + filled[k]) * xint_k
        for k in range(n_pts):
            pwp[k] = depths_m[k] * gwater_kNm3

    elif depth_above_water <= depths_m[0]:
        # Case 2: water level between ground surface and first data point.
        # stot[0] = gunsat*(Niveau - yw) + unitw[0]*(yw - Niv[0])
        # pwp[i]  = (yw - Niv[i]) * gwater
        stot[0] = gunsat_kNm3 * depth_above_water + filled[0] * (yw_m - niv[0])
        for k in range(1, n_pts):
            xint_k = depths_m[k] - depths_m[k - 1]
            stot[k] = stot[k - 1] + 0.5 * (filled[k - 1] + filled[k]) * xint_k
        for k in range(n_pts):
            pwp[k] = (yw_m - niv[k]) * gwater_kNm3

    else:
        # Case 3: water level is below the first data point.
        # n = floor((level - yw - depth[0]) / xint), at least 1.
        # For the array case we identify the last point still above the water
        # table and integrate with gunsat up to that point.
        n_above = sum(1 for d in depths_m if d < depth_above_water)
        n_above = max(n_above, 1)  # at least one increment
        for k in range(n_above):
            stot[k] = depths_m[k] * gunsat_kNm3
        for k in range(n_above, n_pts):
            xint_k = depths_m[k] - depths_m[k - 1]
            stot[k] = stot[k - 1] + 0.5 * (filled[k - 1] + filled[k]) * xint_k
            pwp[k] = gwater_kNm3 * (yw_m - niv[k])

    seff = [max(stot[k] - pwp[k], 0.001) for k in range(n_pts)]
    # Floor effective stress at 0.001 kPa — the normalisation assumes seff > 0
    # (it appears in division and as exponent base). Near-surface points above
    # the water table can produce seff ≈ 0; floor prevents division-by-zero
    # and log-domain undefined behaviour.

    return [
        StressResult(
            stot_kpa=stot[k],
            pwp_kpa=pwp[k],
            seff_kpa=seff[k],
            gamma_kNm3=filled[k],
        )
        for k in range(n_pts)
    ]


@dataclass(frozen=True)
class QtnResult:
    """Converged Robertson-2015 normalised parameters for one depth point.

    Attributes
    ----------
    qtn : float
        Normalised tip resistance Q_tn (dimensionless).
    f_pct : float
        Normalised friction ratio F in %.
    ic : float
        Soil behaviour type index Ic.
    n_stress : float
        Converged stress-exponent n (0..1).
    """

    qtn: float
    f_pct: float
    ic: float
    n_stress: float


def qtn_f_ic_series(
    depths_m: Sequence[float],
    qc_mpa: Sequence[float],
    fs_mpa: Sequence[float | None],
    stress: Sequence[StressResult],
    max_iter: int = 200,
    convergence_tol: float = 0.002,
) -> list[QtnResult | None]:
    """Iterative Robertson (2015) stress-normalisation — Q_tn / F / Ic / n.

    Iterates the stress exponent n as in Robertson (2009). Convergence
    criterion: ``|n_new - n_old| < 0.002``.

    Formulas (verbatim):
    ``Q_tn = ((qc*1000 - stot)/100) * (100/seff)**n``
    ``F    = fs*100000 / (qc*1000 - stot)``
    ``Ic   = sqrt((3.47 - log10(Qtn))**2 + (log10(F) + 1.22)**2)``
    ``n    = clamp(0.381*Ic + 0.05*(seff/100) - 0.15, 0, 1)``

    Parameters
    ----------
    depths_m : Sequence[float]
        Depths in metres (used only for length/index alignment).
    qc_mpa : Sequence[float]
        Cone resistance in MPa.
    fs_mpa : Sequence[float | None]
        Sleeve friction in MPa; ``None`` yields ``None`` in the output.
    stress : Sequence[StressResult]
        Pre-computed stress profile (same length, from ``stress_profile``).
    max_iter : int
        Safety cap on convergence iterations (default 200; the published procedure has no cap
        — in practice ≤ 5 iterations suffice for any real CPT).
    convergence_tol : float
        Convergence threshold on n (default 0.002).

    Returns
    -------
    list[QtnResult | None]
        One entry per depth point.  ``None`` when the computation is
        undefined (missing fs, non-positive net cone resistance, or
        non-positive F).
    """
    results: list[QtnResult | None] = []

    for k in range(len(depths_m)):
        qc = qc_mpa[k]
        fs = fs_mpa[k]
        sr = stress[k]

        if fs is None:
            results.append(None)
            continue

        qc_kpa = qc * 1000.0
        # F = fs[MPa]*100000 / (qc[MPa]*1000 - stot[kPa]) — Robertson (2009), in %.
        # The *100000 numerator factor (vs *1000 MPa→kPa) carries the ×100
        # that turns the ratio into a percentage: F = fs_kpa*100 / net_qc_kpa
        # = the Robertson (2009) normalised friction ratio F [%]. Kept as the
        # verbatim ``fs * 100000.0`` to match the source exactly.
        net_qc_kpa = qc_kpa - sr.stot_kpa
        if net_qc_kpa <= 0.0:
            # qc*1000 ≤ stot → log10(Qtn) undefined (Qtn ≤ 0); skip.
            # Occurs near the very surface where overburden can exceed qc.
            results.append(None)
            continue

        f_val = (fs * 100000.0) / net_qc_kpa
        if f_val <= 0.0:
            # F ≤ 0 → log10(F) undefined.
            results.append(None)
            continue

        # Iterative convergence (start n=1)
        n = 1.0
        qtn = 1.0
        ic = 0.0
        for _ in range(max_iter):
            qtn = (net_qc_kpa / 100.0) * (100.0 / sr.seff_kpa) ** n
            if qtn <= 0.0:
                # Guard: seff ≤ 0 already floored at 0.001 in stress_profile,
                # but extreme inputs can still drive net_qc_kpa/100 → tiny.
                qtn = 1e-9
            ic = math.sqrt((3.47 - math.log10(qtn)) ** 2 + (math.log10(f_val) + 1.22) ** 2)
            nn = 0.381 * ic + 0.05 * (sr.seff_kpa / 100.0) - 0.15
            # Clamp to [0, 1] (Robertson 2009: 0 < n <= 1)
            nn = max(0.0, min(1.0, nn))
            if abs(n - nn) < convergence_tol:
                n = nn
                break
            n = nn

        results.append(QtnResult(qtn=qtn, f_pct=f_val, ic=ic, n_stress=n))

    return results


def sbt_zone_series(qtn_results: Sequence[QtnResult | None]) -> list[int | None]:
    """Assign Robertson (2009) chart zone ST 1..9 per depth point.

    Implements the Robertson (2015) zone ladder and
    line 302 (Z8 peat boundary, Lengkeek & Brinkgreve 2022) VERBATIM.

    Zone definitions (Robertson 2015 chart labels):
    1 = Sensitive fine-grained
    2 = Organic soil / clay  (incl. peat extension, Lengkeek & Brinkgreve 2022)
    3 = Clay to silty clay
    4 = Clayey silt to silty clay
    5 = Silty sand to sandy silt
    6 = Clean sand to silty sand
    7 = Gravelly sand to dense sand
    8 = Stiff sand to clayey sand  (very stiff, OC)
    9 = Stiff fine-grained soil   (very stiff, OC)

    Parameters
    ----------
    qtn_results : Sequence[QtnResult | None]
        Converged normalised parameters from ``qtn_f_ic_series``.

    Returns
    -------
    list[int | None]
        ST zone (1..9) for each depth point, or ``None`` when the input is
        ``None`` (undefined/skipped point).
    """
    zones: list[int | None] = []

    for r in qtn_results:
        if r is None:
            zones.append(None)
            continue

        f = r.f_pct
        qtn = r.qtn

        # Guard: F ≤ 0 should not reach here (filtered in qtn_f_ic_series),
        # but be defensive.
        if f <= 0.0:
            zones.append(None)
            continue

        log10_f = math.log10(f)

        z = [_zone_threshold(i, log10_f) for i in range(7)]
        # Peat boundary (Lengkeek & Brinkgreve 2022):
        # ``if F <= 5.2 then Z8=0; else Z8=8*(F-5.2)**0.5; end``
        z8 = 0.0 if f <= 5.2 else 8.0 * (f - 5.2) ** 0.5

        # Zone ladder (Robertson 2015):
        if qtn <= z[0]:
            st = 1
        elif qtn > z[0] and qtn < z[1] and (qtn < z[2] or qtn < z8):
            # Zone 2: including peat-zone extension (Lengkeek & Brinkgreve 2022)
            st = 2
        elif qtn > z[0] and qtn < z[1] and qtn >= z[2] and qtn < z[3]:
            st = 3
        elif qtn > z[0] and qtn < z[1] and qtn >= z[3] and qtn < z[4]:
            st = 4
        elif qtn > z[0] and qtn < z[1] and qtn >= z[4] and qtn < z[5]:
            st = 5
        elif qtn >= z[5] and qtn < z[6] and qtn < z[1]:
            st = 6
        elif qtn >= z[6] and qtn < z[1]:
            st = 7
        elif qtn >= z[1] and qtn >= z[4]:
            st = 8
        elif qtn >= z[1] and qtn < z[4]:
            st = 9
        else:
            # Exhaustive — the nine conditions above cover the entire Qtn×F plane.
            # A point can only fall through if Qtn ≤ 0 (already guarded above).
            st = 1  # conservative fallback

        zones.append(st)

    return zones


def relative_density_sand(
    qc_mpa: float,
    seff_kpa: float,
    compression_factor: float = 0.675,
) -> float | None:
    """Estimate sand relative density Dr [%] (Jamiolkowski et al. 2003).

    Formula (verbatim):
    ``Dr = 100 * (0.268 * ln((qc/0.1) / (seff/100)**0.5) - 0.675)``
    where 0.675 is the average compression factor; 0.525 = high-compress
    (calcareous sands) and 0.825 = low-compress (quartz sands).

    ONLY valid when the point's SBT satisfies ``Ic < 2.45 AND FR < 1.2``
    (the caller must check this condition — the function does NOT re-check
    the SBT membership; it only guards the math).

    Parameters
    ----------
    qc_mpa : float
        Cone resistance in MPa.
    seff_kpa : float
        Effective vertical stress in kPa.
    compression_factor : float
        Compression sensitivity factor (default 0.675 = average quartz sand;
        use 0.525 for high-compressible / calcareous, 0.825 for low-
        compressible / quartz sands per Jamiolkowski et al. 2003, as tabulated in
        Robertson & Cabal's Guide to Cone Penetration Testing).

    Returns
    -------
    float | None
        Relative density in %, or ``None`` when the inputs are undefined
        (qc ≤ 0, seff ≤ 0, or the logarithm argument is non-positive).

    Raises
    ------
    ValueError
        When ``compression_factor`` is outside the physically meaningful range
        (0.1, 2.0) — catches accidental unit errors.
    """
    if not (0.1 < compression_factor < 2.0):
        raise ValueError(
            f"compression_factor {compression_factor!r} outside (0.1, 2.0) — "
            "typical values: 0.525 / 0.675 / 0.825"
        )
    if qc_mpa <= 0.0 or seff_kpa <= 0.0:
        return None
    ratio = (qc_mpa / 0.1) / (seff_kpa / 100.0) ** 0.5
    if ratio <= 0.0:
        # Defensive guard — (qc/0.1) ≥ 0 and (seff/100)**0.5 ≥ 0, so
        # this can only occur when seff is extremely large. Avoid log(0).
        return None
    return 100.0 * (0.268 * math.log(ratio) - compression_factor)


def ic_series_2015(
    depths_m: Sequence[float],
    qc_mpa: Sequence[float],
    fs_mpa: Sequence[float | None],
    gwt_m: float = DEFAULT_GWT_DEPTH_M,
) -> list[float | None]:
    """High-level wrapper: per-depth-point Ic via the Robertson 2015 pipeline.

    Mirrors the signature of the older ``cpt_interpretation.calculate_ic_series``
    so call sites can swap one for the other without reshaping their inputs.
    Internally builds the unit-weight + stress profile and runs the iterative
    Qtn / F / Ic / n convergence — the same path the litho segmenter uses.

    Debt #22 reconciliation (2026-05-21): the CPT detail chart's ``/cpt/{id}/plot``
    endpoint now sources Ic from THIS function instead of the Robertson 1990
    preview in ``cpt_interpretation.calculate_ic_series``, so the whole app
    (segmenter + chart) is consistent on the Robertson 2015/2009 method.

    Parameters
    ----------
    depths_m : Sequence[float]
        Measurement depths in metres below ground surface, ascending.
    qc_mpa : Sequence[float]
        Cone resistance in MPa, parallel to ``depths_m``.
    fs_mpa : Sequence[float | None]
        Sleeve friction in MPa; ``None`` rows yield ``None`` in the output.
    gwt_m : float
        Depth to groundwater below ground surface in metres.  Defaults to
        ``DEFAULT_GWT_DEPTH_M`` — the single project-wide assumption used by
        every consumer that has no recorded water table (see the constant's
        comment for why the chart and the segmenter must not diverge here).

    Returns
    -------
    list[float | None]
        Ic per depth point.  ``None`` where ``fs`` is missing or the
        convergence cannot produce a valid result.  Same length as
        ``depths_m``.
    """
    if not depths_m:
        return []
    # The stress profile takes ABSOLUTE elevations (niveau_m, yw_m).  The
    # only quantity that drives the three water-position branches is the
    # difference ``niveau - yw``, which equals the depth to water (gwt_m).
    # Picking niveau=0 and yw=-gwt_m makes that difference equal to gwt_m
    # without needing the surveyed ground elevation — useful for CPTs that
    # have no ``elevation_m`` recorded.
    stress = stress_profile(
        depths_m=depths_m,
        qc_mpa=qc_mpa,
        fs_mpa=fs_mpa,
        niveau_m=0.0,
        yw_m=-gwt_m,
    )
    results = qtn_f_ic_series(
        depths_m=depths_m,
        qc_mpa=qc_mpa,
        fs_mpa=fs_mpa,
        stress=stress,
    )
    return [r.ic if r is not None else None for r in results]

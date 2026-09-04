"""Numeric pin for the Robertson-2015/2009 port (litho slice 3).

A faithful Scilab→Python port is only trustworthy if the numbers are
pinned. These tests re-derive Qtn / F / Ic / Dr from the published
formulas INDEPENDENTLY of the module implementation (a second hand
computation) and assert agreement to 1e-3, plus SBT-zone sanity for
unambiguous clay / clean-sand / peat inputs and the documented guards.
Pure unit — no DB, no I/O.
"""

from __future__ import annotations

import math

import pytest

from groundmodel.domain.services.robertson_2015 import (
    StressResult,
    ic_series_2015,
    qtn_f_ic_series,
    relative_density_sand,
    sbt_zone_series,
    stress_profile,
    unit_weight,
)


def test_unit_weight_matches_the_robertson_formula() -> None:
    """gamma = 9.81*(0.27*log10(FR) + 0.36*log10(qc/0.1) + 1.236)."""
    qc, fs = 10.0, 0.1  # FR = 1.0 %
    fr = fs / qc * 100.0
    expected = 9.81 * (0.27 * math.log10(fr) + 0.36 * math.log10(qc / 0.1) + 1.236)
    assert unit_weight(qc, fs) == expected


def test_unit_weight_undefined_inputs_return_none() -> None:
    """qc/fs ≤ 0 → None (log10 of non-positive); caller forward-fills."""
    assert unit_weight(0.0, 0.1) is None
    assert unit_weight(10.0, 0.0) is None
    assert unit_weight(-1.0, 0.1) is None


def _independent_qtn_f_ic(
    qc_mpa: float, fs_mpa: float, stot_kpa: float, seff_kpa: float
) -> tuple[float, float, float]:
    """Second, independent implementation of the iterative loop."""
    net = qc_mpa * 1000.0 - stot_kpa
    f = fs_mpa * 100000.0 / net
    n = 1.0
    qtn = ic = 0.0
    for _ in range(200):
        qtn = (net / 100.0) * (100.0 / seff_kpa) ** n
        ic = math.sqrt((3.47 - math.log10(qtn)) ** 2 + (math.log10(f) + 1.22) ** 2)
        nn = max(0.0, min(1.0, 0.381 * ic + 0.05 * (seff_kpa / 100.0) - 0.15))
        if abs(n - nn) < 0.002:
            n = nn
            break
        n = nn
    return qtn, f, ic


def test_qtn_f_ic_matches_an_independent_computation() -> None:
    """The module's iterative Qtn/F/Ic equals a hand reimplementation."""
    # One stiff-sand-ish point and one soft-clay-ish point, fixed stress
    # so the comparison isolates the iteration (not stress_profile).
    cases = [
        # qc, fs, stot, seff
        (20.0, 0.15, 200.0, 120.0),  # sand-like
        (0.8, 0.05, 150.0, 90.0),  # clay-like
    ]
    depths = [1.0, 2.0]
    qc = [c[0] for c in cases]
    fs = [c[1] for c in cases]
    stress = [
        StressResult(stot_kpa=c[2], pwp_kpa=c[2] - c[3], seff_kpa=c[3], gamma_kNm3=18.0)
        for c in cases
    ]
    out = qtn_f_ic_series(depths, qc, fs, stress)
    for i, c in enumerate(cases):
        exp_qtn, exp_f, exp_ic = _independent_qtn_f_ic(c[0], c[1], c[2], c[3])
        assert out[i] is not None
        r = out[i]
        assert r is not None
        assert r.qtn == pytest.approx(exp_qtn, rel=1e-9)
        assert r.f_pct == pytest.approx(exp_f, rel=1e-9)
        assert r.ic == pytest.approx(exp_ic, abs=1e-3)


def test_qtn_f_ic_skips_undefined_points() -> None:
    """Missing fs, or net cone resistance ≤ 0 (overburden > qc near
    surface) → None, never a crash."""
    depths = [0.5, 1.0]
    qc = [0.05, 10.0]  # first point: qc*1000=50 < stot → net ≤ 0
    fs: list[float | None] = [0.01, None]  # second point: fs missing
    stress = [
        StressResult(stot_kpa=100.0, pwp_kpa=0.0, seff_kpa=100.0, gamma_kNm3=18.0),
        StressResult(stot_kpa=20.0, pwp_kpa=0.0, seff_kpa=20.0, gamma_kNm3=18.0),
    ]
    out = qtn_f_ic_series(depths, qc, fs, stress)
    assert out == [None, None]


def test_sbt_zone_clay_vs_clean_sand_vs_peat() -> None:
    """Unambiguous inputs land in the expected Robertson zone bands.

    Clean dense sand → high Qtn, low F → zone 6/7.
    Soft clay → low Qtn, higher F → fine zones 1-3.
    Organic/peat → very low Qtn, very high F → zone 2.
    """
    depths = [1.0, 2.0, 3.0]
    qc = [25.0, 0.5, 0.3]
    fs = [0.1, 0.05, 0.09]
    stress = [
        StressResult(stot_kpa=20.0, pwp_kpa=0.0, seff_kpa=20.0, gamma_kNm3=18.0),
        StressResult(stot_kpa=40.0, pwp_kpa=10.0, seff_kpa=30.0, gamma_kNm3=16.0),
        StressResult(stot_kpa=55.0, pwp_kpa=20.0, seff_kpa=35.0, gamma_kNm3=12.0),
    ]
    zones = sbt_zone_series(qtn_f_ic_series(depths, qc, fs, stress))
    assert zones[0] in (6, 7, 8), f"dense sand → {zones[0]}"
    assert zones[1] in (1, 2, 3, 4), f"soft clay → {zones[1]}"
    assert zones[2] in (1, 2, 3), f"organic/peat → {zones[2]}"


def test_relative_density_matches_the_jamiolkowski_formula() -> None:
    """Dr = 100*(0.268*ln((qc/0.1)/(seff/100)**0.5) - cf)."""
    qc, seff = 15.0, 100.0
    ratio = (qc / 0.1) / (seff / 100.0) ** 0.5
    expected = 100.0 * (0.268 * math.log(ratio) - 0.675)
    got = relative_density_sand(qc, seff)
    assert got is not None
    assert got == expected
    # Compression-factor variants shift Dr by 100*(default - variant).
    low = relative_density_sand(qc, seff, compression_factor=0.825)
    assert low is not None
    assert low == pytest.approx(expected - 100.0 * (0.825 - 0.675))


def test_relative_density_guards() -> None:
    """Undefined inputs → None; absurd compression factor → ValueError."""
    assert relative_density_sand(0.0, 100.0) is None
    assert relative_density_sand(15.0, 0.0) is None
    with pytest.raises(ValueError):
        relative_density_sand(15.0, 100.0, compression_factor=50.0)


def test_stress_profile_water_at_surface_is_buoyant() -> None:
    """Water at ground level: effective stress < total, grows with depth."""
    depths = [1.0, 2.0, 3.0]
    qc = [5.0, 5.0, 5.0]
    fs = [0.05, 0.05, 0.05]
    prof = stress_profile(depths, qc, fs, niveau_m=10.0, yw_m=10.0)
    assert len(prof) == 3
    for p in prof:
        assert p.seff_kpa < p.stot_kpa  # buoyant
        assert p.seff_kpa > 0.0  # floored positive
    assert prof[2].stot_kpa > prof[0].stot_kpa  # monotone with depth


def test_ic_series_2015_empty_input_returns_empty() -> None:
    """Empty depth array short-circuits to an empty result list."""
    assert ic_series_2015([], [], []) == []


def test_ic_series_2015_returns_one_value_per_depth_point() -> None:
    """The wrapper preserves length and produces a numeric Ic for typical inputs."""
    depths = [0.5, 1.0, 1.5, 2.0]
    qc = [5.0, 8.0, 12.0, 18.0]
    fs = [0.05, 0.08, 0.12, 0.18]
    ic = ic_series_2015(depths, qc, fs, gwt_m=1.0)
    assert len(ic) == 4
    for v in ic:
        assert v is not None
        assert 0.5 < v < 4.5  # Ic always lives in roughly this band for real CPTs


def test_ic_series_2015_returns_none_when_fs_is_missing_at_a_row() -> None:
    """A None entry in fs propagates to None in the Ic output (per QtnResult contract)."""
    depths = [0.5, 1.0, 1.5]
    qc = [5.0, 8.0, 12.0]
    fs = [0.05, None, 0.12]
    ic = ic_series_2015(depths, qc, fs, gwt_m=1.0)
    assert len(ic) == 3
    assert ic[1] is None
    assert ic[0] is not None
    assert ic[2] is not None

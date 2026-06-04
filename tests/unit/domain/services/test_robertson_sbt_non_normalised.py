"""Tests for the non-normalised Robertson SBT (I_SBT) classifier.

The non-normalised soil-behaviour-type index (Robertson 2010) needs no stress
profile, no groundwater table, and no iteration — it reads qc/pa and Rf
directly. It is the right classifier at shallow depth or when the effective-
stress profile is unreliable. These tests re-derive I_SBT from the published
formula independently of the implementation (the behaviour, not the code path)
and pin the zone-boundary mapping.

I_SBT = sqrt[(3.47 - log10(qc/pa))^2 + (log10(Rf) + 1.22)^2]
  with Rf = (fs/qc)*100  and  pa = 0.1 MPa (atmospheric pressure).
"""

from __future__ import annotations

import math

import pytest

from groundmodel.domain.services.robertson_sbt_non_normalised import (
    i_sbt,
    i_sbt_to_zone,
    sbt_zone_series_non_normalised,
)


def _i_sbt_reference(qc_mpa: float, fs_mpa: float) -> float:
    """Independent re-derivation of I_SBT straight from the Robertson formula."""
    rf = fs_mpa / qc_mpa * 100.0
    qc_pa = qc_mpa / 0.1  # qc / atmospheric pressure (both in MPa)
    return math.sqrt((3.47 - math.log10(qc_pa)) ** 2 + (math.log10(rf) + 1.22) ** 2)


def test_i_sbt_matches_the_published_formula() -> None:
    """i_sbt reproduces the closed-form I_SBT for a representative sand point."""
    qc, fs = 12.0, 0.06  # clean-ish sand: high qc, low sleeve friction
    assert i_sbt(qc, fs) == pytest.approx(_i_sbt_reference(qc, fs), abs=1e-9)


def test_clean_sand_lands_in_a_sand_zone() -> None:
    """A high-qc / low-Rf point is classified as sand (zone 6 or 7)."""
    zone = i_sbt_to_zone(i_sbt(20.0, 0.04))  # type: ignore[arg-type]
    assert zone in (6, 7)


def test_soft_clay_lands_in_a_clay_zone() -> None:
    """A low-qc / high-Rf point is classified as clay/organic (zone >= 3)."""
    zone = i_sbt_to_zone(i_sbt(0.6, 0.05))  # type: ignore[arg-type]
    assert zone >= 3


def test_zone_boundaries_are_robertson_2010() -> None:
    """Each I_SBT band maps to the Robertson 2010 zone (7=coarsest .. 2=organic)."""
    assert i_sbt_to_zone(1.0) == 7
    assert i_sbt_to_zone(1.31 + 1e-9) == 6
    assert i_sbt_to_zone(2.05 + 1e-9) == 5
    assert i_sbt_to_zone(2.60 + 1e-9) == 4
    assert i_sbt_to_zone(2.95 + 1e-9) == 3
    assert i_sbt_to_zone(3.60 + 1e-9) == 2


def test_undefined_points_yield_none() -> None:
    """qc<=0, fs<=0, or missing fs are mathematically undefined → None."""
    assert i_sbt(0.0, 0.05) is None
    assert i_sbt(2.0, 0.0) is None
    assert i_sbt(2.0, None) is None


def test_series_preserves_length_and_none_alignment() -> None:
    """The series classifier returns one zone (or None) per input row, in order."""
    qc = [10.0, 0.5, -1.0, 8.0]
    fs = [0.05, 0.06, 0.02, None]
    zones = sbt_zone_series_non_normalised(qc, fs)
    assert len(zones) == 4
    assert zones[0] in (5, 6, 7)  # sand-ish
    assert zones[1] in (2, 3, 4)  # fine-grained (clay/silt/organic)
    assert zones[2] is None  # qc <= 0
    assert zones[3] is None  # fs missing

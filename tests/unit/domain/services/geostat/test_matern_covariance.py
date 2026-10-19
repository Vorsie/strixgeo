"""Matérn-3/2: full covariance at distance 0, about half at one range, nearly none at ten ranges."""

from __future__ import annotations

import math

import numpy as np

from groundmodel.domain.services.geostat.matern_covariance import (
    expected_absolute_difference,
    matern32_covariance,
    matern32_covariance_dlog_range,
    pairwise_distances,
    semivariogram,
)
from groundmodel.domain.value_objects.covariance_model import CovarianceModel


def test_covariance_at_zero_one_and_ten_ranges() -> None:
    """C(0) = s; C(r) = s(1+√3)e^-√3 ≈ 0.4833 s; C(10 r) is practically zero."""
    s, r = 4.0, 200.0
    c = matern32_covariance(np.array([0.0, r, 10 * r]), s, r)
    assert math.isclose(c[0], 4.0)
    assert math.isclose(c[1], 4.0 * (1 + math.sqrt(3)) * math.exp(-math.sqrt(3)), rel_tol=1e-12)
    assert c[2] < 4.0 * 1e-6


def test_range_derivative_matches_finite_difference() -> None:
    """∂C/∂log r = s a² e^-a with a = √3 h / r."""
    h = np.array([5.0, 50.0, 300.0])
    s, r, eps = 2.0, 120.0, 1e-6
    numeric = (
        matern32_covariance(h, s, r * math.exp(eps)) - matern32_covariance(h, s, r * math.exp(-eps))
    ) / (2 * eps)
    np.testing.assert_allclose(matern32_covariance_dlog_range(h, s, r), numeric, rtol=1e-6)


def test_pairwise_distances() -> None:
    """Plain Euclidean distances in the horizontal plane."""
    a = np.array([[0.0, 0.0], [3.0, 4.0]])
    np.testing.assert_allclose(pairwise_distances(a, a), [[0.0, 5.0], [5.0, 0.0]])


def test_semivariogram_and_expected_difference() -> None:
    """γ(h) = n + s - C(h); expected |difference| = √(2γ + floors) · √(2/π)."""
    model = CovarianceModel(sill_m2=1.0, range_m=100.0, nugget_m2=0.04)
    gamma = semivariogram(np.array([0.0, 1e6]), model)
    np.testing.assert_allclose(gamma, [0.04, 1.04], atol=1e-12)
    diff = expected_absolute_difference(np.array([0.0]), model, pick_noise_m2=0.02)
    assert math.isclose(diff[0], math.sqrt(2 * 0.04 + 0.02) * math.sqrt(2 / math.pi))

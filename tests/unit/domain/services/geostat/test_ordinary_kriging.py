"""Ordinary kriging against an example worked out by hand.

Two data points, one target. Covariance between the data K = [[1, 0.5], [0.5, 1]];
covariance data -> target k = [0.8, 0.2]; sill (prior variance) 1; values z = [1, 3].

By hand:
  K⁻¹ = (4/3)·[[1, -0.5], [-0.5, 1]]
  K⁻¹k = (4/3)·[0.7, -0.2] = [14/15, -4/15];  K⁻¹1 = [2/3, 2/3];  1ᵀK⁻¹1 = 4/3
  u = 1 - 1ᵀK⁻¹k = 1 - 10/15 = 1/3
  weights w = K⁻¹k + K⁻¹1 · u / (1ᵀK⁻¹1) = [14/15 + 1/6, -4/15 + 1/6] = [1.1, -0.1]  (sum 1)
  guess = 1.1·1 - 0.1·3 = 0.8
  variance = 1 - kᵀK⁻¹k + u²/(1ᵀK⁻¹1) = 1 - 10.4/15 + (1/9)/(4/3) = 0.39
A negative weight is correct: the far point is "screened" by the near one.
"""

from __future__ import annotations

import math

import numpy as np

from groundmodel.domain.services.geostat.ordinary_kriging import ordinary_kriging


def test_hand_worked_example() -> None:
    """Weights, guess and variance equal the paper calculation in the module docstring."""
    k_data = np.array([[1.0, 0.5], [0.5, 1.0]])
    k_target = np.array([0.8, 0.2])
    value, variance, weights = ordinary_kriging(k_data, k_target, np.array([1.0, 3.0]), 1.0)
    np.testing.assert_allclose(weights, [1.1, -0.1], atol=1e-12)
    assert math.isclose(weights.sum(), 1.0)
    assert math.isclose(value, 0.8, abs_tol=1e-12)
    assert math.isclose(variance, 0.39, abs_tol=1e-12)


def test_symmetric_target_gets_equal_votes() -> None:
    """A target equally far from two points takes their mean; variance 0.75 by hand."""
    value, variance, weights = ordinary_kriging(
        np.array([[1.0, 0.5], [0.5, 1.0]]), np.array([0.5, 0.5]), np.array([1.0, 3.0]), 1.0
    )
    np.testing.assert_allclose(weights, [0.5, 0.5])
    assert math.isclose(value, 2.0)
    assert math.isclose(variance, 0.75)

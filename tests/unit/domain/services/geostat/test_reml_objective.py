"""The REML gradient must equal the slope you measure by nudging each parameter."""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.geostat.matern_covariance import pairwise_distances
from groundmodel.domain.services.geostat.reml_objective import reml_objective


def _case() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(3)
    xy = rng.uniform(0.0, 400.0, size=(12, 2))
    values = -3.0 + 0.004 * xy[:, 0] + rng.normal(0.0, 0.2, size=12)
    floors = np.full(12, 0.10**2)
    return pairwise_distances(xy, xy), values, floors


def test_gradient_matches_central_differences() -> None:
    """Analytic ∂/∂(log s, log r, log n) equals central differences to 1e-5 relative."""
    dist, values, floors = _case()
    x = np.log([1.5, 150.0, 0.02])
    _, grad = reml_objective(x, dist, values, floors)
    eps = 1e-6
    numeric = []
    for j in range(3):
        step = np.zeros(3)
        step[j] = eps
        up, _ = reml_objective(x + step, dist, values, floors)
        down, _ = reml_objective(x - step, dist, values, floors)
        numeric.append((up - down) / (2 * eps))
    np.testing.assert_allclose(grad, numeric, rtol=1e-5, atol=1e-7)


def test_non_positive_definite_returns_large_value() -> None:
    """A broken matrix must not crash the optimiser; it gets a large value and zero slope."""
    dist, values, floors = _case()
    value, grad = reml_objective(np.log([1.0, 100.0, 1e-6]), dist, values, floors * 0 - 1.0)
    assert value >= 1e10
    np.testing.assert_array_equal(grad, np.zeros(3))

"""The fit stays inside its box, respects a warm start and refuses broken input."""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.domain.services.geostat.fit_covariance_model import fit_covariance_model
from groundmodel.domain.services.geostat.geostat_constants import RANGE_BOUNDS_M
from groundmodel.domain.services.geostat.matern_covariance import pairwise_distances
from groundmodel.shared.exceptions import GeostatFitError


def _smooth_field(n: int = 15) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(11)
    xy = rng.uniform(0.0, 600.0, size=(n, 2))
    values = -4.0 + 1.5 * np.sin(xy[:, 0] / 150.0) + rng.normal(0.0, 0.05, size=n)
    return pairwise_distances(xy, xy), values, np.full(n, 0.10**2)


def test_fit_inside_bounds_and_finds_a_smooth_field() -> None:
    """A smooth field with little noise gives a range inside the box and a small nugget."""
    dist, values, floors = _smooth_field()
    model = fit_covariance_model(dist, values, floors)
    assert RANGE_BOUNDS_M[0] <= model.range_m <= RANGE_BOUNDS_M[1]
    assert model.nugget_m2 < 0.1


def test_warm_start_from_a_previous_fit_is_accepted() -> None:
    """A refit from the full fit lands at (almost) the same model."""
    dist, values, floors = _smooth_field()
    full = fit_covariance_model(dist, values, floors)
    again = fit_covariance_model(dist, values, floors, start=full.log_params(), max_iterations=30)
    assert abs(np.log(again.range_m) - np.log(full.range_m)) < 0.05


def test_non_finite_values_are_refused() -> None:
    """A NaN elevation is a loading bug, not something to fit."""
    dist, values, floors = _smooth_field()
    values[0] = np.nan
    with pytest.raises(GeostatFitError):
        fit_covariance_model(dist, values, floors)

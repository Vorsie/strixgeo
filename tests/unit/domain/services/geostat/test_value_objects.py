"""Value objects of the pick consistency check carry what the banner needs."""

from __future__ import annotations

import math

import numpy as np
import pytest

from groundmodel.domain.services.geostat.geostat_constants import (
    MIN_PICKS,
    PICK_NOISE_FLOOR_M,
    Z_FLAG,
)
from groundmodel.domain.value_objects.covariance_model import CovarianceModel
from groundmodel.domain.value_objects.formation_pick_check import FormationPickCheck
from groundmodel.domain.value_objects.pick_observation import PickObservation


def test_owner_floors_and_thresholds() -> None:
    """Owner ruling 2026-10-19: borehole ±0.25 m, CPT ±0.10 m; flag above 3σ; at least 6 picks."""
    assert PICK_NOISE_FLOOR_M == {"cpt": 0.10, "borehole": 0.25}
    assert Z_FLAG == 3.0
    assert MIN_PICKS == 6


def test_covariance_model_log_params_round_trip() -> None:
    """The optimiser works on log parameters; the model must give them back exactly."""
    model = CovarianceModel(sill_m2=4.0, range_m=210.0, nugget_m2=0.01)
    np.testing.assert_allclose(np.exp(model.log_params()), [4.0, 210.0, 0.01])


def test_value_objects_are_frozen() -> None:
    """Results are shared between the cache and the API; nobody may mutate them."""
    pick = PickObservation("c1", "i1", "cpt", "S16", 0.0, 0.0, -4.15, 0.10)
    check = FormationPickCheck(
        status="too_few_picks", n_picks=1, model=None, coverage_90=None, flags=()
    )
    with pytest.raises(AttributeError):
        pick.elevation_m = 0.0  # type: ignore[misc]
    with pytest.raises(AttributeError):
        check.status = "checked"  # type: ignore[misc]
    assert math.isclose(pick.noise_floor_m, 0.10)

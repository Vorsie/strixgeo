"""Leave-one-out pick consistency check with refit (spec §4.4).

For each pick: refit the covariance model WITHOUT it (warm start at the full fit),
krige its elevation from the others, and compare. z = (pick - guess) / σ with
σ² = kriging variance + the pick's own noise (floor² + nugget). |z| > 3 → flag.

Why refit: a single fit on all picks lets a wrong pick inflate the nugget, which then
makes that same pick look normal (worked example: B16 z 1.9 single fit, 5.4 refit).
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

from groundmodel.domain.services.geostat.fit_covariance_model import fit_covariance_model
from groundmodel.domain.services.geostat.geostat_constants import (
    COVERAGE_Z,
    MIN_PICKS,
    REFIT_MAX_ITERATIONS,
    STATUS_CHECKED,
    STATUS_FIT_FAILED,
    STATUS_TOO_FEW_PICKS,
    Z_FLAG,
)
from groundmodel.domain.services.geostat.matern_covariance import (
    matern32_covariance,
    pairwise_distances,
)
from groundmodel.domain.services.geostat.ordinary_kriging import ordinary_kriging
from groundmodel.domain.value_objects.covariance_model import CovarianceModel
from groundmodel.domain.value_objects.formation_pick_check import FormationPickCheck
from groundmodel.domain.value_objects.pick_flag import PickFlag
from groundmodel.domain.value_objects.pick_observation import PickObservation
from groundmodel.shared.exceptions import GeostatFitError


def _predict_held_out(
    index: int,
    keep: np.ndarray,
    kept_distances: np.ndarray,
    model: CovarianceModel,
    distances: np.ndarray,
    values: np.ndarray,
    floor_m2: np.ndarray,
) -> tuple[float, float]:
    """Return the guess and σ for pick ``index`` from all other picks under ``model``.

    ``keep`` (mask of the other picks) and ``kept_distances`` (their distance
    submatrix) are built once per held-out pick by the caller and shared with the
    refit, so neither is rebuilt here.
    """
    k_data = matern32_covariance(kept_distances, model.sill_m2, model.range_m)
    k_data = k_data + np.diag(floor_m2[keep] + model.nugget_m2)
    k_target = matern32_covariance(distances[index, keep], model.sill_m2, model.range_m)
    guess, variance, _ = ordinary_kriging(k_data, k_target, values[keep], model.sill_m2)
    sigma = math.sqrt(variance + floor_m2[index] + model.nugget_m2)
    return guess, sigma


def check_formation_picks(
    picks: Sequence[PickObservation], *, refit: bool = True
) -> FormationPickCheck:
    """Flag picks of one formation that do not fit their neighbours.

    Parameters
    ----------
    picks : Sequence[PickObservation]
        All picks of the formation that feed the model.
    refit : bool, optional
        Refit the model without each held-out pick (default). ``False`` reproduces the
        masking trap and exists for the test and the manual figure only.

    Returns
    -------
    FormationPickCheck
        ``too_few_picks`` below ``MIN_PICKS``, ``fit_failed`` with a reason, else ``checked``.
    """
    count = len(picks)
    if count < MIN_PICKS:
        return FormationPickCheck(STATUS_TOO_FEW_PICKS, count, None, None, ())
    positions = np.array([[p.x_m, p.y_m] for p in picks])
    values = np.array([p.elevation_m for p in picks])
    floor_m2 = np.array([p.noise_floor_m**2 for p in picks])
    distances = pairwise_distances(positions, positions)
    try:
        full = fit_covariance_model(distances, values, floor_m2)
    except GeostatFitError as exc:
        return FormationPickCheck(STATUS_FIT_FAILED, count, None, None, (), reason=str(exc))

    flags: list[PickFlag] = []
    inside = 0
    refit_fallbacks = 0
    indices = np.arange(count)
    for i in range(count):
        model = full
        keep = indices != i
        kept_distances = distances[np.ix_(keep, keep)]
        if refit:
            try:
                model = fit_covariance_model(
                    kept_distances,
                    values[keep],
                    floor_m2[keep],
                    start=full.log_params(),
                    max_iterations=REFIT_MAX_ITERATIONS,
                )
            except GeostatFitError:
                # One unstable refit must not kill the whole formation's check, so the
                # pick is judged by the full fit. That fit saw this pick (the masking
                # trap), so the fallback is counted and reported rather than hidden.
                model = full
                refit_fallbacks += 1
        try:
            guess, sigma = _predict_held_out(
                i, keep, kept_distances, model, distances, values, floor_m2
            )
        except np.linalg.LinAlgError as exc:
            return FormationPickCheck(STATUS_FIT_FAILED, count, None, None, (), reason=str(exc))
        z_score = (values[i] - guess) / sigma
        if abs(z_score) <= COVERAGE_Z:
            inside += 1
        if abs(z_score) > Z_FLAG:
            others = distances[i].copy()
            others[i] = np.inf
            j = int(np.argmin(others))
            flags.append(
                PickFlag(picks[i], guess, sigma, float(z_score), picks[j], float(others[j]))
            )
    flags.sort(key=lambda f: -abs(f.z_score))
    return FormationPickCheck(
        STATUS_CHECKED,
        count,
        full,
        inside / count,
        tuple(flags),
        refit_fallbacks=refit_fallbacks,
    )

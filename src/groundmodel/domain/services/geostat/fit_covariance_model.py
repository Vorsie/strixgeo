"""Fit sill, range and extra nugget by REML with a bounded L-BFGS-B search."""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy.optimize import minimize  # type: ignore[import-untyped]

from groundmodel.domain.services.geostat.geostat_constants import (
    FULL_FIT_MAX_ITERATIONS,
    INITIAL_NUGGET_M2,
    INITIAL_RANGE_FACTOR,
    LARGE_OBJECTIVE,
    NUGGET_BOUNDS_M2,
    RANGE_BOUNDS_M,
    RANGE_RETRY_FACTOR,
    SILL_BOUNDS_M2,
)
from groundmodel.domain.services.geostat.reml_objective import reml_objective
from groundmodel.domain.value_objects.covariance_model import CovarianceModel
from groundmodel.shared.exceptions import GeostatFitError

_LOG_BOUNDS = (
    (float(np.log(SILL_BOUNDS_M2[0])), float(np.log(SILL_BOUNDS_M2[1]))),
    (float(np.log(RANGE_BOUNDS_M[0])), float(np.log(RANGE_BOUNDS_M[1]))),
    (float(np.log(NUGGET_BOUNDS_M2[0])), float(np.log(NUGGET_BOUNDS_M2[1]))),
)


def initial_log_params(distances: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Return a data-driven start: sill = variance, range = 3 × median neighbour gap.

    Parameters
    ----------
    distances : numpy.ndarray
        Shape ``(n, n)`` pairwise distances (m).
    values : numpy.ndarray
        Shape ``(n,)`` pick elevations (m TAW).

    Returns
    -------
    numpy.ndarray
        ``log([sill, range, nugget])`` inside the search box.
    """
    count = len(values)
    nearest = np.sort(distances + np.diag(np.full(count, np.inf)), axis=1)[:, 0]
    range0 = float(np.clip(INITIAL_RANGE_FACTOR * np.median(nearest), *RANGE_BOUNDS_M))
    sill0 = float(np.clip(np.var(values), *SILL_BOUNDS_M2))
    return np.log([sill0, range0, INITIAL_NUGGET_M2])


def _clip_to_box(log_params: np.ndarray) -> np.ndarray:
    """Return ``log_params`` clipped into the log search box."""
    lows = np.array([b[0] for b in _LOG_BOUNDS])
    highs = np.array([b[1] for b in _LOG_BOUNDS])
    clipped: np.ndarray = np.clip(log_params, lows, highs)
    return clipped


def _on_range_bound(log_range: float) -> bool:
    """Return whether a fitted log range sits on either bound of the search box."""
    low, high = _LOG_BOUNDS[1]
    return abs(log_range - low) < 1e-6 or abs(log_range - high) < 1e-6


def fit_covariance_model(
    distances: np.ndarray,
    values: np.ndarray,
    noise_floor_m2: np.ndarray,
    *,
    start: np.ndarray | None = None,
    max_iterations: int = FULL_FIT_MAX_ITERATIONS,
) -> CovarianceModel:
    """Fit a Matérn-3/2 model to picks by REML.

    Parameters
    ----------
    distances : numpy.ndarray
        Shape ``(n, n)`` pairwise distances (m).
    values : numpy.ndarray
        Shape ``(n,)`` pick elevations (m TAW).
    noise_floor_m2 : numpy.ndarray
        Shape ``(n,)`` per-pick floor variances (m²).
    start : numpy.ndarray, optional
        Warm start ``log([sill, range, nugget])`` (a refit starts at the full fit).
    max_iterations : int, optional
        L-BFGS-B iteration cap.

    Returns
    -------
    CovarianceModel
        The fitted model.

    Raises
    ------
    GeostatFitError
        On non-finite input or when no positive-definite model was found.
    """
    if not np.all(np.isfinite(values)):
        raise GeostatFitError("pick elevations contain NaN or infinity")

    def run(x0: np.ndarray) -> Any:  # scipy OptimizeResult (scipy ships no stubs)
        return minimize(
            reml_objective,
            _clip_to_box(x0),
            args=(distances, values, noise_floor_m2),
            jac=True,
            method="L-BFGS-B",
            bounds=_LOG_BOUNDS,
            options={"maxiter": max_iterations},
        )

    first = (
        initial_log_params(distances, values) if start is None else np.asarray(start, dtype=float)
    )
    best = run(first)
    if start is None and _on_range_bound(float(best.x[1])):
        retry = first.copy()
        retry[1] = first[1] + np.log(RANGE_RETRY_FACTOR)
        second = run(retry)
        if second.fun < best.fun:
            best = second
    if not np.isfinite(best.fun) or best.fun >= LARGE_OBJECTIVE:
        raise GeostatFitError(f"covariance fit failed: {best.message}")
    sill, range_m, nugget = (float(v) for v in np.exp(best.x))
    return CovarianceModel(sill_m2=sill, range_m=range_m, nugget_m2=nugget)

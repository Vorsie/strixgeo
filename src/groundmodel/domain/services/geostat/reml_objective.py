"""Restricted (residual) maximum likelihood of a Matérn-3/2 model with an unknown mean.

Negative log REML (constants dropped):
  ℓ(θ) = ½ [ zᵀPz + log|K| + log(1ᵀK⁻¹1) ],  P = K⁻¹ - K⁻¹1 1ᵀK⁻¹ / (1ᵀK⁻¹1)
with K = C(s, r) + diag(floorᵢ² + n). Its gradient for any parameter θⱼ:
  ∂ℓ/∂θⱼ = ½ [ tr(P ∂K/∂θⱼ) - zᵀP (∂K/∂θⱼ) P z ]
on log parameters: ∂K/∂log s = C, ∂K/∂log r = s a² e^-a, ∂K/∂log n = n·I.
REML rather than plain ML because ML underestimates the variance when the mean is
estimated from the same few picks.
"""

from __future__ import annotations

import math

import numpy as np
from scipy.linalg import cho_solve  # type: ignore[import-untyped]

from groundmodel.domain.services.geostat.geostat_constants import JITTER_M2, LARGE_OBJECTIVE
from groundmodel.domain.services.geostat.matern_covariance import (
    matern32_covariance,
    matern32_covariance_dlog_range,
)


def reml_objective(
    log_params: np.ndarray,
    distances: np.ndarray,
    values: np.ndarray,
    noise_floor_m2: np.ndarray,
) -> tuple[float, np.ndarray]:
    """Return the negative log REML and its gradient on ``log([sill, range, nugget])``.

    Parameters
    ----------
    log_params : numpy.ndarray
        Shape ``(3,)``: ``log(sill m²), log(range m), log(extra nugget m²)``.
    distances : numpy.ndarray
        Shape ``(n, n)`` pairwise distances (m).
    values : numpy.ndarray
        Shape ``(n,)`` pick elevations (m TAW).
    noise_floor_m2 : numpy.ndarray
        Shape ``(n,)`` per-pick floor variances (m²).

    Returns
    -------
    tuple[float, numpy.ndarray]
        ``(value, gradient)``; ``(LARGE_OBJECTIVE, zeros)`` when K is not positive definite.
    """
    sill, range_m, nugget = np.exp(log_params)
    count = len(values)
    cov = matern32_covariance(distances, sill, range_m)
    k_mat = cov + np.diag(noise_floor_m2 + nugget + JITTER_M2)
    try:
        chol = np.linalg.cholesky(k_mat)
    except np.linalg.LinAlgError:
        return LARGE_OBJECTIVE, np.zeros(3)
    k_inv = cho_solve((chol, True), np.eye(count))
    one = np.ones(count)
    ki_1 = k_inv @ one
    sum_ki_1 = float(one @ ki_1)
    projector = k_inv - np.outer(ki_1, ki_1) / sum_ki_1
    p_z = projector @ values
    value = 0.5 * (
        float(values @ p_z) + 2.0 * float(np.log(np.diag(chol)).sum()) + math.log(sum_ki_1)
    )
    derivatives = (
        cov,
        matern32_covariance_dlog_range(distances, sill, range_m),
        nugget * np.eye(count),
    )
    gradient = np.array(
        [0.5 * (float(np.sum(projector * d_k)) - float(p_z @ d_k @ p_z)) for d_k in derivatives]
    )
    return value, gradient

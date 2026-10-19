"""Matérn-3/2 covariance, its range derivative and the semivariogram.

C(h) = s · (1 + a) · e^(-a) with a = √3 · h / r. Matérn-3/2 is once differentiable:
a contact surface that is smooth but not artificially so, the usual choice for
geological surfaces (Rasmussen & Williams 2006, §4.2).
"""

from __future__ import annotations

import math

import numpy as np

from groundmodel.domain.services.geostat.geostat_constants import MATERN_SQRT3
from groundmodel.domain.value_objects.covariance_model import CovarianceModel


def pairwise_distances(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Return the Euclidean distance between every row of ``a`` and every row of ``b``.

    Parameters
    ----------
    a : numpy.ndarray
        Shape ``(n, 2)`` positions (m).
    b : numpy.ndarray
        Shape ``(m, 2)`` positions (m).

    Returns
    -------
    numpy.ndarray
        Shape ``(n, m)`` distances (m).
    """
    diff = a[:, None, :] - b[None, :, :]
    distances: np.ndarray = np.sqrt((diff * diff).sum(axis=-1))
    return distances


def matern32_covariance(distance_m: np.ndarray, sill_m2: float, range_m: float) -> np.ndarray:
    """Return the Matérn-3/2 covariance at the given distances.

    Parameters
    ----------
    distance_m : numpy.ndarray
        Distances (m), any shape.
    sill_m2 : float
        Sill s (m²).
    range_m : float
        Range r (m).

    Returns
    -------
    numpy.ndarray
        Covariance (m²), same shape as ``distance_m``.
    """
    a = MATERN_SQRT3 * np.asarray(distance_m, dtype=float) / range_m
    return sill_m2 * (1.0 + a) * np.exp(-a)


def matern32_covariance_dlog_range(
    distance_m: np.ndarray, sill_m2: float, range_m: float
) -> np.ndarray:
    """Return ∂C/∂(log r) = s · a² · e^(-a), used by the REML gradient.

    Parameters
    ----------
    distance_m : numpy.ndarray
        Distances (m).
    sill_m2 : float
        Sill s (m²).
    range_m : float
        Range r (m).

    Returns
    -------
    numpy.ndarray
        Derivative (m²), same shape as ``distance_m``.
    """
    a = MATERN_SQRT3 * np.asarray(distance_m, dtype=float) / range_m
    return sill_m2 * a * a * np.exp(-a)


def semivariogram(distance_m: np.ndarray, model: CovarianceModel) -> np.ndarray:
    """Return γ(h) = n + s - C(h), half the expected squared difference of two picks.

    At h = 0 this is the nugget: two distinct picks at the same spot still differ by
    their noise (the strict γ(0) = 0 holds only for a pick compared with itself).

    Parameters
    ----------
    distance_m : numpy.ndarray
        Distances (m).
    model : CovarianceModel
        Fitted model.

    Returns
    -------
    numpy.ndarray
        Semivariance (m²).
    """
    cov = matern32_covariance(distance_m, model.sill_m2, model.range_m)
    return model.nugget_m2 + model.sill_m2 - cov


def expected_absolute_difference(
    distance_m: np.ndarray, model: CovarianceModel, *, pick_noise_m2: float = 0.0
) -> np.ndarray:
    """Return the expected |difference| of two picks h apart (the manual's "green curve").

    For a normal difference with variance v, E|Δ| = √v · √(2/π). Here
    v = 2 γ(h) + the two picks' floor variances (``pick_noise_m2``).

    Parameters
    ----------
    distance_m : numpy.ndarray
        Distances (m).
    model : CovarianceModel
        Fitted model.
    pick_noise_m2 : float, optional
        Sum of the two picks' floor variances (m²).

    Returns
    -------
    numpy.ndarray
        Expected absolute difference (m).
    """
    variance = 2.0 * semivariogram(distance_m, model) + pick_noise_m2
    return np.sqrt(variance) * math.sqrt(2.0 / math.pi)

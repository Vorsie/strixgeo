"""Ordinary kriging: the best linear guess with an unknown constant mean.

The weights minimise the expected squared error under the constraint that they sum
to 1 (so the unknown mean cancels). Written in its generalised-least-squares form,
which needs only solves with the data covariance K:

  w = K⁻¹k + K⁻¹1 · u / (1ᵀK⁻¹1),  u = 1 - 1ᵀK⁻¹k
  σ² = c₀ - kᵀK⁻¹k + u² / (1ᵀK⁻¹1)

with k the covariance between the data and the target and c₀ the prior variance at
the target. The test module works an example out by hand.
"""

from __future__ import annotations

import numpy as np
from scipy.linalg import cho_factor, cho_solve  # type: ignore[import-untyped]


def ordinary_kriging(
    data_covariance: np.ndarray,
    target_covariance: np.ndarray,
    values: np.ndarray,
    prior_variance: float,
) -> tuple[float, float, np.ndarray]:
    """Return the ordinary-kriging guess, its variance and the weights.

    Parameters
    ----------
    data_covariance : numpy.ndarray
        Shape ``(n, n)`` covariance K between the data, noise on the diagonal (m²).
    target_covariance : numpy.ndarray
        Shape ``(n,)`` covariance k between each datum and the target (m²).
    values : numpy.ndarray
        Shape ``(n,)`` observed values.
    prior_variance : float
        Variance c₀ of the field at the target, without noise (m²).

    Returns
    -------
    tuple[float, float, numpy.ndarray]
        ``(guess, variance, weights)``; the variance is clipped at 0 against round-off.

    Raises
    ------
    numpy.linalg.LinAlgError
        When ``data_covariance`` is not positive definite.
    """
    factor = cho_factor(data_covariance, lower=True)
    one = np.ones(len(values))
    ki_k = cho_solve(factor, target_covariance)
    ki_1 = cho_solve(factor, one)
    sum_ki_1 = float(one @ ki_1)
    unbias_gap = 1.0 - float(one @ ki_k)
    weights = ki_k + ki_1 * (unbias_gap / sum_ki_1)
    guess = float(weights @ values)
    variance = float(prior_variance - target_covariance @ ki_k + unbias_gap * unbias_gap / sum_ki_1)
    return guess, max(variance, 0.0), weights

"""Fitted Matérn-3/2 covariance model of one contact surface."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class CovarianceModel:
    """Sill, range and extra nugget of a Matérn-3/2 covariance.

    Attributes
    ----------
    sill_m2 : float
        Variance of the contact elevation between far-apart tests (m²).
    range_m : float
        Distance over which two picks stop being related (m).
    nugget_m2 : float
        Extra pick noise variance on top of each pick's source floor (m²).
    """

    sill_m2: float
    range_m: float
    nugget_m2: float

    def log_params(self) -> np.ndarray:
        """Return ``log([sill, range, nugget])``, the optimiser's parameter vector.

        Returns
        -------
        numpy.ndarray
            Shape ``(3,)``.
        """
        return np.log([self.sill_m2, self.range_m, self.nugget_m2])

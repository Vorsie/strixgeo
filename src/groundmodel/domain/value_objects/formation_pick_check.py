"""Result of the pick consistency check for one formation."""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.value_objects.covariance_model import CovarianceModel
from groundmodel.domain.value_objects.pick_flag import PickFlag


@dataclass(frozen=True)
class FormationPickCheck:
    """Outcome of :func:`check_formation_picks`.

    Attributes
    ----------
    status : str
        ``checked``, ``too_few_picks`` or ``fit_failed`` (geostat_constants).
    n_picks : int
        Number of picks considered.
    model : CovarianceModel or None
        Fit on all picks; ``None`` unless ``status == "checked"``.
    coverage_90 : float or None
        Share of picks inside their own leave-one-out 90 % band.
    flags : tuple[PickFlag, ...]
        Flagged picks, largest |z| first.
    reason : str or None
        Why the fit failed, for ``fit_failed``.
    refit_fallbacks : int
        Number of picks judged by the full fit because their leave-one-out refit
        failed; such a pick is judged by the masked model, so less strictly.
    """

    status: str
    n_picks: int
    model: CovarianceModel | None
    coverage_90: float | None
    flags: tuple[PickFlag, ...]
    reason: str | None = None
    refit_fallbacks: int = 0

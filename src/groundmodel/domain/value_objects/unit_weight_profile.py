"""Unit weight profile for vertical stress estimation."""

from dataclasses import dataclass


@dataclass(frozen=True)
class UnitWeightProfile:
    """Bulk unit weights used to estimate vertical effective stress for CPT normalisation.

    These are intentional defaults for Belgian/Dutch practice until a measured
    profile is available.  Override per project or per CPT when boring logs or
    lab data supply better values.

    Parameters
    ----------
    gamma_unsat : float
        Unit weight above the groundwater table in kN/m³.
    gamma_sat : float
        Saturated unit weight below the groundwater table in kN/m³.
    gamma_w : float
        Unit weight of water in kN/m³.
    """

    gamma_unsat: float = 18.0
    gamma_sat: float = 20.0
    gamma_w: float = 9.81

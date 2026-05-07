"""CPT soil behaviour type interpretation functions."""

import math

from groundmodel.domain.value_objects.unit_weight_profile import UnitWeightProfile
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)

_PA_KPA = 100.0  # atmospheric pressure in kPa


def calculate_ic(qtn: float, fr: float) -> float:
    """Calculate the soil behaviour type index Ic (Robertson, 1990).

    Parameters
    ----------
    qtn : float
        Normalised cone resistance (dimensionless). Must be > 0.
    fr : float
        Friction ratio in percent. Must be > 0.

    Returns
    -------
    float
        Soil behaviour type index Ic.
    """
    return math.sqrt((3.47 - math.log10(qtn)) ** 2 + (math.log10(fr) + 1.22) ** 2)


def classify_soil_ic(ic: float) -> str:
    """Return the Robertson (1990) soil class label for a given Ic value.

    Parameters
    ----------
    ic : float
        Soil behaviour type index from calculate_ic.

    Returns
    -------
    str
        Human-readable soil class (e.g. 'Sands: clean sand to silty sand').
    """
    if ic > 3.60:
        return "Sensitive fine-grained"
    if ic > 2.95:
        return "Organic soils"
    if ic > 2.60:
        return "Clays: silty clay to clay"
    if ic > 2.05:
        return "Silt mixtures: clayey silt to silty clay"
    if ic > 1.31:
        return "Sand mixtures: silty sand to sandy silt"
    return "Sands: clean sand to silty sand"


def calculate_ic_series(
    depths_m: list[float],
    qc_mpa: list[float],
    fs_mpa: list[float | None],
    gwt_m: float = 1.0,
    profile: UnitWeightProfile | None = None,
    max_iter: int = 5,
) -> list[float | None]:
    """Calculate Ic for every depth point using the Robertson & Wride (1998) iterative method.

    Stress normalisation uses a two-layer unit weight model (above/below the
    groundwater table) with a converging stress exponent n.

    Parameters
    ----------
    depths_m : list[float]
        Measurement depths in metres (ascending).
    qc_mpa : list[float]
        Cone resistance in MPa.
    fs_mpa : list[float | None]
        Sleeve friction in MPa; None elements yield None in the output.
    gwt_m : float
        Groundwater table depth in metres below surface.  Defaults to 1.0 m.
    profile : UnitWeightProfile | None
        Unit weights for stress calculation.  Uses Belgian/Dutch defaults when None.
    max_iter : int
        Maximum iterations for the stress-exponent n convergence loop.

    Returns
    -------
    list[float | None]
        Ic for each depth point, or None where inputs are unusable.
    """
    p = profile or UnitWeightProfile()
    result: list[float | None] = []

    for depth, qc, fs in zip(depths_m, qc_mpa, fs_mpa):
        if fs is None or qc <= 0.0:
            result.append(None)
            continue

        # Vertical total and effective stress [kPa]
        above = min(depth, gwt_m)
        below = max(0.0, depth - gwt_m)
        sigma_v = p.gamma_unsat * above + p.gamma_sat * below
        sigma_v_eff = max(sigma_v - p.gamma_w * below, 1.0)  # floor at 1 kPa

        qc_kpa = qc * 1000.0
        fs_kpa = fs * 1000.0
        net_qc = max(qc_kpa - sigma_v, 1.0)  # net cone resistance, floor at 1 kPa

        fr = fs_kpa / net_qc * 100.0  # normalised friction ratio [%]
        if fr <= 0.0:
            result.append(None)
            continue

        # Iterate stress exponent n until convergence (Robertson & Wride 1998)
        n = 1.0
        ic = 0.0
        for _ in range(max_iter):
            qtn = (net_qc / _PA_KPA) * (_PA_KPA / sigma_v_eff) ** n
            if qtn <= 0.0:
                ic = 0.0
                break
            ic = calculate_ic(qtn, fr)
            n_new = min(max(0.381 * ic + 0.05 * (sigma_v_eff / _PA_KPA) - 0.15, 0.5), 1.0)
            if abs(n_new - n) < 0.01:
                break
            n = n_new

        result.append(ic if ic > 0.0 else None)

    return result

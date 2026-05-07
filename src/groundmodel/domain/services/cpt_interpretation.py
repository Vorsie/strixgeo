"""CPT soil behaviour type interpretation functions."""

import math

from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


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
    qc_mpa: list[float],
    rf_pct: list[float | None],
) -> list[float | None]:
    """Calculate Ic for every depth point in a CPT series.

    Uses simplified atmospheric-pressure normalisation (Qtn = qc / 0.1 MPa)
    without effective-stress correction; adequate until stress profiles are
    available in the data model.

    Parameters
    ----------
    qc_mpa : list[float]
        Cone resistance in MPa.
    rf_pct : list[float | None]
        Friction ratio in percent; None elements yield None in the output.

    Returns
    -------
    list[float | None]
        Ic for each depth point, or None where qc or rf is unusable.
    """
    result: list[float | None] = []
    for qc, rf in zip(qc_mpa, rf_pct):
        if rf is None or rf <= 0.0 or qc <= 0.0:
            result.append(None)
        else:
            qtn = qc / 0.1  # Pa = 0.1 MPa; no effective-stress correction yet
            result.append(calculate_ic(qtn, rf))
    return result

"""CPT soil behaviour type interpretation functions."""

from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


def calculate_ic(qtn: float, fr: float) -> float:
    """Calculate the soil behaviour type index Ic.

    Parameters
    ----------
    qtn : float
        Normalised cone resistance (dimensionless).
    fr : float
        Friction ratio in percent.

    Returns
    -------
    float
        Soil behaviour type index Ic (Robertson, 1990).
    """
    ...


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
    ...

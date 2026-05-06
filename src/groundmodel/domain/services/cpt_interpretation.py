import math
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


def calculate_ic(qtn: float, fr: float) -> float:
    ...


def classify_soil_ic(ic: float) -> str:
    ...

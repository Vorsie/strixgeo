"""CPT interpretation use case."""
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


async def run_cpt_interpretation(cpt_id: str) -> None:
    """Run EC7 soil classification and Ic calculation for a stored CPT.

    Parameters
    ----------
    cpt_id : str
        UUID of the CPT to interpret.
    """
    ...

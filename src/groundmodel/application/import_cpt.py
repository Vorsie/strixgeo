"""CPT import use case."""
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


async def import_cpt(file_path: str) -> None:
    """Parse a CPT file and persist it to the database.

    Parameters
    ----------
    file_path : str
        Absolute path to the CPT file (GEF, AGS, or LAS).
    """
    ...

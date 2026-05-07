"""Project export use case."""

from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


async def export_project(project_id: str, fmt: str) -> bytes:
    """Serialise a project to the requested export format.

    Parameters
    ----------
    project_id : str
        UUID of the project to export.
    fmt : str
        Export format identifier (e.g. 'plaxis', 'geostudio', 'dsheet').

    Returns
    -------
    bytes
        Serialised project data in the requested format.
    """
    ...

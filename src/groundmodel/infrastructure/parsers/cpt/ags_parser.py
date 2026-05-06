"""AGS format CPT parser (stub — Phase 2)."""
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


class AGSParser:
    """Parser for the AGS4 geotechnical data exchange format."""

    def parse(self, content: str) -> list:
        """Parse AGS4 text content into a list of records.

        Parameters
        ----------
        content : str
            Raw AGS4 file content.

        Returns
        -------
        list
            Parsed records (schema TBD in Phase 2).
        """
        ...

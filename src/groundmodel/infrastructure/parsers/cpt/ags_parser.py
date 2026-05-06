"""AGS format CPT parser (stub — Phase 2)."""
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class AGSParser(GroundModelLogger):
    """Parser for the AGS4 geotechnical data exchange format."""

    def __init__(self) -> None:
        super().__init__(__name__)

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

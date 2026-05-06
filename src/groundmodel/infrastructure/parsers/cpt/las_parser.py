"""LAS format CPT parser (stub — Phase 2)."""
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class LASParser(GroundModelLogger):
    """Parser for the LAS well-log format adapted for CPT data."""

    def __init__(self) -> None:
        super().__init__(__name__)

    def parse(self, content: str) -> list:
        """Parse LAS text content into a list of records.

        Parameters
        ----------
        content : str
            Raw LAS file content.

        Returns
        -------
        list
            Parsed records (schema TBD in Phase 2).
        """
        ...

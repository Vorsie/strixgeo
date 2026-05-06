"""Abstract base class for all data exporters."""
from abc import ABC, abstractmethod

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class BaseExporter(GroundModelLogger, ABC):
    """Abstract exporter — implement export() for each target format."""

    @abstractmethod
    def export(self, project: object) -> bytes:
        """Serialise project data to the target format.

        Parameters
        ----------
        project : object
            Project domain object to export.

        Returns
        -------
        bytes
            Serialised output ready for file write or download.
        """
        ...

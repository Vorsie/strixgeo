"""Abstract base class for all data exporters."""
from abc import ABC, abstractmethod


class BaseExporter(ABC):
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

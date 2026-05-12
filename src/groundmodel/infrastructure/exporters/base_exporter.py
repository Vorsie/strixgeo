"""Abstract base class for the ground-model exporters.

Every concrete exporter (DXF, Plaxis, D-Sheet, GeoStudio) consumes
the same typed input: a ``GroundModelSnapshot`` carrying the
project metadata + the projected layer geometry. The snapshot is
assembled in the application layer; exporters never touch
SQLAlchemy or the DB.

Defining the contract here (rather than ``project: object``) means
every Phase 4 concrete exporter agrees on the input shape on day
one — no per-exporter ad-hoc workarounds, no full-project bundle
threaded through the export path.
"""

from abc import ABC, abstractmethod

from groundmodel.application.ground_model_snapshot import GroundModelSnapshot
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class BaseExporter(GroundModelLogger, ABC):
    """Abstract exporter — implement ``export`` for each target format."""

    @abstractmethod
    def export(self, snapshot: GroundModelSnapshot) -> bytes:
        """Serialise the snapshot to the target format.

        Parameters
        ----------
        snapshot : GroundModelSnapshot
            Project metadata + layer geometry, pre-assembled in the
            application layer.

        Returns
        -------
        bytes
            Serialised output ready for file write or download.
        """
        ...

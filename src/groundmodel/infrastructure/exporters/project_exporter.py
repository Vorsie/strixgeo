"""Abstract base class for project-scoped ground-model exporters.

Project exporters consume a ``GroundModelSnapshot`` — the full project's
layer geometry assembled in the application layer — and emit one artefact
for the whole project (e.g. a Plaxis 3D script, a D-Sheet input file).

This is one half of the ``BaseExporter`` split (debt #109). The other half
is ``SectionExporter`` for section-scoped artefacts.
"""

from abc import ABC, abstractmethod

from groundmodel.application.ground_model_snapshot import GroundModelSnapshot
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ProjectExporter(GroundModelLogger, ABC):
    """Abstract exporter for project-wide artefacts.

    Concrete subclasses implement ``export`` to serialise a
    ``GroundModelSnapshot`` into a target format.
    """

    @abstractmethod
    def export(self, snapshot: GroundModelSnapshot) -> bytes:
        """Serialise the project snapshot to the target format.

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

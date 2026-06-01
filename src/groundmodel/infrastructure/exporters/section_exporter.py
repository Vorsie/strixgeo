"""Abstract base class for section-scoped ground-model exporters.

Section exporters consume a ``SectionSnapshot`` — one cross-section's
geometry projected from the geological model — and emit one artefact for
that section (e.g. a DXF file, a Plaxis 2D script, a PDF report).

This is one half of the ``BaseExporter`` split (debt #109). The other half
is ``ProjectExporter`` for project-wide artefacts.
"""

from abc import ABC, abstractmethod

from groundmodel.application.section_snapshot import SectionSnapshot
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class SectionExporter(GroundModelLogger, ABC):
    """Abstract exporter for section-scoped artefacts.

    Concrete subclasses implement ``export`` to serialise a
    ``SectionSnapshot`` into a target format.
    """

    @abstractmethod
    def export(self, snapshot: SectionSnapshot) -> bytes:
        """Serialise the section snapshot to the target format.

        Parameters
        ----------
        snapshot : SectionSnapshot
            Section geometry assembled by
            ``application/build_section_snapshot.py``.

        Returns
        -------
        bytes
            Serialised output ready for file write or download.
        """
        ...

"""Abstract base class for section exporters that need CLOSED 2-D geometry.

Third sibling of the ``BaseExporter`` split (debt #109), alongside
``ProjectExporter`` (project-wide artefacts) and ``SectionExporter``
(section artefacts built from formation picks).

A ``SectionGeometryExporter`` consumes a ``SectionPolygonSet`` — the
section's drawn partition fill resolved into absolute along-distance /
elevation polygons — and emits one artefact for that section. The
Deltares D-Series targets live here: D-Stability's geometry IS a set of
closed soil-layer polygons, and D-Sheet Piling's soil profile is a 1-D
sample through the same polygons.
"""

from abc import ABC, abstractmethod

from groundmodel.application.section_polygon_set import SectionPolygonSet
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class SectionGeometryExporter(GroundModelLogger, ABC):
    """Abstract exporter for closed-geometry section artefacts.

    Concrete subclasses implement ``export`` to serialise a
    ``SectionPolygonSet`` into a target format.
    """

    @abstractmethod
    def export(self, polygons: SectionPolygonSet) -> bytes:
        """Serialise the section's filled geometry to the target format.

        Parameters
        ----------
        polygons : SectionPolygonSet
            Section geometry assembled by
            ``application/build_section_polygons.py``.

        Returns
        -------
        bytes
            Serialised output ready for file write or download.
        """
        ...

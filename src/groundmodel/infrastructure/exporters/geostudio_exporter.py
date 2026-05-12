"""GeoStudio format exporter (stub — Phase 4)."""

from groundmodel.application.ground_model_snapshot import GroundModelSnapshot
from groundmodel.infrastructure.exporters.base_exporter import BaseExporter


class GeoStudioExporter(BaseExporter):
    """Exports a ground-model snapshot to GeoStudio slope-stability format."""

    def __init__(self) -> None:
        """Initialise with the standard module-named logger."""
        super().__init__(__name__)

    def export(self, snapshot: GroundModelSnapshot) -> bytes:
        """Export the snapshot as GeoStudio input.

        Raises
        ------
        NotImplementedError
            Always — Phase 4 deliverable not yet implemented.
        """
        raise NotImplementedError("GeoStudio exporter lands in Phase 4 export work")

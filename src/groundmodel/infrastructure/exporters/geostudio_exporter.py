"""GeoStudio format exporter (stub — Phase 4)."""
from groundmodel.infrastructure.exporters.base_exporter import BaseExporter


class GeoStudioExporter(BaseExporter):
    """Exports project data to GeoStudio slope-stability format."""

    def export(self, project: object) -> bytes:
        """Export project to GeoStudio format."""
        ...

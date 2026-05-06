"""PLAXIS format exporter (stub — Phase 4)."""
from groundmodel.infrastructure.exporters.base_exporter import BaseExporter


class PlaxisExporter(BaseExporter):
    """Exports project data to PLAXIS FEM input format."""

    def export(self, project: object) -> bytes:
        """Export project to PLAXIS input format."""
        ...

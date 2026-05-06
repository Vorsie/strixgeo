"""PLAXIS format exporter (stub — Phase 4)."""
from groundmodel.infrastructure.exporters.base_exporter import BaseExporter


class PlaxisExporter(BaseExporter):
    """Exports project data to PLAXIS FEM input format."""

    def __init__(self) -> None:
        super().__init__(__name__)

    def export(self, project: object) -> bytes:
        """Export project to PLAXIS input format."""
        ...

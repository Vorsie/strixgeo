"""D-Sheet Piling format exporter (stub — Phase 4)."""
from groundmodel.infrastructure.exporters.base_exporter import BaseExporter


class DSheetExporter(BaseExporter):
    """Exports project data to D-Sheet Piling retaining-wall format."""

    def export(self, project: object) -> bytes:
        """Export project to D-Sheet Piling format."""
        ...

"""D-Sheet Piling format exporter (stub — Phase 4)."""
from groundmodel.infrastructure.exporters.base_exporter import BaseExporter


class DSheetExporter(BaseExporter):
    """Exports project data to D-Sheet Piling retaining-wall format."""

    def __init__(self) -> None:
        super().__init__(__name__)

    def export(self, project: object) -> bytes:
        """Export project to D-Sheet Piling format."""
        ...

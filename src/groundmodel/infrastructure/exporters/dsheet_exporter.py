from groundmodel.infrastructure.exporters.base_exporter import BaseExporter


class DSheetExporter(BaseExporter):
    def export(self, project: object) -> bytes:
        ...

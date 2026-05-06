from groundmodel.infrastructure.exporters.base_exporter import BaseExporter


class PlaxisExporter(BaseExporter):
    def export(self, project: object) -> bytes:
        ...

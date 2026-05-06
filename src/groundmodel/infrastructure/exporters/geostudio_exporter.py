from groundmodel.infrastructure.exporters.base_exporter import BaseExporter


class GeoStudioExporter(BaseExporter):
    def export(self, project: object) -> bytes:
        ...

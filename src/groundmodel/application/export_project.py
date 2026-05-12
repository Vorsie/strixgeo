"""Project export use case.

Stub kept as a class so Phase 4 export work can land without
restructuring the call sites or the logging hierarchy. The
``GroundModelLogger`` base wires the project-standard log methods
— matches every other application-layer use case.
"""

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ExportProject(GroundModelLogger):
    """Serialise a project (or a slice of it) to a downstream design-tool format.

    Phase 4 MVP-gate work will populate this with DXF + Plaxis
    exporters delegated through the ``BaseExporter`` ABC and a
    forthcoming ``GroundModelSnapshot`` value object (debt #28).
    The current stub holds the class identity so the call surface
    is stable from Phase 4 onward.
    """

    def __init__(self) -> None:
        """Initialise with the standard module-named logger."""
        super().__init__(__name__)

    async def execute(self, project_id: str, fmt: str) -> bytes:
        """Export the project identified by ``project_id`` to ``fmt``.

        Parameters
        ----------
        project_id : str
            UUID of the project to export.
        fmt : str
            Export format identifier (``"dxf"``, ``"plaxis"``,
            ``"dsheet"``, ``"geostudio"``).

        Returns
        -------
        bytes
            Serialised project data in the requested format.

        Raises
        ------
        NotImplementedError
            Always — concrete exporters land in Phase 4 alongside
            the geological model editor.
        """
        raise NotImplementedError(
            "Concrete exporters (DXF, Plaxis, ...) land in Phase 4 MVP-gate work"
        )

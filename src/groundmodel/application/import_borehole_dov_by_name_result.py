"""Result of fetching ONE borehole from DOV by its name."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from groundmodel.application.import_borehole_dov_result import ImportBoreholeDovResult


@dataclass
class ImportBoreholeDovByNameResult:
    """Outcome of :meth:`ImportBoreholeDov.execute_by_name`.

    Attributes
    ----------
    found : bool
        DOV's WFS knows a borehole whose name ends with the asked name.
    dov_name : str
        The asked name when not found; DOV's own name (``boornummer``, perhaps
        prefixed: ``1445-GEO-25/022-B17``) when found.
    borehole_id : UUID or None
        The project borehole (new, or already there) once persisted; ``None``
        when not found or when its XML could not be downloaded / parsed.
    batch : ImportBoreholeDovResult or None
        The persist summary (children attached, failures) when found and
        written; ``None`` when the borehole was already in the project.
    already_in_project : bool
        The project already held ``(project, "DOV", test_id)`` (found before
        the download, or stored by a concurrent request): ``borehole_id`` is
        that row and nothing was written.
    """

    found: bool
    dov_name: str
    borehole_id: UUID | None = None
    batch: ImportBoreholeDovResult | None = None
    already_in_project: bool = False

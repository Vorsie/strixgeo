"""The shape :class:`DxfFenceExporter` needs from a fence wall panel.

A :class:`typing.Protocol` rather than a concrete class, and that is the point:
the exporter is INFRASTRUCTURE, so it must not import the API request schema
that happens to carry these fields today. Dependencies run
API -> Application -> Domain <- Infrastructure; an
``infrastructure -> api.schemas`` import inverts that arrow and quietly makes
the wire contract a dependency of the file writer.

Stating the requirement structurally keeps the arrow pointing the right way and
costs nothing: ``FenceExportPanel`` (and any future in-process caller — a batch
export script, a PDF report slice) satisfies it by having the fields, with no
adapter and no conversion pass.

Coordinates are PROJECTED project-CRS metres (EPSG 31370 Lambert 72 /
28992 RD New), never lon/lat — the same space
``desktop/src/renderer/src/utils/fencePanels.ts`` builds the walls in, and the
space the DXF is written in.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol, runtime_checkable

__all__ = ["FencePanelSource"]


@runtime_checkable
class FencePanelSource(Protocol):
    """One triangulated vertical wall of the 3-D fence diagram.

    Read-only properties rather than plain attribute annotations: a mutable
    protocol attribute matches INVARIANTLY, which would force every caller to
    hold the exact container type declared here. Properties are covariant, so a
    caller may supply a ``list`` where a ``Sequence`` is asked for.
    """

    @property
    def formation_id(self) -> str:
        """Lithostratigraphic formation this wall belongs to."""
        ...

    @property
    def body_id(self) -> str | None:
        """Resolver-assigned body identity; ``None`` when the wall is untied.

        Recorded on each exported 3DFACE as XDATA (owner ruling 2026-09-05) so a
        body is recoverable from the entity. It is NOT part of the layer name: a
        body spans sections, so it is not a per-section split key.
        """
        ...

    @property
    def section_id(self) -> str | None:
        """Cross-section this wall was built on; ``None`` on a legacy panel.

        The DXF layer name is split per section (``Fence-<section>_<unit>``) so a
        whole section can be switched off in CAD (owner ruling 2026-09-05). The
        section's human name is resolved server-side from this id (the renderer
        does not carry it), exactly as ``nad_class`` is. ``None`` (or an id the
        route could not resolve) keeps the pre-section ``Fence-<unit>`` naming.
        """
        ...

    @property
    def name(self) -> str:
        """Display label, already resolved; becomes the DXF layer name's unit part."""
        ...

    @property
    def color(self) -> str:
        """Hex layer colour, resolved at the presentation boundary.

        NAD packing colours override the inherited lithology colour and are
        never stored, so the server must not re-derive this.
        """
        ...

    @property
    def vertices(self) -> Sequence[tuple[float, float, float]]:
        """``(x_m, y_m, elevation_m)`` in the project's projected CRS."""
        ...

    @property
    def triangles(self) -> Sequence[tuple[int, int, int]]:
        """Triangle faces as index triples into ``vertices``."""
        ...

"""Request schemas for the fence-diagram DXF export.

``FenceExportPanel`` and ``FenceExportRequest`` form one cohesive
vocabulary (the fence-export wire contract) and are grouped in a single
module — the same approved exception to "one class per file" that
``voxel_build_request.py`` uses for its request-schema family.
"""

from __future__ import annotations

from pydantic import Field, model_validator

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class FenceExportPanel(StrictRequestModel):
    """One filled wall panel of the 3-D fence diagram, built client-side.

    Mirrors the desktop's ``FencePanel`` interface
    (``desktop/src/renderer/src/utils/fencePanels.ts``) field-for-field.
    Fence panels are triangulated in the renderer from the section
    partition engine (world-space column positions + the 2-D fill), which
    the server has no way to reconstruct — this schema RECEIVES the
    already-built geometry rather than deriving it.

    Parameters
    ----------
    formation_id : str
        Lithostratigraphic formation this panel belongs to. Panels sharing
        a ``formation_id`` are grouped onto the same DXF layer.
    body_id : str or None
        Resolver-assigned body identity; ``None`` when the panel is not
        part of a correlated body. Carried for parity with the renderer's
        ``FencePanel`` shape; not used to key DXF layers.
    name : str
        Display name for the DXF layer — the renderer's already-resolved
        formation/unit label.
    color : str
        Hex colour (``"#rrggbb"``, ``"rrggbb"``, or the 3-digit short
        form), used as the DXF layer's true colour. The renderer resolves
        NAD colours at the presentation boundary (see ``docs/ux.md``); the
        server must not re-derive or second-guess that mapping.
    vertices : list of (float, float, float)
        ``(x_m, y_m, elevation_m)`` in the project's projected CRS
        (EPSG 31370 / 28992) — NOT lon/lat. Indexed by ``triangles``.
    triangles : list of (int, int, int)
        Triangle faces as indices into ``vertices``.
    """

    formation_id: str
    body_id: str | None = None
    name: str
    color: str
    vertices: list[tuple[float, float, float]] = Field(default_factory=list)
    triangles: list[tuple[int, int, int]] = Field(default_factory=list)


class FenceExportRequest(StrictRequestModel):
    """Body of ``POST .../geology/models/{model_id}/export/fence-dxf``.

    The full set of fence wall panels the renderer built for the current
    3-D fence-diagram view. An empty ``panels`` list is valid — it exports
    an empty (but well-formed) DXF file.

    Parameters
    ----------
    panels : list of FenceExportPanel
        The wall panels to serialise, in no particular order.
    """

    panels: list[FenceExportPanel] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_triangle_indices(self) -> FenceExportRequest:
        """Reject any triangle whose vertex index is out of range for its panel.

        A silently dropped or clamped face would ship a hole in a
        deliverable the engineer opens directly in AutoCAD — this must
        fail loudly at the API boundary (a 422 via FastAPI's standard
        request-validation mapping) rather than reach the exporter.

        Raises
        ------
        ValueError
            Naming the panel index, the panel name, the triangle index,
            and the offending vertex index — wrapped by Pydantic into the
            response's validation-error detail.
        """
        for panel_index, panel in enumerate(self.panels):
            vertex_count = len(panel.vertices)
            for triangle_index, triangle in enumerate(panel.triangles):
                for vertex_index in triangle:
                    if not (0 <= vertex_index < vertex_count):
                        raise ValueError(
                            f"panel {panel_index} ({panel.name!r}): triangle "
                            f"{triangle_index} references vertex index "
                            f"{vertex_index}, but the panel has only "
                            f"{vertex_count} vertices"
                        )
        return self

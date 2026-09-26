"""Request body of ``POST /sections/{id}/export/dxf`` — the drawn fill, optional.

Unlike the closed-geometry family (D-Stability, D-Sheet), a DXF without a
fill is still a useful drawing: the contact lines, the column lines and the
CPT curves. So the partition is optional here — the stratigraphy axis, whose
section fill is not a litho partition, posts none and gets the line drawing
with the curves; the litho and geotech axes post the fill they draw.
"""

from __future__ import annotations

from pydantic import Field

from groundmodel.api.schemas.project.voxel_build_request import SectionPartitionInputSchema
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class SectionDxfExportRequest(StrictRequestModel):
    """The section's drawn 2-D partition, when the axis has one.

    Attributes
    ----------
    partition : SectionPartitionInputSchema | None
        The renderer's partition fill (columns + regions in gap-local
        fractions), the same shape the voxel build and D-Stability send.
        ``None`` draws no fill: contact lines, columns and CPT curves only.
    """

    partition: SectionPartitionInputSchema | None = Field(
        default=None,
        description="The section's drawn partition fill, from the renderer; omit for lines only.",
    )
